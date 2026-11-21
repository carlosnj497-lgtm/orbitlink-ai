"""Bot do Telegram com IA: só o chat autorizado, nada executado, formatação e falhas honestas."""

from __future__ import annotations

import asyncio
import json
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from astryon_agent.ai import telegram_bot as tb
from astryon_agent.api.app import create_app
from astryon_agent.config import Settings
from astryon_agent.storage.db import Database, now_ts

TOKEN = "123456789:AAH-segredo_do_bot"
CHAT = 8560810900


def _settings(tmp_path, **kw):
    base = dict(_env_file=None, data_dir=tmp_path, api_token="svc-token", telegram_bot_token=TOKEN,
                telegram_chat_id=str(CHAT), groq_api_key="gsk_teste", telegram_voice_replies=False)
    base.update(kw)
    return Settings(**base)


class FakeTelegram:
    """Simula a Bot API: entrega as atualizações uma vez e registra tudo o que o bot envia."""

    def __init__(self, updates=(), reject_html=False, get_status=200, stale_offset=None, not_modified=False):
        self.updates = list(updates)
        self.sent: list[dict] = []
        self.actions: list[dict] = []
        self.edits: list[dict] = []
        self.reactions: list[dict] = []
        self.reject_html = reject_html
        self.not_modified = not_modified
        self.get_status = get_status
        # Offset "corrompido": a partir dele o Telegram nunca devolve nada (update_ids reais são menores).
        self.stale_offset = stale_offset
        self.offset_calls: list[int] = []

    def __call__(self, req: httpx.Request) -> httpx.Response:
        assert TOKEN in str(req.url)  # o token só aparece na URL da Bot API
        method = req.url.path.rsplit("/", 1)[-1]
        # GET manda os parâmetros na query string; POST, no corpo JSON.
        body = dict(req.url.params) if req.method == "GET" else json.loads(req.content or b"{}")
        if method == "getUpdates":
            if self.get_status != 200:
                return httpx.Response(self.get_status, json={"ok": False, "description": "Conflict: terminated by other "
                                                             "getUpdates request"})
            off = int(body.get("offset", 0))
            self.offset_calls.append(off)
            if self.stale_offset is not None and off >= self.stale_offset:
                return httpx.Response(200, json={"ok": True, "result": []})
            # O Telegram só CONFIRMA (descarta) as updates cujo update_id é menor que o offset.
            # Um getUpdates com offset baixo devolve as pendentes sem destruí-las.
            ups = [u for u in self.updates if u["update_id"] >= off]
            self.updates = [u for u in self.updates if u["update_id"] >= off]
            return httpx.Response(200, json={"ok": True, "result": ups})
        if method == "getWebhookInfo":
            return httpx.Response(200, json={"ok": True, "result": {"url": "", "pending_update_count": 0}})
        if method == "sendChatAction":
            self.actions.append(body)
            return httpx.Response(200, json={"ok": True, "result": True})
        if method in ("answerCallbackQuery", "setMyCommands"):
            self.actions.append({"method": method, **body})
            return httpx.Response(200, json={"ok": True, "result": True})
        if method == "sendMessage":
            if self.reject_html and body.get("parse_mode") == "HTML":
                return httpx.Response(400, json={"ok": False, "description": "Bad Request: can't parse entities"})
            self.sent.append(body)
            return httpx.Response(200, json={"ok": True, "result": {"message_id": len(self.sent)}})
        if method == "editMessageText":
            if self.not_modified:
                return httpx.Response(400, json={"ok": False, "description": "Bad Request: message is not modified"})
            self.edits.append(body)
            return httpx.Response(200, json={"ok": True, "result": True})
        if method == "setMessageReaction":
            self.reactions.append(body)
            return httpx.Response(200, json={"ok": True, "result": True})
        return httpx.Response(404, json={"ok": False, "description": "Not Found"})

    @property
    def texts(self) -> list[str]:
        return [m["text"] for m in self.sent]


class FakeAI:
    """Simula a Groq. Com `propose`, pede a ferramenta prepare_control_action antes de responder."""

    def __init__(self, answer="A conexão está ok. Período: agora. Fonte: API local.", propose=False, fail=False):
        self.calls: list[dict] = []
        self.answer, self.propose, self.fail = answer, propose, fail

    async def create(self, **kw):
        self.calls.append({**kw, "messages": list(kw["messages"])})
        if self.fail:
            raise httpx.ConnectError("groq fora")
        usage = {"prompt_tokens": 100, "completion_tokens": 20}
        if self.propose and len(self.calls) == 1:
            return {"usage": usage, "choices": [{"finish_reason": "tool_calls", "message": {
                "role": "assistant", "content": None, "tool_calls": [{"id": "t1", "type": "function", "function": {
                    "name": "prepare_control_action", "arguments": '{"action": "reboot", "reason": "lento"}'}}]}}]}
        return {"usage": usage, "choices": [{"finish_reason": "stop", "message": {"role": "assistant",
                                                                                  "content": self.answer}}]}


def _msg(text, chat=CHAT, uid=1, age_s=0):
    return {"update_id": uid, "message": {"message_id": uid, "date": now_ts() - age_s, "text": text,
                                          "chat": {"id": chat, "type": "private"}}}


@pytest.fixture
def db(tmp_path):
    d = Database(tmp_path / "o.sqlite3")
    d.execute("INSERT INTO local_users (username, password_hash, role, created_at) VALUES ('admin', 'x', 'admin', ?)",
              (now_ts(),))
    return d


def _bot(db, s, tg, ai=None, fresh=False, **kw):
    if not fresh and db.get_kv(tb.KV_OFFSET) is None:
        db.set_kv(tb.KV_OFFSET, "0")  # já passou pela primeira inicialização
    # debounce zerado: os testes respondem de forma síncrona; o agrupamento tem teste próprio
    return tb.TelegramBot(db, s, transport=httpx.MockTransport(tg), ai_client=ai, poll_timeout=0,
                          debounce_s=kw.pop("debounce_s", 0), **kw)


async def _poll(bot):
    async with bot._client() as c:
        return await bot.poll_once(c)


# ----------------------------------------------------------------- perguntas
async def test_answers_authorized_chat_with_ai_and_keeps_conversation(tmp_path, db):
    s = _settings(tmp_path)
    tg, ai = FakeTelegram([_msg("Como está a conexão?", uid=10)]), FakeAI("**Tudo ok**: latência `35 ms`.")
    bot = _bot(db, s, tg, ai)
    assert await _poll(bot) == 1
    assert tg.actions == [{"chat_id": CHAT, "action": "typing"}]
    assert tg.sent[-1]["parse_mode"] == "HTML" and tg.texts[-1] == "<b>Tudo ok</b>: latência <code>35 ms</code>."
    # o modelo é avisado de que o canal é o Telegram (resposta curta, sem tabela)
    assert any(m["role"] == "system" and "Telegram" in m["content"] for m in ai.calls[0]["messages"])
    assert db.get_kv(tb.KV_OFFSET) == "11"
    conv = db.get_kv(tb.KV_CONVERSATION)
    assert db.scalar("SELECT title FROM ai_conversations WHERE id = ?", (int(conv),)).startswith("Telegram:")
    # segunda pergunta continua a mesma conversa, com o histórico
    tg.updates = [_msg("E ontem?", uid=11)]
    await _poll(bot)
    assert db.get_kv(tb.KV_CONVERSATION) == conv
    assert [m["content"] for m in ai.calls[-1]["messages"] if m["role"] == "user"] == ["Como está a conexão?", "E ontem?"]


async def test_first_start_discards_backlog_without_answering(tmp_path, db):
    tg, ai = FakeTelegram([_msg("oi", uid=40, age_s=2400), _msg("oi de novo", uid=41, age_s=2000)]), FakeAI()
    bot = _bot(db, _settings(tmp_path), tg, ai, fresh=True)
    assert await _poll(bot) == 0
    assert tg.sent == [] and ai.calls == [] and db.get_kv(tb.KV_OFFSET) == "42"
    tg.updates = [_msg("Como está?", uid=42)]
    await _poll(bot)
    assert len(ai.calls) == 1 and len(tg.sent) == 1


async def test_stale_offset_is_detected_and_reset(tmp_path, db):
    """Offset além de qualquer update_id real fazia o bot ficar mudo para sempre."""
    db.set_kv(tb.KV_OFFSET, "900000000")
    tg = FakeTelegram([_msg("Como está a conexão?", uid=5)], stale_offset=900000000)
    bot = _bot(db, _settings(tmp_path), tg, FakeAI("ok"))
    assert await _poll(bot) == 1
    assert tg.texts == ["ok"]
    assert bot.state["offset_reset"] is True
    assert db.get_kv(tb.KV_OFFSET) == "6"  # voltou a ler a partir do update real


async def test_stale_offset_is_kept_when_updates_are_pending(tmp_path, db):
    """Com updates esperando, o offset só estava atrasado: não deve ser reiniciado."""
    db.set_kv(tb.KV_OFFSET, "3")
    tg = FakeTelegram([_msg("oi", uid=5)])
    bot = _bot(db, _settings(tmp_path), tg, FakeAI("ok"))
    assert await _poll(bot) == 1
    assert bot.state["offset_reset"] is False
    assert db.get_kv(tb.KV_OFFSET) == "6"


async def test_other_chats_are_ignored_silently(tmp_path, db):
    tg, ai = FakeTelegram([_msg("me diga o IP", chat=999, uid=1), _msg("/status", chat=-100123, uid=2)]), FakeAI()
    bot = _bot(db, _settings(tmp_path), tg, ai)
    await _poll(bot)
    assert tg.sent == [] and tg.actions == [] and ai.calls == []
    assert bot.state["ignored_chats"] == 2 and db.get_kv(tb.KV_OFFSET) == "3"


async def test_proposal_is_never_executed(tmp_path, db):
    tg, ai = FakeTelegram([_msg("reinicia a antena", uid=1)]), FakeAI("Posso propor um reinício.", propose=True)
    await _poll(_bot(db, _settings(tmp_path), tg, ai))
    assert db.scalar("SELECT COUNT(*) FROM control_requests") == 0
    assert "Nada foi executado" in tg.texts[-1] and "Controle da Starlink" in tg.texts[-1]


async def test_commands_status_new_and_help_do_not_use_ai(tmp_path, db):
    tg, ai = FakeTelegram([_msg("/start", uid=1), _msg("/status", uid=2), _msg("/nova", uid=3),
                           _msg("/xyz@Starlink_ElonBot", uid=4)]), FakeAI()
    db.set_kv(tb.KV_CONVERSATION, "7")
    await _poll(_bot(db, _settings(tmp_path), tg, ai))
    assert ai.calls == []
    assert "/status" in tg.texts[0] and "regras" in tg.texts[1].lower()
    assert "Para perguntas livres" not in tg.texts[1]
    assert db.get_kv(tb.KV_CONVERSATION) is None and "Conversa nova" in tg.texts[2]
    assert tg.texts[3].startswith("Comando desconhecido")


async def test_stale_message_after_downtime_is_not_answered_by_ai(tmp_path, db):
    tg, ai = FakeTelegram([_msg("tá caindo?", uid=1, age_s=3600)]), FakeAI()
    await _poll(_bot(db, _settings(tmp_path), tg, ai))
    assert ai.calls == [] and "estava fora do ar" in tg.texts[0]


async def test_rate_limit_per_minute(tmp_path, db):
    tg, ai = FakeTelegram([_msg("a?", uid=1), _msg("b?", uid=2)]), FakeAI()
    await _poll(_bot(db, _settings(tmp_path, telegram_chat_per_minute=1), tg, ai))
    assert len(ai.calls) == 1 and tg.texts[-1].startswith("Muitas perguntas")


async def test_daily_quota_and_ai_failure_are_reported(tmp_path, db):
    tg = FakeTelegram([_msg("oi?", uid=1)])
    await _poll(_bot(db, _settings(tmp_path, ai_daily_request_limit=0), tg, FakeAI()))
    assert "Limite diário" in tg.texts[-1] and "/status" in tg.texts[-1]
    tg2 = FakeTelegram([_msg("oi?", uid=5)])
    await _poll(_bot(db, _settings(tmp_path), tg2, FakeAI(fail=True)))
    assert tg2.texts[-1].startswith("Assistente indisponível agora (ConnectError)")


async def test_unexpected_error_in_a_message_does_not_kill_the_bot(tmp_path, db, monkeypatch):
    def boom(*_a, **_k):
        raise RuntimeError("database is locked")

    monkeypatch.setattr(tb.digest, "build_rolling", boom)
    tg = FakeTelegram([_msg("/resumo", uid=1), _msg("oi?", uid=2)])
    bot = _bot(db, _settings(tmp_path), tg, FakeAI())
    assert await _poll(bot) == 2  # a 1ª mensagem falhou, a 2ª ainda foi respondida
    assert tg.texts[0].startswith("Não consegui concluir")
    assert tg.texts[1] == "A conexão está ok. Período: agora. Fonte: API local."
    assert "erro inesperado" in bot.state["last_error"] and db.get_kv(tb.KV_OFFSET) == "3"


async def test_run_loop_survives_unexpected_error(tmp_path, db, monkeypatch):
    bot = _bot(db, _settings(tmp_path), FakeTelegram())
    calls = 0

    async def flaky(_client):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("database is locked")
        raise asyncio.CancelledError

    async def no_sleep(_s):
        return None

    monkeypatch.setattr(bot, "poll_once", flaky)
    monkeypatch.setattr(tb.asyncio, "sleep", no_sleep)
    with pytest.raises(asyncio.CancelledError):
        await bot.run()
    assert calls == 2 and "RuntimeError" in bot.state["last_error"]


async def test_purged_conversation_with_quota_exhausted_still_replies(tmp_path, db):
    db.set_kv(tb.KV_CONVERSATION, "999")  # conversa já apagada pela retenção
    tg = FakeTelegram([_msg("oi?", uid=1)])
    await _poll(_bot(db, _settings(tmp_path, ai_daily_request_limit=0), tg, FakeAI()))
    assert "Limite diário" in tg.texts[-1]


async def test_no_admin_yet(tmp_path):
    d = Database(tmp_path / "vazio.sqlite3")
    tg = FakeTelegram([_msg("oi?", uid=1)])
    await _poll(_bot(d, _settings(tmp_path), tg, FakeAI()))
    assert "Crie primeiro o administrador" in tg.texts[0]


async def test_html_rejected_falls_back_to_plain_text(tmp_path, db):
    tg = FakeTelegram([_msg("oi?", uid=1)], reject_html=True)
    await _poll(_bot(db, _settings(tmp_path), tg, FakeAI("**ok**")))
    assert tg.sent[-1].get("parse_mode") is None and tg.texts[-1] == "**ok**"


@pytest.mark.parametrize("command", ["consumo", "qualidade", "quedas", "alertas", "franquia", "bot"])
async def test_direct_reports_without_data_or_ai(tmp_path, db, command):
    tg, ai = FakeTelegram([_msg(f"/{command}")]), FakeAI()
    bot = _bot(db, _settings(tmp_path), tg, ai)
    await _poll(bot)
    assert len(tg.sent) == 1 and ai.calls == []
    assert "reply_markup" in tg.sent[0]
    assert bot.state["last_error"] is None
    assert "100,00%" not in tg.texts[0]


async def test_menu_callback_and_period_validation(tmp_path, db):
    callback = {"update_id": 2, "callback_query": {
        "id": "click-1", "data": "ol:qualidade 7d",
        "message": {"chat": {"id": CHAT}, "date": now_ts() - 86400},
    }}
    tg, ai = FakeTelegram([_msg("/menu"), callback, _msg("/consumo 999d", uid=3)]), FakeAI()
    await _poll(_bot(db, _settings(tmp_path), tg, ai))
    assert tg.sent[0]["reply_markup"]["inline_keyboard"][0][0]["callback_data"] == "ol:status"
    assert tg.actions[0]["method"] == "answerCallbackQuery"
    assert "Qualidade" in tg.texts[1] and "Período inválido" in tg.texts[2]
    assert ai.calls == []


async def test_callback_authorization_and_unknown_action(tmp_path, db):
    updates = [{"update_id": i, "callback_query": {
        "id": str(i), "data": data, "message": {"chat": {"id": chat}},
    }} for i, chat, data in [(1, 999, "ol:status"), (2, CHAT, "ol:reboot"), (3, CHAT, "ol:consumo 999d")]]
    tg, ai = FakeTelegram(updates), FakeAI()
    bot = _bot(db, _settings(tmp_path), tg, ai)
    await _poll(bot)
    assert bot.state["ignored_chats"] == 1
    assert len(tg.actions) == 2 and all("expirou" in a["text"] for a in tg.actions)
    assert tg.sent == [] and ai.calls == []
    assert db.scalar("SELECT COUNT(*) FROM control_requests") == 0


async def test_unicode_messages_fit_telegram_utf16_limit(tmp_path, db):
    tg = FakeTelegram()
    bot = _bot(db, _settings(tmp_path), tg)
    async with bot._client() as client:
        await bot.send(client, CHAT, "🛰" * 4000, section="status")
    assert len(tg.sent) == 3
    assert all(len(m["text"].encode("utf-16-le")) // 2 <= 4096 for m in tg.sent)
    assert "reply_markup" not in tg.sent[0] and "reply_markup" in tg.sent[-1]


# ----------------------------------------------------------------- formatação
def test_to_html_escapes_and_formats():
    out = tb.to_html("## Título\n<script>x</script> & **negrito** `a<b` _(nota)_\n|---|---|\nfim_de_linha")
    assert out.startswith("<b>Título</b>\n&lt;script&gt;x&lt;/script&gt; &amp; <b>negrito</b> <code>a&lt;b</code>")
    assert "<i>(nota)</i>" in out and "---" not in out and "fim_de_linha" in out
    # Código inline não deve receber negrito/itálico.
    code = tb.to_html("`foo _bar_ baz` e `**x**`")
    assert "<code>foo &#95;bar&#95; baz</code>" in code
    assert "<code>&#42;&#42;x&#42;&#42;</code>" in code


def test_chunks_respect_telegram_limit():
    text = "\n\n".join(f"Parágrafo {i}: " + "x" * 900 for i in range(10))
    parts = tb.chunks(text)
    assert len(parts) > 1 and all(len(p) <= tb.MAX_CHUNK for p in parts)
    assert "".join(parts).replace("\n", "") == text.replace("\n", "")


# ----------------------------------------------------------------- ciclo de vida
def test_enabled_requires_token_chat_and_flag(tmp_path):
    assert tb.enabled(_settings(tmp_path))
    assert not tb.enabled(_settings(tmp_path, telegram_chat_id=None))
    assert not tb.enabled(_settings(tmp_path, telegram_bot_token=None))
    assert not tb.enabled(_settings(tmp_path, telegram_chat_enabled=False))


async def test_conflict_is_reported_and_retried_later(tmp_path, db, monkeypatch):
    bot = _bot(db, _settings(tmp_path), FakeTelegram(get_status=409))
    waits = []

    async def fake_sleep(s):
        waits.append(s)
        raise asyncio.CancelledError

    monkeypatch.setattr(tb.asyncio, "sleep", fake_sleep)
    with pytest.raises(asyncio.CancelledError):
        await bot.run()
    assert waits == [300] and bot.state["last_error"].startswith("HTTP 409")


def test_app_starts_bot_and_reports_status(tmp_path):
    tg = FakeTelegram()
    app = create_app(_settings(tmp_path), start_collector=False)

    async def inject(ctx):  # roda antes dos outros hooks: o bot nasce falando com o Telegram falso
        ctx.extras["telegram_transport"] = httpx.MockTransport(tg)

    app.state.startup_hooks.insert(0, inject)
    svc = {"Authorization": "Bearer svc-token"}
    with TestClient(app) as c:
        c.post("/v1/auth/setup", json={"username": "admin", "password": "senha-forte-123"}, headers=svc)
        r = c.post("/v1/auth/login", json={"username": "admin", "password": "senha-forte-123"}, headers=svc)
        h = {**svc, "X-ASTRYON-Session": r.json()["session"]}
        bot = app.state.ctx.extras["telegram_bot"]
        for _ in range(50):
            if bot.state["last_poll_ok"]:
                break
            time.sleep(0.05)
        chat = c.get("/v1/alerts/notifications", headers=h).json()["telegram_chat"]
        assert chat["enabled"] is True and chat["last_error"] is None and chat["last_poll_ok"]
    off = create_app(_settings(tmp_path / "b", telegram_chat_enabled=False), start_collector=False)
    with TestClient(off):
        assert "telegram_bot" not in off.state.ctx.extras


# ----------------------------------------------------------------- melhorias de UX
def _group_msg(text, uid, user, group=-100123, thread=None):
    message = {"message_id": uid, "date": now_ts(), "text": text,
               "chat": {"id": group, "type": "supergroup"}, "from": {"id": user}}
    if thread is not None:
        message["message_thread_id"] = thread
    return {"update_id": uid, "message": message}


async def test_period_button_edits_card_instead_of_new_message(tmp_path, db):
    callback = {"update_id": 2, "callback_query": {"id": "c1", "data": "ol:consumo 7d",
                "message": {"chat": {"id": CHAT}, "message_id": 99, "date": now_ts() - 3600}}}
    tg, ai = FakeTelegram([callback]), FakeAI()
    await _poll(_bot(db, _settings(tmp_path), tg, ai))
    assert tg.sent == [] and ai.calls == []
    assert len(tg.edits) == 1 and tg.edits[0]["message_id"] == 99
    assert "Consumo" in tg.edits[0]["text"] and "reply_markup" in tg.edits[0]


async def test_clicking_the_current_period_is_a_noop(tmp_path, db):
    callback = {"update_id": 2, "callback_query": {"id": "c1", "data": "ol:consumo 7d",
                "message": {"chat": {"id": CHAT}, "message_id": 99, "date": now_ts() - 3600}}}
    tg = FakeTelegram([callback], not_modified=True)
    await _poll(_bot(db, _settings(tmp_path), tg, FakeAI()))
    assert tg.edits == [] and tg.sent == [] and "not modified" not in str(tg.actions)


async def test_card_too_old_to_edit_falls_back_to_a_new_message(tmp_path, db):
    callback = {"update_id": 2, "callback_query": {"id": "c1", "data": "ol:consumo 7d",
                "message": {"chat": {"id": CHAT}, "date": now_ts() - 3600}}}  # sem message_id: não dá para editar
    tg = FakeTelegram([callback])
    await _poll(_bot(db, _settings(tmp_path), tg, FakeAI()))
    assert tg.edits == [] and len(tg.sent) == 1 and "Consumo" in tg.texts[0]


async def test_reaction_marks_received_and_answered(tmp_path, db):
    tg, ai = FakeTelegram([_msg("Como está?", uid=10)]), FakeAI("ok")
    await _poll(_bot(db, _settings(tmp_path), tg, ai))
    assert [r["reaction"] for r in tg.reactions] == [[{"type": "emoji", "emoji": "👀"}],
                                                     [{"type": "emoji", "emoji": "✅"}]]
    assert all(r["message_id"] == 10 for r in tg.reactions)


async def test_reaction_is_cleared_when_ai_fails(tmp_path, db):
    tg = FakeTelegram([_msg("oi?", uid=10)])
    await _poll(_bot(db, _settings(tmp_path), tg, FakeAI(fail=True)))
    assert tg.reactions[-1]["reaction"] == []
    assert tg.texts[-1].startswith("Assistente indisponível")


async def test_fragmented_messages_become_one_ai_question(tmp_path, db):
    tg, ai = FakeTelegram([_msg("Quanto consumi", uid=1), _msg("este mês?", uid=2)]), FakeAI("ok")
    bot = _bot(db, _settings(tmp_path), tg, ai, debounce_s=0.05)
    async with bot._client() as c:  # o client fica aberto enquanto a task do debounce dispara
        assert await bot.poll_once(c) == 2
        assert ai.calls == []  # ainda aguardando a janela do debounce
        await asyncio.sleep(0.2)
    assert len(ai.calls) == 1
    asked = [m["content"] for m in ai.calls[0]["messages"] if m["role"] == "user"]
    assert asked == ["Quanto consumi\neste mês?"]
    assert [r["reaction"][0]["emoji"] for r in tg.reactions] == ["👀", "👀", "✅", "✅"]
    assert tg.texts[-1] == "ok"


async def test_rate_limit_is_per_user_in_groups(tmp_path, db):
    group = -100123
    s = _settings(tmp_path, telegram_chat_id=str(group), telegram_allowed_user_ids=[10, 11],
                  telegram_chat_per_minute=1)
    tg, ai = FakeTelegram([_group_msg("a?", 1, 10), _group_msg("b?", 2, 11), _group_msg("c?", 3, 10)]), FakeAI("ok")
    await _poll(_bot(db, s, tg, ai))
    assert len(ai.calls) == 2  # cada pessoa tem a própria cota; a 3ª estoura a do usuário 10
    assert tg.texts[-1].startswith("Muitas perguntas")


async def test_replies_stay_in_the_same_topic(tmp_path, db):
    group = -100123
    s = _settings(tmp_path, telegram_chat_id=str(group), telegram_allowed_user_ids=[10])
    tg = FakeTelegram([_group_msg("/status", 1, 10, thread=42)])
    await _poll(_bot(db, s, tg, FakeAI()))
    assert tg.sent[0]["message_thread_id"] == 42


async def test_bot_command_shows_session_stats(tmp_path, db):
    tg = FakeTelegram([_msg("/bot")])
    bot = _bot(db, _settings(tmp_path), tg, FakeAI())
    bot.state["ai_answered"], bot.state["ai_failed"], bot.state["ai_latency_avg_s"] = 3, 1, 2.5
    await _poll(bot)
    assert "3 respostas de IA" in tg.texts[-1] and "1 falhas" in tg.texts[-1] and "2,5 s" in tg.texts[-1]


def test_invalid_allowed_user_ids_deny_group_without_crashing(tmp_path):
    s = _settings(tmp_path, telegram_chat_id="-100123")
    bot = tb.TelegramBot(Database(tmp_path / "x.sqlite3"), s,
                         transport=httpx.MockTransport(FakeTelegram()))
    bot.settings.telegram_allowed_user_ids = ["não-é-número"]  # config quebrada não pode derrubar o bot
    msg = {"chat": {"id": -100123, "type": "supergroup"}, "from": {"id": 10}}
    assert bot._authorized(msg) is False


def test_chunks_do_not_split_markup_pairs():
    text = "a" * 1700 + " **negrito comprido** " + "b" * 1700
    parts = tb.chunks(text, 1800)
    assert len(parts) > 1
    assert all(p.count("**") % 2 == 0 for p in parts)
    assert "".join(parts).replace(" ", "") == text.replace(" ", "")


async def test_channel_is_authorized_by_chat_id(tmp_path, db):
    """Canais devem ser tratados como chat privado: autorizados só pelo chat_id."""
    tg, ai = FakeTelegram([{
        "update_id": 1,
        "message": {"message_id": 1, "date": now_ts(), "text": "oi", "chat": {"id": CHAT, "type": "channel"}},
    }]), FakeAI("ok")
    await _poll(_bot(db, _settings(tmp_path), tg, ai))
    assert len(ai.calls) == 1
    assert tg.texts[-1] == "ok"


async def test_stop_cancels_background_tasks(tmp_path, db):
    """O shutdown deve cancelar tarefas pendentes de debounce sem tentar responder."""
    tg, ai = FakeTelegram([_msg("a", uid=1), _msg("b", uid=2)]), FakeAI("ok")
    bot = _bot(db, _settings(tmp_path), tg, ai, debounce_s=60)
    async with bot._client() as c:
        await bot.poll_once(c)
    # Espera o callback de remoção da tarefa de debounce substituída.
    await asyncio.sleep(0)
    assert any(not t.done() for t in bot._background)
    await bot.stop()
    assert all(t.done() for t in bot._background)
    assert bot.state["running"] is False
    assert not tg.sent  # nenhuma resposta deve ter saído após o cancelamento


async def test_report_command_handles_send_failure(tmp_path, db, monkeypatch):
    """Se o envio do PDF falhar, o usuário recebe aviso no chat."""
    from astryon_agent.reports import monthly
    monkeypatch.setattr(monthly, "build", lambda *_a, **_k: (b"pdf", "caption"))

    async def fail(*_a, **_k):
        raise httpx.ConnectError("sem rede")

    monkeypatch.setattr(monthly, "send_pdf", fail)
    tg = FakeTelegram([_msg("/relatorio", uid=1)])
    await _poll(_bot(db, _settings(tmp_path), tg, FakeAI()))
    assert any("Não consegui enviar o PDF" in t for t in tg.texts)


async def test_group_conversation_is_isolated_from_private(tmp_path, db):
    """A primeira mensagem de um usuário em grupo não deve reusar a conversa do chat privado."""
    group = -100123
    s = _settings(tmp_path, telegram_chat_id=str(group), telegram_allowed_user_ids=[10])
    # Cria uma conversa do privado primeiro.
    db.set_kv(tb.KV_CONVERSATION, "999")
    tg, ai = FakeTelegram([_group_msg("oi", 1, 10, group=group)]), FakeAI("pela IA")
    await _poll(_bot(db, s, tg, ai))
    # O grupo deve ter criado sua própria chave de conversa, não reusado 999.
    group_key = f"{tb.KV_CONVERSATION}:{group}:10"
    assert db.get_kv(group_key) is not None
    assert db.get_kv(group_key) != "999"
