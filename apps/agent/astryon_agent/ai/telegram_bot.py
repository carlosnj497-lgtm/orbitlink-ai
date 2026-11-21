"""Bot do Telegram que responde perguntas com o copiloto (o mesmo do painel).

Segurança:
* Long polling (getUpdates): o agente busca as mensagens; nenhuma porta fica aberta para a internet.
* Só responde ao chat configurado em ASTRYON_TELEGRAM_CHAT_ID. Qualquer outro chat é ignorado em silêncio
  (nada é respondido, e o conteúdo não vai para o log).
* Grupos: além de listar os user ids em telegram_allowed_user_ids, desligue o "privacy mode" do bot no
  @BotFather (/setprivacy → Disable); com ele ligado o bot só recebe comandos, não as perguntas.
* A IA continua somente leitura. Se ela propuser uma ação (ex.: reiniciar), o bot só repassa a proposta e manda
  confirmar no painel. Nada é executado a partir do Telegram.
* Cota diária do assistente vale aqui também, mais um limite por minuto contra rajadas (por pessoa, em grupos).
* O token do bot nunca é registrado (a redação de logs remove /bot<token> e o httpx fica em WARNING).
* Nota de voz: o áudio é transcrito pelo Whisper da Groq e nunca fica salvo em disco. O texto transcrito
  entra no mesmo histórico da conversa e o chat não autorizado não tem o áudio baixado.

Concorrência: perguntas de texto esperam alguns segundos (debounce) para juntar mensagens fragmentadas numa
pergunta só, e respondem a partir de uma task — o laço de polling não fica travado enquanto a IA pensa, e
comandos rápidos (/status, botões) continuam instantâneos. O `ai_lock` impede que duas perguntas simultâneas
disputem a mesma conversa ou a cota.
"""

from __future__ import annotations

import asyncio
import contextlib
import contextvars
import html
import logging
import re
import time
from collections.abc import Awaitable, Callable, Coroutine
from datetime import datetime
from typing import Any, TypeVar
from zoneinfo import ZoneInfo

import httpx

from ..alerts.notify import PermanentError, RetryLater, _check
from ..auth.local import RateLimiter
from ..reports import digest, monthly
from ..storage.db import Database, now_ts
from . import copilot, speech, transcribe
from . import telegram_texts as texts
from . import telegram_views as views

log = logging.getLogger("astryon.telegram")
T = TypeVar("T")

KV_OFFSET = "telegram:offset"
KV_CONVERSATION = "telegram:conversation"
KV_VOICE = "telegram:voice_replies"
STALE_AFTER_S = 15 * 60  # mensagem que chega com o agente fora do ar há mais que isso não é respondida pela IA
MAX_CHUNK = 3500  # o Telegram aceita 4096; folga para as tags HTML
POLL_TIMEOUT_S = 25
DEBOUNCE_S = 4.0  # espera para juntar mensagens fragmentadas numa pergunta só de IA
ACTION_REFRESH_S = 4.0  # o Telegram só mostra "digitando..." por ~5 s: reenviar enquanto trabalha

# Mensagem em atendimento nesta task: de onde saem o tópico (grupos com tópicos) e o alvo das reações.
_current_msg: contextvars.ContextVar[dict[str, Any] | None] = contextvars.ContextVar("telegram_msg", default=None)

HELP = texts.HELP  # compatibilidade com quem importa daqui


def _topic() -> dict[str, Any]:
    """Em grupos com tópicos, responde no mesmo tópico da mensagem atendida."""
    msg = _current_msg.get()
    thread = (msg or {}).get("message_thread_id")
    return {"message_thread_id": thread} if thread else {}


def is_group_chat(chat: dict[str, Any]) -> bool:
    """Grupos e supergrupos. Canais e chats privados são autorizados só pelo chat_id."""
    return chat.get("type") in ("group", "supergroup")


def enabled(settings: Any) -> bool:
    tok = getattr(settings, "telegram_bot_token", None)
    return bool(getattr(settings, "telegram_chat_enabled", True) and tok and tok.get_secret_value()
                and getattr(settings, "telegram_chat_id", None))


def to_html(md: str) -> str:
    """Markdown simples do copiloto -> HTML aceito pelo Telegram (b, i, code). Todo o resto é escapado."""
    text = html.escape(md, quote=False)

    # Trechos de código ficam protegidos: negrito/itálico não deve atuar dentro de <code>.
    def _code(m: re.Match[str]) -> str:
        content = m.group(1).replace("*", "&#42;").replace("_", "&#95;")
        return f"<code>{content}</code>"

    text = re.sub(r"`([^`\n]+)`", _code, text)

    out = []
    for line in text.split("\n"):
        m = re.match(r"^\s*#{1,6}\s+(.*)$", line)
        if m:
            line = f"<b>{m.group(1).strip()}</b>"
        elif re.match(r"^\s*\|?\s*:?-{3,}", line):  # separador de tabela, se o modelo insistir em tabela
            continue
        out.append(line)
    text = "\n".join(out)
    text = re.sub(r"\*\*([^*\n]+)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"(?<![\w*])_([^_\n]+)_(?![\w*])", r"<i>\1</i>", text)
    return text


def chunks(text: str, size: int = MAX_CHUNK) -> list[str]:
    """Divide em pedaços de até `size` caracteres, preferindo quebrar em parágrafo ou linha
    e sem separar um par de marcação (`**` ou crase): a metade solta viraria texto literal."""
    parts: list[str] = []
    rest = text.strip()
    while len(rest) > size:
        cut = rest.rfind("\n\n", 0, size)
        if cut < size // 2:
            cut = rest.rfind("\n", 0, size)
        if cut < size // 2:
            cut = size
        cut = _before_open_markup(rest, cut)
        part = rest[:cut].rstrip()
        if not part:  # o corte recuou até o começo: corta seco para garantir progresso
            cut, part = size, rest[:size].rstrip()
        parts.append(part)
        rest = rest[cut:].lstrip()
    if rest:
        parts.append(rest)
    return parts


def _before_open_markup(text: str, cut: int) -> int:
    """Recua o corte para antes de um marcador que ficaria aberto no pedaço."""
    for _ in range(3):  # recuar por um marcador pode desbalancear o outro; poucas passagens bastam
        moved = False
        for marker in ("**", "`", "_"):
            if text[:cut].count(marker) % 2:
                at = text.rfind(marker, 0, cut)
                if at > 0:
                    cut, moved = at, True
        if not moved:
            break
    return cut


class TelegramBot:
    def __init__(self, db: Database, settings: Any, collector: Callable[[], Any] = lambda: None,
                 transport: httpx.AsyncBaseTransport | None = None, ai_client: Any = None,
                 poll_timeout: int = POLL_TIMEOUT_S, audio_transport: httpx.AsyncBaseTransport | None = None,
                 debounce_s: float = DEBOUNCE_S) -> None:
        self.db = db
        self.settings = settings
        self.collector = collector
        self.ai_client = ai_client
        self.poll_timeout = poll_timeout
        self._transport = transport
        self._debounce_s = debounce_s
        self._pending: dict[str, dict[str, Any]] = {}  # perguntas de texto aguardando a janela do debounce
        self._background: set[asyncio.Task[Any]] = set()  # tasks com dono: exceção não some em silêncio
        self._ai_lock = asyncio.Lock()  # duas perguntas não disputam a mesma conversa nem a cota
        self._shutting_down = False
        self.limiter = RateLimiter(int(getattr(settings, "telegram_chat_per_minute", 6)), 60)
        # O transcritor fala com a Groq, não com o Telegram: transport separado (o do Telegram carrega o token
        # na URL e rejeita qualquer requisição para fora da Bot API).
        self.transcriber = transcribe.Transcriber(settings, transport=audio_transport)
        self.speaker = speech.Speaker(settings)
        self.state: dict[str, Any] = {"running": False, "last_poll_ok": None, "last_error": None,
                                      "answered": 0, "ignored_chats": 0, "transcribed": 0, "offset_reset": False,
                                      "ai_answered": 0, "ai_failed": 0, "ai_latency_avg_s": None}

    # ------------------------------------------------------------------ API do Telegram
    @property
    def _base(self) -> str:
        return f"https://api.telegram.org/bot{self.settings.telegram_bot_token.get_secret_value()}"

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=self.poll_timeout + 15, transport=self._transport)

    async def _call(self, client: httpx.AsyncClient, method: str, payload: dict[str, Any]) -> Any:
        r = await client.post(f"{self._base}/{method}", json=payload)
        _check(r, telegram=True)
        return r.json().get("result")

    async def _get(self, client: httpx.AsyncClient, method: str, params: dict[str, Any]) -> Any:
        """Chamada GET da Bot API (getWebhookInfo, getFile)."""
        r = await client.get(f"{self._base}/{method}", params=params, timeout=60)
        _check(r, telegram=True)
        return r.json().get("result")

    async def send(self, client: httpx.AsyncClient, chat_id: int | str, markdown: str,
                   section: str = "") -> None:
        # Emojis ocupam duas unidades UTF-16; 1800 caracteres cabem mesmo se todos forem emojis.
        parts = [p for p in chunks(markdown, 1800) if p]
        for index, part in enumerate(parts):
            extra = {"reply_markup": views.keyboard(section)} if section and index == len(parts) - 1 else {}
            try:
                await self._call(client, "sendMessage", {"chat_id": chat_id, "text": to_html(part), "parse_mode": "HTML",
                                                         "disable_web_page_preview": True, **_topic(), **extra})
            except PermanentError:
                # HTML recusado ("can't parse entities"): manda como texto puro em vez de perder a resposta
                await self._call(client, "sendMessage", {"chat_id": chat_id, "text": part,
                                                         "disable_web_page_preview": True, **_topic(), **extra})

    async def _edit(self, client: httpx.AsyncClient, msg: dict[str, Any], markdown: str, section: str) -> None:
        """Edita o cartão de um relatório no lugar; se não der (antigo demais), abre uma mensagem nova."""
        chat_id = msg["chat"]["id"]
        message_id = msg.get("message_id")
        parts = [p for p in chunks(markdown, 1800) if p]
        if not message_id or len(parts) != 1:
            await self.send(client, chat_id, markdown, section=section)
            return
        base = {"chat_id": chat_id, "message_id": message_id, "disable_web_page_preview": True,
                "reply_markup": views.keyboard(section)}
        try:
            await self._call(client, "editMessageText", {**base, "text": to_html(parts[0]), "parse_mode": "HTML"})
        except PermanentError as exc:
            if "not modified" in str(exc):
                return  # clicou no período já exibido
            try:
                # HTML recusado: tenta texto puro em vez de perder a resposta
                await self._call(client, "editMessageText", {**base, "text": parts[0]})
            except PermanentError:
                await self.send(client, chat_id, markdown, section=section)

    async def _react(self, client: httpx.AsyncClient, emoji: str | None, msg: dict[str, Any] | None = None) -> None:
        """👀 ao receber, ✅ ao responder, vazio quando falhou. Reação é cosmética: nunca atrapalha o fluxo."""
        msg = msg if msg is not None else _current_msg.get()
        if not msg or not msg.get("message_id"):
            return
        reaction: list[dict[str, str]] = [] if emoji is None else [{"type": "emoji", "emoji": emoji}]
        try:
            await self._call(client, "setMessageReaction", {"chat_id": msg["chat"]["id"],
                                                            "message_id": msg["message_id"], "reaction": reaction})
        except Exception:  # noqa: BLE001, S110 - reação é cosmética: nem client fechado pode atrapalhar o fluxo
            pass

    async def _keep_action(self, client: httpx.AsyncClient, chat_id: int | str, action: str = "typing") -> None:
        """Reenvia a ação a cada poucos segundos: o Telegram só mostra "digitando..." por ~5 s."""
        while True:
            try:
                await self._call(client, "sendChatAction", {"chat_id": chat_id, "action": action, **_topic()})
            except (httpx.HTTPError, PermanentError, RetryLater):
                pass  # só cosmético
            await asyncio.sleep(ACTION_REFRESH_S)

    def _spawn(self, coro: Coroutine[Any, Any, None]) -> asyncio.Task[Any]:
        """Task com dono: a referência não é perdida e a exceção vai para o log em vez de sumir."""
        task = asyncio.create_task(coro)
        self._background.add(task)

        def _done(done: asyncio.Task[Any]) -> None:
            self._background.discard(done)
            if not done.cancelled() and done.exception() is not None:
                log.warning("tarefa em segundo plano do Telegram falhou: %r", done.exception())

        task.add_done_callback(_done)
        return task

    async def _stop_action(self, action: asyncio.Task[Any]) -> None:
        action.cancel()
        try:
            await action
        except asyncio.CancelledError:
            pass
        except Exception:  # noqa: BLE001 - ação é cosmética: uma falha nela nunca interrompe a resposta
            log.warning("tarefa cosmética do Telegram falhou", exc_info=True)

    async def stop(self) -> None:
        """Cancela tarefas em segundo plano para desligar sem deixar rastro pendente."""
        self._shutting_down = True
        self.state["running"] = False
        for task in list(self._background):
            task.cancel()
        if self._background:
            await asyncio.gather(*self._background, return_exceptions=True)

    # ------------------------------------------------------------------ laço
    async def _offset_is_stale(self, client: httpx.AsyncClient, offset: int) -> bool:
        """True quando o offset guardado não alcança mais nenhum update_id real.

        O Telegram entrega uma update assim que o offset passa por ela. Se o offset for maior que o último
        update_id existente, `getUpdates` devolve vazio para sempre — o bot fica mudo sem erro nenhum.
        Esse estado acontece quando o offset foi gravado por um `getUpdates` com offset=-1 que devolveu um
        update_id inconsistente, ou quando o bot foi recriado no Telegram.
        """
        if offset <= 0:
            return False
        try:
            info = await self._get(client, "getWebhookInfo", {})
        except (httpx.HTTPError, PermanentError, RetryLater):
            return False
        pending = int((info or {}).get("pending_update_count") or 0)
        if pending:
            return False  # há updates esperando: o offset só estava atrasado, não corrompido
        # Sem update pendente: confere se o Telegram ainda conhece algum update depois do offset guardado.
        try:
            probe = await self._call(client, "getUpdates", {"offset": offset, "timeout": 0}) or []
        except (httpx.HTTPError, PermanentError, RetryLater):
            return False
        if probe:
            return False
        # Confere a partir do offset 0: se houver alguma update, o offset guardado estava além dela.
        try:
            first = await self._call(client, "getUpdates", {"offset": 0, "timeout": 0}) or []
        except (httpx.HTTPError, PermanentError, RetryLater):
            return False
        return bool(first) and int(first[0]["update_id"]) < offset

    async def _reset_offset(self, client: httpx.AsyncClient) -> None:
        """Recomeça a leitura do Telegram a partir da primeira update ainda na fila."""
        await self.db.run(self.db.set_kv, KV_OFFSET, "0")
        self.state["offset_reset"] = True

    async def poll_once(self, client: httpx.AsyncClient) -> int:
        stored = await self.db.run(self.db.get_kv, KV_OFFSET)
        if stored is None:
            # Primeira vez: o que já estava esperando no Telegram (ex.: o "oi" usado para descobrir o chat_id)
            # é descartado sem resposta. Dizer "o agente estava fora do ar" seria falso.
            old = await self._call(client, "getUpdates", {"offset": -1, "timeout": 0}) or []
            # Fica com o update_id mais alto da fila: assim tudo que já estava esperando é pulado de uma vez.
            await self.db.run(self.db.set_kv, KV_OFFSET, str(int(old[-1]["update_id"]) + 1) if old else "0")
            self.state["last_poll_ok"] = now_ts()
            return 0
        offset = int(stored)
        updates = await self._call(client, "getUpdates", {"offset": offset, "timeout": self.poll_timeout,
                                                          "allowed_updates": ["message", "callback_query"]}) or []
        if not updates and await self._offset_is_stale(client, offset):
            # O offset guardado está além de qualquer update_id real (estado corrompido, ou bot recriado no
            # Telegram). Sem corrigir, o bot ignora toda mensagem para sempre. Volta para o começo da fila.
            log.warning("offset do Telegram (%d) não alcança nenhuma update; reiniciando a leitura", offset)
            await self._reset_offset(client)
            updates = await self._call(client, "getUpdates", {"offset": 0, "timeout": self.poll_timeout,
                                                             "allowed_updates": ["message", "callback_query"]}) or []
        for up in updates:
            # Avança o offset ANTES de responder: uma pergunta que derruba o agente não fica em loop após reiniciar.
            await self.db.run(self.db.set_kv, KV_OFFSET, str(int(up["update_id"]) + 1))
            msg = up.get("message")
            callback = up.get("callback_query")
            if msg or callback:
                try:
                    if callback:
                        await self.handle_callback(client, callback)
                    else:
                        await self.handle(client, msg)
                except (httpx.HTTPError, PermanentError, RetryLater) as exc:
                    log.warning("falha ao responder no Telegram: %s", type(exc).__name__)
                except Exception:  # noqa: BLE001 - uma mensagem com problema nunca derruba o bot
                    log.exception("erro inesperado ao tratar mensagem do Telegram")
                    self.state["last_error"] = "erro inesperado ao tratar uma mensagem (veja o log do agente)"
                    original = (callback.get("message") or {}) if callback else msg
                    if original and self._authorized(original):
                        try:
                            await self.send(client, original["chat"]["id"], texts.TRY_AGAIN_LATER,
                                            section="erro")
                        except (httpx.HTTPError, PermanentError, RetryLater):
                            pass
        self.state["last_poll_ok"] = now_ts()
        return len(updates)

    async def run(self) -> None:
        self.state["running"] = True
        failures = 0
        async with self._client() as client:
            # Atualiza TODOS os menus que o telegram_setup publica (padrão e chat, sem idioma e em português):
            # um menu "pt" antigo tem prioridade para clientes em português e esconderia comandos novos.
            commands = [{"command": key, "description": value} for key, value in views.COMMANDS.items()]
            for scope in ({"type": "default"}, {"type": "chat", "chat_id": self.settings.telegram_chat_id}):
                for language in ("", "pt"):
                    try:
                        await self._call(client, "setMyCommands",
                                         {"commands": commands, "scope": scope, "language_code": language})
                    except (httpx.HTTPError, PermanentError, RetryLater):
                        log.warning("não foi possível registrar o menu de comandos do Telegram")
            while True:
                try:
                    t0 = time.monotonic()
                    n = await self.poll_once(client)
                    failures, self.state["last_error"] = 0, None
                    if n == 0 and time.monotonic() - t0 < 1:
                        await asyncio.sleep(1)  # long poll devolveu na hora: não girar em falso
                    continue
                except RetryLater as exc:
                    wait: float = exc.after
                    err = str(exc)
                except PermanentError as exc:
                    # 409: outro processo lendo este bot (ou webhook configurado); 401/404: token inválido
                    wait, err = 300, str(exc)
                except httpx.HTTPError as exc:
                    failures += 1
                    wait, err = min(300, 5 * 2 ** min(failures, 6)), f"sem conexão ({type(exc).__name__})"
                except Exception as exc:  # noqa: BLE001 - ex.: banco ocupado; o laço continua vivo
                    log.exception("bot do Telegram: erro inesperado no laço")
                    failures += 1
                    wait, err = min(300, 5 * 2 ** min(failures, 6)), f"erro inesperado ({type(exc).__name__})"
                self.state["last_error"] = err[:200]
                log.warning("bot do Telegram: %s; nova tentativa em %ss", err[:200], int(wait))
                await asyncio.sleep(wait)

    # ------------------------------------------------------------------ mensagens
    def _authorized(self, msg: dict[str, Any], sender: dict[str, Any] | None = None) -> bool:
        """Autoriza o chat configurado e, em grupos, também a pessoa.

        Num chat privado (ou canal) o acesso é autorizado pelo chat_id. Num grupo/supergrupo,
        qualquer membro poderia usar a IA e os botões; lá só os `telegram_allowed_user_ids`
        são atendidos.
        """
        chat = msg.get("chat") or {}
        if str(chat.get("id")) != str(self.settings.telegram_chat_id).strip():
            return False
        if not is_group_chat(chat):
            return True
        try:
            allowed = {int(u) for u in getattr(self.settings, "telegram_allowed_user_ids", []) or []}
            sender = sender if sender is not None else msg.get("from")
            uid = (sender or {}).get("id")
            return uid is not None and int(uid) in allowed
        except (TypeError, ValueError):
            return False  # configuração ou remetente fora do padrão: nega em vez de derrubar o atendimento

    def _limit_key(self, msg: dict[str, Any]) -> str:
        """Em grupos a cota por minuto é por pessoa; no privado, pelo próprio chat."""
        chat = msg.get("chat") or {}
        if is_group_chat(chat):
            uid = (msg.get("from") or {}).get("id")
            if uid is not None:
                return f"{chat.get('id')}:{uid}"
        return str(chat.get("id"))

    def _conversation_key(self, msg: dict[str, Any]) -> str:
        """Identificador da conversa com a IA: privado mantém a chave legada; grupos separam por usuário."""
        chat = msg.get("chat") or {}
        if is_group_chat(chat):
            uid = (msg.get("from") or {}).get("id")
            if uid is not None:
                return f"{KV_CONVERSATION}:{chat.get('id')}:{uid}"
        return KV_CONVERSATION

    async def _get_conversation(self, msg: dict[str, Any]) -> int | None:
        """Lê o ID da conversa ativa. Grupos nunca reusam a conversa de outro chat."""
        key = self._conversation_key(msg)
        conv = await self.db.run(self.db.get_kv, key)
        return int(conv) if conv else None

    async def _set_conversation(self, msg: dict[str, Any], conv_id: int) -> None:
        await self.db.run(self.db.set_kv, self._conversation_key(msg), str(conv_id))

    async def handle_callback(self, client: httpx.AsyncClient, callback: dict[str, Any]) -> None:
        msg = callback.get("message") or {}
        if not self._authorized(msg, callback.get("from")):
            self.state["ignored_chats"] += 1
            return
        data = str(callback.get("data") or "")
        action = data.removeprefix("ol:")
        bits = action.split()
        valid = (data.startswith("ol:") and bool(bits) and bits[0] in views.COMMANDS
                 and (len(bits) == 1 or len(bits) == 2 and bits[0] in views.REPORTS and bits[1] in views.PERIODS))
        await self._call(client, "answerCallbackQuery", {
            "callback_query_id": callback["id"],
            "text": "" if valid else texts.BUTTON_EXPIRED,
        })
        if not valid:
            return
        if len(bits) == 2:
            # Troca de período: edita o cartão em vez de empilhar uma mensagem nova no chat.
            body = await asyncio.to_thread(views.render, self.db, self.settings, bits[0], bits[1])
            await self._edit(client, msg, body, section=bits[0])
            return
        # A data do cartão é antiga, mas o clique é uma interação nova.
        synthetic: dict[str, Any] = {"chat": msg["chat"], "from": callback.get("from"), "text": f"/{action}",
                                     "date": now_ts()}
        if msg.get("message_thread_id"):
            synthetic["message_thread_id"] = msg["message_thread_id"]  # responde no mesmo tópico
        await self.handle(client, synthetic)

    async def handle(self, client: httpx.AsyncClient, msg: dict[str, Any]) -> None:
        """Registra a mensagem em atendimento (tópico e reações) e despacha."""
        token = _current_msg.set(msg)
        try:
            await self._dispatch(client, msg)
        finally:
            _current_msg.reset(token)

    async def _dispatch(self, client: httpx.AsyncClient, msg: dict[str, Any]) -> None:
        if not self._authorized(msg):
            self.state["ignored_chats"] += 1
            log.info("mensagem de chat não autorizado ignorada")
            return
        chat_id = msg["chat"]["id"]
        text = (msg.get("text") or "").strip()
        if not text:
            audio = msg.get("voice") or msg.get("audio")
            if audio:
                await self._handle_audio(client, chat_id, msg, audio)
                return
            await self.send(client, chat_id, texts.ONLY_TEXT_OR_AUDIO)
            return
        cmd = text.split()[0].split("@")[0].lower() if text.startswith("/") else ""
        if cmd in ("/start", "/menu", "/ajuda", "/help"):
            await self._send_html(client, chat_id, texts.HELP)
            return
        if cmd == "/audio":
            option = text.split()[1:]
            if option == ["ligar"]:
                await self.db.run(self.db.set_kv, KV_VOICE, "on")
            elif option == ["desligar"]:
                await self.db.run(self.db.set_kv, KV_VOICE, "off")
            elif option:
                await self.send(client, chat_id, texts.AUDIO_USAGE)
                return
            state = "ativadas" if await self.db.run(self._voice_enabled) else "desativadas"
            await self.send(client, chat_id, texts.audio_replies(state), section="audio")
            return
        if cmd == "/nova":
            await self.db.run(self.db.execute, "DELETE FROM settings_kv WHERE key = ?",
                              (self._conversation_key(msg),))
            await self.send(client, chat_id, texts.NEW_CONVERSATION, section="menu")
            return
        if cmd.lstrip("/") in views.REPORTS | {"franquia", "alertas", "bot", "clima", "horario"}:
            command = cmd.lstrip("/")
            args = text.split()[1:]
            if args and (command not in views.REPORTS or len(args) != 1 or args[0] not in views.PERIODS):
                await self.send(client, chat_id, texts.invalid_period(command, command in views.REPORTS),
                                section=command)
                return
            period = args[0] if args else "24h"
            body = await asyncio.to_thread(views.render, self.db, self.settings, command, period, self.state)
            await self.send(client, chat_id, body, section=command)
            return
        if cmd == "/relatorio":
            await self.send(client, chat_id, texts.REPORT_GENERATING)
            try:
                end = now_ts()
                start = end - 30 * 86400
                pdf, caption = await asyncio.to_thread(monthly.build, self.db, self.settings, start, end, (start - 30 * 86400, start))
                ok = await monthly.send_pdf(self.settings, pdf, caption.replace("Relatório do ciclo", "Relatório"),
                                            f"astryon-relatorio-{datetime.now(ZoneInfo(self.settings.timezone)):%Y%m%d}.pdf",
                                            self._transport)
            except (httpx.HTTPError, PermanentError, RetryLater) as exc:
                log.warning("falha ao gerar/enviar relatório pelo Telegram: %s", type(exc).__name__)
                await self.send(client, chat_id, texts.REPORT_FAILED)
                return
            except Exception:  # noqa: BLE001
                log.exception("erro inesperado ao gerar/enviar relatório pelo Telegram")
                await self.send(client, chat_id, texts.REPORT_FAILED)
                return
            if not ok:
                await self.send(client, chat_id, texts.REPORT_FAILED)
            return
        if cmd == "/resumo":
            text = await asyncio.to_thread(digest.build_rolling, self.db, self.settings)
            await self.send(client, chat_id, text or texts.DIGEST_EMPTY, section="resumo")
            return
        if cmd == "/status":
            answer = await asyncio.to_thread(copilot.rules_answer, self.db, self.settings, self.collector())
            answer = answer.split("\nPara perguntas livres")[0].replace(
                " (assistente de IA não configurado)", " · consulta sem IA")
            await self.send(client, chat_id, answer, section="status")
            return
        if cmd:
            await self._send_html(client, chat_id, texts.UNKNOWN_COMMAND)
            return

        age = now_ts() - int(msg.get("date") or now_ts())
        if age > STALE_AFTER_S:
            await self._stale_notice(client, chat_id, msg)
            return
        if not self.limiter.allow(self._limit_key(msg)):
            await self.send(client, chat_id, texts.RATE_LIMITED)
            return
        await self._react(client, "👀")
        if self._debounce_s > 0:
            # Texto fragmentado em várias mensagens vira uma pergunta só (e uma cobrança de cota).
            # O atendimento sai do laço de polling: comandos rápidos não esperam a IA pensar.
            self._enqueue(client, msg, text)
            return
        ok = await self._answer(client, chat_id, text, msg)
        await self._react(client, "✅" if ok else None)

    def _enqueue(self, client: httpx.AsyncClient, msg: dict[str, Any], text: str) -> None:
        """Guarda o fragmento e (re)arma o timer: o flush mais novo junta tudo e pergunta uma vez."""
        key = self._limit_key(msg)
        entry = self._pending.setdefault(key, {"msgs": [], "texts": [], "task": None})
        entry["msgs"].append(msg)
        entry["texts"].append(text)
        if entry["task"] is not None:
            entry["task"].cancel()
        entry["task"] = self._spawn(self._flush_later(client, key))

    async def _flush_later(self, client: httpx.AsyncClient, key: str) -> None:
        with contextlib.suppress(asyncio.CancelledError):
            await asyncio.sleep(self._debounce_s)
        if self._shutting_down:
            return
        entry = self._pending.get(key)
        if not entry or entry["task"] is not asyncio.current_task():
            return  # outra mensagem reiniciou o timer: o flush mais novo é quem responde
        del self._pending[key]
        last = entry["msgs"][-1]
        token = _current_msg.set(last)
        ok = False
        try:
            try:
                ok = await self._answer(client, last["chat"]["id"], "\n".join(entry["texts"]), last)
            except Exception:  # noqa: BLE001 - a limpeza das reações no finally não pode ser pulada
                log.exception("falha ao responder pergunta agrupada do Telegram")
        finally:
            _current_msg.reset(token)
            for m in entry["msgs"]:
                await self._react(client, "✅" if ok else None, m)

    async def _stale_notice(self, client: httpx.AsyncClient, chat_id: int | str, msg: dict[str, Any]) -> None:
        tz = ZoneInfo(getattr(self.settings, "timezone", "UTC"))
        when = datetime.fromtimestamp(int(msg["date"]), tz).strftime("%d/%m %H:%M")
        await self.send(client, chat_id, texts.stale_notice(when))

    # ------------------------------------------------------------------ áudio (nota de voz)
    async def _handle_audio(self, client: httpx.AsyncClient, chat_id: int | str, msg: dict[str, Any],
                            audio: dict[str, Any]) -> None:
        """Nota de voz: transcreve com o Whisper da Groq e responde como se fosse texto."""
        if not self.transcriber.enabled():
            await self.send(client, chat_id, texts.TRANSCRIBE_DISABLED)
            return
        # Mensagem antiga (agente fora do ar): não gasta transcrição nem responde com estado desatualizado.
        age = now_ts() - int(msg.get("date") or now_ts())
        if age > STALE_AFTER_S:
            await self._stale_notice(client, chat_id, msg)
            return
        if not self.limiter.allow(self._limit_key(msg)):
            await self.send(client, chat_id, texts.RATE_LIMITED)
            return
        try:
            transcribe.check_audio_quota(self.db, self.settings)
        except PermissionError as exc:
            await self.send(client, chat_id, texts.quota_exceeded(exc))
            return

        mime = str(audio.get("mime_type") or "") or None
        try:
            data = await self._download_audio(client, audio, mime)
        except transcribe.TranscriptionError as exc:
            log.warning("não consegui baixar o áudio do Telegram: %s", exc)
            await self.send(client, chat_id, texts.AUDIO_DOWNLOAD_FAILED)
            return
        except (httpx.HTTPError, PermanentError, RetryLater) as exc:
            log.warning("falha ao baixar o áudio do Telegram: %s", type(exc).__name__)
            await self.send(client, chat_id, texts.AUDIO_DOWNLOAD_RETRY)
            return

        # Reconfere e reserva depois do download: outra aba/bot pode ter consumido a última vaga nesse meio-tempo.
        try:
            transcribe.reserve_audio_quota(self.db, self.settings)
        except PermissionError as exc:
            await self.send(client, chat_id, texts.quota_exceeded(exc))
            return
        # O arquivo pode ser Opus (.ogg) ou outro formato; a extensão decide o mime enviado ao Whisper.
        name = transcribe.filename_for(mime, transcribe.extension_from_path(str(audio.get("file_path") or "")))
        await self._react(client, "👀")
        action = asyncio.create_task(self._keep_action(client, chat_id))
        try:
            question = await self.transcriber.transcribe(data, mime, name)
        except transcribe.TranscriptionError as exc:
            log.warning("transcrição falhou: %s", exc)
            await self.send(client, chat_id, texts.TRANSCRIBE_FAILED)
            return
        except httpx.HTTPError as exc:
            log.warning("transcrição falhou: %s", type(exc).__name__)
            await self.send(client, chat_id, texts.TRANSCRIBE_UNAVAILABLE)
            return
        finally:
            await self._stop_action(action)
        if not question:
            await self.send(client, chat_id, texts.TRANSCRIBE_EMPTY)
            return

        seconds = int(audio.get("duration") or 0)
        cost = transcribe.record_audio_usage(self.db, self.settings, seconds)
        self.state["transcribed"] += 1
        log.info("áudio transcrito (%ss, custo estimado US$ %s)", seconds, cost)
        await self.send(client, chat_id, texts.transcribed(question))
        ok = await self._answer(client, chat_id, question, msg, origin="voz")
        await self._react(client, "✅" if ok else None)

    async def _download_audio(self, client: httpx.AsyncClient, audio: dict[str, Any],
                              mime: str | None) -> bytes:
        """Baixa o arquivo do Telegram (só do chat autorizado) e devolve os bytes."""
        file_id = audio.get("file_id")
        if not file_id:
            raise transcribe.TranscriptionError("áudio sem file_id")
        max_bytes = int(getattr(self.settings, "ai_audio_max_bytes", 20 * 1024 * 1024))
        info = await self._audio_read(lambda: self._get(client, "getFile", {"file_id": file_id}))
        path = str((info or {}).get("file_path") or "")
        if not path:
            raise transcribe.TranscriptionError("Telegram não devolveu o caminho do arquivo")
        size = int(audio.get("file_size") or (info or {}).get("file_size") or 0)
        if size and size > max_bytes:
            raise transcribe.TranscriptionError(f"áudio grande demais ({size} bytes)")
        token = self.settings.telegram_bot_token.get_secret_value()
        r = await self._audio_read(lambda: client.get(
            f"https://api.telegram.org/file/bot{token}/{path}", timeout=httpx.Timeout(90, connect=20)))
        if r.status_code >= 400:
            raise transcribe.TranscriptionError(f"HTTP {r.status_code}")
        data = r.content
        if len(data) > max_bytes:
            raise transcribe.TranscriptionError(f"áudio grande demais ({len(data)} bytes)")
        if not data:
            raise transcribe.TranscriptionError("arquivo vazio")
        return data

    async def _audio_read(self, request: Callable[[], Awaitable[T]]) -> T:
        """Leituras idempotentes: uma segunda tentativa em falhas transitórias de transporte/tempo."""
        for attempt in range(2):
            try:
                return await request()
            except (httpx.TransportError, httpx.TimeoutException):
                if attempt:
                    raise
                await asyncio.sleep(1)
        raise RuntimeError("leitura de áudio não concluída")

    async def _send_html(self, client: httpx.AsyncClient, chat_id: int | str, body: str) -> None:
        await self._call(client, "sendMessage", {"chat_id": chat_id, "text": body, "parse_mode": "HTML",
                                                 **_topic(), "reply_markup": views.keyboard()})

    def _user(self) -> dict[str, Any] | None:
        return self.db.one("SELECT id, username, role FROM local_users WHERE role = 'admin' ORDER BY id LIMIT 1")

    async def _answer(self, client: httpx.AsyncClient, chat_id: int | str, question: str,
                      msg: dict[str, Any], origin: str = "texto") -> bool:
        """Pergunta à IA e entrega. True = o usuário recebeu uma resposta (mesmo que de erro de cota)."""
        user = await self.db.run(self._user)
        if user is None:
            await self.send(client, chat_id, texts.NO_ADMIN)
            return True
        action = asyncio.create_task(self._keep_action(client, chat_id))
        started = time.monotonic()
        try:
            async with self._ai_lock:
                conv = await self._get_conversation(msg)
                try:
                    res = await self._ask(user, question, conv, origin)
                except PermissionError as exc:
                    if "Limite" in str(exc):
                        raise
                    # conversa apagada pela retenção: começa outra
                    res = await self._ask(user, question, None, origin)
                await self._set_conversation(msg, int(res["conversation_id"]))
            self._record_ai_latency(time.monotonic() - started)
        except PermissionError as exc:  # cota diária
            await self.send(client, chat_id, texts.quota_exceeded(exc))
            return True
        except Exception as exc:  # noqa: BLE001 - qualquer falha da IA vira mensagem, nunca derruba o bot
            self.state["ai_failed"] += 1
            log.warning("assistente falhou no Telegram: %s", type(exc).__name__)
            await self.send(client, chat_id, texts.ai_unavailable(type(exc).__name__))
            return False
        finally:
            await self._stop_action(action)
        answer = res["answer"]
        proposal = res.get("proposal")
        if proposal:
            p = proposal.get("proposta") or {}
            answer += texts.proposal(p.get("descricao") or p.get("acao") or "")
        await self.send(client, chat_id, answer)
        self.state["answered"] += 1
        self.state["ai_answered"] += 1
        if await self.db.run(self._voice_enabled):
            await self._speak(client, chat_id, answer)
        return True

    def _record_ai_latency(self, elapsed: float) -> None:
        """Média móvel exponencial: uma resposta lenta pontual não distorce o quadro por muito tempo."""
        prev = self.state["ai_latency_avg_s"]
        self.state["ai_latency_avg_s"] = round(elapsed if prev is None else prev * 0.7 + elapsed * 0.3, 1)

    def _voice_enabled(self) -> bool:
        preference = self.db.get_kv(KV_VOICE)
        return preference == "on" if preference is not None else bool(self.settings.telegram_voice_replies)

    async def _speak(self, client: httpx.AsyncClient, chat_id: int | str, answer: str) -> None:
        stage = "sintese"
        action = asyncio.create_task(self._keep_action(client, chat_id, "record_voice"))
        try:
            audio = await self.speaker.synthesize(answer)
            stage = "envio_telegram"
            payload = {"chat_id": str(chat_id)}
            if (msg := _current_msg.get()) and msg.get("message_thread_id"):
                payload["message_thread_id"] = str(msg["message_thread_id"])
            response = await client.post(
                f"{self._base}/sendVoice", data=payload,
                files={"voice": ("astryon.mp3", audio, "audio/mpeg")},
                timeout=httpx.Timeout(120, connect=20, write=90),
            )
            _check(response, telegram=True)
            if not response.json().get("ok"):
                raise ValueError("Telegram recusou o áudio")
        except Exception as exc:  # noqa: BLE001 - o texto já foi entregue; voz não derruba a conversa
            log.warning("resposta em áudio indisponível (%s): %s", stage, type(exc).__name__)
            message = (texts.VOICE_DELIVERY_UNCONFIRMED
                       if stage == "envio_telegram" and isinstance(exc, httpx.TransportError)
                       else texts.VOICE_UNAVAILABLE)
            await self.send(client, chat_id, message)
        finally:
            await self._stop_action(action)

    async def _ask(self, user: dict[str, Any], question: str, conv: int | None, origin: str = "texto") -> dict[str, Any]:
        return await copilot.ask(self.db, self.settings, self.collector(), user, question, conv,
                                 client=self.ai_client, channel="telegram", origin=origin)
