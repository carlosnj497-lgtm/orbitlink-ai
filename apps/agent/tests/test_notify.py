"""Franquia do plano (ciclo de cobrança, % consumido, alerta) e notificações (fila, Telegram, webhook, reenvio)."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx
import pytest
from fastapi.testclient import TestClient

from astryon_agent.alerts.engine import AlertEngine, seed_defaults
from astryon_agent.alerts.notify import Notifier
from astryon_agent.api.app import create_app
from astryon_agent.collector.bus import EventBus
from astryon_agent.config import Settings
from astryon_agent.logging_setup import redact
from astryon_agent.storage import queries
from astryon_agent.storage.db import Database, now_ts

TZ = "America/Fortaleza"
Z = ZoneInfo(TZ)
TOKEN = "123456789:AAH-segredo_do_bot"


def _settings(tmp_path, **kw):
    return Settings(_env_file=None, data_dir=tmp_path, api_token="svc-token", **kw)


@pytest.fixture
def db(tmp_path):
    d = Database(tmp_path / "o.sqlite3")
    ts = now_ts()
    d.execute("INSERT INTO terminals (id, terminal_key, target, origin, first_seen, last_seen) VALUES (1,'k','x','grpc',?,?)",
              (ts, ts))
    return d


def _use(db, gb: float, samples: int = 60) -> None:
    """Grava `gb` de consumo calculado no primeiro minuto do ciclo atual (dia 1)."""
    start, _ = queries.billing_cycle(datetime.now(Z), 1)
    db.execute("INSERT OR REPLACE INTO usage_minutes VALUES (1, ?, ?, ?, ?, 1.0, 'calculada')",
               (int(start.timestamp()), gb * 1e9 * 0.9, gb * 1e9 * 0.1, samples))


# ----------------------------------------------------------------- ciclo de cobrança

@pytest.mark.parametrize(("now", "day", "start", "end"), [
    ((2026, 11, 3, 10), 5, (2026, 10, 5), (2026, 11, 5)),   # antes do dia de virada: ciclo começou no mês anterior
    ((2026, 11, 12, 10), 5, (2026, 11, 5), (2026, 12, 5)),
    ((2026, 11, 5, 0), 5, (2026, 11, 5), (2026, 12, 5)),    # 0h do dia de virada já é o novo ciclo
    ((2026, 12, 30, 23), 28, (2026, 12, 28), (2027, 1, 28)),  # atravessa o ano
    ((2027, 1, 2, 8), 28, (2026, 12, 28), (2027, 1, 28)),
    ((2026, 3, 1, 8), 1, (2026, 3, 1), (2026, 4, 1)),
])
def test_billing_cycle(now, day, start, end):
    s, e = queries.billing_cycle(datetime(*now, tzinfo=Z), day)
    assert (s.year, s.month, s.day, s.hour) == (*start, 0)
    assert (e.year, e.month, e.day, e.hour) == (*end, 0)


def test_usage_plan_unconfigured_is_honest(db):
    p = queries.usage_plan(db, None, TZ, None, 1)
    assert p["configured"] is False and p["pct_used"] is None and p["cap_bytes"] is None
    assert p["source"] == "indisponivel"  # nada observado: não é "0%"


def test_usage_plan_percentage_and_lower_bound(db):
    _use(db, 8.0, samples=60)
    p = queries.usage_plan(db, None, TZ, 10, 1)
    assert p["configured"] is True
    assert p["pct_used"] == pytest.approx(80.0)
    assert p["remaining_bytes"] == pytest.approx(2e9)
    assert p["source"] == "calculada"
    assert p["lower_bound"] is True  # só 1 minuto observado: o consumo real pode ser maior
    assert "fatura oficial" in p["method"]


# ----------------------------------------------------------------- alerta de franquia

def test_cap_rules_seeded_once_even_on_existing_db(db):
    db.execute("INSERT INTO alert_rules (name, kind, operator, threshold, min_duration_s, window_s, severity, cooldown_s, "
               "hysteresis, enabled, created_at, updated_at) VALUES ('x', 'loss_high', 'gt', 1, 0, 300, 'warn', 0, 0.1, 1, 0, 0)")
    seed_defaults(db)  # banco antigo: não recria os padrões, mas ganha as regras de franquia
    assert db.scalar("SELECT COUNT(*) FROM alert_rules WHERE kind='usage_cap_pct'") == 2
    assert db.scalar("SELECT COUNT(*) FROM alert_rules WHERE kind='latency_high'") == 0
    db.execute("DELETE FROM alert_rules WHERE kind='usage_cap_pct'")
    seed_defaults(db)  # apagadas pelo usuário: não voltam
    assert db.scalar("SELECT COUNT(*) FROM alert_rules WHERE kind='usage_cap_pct'") == 0


def test_cap_alert_fires_once_per_threshold_and_enqueues(tmp_path, db):
    seed_defaults(db)
    s = _settings(tmp_path, usage_monthly_limit_gb=10, telegram_bot_token=TOKEN, telegram_chat_id="42")
    eng = AlertEngine(db, EventBus(), None, TZ, s, Notifier(db, s))
    _use(db, 8.5)
    fired = eng.evaluate()
    assert [e["severity"] for e in fired] == ["warn"]  # 80% sim, 100% não
    assert "Estimativa local" in fired[0]["message"]
    assert eng.evaluate() == []  # continua ativo, sem repetir
    _use(db, 10.5)
    assert [e["severity"] for e in eng.evaluate()] == ["crit"]
    rows = db.query("SELECT channel, payload_json FROM notification_outbox ORDER BY id")
    assert [r["channel"] for r in rows] == ["telegram", "telegram"]
    assert all(TOKEN not in r["payload_json"] for r in rows)


def test_cap_alert_without_cap_never_fires(tmp_path, db):
    seed_defaults(db)
    eng = AlertEngine(db, EventBus(), None, TZ, _settings(tmp_path))
    _use(db, 5000)
    assert [e for e in eng.evaluate() if "Franquia" in e["message"]] == []


# ----------------------------------------------------------------- entrega

class FakeTelegram:
    def __init__(self) -> None:
        self.mode = "ok"
        self.sent: list[dict] = []

    def __call__(self, req: httpx.Request) -> httpx.Response:
        if self.mode == "offline":
            raise httpx.ConnectError("sem rota", request=req)
        if self.mode == "bad_token":
            return httpx.Response(401, json={"ok": False, "description": "Unauthorized"})
        if self.mode == "flood":
            return httpx.Response(429, json={"ok": False, "description": "Too Many Requests", "parameters": {"retry_after": 7}})
        self.sent.append({"url": str(req.url), **json.loads(req.content)})
        return httpx.Response(200, json={"ok": True, "result": {}})


def _notifier(tmp_path, db, fake, **kw):
    s = _settings(tmp_path, telegram_bot_token=TOKEN, telegram_chat_id="42", **kw)
    return Notifier(db, s, transport=httpx.MockTransport(fake))


def test_telegram_delivery(tmp_path, db):
    fake = FakeTelegram()
    n = _notifier(tmp_path, db, fake)
    assert n.channels() == {"webhook": False, "telegram": True}
    n.enqueue({"status": "active", "severity": "crit", "message": "Antena inacessível por 2 min", "ts": now_ts()})
    assert asyncio.run(n.deliver_due()) == 1
    assert fake.sent[0]["chat_id"] == "42"
    assert "Antena inacessível" in fake.sent[0]["text"] and "Crítico" in fake.sent[0]["text"]
    assert asyncio.run(n.deliver_due()) == 0  # não reenvia
    assert n.status()["pending"] == 0


def test_offline_is_queued_and_delivered_late(tmp_path, db):
    fake = FakeTelegram()
    n = _notifier(tmp_path, db, fake)
    n.enqueue({"status": "active", "severity": "crit", "message": "Antena inacessível", "ts": now_ts() - 600})
    fake.mode = "offline"
    assert asyncio.run(n.deliver_due()) == 0
    row = db.one("SELECT * FROM notification_outbox")
    assert row["attempts"] == 1 and row["sent_at"] is None and row["next_attempt_at"] > now_ts()
    assert row["last_error"] == "ConnectError"
    assert n.status()["pending"] == 1
    fake.mode = "ok"
    db.execute("UPDATE notification_outbox SET next_attempt_at = 0")  # o backoff venceu
    assert asyncio.run(n.deliver_due()) == 1
    assert "entregue com atraso" in fake.sent[0]["text"]


def test_permanent_error_and_token_never_leaks(tmp_path, db):
    fake = FakeTelegram()
    fake.mode = "bad_token"
    n = _notifier(tmp_path, db, fake)
    n.enqueue({"status": "active", "severity": "warn", "message": "x", "ts": now_ts()})
    asyncio.run(n.deliver_due())
    row = db.one("SELECT * FROM notification_outbox")
    assert row["failed_at"] is not None and row["last_error"] == "HTTP 401: Unauthorized"
    st = json.dumps(n.status())
    assert TOKEN not in st and "segredo" not in st
    assert asyncio.run(n.send_test()) == {"telegram": {"ok": False, "error": "HTTP 401: Unauthorized"}}


def test_rate_limit_respects_retry_after(tmp_path, db):
    fake = FakeTelegram()
    fake.mode = "flood"
    n = _notifier(tmp_path, db, fake)
    n.enqueue({"status": "active", "severity": "warn", "message": "x", "ts": now_ts()})
    asyncio.run(n.deliver_due())
    row = db.one("SELECT * FROM notification_outbox")
    assert row["failed_at"] is None and row["next_attempt_at"] >= now_ts() + 29


def test_old_notifications_expire(tmp_path, db):
    n = _notifier(tmp_path, db, FakeTelegram(), notification_max_age_h=1)
    n.enqueue({"status": "active", "severity": "warn", "message": "x", "ts": now_ts()})
    db.execute("UPDATE notification_outbox SET created_at = ?", (now_ts() - 7200,))
    assert asyncio.run(n.deliver_due()) == 0
    assert db.scalar("SELECT last_error FROM notification_outbox") == "expirada"


def test_webhook_payload_and_resolution(tmp_path, db):
    got: list[dict] = []

    def hook(req: httpx.Request) -> httpx.Response:
        got.append(json.loads(req.content))
        return httpx.Response(204)

    s = _settings(tmp_path, alert_webhook_url="https://exemplo.invalid/hook")
    n = Notifier(db, s, transport=httpx.MockTransport(hook))
    n.enqueue({"status": "resolved", "severity": "warn", "message": "Perda: normalizado", "ts": now_ts()})
    asyncio.run(n.deliver_due())
    assert got[0]["status"] == "resolved" and got[0]["source"] == "ASTRYON"
    assert got[0]["text"].startswith("✅ Resolvido")


def test_resolution_is_notified(tmp_path, db):
    s = _settings(tmp_path, alert_webhook_url="https://exemplo.invalid/hook")
    eng = AlertEngine(db, EventBus(), None, TZ, s, Notifier(db, s))
    ts = now_ts()
    db.execute("""INSERT INTO alert_rules (name, kind, operator, threshold, min_duration_s, window_s, severity, cooldown_s,
                  hysteresis, enabled, created_at, updated_at) VALUES ('perda', 'loss_high', 'gt', 10, 0, 300, 'warn', 900,
                  0.2, 1, ?, ?)""", (ts, ts))

    def loss(rate: float) -> None:
        db.execute("DELETE FROM history_samples")
        for i in range(30):
            db.execute("INSERT INTO history_samples VALUES (1,'b',?,?,?,30,1,1,NULL,'grpc')", (i, now_ts() - i, rate))

    loss(0.5)
    eng.evaluate()
    loss(0.0)
    eng.evaluate()
    statuses = [json.loads(r["payload_json"])["status"] for r in db.query("SELECT payload_json FROM notification_outbox")]
    assert statuses == ["active", "resolved"]
    loss(0.5)  # volta dentro do cooldown: precisa avisar de novo
    eng.evaluate()
    rows = [json.loads(r["payload_json"]) for r in db.query("SELECT payload_json FROM notification_outbox ORDER BY id")]
    assert [r["status"] for r in rows] == ["active", "resolved", "active"]
    assert "voltou" in rows[-1]["message"]


def test_redact_telegram_url():
    line = f"HTTP Request: POST https://api.telegram.org/bot{TOKEN}/sendMessage"
    assert TOKEN not in redact(line) and "/bot[redigido]/sendMessage" in redact(line)


def test_redact_groq_key():
    key = "gsk_" + "Ab3" * 15
    for line in (f"Invalid API Key: {key}", f'{{"error": "chave {key} recusada"}}', f"x={key}"):
        assert key not in redact(line) and "gsk_[redigido]" in redact(line)


# ----------------------------------------------------------------- API

def _login(c: TestClient) -> dict[str, str]:
    svc = {"Authorization": "Bearer svc-token"}
    c.post("/v1/auth/setup", json={"username": "admin", "password": "senha-forte-123"}, headers=svc)
    r = c.post("/v1/auth/login", json={"username": "admin", "password": "senha-forte-123"}, headers=svc)
    return {**svc, "X-ASTRYON-Session": r.json()["session"]}


def test_api_plan_settings_and_notifications(tmp_path):
    app = create_app(_settings(tmp_path), start_collector=False)
    with TestClient(app) as c:
        h = _login(c)
        assert c.get("/v1/usage/plan", headers=h).json()["configured"] is False
        r = c.put("/v1/settings", headers=h, json={"usage_monthly_limit_gb": 100, "usage_cycle_start_day": 10})
        assert r.status_code == 200
        p = c.get("/v1/usage/plan", headers=h).json()
        assert p["configured"] is True and p["cap_bytes"] == 100e9 and p["cycle_start_day"] == 10
        assert datetime.fromtimestamp(p["cycle_start"], Z).day == 10
        c.put("/v1/settings", headers=h, json={"usage_monthly_limit_gb": 0})  # 0 remove a franquia
        assert c.get("/v1/usage/plan", headers=h).json()["configured"] is False
        st = c.get("/v1/alerts/notifications", headers=h).json()
        assert st["channels"] == {"webhook": False, "telegram": False} and st["pending"] == 0
        assert c.post("/v1/alerts/notifications/test", headers=h).status_code == 409
        cfg = c.get("/v1/settings", headers=h).json()
        assert "telegram_bot_token" not in cfg and cfg["secrets_configured"]["telegram_bot_token"] is False


def test_api_overrides_survive_restart(tmp_path):
    with TestClient(create_app(_settings(tmp_path), start_collector=False)) as c:
        c.put("/v1/settings", headers=_login(c), json={"usage_monthly_limit_gb": 50, "usage_cycle_start_day": 3})
    with TestClient(create_app(_settings(tmp_path), start_collector=False)) as c:
        p = c.get("/v1/usage/plan", headers=_login(c)).json()
        assert p["cap_bytes"] == 50e9 and p["cycle_start_day"] == 3


def test_broken_message_does_not_block_the_queue(tmp_path, db):
    s = _settings(tmp_path, alert_webhook_url="https://exemplo.invalid/hook")
    got = []

    def hook(req):
        got.append(json.loads(req.content))
        return httpx.Response(200)

    n = Notifier(db, s, transport=httpx.MockTransport(hook))
    db.execute("INSERT INTO notification_outbox (channel, payload_json, created_at, next_attempt_at) "
               "VALUES ('webhook', '{quebrado', ?, ?)", (now_ts(), now_ts()))
    n.enqueue({"status": "active", "severity": "warn", "message": "Perda alta", "ts": now_ts()})
    assert asyncio.run(n.deliver_due()) == 1
    assert got and "Perda alta" in got[0]["text"]
    bad = db.one("SELECT failed_at, last_error FROM notification_outbox WHERE payload_json = '{quebrado'")
    assert bad["failed_at"] and "JSONDecodeError" in bad["last_error"]


def test_rate_limiter_forgets_old_keys():
    from astryon_agent.auth.local import RateLimiter

    rl = RateLimiter(5, 0.0)
    for i in range(1100):
        rl.allow(f"ip-{i}")
    assert len(rl._hits) <= 1025
