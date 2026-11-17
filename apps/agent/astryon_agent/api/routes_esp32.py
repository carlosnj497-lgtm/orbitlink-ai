"""ESP32: rotas administrativas (app principal, loopback) e rotas de ingestão (listener LAN separado)."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import APIRouter, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field, ValidationError

from ..auth.local import RateLimiter
from ..diagnostics.report import _mask_ip
from ..esp32 import protocol
from ..storage.db import now_ts
from .deps import Admin, AppContext, Ctx, User
from .routes_data import EndQ, RangeQ, StartQ, resolve_range

log = logging.getLogger("astryon.esp32")
router = APIRouter(prefix="/v1/esp32", tags=["esp32"])


class CodeBody(BaseModel):
    name: str = Field(min_length=2, max_length=40)


class NodePatch(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=40)
    enabled: bool | None = None


@router.get("/nodes")
def nodes(c: Ctx, _u: User) -> dict[str, Any]:
    rows = c.db.query("""SELECT id, device_id, name, firmware, sensors_json AS sensors, created_at, last_seen, last_ip_masked,
                                rssi, uptime_s, enabled FROM esp32_nodes ORDER BY id""")
    now = now_ts()
    for r in rows:
        r["online"] = bool(r["last_seen"] and now - r["last_seen"] < 180)
        r["sensors"] = [s for s in (r["sensors"] or "").split(",") if s]
        r["latest"] = c.db.query("""SELECT sensor, value, quality, MAX(ts) AS ts FROM esp32_sensor_readings
                                    WHERE node_id = ? GROUP BY sensor""", (r["id"],))
    return {"enabled": c.settings.esp32_enabled, "listen": f"{c.settings.esp32_listen_host}:{c.settings.esp32_listen_port}"
            if c.settings.esp32_enabled else None, "nodes": rows}


@router.post("/pairing-code", status_code=201)
def pairing_code(c: Ctx, user: Admin, body: CodeBody) -> dict[str, Any]:
    if not c.settings.esp32_enabled:
        raise HTTPException(409, "Habilite ASTRYON_ESP32_ENABLED=true e reinicie o agente antes de parear.")
    code, exp = protocol.create_pairing_code(c.db, body.name, user["id"])
    return {"code": code, "expires_at": exp,
            "note": "Código de uso único; não é armazenado em texto claro nem enviado pela rede pelo ESP32."}


@router.patch("/nodes/{node_id}")
def patch_node(c: Ctx, _a: Admin, node_id: int, body: NodePatch) -> dict[str, Any]:
    if body.name is not None:
        c.db.execute("UPDATE esp32_nodes SET name = ? WHERE id = ?", (body.name, node_id))
    if body.enabled is not None:
        c.db.execute("UPDATE esp32_nodes SET enabled = ? WHERE id = ?", (int(body.enabled), node_id))
    return {"id": node_id}


@router.delete("/nodes/{node_id}", status_code=204)
def delete_node(c: Ctx, _a: Admin, node_id: int) -> None:
    c.db.execute("DELETE FROM esp32_nodes WHERE id = ?", (node_id,))


@router.get("/nodes/{node_id}/readings")
def readings(c: Ctx, _u: User, node_id: int, start: StartQ = None, end: EndQ = None, rng: RangeQ = None,
             sensor: str | None = None) -> dict[str, Any]:
    s, e = resolve_range(start, end, rng, default="24h")
    bucket = max(10, (e - s) // 500)
    rows = c.db.query(
        """SELECT sensor, (ts / :b) * :b AS t, AVG(value) AS value, MIN(value) AS min, MAX(value) AS max, COUNT(*) AS n,
                  SUM(quality != 'ok') AS not_ok
           FROM esp32_sensor_readings WHERE node_id = :n AND ts >= :s AND ts < :e AND (:sensor IS NULL OR sensor = :sensor)
           GROUP BY sensor, t ORDER BY t""",
        {"b": bucket, "n": node_id, "s": s, "e": e, "sensor": sensor},
    )
    series: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        series.setdefault(r.pop("sensor"), []).append(r)
    return {"start": s, "end": e, "bucket_s": bucket, "source": "sensor_esp32", "series": series}


# --------------------------------------------------------------------------- listener LAN
def build_ingest_app(ctx: AppContext) -> FastAPI:
    app = FastAPI(title="ASTRYON ESP32 ingest", docs_url=None, redoc_url=None, openapi_url=None)
    limiter = RateLimiter(10, 60)
    # Ingest: teto generoso por IP (um ESP32 manda bem menos que isso) e bloqueio de quem erra a autenticação.
    ingest_limiter = RateLimiter(240, 60)
    auth_fail_limiter = RateLimiter(20, 60)
    skew = ctx.settings.esp32_clock_skew_s

    def client_ip(req: Request) -> str:
        return req.client.host if req.client else "?"

    async def read_limited(req: Request) -> bytes:
        """Lê o corpo sem passar de MAX_BODY: o listener fica na LAN e não pode ser derrubado por um corpo enorme."""
        declared = req.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > protocol.MAX_BODY:
            raise HTTPException(413, "Corpo grande demais")
        buf = bytearray()
        async for chunk in req.stream():
            buf += chunk
            if len(buf) > protocol.MAX_BODY:
                raise HTTPException(413, "Corpo grande demais")
        return bytes(buf)

    @app.get("/esp32/v1/time")
    def server_time() -> dict[str, int]:
        return {"server_time": now_ts()}

    @app.post("/esp32/v1/pair")
    async def pair(req: Request) -> Any:
        if not limiter.allow(f"pair:{client_ip(req)}"):
            raise HTTPException(429, "Muitas tentativas")
        raw = await read_limited(req)
        try:
            body = protocol.PairBody.model_validate_json(raw)
            return await asyncio.to_thread(protocol.pair, ctx.db, body)
        except ValidationError as exc:
            if b'"code"' in raw:  # firmware antigo (v1) mandava o código em texto claro
                raise HTTPException(426, "Firmware antigo: atualize o firmware do ESP32 (pareamento v2) e gere um "
                                         "código novo no painel.") from exc
            raise HTTPException(422, "Payload inválido") from exc
        except protocol.AuthError as exc:
            log.warning("pareamento recusado de %s: %s", _mask_ip_str(client_ip(req)), exc.message)
            raise HTTPException(exc.status, exc.message) from exc

    async def authed(req: Request) -> tuple[dict[str, Any], bytes]:
        ip = client_ip(req)
        if auth_fail_limiter.exceeded(f"fail:{ip}") or not ingest_limiter.allow(f"ingest:{ip}"):
            raise HTTPException(429, "Muitas tentativas")
        raw = await read_limited(req)
        headers = {k.lower(): v for k, v in req.headers.items()}
        try:
            node = await asyncio.to_thread(protocol.verify, ctx.db, headers, raw, skew)
        except protocol.AuthError as exc:
            if exc.status == 401:
                auth_fail_limiter.allow(f"fail:{ip}")
            raise HTTPException(exc.status, exc.message) from exc
        return node, raw

    @app.post("/esp32/v1/ingest")
    async def ingest(req: Request) -> Any:
        node, raw = await authed(req)
        try:
            body = protocol.IngestBody.model_validate(json.loads(raw or b"{}"))
        except (ValidationError, ValueError) as exc:
            raise HTTPException(422, "Payload inválido") from exc
        res = await asyncio.to_thread(protocol.ingest, ctx.db, node, body, _mask_ip_str(client_ip(req)), skew)
        ctx.bus.publish("esp32", {"node_id": node["id"], "accepted": res["accepted"]})
        return res

    @app.post("/esp32/v1/heartbeat")
    async def heartbeat(req: Request) -> Any:
        node, raw = await authed(req)
        try:
            body = protocol.IngestBody.model_validate(json.loads(raw or b"{}"))
        except (ValidationError, ValueError) as exc:
            raise HTTPException(422, "Payload inválido") from exc
        body.readings = []
        return await asyncio.to_thread(protocol.ingest, ctx.db, node, body, _mask_ip_str(client_ip(req)), skew)

    return app


def _mask_ip_str(ip: str) -> str:
    import re

    return re.sub(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", _mask_ip, ip)


def _embedded_server_cls() -> Any:
    import contextlib

    import uvicorn

    class EmbeddedServer(uvicorn.Server):
        """Servidor embutido no mesmo event loop: não captura sinais (o servidor principal cuida disso)."""

        @contextlib.contextmanager
        def capture_signals(self) -> Any:
            yield

    return EmbeddedServer


def register(app: FastAPI) -> None:
    async def start(ctx: AppContext) -> None:
        if not ctx.settings.esp32_enabled:
            return
        import uvicorn

        _EmbeddedServer = _embedded_server_cls()  # noqa: N806
        cfg = uvicorn.Config(build_ingest_app(ctx), host=ctx.settings.esp32_listen_host, port=ctx.settings.esp32_listen_port,
                             log_config=None, access_log=False, lifespan="off")
        server = _EmbeddedServer(cfg)
        ctx.extras["esp32_server"] = server

        async def serve() -> None:
            # Se a porta estiver ocupada, o uvicorn chama sys.exit(); dentro de uma task o SystemExit sobe pelo
            # event loop e derrubaria o agente inteiro. Aqui ele vira só um erro no log: o resto continua no ar.
            try:
                await server.serve()
            except (SystemExit, OSError) as exc:
                log.error("listener ESP32 não iniciou em %s:%s (%s); porta ocupada?", ctx.settings.esp32_listen_host,
                          ctx.settings.esp32_listen_port, exc)

        ctx.extras["esp32_task"] = asyncio.create_task(serve(), name="esp32-ingest")
        log.info("listener ESP32 em %s:%s (somente rotas HMAC)", ctx.settings.esp32_listen_host, ctx.settings.esp32_listen_port)

    async def stop(ctx: AppContext) -> None:
        server = ctx.extras.get("esp32_server")
        if server:
            server.should_exit = True
            t = ctx.extras.get("esp32_task")
            if t:
                await asyncio.wait([t], timeout=5)

    app.state.startup_hooks.append(start)
    app.state.shutdown_hooks.append(stop)
