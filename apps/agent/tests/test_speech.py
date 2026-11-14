from __future__ import annotations

import httpx
import pytest

from orbitlink_agent.ai import copilot, speech
from orbitlink_agent.ai import telegram_bot as tb
from orbitlink_agent.storage.db import Database

from .test_telegram_bot import CHAT, FakeAI, FakeTelegram, _bot, _msg, _poll, _settings


@pytest.fixture
def db(tmp_path):
    d = Database(tmp_path / "voice.sqlite3")
    d.execute("INSERT INTO local_users (username, password_hash, role, created_at) VALUES ('admin', 'x', 'admin', 1)")
    return d


async def test_voice_reply_uploads_mp3_and_keeps_text(tmp_path, db, monkeypatch):
    tg = FakeTelegram([_msg("Como está?")])
    uploads = []

    def transport(request):
        if request.url.path.endswith("/sendVoice"):
            uploads.append(request)
            return httpx.Response(200, json={"ok": True, "result": {}})
        return tg(request)

    async def synthesize(self, text):
        assert text == "**Conexão observada.**"
        return b"fake-mp3-audio"

    monkeypatch.setattr(speech.Speaker, "synthesize", synthesize)
    bot = _bot(db, _settings(tmp_path, telegram_voice_replies=True), transport, FakeAI("**Conexão observada.**"))
    await _poll(bot)
    assert tg.texts == ["<b>Conexão observada.</b>"]
    assert len(uploads) == 1
    assert b"audio/mpeg" in uploads[0].content and b"fake-mp3-audio" in uploads[0].content
    assert str(CHAT).encode() in uploads[0].content


async def test_voice_preference_persists_and_unauthorized_chat_cannot_change_it(tmp_path, db):
    tg = FakeTelegram([_msg("/audio desligar"), _msg("/audio ligar", chat=999, uid=2), _msg("Oi", uid=3)])
    bot = _bot(db, _settings(tmp_path, telegram_voice_replies=True), tg, FakeAI("Olá"))
    await _poll(bot)
    assert db.get_kv(tb.KV_VOICE) == "off"
    assert tg.texts[-1] == "Olá"
    other = _bot(db, _settings(tmp_path, telegram_voice_replies=True), FakeTelegram())
    assert not other._voice_enabled()


async def test_speech_failure_keeps_answer_and_conversation(tmp_path, db, monkeypatch):
    async def fail(self, text):
        raise TimeoutError

    monkeypatch.setattr(speech.Speaker, "synthesize", fail)
    tg = FakeTelegram([_msg("Oi")])
    bot = _bot(db, _settings(tmp_path, telegram_voice_replies=True), tg, FakeAI("Resposta"))
    await _poll(bot)
    assert tg.texts[0] == "Resposta" and "Não consegui enviar a voz" in tg.texts[1]
    assert db.get_kv(tb.KV_CONVERSATION) and bot.state["answered"] == 1


def test_spoken_text_strips_markup_and_limits_long_answers():
    assert speech.spoken_text("## Olá\n**Tudo bem** [painel](https://example.com)", 100) == "Olá Tudo bem painel"
    assert "resposta completa" in speech.spoken_text("uma resposta longa " * 100, 100)
    assert "print" not in speech.spoken_text("```python\nprint('x')\n```", 200)


def test_model_receives_current_voice_preference(tmp_path, db):
    settings = _settings(tmp_path, telegram_voice_replies=True)
    assert "ATIVADAS" in copilot.telegram_voice_context(db, settings)
    db.set_kv(tb.KV_VOICE, "off")
    assert "DESATIVADAS" in copilot.telegram_voice_context(db, settings)
    assert "prevalece" in copilot.telegram_voice_context(db, settings)


async def test_audio_download_retries_timeout(tmp_path, db, monkeypatch):
    calls = 0

    async def no_sleep(seconds):
        pass

    monkeypatch.setattr(tb.asyncio, "sleep", no_sleep)

    def transport(request):
        nonlocal calls
        if request.url.path.endswith("/getFile"):
            return httpx.Response(200, json={"ok": True, "result": {"file_path": "voice/test.ogg"}})
        calls += 1
        assert request.extensions["timeout"]["read"] == 90
        if calls == 1:
            raise httpx.ReadTimeout("slow", request=request)
        return httpx.Response(200, content=b"audio")

    bot = _bot(db, _settings(tmp_path), transport)
    async with bot._client() as client:
        assert await bot._download_audio(client, {"file_id": "test"}, "audio/ogg") == b"audio"
    assert calls == 2
