"""Clima (Open-Meteo): estado atual, série por hora e escolha da localização."""

from __future__ import annotations

import asyncio
from typing import Any

import httpx
from fastapi import APIRouter, FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

from ..weather import service as weather
from .deps import Admin, AppContext, Ctx, User
from .routes_data import resolve_range

router = APIRouter(prefix="/v1/weather", tags=["clima"])


@router.get("")
def weather_status(c: Ctx, _u: User) -> dict[str, Any]:
    return weather.status(c.db, c.settings)


@router.get("/hourly")
def weather_hourly(c: Ctx, _u: User, start: int | None = None, end: int | None = None,
                   range: str | None = Query(default=None)) -> dict[str, Any]:  # noqa: A002
    s, e = resolve_range(start, end, range, "24h")
    if e - s > 92 * 86400:
        raise HTTPException(422, "período máximo de 92 dias para o clima")
    return {"start": s, "end": e, "source": "estimada", "provider": weather.PROVIDER, "hours": weather.hourly(c.db, s, e)}


@router.get("/geocode")
async def weather_geocode(_a: Admin, q: str = Query(min_length=2, max_length=80)) -> dict[str, Any]:
    try:
        return {"results": await weather.geocode(q)}
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"Não foi possível consultar a Open-Meteo ({type(exc).__name__}).") from exc


class LocationBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


@router.put("/location")
async def weather_set_location(c: Ctx, _a: Admin, body: LocationBody) -> dict[str, Any]:
    await c.db.run(weather.set_location, c.db, weather.Location(body.name.strip(), body.latitude, body.longitude))
    await weather.refresh(c.db, c.settings)  # busca na hora; se falhar, o erro aparece no estado
    return weather.status(c.db, c.settings)


@router.delete("/location")
async def weather_clear_location(c: Ctx, _a: Admin) -> dict[str, Any]:
    await c.db.run(weather.set_location, c.db, None)
    return weather.status(c.db, c.settings)


@router.post("/refresh")
async def weather_refresh(c: Ctx, _a: Admin) -> dict[str, Any]:
    await weather.refresh(c.db, c.settings)
    return weather.status(c.db, c.settings)


def register(app: FastAPI) -> None:
    async def start(ctx: AppContext) -> None:
        ctx.extras["weather_task"] = asyncio.create_task(weather.run(ctx.db, ctx.settings), name="weather")

    async def stop(ctx: AppContext) -> None:
        t = ctx.extras.get("weather_task")
        if t:
            t.cancel()

    app.state.startup_hooks.append(start)
    app.state.shutdown_hooks.append(stop)
