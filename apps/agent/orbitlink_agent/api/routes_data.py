"""Rotas de leitura: status, capacidades, telemetria, consumo, qualidade, eventos, obstrução, stream."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import StreamingResponse

from ..diagnostics.report import run_diagnose, sanitize
from ..storage import queries
from ..storage.db import now_ts
from .deps import Admin, Ctx, User

router = APIRouter(prefix="/v1", tags=["dados"])

RANGES = {"15m": 900, "1h": 3600, "6h": 21600, "24h": 86400, "7d": 7 * 86400, "30d": 30 * 86400, "90d": 90 * 86400}


def resolve_range(start: int | None, end: int | None, rng: str | None, default: str = "1h") -> tuple[int, int]:
    e = end or now_ts()
    if start is not None:
        s = start
    else:
        span = RANGES.get(rng or default)
        if span is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"range inválido; use {', '.join(RANGES)}")
        s = e - span
    if s >= e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "start deve ser anterior a end")
    if e - s > 400 * 86400:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "período máximo de 400 dias")
    return s, e


StartQ = Annotated[int | None, Query(description="Epoch UTC (s)")]
EndQ = Annotated[int | None, Query(description="Epoch UTC (s)")]
RangeQ = Annotated[str | None, Query(alias="range", description="15m, 1h, 6h, 24h, 7d, 30d, 90d")]


def _terminal(c: Ctx, terminal_id: int | None) -> int | None:
    if terminal_id is not None:
        return terminal_id
    if c.collector and c.collector.state.terminal_id:
        return c.collector.state.terminal_id
    tid = c.db.scalar("SELECT id FROM terminals ORDER BY last_seen DESC LIMIT 1")
    return int(tid) if tid is not None else None


@router.get("/agent")
def agent(c: Ctx, _u: User) -> dict[str, Any]:
    snap: dict[str, Any] = c.collector.agent_snapshot() if c.collector else {"mode": "sem_coletor"}
    snap["db_bytes"] = c.db.size_bytes()
    snap["sync_pending"] = c.db.scalar("SELECT COUNT(*) FROM sync_queue WHERE synced_at IS NULL")
    snap["supabase_configured"] = bool(c.settings.supabase_url)
    snap["ai_configured"] = bool(c.settings.anthropic_api_key)
    snap["timezone"] = c.settings.timezone
    snap["terminal_name"] = c.settings.terminal_name
    snap["router_target"] = c.settings.router_target
    snap["intervals"] = {"status_s": c.settings.status_interval_s, "history_s": c.settings.history_interval_s,
                         "obstruction_s": c.settings.obstruction_interval_s}
    snap["extras"] = {k: v for k, v in c.extras.items() if isinstance(v, str | int | float | bool | None)}
    return snap


@router.get("/terminals")
def terminals(c: Ctx, _u: User) -> list[dict[str, Any]]:
    return c.db.query("SELECT id, terminal_key, name, target, hardware_version, software_version, origin, first_seen, "
                      "last_seen FROM terminals ORDER BY last_seen DESC")


@router.get("/status")
def current_status(c: Ctx, _u: User) -> dict[str, Any]:
    col = c.collector
    if col is None or col.state.last_status is None:
        last_err = col.state.loops.get("status") if col else None
        return {
            "available": False,
            "dish_reachable": col.state.dish_reachable if col else None,
            "reason": (last_err.last_error if last_err and last_err.last_error else "Nenhum status recebido ainda."),
            "error_kind": last_err.last_error_kind if last_err else None,
        }
    st = col.state.last_status
    age = now_ts() - int(st.observed_at.timestamp())
    return {
        "available": True,
        "dish_reachable": col.state.dish_reachable,
        "age_s": age,
        "stale": age > 3 * c.settings.status_interval_s,
        "status": st.model_dump(mode="json"),
    }


@router.get("/capabilities")
def capabilities(c: Ctx, _u: User) -> dict[str, Any]:
    rows = c.db.query("SELECT * FROM capabilities ORDER BY device, kind DESC, key")
    for r in rows:
        r["available"] = bool(r["available"])
        r["offered"] = bool(r["offered"])
    return {"checked_at": c.collector.state.capabilities_checked if c.collector else None, "capabilities": rows}


@router.post("/capabilities/refresh", status_code=202)
def refresh_capabilities(c: Ctx, _u: User) -> dict[str, str]:
    if c.collector:
        c.collector.request_capability_refresh()
    return {"status": "agendado"}


@router.get("/telemetry")
def telemetry(c: Ctx, _u: User, start: StartQ = None, end: EndQ = None, rng: RangeQ = None,
              bucket_s: Annotated[int | None, Query(ge=1, le=86400)] = None,
              terminal_id: int | None = None) -> dict[str, Any]:
    s, e = resolve_range(start, end, rng)
    tid = _terminal(c, terminal_id)
    if tid is None:
        return {"start": s, "end": e, "points": [], "source": "indisponivel", "coverage": 0,
                "gaps": queries.gaps_between(c.db, s, e), "series_source": "none", "bucket_s": bucket_s or 0}
    return queries.telemetry(c.db, tid, s, e, bucket_s)


@router.get("/usage/summary")
def usage_summary(c: Ctx, _u: User, terminal_id: int | None = None) -> dict[str, Any]:
    return queries.usage_summary(c.db, _terminal(c, terminal_id), c.settings.timezone)


@router.get("/usage/plan")
def usage_plan(c: Ctx, _u: User, terminal_id: int | None = None) -> dict[str, Any]:
    """Consumo do ciclo de cobrança frente à franquia configurada (estimativa local)."""
    s = c.settings
    return queries.usage_plan(c.db, _terminal(c, terminal_id), s.timezone, s.usage_monthly_limit_gb, s.usage_cycle_start_day)


@router.get("/usage/series")
def usage_series(c: Ctx, _u: User, start: StartQ = None, end: EndQ = None, rng: RangeQ = None,
                 bucket: Annotated[str, Query(pattern="^(hour|day|month)$")] = "day",
                 terminal_id: int | None = None) -> dict[str, Any]:
    s, e = resolve_range(start, end, rng, default="30d")
    return queries.usage_series(c.db, _terminal(c, terminal_id), s, e, bucket, c.settings.timezone)


@router.get("/usage/hourly-profile")
def usage_hourly(c: Ctx, _u: User, start: StartQ = None, end: EndQ = None, rng: RangeQ = None,
                 terminal_id: int | None = None) -> list[dict[str, Any]]:
    s, e = resolve_range(start, end, rng, default="30d")
    return queries.usage_by_hour_of_day(c.db, _terminal(c, terminal_id), s, e, c.settings.timezone)


@router.get("/usage/compare")
def usage_compare(c: Ctx, _u: User, a_start: int, a_end: int, b_start: int, b_end: int,
                  terminal_id: int | None = None) -> dict[str, Any]:
    tid = _terminal(c, terminal_id)
    a = queries.usage_between(c.db, tid, a_start, a_end)
    b = queries.usage_between(c.db, tid, b_start, b_end)
    delta = a["bytes_total"] - b["bytes_total"]
    return {"a": a, "b": b, "delta_bytes": delta,
            "delta_pct": round(delta / b["bytes_total"] * 100, 1) if b["bytes_total"] else None,
            "method": queries.METHOD_USAGE}


@router.get("/quality")
def quality(c: Ctx, _u: User, start: StartQ = None, end: EndQ = None, rng: RangeQ = None,
            terminal_id: int | None = None) -> dict[str, Any]:
    s, e = resolve_range(start, end, rng, default="24h")
    return queries.quality(c.db, _terminal(c, terminal_id), s, e, c.settings.timezone)


@router.get("/events")
def events(c: Ctx, _u: User, start: StartQ = None, end: EndQ = None, rng: RangeQ = None,
           kind: Annotated[list[str] | None, Query()] = None,
           limit: Annotated[int, Query(ge=1, le=2000)] = 500) -> dict[str, Any]:
    s, e = resolve_range(start, end, rng, default="7d")
    return {"start": s, "end": e, "events": queries.events(c.db, s, e, kind, limit),
            "gaps": queries.gaps_between(c.db, s, e)}


@router.get("/obstruction")
def obstruction(c: Ctx, _u: User, start: StartQ = None, end: EndQ = None, rng: RangeQ = None,
                terminal_id: int | None = None) -> dict[str, Any]:
    s, e = resolve_range(start, end, rng, default="7d")
    tid = _terminal(c, terminal_id)
    cap = c.collector.capability("dish.obstruction_map") if c.collector else None
    return {"map": queries.latest_obstruction(c.db, tid),
            "map_capability": cap.model_dump(mode="json") if cap else None,
            "trend": queries.obstruction_trend(c.db, tid, s, e)}


@router.post("/diagnose")
async def diagnose(c: Ctx, _a: Admin) -> dict[str, Any]:
    report = await asyncio.to_thread(run_diagnose, c.settings)
    result: dict[str, Any] = sanitize(report, mask_lan_ips=False)
    return result


@router.get("/stream")
async def stream(c: Ctx, _u: User) -> StreamingResponse:
    """SSE: eventos `status`, `agent`, `history`, `capabilities`, `alert`, `esp32`."""
    q = c.bus.subscribe()

    async def gen() -> AsyncIterator[str]:
        try:
            yield "retry: 5000\n\n"
            for ev in ("agent", "status"):
                if ev in c.bus.last:
                    yield c.bus.last[ev].sse()
            while True:
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=15)
                    yield msg.sse()
                except TimeoutError:
                    yield f": keepalive {json.dumps(now_ts())}\n\n"
        finally:
            c.bus.unsubscribe(q)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
