"""Resumo semanal pelo Telegram: agenda, conteúdo honesto, envio único pela fila, /resumo e API."""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
import pytest
from fastapi.testclient import TestClient

from orbitlink_agent.ai import telegram_bot as tb
from orbitlink_agent.alerts.notify import Notifier
from orbitlink_agent.api.app import create_app
from orbitlink_agent.config import Settings
from orbitlink_agent.reports import digest
from orbitlink_agent.storage.db import Database, now_ts

TZ = "America/Fortaleza"
Z = ZoneInfo(TZ)
TOKEN = "123456789:AAH-segredo_do_bot"
CHAT = 42


def _settings(tmp_path, **kw):
    base = dict(_env_file=None, data_dir=tmp_path, api_token="svc-token", timezone=TZ, terminal_name="Mini do Sítio")
    base.update(kw)
    return Settings(**base)


def _tg_settings(tmp_path, **kw):
    return _settings(tmp_path, telegram_bot_token=TOKEN, telegram_chat_id=str(CHAT), **kw)


@pytest.fixture
def db(tmp_path):
    d = Database(tmp_path / "o.sqlite3")
    ts = now_ts()
    d.execute("INSERT INTO terminals (id, terminal_key, target, origin, first_seen, last_seen) VALUES (1,'k','x','grpc',?,?)",
              (ts, ts))
    return d


def _fill(db, start: datetime, days: int = 7, gb_per_hour: float = 1.0, loss_hour: int | None = None) -> None:
    """Uma linha por hora, cada uma valendo 1 h observada (cobertura 100%). `loss_hour` tem 2% de perda."""
    t = start
    for _ in range(days * 24):
        ts = int(t.timestamp())
        db.execute("INSERT INTO usage_minutes VALUES (1, ?, ?, ?, 3600, 1.0, 'calculada')",
                   (ts, gb_per_hour * 0.9e9, gb_per_hour * 0.1e9))
        drop = 0.02 if t.hour == loss_hour else 0.0
        db.execute("INSERT INTO quality_minutes (terminal_id, minute_ts, samples, latency_samples, latency_avg, latency_max, "
                   "jitter_avg, drop_avg, drop_samples, full_drop_s, source) "
                   "VALUES (1, ?, 3600, 3600, 30, 80, 2, ?, 3600, ?, 'calculada')",
                   (ts, drop, 36 if drop else 0))
        t += timedelta(hours=1)


class FakeTelegram:
    def __init__(self):
        self.sent: list[dict] = []

    def __call__(self, req: httpx.Request) -> httpx.Response:
        body = json.loads(req.content or b"{}")
        if req.url.path.endswith("/sendMessage"):
            self.sent.append(body)
            return httpx.Response(200, json={"ok": True, "result": {"message_id": len(self.sent)}})
        return httpx.Response(200, json={"ok": True, "result": []})


# ----------------------------------------------------------------- agenda

@pytest.mark.parametrize(("now", "expected"), [
    ((2026, 11, 11, 10, 0), (2026, 11, 9, 8)),   # quarta: último envio foi segunda 8h
    ((2026, 11, 9, 7, 59), (2026, 11, 2, 8)),    # segunda antes das 8h: ainda vale o da semana passada
    ((2026, 11, 9, 8, 0), (2026, 11, 9, 8)),     # no horário exato
    ((2027, 1, 3, 12, 0), (2026, 12, 28, 8)),    # atravessa o ano
])
def test_scheduled_before(now, expected):
    at = digest.scheduled_before(datetime(*now, tzinfo=Z), 0, 8)
    assert (at.year, at.month, at.day, at.hour) == expected and at.minute == 0


def test_week_covers_previous_monday_to_sunday():
    start, end = digest.week_ending(datetime(2026, 11, 9, 8, tzinfo=Z))
    assert datetime.fromtimestamp(start, Z) == datetime(2026, 11, 2, tzinfo=Z)
    assert datetime.fromtimestamp(end, Z) == datetime(2026, 11, 9, tzinfo=Z)


def test_next_scheduled_other_weekday():
    nxt = digest.next_scheduled(datetime(2026, 11, 11, 10, tzinfo=Z), 4, 18)  # sexta 18h
    assert nxt == datetime(2026, 11, 13, 18, tzinfo=Z)


# ----------------------------------------------------------------- conteúdo

def test_render_full_week(tmp_path, db):
    start = datetime(2026, 11, 2, tzinfo=Z)
    _fill(db, start - timedelta(days=7), gb_per_hour=0.5)  # semana anterior: metade
    _fill(db, start, loss_hour=21)
    db.execute("INSERT INTO connection_events (terminal_id, kind, start_ts, end_ts, duration_s, confidence) "
               "VALUES (1, 'ping_drop', ?, ?, 95, 'derivado')", (int(start.timestamp()) + 3600, int(start.timestamp()) + 3695))
    db.execute("INSERT INTO connection_events (terminal_id, kind, start_ts, end_ts, duration_s, confidence) "
               "VALUES (1, 'unreachable', ?, ?, 300, 'derivado')", (int(start.timestamp()) + 7200, int(start.timestamp()) + 7500))
    db.execute("INSERT INTO alert_rules (id, name, kind, operator, threshold, severity, created_at, updated_at) "
               "VALUES (1, 'x', 'latency_high', 'gt', 1, 'crit', 0, 0)")
    db.execute("INSERT INTO alert_events (rule_id, status, severity, started_at, message) VALUES (1, 'resolved', 'crit', ?, 'm')",
               (int(start.timestamp()) + 100,))
    s, e = digest.week_ending(datetime(2026, 11, 9, 8, tzinfo=Z))
    d = digest.collect(db, _settings(tmp_path), s, e)
    text = digest.render(d)
    assert text.startswith("📊 Resumo semanal — Mini do Sítio\n02/11 a 08/11")
    assert "Consumo: 168,00 GB" in text  # 7 × 24 h × 1 GB
    assert "Semana anterior: 84,00 GB (+100%)" in text
    assert "Quedas: 1 ·" in text and "maior 1 min 35 s em 02/11 01:00" in text
    assert "Pior horário: 21h–22h (perda 2,0%)" in text
    assert "Antena inacessível: 1 vez(es), 5 min no total" in text
    assert "Alertas: 1 disparado(s), 1 crítico(s)" in text
    assert "Franquia" not in text  # sem franquia configurada, nada é inventado
    assert "Cobertura" not in text and text.endswith(digest.FOOTER)
    assert "*" not in text and "<" not in text  # texto puro


def test_render_partial_week_is_honest(tmp_path, db):
    start = datetime(2026, 11, 2, tzinfo=Z)
    _fill(db, start, days=2)
    s, e = digest.week_ending(datetime(2026, 11, 9, 8, tzinfo=Z))
    text = digest.render(digest.collect(db, _settings(tmp_path, usage_monthly_limit_gb=500), s, e))
    assert "Cobertura: 29% do período observado" in text  # 2 de 7 dias
    assert "Semana anterior" not in text  # comparação só com as duas semanas bem observadas
    assert "Nenhuma queda registrada" in text


# ----------------------------------------------------------------- agendamento e fila

def _notifier(tmp_path, db, fake, **kw):
    return Notifier(db, _tg_settings(tmp_path, **kw), transport=httpx.MockTransport(fake))


async def test_tick_enqueues_once_and_delivers(tmp_path, db):
    fake = FakeTelegram()
    n = _notifier(tmp_path, db, fake, alert_webhook_url="https://exemplo.invalid/hook")
    _fill(db, datetime(2026, 11, 2, tzinfo=Z))
    now = datetime(2026, 11, 9, 8, 3, tzinfo=Z)
    assert digest.tick(db, n.settings, n, now) == "enfileirado"
    assert digest.tick(db, n.settings, n, now + timedelta(minutes=5)) == "ja_enviado"
    rows = db.query("SELECT channel FROM notification_outbox")
    assert rows == [{"channel": "telegram"}]  # o webhook recebe só alertas
    assert await n.deliver_due() == 1
    assert fake.sent[0]["chat_id"] == str(CHAT) and fake.sent[0]["text"].startswith("📊 Resumo semanal")
    assert "atraso" not in fake.sent[0]["text"]
    # semana seguinte é avaliada de novo (aqui sem dados: nada sai)
    assert digest.tick(db, n.settings, n, now + timedelta(days=7)) == "sem_dados"


def test_tick_without_data_late_or_disabled(tmp_path, db):
    n = _notifier(tmp_path, db, FakeTelegram())
    assert digest.tick(db, n.settings, n, datetime(2026, 11, 9, 9, tzinfo=Z)) == "sem_dados"
    _fill(db, datetime(2026, 11, 9, tzinfo=Z))
    # agente voltou só na quarta: resumo de segunda é pulado em vez de chegar fora de hora
    assert digest.tick(db, n.settings, n, datetime(2026, 11, 18, 10, tzinfo=Z)) == "atrasado"
    assert db.scalar("SELECT COUNT(*) FROM notification_outbox") == 0
    n.settings.weekly_digest_enabled = False
    assert digest.tick(db, n.settings, n, datetime(2026, 11, 23, 8, 5, tzinfo=Z)) == "desativado"
    plain = Notifier(db, _settings(tmp_path))  # sem Telegram
    assert digest.tick(db, plain.settings, plain, datetime(2026, 11, 23, 8, 5, tzinfo=Z)) == "desativado"
    assert plain.enqueue_digest("x") == 0


# ----------------------------------------------------------------- bot e API

async def test_bot_resumo_command(tmp_path, db):
    s = _tg_settings(tmp_path)
    fake = FakeTelegram()
    bot = tb.TelegramBot(db, s, transport=httpx.MockTransport(fake), poll_timeout=0)
    msg = {"message_id": 1, "date": now_ts(), "text": "/resumo", "chat": {"id": CHAT, "type": "private"}}
    async with bot._client() as c:
        await bot.handle(c, msg)
        assert "Ainda não há dados" in fake.sent[-1]["text"]
        _fill(db, datetime.now(Z) - timedelta(days=3), days=2)
        await bot.handle(c, msg)
    assert fake.sent[-1]["text"].startswith("📊 Últimos 7 dias — Mini do Sítio")
    assert "Consumo: 48,00 GB" in fake.sent[-1]["text"]


def _login(c: TestClient) -> dict[str, str]:
    svc = {"Authorization": "Bearer svc-token"}
    c.post("/v1/auth/setup", json={"username": "admin", "password": "senha-forte-123"}, headers=svc)
    r = c.post("/v1/auth/login", json={"username": "admin", "password": "senha-forte-123"}, headers=svc)
    return {**svc, "X-OrbitLink-Session": r.json()["session"]}


def test_api_digest_settings_survive_restart(tmp_path):
    with TestClient(create_app(_settings(tmp_path), start_collector=False)) as c:
        h = _login(c)
        st = c.get("/v1/alerts/digest", headers=h).json()
        assert st == {"enabled": True, "telegram": False, "weekday": 0, "hour": 8, "next_at": None, "last_period_end": None}
        assert c.post("/v1/alerts/digest/send", headers=h).status_code == 409
        r = c.put("/v1/settings", headers=h, json={"weekly_digest_weekday": 4, "weekly_digest_hour": 18,
                                                   "weekly_digest_enabled": False})
        assert r.status_code == 200
        assert c.put("/v1/settings", headers=h, json={"weekly_digest_hour": 24}).status_code == 422
    with TestClient(create_app(_settings(tmp_path), start_collector=False)) as c:
        st = c.get("/v1/alerts/digest", headers=_login(c)).json()
        assert (st["enabled"], st["weekday"], st["hour"]) == (False, 4, 18)
