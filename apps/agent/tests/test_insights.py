"""Comparação de períodos, perda com e sem chuva e melhores horários."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from astryon_agent.ai import telegram_views as views
from astryon_agent.config import Settings
from astryon_agent.reports import insights
from astryon_agent.storage.db import Database
from astryon_agent.weather import service as weather

TZ = ZoneInfo("America/Fortaleza")
H = 3600


@pytest.fixture
def db(tmp_path):
    d = Database(tmp_path / "i.sqlite3")
    d.execute("INSERT INTO terminals (id, terminal_key, target, origin, first_seen, last_seen) VALUES (1,'k','x','grpc',0,0)")
    return d


def _s(tmp_path):
    return Settings(_env_file=None, data_dir=tmp_path, api_token="t")


def _minute(db, ts, drop, lat=30.0):
    db.execute("INSERT INTO quality_minutes (terminal_id, minute_ts, samples, latency_samples, latency_avg, latency_max, "
               "jitter_avg, drop_avg, drop_samples, full_drop_s, source) VALUES (1, ?, 60, 60, ?, ?, 2, ?, 60, 0, 'calculada')",
               (ts, lat, lat, drop))


def test_compare_current_vs_previous_and_rain_split(tmp_path, db):
    s = _s(tmp_path)
    end = int(datetime(2026, 11, 15, tzinfo=TZ).timestamp())
    start = end - 7 * 86400
    for i in range(60):
        _minute(db, start + i * 60, 0.05 if i < 30 else 0.01)  # atual: 30 min chuvosos com 5% de perda
        _minute(db, start - 86400 + i * 60, 0.03)  # anterior: 3% o tempo todo
    weather.set_location(db, weather.Location("Quixadá", -4.97, -39.01))
    rows = [{"hour_ts": (start // H) * H, "temperature_c": 24.0, "precipitation_mm": 12.0, "rain_mm": 12.0,
             "cloud_cover_pct": 90.0, "wind_kmh": 10.0, "gust_kmh": 20.0, "weather_code": 63, "is_forecast": 0}]
    weather.store(db, rows, None, end)
    out = insights.compare(db, s, start, end)
    assert out["current"]["loss_pct"] == pytest.approx(3.0) and out["previous"]["loss_pct"] == pytest.approx(3.0)
    assert out["rain"]["chuva"]["loss_pct"] == pytest.approx(3.0)  # a hora com chuva tem todos os 60 min
    assert out["rain"]["sem_chuva"]["observed_seconds"] == 0


def test_compare_without_weather_has_no_rain_split(tmp_path, db):
    end = int(datetime(2026, 11, 15, tzinfo=TZ).timestamp())
    _minute(db, end - 600, 0.0)
    out = insights.compare(db, _s(tmp_path), end - 86400, end)
    assert out["rain"] is None and out["weather_configured"] is False


def test_best_hours_rank_and_skip_rainy_forecast(tmp_path, db):
    s = _s(tmp_path)
    now = int(datetime(2026, 11, 15, 12, tzinfo=TZ).timestamp())
    for day in range(1, 4):
        for hour in range(24):
            base = int(datetime(2026, 11, 15 - day, hour, tzinfo=TZ).timestamp())
            drop = 0.001 if hour in (3, 4, 5) else (0.08 if hour in (19, 20, 21) else 0.02)
            for m in range(0, 60, 1):
                _minute(db, base + m * 60, drop)
    b = insights.best_hours(db, s, days=7, now=now)
    assert b["enough_data"] and [h["hour"] for h in b["best"]] == [3, 4, 5]
    assert {h["hour"] for h in b["worst"]} == {19, 20, 21}
    assert b["next_good"] and all(x["hour"] in range(24) for x in b["next_good"])

    text = views.render(db, s, "horario")
    assert "Melhores horários" in text and "03h" in text


def test_best_hours_needs_enough_data(tmp_path, db):
    b = insights.best_hours(db, _s(tmp_path))
    assert b["enough_data"] is False
    assert "Ainda não há observação suficiente" in views.render(db, _s(tmp_path), "horario")
