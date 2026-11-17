"""Rotas de regras e ocorrências de alertas."""

from __future__ import annotations

import asyncio
from typing import Any, Literal

from fastapi import APIRouter, FastAPI, HTTPException
from pydantic import BaseModel, Field

from ..alerts.engine import KINDS, AlertEngine, seed_defaults
from ..alerts.notify import Notifier
from ..reports import digest
from ..storage.db import now_ts
from .deps import Admin, AppContext, Ctx, User

router = APIRouter(prefix="/v1/alerts", tags=["alertas"])


class RuleBody(BaseModel):
    name: str = Field(min_length=3, max_length=80)
    kind: str
    threshold: float
    min_duration_s: int = Field(ge=0, le=86400, default=0)
    window_s: int = Field(ge=60, le=30 * 86400, default=300)
    severity: Literal["info", "warn", "crit"] = "warn"
    cooldown_s: int = Field(ge=0, le=86400, default=900)
    hysteresis: float = Field(ge=0, le=0.9, default=0.1)
    enabled: bool = True


@router.get("/kinds")
def kinds(_u: User) -> dict[str, Any]:
    return {"kinds": KINDS}


@router.get("/rules")
def rules(c: Ctx, _u: User) -> dict[str, Any]:
    seed_defaults(c.db)
    rows = c.db.query("SELECT * FROM alert_rules ORDER BY id")
    engine: AlertEngine | None = c.extras.get("alerts_engine")
    for r in rows:
        r["enabled"] = bool(r["enabled"])
        # Leitura da última avaliação (a cada ~30 s). Regra desligada não é avaliada: fica sem leitura.
        reading = engine.readings.get(r["id"]) if engine and r["enabled"] else None
        r["current"] = {"value": reading[0], "measured_at": reading[1]} if reading else None
        r["breaching_since"] = engine.first_breach.get(r["id"]) if engine and r["enabled"] else None
        r["last_event"] = c.db.one("SELECT status, started_at, resolved_at, occurrences FROM alert_events WHERE rule_id=? "
                                   "ORDER BY started_at DESC LIMIT 1", (r["id"],))
    return {"rules": rows}


@router.post("/rules", status_code=201)
def create_rule(c: Ctx, _a: Admin, body: RuleBody) -> dict[str, Any]:
    if body.kind not in KINDS:
        raise HTTPException(422, "Tipo de regra desconhecido")
    ts = now_ts()
    cur = c.db.execute(
        """INSERT INTO alert_rules (name, kind, operator, threshold, min_duration_s, window_s, severity, cooldown_s, hysteresis,
             enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (body.name, body.kind, KINDS[body.kind]["operator"], body.threshold, body.min_duration_s, body.window_s,
         body.severity, body.cooldown_s, body.hysteresis, int(body.enabled), ts, ts),
    )
    return {"id": cur.lastrowid}


@router.put("/rules/{rule_id}")
def update_rule(c: Ctx, _a: Admin, rule_id: int, body: RuleBody) -> dict[str, Any]:
    if body.kind not in KINDS:
        raise HTTPException(422, "Tipo de regra desconhecido")
    cur = c.db.execute(
        """UPDATE alert_rules SET name=?, kind=?, operator=?, threshold=?, min_duration_s=?, window_s=?, severity=?,
             cooldown_s=?, hysteresis=?, enabled=?, updated_at=? WHERE id=?""",
        (body.name, body.kind, KINDS[body.kind]["operator"], body.threshold, body.min_duration_s, body.window_s,
         body.severity, body.cooldown_s, body.hysteresis, int(body.enabled), now_ts(), rule_id),
    )
    if not cur.rowcount:
        raise HTTPException(404, "Regra não encontrada")
    return {"id": rule_id}


@router.delete("/rules/{rule_id}", status_code=204)
def delete_rule(c: Ctx, _a: Admin, rule_id: int) -> None:
    c.db.execute("DELETE FROM alert_rules WHERE id=?", (rule_id,))


class SilenceBody(BaseModel):
    minutes: int = Field(ge=0, le=7 * 24 * 60)


@router.post("/rules/{rule_id}/silence")
def silence(c: Ctx, _a: Admin, rule_id: int, body: SilenceBody) -> dict[str, Any]:
    until = now_ts() + body.minutes * 60 if body.minutes else None
    c.db.execute("UPDATE alert_rules SET silenced_until=?, updated_at=? WHERE id=?", (until, now_ts(), rule_id))
    return {"silenced_until": until}


@router.get("/events")
def events(c: Ctx, _u: User, status: Literal["active", "resolved", "all"] = "all", limit: int = 200) -> dict[str, Any]:
    sql = """SELECT e.*, r.name AS rule_name, r.kind FROM alert_events e JOIN alert_rules r ON r.id = e.rule_id"""
    params: list[Any] = []
    if status != "all":
        sql += " WHERE e.status = ?"
        params.append(status)
    sql += " ORDER BY e.started_at DESC LIMIT ?"
    params.append(min(max(limit, 1), 1000))
    return {"events": c.db.query(sql, params)}


@router.post("/events/{event_id}/ack", status_code=204)
def ack(c: Ctx, user: User, event_id: int) -> None:
    c.db.execute("UPDATE alert_events SET acknowledged_at=?, acknowledged_by=? WHERE id=?",
                 (now_ts(), user["username"], event_id))


def notifier(c: AppContext) -> Notifier:
    n = c.extras.get("notifier")
    if n is None:
        n = c.extras["notifier"] = Notifier(c.db, c.settings)
    return n


@router.get("/notifications")
def notifications(c: Ctx, _u: User) -> dict[str, Any]:
    bot = c.extras.get("telegram_bot")
    chat = {"enabled": bot is not None, **({k: bot.state[k] for k in ("last_poll_ok", "last_error", "answered", "transcribed")}
                                          if bot is not None else {})}
    return {**notifier(c).status(), "telegram_chat": chat}


@router.post("/notifications/test")
async def notifications_test(c: Ctx, _a: Admin) -> dict[str, Any]:
    n = notifier(c)
    if not any(n.channels().values()):
        raise HTTPException(409, "Nenhum canal configurado. Defina ASTRYON_TELEGRAM_BOT_TOKEN e ASTRYON_TELEGRAM_CHAT_ID "
                                 "(ou ASTRYON_ALERT_WEBHOOK_URL) e reinicie o agente.")
    return {"results": await n.send_test()}


@router.get("/digest")
def digest_status(c: Ctx, _u: User) -> dict[str, Any]:
    return digest.status(c.db, c.settings, notifier(c))


@router.post("/digest/send")
async def digest_send(c: Ctx, _a: Admin) -> dict[str, Any]:
    """Envia agora, pelo Telegram, o resumo dos últimos 7 dias (não altera o agendamento semanal)."""
    n = notifier(c)
    if not n.channels()["telegram"]:
        raise HTTPException(409, "Telegram não configurado. Defina ASTRYON_TELEGRAM_BOT_TOKEN e ASTRYON_TELEGRAM_CHAT_ID "
                                 "e reinicie o agente.")
    text = await asyncio.to_thread(digest.build_rolling, c.db, c.settings)
    if text is None:
        raise HTTPException(409, "Ainda não há dados observados nos últimos 7 dias.")
    return await n.send_digest_now(text)


def register(app: FastAPI) -> None:
    async def start(ctx: AppContext) -> None:
        engine = AlertEngine(ctx.db, ctx.bus, ctx.collector, ctx.settings.timezone, ctx.settings, notifier(ctx))
        ctx.extras["alerts_engine"] = engine
        ctx.extras["alerts_task"] = asyncio.create_task(engine.run(), name="alerts")
        ctx.extras["digest_task"] = asyncio.create_task(digest.run(ctx.db, ctx.settings, notifier(ctx)), name="digest")

    async def stop(ctx: AppContext) -> None:
        for key in ("alerts_task", "digest_task"):
            t = ctx.extras.get(key)
            if t:
                t.cancel()

    app.state.startup_hooks.append(start)
    app.state.shutdown_hooks.append(stop)
