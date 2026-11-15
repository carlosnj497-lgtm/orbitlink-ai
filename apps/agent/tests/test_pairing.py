"""Pareamento com a conta na nuvem por código curto: troca, armazenamento protegido, erros e API."""

from __future__ import annotations

import json

import httpx
import pytest
from fastapi.testclient import TestClient

from astryon_agent.api.app import create_app
from astryon_agent.config import Settings
from astryon_agent.storage.db import Database
from astryon_agent.sync import pairing, worker

from .test_api import login
from .test_api import settings as api_settings

CLOUD = dict(supabase_url="https://exemplo.supabase.co", supabase_anon_key="anon-publica")
TOKEN = "olk_" + "a" * 64


def _s(tmp_path, **kw):
    return Settings(_env_file=None, data_dir=tmp_path, api_token="t", **{**CLOUD, **kw})


@pytest.fixture(autouse=True)
def _key(tmp_path, monkeypatch):
    monkeypatch.setenv("ASTRYON_SECRETS_KEY_FILE", str(tmp_path / "secrets.key"))


def _cloud(seen, status=200, body=None):
    def handler(req):
        seen.append(req)
        return httpx.Response(status, json=body if body is not None else {
            "agent_token": TOKEN, "agent_id": "x", "workspace_id": "w", "workspace_name": "Minha Starlink"})
    return httpx.MockTransport(handler)


async def test_claim_stores_token_protected_and_sync_uses_it(tmp_path):
    s = _s(tmp_path)
    db = Database(tmp_path / "p.sqlite3")
    assert pairing.info(db, s)["paired"] is False
    seen = []
    res = await pairing.claim(db, s, "k7qf 2m9x", "Mini do sítio", _cloud(seen))
    assert res["paired"] and res["workspace_name"] == "Minha Starlink" and res["agent_name"] == "Mini do sítio"
    body = json.loads(seen[0].content)
    assert seen[0].url.path == "/rest/v1/rpc/claim_pairing_code" and body["p_code"] == "k7qf 2m9x"
    assert seen[0].headers["apikey"] == "anon-publica"
    assert TOKEN not in db.get_kv(pairing.KV_TOKEN)  # guardado protegido, não em texto puro
    assert pairing.agent_token(db, s) == TOKEN

    sent = []

    def ingest(req):
        sent.append(json.loads(req.content))
        return httpx.Response(200, json={"ok": True})

    async with httpx.AsyncClient(transport=httpx.MockTransport(ingest)) as c:
        await worker.push_once(db, s, c, True)
    assert sent[0]["p_agent_token"] == TOKEN

    pairing.unpair(db)
    assert pairing.info(db, s)["paired"] is False


async def test_env_token_has_priority(tmp_path):
    s = _s(tmp_path, supabase_agent_token="olk_" + "b" * 64)
    db = Database(tmp_path / "p.sqlite3")
    assert pairing.agent_token(db, s).startswith("olk_bbbb")
    assert pairing.info(db, s)["via_env"] is True


@pytest.mark.parametrize(("status", "body", "msg"), [
    (400, {"message": "código inválido, expirado ou já usado"}, "inválido, expirado ou já usado"),
    (500, {"message": "boom"}, "HTTP 500"),
])
async def test_claim_errors_are_friendly(tmp_path, status, body, msg):
    with pytest.raises(pairing.PairingError, match=msg):
        await pairing.claim(Database(tmp_path / "p.sqlite3"), _s(tmp_path), "K7QF-2M9X", None, _cloud([], status, body))


async def test_claim_validates_input_and_config(tmp_path):
    db = Database(tmp_path / "p.sqlite3")
    with pytest.raises(pairing.PairingError, match="8 letras"):
        await pairing.claim(db, _s(tmp_path), "123", None, _cloud([]))
    with pytest.raises(pairing.PairingError, match="Nuvem não configurada"):
        await pairing.claim(db, Settings(_env_file=None, data_dir=tmp_path, api_token="t"), "K7QF-2M9X", None)


def test_pair_api(tmp_path, monkeypatch):
    async def fake_claim(db, settings, code, name=None, transport=None):
        if code != "K7QF-2M9X":
            raise pairing.PairingError("Código inválido, expirado ou já usado. Gere outro no painel da sua conta.")
        db.set_kv(pairing.KV_INFO, json.dumps({"workspace_name": "Minha Starlink"}))
        return {"paired": True, "workspace_name": "Minha Starlink"}

    monkeypatch.setattr(pairing, "claim", fake_claim)
    app = create_app(api_settings(tmp_path, **CLOUD, backup_enabled=False), start_collector=False)
    with TestClient(app) as c:
        h = login(c)
        assert c.get("/v1/sync", headers=h).json()["pairing"]["paired"] is False
        bad = c.post("/v1/sync/pair", headers=h, json={"code": "ZZZZ-ZZZZ"})
        assert bad.status_code == 400 and "Gere outro" in bad.json()["detail"]
        assert c.post("/v1/sync/pair", headers=h, json={"code": "K7QF-2M9X"}).json()["workspace_name"] == "Minha Starlink"
        assert c.delete("/v1/sync/pair", headers=h).json()["paired"] is False


def test_appliance_pairing_without_login(tmp_path, monkeypatch):
    async def fake_claim(db, settings, code, name=None, transport=None):
        db.set_kv(pairing.KV_TOKEN, "plain:" + TOKEN)
        db.set_kv(pairing.KV_INFO, json.dumps({"workspace_name": "Minha Starlink"}))
        return {"paired": True, "workspace_name": "Minha Starlink"}

    monkeypatch.setattr(pairing, "claim", fake_claim)
    svc = {"Authorization": "Bearer svc-token"}
    off = create_app(api_settings(tmp_path / "a", **CLOUD, backup_enabled=False), start_collector=False)
    with TestClient(off) as c:
        assert c.post("/v1/appliance/pair", headers=svc, json={"code": "K7QF-2M9X"}).status_code == 404  # fora do modo aparelho
    app = create_app(api_settings(tmp_path / "b", **CLOUD, appliance=True, backup_enabled=False), start_collector=False)
    with TestClient(app) as c:
        assert c.post("/v1/appliance/pair", json={"code": "K7QF-2M9X"}).status_code == 401  # ainda exige o token do painel
        assert c.get("/v1/appliance", headers=svc).json()["paired"] is False
        r = c.post("/v1/appliance/pair", headers=svc, json={"code": "K7QF-2M9X"})
        assert r.status_code == 200 and r.json()["workspace_name"] == "Minha Starlink"
        again = c.post("/v1/appliance/pair", headers=svc, json={"code": "ABCD-EFGH"})
        assert again.status_code == 409  # depois de pareado, a porta sem login fecha
