"""Avisos de mudança na antena: firmware atualizado e reinício."""

from __future__ import annotations

import copy

from astryon_agent.alerts.engine import AlertEngine, seed_defaults
from astryon_agent.alerts.notify import Notifier
from astryon_agent.collector.bus import EventBus
from astryon_agent.collector.service import Collector
from astryon_agent.config import Settings
from astryon_agent.starlink.transport import FixtureTransport
from astryon_agent.storage.db import Database, now_ts


def _env(tmp_path, fixture_data):
    s = Settings(_env_file=None, data_dir=tmp_path, api_token="t", alert_webhook_url="https://exemplo.invalid/h")
    db = Database(tmp_path / "d.sqlite3")
    t = FixtureTransport.from_dict(copy.deepcopy(fixture_data))
    return s, db, t, Collector(s, db, t, EventBus())


def _only(db, kind):
    db.execute("UPDATE alert_rules SET enabled = CASE WHEN kind = ? THEN 1 ELSE 0 END", (kind,))


async def test_firmware_change_creates_event_and_one_notification(tmp_path, fixture_data):
    s, db, t, col = _env(tmp_path, fixture_data)
    await col.poll_status()
    assert not db.scalar("SELECT COUNT(*) FROM connection_events WHERE kind = 'firmware_update'")
    t.responses["get_status"]["data"]["device_info"]["software_version"] = "2026.11.2.mr11111"
    await col.poll_status()
    ev = db.one("SELECT cause, confidence FROM connection_events WHERE kind = 'firmware_update'")
    assert ev["cause"] == "Firmware 2026.10.1.mr00000 → 2026.11.2.mr11111" and ev["confidence"] == "confirmado"
    await col.poll_status()  # mesma versão: nada novo
    assert db.scalar("SELECT COUNT(*) FROM connection_events WHERE kind = 'firmware_update'") == 1

    seed_defaults(db)
    _only(db, "dish_firmware_changed")
    eng = AlertEngine(db, EventBus(), None, s.timezone, s, Notifier(db, s))
    fired = eng.evaluate()
    assert len(fired) == 1 and "⬆️ Firmware da antena atualizado" in fired[0]["message"]
    assert "2026.11.2.mr11111" in fired[0]["message"]
    assert eng.evaluate() == []


def test_reboot_alert_fires_then_expires_silently(tmp_path, fixture_data):
    s, db, _, _ = _env(tmp_path, fixture_data)
    seed_defaults(db)
    _only(db, "dish_rebooted")
    eng = AlertEngine(db, EventBus(), None, s.timezone, s, Notifier(db, s))
    assert eng.evaluate() == []  # nenhum reinício: valor 0 não passa do limiar 0
    db.execute("INSERT INTO connection_events (kind, cause, start_ts, confidence) VALUES ('boot', 'x', ?, 'confirmado')",
               (now_ts() - 60,))
    fired = eng.evaluate()
    assert len(fired) == 1 and fired[0]["message"].startswith("🔄 A antena reiniciou")
    db.execute("UPDATE connection_events SET start_ts = start_ts - 7200 WHERE kind = 'boot'")
    eng.evaluate()
    assert db.scalar("SELECT status FROM alert_events") == "resolved"
    statuses = [r["payload_json"] for r in db.query("SELECT payload_json FROM notification_outbox")]
    assert len(statuses) == 1 and '"status": "active"' in statuses[0]  # sem "resolvido" para um evento
