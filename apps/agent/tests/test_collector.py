"""Coletor + persistência: idempotência, reinício, lacunas, consumo, eventos e offline."""

from __future__ import annotations

import copy

import pytest

from orbitlink_agent.collector.bus import EventBus
from orbitlink_agent.collector.service import Collector
from orbitlink_agent.config import Settings
from orbitlink_agent.starlink.transport import FixtureTransport
from orbitlink_agent.storage import queries
from orbitlink_agent.storage.db import Database, now_ts


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


async def test_retention_keeps_recent(tmp_path, fixture_data):
    from orbitlink_agent.storage.repo import apply_retention

    col, db, t = make(tmp_path, fixture_data)
    await col.poll_status()
    await col.poll_history()
    out = apply_retention(db, 7, 400)
    assert out["history_samples"] == 0 and total(db) == 20
