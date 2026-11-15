"""Saúde do servidor, aviso de volta após ficar fora do ar e vigia externo opcional."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, FastAPI

from ..alerts.notify import Notifier
from ..ops import backup, health
from .deps import Admin, AppContext, Ctx, User

router = APIRouter(prefix="/v1/ops", tags=["servidor"])


@router.get("/health")
def server_health(c: Ctx, _u: User) -> dict[str, Any]:
    return health.server_health(c.db, c.settings)


@router.post("/backup")
async def backup_now(c: Ctx, _a: Admin) -> dict[str, Any]:
    """Faz um backup agora e o envia ao Telegram (se configurado)."""
    return await backup.run_once(c.db, c.settings, force=True)


def register(app: FastAPI) -> None:
    async def start(ctx: AppContext) -> None:
        # Roda antes do coletor gravar o primeiro heartbeat desta execução.
        ev = await ctx.db.run(health.downtime_notice, ctx.db, ctx.settings)
        if ev:
            await ctx.db.run(Notifier(ctx.db, ctx.settings).enqueue, ev)
        if ctx.settings.backup_enabled:
            ctx.extras["backup_task"] = asyncio.create_task(backup.run(ctx.db, ctx.settings), name="backup")
        if ctx.settings.healthcheck_url:
            ctx.extras["healthcheck_task"] = asyncio.create_task(health.healthcheck_loop(ctx.settings), name="healthcheck")

    async def stop(ctx: AppContext) -> None:
        for key in ("healthcheck_task", "backup_task"):
            t = ctx.extras.get(key)
            if t:
                t.cancel()

    app.state.startup_hooks.append(start)
    app.state.shutdown_hooks.append(stop)
