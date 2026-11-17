"""Ajustes da Central de IA pelo painel e teste de conexão com a Groq."""

from __future__ import annotations

import httpx
from fastapi.testclient import TestClient

from astryon_agent.api.app import create_app
from astryon_agent.config import Settings


def _settings(tmp_path, **kw):
    base = dict(_env_file=None, data_dir=tmp_path, api_token="svc-token", timezone="America/Fortaleza")
    base.update(kw)
    return Settings(**base)


def _login(c: TestClient) -> dict[str, str]:
    svc = {"Authorization": "Bearer svc-token"}
    c.post("/v1/auth/setup", json={"username": "admin", "password": "senha-forte-123"}, headers=svc)
    r = c.post("/v1/auth/login", json={"username": "admin", "password": "senha-forte-123"}, headers=svc)
    return {**svc, "X-ASTRYON-Session": r.json()["session"]}


def test_ai_settings_apply_now_and_survive_restart(tmp_path):
    with TestClient(create_app(_settings(tmp_path), start_collector=False)) as c:
        h = _login(c)
        r = c.put("/v1/settings", headers=h, json={"ai_daily_request_limit": 25, "ai_conversation_retention_days": 7,
                                                   "ai_audio_daily_request_limit": 5, "ai_transcribe_enabled": False})
        assert r.status_code == 200
        st = c.get("/v1/ai/status", headers=h).json()
        assert (st["daily_limit"], st["retention_days"], st["audio"]["daily_limit"]) == (25, 7, 5)
        assert c.put("/v1/settings", headers=h, json={"ai_daily_request_limit": 0}).status_code == 422
        assert c.put("/v1/settings", headers=h, json={"ai_audio_daily_request_limit": 501}).status_code == 422
    with TestClient(create_app(_settings(tmp_path), start_collector=False)) as c:
        s = c.app.state.ctx.settings
        assert (s.ai_daily_request_limit, s.ai_conversation_retention_days, s.ai_audio_daily_request_limit) == (25, 7, 5)
        assert s.ai_transcribe_enabled is False


def test_groq_test_without_key(tmp_path):
    with TestClient(create_app(_settings(tmp_path), start_collector=False)) as c:
        r = c.post("/v1/ai/test", headers=_login(c)).json()
        assert r["ok"] is False and "Nenhuma chave" in r["detail"]


def _with_transport(tmp_path, handler, **kw):
    app = create_app(_settings(tmp_path, groq_api_key="gsk_teste", **kw), start_collector=False)
    c = TestClient(app)
    c.__enter__()
    app.state.ctx.extras["groq_test_transport"] = httpx.MockTransport(handler)
    return c


def test_groq_test_ok_and_model_missing(tmp_path):
    seen: list[str] = []

    def ok(req: httpx.Request) -> httpx.Response:
        seen.append(req.headers["authorization"])
        return httpx.Response(200, json={"data": [{"id": "openai/gpt-oss-120b"}]})

    c = _with_transport(tmp_path, ok)
    try:
        r = c.post("/v1/ai/test", headers=_login(c)).json()
        assert r["ok"] is True and r["model_available"] is True and r["latency_ms"] is not None
        assert seen == ["Bearer gsk_teste"]
    finally:
        c.__exit__(None, None, None)

    c = _with_transport(tmp_path / "b", ok, ai_model="outro/modelo")
    try:
        r = c.post("/v1/ai/test", headers=_login(c)).json()
        assert r["ok"] is False and r["model_available"] is False and "outro/modelo" in r["detail"]
    finally:
        c.__exit__(None, None, None)


def test_groq_test_bad_key(tmp_path):
    c = _with_transport(tmp_path, lambda req: httpx.Response(401, json={"error": "invalid"}))
    try:
        r = c.post("/v1/ai/test", headers=_login(c)).json()
        assert r["ok"] is False and "recusou a chave" in r["detail"]
    finally:
        c.__exit__(None, None, None)
