"""Normalização de respostas da API local para modelos tipados.

Regras:
* Campo ausente na resposta => métrica ausente (nunca zero inventado).
* `downlink/uplink_throughput_bps` = tráfego corrente, NÃO capacidade. Mbps = bps / 1_000_000.
* `pop_ping_latency_ms` = latência até o PoP da Starlink, medida pela própria antena.
* Origem: `real` quando veio do gRPC; `demonstracao` quando veio de fixture.
"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta
from typing import Any

from ..models import (
    ConnState,
    DeviceIdentity,
    DishStatus,
    Metric,
    ObstructionMap,
    Outage,
    Source,
)

# Campos que esperamos ver; os ausentes são listados (não é erro: firmware varia).
EXPECTED_STATUS_FIELDS = [
    "device_info",
    "device_state",
    "pop_ping_latency_ms",
    "pop_ping_drop_rate",
    "downlink_throughput_bps",
    "uplink_throughput_bps",
    "obstruction_stats",
    "alerts",
    "eth_speed_mbps",
    "gps_stats",
    "is_snr_above_noise_floor",
]

# Limiar padrão para "degradada" (configurável no coletor).
DEGRADED_DROP_RATE = 0.05

GPS_EPOCH = datetime(1980, 1, 6, tzinfo=UTC)
GPS_LEAP_SECONDS = 18


def source_for(origin: str) -> Source:
    return Source.REAL if origin == "grpc" else Source.DEMONSTRACAO


def terminal_key(raw_id: str | None) -> str | None:
    if not raw_id:
        return None
    return "ut-" + hashlib.sha256(raw_id.encode("utf-8")).hexdigest()[:16]


def _num(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _int(value: Any) -> int | None:
    n = _num(value)
    return int(n) if n is not None else None


def parse_device_info(info: dict[str, Any] | None) -> DeviceIdentity:
    info = info or {}
    return DeviceIdentity(
        terminal_key=terminal_key(info.get("id")),
        hardware_version=info.get("hardware_version") or None,
        software_version=info.get("software_version") or None,
        board_rev=_int(info.get("board_rev")),
        bootcount=_int(info.get("bootcount")),
        generation_number=_int(info.get("generation_number")),
    )


def outage_timestamp(start_ns: Any, now: datetime) -> tuple[datetime | None, str]:
    """Interpreta `start_timestamp_ns`.

    A documentação pública não fixa a época desse campo. Testamos época Unix e época GPS e
    aceitamos a que cair numa janela plausível (últimas 24 h). Caso contrário: "incerta".
    """
    ns = _num(start_ns)
    if ns is None or ns <= 0:
        return None, "desconhecida"
    seconds = ns / 1e9
    candidates = [
        datetime.fromtimestamp(seconds, tz=UTC) if seconds < 4e9 else None,
        GPS_EPOCH + timedelta(seconds=seconds - GPS_LEAP_SECONDS),
    ]
    window_start = now - timedelta(hours=24)
    plausible = [c for c in candidates if c is not None and window_start <= c <= now + timedelta(minutes=5)]
    if len(plausible) == 1:
        return plausible[0], "confiavel"
    if plausible:
        return plausible[0], "incerta"
    return None, "incerta"


def parse_outage(raw: dict[str, Any] | None, now: datetime) -> Outage | None:
    if not raw:
        return None
    started_at, quality = outage_timestamp(raw.get("start_timestamp_ns"), now)
    duration_ns = _num(raw.get("duration_ns"))
    return Outage(
        cause=str(raw.get("cause") or "UNKNOWN"),
        started_at=started_at,
        duration_s=duration_ns / 1e9 if duration_ns is not None else None,
        timestamp_quality=quality,
        did_switch=raw.get("did_switch") if isinstance(raw.get("did_switch"), bool) else None,
    )


def classify_state(data: dict[str, Any], outage: Outage | None, drop_threshold: float) -> tuple[ConnState, str | None]:
    if outage is not None:
        cause = outage.cause.upper()
        if cause in {"BOOTING"}:
            return ConnState.INICIALIZANDO, cause
        if cause in {"NO_SCHEDULE", "SEARCHING"}:
            return ConnState.BUSCANDO, cause
        return ConnState.OFFLINE, cause
    drop = _num(data.get("pop_ping_drop_rate"))
    if drop is not None and drop >= drop_threshold:
        return ConnState.DEGRADADA, f"perda de ping ao PoP {drop * 100:.1f}%"
    if drop is None and _num(data.get("pop_ping_latency_ms")) is None:
        return ConnState.DESCONHECIDA, "campos de qualidade ausentes nesta resposta"
    return ConnState.CONECTADA, None


def active_alerts(alerts: dict[str, Any] | None) -> list[str]:
    if not alerts:
        return []
    return sorted(k for k, v in alerts.items() if v is True)


def normalize_status(
    data: dict[str, Any], *, origin: str, observed_at: datetime | None = None, drop_threshold: float = DEGRADED_DROP_RATE
) -> DishStatus:
    now = observed_at or datetime.now(UTC)
    src = source_for(origin)
    m: dict[str, Metric] = {}

    def put(key: str, value: float | int | bool | str | None, unit: str | None, note: str | None = None) -> None:
        if value is not None:
            m[key] = Metric(value=value, unit=unit, source=src, note=note)

    dl = _num(data.get("downlink_throughput_bps"))
    ul = _num(data.get("uplink_throughput_bps"))
    put("downlink_mbps", round(dl / 1_000_000, 3) if dl is not None else None, "Mbps", "tráfego corrente, não capacidade")
    put("uplink_mbps", round(ul / 1_000_000, 3) if ul is not None else None, "Mbps", "tráfego corrente, não capacidade")
    lat = _num(data.get("pop_ping_latency_ms"))
    put("pop_latency_ms", round(lat, 1) if lat is not None else None, "ms", "latência medida pela antena até o PoP")
    drop = _num(data.get("pop_ping_drop_rate"))
    put("pop_drop_pct", round(drop * 100, 2) if drop is not None else None, "%", "perda de ping ao PoP")
    state = data.get("device_state") or {}
    put("uptime_s", _int(state.get("uptime_s")), "s")
    put("eth_speed_mbps", _int(data.get("eth_speed_mbps")), "Mbps", "velocidade negociada do link Ethernet")
    snr = data.get("is_snr_above_noise_floor")
    put("snr_above_noise_floor", snr if isinstance(snr, bool) else None, None)

    obs = data.get("obstruction_stats")
    if isinstance(obs, dict):
        frac = _num(obs.get("fraction_obstructed"))
        put("obstruction_pct", round(frac * 100, 2) if frac is not None else None, "%")
        cur = obs.get("currently_obstructed")
        put("currently_obstructed", cur if isinstance(cur, bool) else None, None)
        put("obstruction_valid_s", _num(obs.get("valid_s")), "s", "janela de validade da estatística")

    gps = data.get("gps_stats")
    if isinstance(gps, dict):
        valid = gps.get("gps_valid")
        put("gps_valid", valid if isinstance(valid, bool) else None, None)
        put("gps_sats", _int(gps.get("gps_sats")), None)

    outage = parse_outage(data.get("outage"), now)
    st, reason = classify_state(data, outage, drop_threshold)
    present = sorted(data.keys())
    return DishStatus(
        observed_at=now,
        origin=origin,
        state=st,
        state_reason=reason,
        device=parse_device_info(data.get("device_info")),
        metrics=m,
        alerts=active_alerts(data.get("alerts")),
        outage=outage,
        fields_present=present,
        fields_missing=[f for f in EXPECTED_STATUS_FIELDS if f not in data],
    )


def normalize_obstruction_map(data: dict[str, Any], *, origin: str, observed_at: datetime | None = None) -> ObstructionMap | None:
    rows = _int(data.get("num_rows"))
    cols = _int(data.get("num_cols"))
    snr = data.get("snr")
    if not rows or not cols or not isinstance(snr, list) or len(snr) != rows * cols:
        return None
    return ObstructionMap(
        observed_at=observed_at or datetime.now(UTC),
        origin=origin,
        num_rows=rows,
        num_cols=cols,
        snr=[float(x) for x in snr],
        min_elevation_deg=_num(data.get("min_elevation_deg")),
        max_theta_deg=_num(data.get("max_theta_deg")),
        reference_frame=str(data["map_reference_frame"]) if data.get("map_reference_frame") is not None else None,
    )
