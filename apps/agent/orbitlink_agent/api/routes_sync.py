"""Estado e disparo manual da sincronização com Supabase."""

from __future__ import annotations

import asyncio
from typing import Any

import httpx
from fastapi import APIRouter, FastAPI, HTTPException

from ..sync import worker
from .deps import Admin, AppContext, Ctx, User

router = APIRouter(prefix="/v1/sync", tags=["sincronizacao"])


@router.get("")
def sync_state(c: Ctx, _u: User) -> dict[str, Any]:
    s = c.settings
    return {
        "configured": bool(s.supabase_url and s.supabase_anon_key and s.supabase_agent_token),
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


def register(app: FastAPI) -> None:
    async def start(ctx: AppContext) -> None:
        s = ctx.settings
        state: dict[str, Any] = {}
        ctx.extras["sync_state"] = state
        if s.supabase_url and s.supabase_anon_key and s.supabase_agent_token:
            ctx.extras["sync_task"] = asyncio.create_task(
                worker.run(ctx.db, s, state, lambda: ctx.collector and ctx.collector.state.dish_reachable), name="sync")

    async def stop(ctx: AppContext) -> None:
        t = ctx.extras.get("sync_task")
        if t:
            t.cancel()

    app.state.startup_hooks.append(start)
    app.state.shutdown_hooks.append(stop)
