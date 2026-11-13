"""Relatórios/exportação e importação de CSV de consumo."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ..reports import builder
from ..usage import importer
from .deps import Admin, Ctx, User
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
