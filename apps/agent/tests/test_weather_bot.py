"""Clima no bot, nos alertas e na IA: /clima, quedas com clima, aviso de chuva forte prevista e get_weather."""

from __future__ import annotations

import pytest

from orbitlink_agent.ai import telegram_views as views
from orbitlink_agent.ai.copilot import TOOLS, Toolbox
from orbitlink_agent.alerts.engine import AlertEngine, seed_defaults
from orbitlink_agent.collector.bus import EventBus
from orbitlink_agent.storage.db import Database, now_ts
from orbitlink_agent.weather import service as weather

from .test_telegram_bot import CHAT, FakeAI, FakeTelegram, _bot, _msg, _poll, _settings

H = 3600


@pytest.fixture
def db(tmp_path):
    d = Database(tmp_path / "o.sqlite3")
    d.execute("INSERT INTO local_users (username, password_hash, role, created_at) VALUES ('admin', 'x', 'admin', ?)",
              (now_ts(),))
    return d


def _hour(ts, mm, code=61, gust=20.0, forecast=False):
    return {"hour_ts": ts, "temperature_c": 24.0, "precipitation_mm": mm, "rain_mm": mm, "cloud_cover_pct": 90.0,
            "wind_kmh": 12.0, "gust_kmh": gust, "weather_code": code, "is_forecast": int(forecast)}


def _seed(db, *, forecast_mm=0.0, past_mm=14.0):
    """Cidade definida, chuva forte há 2 h, previsão para daqui a 2 h e leitura atual."""
    now = now_ts()
    base = (now // H) * H
    weather.set_location(db, weather.Location("Quixadá, Ceará, Brasil", -4.97, -39.01))
    rows = [_hour(base - 2 * H, past_mm, code=95, gust=70.0), _hour(base - H, 0.0, code=2), _hour(base, 0.2),
            _hour(base + H, 1.0, forecast=True), _hour(base + 2 * H, forecast_mm, forecast=True)]
    current = {"ts": now, "temperature_c": 26.4, "precipitation_mm": 0.2, "rain_mm": 0.2, "cloud_cover_pct": 80.0,
               "wind_kmh": 15.0, "gust_kmh": 25.0, "weather_code": 61, "is_day": True}
    weather.store(db, rows, current, now)
    return base


# ----------------------------------------------------------------- /clima
def test_clima_without_city_explains_how_to_enable(tmp_path, db):
    text = views.render(db, _settings(tmp_path), "clima")
    assert "Nenhuma cidade definida" in text and "Configurações → Clima" in text


def test_clima_shows_now_next_hours_and_strong_rain_warning(tmp_path, db):
    _seed(db, forecast_mm=12.0)
    text = views.render(db, _settings(tmp_path), "clima")
    assert "Quixadá" in text and "26 °C" in text and "chuva fraca" in text
    assert "Próximas horas" in text and "12,0 mm/h" in text
    assert "Chuva forte prevista" in text and "não um sensor no local" in text


async def test_clima_command_and_menu_button(tmp_path, db):
    _seed(db)
    tg, ai = FakeTelegram([_msg("/clima"), _msg("/menu", uid=2)]), FakeAI()
    await _poll(_bot(db, _settings(tmp_path), tg, ai))
    assert "Quixadá" in tg.texts[0] and ai.calls == []
    buttons = [b["callback_data"] for row in tg.sent[1]["reply_markup"]["inline_keyboard"] for b in row]
    assert "ol:clima" in buttons
    assert "/clima" in tg.texts[1]  # na ajuda


# ----------------------------------------------------------------- /quedas e /bot
def test_outages_use_readable_labels_and_weather_note(tmp_path, db):
    base = _seed(db)
    db.execute("INSERT INTO connection_events (kind, start_ts, end_ts, duration_s, confidence) "
               "VALUES ('status_outage', ?, ?, 42, 'confirmado')", (base - 2 * H + 600, base - 2 * H + 642))
    db.execute("INSERT INTO connection_events (kind, start_ts, end_ts, duration_s, confidence) "
               "VALUES ('boot', ?, ?, 95, 'confirmado')", (base - H + 60, base - H + 155))
    text = views.render(db, _settings(tmp_path), "quedas")
    assert "Antena reportou indisponibilidade" in text and "Reinício da antena" in text
    assert "status_outage" not in text
    assert "🌧 chuva forte (14,0 mm/h) · trovoada · rajadas de 70 km/h" in text
    assert "Coincidência, não prova de causa" in text


def test_bot_card_shows_weather_city(tmp_path, db):
    s = _settings(tmp_path)
    assert "sem cidade" in views.render(db, s, "bot")
    _seed(db)
    assert "Clima: Quixadá" in views.render(db, s, "bot")


# ----------------------------------------------------------------- alerta de chuva prevista
def test_strong_rain_forecast_alert_notifies_once_and_resolves(tmp_path, db):
    s = _settings(tmp_path, alert_webhook_url="https://exemplo.invalid/hook")
    seed_defaults(db)
    rule = db.one("SELECT * FROM alert_rules WHERE kind = 'weather_rain_forecast'")
    assert rule and rule["threshold"] == 7.6 and rule["window_s"] == 3 * H
    from orbitlink_agent.alerts.notify import Notifier

    eng = AlertEngine(db, EventBus(), None, s.timezone, s, Notifier(db, s))
    assert eng.evaluate() == []  # sem cidade: sem dado, nada dispara

    base = _seed(db, forecast_mm=12.0)
    fired = [e for e in eng.evaluate() if e["rule_id"] == rule["id"]]
    assert len(fired) == 1 and "Chuva forte prevista para" in fired[0]["message"]
    assert "12,0 mm/h" in fired[0]["message"] and "não é certeza" in fired[0]["message"]
    assert eng.evaluate() == []  # ativo: não repete

    weather.store(db, [_hour(base + 2 * H, 0.0, forecast=True)], None, now_ts())
    eng.evaluate()
    last = db.one("SELECT status FROM alert_events WHERE rule_id = ?", (rule["id"],))
    assert last["status"] == "resolved"
    msgs = [r["payload_json"] for r in db.query("SELECT payload_json FROM notification_outbox ORDER BY id")]
    assert any("não indica mais chuva forte" in m for m in msgs)


def test_old_forecast_does_not_trigger(db):
    base = (now_ts() // H) * H
    weather.store(db, [_hour(base + H, 20.0, forecast=True)], None, now_ts() - 5 * H)
    assert weather.forecast_max_mm(db, 3 * H) is None


def test_seed_adds_weather_rule_once_even_if_deleted(db):
    seed_defaults(db)
    db.execute("DELETE FROM alert_rules WHERE kind = 'weather_rain_forecast'")
    seed_defaults(db)
    assert db.scalar("SELECT COUNT(*) FROM alert_rules WHERE kind = 'weather_rain_forecast'") == 0


# ----------------------------------------------------------------- IA
def test_ai_weather_tool(tmp_path, db):
    assert any(t["function"]["name"] == "get_weather" for t in TOOLS)
    s = _settings(tmp_path)
    box = Toolbox(db, s, None)
    assert box.run("get_weather", {"range": "24h"})["configurado"] is False
    base = _seed(db)
    db.execute("INSERT INTO connection_events (kind, start_ts, end_ts, duration_s, confidence) "
               "VALUES ('ping_drop', ?, ?, 6, 'derivado')", (base - 2 * H + 300, base - 2 * H + 306))
    out = box.run("get_weather", {"range": "24h"})
    assert out["local"].startswith("Quixadá") and out["fonte"] == "estimada"
    assert out["periodo"]["horas_com_chuva_relevante"] == 1
    assert out["periodo"]["eventos_com_chuva_ou_tempestade"][0]["clima"].startswith("chuva forte")
    assert "não prova" in out["periodo"]["aviso"]


def test_unauthorized_chat_cannot_read_weather(tmp_path, db):
    _seed(db)
    tg = FakeTelegram([_msg("/clima", chat=CHAT + 1)])
    import asyncio

    asyncio.run(_poll(_bot(db, _settings(tmp_path), tg, FakeAI())))
    assert tg.sent == []


async def test_startup_updates_every_command_menu(tmp_path, db, monkeypatch):
    """O menu "pt" publicado pelo telegram_setup também precisa receber comandos novos (ex.: /clima)."""
    import asyncio

    tg = FakeTelegram()
    bot = _bot(db, _settings(tmp_path), tg, FakeAI())

    async def stop(_client):
        raise asyncio.CancelledError

    monkeypatch.setattr(bot, "poll_once", stop)
    with pytest.raises(asyncio.CancelledError):
        await bot.run()
    regs = [a for a in tg.actions if a["method"] == "setMyCommands"]
    assert {(a["scope"]["type"], a["language_code"]) for a in regs} == {
        ("default", ""), ("default", "pt"), ("chat", ""), ("chat", "pt")}
    assert all(any(c["command"] == "clima" for c in a["commands"]) for a in regs)
