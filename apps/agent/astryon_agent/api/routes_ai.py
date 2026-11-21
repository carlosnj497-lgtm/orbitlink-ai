"""Assistente (LLM via Groq opcional; regras quando não configurado)."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx
from fastapi import APIRouter, FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from ..ai import copilot, telegram_bot, transcribe
from .deps import Admin, AppContext, Ctx, User

log = logging.getLogger("astryon.ai")
router = APIRouter(prefix="/v1/ai", tags=["assistente"])


class AskBody(BaseModel):
    question: str = Field(min_length=2, max_length=2000)
    conversation_id: int | None = None


@router.get("/status")
def status(c: Ctx, _u: User) -> dict[str, Any]:
    usage = c.db.query("SELECT * FROM ai_usage_daily ORDER BY day DESC LIMIT 30")
    audio_usage = c.db.query("SELECT * FROM ai_audio_usage_daily ORDER BY day DESC LIMIT 30")
    bot = c.extras.get("telegram_bot")
    return {"configured": bool(c.settings.groq_api_key), "model": c.settings.ai_model,
            "daily_limit": c.settings.ai_daily_request_limit, "retention_days": c.settings.ai_conversation_retention_days,
            "usage": usage, "pricing_usd_per_mtok": copilot.PRICING.get(c.settings.ai_model),
            "audio": {"enabled": bool(c.settings.groq_api_key) and bool(c.settings.ai_transcribe_enabled),
                      "model": c.settings.ai_transcribe_model, "daily_limit": c.settings.ai_audio_daily_request_limit,
                      "usage": audio_usage,
                      "pricing_usd_per_hour": transcribe.AUDIO_PRICING_USD_PER_HOUR.get(c.settings.ai_transcribe_model),
                      "telegram": bool(bot and bot.transcriber.enabled()) if bot else False}}


GROQ_MODELS_URL = "https://api.groq.com/openai/v1/models"


@router.post("/test")
async def test_connection(c: Ctx, _a: Admin) -> dict[str, Any]:
    """Confere a chave da Groq listando os modelos (não gasta tokens nem conta no limite diário)."""
    key = c.settings.groq_api_key
    if not key or not key.get_secret_value():
        return {"ok": False, "detail": "Nenhuma chave da Groq definida. O assistente está usando só as regras.",
                "latency_ms": None, "model_available": None}
    started = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=10.0, transport=c.extras.get("groq_test_transport")) as http:
            r = await http.get(GROQ_MODELS_URL, headers={"Authorization": f"Bearer {key.get_secret_value()}"})
    except httpx.HTTPError as exc:
        log.warning("teste da Groq falhou: %s", type(exc).__name__)
        return {"ok": False, "detail": "Não foi possível falar com a Groq. Verifique a internet do servidor.",
                "latency_ms": None, "model_available": None}
    latency = round((time.monotonic() - started) * 1000)
    if r.status_code in (401, 403):
        return {"ok": False, "detail": "A Groq recusou a chave: ela está errada, foi revogada ou expirou.",
                "latency_ms": latency, "model_available": None}
    if r.status_code == 429:
        return {"ok": False, "detail": "A chave é válida, mas a Groq está limitando as requisições agora. Tente de novo em instantes.",
                "latency_ms": latency, "model_available": None}
    if r.status_code >= 400:
        log.warning("teste da Groq HTTP %s", r.status_code)
        return {"ok": False, "detail": f"A Groq respondeu com erro (HTTP {r.status_code}). Tente de novo mais tarde.",
                "latency_ms": latency, "model_available": None}
    try:
        ids = {str(m.get("id")) for m in (r.json() or {}).get("data", []) if isinstance(m, dict)}
    except ValueError:
        ids = set()
    available = (c.settings.ai_model in ids) if ids else None
    detail = "Conexão funcionando." if available is not False else (
        f"A chave funciona, mas o modelo {c.settings.ai_model} não está disponível para ela. "
        "Ajuste ASTRYON_AI_MODEL.")
    return {"ok": available is not False, "detail": detail, "latency_ms": latency, "model_available": available}


@router.post("/ask")
async def ask(c: Ctx, user: User, body: AskBody) -> dict[str, Any]:
    try:
        return await copilot.ask(c.db, c.settings, c.collector, user, body.question, body.conversation_id,
                                 client=c.extras.get("ai_client"))
    except PermissionError as exc:
        raise HTTPException(429 if "Limite" in str(exc) else 404, str(exc)) from exc
    except Exception as exc:
        log.exception("falha no assistente")
        name = type(exc).__name__
        raise HTTPException(502, f"Assistente indisponível no momento ({name}). O diagnóstico por regras continua "
                                 "disponível na Visão Geral.") from exc


@router.post("/transcribe")
async def transcribe_audio(c: Ctx, _u: User, file: UploadFile = File(...)) -> dict[str, str]:
    """Transcreve uma nota de voz enviada pelo navegador (WebRTC/MediaRecorder) usando Whisper da Groq.

    O arquivo NÃO é salvo em disco: lido para memória, transcrito e descartado.
    """
    transcriber = transcribe.Transcriber(c.settings, transport=c.extras.get("audio_transport"))
    if not transcriber.enabled():
        raise HTTPException(403, "Transcrição de áudio desativada ou não configurada.")
    try:
        max_bytes = c.settings.ai_audio_max_bytes
        # Lê no máximo um byte além do permitido; uploads gigantes não são carregados inteiros na memória.
        data = await file.read(max_bytes + 1)
        if len(data) > max_bytes:
            raise HTTPException(413, f"Áudio grande demais: o limite é {max_bytes} bytes.")
        await c.db.run(transcribe.reserve_audio_quota, c.db, c.settings)
        text = await transcriber.transcribe(
            data, mime=file.content_type or "audio/webm", filename=file.filename or "audio.webm"
        )
        seconds = max(1, len(data) // 16000)  # estimativa grossa só para contabilidade
        transcribe.record_audio_usage(c.db, c.settings, seconds)
        return {"text": text}
    except PermissionError as exc:
        raise HTTPException(429, str(exc)) from exc
    except transcribe.TranscriptionError as exc:
        raise HTTPException(502, f"Não foi possível transcrever o áudio: {exc}") from exc


@router.get("/conversations")
def conversations(c: Ctx, user: User) -> dict[str, Any]:
    return {"conversations": c.db.query("SELECT id, title, created_at, updated_at FROM ai_conversations WHERE user_id = ? "
                                        "ORDER BY updated_at DESC LIMIT 50", (user["id"],))}


@router.get("/conversations/{cid}")
def conversation(c: Ctx, user: User, cid: int) -> dict[str, Any]:
    owner = c.db.scalar("SELECT user_id FROM ai_conversations WHERE id = ?", (cid,))
    if owner != user["id"]:
        raise HTTPException(404, "Conversa não encontrada")
    return {"messages": c.db.query("SELECT role, content, tools_json, created_at FROM ai_messages WHERE conversation_id = ? "
                                   "ORDER BY id", (cid,))}


@router.delete("/conversations/{cid}", status_code=204)
def delete_conversation(c: Ctx, user: User, cid: int) -> None:
    c.db.execute("DELETE FROM ai_conversations WHERE id = ? AND user_id = ?", (cid, user["id"]))


def register(app: FastAPI) -> None:
    async def start(ctx: AppContext) -> None:
        async def purge_loop() -> None:
            while True:
                try:
                    await asyncio.to_thread(copilot.purge_old, ctx.db, ctx.settings.ai_conversation_retention_days)
                except Exception:  # noqa: BLE001 - a limpeza tenta de novo no próximo ciclo
                    log.exception("falha ao apagar conversas antigas do assistente")
                await asyncio.sleep(6 * 3600)

        ctx.extras["ai_purge_task"] = asyncio.create_task(purge_loop(), name="ai-purge")
        if telegram_bot.enabled(ctx.settings):
            bot = telegram_bot.TelegramBot(ctx.db, ctx.settings, lambda: ctx.collector, ai_client=ctx.extras.get("ai_client"),
                                           transport=ctx.extras.get("telegram_transport"),
                                           audio_transport=ctx.extras.get("audio_transport"))
            ctx.extras["telegram_bot"] = bot
            ctx.extras["telegram_bot_task"] = asyncio.create_task(bot.run(), name="telegram-bot")

    async def stop(ctx: AppContext) -> None:
        bot = ctx.extras.get("telegram_bot")
        if bot:
            await bot.stop()
        for key in ("ai_purge_task", "telegram_bot_task"):
            t = ctx.extras.get(key)
            if t:
                t.cancel()

    app.state.startup_hooks.append(start)
    app.state.shutdown_hooks.append(stop)
