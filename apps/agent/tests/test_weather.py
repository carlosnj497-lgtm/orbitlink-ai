"""Clima (Open-Meteo): parse sem inventar zeros, gravação idempotente, estado, falhas e rotas."""

from __future__ import annotations

import asyncio

import httpx
import pytest
from fastapi.testclient import TestClient

from astryon_agent.api.app import create_app
from astryon_agent.config import Settings
from astryon_agent.storage.db import Database, now_ts
from astryon_agent.weather import service as weather

from .test_api import login
from .test_api import settings as api_settings


def _settings(tmp_path, **kw):
    return Settings(_env_file=None, data_dir=tmp_path, api_token="t", **kw)


def _payload(base: int) -> dict:
    hours = [base - 7200, base - 3600, base, base + 3600]
    return {
        "hourly": {
            "time": hours,
            "temperature_2m": [24.0, 23.5, None, 22.0],
            "precipitation": [0.0, 12.4, 0.3, 1.0],
            "rain": [0.0, 12.4, 0.3, 1.0],
            "cloud_cover": [20, 100, 90, 80],
            "wind_speed_10m": [8.0, 30.5, 12.0, 10.0],
            "wind_gusts_10m": [15.0, 62.0, 20.0, 18.0],
            "weather_code": [1, 95, 61, 61],
        },
        "current": {"time": base, "temperature_2m": 23.1, "precipitation": 0.3, "rain": 0.3, "cloud_cover": 90,
                    "wind_speed_10m": 12.0, "wind_gusts_10m": 20.0, "weather_code": 61, "is_day": 1},
    }


@pytest.mark.parametrize(("mm", "level"), [(None, None), (0.0, "sem_chuva"), (0.5, "fraca"), (5, "moderada"),
                                            (12.4, "forte"), (60, "muito_forte")])
def test_rain_level(mm, level):
    assert weather.rain_level(mm) == level


def test_parse_keeps_missing_values_as_none():
    base = (now_ts() // 3600) * 3600
    rows, current = weather.parse(_payload(base), base)
    assert len(rows) == 4
    assert rows[2]["temperature_c"] is None  # ausente continua ausente
    assert rows[1]["precipitation_mm"] == 12.4 and rows[1]["weather_code"] == 95
    assert [r["is_forecast"] for r in rows] == [0, 0, 0, 1]
    assert current and current["is_day"] is True and current["weather_code"] == 61


def test_refresh_stores_and_status(tmp_path):
    db = Database(tmp_path / "w.sqlite3")
    s = _settings(tmp_path)
    assert asyncio.run(weather.refresh(db, s)) is False  # sem localização, nada é buscado
    assert weather.status(db, s)["configured"] is False

    base = (now_ts() // 3600) * 3600
    seen = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen.update(dict(req.url.params))
        return httpx.Response(200, json=_payload(base))

    weather.set_location(db, weather.Location("Fortaleza, Ceará, Brasil", -3.731862, -38.526669))
    assert asyncio.run(weather.refresh(db, s, httpx.MockTransport(handler))) is True
    assert seen["latitude"] == "-3.73" and seen["longitude"] == "-38.53"  # só ~1 km de precisão sai daqui
    # rodar de novo não duplica horas
    assert asyncio.run(weather.refresh(db, s, httpx.MockTransport(handler))) is True
    assert db.scalar("SELECT COUNT(*) FROM weather_hourly") == 4

    st = weather.status(db, s)
    assert st["configured"] and st["location"]["name"].startswith("Fortaleza")
    assert st["current"]["rain_level"] == "fraca" and st["current"]["stale"] is False
    assert st["source"] == "estimada" and st["last_error"] is None

    hours = weather.hourly(db, base - 7200, base + 7200)
    assert [h["rain_level"] for h in hours] == ["sem_chuva", "forte", "fraca", "fraca"]
    assert hours[-1]["is_forecast"] is True

    weather.set_location(db, None)
    assert db.scalar("SELECT COUNT(*) FROM weather_hourly") == 0
    assert weather.status(db, s)["current"] is None


def test_refresh_failure_is_recorded_not_raised(tmp_path):
    db = Database(tmp_path / "w.sqlite3")
    s = _settings(tmp_path, weather_latitude=-3.7, weather_longitude=-38.5)
    ok = asyncio.run(weather.refresh(db, s, httpx.MockTransport(lambda r: httpx.Response(503))))
    assert ok is False
    st = weather.status(db, s)
    assert st["configured"] and st["location"]["name"] == "Local configurado"
    assert "HTTPStatusError" in st["last_error"] and st["current"] is None


def test_geocode_formats_results():
    def handler(req: httpx.Request) -> httpx.Response:
        assert req.url.params["name"] == "Fortaleza"
        return httpx.Response(200, json={"results": [
            {"name": "Fortaleza", "admin1": "Ceará", "country": "Brasil", "latitude": -3.71, "longitude": -38.54},
            {"name": "sem coordenadas"},
        ]})

    out = asyncio.run(weather.geocode("Fortaleza", httpx.MockTransport(handler)))
    assert out == [{"name": "Fortaleza, Ceará, Brasil", "latitude": -3.71, "longitude": -38.54}]


def test_weather_routes(tmp_path, monkeypatch):
    base = (now_ts() // 3600) * 3600

    async def fake_fetch(loc, transport=None):
        return _payload(base)

    monkeypatch.setattr(weather, "fetch", fake_fetch)
    app = create_app(api_settings(tmp_path), start_collector=False)
    with TestClient(app) as c:
        h = login(c)
        assert c.get("/v1/weather", headers=h).json()["configured"] is False
        r = c.put("/v1/weather/location", headers=h, json={"name": "Fortaleza", "latitude": -3.7, "longitude": -38.5})
        assert r.status_code == 200 and r.json()["current"]["temperature_c"] == 23.1
        hours = c.get("/v1/weather/hourly?range=24h", headers=h).json()["hours"]
        assert any(x["rain_level"] == "forte" for x in hours)
        assert c.put("/v1/weather/location", headers=h, json={"name": "x", "latitude": 99, "longitude": 0}).status_code == 422
        assert c.delete("/v1/weather/location", headers=h).json()["configured"] is False
