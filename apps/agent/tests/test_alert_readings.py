"""A lista de regras traz a última leitura de cada regra ativa (valor atual x limite no painel)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from astryon_agent.api.app import create_app
from astryon_agent.config import Settings


def _login(c: TestClient) -> dict[str, str]:
    svc = {"Authorization": "Bearer svc-token"}
    c.post("/v1/auth/setup", json={"username": "admin", "password": "senha-forte-123"}, headers=svc)
    r = c.post("/v1/auth/login", json={"username": "admin", "password": "senha-forte-123"}, headers=svc)
    return {**svc, "X-ASTRYON-Session": r.json()["session"]}


def test_rules_carry_latest_reading(tmp_path):
    s = Settings(_env_file=None, data_dir=tmp_path, api_token="svc-token", timezone="America/Fortaleza")
    with TestClient(create_app(s, start_collector=False)) as c:
        h = _login(c)
        rules = c.get("/v1/alerts/rules", headers=h).json()["rules"]
        assert rules and all("current" in r and "breaching_since" in r for r in rules)
        engine = c.app.state.ctx.extras["alerts_engine"]
        engine.evaluate()
        rules = c.get("/v1/alerts/rules", headers=h).json()["rules"]
        drops = next(r for r in rules if r["kind"] == "multiple_drops" and r["enabled"])
        assert drops["current"]["value"] == 0.0 and drops["current"]["measured_at"] > 0
        # sem amostras de histórico, a latência não tem leitura: o painel mostra "sem leitura", nunca zero
        lat = next((r for r in rules if r["kind"] == "latency_high" and r["enabled"]), None)
        if lat:
            assert lat["current"]["value"] is None
        off = c.put(f"/v1/alerts/rules/{drops['id']}", headers=h, json={**{k: drops[k] for k in (
            "name", "kind", "threshold", "min_duration_s", "window_s", "severity", "cooldown_s", "hysteresis")}, "enabled": False})
        assert off.status_code == 200
        again = next(r for r in c.get("/v1/alerts/rules", headers=h).json()["rules"] if r["id"] == drops["id"])
        assert again["current"] is None
