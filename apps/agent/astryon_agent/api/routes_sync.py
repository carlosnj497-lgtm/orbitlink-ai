"""Estado e disparo manual da sincronização com Supabase."""

from __future__ import annotations

import asyncio
from typing import Any

import httpx
from fastapi import APIRouter, FastAPI, HTTPException
from pydantic import BaseModel, Field

from ..sync import pairing, worker
from .deps import Admin, AppContext, Ctx, User

router = APIRouter(prefix="/v1/sync", tags=["sincronizacao"])


@router.get("")
def sync_state(c: Ctx, _u: User) -> dict[str, Any]:
    p = pairing.info(c.db, c.settings)
    return {
        "configured": p["cloud_configured"] and p["paired"],
        "pairing": p,
        "pending": c.db.scalar("SELECT COUNT(*) FROM sync_queue WHERE synced_at IS NULL"),
        "failed_attempts": c.db.scalar("SELECT COALESCE(MAX(attempts),0) FROM sync_queue WHERE synced_at IS NULL"),
        "state": c.extras.get("sync_state", {}),
    }


@router.post("/now")
async def sync_now(c: Ctx, _a: Admin) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient() as client:
            return await worker.push_once(c.db, c.settings, client, bool(c.collector and c.collector.state.dish_reachable))
    except Exception as exc:
        raise HTTPException(502, f"Sincronização falhou: {type(exc).__name__}. Os dados continuam na fila local.") from exc


class PairBody(BaseModel):
    code: str = Field(min_length=8, max_length=20)
    name: str | None = Field(default=None, max_length=60)


@router.post("/pair")
async def pair(c: Ctx, _a: Admin, body: PairBody) -> dict[str, Any]:
    """Liga este agente à conta na nuvem com o código gerado no painel da conta."""
    try:
        res = await pairing.claim(c.db, c.settings, body.code, body.name)
    except pairing.PairingError as exc:
        raise HTTPException(400, str(exc)) from exc
    _ensure_task(c)
    return res


@router.delete("/pair")
async def unpair(c: Ctx, _a: Admin) -> dict[str, Any]:
    """Desliga este agente da conta (só aqui; para revogar o acesso, remova o agente no painel da conta)."""
    await asyncio.to_thread(pairing.unpair, c.db)
    t = c.extras.pop("sync_task", None)
    if t:
        t.cancel()
    return pairing.info(c.db, c.settings)


def _ensure_task(ctx: AppContext) -> None:
    t = ctx.extras.get("sync_task")
    if t is not None and not t.done():
        return
    if pairing.cloud_configured(ctx.settings) and pairing.agent_token(ctx.db, ctx.settings):
        ctx.extras["sync_task"] = asyncio.create_task(
            worker.run(ctx.db, ctx.settings, ctx.extras["sync_state"],
                       lambda: ctx.collector and ctx.collector.state.dish_reachable), name="sync")


def register(app: FastAPI) -> None:
    async def start(ctx: AppContext) -> None:
        ctx.extras["sync_state"] = {}
        _ensure_task(ctx)

    async def stop(ctx: AppContext) -> None:
        t = ctx.extras.get("sync_task")
        if t:
            t.cancel()

    app.state.startup_hooks.append(start)
    app.state.shutdown_hooks.append(stop)
