"""Dispositivos da rede — SOMENTE a partir de fonte suportada (API do roteador Starlink).

A antena não é tratada como fonte de tráfego por dispositivo. Nenhuma varredura de rede é feita.
Nomes de dispositivos são dados não confiáveis (podem conter texto arbitrário) e são saneados.
"""

from __future__ import annotations

import asyncio
import re
import time
from typing import Any

from fastapi import APIRouter

from ..starlink.capabilities import CapStatus, probe
from ..starlink.errors import StarlinkError
from ..starlink.transport import GrpcTransport
from ..storage.repo import save_capabilities
from .deps import Ctx, User

router = APIRouter(prefix="/v1", tags=["dispositivos"])

_CACHE: dict[str, Any] = {"ts": 0.0, "data": None}
CTRL = re.compile(r"[\x00-\x1f\x7f]")


def clean_name(v: Any) -> str | None:
    if not isinstance(v, str) or not v.strip():
        return None
    return CTRL.sub("", v)[:64]


def mask_mac(mac: str | None, show: bool) -> str | None:
    if not mac:
        return None
    if show:
        return mac.upper()
    parts = re.split(r"[:-]", mac)
    return ":".join(parts[:3] + ["xx"] * (len(parts) - 3)).upper() if len(parts) == 6 else "oculto"


def normalize_clients(data: dict[str, Any], show_mac: bool) -> list[dict[str, Any]]:
    out = []
    for cl in data.get("clients") or []:
        if not isinstance(cl, dict):
            continue
        rx = cl.get("rx_stats") or {}
        tx = cl.get("tx_stats") or {}
        out.append({
            "name": clean_name(cl.get("given_name")) or clean_name(cl.get("name")) or clean_name(cl.get("domain")),
            "ip": cl.get("ip_address") or None,
            "mac": mask_mac(cl.get("mac_address"), show_mac),
            "interface": cl.get("iface") or None,
            "signal_dbm": cl.get("signal_strength") if isinstance(cl.get("signal_strength"), int | float) else None,
            "connected_s": cl.get("associated_time_s") if isinstance(cl.get("associated_time_s"), int | float) else None,
            "rx_bytes": rx.get("bytes") if isinstance(rx, dict) else None,
            "tx_bytes": tx.get("bytes") if isinstance(tx, dict) else None,
        })
    return out


def _fetch(c: Any) -> dict[str, Any]:
    s = c.settings
    if not s.router_enabled:
        return {"source": "indisponivel", "reason": "Integração com o roteador desabilitada (ORBITLINK_ROUTER_ENABLED=false).",
                "devices": [], "capability": None}
    t = GrpcTransport(s.router_target, connect_timeout=s.connect_timeout_s)
    try:
        res = probe(t, "router", timeout=s.grpc_timeout_s)
        save_capabilities(c.db, s.router_target, res.capabilities)
        cap = next(x for x in res.capabilities if x.key == "router.clients")
        if cap.status != CapStatus.VERIFICADA:
            return {"source": "indisponivel", "capability": cap.model_dump(mode="json"),
                    "reason": f"Lista de clientes não disponível pelo roteador ({cap.status.value}). {cap.detail or ''}".strip(),
                    "devices": []}
        data = res.responses["wifi_get_clients"].data
        return {"source": "real", "capability": cap.model_dump(mode="json"), "reason": None,
                "devices": normalize_clients(data, s.show_mac_addresses),
                "note": "Fonte: API local do roteador Starlink. Campos ausentes não são estimados."}
    except StarlinkError as err:
        return {"source": "indisponivel", "reason": err.message, "devices": [], "capability": None}
    finally:
        t.close()


@router.get("/devices")
async def devices(c: Ctx, _u: User, refresh: bool = False) -> dict[str, Any]:
    if refresh or _CACHE["data"] is None or time.monotonic() - _CACHE["ts"] > 60:
        _CACHE["data"] = await asyncio.to_thread(_fetch, c)
        _CACHE["ts"] = time.monotonic()
    result: dict[str, Any] = dict(_CACHE["data"])
    result["checked_age_s"] = int(time.monotonic() - _CACHE["ts"])
    return result
