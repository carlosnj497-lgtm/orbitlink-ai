"""Coletor + persistência: idempotência, reinício, lacunas, consumo, eventos e offline."""

from __future__ import annotations

import copy
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from astryon_agent.collector.bus import EventBus
from astryon_agent.collector.service import Collector
from astryon_agent.config import Settings
from astryon_agent.starlink.transport import FixtureTransport
from astryon_agent.storage import queries
from astryon_agent.storage.db import Database, now_ts


def make(tmp_path, fixture_data, **kw):
    s = Settings(_env_file=None, data_dir=tmp_path, api_token="t", **kw)
    db = Database(tmp_path / "t.sqlite3")
    t = FixtureTransport.from_dict(copy.deepcopy(fixture_data))
    return Collector(s, db, t, EventBus()), db, t


def total(db, table="history_samples"):
    return db.scalar(f"SELECT COUNT(*) FROM {table}")


async def test_history_ingest_idempotent_and_usage(tmp_path, fixture_data):
    col, db, t = make(tmp_path, fixture_data)
    await col.poll_status()
    await col.poll_history()
    assert total(db) == 20
    await col.poll_history()  # mesmo snapshot => nada duplicado
    assert total(db) == 20
    down = db.scalar("SELECT SUM(bytes_down) FROM usage_minutes")
    up = db.scalar("SELECT SUM(bytes_up) FROM usage_minutes")
    assert down == pytest.approx(18 * 8_000_000 / 8)
    assert up == pytest.approx(18 * 800_000 / 8)
    assert db.scalar("SELECT source FROM usage_minutes LIMIT 1") == "demonstracao"
    ev = db.query("SELECT * FROM connection_events WHERE kind='ping_drop'")
    assert len(ev) == 1 and ev[0]["duration_s"] == 2 and ev[0]["confidence"] == "derivado"


async def test_incremental_after_new_samples(tmp_path, fixture_data):
    col, db, t = make(tmp_path, fixture_data)
    await col.poll_status()
    await col.poll_history()
    h = t.responses["get_history"]["data"]
    h["current"] = 50  # 5 novas amostras (sobrescrevem índices 5..9 do anel)
    await col.poll_history()
    assert total(db) == 25
    counters = [r["counter"] for r in db.query("SELECT counter FROM history_samples ORDER BY counter")]
    assert counters == list(range(25, 50))
    assert db.scalar("SELECT COUNT(*) FROM observation_gaps") == 0


async def test_gap_recorded_when_buffer_overrun(tmp_path, fixture_data):
    col, db, t = make(tmp_path, fixture_data)
    await col.poll_status()
    await col.poll_history()
    t.responses["get_history"]["data"]["current"] = 100  # 55 novas, anel só tem 20
    await col.poll_history()
    gap = db.one("SELECT * FROM observation_gaps WHERE kind='history_lost'")
    assert gap and gap["samples_lost"] == 35
    # lacuna não vira zero no consumo: só 40 amostras com tráfego no total
    assert db.scalar("SELECT SUM(samples) FROM usage_minutes") == 40


async def test_reboot_detected_and_new_boot_id(tmp_path, fixture_data):
    col, db, t = make(tmp_path, fixture_data)
    await col.poll_status()
    await col.poll_history()
    first_boot = col.state.boot_id
    t.responses["get_status"]["data"]["device_state"]["uptime_s"] = 4
    t.responses["get_history"]["data"]["current"] = 3
    await col.poll_status()
    await col.poll_history()
    assert col.state.boot_id != first_boot
    assert db.scalar("SELECT COUNT(DISTINCT boot_id) FROM history_samples") == 2
    assert db.scalar("SELECT COUNT(*) FROM connection_events WHERE kind='boot'") == 1
    # counters 0..2 do novo boot não colidem com o boot antigo
    assert total(db) == 23


async def test_unreachable_opens_event_and_gap_then_closes(tmp_path, fixture_data):
    col, db, t = make(tmp_path, fixture_data)
    await col.poll_status()
    saved = t.responses["get_status"]
    t.responses["get_status"] = {"error": "UNAVAILABLE"}
    with pytest.raises(Exception):
        await col.poll_status()
    assert col.state.dish_reachable is False
    ev = db.one("SELECT * FROM connection_events WHERE kind='unreachable'")
    assert ev and ev["end_ts"] is None and ev["confidence"] == "indeterminado"
    t.responses["get_status"] = saved
    await col.poll_status()
    assert db.one("SELECT end_ts FROM connection_events WHERE kind='unreachable'")["end_ts"] is not None
    assert db.one("SELECT end_ts FROM observation_gaps WHERE kind='dish_unreachable'")["end_ts"] is not None


async def test_status_outage_event(tmp_path, fixture_data):
    col, db, t = make(tmp_path, fixture_data)
    t.responses["get_status"]["data"]["outage"] = {"cause": "OBSTRUCTED", "start_timestamp_ns": 0, "duration_ns": 0}
    await col.poll_status()
    await col.poll_status()
    assert db.scalar("SELECT COUNT(*) FROM connection_events WHERE kind='status_outage'") == 1
    del t.responses["get_status"]["data"]["outage"]
    await col.poll_status()
    assert db.one("SELECT end_ts FROM connection_events WHERE kind='status_outage'")["end_ts"] is not None


async def test_agent_downtime_gap(tmp_path, fixture_data):
    col, db, t = make(tmp_path, fixture_data)
    db.execute("INSERT INTO agent_heartbeats VALUES (?, 1, NULL, NULL, 'x')", (now_ts() - 3600,))
    col._detect_agent_downtime()
    g = db.one("SELECT * FROM observation_gaps WHERE kind='agent_offline'")
    assert g and g["end_ts"] - g["start_ts"] >= 3590


async def test_quality_and_telemetry_queries(tmp_path, fixture_data):
    col, db, t = make(tmp_path, fixture_data)
    await col.poll_status()
    await col.poll_history()
    tid = col.state.terminal_id
    end = now_ts() + 1
    q = queries.quality(db, tid, end - 300, end, "America/Fortaleza")
    assert q["observed_seconds"] == 20
    assert q["full_drop_seconds"] == 2
    assert q["availability_pct"] == pytest.approx(90.0)
    tel = queries.telemetry(db, tid, end - 120, end, bucket_s=1)
    assert tel["series_source"] == "history_1s"
    assert tel["source"] == "demonstracao"
    assert sum(1 for p in tel["points"] if p["down_mbps"] == 8.0) >= 17
    summary = queries.usage_summary(db, tid, "America/Fortaleza")
    assert summary["today"]["bytes_total"] == round(18 * 8_800_000 / 8)
    assert "ESTIMADO" in summary["method"]


def test_monthly_usage_coverage_uses_actual_month_length(tmp_path):
    db = Database(tmp_path / "monthly.sqlite3")
    start = datetime(2026, 1, 1, tzinfo=ZoneInfo("UTC"))
    end = datetime(2026, 2, 1, tzinfo=ZoneInfo("UTC"))
    db.execute("INSERT INTO terminals (id, terminal_key, target, origin, first_seen, last_seen) VALUES (1,'k','x','grpc',0,0)")
    db.execute("INSERT INTO usage_minutes VALUES (1, ?, 0, 0, ?, 1.0, 'calculada')",
               (int(start.timestamp()), 30 * 86400))

    series = queries.usage_series(db, 1, int(start.timestamp()), int(end.timestamp()), "month", "UTC")

    assert series["points"][0]["coverage"] == pytest.approx(30 / 31, abs=0.0001)


async def test_retention_keeps_recent(tmp_path, fixture_data):
    from astryon_agent.storage.repo import apply_retention

    col, db, t = make(tmp_path, fixture_data)
    await col.poll_status()
    await col.poll_history()
    out = apply_retention(db, 7, 400)
    assert out["history_samples"] == 0 and total(db) == 20


def test_bus_publish_from_worker_thread_wakes_subscriber():
    """O motor de alertas publica de dentro de `asyncio.to_thread`: o assinante precisa acordar na hora."""
    import asyncio

    async def main() -> str:
        bus = EventBus()
        q = bus.subscribe()
        await asyncio.to_thread(bus.publish, "alert", {"id": 1})
        msg = await asyncio.wait_for(q.get(), timeout=1.0)
        return msg.event

    assert asyncio.run(main()) == "alert"


def test_quality_ignores_seconds_without_loss_measurement(tmp_path):
    """Segundo sem `drop_rate` não é "0% de perda" nem "disponível": fica fora da perda e da disponibilidade."""
    from astryon_agent.storage.repo import _recompute_minute

    db = Database(tmp_path / "q.sqlite3")
    minute = (now_ts() // 60) * 60 - 120
    db.execute("INSERT INTO terminals (id, terminal_key, target, origin, first_seen, last_seen) VALUES (1,'k','x','grpc',?,?)",
               (minute, minute))
    for i in range(60):
        drop = 1.0 if i < 6 else (0.0 if i < 30 else None)  # 30 s medidos (6 em perda total) + 30 s sem medida
        db.execute("INSERT INTO history_samples VALUES (1,'b',?,?,?,30,1,1,NULL,'grpc')", (i, minute + i, drop))
    with db.tx() as c:
        _recompute_minute(c, 1, minute, "grpc", False)
    q = queries.quality(db, 1, minute, minute + 60, "America/Fortaleza")
    assert q["observed_seconds"] == 60
    assert q["loss_pct"] == pytest.approx(20.0)  # 6/30, não 6/60
    assert q["availability_pct"] == pytest.approx(80.0)  # 24/30, não 54/60
    tel = queries.telemetry(db, 1, minute, minute + 60, bucket_s=60)
    assert tel["points"][0]["drop_pct"] == pytest.approx(20.0)

    # Minuto inteiro sem medida de perda => sem número, não "100% disponível".
    db.execute("UPDATE history_samples SET drop_rate = NULL")
    with db.tx() as c:
        _recompute_minute(c, 1, minute, "grpc", False)
    q = queries.quality(db, 1, minute, minute + 60, "America/Fortaleza")
    assert q["loss_pct"] is None and q["availability_pct"] is None


def test_retention_prunes_logs_but_keeps_open_items(tmp_path):
    from astryon_agent.storage.repo import apply_retention

    db = Database(tmp_path / "r.sqlite3")
    now = now_ts()
    old, very_old = now - 120 * 86400, now - 500 * 86400
    db.execute("INSERT INTO esp32_nodes (id, device_id, name, secret_enc, created_at) VALUES (1,'d','n','s',?)", (now,))
    db.execute("INSERT INTO esp32_sensor_readings VALUES (1, 1, ?, ?, 'env.temp_c', 30, 'ok')", (old, old))
    db.execute("INSERT INTO esp32_sensor_readings VALUES (1, 2, ?, ?, 'env.temp_c', 31, 'ok')", (now, now))
    for sent, failed in ((old, None), (None, old), (None, None)):
        db.execute("INSERT INTO notification_outbox (channel, payload_json, created_at, next_attempt_at, sent_at, failed_at) "
                   "VALUES ('telegram', '{}', ?, ?, ?, ?)", (old, old, sent, failed))
    db.execute("""INSERT INTO alert_rules (id, name, kind, operator, threshold, min_duration_s, window_s, severity, cooldown_s,
                  hysteresis, enabled, created_at, updated_at) VALUES (1,'r','loss_high','gt',10,0,300,'warn',0,0.1,1,?,?)""",
               (now, now))
    db.execute("INSERT INTO alert_events (rule_id, status, severity, started_at, resolved_at, message) "
               "VALUES (1,'resolved','warn',?,?,'x')", (old, old))
    db.execute("INSERT INTO alert_events (rule_id, status, severity, started_at, message) VALUES (1,'active','warn',?,'y')",
               (very_old,))
    db.execute("INSERT INTO connection_events (kind, start_ts, end_ts, confidence) VALUES ('outage', ?, ?, 'derivado')",
               (very_old, very_old + 60))
    db.execute("INSERT INTO connection_events (kind, start_ts, confidence) VALUES ('unreachable', ?, 'derivado')", (very_old,))
    db.execute("INSERT INTO control_audit_logs (ts, actor, event) VALUES (?, 'admin', 'x')", (very_old,))

    out = apply_retention(db, 7, 400, sensor_days=30, log_days=90)

    assert out["esp32_readings"] == 1 and db.scalar("SELECT COUNT(*) FROM esp32_sensor_readings") == 1
    assert out["notifications"] == 2  # pendente fica
    assert db.scalar("SELECT COUNT(*) FROM notification_outbox WHERE sent_at IS NULL AND failed_at IS NULL") == 1
    assert db.scalar("SELECT status FROM alert_events") == "active"  # ativo nunca é apagado, por mais antigo que seja
    assert db.scalar("SELECT kind FROM connection_events") == "unreachable"  # evento em aberto fica
    assert out["control_audit"] == 1
