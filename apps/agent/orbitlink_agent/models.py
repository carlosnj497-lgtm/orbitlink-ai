"""Modelos compartilhados. Toda métrica carrega sua origem (`source`)."""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class Source(StrEnum):
    REAL = "real"
    CALCULADA = "calculada"
    ESTIMADA = "estimada"
    IMPORTADA = "importada"
    SENSOR_ESP32 = "sensor_esp32"
    INDISPONIVEL = "indisponivel"
    DEMONSTRACAO = "demonstracao"


class ConnState(StrEnum):
    CONECTADA = "conectada"
    INICIALIZANDO = "inicializando"
    BUSCANDO = "buscando"
    DEGRADADA = "degradada"
    OFFLINE = "offline"
    DESCONHECIDA = "desconhecida"


class Metric(BaseModel):
    value: float | int | str | bool | None
    unit: str | None = None
    source: Source
    note: str | None = None


def utcnow() -> datetime:
    return datetime.now(UTC)


class DeviceIdentity(BaseModel):
    terminal_key: str | None = Field(None, description="Hash estável do ID do terminal (o ID bruto nunca sai do agente)")
    hardware_version: str | None = None
    software_version: str | None = None
    board_rev: int | None = None
    bootcount: int | None = None
    generation_number: int | None = None


class Outage(BaseModel):
    cause: str
    started_at: datetime | None = None
    duration_s: float | None = None
    timestamp_quality: str = "desconhecida"  # "confiavel" | "incerta" | "desconhecida"
    did_switch: bool | None = None


class DishStatus(BaseModel):
    observed_at: datetime
    origin: str
    state: ConnState
    state_reason: str | None = None
    device: DeviceIdentity
    metrics: dict[str, Metric]
    alerts: list[str] = Field(default_factory=list)
    outage: Outage | None = None
    fields_present: list[str] = Field(default_factory=list)
    fields_missing: list[str] = Field(default_factory=list)


class HistorySample(BaseModel):
    counter: int
    ts: datetime
    pop_ping_drop_rate: float | None = None
    pop_ping_latency_ms: float | None = None
    downlink_throughput_bps: float | None = None
    uplink_throughput_bps: float | None = None
    power_in_w: float | None = None


class ObstructionMap(BaseModel):
    observed_at: datetime
    origin: str
    num_rows: int
    num_cols: int
    snr: list[float]  # -1 = sem dado naquela célula
    min_elevation_deg: float | None = None
    max_theta_deg: float | None = None
    reference_frame: str | None = None


class JSONDict(BaseModel):
    data: dict[str, Any]
