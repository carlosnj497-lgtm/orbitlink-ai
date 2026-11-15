"""Relatórios/exportação e importação de CSV de consumo."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ..reports import builder, insights, monthly
from ..usage import importer
from .deps import Admin, AppContext, Ctx, User
from .routes_data import EndQ, RangeQ, StartQ, _terminal, resolve_range
from .routes_settings import public_settings

router = APIRouter(prefix="/v1", tags=["relatorios"])


@router.get("/reports/export")
async def export(c: Ctx, _u: User, fmt: Literal["csv", "json", "pdf"] = "pdf", start: StartQ = None, end: EndQ = None,
                 rng: RangeQ = None) -> Response:
    s, e = resolve_range(start, end, rng, default="30d")
    tid = _terminal(c, None)
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M")
    if fmt == "csv":
        body = await asyncio.to_thread(builder.to_csv, c.db, tid, s, e, c.settings.timezone)
        return Response("﻿" + body, media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="orbitlink-{stamp}.csv"'})
    if fmt == "json":
        body = await asyncio.to_thread(builder.to_json, c.db, tid, s, e, c.settings.timezone, public_settings(c))
        return Response(body, media_type="application/json",
                        headers={"Content-Disposition": f'attachment; filename="orbitlink-backup-{stamp}.json"'})
    pdf = await asyncio.to_thread(builder.to_pdf, c.db, tid, s, e, c.settings.timezone, c.settings.terminal_name)
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="orbitlink-relatorio-{stamp}.pdf"'})


class CsvBody(BaseModel):
    filename: str = Field(max_length=200)
    content: str = Field(max_length=2_500_000)


class CommitBody(CsvBody):
    mapping: dict[str, str]


@router.post("/usage/import/preview")
def import_preview(c: Ctx, _a: Admin, body: CsvBody) -> dict[str, Any]:
    try:
        return importer.preview(c.db, body.filename, body.content)
    except (ValueError, UnicodeError) as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/usage/import/commit")
def import_commit(c: Ctx, _a: Admin, body: CommitBody) -> dict[str, Any]:
    try:
        return importer.commit(c.db, body.filename, body.content, body.mapping, c.settings.timezone)
    except (ValueError, UnicodeError) as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/reports/telegram")
async def report_to_telegram(c: Ctx, _a: Admin, start: StartQ = None, end: EndQ = None, rng: RangeQ = None) -> dict[str, Any]:
    """Gera o PDF do período (padrão: 30 dias) e envia ao chat do Telegram."""
    if not (c.settings.telegram_bot_token and c.settings.telegram_chat_id):
        raise HTTPException(409, "Telegram não configurado. Defina ORBITLINK_TELEGRAM_BOT_TOKEN e ORBITLINK_TELEGRAM_CHAT_ID.")
    s, e = resolve_range(start, end, rng, default="30d")
    pdf, caption = await asyncio.to_thread(monthly.build, c.db, c.settings, s, e, (2 * s - e, s))
    ok = await monthly.send_pdf(c.settings, pdf, caption.replace("Relatório do ciclo", "Relatório"),
                                f"astryon-relatorio-{datetime.now(UTC):%Y%m%d-%H%M}.pdf")
    if not ok:
        raise HTTPException(502, "O Telegram recusou o envio do relatório.")
    return {"ok": True}


@router.get("/insights/compare")
async def insights_compare(c: Ctx, _u: User, start: StartQ = None, end: EndQ = None, rng: RangeQ = None) -> dict[str, Any]:
    s, e = resolve_range(start, end, rng, default="7d")
    return await asyncio.to_thread(insights.compare, c.db, c.settings, s, e)


@router.get("/insights/best-hours")
async def insights_best_hours(c: Ctx, _u: User, days: int = 14) -> dict[str, Any]:
    return await asyncio.to_thread(insights.best_hours, c.db, c.settings, max(3, min(days, 60)))


def register(app: FastAPI) -> None:
    async def start(ctx: AppContext) -> None:
        ctx.extras["monthly_task"] = asyncio.create_task(monthly.run(ctx.db, ctx.settings), name="monthly-report")

    async def stop(ctx: AppContext) -> None:
        t = ctx.extras.get("monthly_task")
        if t:
            t.cancel()

    app.state.startup_hooks.append(start)
    app.state.shutdown_hooks.append(stop)
