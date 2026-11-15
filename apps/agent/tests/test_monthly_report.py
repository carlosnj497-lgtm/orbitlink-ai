"""Relatório do ciclo em PDF: período, comparação, clima, agendamento e envio pelo Telegram."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import httpx
import pytest

from astryon_agent.ai import telegram_bot as tb
from astryon_agent.config import Settings
from astryon_agent.reports import builder, monthly
from astryon_agent.storage.db import Database
from astryon_agent.weather import service as weather

from .test_telegram_bot import CHAT, FakeAI, _bot, _msg, _poll

TOKEN = "123456789:AAH-segredo_do_bot"
TZ = ZoneInfo("America/Fortaleza")


def _settings(tmp_path, **kw):
    base = dict(_env_file=None, data_dir=tmp_path, api_token="t", telegram_bot_token=TOKEN, telegram_chat_id=str(CHAT),
                usage_cycle_start_day=5, telegram_voice_replies=False)
    base.update(kw)
    return Settings(**base)


@pytest.fixture
def db(tmp_path):
    d = Database(tmp_path / "m.sqlite3")
    d.execute("INSERT INTO local_users (username, password_hash, role, created_at) VALUES ('admin', 'x', 'admin', 0)")
    d.execute("INSERT INTO terminals (id, terminal_key, target, origin, first_seen, last_seen) VALUES (1,'k','x','grpc',0,0)")
    return d


def _minutes(db, start, n, drop=0.0):
    for i in range(n):
        ts = start + i * 60
        db.execute("INSERT INTO quality_minutes (terminal_id, minute_ts, samples, latency_samples, latency_avg, latency_max, "
                   "jitter_avg, drop_avg, drop_samples, full_drop_s, source) VALUES (1, ?, 60, 60, 30, 40, 2, ?, 60, 0, "
                   "'calculada')", (ts, drop))


def test_last_closed_cycle_uses_cycle_day():
    s, e = monthly.last_closed_cycle(datetime(2026, 11, 15, 10, tzinfo=TZ), 5)
    assert (s.day, s.month, e.day, e.month) == (5, 10, 5, 11)
    s, e = monthly.last_closed_cycle(datetime(2026, 11, 3, 10, tzinfo=TZ), 5)
    assert (s.month, e.month) == (9, 10)


def test_build_adds_comparison_and_weather(tmp_path, db, monkeypatch):
    s = _settings(tmp_path)
    cur = int(datetime(2026, 10, 5, tzinfo=TZ).timestamp())
    prev = int(datetime(2026, 9, 5, tzinfo=TZ).timestamp())
    _minutes(db, cur, 120, drop=0.01)
    _minutes(db, prev, 120, drop=0.03)
    weather.set_location(db, weather.Location("Quixadá", -4.97, -39.01))
    seen = {}

    def fake_pdf(*a, **k):
        seen.update(k)
        return b"%PDF-falso"

    monkeypatch.setattr(builder, "to_pdf", fake_pdf)
    pdf, caption = monthly.build(db, s, cur, cur + 30 * 86400, (prev, cur))
    assert pdf.startswith(b"%PDF") and "Relatório do ciclo 05/10" in caption
    heads = [h for h, _ in seen["sections"]]
    assert heads == ["Comparação com o ciclo anterior", "Clima no ciclo (estimativa regional)"]
    comp = " ".join(seen["sections"][0][1])
    assert "▼ 2,00 p.p. (melhor)" in comp  # perda caiu de 3% para 1%


def test_real_pdf_is_generated(tmp_path, db):
    s = _settings(tmp_path)
    start = int(datetime(2026, 10, 5, tzinfo=TZ).timestamp())
    _minutes(db, start, 30)
    pdf, _ = monthly.build(db, s, start, start + 86400, (start - 86400, start))
    assert pdf[:4] == b"%PDF" and len(pdf) > 1000


async def test_tick_sends_once_after_cycle_ends(tmp_path, db, monkeypatch):
    s = _settings(tmp_path)
    monkeypatch.setattr(builder, "to_pdf", lambda *a, **k: b"%PDF-falso")
    cycle_start = int(datetime(2026, 10, 5, tzinfo=TZ).timestamp())
    _minutes(db, cycle_start, 10)
    sent = []

    def handler(req):
        sent.append(req)
        return httpx.Response(200, json={"ok": True})

    t = httpx.MockTransport(handler)
    assert await monthly.tick(db, s, datetime(2026, 11, 5, 8, tzinfo=TZ), t) == "aguardando"  # antes das 9h
    assert await monthly.tick(db, s, datetime(2026, 11, 5, 9, 30, tzinfo=TZ), t) == "enviado"
    assert len(sent) == 1 and sent[0].url.path.endswith("/sendDocument")
    assert await monthly.tick(db, s, datetime(2026, 11, 5, 10, tzinfo=TZ), t) == "ja_enviado"
    assert await monthly.tick(db, _settings(tmp_path, monthly_report_enabled=False), datetime(2026, 12, 5, 10, tzinfo=TZ),
                              t) == "desativado"


async def test_tick_skips_cycle_without_data(tmp_path, db):
    s = _settings(tmp_path)
    t = httpx.MockTransport(lambda r: httpx.Response(200, json={"ok": True}))
    assert await monthly.tick(db, s, datetime(2026, 11, 5, 9, 30, tzinfo=TZ), t) == "sem_dados"


async def test_relatorio_command_sends_pdf(tmp_path, db, monkeypatch):
    monkeypatch.setattr(builder, "to_pdf", lambda *a, **k: b"%PDF-falso")
    docs = []

    class TG:
        sent: list = []

        def __call__(self, req):
            method = req.url.path.rsplit("/", 1)[-1]
            if method == "getUpdates":
                return httpx.Response(200, json={"ok": True, "result": [_msg("/relatorio")] if not self.sent else []})
            if method == "sendDocument":
                docs.append(req.content)
                return httpx.Response(200, json={"ok": True, "result": {}})
            self.sent.append(method)
            return httpx.Response(200, json={"ok": True, "result": {"message_id": 1}})

    tg = TG()
    await _poll(_bot(db, _settings(tmp_path), tg, FakeAI()))
    assert docs and b"astryon-relatorio-" in docs[0] and b"application/pdf" in docs[0]
    assert isinstance(tb.HELP, str) and "/relatorio" in tb.HELP
