"""Assistente (Claude opcional; regras quando não configurado)."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, FastAPI, HTTPException
from pydantic import BaseModel, Field

from ..ai import copilot
from .deps import AppContext, Ctx, User

log = logging.getLogger("orbitlink.ai")
router = APIRouter(prefix="/v1/ai", tags=["assistente"])


class AskBody(BaseModel):
    question: str = Field(min_length=2, max_length=2000)
    conversation_id: int | None = None


@router.get("/status")
def status(c: Ctx, _u: User) -> dict[str, Any]:
    usage = c.db.query("SELECT * FROM ai_usage_daily ORDER BY day DESC LIMIT 30")
    return {"configured": bool(c.settings.anthropic_api_key), "model": c.settings.ai_model,
            "daily_limit": c.settings.ai_daily_request_limit, "retention_days": c.settings.ai_conversation_retention_days,
            "usage": usage, "pricing_usd_per_mtok": copilot.PRICING.get(c.settings.ai_model)}


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
                await asyncio.to_thread(copilot.purge_old, ctx.db, ctx.settings.ai_conversation_retention_days)
                await asyncio.sleep(6 * 3600)

        ctx.extras["ai_purge_task"] = asyncio.create_task(purge_loop(), name="ai-purge")

    async def stop(ctx: AppContext) -> None:
        t = ctx.extras.get("ai_purge_task")
        if t:
            t.cancel()

    app.state.startup_hooks.append(start)
    app.state.shutdown_hooks.append(stop)
