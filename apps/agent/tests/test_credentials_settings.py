"""API: persistência cifrada de credenciais no KV."""

from __future__ import annotations

from fastapi.testclient import TestClient

from astryon_agent.api.app import create_app
from astryon_agent.config import Settings

SVC = {"Authorization": "Bearer svc-token"}


def settings(tmp_path, **kw):
    base = dict(_env_file=None, data_dir=tmp_path, api_token="svc-token", status_interval_s=3600,
                history_interval_s=3600, obstruction_interval_s=3600, heartbeat_interval_s=3600,
                capability_refresh_s=3600)
    base.update(kw)
    return Settings(**base)


def login(client) -> dict[str, str]:
    r = client.post("/v1/auth/setup", json={"username": "admin", "password": "senha-forte-123"}, headers=SVC)
    assert r.status_code in (201, 409)
    r = client.post("/v1/auth/login", json={"username": "admin", "password": "senha-forte-123"}, headers=SVC)
    assert r.status_code == 200
    return {**SVC, "X-ASTRYON-Session": r.json()["session"]}


def test_save_credential_ciphertext_not_returned(tmp_path):
    app = create_app(settings(tmp_path), start_collector=False)
    with TestClient(app) as c:
        h = login(c)
        r = c.put("/v1/settings/credentials", json={"credentials": {"groq_api_key": "gk-test"}}, headers=h)
        assert r.status_code == 200
        data = r.json()
        assert data["secrets_configured"]["groq_api_key"] is True
        assert data["restart_required"] == []
        # O valor cifrado nunca deve aparecer na resposta.
        assert "gk-test" not in str(data)


def test_remove_and_reapply_credential(tmp_path):
    app = create_app(settings(tmp_path), start_collector=False)
    with TestClient(app) as c:
        h = login(c)
        c.put("/v1/settings/credentials", json={"credentials": {"groq_api_key": "gk-old"}}, headers=h)
        c.put("/v1/settings/credentials", json={"credentials": {"groq_api_key": ""}}, headers=h)
        r = c.get("/v1/settings", headers=h)
        assert r.json()["secrets_configured"]["groq_api_key"] is False


def test_restart_required_for_service_secrets(tmp_path):
    app = create_app(settings(tmp_path), start_collector=False)
    with TestClient(app) as c:
        h = login(c)
        r = c.put("/v1/settings/credentials", json={
            "credentials": {"telegram_bot_token": "tt", "groq_api_key": "gk"}
        }, headers=h)
        assert r.status_code == 200
        assert set(r.json()["restart_required"]) == {"telegram_bot_token"}


def test_unknown_field_rejected(tmp_path):
    app = create_app(settings(tmp_path), start_collector=False)
    with TestClient(app) as c:
        h = login(c)
        r = c.put("/v1/settings/credentials", json={"credentials": {"fake_secret": "x"}}, headers=h)
        assert r.status_code == 422
