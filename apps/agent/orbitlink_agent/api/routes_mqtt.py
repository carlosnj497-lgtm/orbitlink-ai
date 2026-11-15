"""Integração MQTT (Home Assistant): estado da publicação."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, FastAPI

from ..integrations import mqtt
from .deps import AppContext, Ctx, User

router = APIRouter(prefix="/v1/integrations", tags=["integracoes"])


@router.get("/mqtt")
def mqtt_status(c: Ctx, _u: User) -> dict[str, Any]:
    st = c.extras.get("mqtt_state", {})
    return {"configured": bool(c.settings.mqtt_host), "host": c.settings.mqtt_host, "port": c.settings.mqtt_port,
            "tls": c.settings.mqtt_tls, "discovery": c.settings.mqtt_discovery, "prefix": c.settings.mqtt_topic_prefix,
            "connected": bool(st.get("connected")), "last_publish": st.get("last_publish"),
            "last_error": st.get("last_error")}


def register(app: FastAPI) -> None:
    async def start(ctx: AppContext) -> None:
        if ctx.settings.mqtt_host:
            ctx.extras["mqtt_state"] = {}
            ctx.extras["mqtt_task"] = asyncio.create_task(
                mqtt.run(ctx.db, ctx.settings, ctx.collector, ctx.extras["mqtt_state"]), name="mqtt")

    async def stop(ctx: AppContext) -> None:
        t = ctx.extras.get("mqtt_task")
        if t:
            t.cancel()

    app.state.startup_hooks.append(start)
    app.state.shutdown_hooks.append(stop)
