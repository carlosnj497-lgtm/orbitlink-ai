"""Reconhecimento de áudio (nota de voz) no bot do Telegram.

Cobre: transcrição via Groq, o texto transcrito virando pergunta normal, o áudio não ser salvo,
os limites (cota diária, tamanho, chat não autorizado) e a ausência de ação executada.
"""

from __future__ import annotations

import json

import httpx
import pytest

from orbitlink_agent.ai import telegram_bot as tb
from orbitlink_agent.ai import transcribe
from orbitlink_agent.config import Settings
from orbitlink_agent.storage.db import Database, now_ts

TOKEN = "123456789:AAH-segredo_do_bot"
CHAT = 8560810900
AUDIO = b"OPUS-SIMULADO"


def _settings(tmp_path, **kw):
    base = dict(_env_file=None, data_dir=tmp_path, api_token="svc-token", telegram_bot_token=TOKEN,
                telegram_chat_id=str(CHAT), groq_api_key="gsk_teste")
    base.update(kw)
    base.setdefault("telegram_voice_replies", False)
    return Settings(**base)


class FakeTelegram:
    """Bot API falsa: entrega atualizações e serve o arquivo de áudio."""

    def __init__(self, updates=(), file_size=len(AUDIO)):
        self.updates = list(updates)
        self.sent: list[dict] = []
        self.actions: list[dict] = []
        self.file_size = file_size
        self.downloads = 0

    def __call__(self, req: httpx.Request) -> httpx.Response:
        assert TOKEN in str(req.url)
        # O download do arquivo vive em /file/bot<token>/<caminho> (não é um método da Bot API).
        if "/file/bot" in req.url.path:
            self.downloads += 1
            return httpx.Response(200, content=AUDIO)
        method = req.url.path.rsplit("/", 1)[-1]
        body = dict(req.url.params) if req.method == "GET" else json_body(req)
        if method == "getUpdates":
            ups = [u for u in self.updates if u["update_id"] >= body.get("offset", 0)]
            self.updates = []
            return httpx.Response(200, json={"ok": True, "result": ups})
        if method == "getFile":
            return httpx.Response(200, json={"ok": True, "result": {
                "file_id": body["file_id"], "file_path": "voice/file_1.oga", "file_size": self.file_size}})
        if method == "sendChatAction":
            self.actions.append(body)
            return httpx.Response(200, json={"ok": True, "result": True})
        if method == "sendMessage":
            self.sent.append(body)
            return httpx.Response(200, json={"ok": True, "result": {"message_id": len(self.sent)}})
        return httpx.Response(404, json={"ok": False, "description": "Not Found"})

    @property
    def texts(self) -> list[str]:
        return [m["text"] for m in self.sent]


def json_body(req: httpx.Request) -> dict:
    try:
        return json.loads(req.content or b"{}")
    except ValueError:
        return {}


class FakeGroqAudio:
    """Endpoint de transcrição da Groq falso."""

    def __init__(self, text="Como está a conexão agora?", fail=False, http_status=200):
        self.text = text
        self.fail = fail
        self.http_status = http_status
        self.calls: list[httpx.Request] = []

    def __call__(self, req: httpx.Request) -> httpx.Response:
        self.calls.append(req)
        if self.fail:
            return httpx.Response(500, json={"error": "boom"})
        if self.http_status >= 400:
            return httpx.Response(self.http_status, json={"error": "boom"})
        return httpx.Response(200, json={"text": self.text})


class FakeAI:
    def __init__(self, answer="A conexão está ok.", propose=False):
        self.calls: list[dict] = []
        self.answer = answer
        self.propose = propose

    async def create(self, **kw):
        self.calls.append({**kw, "messages": list(kw["messages"])})
        usage = {"prompt_tokens": 100, "completion_tokens": 20}
        if self.propose and len(self.calls) == 1:
            return {"usage": usage, "choices": [{"finish_reason": "tool_calls", "message": {
                "role": "assistant", "content": None, "tool_calls": [{"id": "t1", "type": "function", "function": {
                    "name": "prepare_control_action", "arguments": '{"action": "reboot", "reason": "lento"}'}}]}}]}
        return {"usage": usage, "choices": [{"finish_reason": "stop", "message": {
            "role": "assistant", "content": self.answer}}]}
@pytest.fixture
def db(tmp_path):
    d = Database(tmp_path / "o.sqlite3")
    d.execute("INSERT INTO local_users (username, password_hash, role, created_at) VALUES ('admin', 'x', 'admin', ?)",
              (now_ts(),))
    return d


def _voice(chat=CHAT, uid=1, age_s=0, duration=5, file_size=len(AUDIO)):
    return {"update_id": uid, "message": {"message_id": uid, "date": now_ts() - age_s,
                                         "voice": {"file_id": "fid1", "duration": duration, "mime_type": "audio/ogg",
                                                   "file_size": file_size},
                                         "chat": {"id": chat, "type": "private"}}}


def _bot(db, s, tg, ai=None, groq=None):
    if db.get_kv(tb.KV_OFFSET) is None:
        db.set_kv(tb.KV_OFFSET, "0")
    bot = tb.TelegramBot(db, s, transport=httpx.MockTransport(tg), ai_client=ai, poll_timeout=0,
                         audio_transport=httpx.MockTransport(groq) if groq else None)
    return bot


async def _poll(bot):
    async with bot._client() as c:
        return await bot.poll_once(c)


# ----------------------------------------------------------------- transcrição
async def test_voice_question_is_marked_for_the_model(tmp_path, db):
    """A pergunta de voz precisa chegar ao modelo marcada, senão ele responde que não entende áudio."""
    tg, groq, ai = FakeTelegram([_voice()]), FakeGroqAudio("Você está entendendo minha voz?"), FakeAI("Sim, estou.")
    await _poll(_bot(db, _settings(tmp_path), tg, ai, groq))
    sent = [m["content"] for m in ai.calls[0]["messages"] if m["role"] == "user"]
    assert len(sent) == 1 and sent[0].startswith("[pergunta transcrita de uma nota de voz")
    assert sent[0].endswith("Você está entendendo minha voz?")
    # o modelo recebe a instrução de que a pergunta veio por voz
    assert any(m["role"] == "system" and "VOZ" in m["content"] for m in ai.calls[0]["messages"])
    # o histórico guardado no banco é o texto puro (sem a marca)
    conv = db.get_kv(tb.KV_CONVERSATION)
    rows = db.query("SELECT role, content FROM ai_messages WHERE conversation_id = ? ORDER BY id", (int(conv),))
    assert rows[0]["content"] == "Você está entendendo minha voz?"


async def test_text_question_is_not_marked(tmp_path, db):
    text_msg = {"update_id": 1, "message": {"message_id": 1, "date": now_ts(), "text": "oi?",
                                            "chat": {"id": CHAT, "type": "private"}}}
    tg, groq, ai = FakeTelegram([text_msg]), FakeGroqAudio(), FakeAI("ok")
    await _poll(_bot(db, _settings(tmp_path), tg, ai, groq))
    sent = [m["content"] for m in ai.calls[0]["messages"] if m["role"] == "user"]
    assert sent == ["oi?"]
    assert not any(m["role"] == "system" and "VOZ" in m["content"] for m in ai.calls[0]["messages"])


async def test_voice_note_is_transcribed_and_answered(tmp_path, db):
    tg, groq, ai = FakeTelegram([_voice()]), FakeGroqAudio("Como está a conexão agora?"), FakeAI("Tudo ok.")
    bot = _bot(db, _settings(tmp_path), tg, ai, groq)
    assert await _poll(bot) == 1
    # o áudio foi enviado ao Whisper com o modelo e o idioma configurados
    body = groq.calls[0].content.decode("utf-8", "ignore")
    assert "whisper-large-v3-turbo" in body and "pt" in body
    # o bot mostra a transcrição e responde
    assert tg.texts[0] == "🎙 «Como está a conexão agora?»"
    assert tg.texts[1] == "Tudo ok."
    # o texto transcrito é a pergunta enviada à IA, marcada como voz
    sent = [m["content"] for m in ai.calls[0]["messages"] if m["role"] == "user"]
    assert len(sent) == 1 and sent[0].endswith("Como está a conexão agora?")
    assert bot.state["transcribed"] == 1


async def test_transcribed_question_enters_the_conversation_history(tmp_path, db):
    tg, groq, ai = FakeTelegram([_voice()]), FakeGroqAudio("E ontem?"), FakeAI()
    await _poll(_bot(db, _settings(tmp_path), tg, ai, groq))
    conv = db.get_kv(tb.KV_CONVERSATION)
    assert conv is not None
    rows = db.query("SELECT role, content FROM ai_messages WHERE conversation_id = ? ORDER BY id", (int(conv),))
    assert rows[0] == {"role": "user", "content": "E ontem?"}


async def test_audio_is_not_saved_on_disk(tmp_path, db):
    tg, groq, ai = FakeTelegram([_voice()]), FakeGroqAudio("oi"), FakeAI()
    await _poll(_bot(db, _settings(tmp_path), tg, ai, groq))
    written = [p.name for p in tmp_path.rglob("*") if p.is_file() and p.name not in {"o.sqlite3"}
               and not p.name.endswith(("-wal", "-shm"))]
    assert written == []


async def test_audio_usage_and_cost_are_recorded(tmp_path, db):
    tg, groq, ai = FakeTelegram([_voice(duration=5)]), FakeGroqAudio("oi"), FakeAI()
    await _poll(_bot(db, _settings(tmp_path), tg, ai, groq))
    row = db.one("SELECT requests, audio_seconds, estimated_cost_usd FROM ai_audio_usage_daily")
    assert row["requests"] == 1
    # a Groq cobra no mínimo 10 s por requisição
    assert row["audio_seconds"] == 10
    assert row["estimated_cost_usd"] == pytest.approx(10 / 3600 * 0.04, abs=1e-9)


async def test_proposal_from_audio_is_never_executed(tmp_path, db):
    tg, groq, ai = FakeTelegram([_voice()]), FakeGroqAudio("reinicia a antena"), FakeAI("Posso propor.", propose=True)
    await _poll(_bot(db, _settings(tmp_path), tg, ai, groq))
    assert db.scalar("SELECT COUNT(*) FROM control_requests") == 0
    assert "Nada foi executado" in tg.texts[-1]


# ----------------------------------------------------------------- limites
async def test_audio_from_unauthorized_chat_is_ignored_without_download(tmp_path, db):
    tg, groq, ai = FakeTelegram([_voice(chat=999)]), FakeGroqAudio(), FakeAI()
    bot = _bot(db, _settings(tmp_path), tg, ai, groq)
    await _poll(bot)
    assert tg.sent == [] and groq.calls == [] and ai.calls == []
    assert bot.state["ignored_chats"] == 1


async def test_daily_audio_quota_blocks_before_transcribing(tmp_path, db):
    tg, groq, ai = FakeTelegram([_voice()]), FakeGroqAudio(), FakeAI()
    bot = _bot(db, _settings(tmp_path, ai_audio_daily_request_limit=0), tg, ai, groq)
    await _poll(bot)
    assert groq.calls == [] and ai.calls == []
    assert "Limite diário" in tg.texts[0] and "/status" in tg.texts[0]


async def test_audio_too_large_is_refused(tmp_path, db):
    tg, groq, ai = FakeTelegram([_voice(file_size=5_000_000)]), FakeGroqAudio(), FakeAI()
    bot = _bot(db, _settings(tmp_path, ai_audio_max_bytes=1024), tg, ai, groq)
    await _poll(bot)
    assert groq.calls == [] and "Não consegui baixar o seu áudio" in tg.texts[0]


async def test_stale_voice_note_is_not_transcribed(tmp_path, db):
    tg, groq, ai = FakeTelegram([_voice(age_s=3600)]), FakeGroqAudio(), FakeAI()
    bot = _bot(db, _settings(tmp_path), tg, ai, groq)
    await _poll(bot)
    assert groq.calls == [] and ai.calls == []
    assert "estava fora do ar" in tg.texts[0]


async def test_rate_limit_applies_to_voice_notes(tmp_path, db):
    tg, groq, ai = FakeTelegram([_voice(uid=1), _voice(uid=2)]), FakeGroqAudio(), FakeAI()
    bot = _bot(db, _settings(tmp_path, telegram_chat_per_minute=1), tg, ai, groq)
    await _poll(bot)
    assert len(groq.calls) == 1 and "Muitas perguntas" in tg.texts[-1]


async def test_transcription_failure_is_reported_without_crashing(tmp_path, db):
    tg, groq, ai = FakeTelegram([_voice()]), FakeGroqAudio(fail=True), FakeAI()
    bot = _bot(db, _settings(tmp_path), tg, ai, groq)
    assert await _poll(bot) == 1
    assert ai.calls == []
    assert "Não consegui transcrever" in tg.texts[0]


async def test_empty_transcription_is_reported(tmp_path, db):
    tg, groq, ai = FakeTelegram([_voice()]), FakeGroqAudio("   "), FakeAI()
    bot = _bot(db, _settings(tmp_path), tg, ai, groq)
    await _poll(bot)
    assert ai.calls == [] and "Não ouvi nada de útil" in tg.texts[0]


async def test_transcription_disabled_says_so(tmp_path, db):
    tg, groq, ai = FakeTelegram([_voice()]), FakeGroqAudio(), FakeAI()
    bot = _bot(db, _settings(tmp_path, ai_transcribe_enabled=False), tg, ai, groq)
    await _poll(bot)
    assert groq.calls == [] and "desativado" in tg.texts[0]


async def test_text_only_message_still_works(tmp_path, db):
    text_msg = {"update_id": 1, "message": {"message_id": 1, "date": now_ts(), "text": "oi?",
                                            "chat": {"id": CHAT, "type": "private"}}}
    tg, groq, ai = FakeTelegram([text_msg]), FakeGroqAudio(), FakeAI("ok")
    bot = _bot(db, _settings(tmp_path), tg, ai, groq)
    await _poll(bot)
    assert tg.texts == ["ok"] and groq.calls == []


# ----------------------------------------------------------------- helpers
def test_filename_and_mime_follow_the_telegram_mime_type():
    assert transcribe.filename_for("audio/ogg") == "audio.ogg"
    assert transcribe.filename_for("audio/mpeg") == "audio.mp3"
    assert transcribe.filename_for("audio/mp4") == "audio.m4a"
    assert transcribe.filename_for("audio/wav") == "audio.wav"
    # mime desconhecido cai no ogg (formato do Telegram) sem quebrar
    assert transcribe.filename_for("application/x-weird") == "audio.ogg"
    assert transcribe.mime_for("audio.ogg") == "audio/ogg"
    assert transcribe.mime_for("audio.m4a") == "audio/mp4"


def test_extension_from_telegram_path():
    assert transcribe.extension_from_path("voice/file_1.oga") == ".oga"
    assert transcribe.extension_from_path("voice/file_1") is None
    assert transcribe.extension_from_path("voice/file.exe") is None


def test_transcriber_requires_a_groq_key(tmp_path):
    assert not transcribe.Transcriber(_settings(tmp_path, groq_api_key=None)).enabled()
    assert transcribe.Transcriber(_settings(tmp_path)).enabled()
    assert not transcribe.Transcriber(_settings(tmp_path, ai_transcribe_enabled=False)).enabled()
