"""Rotas de controle (ações modificadoras) e diagnóstico."""

from __future__ import annotations

import asyncio
from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..control import service as control
from ..diagnostics import engine
from .deps import Admin, Ctx, User
from .routes_data import EndQ, RangeQ, StartQ, _terminal, resolve_range

router = APIRouter(prefix="/v1", tags=["controle"])


class PrepareBody(BaseModel):
    action: str = Field(pattern=r"^[a-z_]{3,40}$")
    reason: str | None = Field(default=None, max_length=200)


class ConfirmBody(BaseModel):
    operation_id: str = Field(pattern=r"^[0-9a-f]{32}$")
    nonce: str = Field(min_length=10, max_length=64)
    confirm_text: str = Field(max_length=40)


@router.get("/control/actions")
def actions(c: Ctx, _u: User) -> dict[str, Any]:
    out = []
    for key, spec in control.ACTIONS.items():
        cap = c.collector.capability(spec["capability"]) if c.collector else None
        out.append({
            "action": key, "label": spec["label"], "consequences": spec["consequences"],
            "capability": cap.model_dump(mode="json") if cap else None,
            "enabled": control.capability_allows(cap),
            "reason": None if control.capability_allows(cap) else
            (cap.detail if cap else "Matriz de capacidades ainda não verificada (antena inacessível?)."),
        })
    return {"actions": out, "policy": "Ações exigem administrador, confirmação manual com código de uso único e são auditadas. "
                                      "Factory reset não é oferecido."}


@router.post("/control/prepare")
def prepare(c: Ctx, user: Admin, body: PrepareBody) -> dict[str, Any]:
    spec = control.ACTIONS.get(body.action)
    cap = c.collector.capability(spec["capability"]) if (c.collector and spec) else None
    try:
        p = control.prepare(c.db, cap, body.action, user, c.settings.dish_target, "ui", body.reason)
    except control.ControlError as exc:
        raise HTTPException(exc.status, exc.message) from exc
    return asdict(p)


@router.post("/control/confirm")
async def confirm(c: Ctx, user: Admin, body: ConfirmBody) -> dict[str, Any]:
    if c.collector is None:
        raise HTTPException(503, "Coletor indisponível")
    try:
        result = await control.confirm_and_execute(c.db, c.collector.client, body.operation_id, body.nonce,
                                                   body.confirm_text, user)
    except control.ControlError as exc:
        raise HTTPException(exc.status, exc.message) from exc
    c.bus.publish("control", result)
    return result


@router.post("/control/cancel/{operation_id}", status_code=204)
def cancel(c: Ctx, user: Admin, operation_id: str) -> None:
    control.cancel(c.db, operation_id, user)


@router.get("/control/requests")
def requests(c: Ctx, _u: User) -> dict[str, Any]:
    reqs = c.db.query("""SELECT r.operation_id, r.action, r.target, r.origin, r.status, r.created_at, r.expires_at,
                                r.confirmed_at, r.finished_at, r.result_detail, u.username AS requested_by
                         FROM control_requests r LEFT JOIN local_users u ON u.id = r.requested_by
                         ORDER BY r.created_at DESC LIMIT 100""")
    audit = c.db.query("SELECT operation_id, ts, actor, event, detail FROM control_audit_logs ORDER BY ts DESC, id DESC LIMIT 200")
    return {"requests": reqs, "audit": audit}


@router.get("/diagnostics/summary")
async def diag_summary(c: Ctx, _u: User, start: StartQ = None, end: EndQ = None, rng: RangeQ = None) -> dict[str, Any]:
    s, e = resolve_range(start, end, rng, default="24h")
    tid = _terminal(c, None)
    obs = None
    if c.collector and c.collector.state.last_status:
        m = c.collector.state.last_status.metrics.get("obstruction_pct")
        obs = float(m.value) if m and isinstance(m.value, int | float) else None
    power = c.db.query("""SELECT start_ts, end_ts FROM connection_events WHERE kind='power_loss'
                          AND start_ts < ? AND COALESCE(end_ts, ?) > ?""", (e, e, s))
    return await asyncio.to_thread(engine.summary, c.db, tid, s, e, c.settings.timezone, obs, power)


@router.get("/diagnostics/anomalies")
async def diag_anomalies(c: Ctx, _u: User, start: StartQ = None, end: EndQ = None, rng: RangeQ = None) -> dict[str, Any]:
    s, e = resolve_range(start, end, rng, default="7d")
    items = await asyncio.to_thread(engine.anomalies, c.db, _terminal(c, None), s, e, c.settings.timezone)
    return {"start": s, "end": e, "anomalies": items}
