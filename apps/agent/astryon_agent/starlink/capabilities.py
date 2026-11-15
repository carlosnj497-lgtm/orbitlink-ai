"""Matriz de capacidades em runtime.

Nada é presumido: cada recurso é verificado contra o schema obtido por reflection e, quando é
de leitura, por uma chamada real. Controles NUNCA são executados para teste: no máximo ficam
como `schema_presente` (existem no schema; a autorização só é conhecida ao executar).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel

from .errors import ErrorKind, StarlinkError
from .transport import CallResult, StarlinkTransport


class CapStatus(StrEnum):
    VERIFICADA = "verificada"
    SCHEMA_PRESENTE = "schema_presente"
    AUSENTE_NO_SCHEMA = "ausente_no_schema"
    CAMPO_AUSENTE = "campo_ausente"
    NAO_IMPLEMENTADA = "nao_implementada"
    NEGADA = "negada"
    TIMEOUT = "timeout"
    INALCANCAVEL = "inalcancavel"
    ERRO = "erro"
    NAO_CONSULTADA = "nao_consultada"


class Capability(BaseModel):
    key: str
    label: str
    device: str  # "dish" | "router"
    origin: str  # "grpc_request" | "status_field" | "history_field"
    kind: str  # "leitura" | "controle"
    status: CapStatus
    available: bool
    checked_at: datetime
    detail: str | None = None
    offered_by_astryon: bool = True


ERROR_TO_STATUS = {
    ErrorKind.UNREACHABLE: CapStatus.INALCANCAVEL,
    ErrorKind.TIMEOUT: CapStatus.TIMEOUT,
    ErrorKind.UNIMPLEMENTED: CapStatus.NAO_IMPLEMENTADA,
    ErrorKind.PERMISSION_DENIED: CapStatus.NEGADA,
    ErrorKind.SCHEMA: CapStatus.AUSENTE_NO_SCHEMA,
    ErrorKind.PROTOCOL: CapStatus.ERRO,
    ErrorKind.UNKNOWN: CapStatus.ERRO,
}

EXPLAIN = {
    CapStatus.INALCANCAVEL: "Dispositivo não respondeu. Verifique se este computador está na rede da Starlink e a rota.",
    CapStatus.TIMEOUT: "A chamada excedeu o tempo limite.",
    CapStatus.NAO_IMPLEMENTADA: "O firmware respondeu UNIMPLEMENTED para esta chamada.",
    CapStatus.NEGADA: "O firmware recusou a chamada (PERMISSION_DENIED).",
    CapStatus.AUSENTE_NO_SCHEMA: "A chamada não existe no schema publicado por este firmware.",
    CapStatus.CAMPO_AUSENTE: "A chamada funciona, mas o campo não veio na resposta deste firmware.",
}


@dataclass(frozen=True)
class RequestCap:
    key: str
    label: str
    request: str
    kind: str = "leitura"
    probe: bool = True
    offered: bool = True
    note: str | None = None


DISH_REQUESTS = [
    RequestCap("dish.status", "Status da antena (get_status)", "get_status"),
    RequestCap("dish.history", "Histórico de ~15 min (get_history)", "get_history"),
    RequestCap("dish.obstruction_map", "Mapa de obstrução", "dish_get_obstruction_map"),
    RequestCap("dish.device_info", "Informações do dispositivo", "get_device_info"),
    RequestCap("dish.diagnostics", "Diagnóstico oficial (get_diagnostics)", "get_diagnostics"),
    RequestCap("dish.location", "Localização GPS", "get_location", probe=False, offered=False,
               note="Não consultada por política de privacidade do ASTRYON."),
    RequestCap("dish.reboot", "Reiniciar antena", "reboot", kind="controle", probe=False),
    RequestCap("dish.stow", "Recolher antena (stow)", "dish_stow", kind="controle", probe=False, offered=False,
               note="Não oferecido pelo ASTRYON."),
]

ROUTER_REQUESTS = [
    RequestCap("router.status", "Status do roteador", "get_status"),
    RequestCap("router.clients", "Clientes conectados (wifi_get_clients)", "wifi_get_clients"),
    RequestCap("router.diagnostics", "Diagnóstico do roteador", "get_diagnostics"),
]


@dataclass(frozen=True)
class FieldCap:
    key: str
    label: str
    check: Callable[[dict[str, Any]], bool]


def _has(path: str) -> Callable[[dict[str, Any]], bool]:
    parts = path.split(".")

    def check(d: dict[str, Any]) -> bool:
        cur: Any = d
        for p in parts:
            if not isinstance(cur, dict) or p not in cur:
                return False
            cur = cur[p]
        return cur is not None

    return check


STATUS_FIELDS = [
    FieldCap("metric.throughput", "Tráfego corrente down/up",
             lambda d: "downlink_throughput_bps" in d and "uplink_throughput_bps" in d),
    FieldCap("metric.pop_latency", "Latência até o PoP", _has("pop_ping_latency_ms")),
    FieldCap("metric.pop_drop", "Perda de ping ao PoP", _has("pop_ping_drop_rate")),
    FieldCap("metric.obstruction", "Estatística de obstrução", _has("obstruction_stats.fraction_obstructed")),
    FieldCap("metric.alerts", "Alertas da antena", _has("alerts")),
    FieldCap("metric.uptime", "Uptime", _has("device_state.uptime_s")),
    FieldCap("metric.eth_speed", "Velocidade Ethernet", _has("eth_speed_mbps")),
    FieldCap("metric.gps_stats", "Estado do GPS (sem coordenadas)", _has("gps_stats")),
    FieldCap("metric.firmware", "Versão de firmware", _has("device_info.software_version")),
]

HISTORY_FIELDS = [
    FieldCap("history.throughput", "Histórico de tráfego", lambda d: bool(d.get("downlink_throughput_bps"))),
    FieldCap("history.latency", "Histórico de latência", lambda d: bool(d.get("pop_ping_latency_ms"))),
    FieldCap("history.drop", "Histórico de perda", lambda d: bool(d.get("pop_ping_drop_rate"))),
    FieldCap("history.power", "Potência consumida (W)", lambda d: bool(d.get("power_in"))),
    FieldCap("history.outages", "Lista de interrupções", lambda d: "outages" in d),
]


@dataclass
class ProbeResult:
    capabilities: list[Capability]
    responses: dict[str, CallResult]
    schema: dict[str, Any] | None
    error: StarlinkError | None


def _cap(device: str, origin: str, rc_key: str, label: str, kind: str, status: CapStatus, now: datetime,
         detail: str | None = None, offered: bool = True) -> Capability:
    available = status in (CapStatus.VERIFICADA, CapStatus.SCHEMA_PRESENTE) and offered
    return Capability(key=rc_key, label=label, device=device, origin=origin, kind=kind, status=status,
                      available=available, checked_at=now, detail=detail or EXPLAIN.get(status),
                      offered_by_astryon=offered)


def probe(transport: StarlinkTransport, device: str, *, timeout: float = 5.0) -> ProbeResult:
    now = datetime.now(UTC)
    catalog = DISH_REQUESTS if device == "dish" else ROUTER_REQUESTS
    caps: list[Capability] = []
    responses: dict[str, CallResult] = {}
    try:
        schema = transport.schema_info()
    except StarlinkError as err:
        st = ERROR_TO_STATUS[err.kind]
        detail = err.message if err.kind == ErrorKind.SCHEMA else None
        for rc in catalog:
            caps.append(_cap(device, "grpc_request", rc.key, rc.label, rc.kind, st, now, detail, rc.offered))
        return ProbeResult(caps, responses, None, err)

    fields = set(schema.get("request_fields") or [])
    for rc in catalog:
        if rc.request not in fields:
            caps.append(_cap(device, "grpc_request", rc.key, rc.label, rc.kind, CapStatus.AUSENTE_NO_SCHEMA, now,
                             offered=rc.offered))
            continue
        if not rc.probe:
            st = CapStatus.SCHEMA_PRESENTE if rc.offered else CapStatus.NAO_CONSULTADA
            detail = rc.note or ("Presente no schema. A autorização só é conhecida ao executar com confirmação."
                                 if rc.kind == "controle" else None)
            caps.append(_cap(device, "grpc_request", rc.key, rc.label, rc.kind, st, now, detail, rc.offered))
            continue
        try:
            res = transport.call(rc.request, None, timeout=timeout)
            responses[rc.request] = res
            caps.append(_cap(device, "grpc_request", rc.key, rc.label, rc.kind, CapStatus.VERIFICADA, now,
                             f"Resposta: {res.response_field}", rc.offered))
        except StarlinkError as err:
            caps.append(_cap(device, "grpc_request", rc.key, rc.label, rc.kind, ERROR_TO_STATUS[err.kind], now,
                             None if err.kind != ErrorKind.UNKNOWN else err.message, rc.offered))

    if device == "dish":
        caps += _field_caps("status_field", STATUS_FIELDS, responses.get("get_status"), now)
        caps += _field_caps("history_field", HISTORY_FIELDS, responses.get("get_history"), now)
    return ProbeResult(caps, responses, schema, None)


def _field_caps(origin: str, catalog: list[FieldCap], res: CallResult | None, now: datetime) -> list[Capability]:
    out = []
    for fc in catalog:
        if res is None:
            out.append(_cap("dish", origin, fc.key, fc.label, "leitura", CapStatus.NAO_CONSULTADA, now,
                            "Chamada de origem indisponível."))
        elif fc.check(res.data):
            out.append(_cap("dish", origin, fc.key, fc.label, "leitura", CapStatus.VERIFICADA, now))
        else:
            out.append(_cap("dish", origin, fc.key, fc.label, "leitura", CapStatus.CAMPO_AUSENTE, now))
    return out


def unreachable_matrix(device: str, reason: str) -> list[Capability]:
    now = datetime.now(UTC)
    catalog = DISH_REQUESTS if device == "dish" else ROUTER_REQUESTS
    return [_cap(device, "grpc_request", rc.key, rc.label, rc.kind, CapStatus.INALCANCAVEL, now, reason, rc.offered)
            for rc in catalog]
