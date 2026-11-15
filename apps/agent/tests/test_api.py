"""API: autenticação de serviço e usuário, status, telemetria e honestidade sem dados."""

from __future__ import annotations

import copy

import pytest
from fastapi.testclient import TestClient

from astryon_agent.api.app import create_app
from astryon_agent.config import Settings
from astryon_agent.starlink.transport import FixtureTransport, GrpcTransport

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


@pytest.fixture
def unreachable_client(tmp_path):
    app = create_app(settings(tmp_path), transport=GrpcTransport("127.0.0.1:1", connect_timeout=0.3))
    with TestClient(app) as c:
        yield c


@pytest.fixture
def fixture_client(tmp_path, fixture_data):
    app = create_app(settings(tmp_path), transport=FixtureTransport.from_dict(copy.deepcopy(fixture_data)))
    with TestClient(app) as c:
        yield c


def test_health_is_public(unreachable_client):
    assert unreachable_client.get("/v1/health").json()["status"] == "ok"


def test_service_token_required(unreachable_client):
    assert unreachable_client.get("/v1/status").status_code == 401
    assert unreachable_client.get("/v1/status", headers={"Authorization": "Bearer errado"}).status_code == 401
    assert unreachable_client.get("/v1/status", headers=SVC).status_code == 401  # falta sessão de usuário


def test_no_token_configured_is_503(tmp_path):
    app = create_app(settings(tmp_path, api_token=None), start_collector=False)
    with TestClient(app) as c:
        assert c.get("/v1/auth/state", headers=SVC).status_code == 503


def test_login_flow_and_bad_password(unreachable_client):
    c = unreachable_client
    assert c.get("/v1/auth/state", headers=SVC).json()["setup_required"] is True
    h = login(c)
    assert c.get("/v1/auth/state", headers=SVC).json()["setup_required"] is False
    assert c.post("/v1/auth/setup", json={"username": "x" * 5, "password": "y" * 12}, headers=SVC).status_code == 409
    r = c.post("/v1/auth/login", json={"username": "admin", "password": "errada-errada"}, headers=SVC)
    assert r.status_code == 401
    assert c.get("/v1/auth/me", headers=h).json()["username"] == "admin"
    c.post("/v1/auth/logout", headers=h)
    assert c.get("/v1/auth/me", headers=h).status_code == 401


def test_login_limit_counts_failures_not_successes(tmp_path):
    app = create_app(settings(tmp_path), start_collector=False)
    with TestClient(app) as c:
        login(c)
        ok = {"username": "admin", "password": "senha-forte-123"}
        for _ in range(8):  # vários aparelhos/abas: nunca bloqueia quem acerta a senha
            assert c.post("/v1/auth/login", json=ok, headers=SVC).status_code == 200
        bad = {"username": "admin", "password": "errada-errada"}
        assert [c.post("/v1/auth/login", json=bad, headers=SVC).status_code for _ in range(5)] == [401] * 5
        # 5 erros seguidos: bloqueia, inclusive a senha certa (o atacante não sabe se acertou)
        assert c.post("/v1/auth/login", json=bad, headers=SVC).status_code == 429
        assert c.post("/v1/auth/login", json=ok, headers=SVC).status_code == 429


def test_short_password_rejected(unreachable_client):
    r = unreachable_client.post("/v1/auth/setup", json={"username": "admin", "password": "curta"}, headers=SVC)
    assert r.status_code == 422


def test_unreachable_status_is_honest(unreachable_client):
    h = login(unreachable_client)
    import time

    for _ in range(40):
        st = unreachable_client.get("/v1/status", headers=h).json()
        if st.get("dish_reachable") is False:
            break
        time.sleep(0.1)
    assert st["available"] is False
    assert st["dish_reachable"] is False
    tel = unreachable_client.get("/v1/telemetry?range=1h", headers=h).json()
    assert tel["points"] == [] and tel["source"] == "indisponivel"
    usage = unreachable_client.get("/v1/usage/summary", headers=h).json()
    assert usage["today"]["bytes_total"] == 0 and usage["today"]["source"] == "indisponivel"


def test_fixture_status_and_data(fixture_client):
    import time

    h = login(fixture_client)
    for _ in range(50):
        st = fixture_client.get("/v1/status", headers=h).json()
        if st.get("available"):
            break
        time.sleep(0.1)
    assert st["available"] and st["status"]["metrics"]["downlink_mbps"]["source"] == "demonstracao"
    caps = fixture_client.get("/v1/capabilities", headers=h).json()["capabilities"]
    assert any(c["key"] == "dish.reboot" and c["status"] == "schema_presente" for c in caps)
    agent = fixture_client.get("/v1/agent", headers=h).json()
    assert agent["mode"] == "fixture"


def test_range_validation(fixture_client):
    h = login(fixture_client)
    assert fixture_client.get("/v1/telemetry?range=2y", headers=h).status_code == 422
    assert fixture_client.get("/v1/telemetry?start=100&end=50", headers=h).status_code == 422


def test_openapi_available(unreachable_client):
    spec = unreachable_client.get("/openapi.json").json()
    assert "/v1/status" in spec["paths"]


def test_setup_code_required_when_configured(tmp_path):
    app = create_app(settings(tmp_path, setup_code="codigo-do-servidor"), start_collector=False)
    with TestClient(app) as c:
        assert c.get("/v1/auth/state", headers=SVC).json()["setup_code_required"] is True
        body = {"username": "admin", "password": "senha-forte-123"}
        assert c.post("/v1/auth/setup", json=body, headers=SVC).status_code == 403
        assert c.post("/v1/auth/setup", json={**body, "setup_code": "errado"}, headers=SVC).status_code == 403
        assert c.post("/v1/auth/setup", json={**body, "setup_code": "codigo-do-servidor"}, headers=SVC).status_code == 201
