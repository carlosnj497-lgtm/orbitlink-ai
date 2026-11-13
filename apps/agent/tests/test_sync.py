"""Sincronização: coleta continua offline; ao voltar, envia a fila; reenvio é idempotente."""

from __future__ import annotations

import copy
import json

import httpx
import pytest

from orbitlink_agent.collector.bus import EventBus
from orbitlink_agent.collector.service import Collector
from orbitlink_agent.config import Settings
from orbitlink_agent.starlink.transport import FixtureTransport
from orbitlink_agent.storage.db import Database
from orbitlink_agent.sync import worker


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
