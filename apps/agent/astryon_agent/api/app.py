"""Fábrica da aplicação FastAPI do agente."""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from .. import __version__
from ..collector.bus import EventBus
from ..collector.service import Collector
from ..config import Settings, get_settings
from ..diagnostics.report import make_transport
from ..logging_setup import correlation_id, setup_logging
from ..starlink.transport import StarlinkTransport
from ..storage.db import Database
from . import routes_auth, routes_data
from .deps import AppContext

log = logging.getLogger("astryon.api")

# Routers adicionais registram-se aqui (controle, alertas, ESP32, IA, relatórios...).
EXTRA_ROUTERS: list[str] = [
    "astryon_agent.api.routes_control",
    "astryon_agent.api.routes_alerts",
    "astryon_agent.api.routes_reports",
    "astryon_agent.api.routes_esp32",
    "astryon_agent.api.routes_ai",
    "astryon_agent.api.routes_devices",
    "astryon_agent.api.routes_settings",
    "astryon_agent.api.routes_sync",
    "astryon_agent.api.routes_weather",
    "astryon_agent.api.routes_ops",
    "astryon_agent.api.routes_mqtt",
]


def create_app(settings: Settings | None = None, *, transport: StarlinkTransport | None = None,
               db: Database | None = None, start_collector: bool = True) -> FastAPI:
    s = settings or get_settings()
    setup_logging()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        database = db or Database(s.db_path)
        bus = EventBus()
        collector = None
        if start_collector:
            t = transport or make_transport(s, "dish")
            collector = Collector(s, database, t, bus)
        context = AppContext(settings=s, db=database, bus=bus, collector=collector)
        app.state.ctx = context
        hooks = getattr(app.state, "startup_hooks", [])
        for hook in hooks:
            await hook(context)
        if collector:
            await collector.start()
            log.info("coletor iniciado (modo=%s, alvo=%s)", collector.state.mode, collector.transport.target)
        try:
            yield
        finally:
            for hook in getattr(app.state, "shutdown_hooks", []):
                await hook(context)
            if collector:
                await collector.stop()
            if db is None:
                database.close()

    app = FastAPI(
        title="ASTRYON — Agente local",
        version=__version__,
        description="API local do agente ASTRYON (projeto independente, sem afiliação com a Starlink/SpaceX). "
                    "Escuta em loopback por padrão. Todas as rotas /v1 (exceto /v1/health) exigem token de serviço.",
        lifespan=lifespan,
    )
    app.state.startup_hooks = []
    app.state.shutdown_hooks = []
    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.allowed_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "X-ASTRYON-Session", "X-Request-ID"],
    )

    @app.middleware("http")
    async def correlation(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        cid = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
        token = correlation_id.set(cid[:64])
        t0 = time.perf_counter()
        try:
            response = await call_next(request)
        finally:
            correlation_id.reset(token)
        response.headers["X-Request-ID"] = cid[:64]
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = response.headers.get("Cache-Control", "no-store")
        if request.url.path != "/v1/stream":
            log.info("%s %s", request.method, request.url.path,
                     extra={"path": request.url.path, "status": response.status_code, "method": request.method,
                            "duration_ms": round((time.perf_counter() - t0) * 1000, 1)})
        return response

    @app.get("/v1/health", tags=["saude"])
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    app.include_router(routes_auth.router)
    app.include_router(routes_data.router)
    import importlib

    for mod_name in EXTRA_ROUTERS:
        try:
            mod = importlib.import_module(mod_name)
        except ModuleNotFoundError as exc:
            if exc.name == mod_name:
                continue
            raise
        app.include_router(mod.router)
        if hasattr(mod, "register"):
            mod.register(app)
    return app
