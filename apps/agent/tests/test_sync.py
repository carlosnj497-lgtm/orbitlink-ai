"""Sincronização: coleta continua offline; ao voltar, envia a fila; reenvio é idempotente."""

from __future__ import annotations

import copy
import json

import httpx
import pytest

from astryon_agent.collector.bus import EventBus
from astryon_agent.collector.service import Collector
from astryon_agent.config import Settings
from astryon_agent.starlink.transport import FixtureTransport
from astryon_agent.storage.db import Database
from astryon_agent.sync import worker


@pytest.fixture
def env(tmp_path, fixture_data):
    s = Settings(_env_file=None, data_dir=tmp_path, api_token="t", supabase_url="https://exemplo.supabase.co",
                 supabase_anon_key="anon-publica", supabase_agent_token="olk_token_de_teste_1234567890")
    db = Database(tmp_path / "s.sqlite3")
    col = Collector(s, db, FixtureTransport.from_dict(copy.deepcopy(fixture_data)), EventBus())
    return s, db, col


async def test_offline_then_sync(env):
    s, db, col = env
    await col.poll_status()
    await col.poll_history()
    pending = db.scalar("SELECT COUNT(*) FROM sync_queue WHERE synced_at IS NULL")
    assert pending >= 1

    def offline(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("sem internet", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(offline)) as c:
        with pytest.raises(httpx.ConnectError):
            await worker.push_once(db, s, c, True)
    assert db.scalar("SELECT COUNT(*) FROM sync_queue WHERE synced_at IS NULL") == pending
    assert db.scalar("SELECT MAX(attempts) FROM sync_queue") == 1

    seen: list[dict] = []

    def online(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/rest/v1/rpc/ingest_batch"
        assert request.headers["apikey"] == "anon-publica"
        assert "service_role" not in request.headers.get("authorization", "")
        body = json.loads(request.content)
        seen.append(body)
        return httpx.Response(200, json={"ok": True})

    async with httpx.AsyncClient(transport=httpx.MockTransport(online)) as c:
        res = await worker.push_once(db, s, c, True)
    assert res["sent_usage"] == pending
    assert db.scalar("SELECT COUNT(*) FROM sync_queue WHERE synced_at IS NULL") == 0
    b = seen[0]["p_batch"]
    assert b["terminals"][0]["terminal_key"].startswith("ut-")
    assert "TESTE" not in json.dumps(b)  # ID bruto do terminal nunca sai do agente
    assert b["usage_minutes"][0]["source"] == "demonstracao"
    assert any(e["kind"] == "ping_drop" for e in b["events"])

    # novo poll que reescreve o mesmo minuto => item volta à fila com o valor recalculado (servidor faz upsert)
    t = col.transport
    t.responses["get_history"]["data"]["current"] = 46  # type: ignore[attr-defined]
    await col.poll_history()
    assert db.scalar("SELECT COUNT(*) FROM sync_queue WHERE synced_at IS NULL") >= 1


async def test_server_error_keeps_queue(env):
    s, db, col = env
    await col.poll_status()
    await col.poll_history()
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(500, text="erro"))) as c:
        with pytest.raises(RuntimeError):
            await worker.push_once(db, s, c, True)
    assert db.scalar("SELECT COUNT(*) FROM sync_queue WHERE synced_at IS NULL") >= 1
    assert "HTTP 500" in db.scalar("SELECT last_error FROM sync_queue LIMIT 1")


def _queue(db, n):
    from astryon_agent.storage.repo import enqueue_sync

    for i in range(n):
        enqueue_sync(db, "usage_minute", f"1:{i}", {"terminal_id": 1, "minute_ts": i * 60, "bytes_down": 1.0,
                                                    "bytes_up": 1.0, "samples": 60, "coverage": 1.0, "source": "grpc"})


async def test_minute_recalculated_during_send_stays_pending(env):
    s, db, _ = env
    _queue(db, 2)
    from astryon_agent.storage.repo import enqueue_sync

    def handler(request):
        # Enquanto o POST está em andamento, o minuto 0 é recalculado (mais amostras chegaram).
        enqueue_sync(db, "usage_minute", "1:0", {"terminal_id": 1, "minute_ts": 0, "bytes_down": 9.0, "bytes_up": 1.0,
                                                 "samples": 60, "coverage": 1.0, "source": "grpc"})
        return httpx.Response(200, json={"ok": True})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
        res = await worker.push_once(db, s, c, True)
    assert res["sent_usage"] == 2 and res["confirmed"] == 1
    left = db.query("SELECT record_key, payload_json FROM sync_queue WHERE synced_at IS NULL")
    assert [r["record_key"] for r in left] == ["1:0"] and '"bytes_down": 9.0' in left[0]["payload_json"]


async def test_rejected_item_is_isolated_and_leaves_the_queue(env):
    s, db, _ = env
    _queue(db, 4)
    db.execute("UPDATE sync_queue SET payload_json = replace(payload_json, '\"samples\": 60', '\"samples\": -1') "
               "WHERE record_key = '1:2'")

    def handler(request):
        bad = any(u["samples"] < 0 for u in json.loads(request.content)["p_batch"]["usage_minutes"])
        return httpx.Response(400 if bad else 200, json={"ok": not bad})

    limit = worker.BATCH
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
        for _ in range(30):
            if not db.scalar("SELECT COUNT(*) FROM sync_queue WHERE synced_at IS NULL AND attempts < ?",
                             (worker.MAX_ATTEMPTS,)):
                break
            try:
                await worker.push_once(db, s, c, True, limit)
                limit = worker.BATCH
            except worker.Rejected as exc:
                limit = max(1, exc.size // 2)
    rows = {r["record_key"]: r for r in db.query("SELECT record_key, synced_at, attempts, last_error FROM sync_queue")}
    assert all(rows[k]["synced_at"] for k in ("1:0", "1:1", "1:3"))  # os bons foram enviados
    assert rows["1:2"]["synced_at"] is None and rows["1:2"]["attempts"] >= worker.MAX_ATTEMPTS
    assert "HTTP 400" in rows["1:2"]["last_error"]


async def test_old_events_retry_and_concurrent_close(env):
    from astryon_agent.storage.db import now_ts
    s, db, _ = env
    start = now_ts() - 72 * 3600
    db.execute("INSERT INTO connection_events(kind, start_ts, confidence) VALUES ('unreachable', ?, 'derivado')", (start,))
    event_id = db.scalar("SELECT id FROM connection_events")

    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(503))) as c:
        with pytest.raises(RuntimeError):
            await worker.push_once(db, s, c, True)
    assert len(worker.event_snapshot(db)[0]) == 1

    def close_during_send(req):
        assert json.loads(req.content)["p_batch"]["events"][0]["end_ts"] is None
        db.execute("UPDATE connection_events SET end_ts = ?, duration_s = 60 WHERE id = ?", (start + 60, event_id))
        return httpx.Response(200, json={"ok": True})

    async with httpx.AsyncClient(transport=httpx.MockTransport(close_during_send)) as c:
        await worker.push_once(db, s, c, True)
    assert worker.event_snapshot(db)[0][0]["end_ts"] == start + 60
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={}))) as c:
        await worker.push_once(db, s, c, True)
    assert worker.event_snapshot(db)[0] == []


def test_event_backlog_paginates_and_survives_reopen(env):
    s, db, _ = env
    for i in range(1005):
        db.execute("INSERT INTO connection_events(kind, start_ts, end_ts, confidence) VALUES ('ping_drop', ?, ?, 'derivado')",
                   (i, i + 1))
    batch, sent = worker.event_snapshot(db)
    assert len(batch) == 1000
    worker.confirm_events(db, sent)
    reopened = Database(db.path)
    try:
        assert len(worker.event_snapshot(reopened)[0]) == 5
    finally:
        reopened.close()


def test_event_migration_backfills_existing_database(tmp_path):
    from pathlib import Path
    db = Database(tmp_path / "old.sqlite3")
    db.execute("DROP TRIGGER event_sync_insert")
    db.execute("DROP TRIGGER event_sync_update")
    db.execute("DROP TABLE event_sync")
    db.execute("DELETE FROM schema_migrations WHERE version = 11")
    db.execute("INSERT INTO connection_events(kind, start_ts, end_ts, confidence) VALUES ('ping_drop', 1, 2, 'derivado')")
    db.close()
    upgraded = Database(Path(tmp_path / "old.sqlite3"))
    try:
        assert len(worker.event_snapshot(upgraded)[0]) == 1
        assert upgraded.migrate() == []
    finally:
        upgraded.close()
