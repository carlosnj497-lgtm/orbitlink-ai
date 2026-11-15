"""Saúde do servidor, aviso de volta, vigia externo e backup automático."""

from __future__ import annotations

import asyncio
import gzip
import sqlite3

import httpx
import pytest
from fastapi.testclient import TestClient

from astryon_agent.alerts.engine import AlertEngine, measure, seed_defaults
from astryon_agent.api.app import create_app
from astryon_agent.collector.bus import EventBus
from astryon_agent.config import Settings
from astryon_agent.ops import backup, health
from astryon_agent.storage.db import Database, now_ts

from .test_api import login
from .test_api import settings as api_settings

TOKEN = "123456789:AAH-segredo_do_bot"


def _settings(tmp_path, **kw):
    return Settings(_env_file=None, data_dir=tmp_path, api_token="t", **kw)


@pytest.fixture
def db(tmp_path):
    return Database(tmp_path / "astryon.sqlite3")


# ----------------------------------------------------------------- leituras do servidor
def test_cpu_temp_reads_hottest_zone_and_ignores_garbage(tmp_path):
    for i, v in enumerate(["51000", "53500", "lixo", "999999"]):
        z = tmp_path / f"thermal_zone{i}"
        z.mkdir()
        (z / "temp").write_text(v)
    assert health.cpu_temp_c(tmp_path) == 53.5
    assert health.cpu_temp_c(tmp_path / "nada") is None  # sem sensores: None, nunca 0


def test_mem_available(tmp_path):
    f = tmp_path / "meminfo"
    f.write_text("MemTotal: 4000000 kB\nMemFree: 100 kB\nMemAvailable: 1000000 kB\n")
    assert health.mem_available_pct(f) == 25.0
    assert health.mem_available_pct(tmp_path / "x") is None


def test_server_health_shape(tmp_path, db):
    h = health.server_health(db, _settings(tmp_path))
    assert 0 < h["disk"]["free_pct"] <= 100 and h["db_size_bytes"] > 0
    assert h["last_backup_at"] is None and h["healthcheck_configured"] is False


# ----------------------------------------------------------------- alertas do servidor
def test_server_alert_rules_seeded_once_and_measured(tmp_path, db, monkeypatch):
    s = _settings(tmp_path)
    seed_defaults(db)
    kinds = {r["kind"] for r in db.query("SELECT kind FROM alert_rules")}
    assert {"server_disk_low", "server_temp_high"} <= kinds
    db.execute("DELETE FROM alert_rules WHERE kind = 'server_temp_high'")
    seed_defaults(db)
    assert not db.scalar("SELECT COUNT(*) FROM alert_rules WHERE kind = 'server_temp_high'")

    assert 0 < measure(db, None, "server_disk_low", 600, s.timezone, s) <= 100
    monkeypatch.setattr(health, "cpu_temp_c", lambda: 91.0)
    assert measure(db, None, "server_temp_high", 600, s.timezone, s) == 91.0
    monkeypatch.setattr(health, "cpu_temp_c", lambda: None)
    assert measure(db, None, "server_temp_high", 600, s.timezone, s) is None


def test_disk_low_fires(tmp_path, db, monkeypatch):
    s = _settings(tmp_path)
    seed_defaults(db)
    db.execute("UPDATE alert_rules SET enabled = 0 WHERE kind != 'server_disk_low'")

    class Usage:
        total, free = 100, 4

    monkeypatch.setattr("astryon_agent.alerts.engine.shutil.disk_usage", lambda p: Usage)
    fired = AlertEngine(db, EventBus(), None, s.timezone, s).evaluate()
    assert len(fired) == 1 and "disco" in fired[0]["message"]


# ----------------------------------------------------------------- aviso de volta
def test_downtime_notice_only_after_threshold(tmp_path, db):
    s = _settings(tmp_path, downtime_notice_min=10)
    now = now_ts()
    assert health.downtime_notice(db, s, now) is None  # primeira execução: sem heartbeat anterior
    db.execute("INSERT INTO agent_heartbeats VALUES (?, 1, NULL, NULL, 'x')", (now - 5 * 60,))
    assert health.downtime_notice(db, s, now) is None  # reinício rápido não gera aviso
    db.execute("INSERT INTO agent_heartbeats VALUES (?, 1, NULL, NULL, 'x')", (now - 2 * 3600 - 14 * 60,))
    db.execute("DELETE FROM agent_heartbeats WHERE ts = ?", (now - 5 * 60,))
    ev = health.downtime_notice(db, s, now)
    assert ev and "2 h 14 min fora do ar" in ev["message"] and "não necessariamente caiu" in ev["message"]


def test_downtime_notice_is_queued_on_startup(tmp_path):
    s = api_settings(tmp_path, telegram_bot_token=TOKEN, telegram_chat_id="1", backup_enabled=False)
    d = Database(s.db_path)
    d.execute("INSERT INTO agent_heartbeats VALUES (?, 1, NULL, NULL, 'x')", (now_ts() - 3 * 3600,))
    d.close()
    with TestClient(create_app(s, start_collector=False)) as c:
        h = login(c)
        assert c.get("/v1/ops/health", headers=h).status_code == 200
        db = c.app.state.ctx.db
        msgs = [r["payload_json"] for r in db.query("SELECT payload_json FROM notification_outbox")]
        assert any("voltou depois de 3 h" in m for m in msgs)


def test_healthcheck_url_must_be_https_and_is_secret(tmp_path):
    with pytest.raises(ValueError):
        _settings(tmp_path, healthcheck_url="http://hc-ping.com/x")
    from astryon_agent.api.routes_settings import SECRET_FIELDS

    assert "healthcheck_url" in SECRET_FIELDS


async def test_healthcheck_loop_pings(tmp_path, monkeypatch):
    s = _settings(tmp_path, healthcheck_url="https://hc-ping.com/abc", healthcheck_interval_s=60)
    pings = []

    def handler(req):
        pings.append(str(req.url))
        return httpx.Response(200)

    async def stop(_s):
        raise asyncio.CancelledError

    monkeypatch.setattr(health.asyncio, "sleep", stop)
    with pytest.raises(asyncio.CancelledError):
        await health.healthcheck_loop(s, httpx.MockTransport(handler))
    assert pings == ["https://hc-ping.com/abc"]


# ----------------------------------------------------------------- backup
def test_backup_is_restorable_and_rotates(tmp_path, db):
    s = _settings(tmp_path, backup_keep=2)
    db.set_kv("marca", "antes-do-backup")
    paths = [backup.make_backup(db, s, now_ts() + i) for i in range(3)]
    assert [p.name for p in backup.list_backups(s)] == [p.name for p in paths[1:]]
    restored = tmp_path / "restaurado.sqlite3"
    restored.write_bytes(gzip.decompress(paths[-1].read_bytes()))
    con = sqlite3.connect(restored)
    assert con.execute("SELECT value FROM settings_kv WHERE key = 'marca'").fetchone()[0] == "antes-do-backup"
    con.close()
    assert not list(backup.backup_dir(s).glob("*.part"))


async def test_run_once_daily_and_weekly_telegram(tmp_path, db):
    s = _settings(tmp_path, telegram_bot_token=TOKEN, telegram_chat_id="99", backup_telegram=True)
    sent = []

    def handler(req):
        assert req.url.path.endswith("/sendDocument")
        sent.append(req.content)
        return httpx.Response(200, json={"ok": True})

    t = httpx.MockTransport(handler)
    r1 = await backup.run_once(db, s, t)
    assert r1["created"] and r1["sent_telegram"] and b'name="chat_id"' in sent[0]
    r2 = await backup.run_once(db, s, t)  # menos de 24 h depois: nada novo, nada enviado
    assert r2["created"] is None and r2["sent_telegram"] is False and len(sent) == 1
    r3 = await backup.run_once(db, s, t, force=True)
    assert r3["created"] and r3["sent_telegram"] and len(sent) == 2


async def test_backup_without_telegram_stays_local(tmp_path, db):
    r = await backup.run_once(db, _settings(tmp_path))
    assert r["created"] and r["sent_telegram"] is False


def test_backup_telegram_is_off_by_default(tmp_path):
    assert _settings(tmp_path).backup_telegram is False


async def test_telegram_backup_is_sanitized(tmp_path, db):
    from astryon_agent.auth import local
    uid = local.setup_admin(db, "admin", "senha-forte-123")
    local.login(db, "admin", "senha-forte-123")
    db.execute("INSERT INTO esp32_nodes (device_id, name, secret_enc, enabled, created_at) VALUES "
               "('esp-1', 'x', 'fernet:SEGREDO', 1, 0)")
    db.set_kv("sync:agent_token", "fernet:TOKEN-DA-NUVEM")
    db.set_kv("marca", "fica")
    s = _settings(tmp_path, telegram_bot_token=TOKEN, telegram_chat_id="99", backup_telegram=True)
    docs = []

    def handler(req):
        docs.append(req.content)
        return httpx.Response(200, json={"ok": True})

    r = await backup.run_once(db, s, httpx.MockTransport(handler))
    assert r["sent_telegram"] and len(docs) == 1
    gz = docs[0].split(b"\r\n\r\n", 3)[-1].rsplit(b"\r\n--", 1)[0]
    sent_db = tmp_path / "enviado.sqlite3"
    sent_db.write_bytes(gzip.decompress(gz))
    con = sqlite3.connect(sent_db)
    assert con.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 0
    assert con.execute("SELECT password_hash FROM local_users WHERE id = ?", (uid,)).fetchone()[0] == ""
    assert con.execute("SELECT secret_enc FROM esp32_nodes").fetchone()[0] == ""
    assert con.execute("SELECT COUNT(*) FROM settings_kv WHERE key = 'sync:agent_token'").fetchone()[0] == 0
    assert con.execute("SELECT value FROM settings_kv WHERE key = 'marca'").fetchone()[0] == "fica"
    con.close()
    raw = gzip.decompress(gz)
    assert b"SEGREDO" not in raw and b"TOKEN-DA-NUVEM" not in raw  # VACUUM: nada sobra em páginas livres
    # a cópia local continua completa e a sanitizada não fica na pasta
    assert all(".telegram." not in p.name for p in backup.backup_dir(s).iterdir())
    local_copy = gzip.decompress(backup.list_backups(s)[-1].read_bytes())
    assert b"TOKEN-DA-NUVEM" in local_copy


async def test_telegram_backup_never_goes_to_group(tmp_path, db):
    s = _settings(tmp_path, telegram_bot_token=TOKEN, telegram_chat_id="-100123", backup_telegram=True)
    t = httpx.MockTransport(lambda req: pytest.fail("não deveria enviar para grupo"))
    r = await backup.run_once(db, s, t)
    assert r["created"] and r["sent_telegram"] is False
