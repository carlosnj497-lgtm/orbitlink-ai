"""Bot do Telegram que responde perguntas com o copiloto (o mesmo do painel).

Segurança:
* Long polling (getUpdates): o agente busca as mensagens; nenhuma porta fica aberta para a internet.
* Só responde ao chat configurado em ORBITLINK_TELEGRAM_CHAT_ID. Qualquer outro chat é ignorado em silêncio
  (nada é respondido, e o conteúdo não vai para o log).
* A IA continua somente leitura. Se ela propuser uma ação (ex.: reiniciar), o bot só repassa a proposta e manda
  confirmar no painel. Nada é executado a partir do Telegram.
* Cota diária do assistente vale aqui também, mais um limite por minuto contra rajadas.
* O token do bot nunca é registrado (a redação de logs remove /bot<token> e o httpx fica em WARNING).
* Nota de voz: o áudio é transcrito pelo Whisper da Groq e nunca fica salvo em disco. O texto transcrito
  entra no mesmo histórico da conversa e o chat não autorizado não tem o áudio baixado.
"""

from __future__ import annotations

import asyncio
import html
import logging
import re
import time
from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Any, TypeVar
from zoneinfo import ZoneInfo

import httpx

from ..alerts.notify import PermanentError, RetryLater, _check
from ..auth.local import RateLimiter
from ..reports import digest
from ..storage.db import Database, now_ts
from . import copilot, speech, transcribe
from . import telegram_views as views

log = logging.getLogger("orbitlink.telegram")
T = TypeVar("T")

KV_OFFSET = "telegram:offset"
KV_CONVERSATION = "telegram:conversation"
KV_VOICE = "telegram:voice_replies"
STALE_AFTER_S = 15 * 60  # mensagem que chega com o agente fora do ar há mais que isso não é respondida pela IA
MAX_CHUNK = 3500  # o Telegram aceita 4096; folga para as tags HTML
POLL_TIMEOUT_S = 25

HELP = (
    "🛰️ <b>ASTRYON · Central da sua Starlink</b>\n"
    "Consulte os dados pelos botões ou converse comigo em português.\n\n"
    "Exemplos:\n"
    "- Como está a conexão agora?\n"
    "- Quanto consumi este mês? Vou passar da franquia?\n"
    "- Teve queda hoje? Por quê?\n\n"
    "Comandos:\n"
    "/menu: abrir a central de consultas\n"
    "/status: diagnóstico rápido por regras (não usa IA)\n"
    "/consumo: download e upload estimados\n"
    "/franquia: saldo e projeção do ciclo\n"
    "/qualidade: latência, perda e disponibilidade\n"
    "/quedas: interrupções recentes\n"
    "/alertas: alertas ativos\n"
    "/resumo: consumo, quedas e qualidade dos últimos 7 dias\n"
    "/bot: recursos, cotas e notificações\n"
    "/nova: começa uma conversa nova\n"
    "/audio ligar ou /audio desligar: respostas faladas do assistente\n"
    "/ajuda: esta mensagem\n\n"
    "Períodos: /consumo 7d, /qualidade 1h ou /quedas 24h.\n"
    "Opções: 1h, 6h, 24h, 7d e 30d. Padrão: 24h.\n\n"
    "As consultas por comando não gastam IA.\n"
    "Você pode mandar sua pergunta por áudio (nota de voz), quando a transcrição estiver ativada.\n"
    "Ações como reiniciar a antena só são confirmadas no painel."
)


def enabled(settings: Any) -> bool:
    tok = getattr(settings, "telegram_bot_token", None)
    return bool(getattr(settings, "telegram_chat_enabled", True) and tok and tok.get_secret_value()
                and getattr(settings, "telegram_chat_id", None))


def to_html(md: str) -> str:
    """Markdown simples do copiloto -> HTML aceito pelo Telegram (b, i, code). Todo o resto é escapado."""
    out = []
    for line in html.escape(md, quote=False).split("\n"):
        m = re.match(r"^\s*#{1,6}\s+(.*)$", line)
        if m:
            line = f"<b>{m.group(1).strip()}</b>"
        elif re.match(r"^\s*\|?\s*:?-{3,}", line):  # separador de tabela, se o modelo insistir em tabela
            continue
        out.append(line)
    text = "\n".join(out)
    text = re.sub(r"`([^`\n]+)`", r"<code>\1</code>", text)
    text = re.sub(r"\*\*([^*\n]+)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"(?<![\w*])_([^_\n]+)_(?![\w*])", r"<i>\1</i>", text)
    return text


def chunks(text: str, size: int = MAX_CHUNK) -> list[str]:
    """Divide em pedaços de até `size` caracteres, preferindo quebrar em parágrafo ou linha."""
    parts: list[str] = []
    rest = text.strip()
    while len(rest) > size:
        cut = rest.rfind("\n\n", 0, size)
        if cut < size // 2:
            cut = rest.rfind("\n", 0, size)
        if cut < size // 2:
            cut = size
        parts.append(rest[:cut].rstrip())
        rest = rest[cut:].lstrip()
    if rest:
        parts.append(rest)
    return parts


class TelegramBot:
    def __init__(self, db: Database, settings: Any, collector: Callable[[], Any] = lambda: None,
                 transport: httpx.AsyncBaseTransport | None = None, ai_client: Any = None,
                 poll_timeout: int = POLL_TIMEOUT_S, audio_transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.db = db
        self.settings = settings
        self.collector = collector
        self.ai_client = ai_client
        self.poll_timeout = poll_timeout
        self._transport = transport
        self.limiter = RateLimiter(int(getattr(settings, "telegram_chat_per_minute", 6)), 60)
        # O transcritor fala com a Groq, não com o Telegram: transport separado (o do Telegram carrega o token
        # na URL e rejeita qualquer requisição para fora da Bot API).
        self.transcriber = transcribe.Transcriber(settings, transport=audio_transport)
        self.speaker = speech.Speaker(settings)
        self.state: dict[str, Any] = {"running": False, "last_poll_ok": None, "last_error": None,
                                      "answered": 0, "ignored_chats": 0, "transcribed": 0, "offset_reset": False}

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
        parts = chunks(markdown, 1800)
        for index, part in enumerate(parts):
            extra = {"reply_markup": views.keyboard(section)} if section and index == len(parts) - 1 else {}
            try:
                await self._call(client, "sendMessage", {"chat_id": chat_id, "text": to_html(part), "parse_mode": "HTML",
                                                         "disable_web_page_preview": True, **extra})
            except PermanentError:
                # HTML recusado ("can't parse entities"): manda como texto puro em vez de perder a resposta
                await self._call(client, "sendMessage", {"chat_id": chat_id, "text": part,
                                                         "disable_web_page_preview": True, **extra})

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
        self.db.set_kv(KV_OFFSET, "0")
        self.state["offset_reset"] = True

    async def poll_once(self, client: httpx.AsyncClient) -> int:
        stored = self.db.get_kv(KV_OFFSET)
        if stored is None:
            # Primeira vez: o que já estava esperando no Telegram (ex.: o "oi" usado para descobrir o chat_id)
            # é descartado sem resposta. Dizer "o agente estava fora do ar" seria falso.
            old = await self._call(client, "getUpdates", {"offset": -1, "timeout": 0}) or []
            # Fica com o update_id mais alto da fila: assim tudo que já estava esperando é pulado de uma vez.
            self.db.set_kv(KV_OFFSET, str(int(old[-1]["update_id"]) + 1) if old else "0")
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
            self.db.set_kv(KV_OFFSET, str(int(up["update_id"]) + 1))
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
                            await self.send(client, original["chat"]["id"],
                                            "Não consegui concluir esta consulta agora. Tente novamente em instantes.",
                                            section="erro")
                        except (httpx.HTTPError, PermanentError, RetryLater):
                            pass
        self.state["last_poll_ok"] = now_ts()
        return len(updates)

    async def run(self) -> None:
        self.state["running"] = True
        failures = 0
        async with self._client() as client:
            try:
                await self._call(client, "setMyCommands", {
                    "commands": [{"command": key, "description": value} for key, value in views.COMMANDS.items()],
                    "scope": {"type": "chat", "chat_id": self.settings.telegram_chat_id},
                })
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
    def _authorized(self, msg: dict[str, Any]) -> bool:
        return str((msg.get("chat") or {}).get("id")) == str(self.settings.telegram_chat_id).strip()

    async def handle_callback(self, client: httpx.AsyncClient, callback: dict[str, Any]) -> None:
        msg = callback.get("message") or {}
        if not self._authorized(msg):
            self.state["ignored_chats"] += 1
            return
        data = str(callback.get("data") or "")
        action = data.removeprefix("ol:")
        bits = action.split()
        valid = (data.startswith("ol:") and bool(bits) and bits[0] in views.COMMANDS
                 and (len(bits) == 1 or len(bits) == 2 and bits[0] in views.REPORTS and bits[1] in views.PERIODS))
        await self._call(client, "answerCallbackQuery", {
            "callback_query_id": callback["id"],
            "text": "" if valid else "Este botão expirou. Abra /menu.",
        })
        if valid:
            # A data do cartão é antiga, mas o clique é uma interação nova.
            await self.handle(client, {"chat": msg["chat"], "text": f"/{action}", "date": now_ts()})

    async def handle(self, client: httpx.AsyncClient, msg: dict[str, Any]) -> None:
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
            await self.send(client, chat_id, "Só entendo texto ou áudio. Escreva a sua pergunta ou mande uma nota de voz.")
            return
        cmd = text.split()[0].split("@")[0].lower() if text.startswith("/") else ""
        if cmd in ("/start", "/menu", "/ajuda", "/help"):
            await self._send_html(client, chat_id, HELP)
            return
        if cmd == "/audio":
            option = text.split()[1:]
            if option == ["ligar"]:
                self.db.set_kv(KV_VOICE, "on")
            elif option == ["desligar"]:
                self.db.set_kv(KV_VOICE, "off")
            elif option:
                await self.send(client, chat_id, "Use /audio ligar ou /audio desligar.")
                return
            state = "ativadas" if self._voice_enabled() else "desativadas"
            await self.send(client, chat_id, f"🔊 Respostas em áudio {state}.\n"
                            "O assistente envia texto e voz. Consultas por comando continuam em texto.\n"
                            "Use /audio ligar ou /audio desligar. Voz online: Microsoft Edge.",
                            section="audio")
            return
        if cmd == "/nova":
            self.db.execute("DELETE FROM settings_kv WHERE key = ?", (KV_CONVERSATION,))
            await self.send(client, chat_id, "💬 Conversa nova. Pode perguntar.\n"
                            "O contexto anterior foi desvinculado; o histórico continua disponível no painel.", section="menu")
            return
        if cmd.lstrip("/") in views.REPORTS | {"franquia", "alertas", "bot"}:
            command = cmd.lstrip("/")
            args = text.split()[1:]
            if args and (command not in views.REPORTS or len(args) != 1 or args[0] not in views.PERIODS):
                await self.send(client, chat_id, "Período inválido. Use 1h, 6h, 24h, 7d ou 30d.\n"
                                f"Exemplo: /{command} 7d" if command in views.REPORTS else f"Use /{command} sem argumentos.",
                                section=command)
                return
            period = args[0] if args else "24h"
            body = await asyncio.to_thread(views.render, self.db, self.settings, command, period)
            await self.send(client, chat_id, body, section=command)
            return
        if cmd == "/resumo":
            text = await asyncio.to_thread(digest.build_rolling, self.db, self.settings)
            await self.send(client, chat_id, text or "Ainda não há dados observados nos últimos 7 dias.", section="resumo")
            return
        if cmd == "/status":
            answer = await asyncio.to_thread(copilot.rules_answer, self.db, self.settings, self.collector())
            answer = answer.split("\nPara perguntas livres")[0].replace(
                " (assistente de IA não configurado)", " · consulta sem IA")
            await self.send(client, chat_id, answer, section="status")
            return
        if cmd:
            await self._send_html(client, chat_id, "Comando desconhecido.\n\n" + HELP)
            return

        age = now_ts() - int(msg.get("date") or now_ts())
        if age > STALE_AFTER_S:
            await self._stale_notice(client, chat_id, msg)
            return
        if not self.limiter.allow(str(chat_id)):
            await self.send(client, chat_id, "Muitas perguntas em sequência. Espere um minuto e tente de novo.")
            return
        await self._answer(client, chat_id, text)

    async def _stale_notice(self, client: httpx.AsyncClient, chat_id: int | str, msg: dict[str, Any]) -> None:
        tz = ZoneInfo(getattr(self.settings, "timezone", "UTC"))
        when = datetime.fromtimestamp(int(msg["date"]), tz).strftime("%d/%m %H:%M")
        await self.send(client, chat_id, f"Recebi agora a sua mensagem de {when} (o agente estava fora do ar). "
                                         "Pergunte de novo se ainda precisar: a resposta seria sobre o estado atual.")

    # ------------------------------------------------------------------ áudio (nota de voz)
    async def _handle_audio(self, client: httpx.AsyncClient, chat_id: int | str, msg: dict[str, Any],
                            audio: dict[str, Any]) -> None:
        """Nota de voz: transcreve com o Whisper da Groq e responde como se fosse texto."""
        if not self.transcriber.enabled():
            await self.send(client, chat_id, "O reconhecimento de áudio está desativado neste agente. "
                                             "Escreva a sua pergunta e eu respondo.")
            return
        # Mensagem antiga (agente fora do ar): não gasta transcrição nem responde com estado desatualizado.
        age = now_ts() - int(msg.get("date") or now_ts())
        if age > STALE_AFTER_S:
            await self._stale_notice(client, chat_id, msg)
            return
        if not self.limiter.allow(str(chat_id)):
            await self.send(client, chat_id, "Muitas perguntas em sequência. Espere um minuto e tente de novo.")
            return
        try:
            transcribe.check_audio_quota(self.db, self.settings)
        except PermissionError as exc:
            await self.send(client, chat_id, f"{exc} Use /status para o diagnóstico por regras.")
            return

        mime = str(audio.get("mime_type") or "") or None
        try:
            data = await self._download_audio(client, audio, mime)
        except transcribe.TranscriptionError as exc:
            log.warning("não consegui baixar o áudio do Telegram: %s", exc)
            await self.send(client, chat_id, "Não consegui baixar o seu áudio. Mande de novo ou escreva a pergunta.")
            return
        except (httpx.HTTPError, PermanentError, RetryLater) as exc:
            log.warning("falha ao baixar o áudio do Telegram: %s", type(exc).__name__)
            await self.send(client, chat_id, "Não consegui baixar o seu áudio agora. Tente de novo em instantes.")
            return

        # O arquivo pode ser Opus (.ogg) ou outro formato; a extensão decide o mime enviado ao Whisper.
        name = transcribe.filename_for(mime, transcribe.extension_from_path(str(audio.get("file_path") or "")))
        try:
            await self._call(client, "sendChatAction", {"chat_id": chat_id, "action": "typing"})
        except (httpx.HTTPError, PermanentError, RetryLater):
            pass  # só cosmético
        try:
            question = await self.transcriber.transcribe(data, mime, name)
        except transcribe.TranscriptionError as exc:
            log.warning("transcrição falhou: %s", exc)
            await self.send(client, chat_id, "Não consegui transcrever o seu áudio. "
                                             "Escreva a pergunta ou mande a nota de voz de novo.")
            return
        except httpx.HTTPError as exc:
            log.warning("transcrição falhou: %s", type(exc).__name__)
            await self.send(client, chat_id, "O serviço de transcrição está indisponível agora. "
                                             "Use /status para o diagnóstico por regras.")
            return
        if not question:
            await self.send(client, chat_id, "Não ouvi nada de útil no áudio. Tente de novo, mais perto do microfone.")
            return

        seconds = int(audio.get("duration") or 0)
        cost = transcribe.record_audio_usage(self.db, self.settings, seconds)
        self.state["transcribed"] += 1
        log.info("áudio transcrito (%ss, custo estimado US$ %s)", seconds, cost)
        await self.send(client, chat_id, f"🎙 «{question}»")
        await self._answer(client, chat_id, question, origin="voz")

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
        """Leituras idempotentes: uma segunda tentativa em falhas transitórias de transporte."""
        for attempt in range(2):
            try:
                return await request()
            except httpx.TransportError:
                if attempt:
                    raise
                await asyncio.sleep(1)
        raise RuntimeError("leitura de áudio não concluída")

    async def _send_html(self, client: httpx.AsyncClient, chat_id: int | str, body: str) -> None:
        await self._call(client, "sendMessage", {"chat_id": chat_id, "text": body, "parse_mode": "HTML",
                                               "reply_markup": views.keyboard()})

    def _user(self) -> dict[str, Any] | None:
        return self.db.one("SELECT id, username, role FROM local_users WHERE role = 'admin' ORDER BY id LIMIT 1")

    async def _answer(self, client: httpx.AsyncClient, chat_id: int | str, question: str, origin: str = "texto") -> None:
        user = self._user()
        if user is None:
            await self.send(client, chat_id, "Crie primeiro o administrador no painel do OrbitLink; depois pergunte aqui.")
            return
        try:
            await self._call(client, "sendChatAction", {"chat_id": chat_id, "action": "typing"})
        except (httpx.HTTPError, PermanentError, RetryLater):
            pass  # só cosmético
        conv = self.db.get_kv(KV_CONVERSATION)
        try:
            try:
                res = await self._ask(user, question, int(conv) if conv else None, origin)
            except PermissionError as exc:
                if "Limite" in str(exc):
                    raise
                # conversa apagada pela retenção: começa outra
                res = await self._ask(user, question, None, origin)
        except PermissionError as exc:  # cota diária
            await self.send(client, chat_id, f"{exc} Use /status para o diagnóstico por regras.")
            return
        except Exception as exc:  # noqa: BLE001 - qualquer falha da IA vira mensagem, nunca derruba o bot
            log.warning("assistente falhou no Telegram: %s", type(exc).__name__)
            await self.send(client, chat_id, f"Assistente indisponível agora ({type(exc).__name__}). "
                                             "Use /status para o diagnóstico por regras.")
            return
        self.db.set_kv(KV_CONVERSATION, str(res["conversation_id"]))
        answer = res["answer"]
        proposal = res.get("proposal")
        if proposal:
            p = proposal.get("proposta") or {}
            answer += (f"\n\n⚠️ **Proposta: {p.get('descricao') or p.get('acao')}.** Nada foi executado. "
                       "Para confirmar, abra o painel em Controle da Starlink.")
        await self.send(client, chat_id, answer)
        self.state["answered"] += 1
        if self._voice_enabled():
            await self._speak(client, chat_id, answer)

    def _voice_enabled(self) -> bool:
        preference = self.db.get_kv(KV_VOICE)
        return preference == "on" if preference is not None else bool(self.settings.telegram_voice_replies)

    async def _speak(self, client: httpx.AsyncClient, chat_id: int | str, answer: str) -> None:
        stage = "sintese"
        try:
            try:
                await self._call(client, "sendChatAction", {"chat_id": chat_id, "action": "record_voice"})
            except (httpx.HTTPError, PermanentError, RetryLater):
                pass
            audio = await self.speaker.synthesize(answer)
            stage = "envio_telegram"
            response = await client.post(
                f"{self._base}/sendVoice", data={"chat_id": str(chat_id)},
                files={"voice": ("orbitlink.mp3", audio, "audio/mpeg")},
                timeout=httpx.Timeout(120, connect=20, write=90),
            )
            _check(response, telegram=True)
            if not response.json().get("ok"):
                raise ValueError("Telegram recusou o áudio")
        except Exception as exc:  # noqa: BLE001 - o texto já foi entregue; voz não derruba a conversa
            log.warning("resposta em áudio indisponível (%s): %s", stage, type(exc).__name__)
            message = ("Não consegui confirmar a entrega da voz agora. A resposta completa está no texto acima."
                       if stage == "envio_telegram" and isinstance(exc, httpx.TransportError)
                       else "Não consegui enviar a voz agora. A resposta completa está no texto acima.")
            await self.send(client, chat_id, message)

    async def _ask(self, user: dict[str, Any], question: str, conv: int | None, origin: str = "texto") -> dict[str, Any]:
        return await copilot.ask(self.db, self.settings, self.collector(), user, question, conv,
                                 client=self.ai_client, channel="telegram", origin=origin)
