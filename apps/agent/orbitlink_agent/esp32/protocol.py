"""Protocolo ESP32 ↔ agente (v1): pareamento por código temporário e mensagens assinadas com HMAC-SHA256.

Assinatura: hex(HMAC_SHA256(secret, f"{device_id}\\n{ts}\\n{nonce}\\n{sha256_hex(body)}"))
Cabeçalhos: X-OL-Device, X-OL-Ts (epoch s), X-OL-Nonce (8–64 chars), X-OL-Sig.
Proteções: janela de relógio, nonce de uso único por dispositivo (anti-replay), limite de tamanho,
whitelist de nomes de sensor, leituras idempotentes por (nó, seq, sensor).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import math
import re
import secrets
from typing import Any

from pydantic import BaseModel, Field, field_validator

from ..auth.secrets_store import protect, unprotect
from ..storage.db import Database, now_ts

PAIR_TTL_S = 600
MAX_BODY = 32 * 1024
SENSOR_RE = re.compile(r"^[a-z0-9_]{2,20}\.[a-z0-9_]{2,24}$")
NONCE_RE = re.compile(r"^[A-Za-z0-9_\-]{8,64}$")
DEVICE_RE = re.compile(r"^[a-z0-9\-]{6,40}$")


class Reading(BaseModel):
    seq: int = Field(ge=0, le=2**53)
    ts: int = Field(ge=0, description="epoch s; 0 = relógio não sincronizado (usar age_ms)")
    age_ms: int | None = Field(default=None, ge=0, le=7 * 86400 * 1000)
    sensor: str
    value: float | None
    quality: str = Field(default="ok", pattern=r"^(ok|uncalibrated|fault)$")

    @field_validator("sensor")
    @classmethod
    def _sensor(cls, v: str) -> str:
        if not SENSOR_RE.match(v):
            raise ValueError("nome de sensor inválido")
        return v

    @field_validator("value")
    @classmethod
    def _finite(cls, v: float | None) -> float | None:
        if v is not None and not math.isfinite(v):
            raise ValueError("valor não finito")
        return v


class NodeStatus(BaseModel):
    rssi: int | None = Field(default=None, ge=-120, le=0)
    uptime_s: int | None = Field(default=None, ge=0)
    fw: str | None = Field(default=None, max_length=32)
    heap: int | None = Field(default=None, ge=0)
    buffered: int | None = Field(default=None, ge=0)
    dropped: int | None = Field(default=None, ge=0)


class IngestBody(BaseModel):
    v: int = Field(ge=1, le=1)
    readings: list[Reading] = Field(default_factory=list, max_length=200)
    status: NodeStatus | None = None


class PairBody(BaseModel):
    code: str = Field(pattern=r"^\d{6}$")
    device_id: str
    firmware: str | None = Field(default=None, max_length=32)
    sensors: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("device_id")
    @classmethod
    def _dev(cls, v: str) -> str:
        if not DEVICE_RE.match(v):
            raise ValueError("device_id inválido")
        return v


class AuthError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def _h(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def create_pairing_code(db: Database, name: str, user_id: int) -> tuple[str, int]:
    code = f"{secrets.randbelow(1_000_000):06d}"
    exp = now_ts() + PAIR_TTL_S
    db.execute("INSERT INTO esp32_pairing_codes (code_hash, name, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
               (_h(code), name[:40], user_id, now_ts(), exp))
    return code, exp


def pair(db: Database, body: PairBody) -> dict[str, Any]:
    now = now_ts()
    with db.tx() as c:
        row = c.execute("SELECT * FROM esp32_pairing_codes WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?",
                        (_h(body.code), now)).fetchone()
        if row is None:
            raise AuthError(401, "Código de pareamento inválido ou expirado")
        if c.execute("SELECT 1 FROM esp32_nodes WHERE device_id = ?", (body.device_id,)).fetchone():
            raise AuthError(409, "Dispositivo já pareado. Remova-o no painel para parear novamente.")
        secret = base64.b64encode(secrets.token_bytes(32)).decode()
        c.execute("UPDATE esp32_pairing_codes SET used_at = ? WHERE code_hash = ?", (now, row["code_hash"]))
        cur = c.execute("""INSERT INTO esp32_nodes (device_id, name, secret_enc, firmware, sensors_json, created_at)
                           VALUES (?, ?, ?, ?, ?, ?)""",
                        (body.device_id, row["name"], protect(secret), body.firmware,
                         ",".join(s for s in body.sensors if SENSOR_RE.match(s)), now))
    return {"node_id": cur.lastrowid, "secret": secret, "server_time": now, "protocol": 1}


def sign(secret_b64: str, device_id: str, ts: int, nonce: str, body: bytes) -> str:
    msg = f"{device_id}\n{ts}\n{nonce}\n{hashlib.sha256(body).hexdigest()}".encode()
    return hmac.new(base64.b64decode(secret_b64), msg, hashlib.sha256).hexdigest()


def verify(db: Database, headers: dict[str, str], body: bytes, skew_s: int) -> dict[str, Any]:
    if len(body) > MAX_BODY:
        raise AuthError(413, "Corpo grande demais")
    dev = headers.get("x-ol-device", "")
    ts_raw = headers.get("x-ol-ts", "")
    nonce = headers.get("x-ol-nonce", "")
    sig = headers.get("x-ol-sig", "")
    if not (DEVICE_RE.match(dev) and ts_raw.isdigit() and NONCE_RE.match(nonce) and re.fullmatch(r"[0-9a-f]{64}", sig)):
        raise AuthError(401, "Cabeçalhos de autenticação ausentes ou inválidos")
    node = db.one("SELECT * FROM esp32_nodes WHERE device_id = ? AND enabled = 1", (dev,))
    if node is None:
        raise AuthError(401, "Dispositivo desconhecido ou desabilitado")
    ts = int(ts_raw)
    now = now_ts()
    if abs(now - ts) > skew_s:
        raise AuthError(401, f"Relógio fora da janela permitida (servidor={now})")
    expected = sign(unprotect(node["secret_enc"]), dev, ts, nonce, body)
    if not hmac.compare_digest(expected, sig):
        raise AuthError(401, "Assinatura inválida")
    cur = db.execute("INSERT OR IGNORE INTO esp32_nonces (device_id, nonce, ts) VALUES (?, ?, ?)", (dev, nonce, now))
    if cur.rowcount == 0:
        raise AuthError(401, "Nonce repetido (replay)")
    return node


def ingest(db: Database, node: dict[str, Any], body: IngestBody, ip_masked: str | None, skew_s: int) -> dict[str, Any]:
    now = now_ts()
    accepted = rejected = 0
    power_transitions: list[tuple[int, float]] = []
    with db.tx() as c:
        for r in body.readings:
            ts = r.ts if r.ts > 0 else (now - (r.age_ms or 0) // 1000)
            if ts > now + skew_s or ts < now - 7 * 86400:
                rejected += 1
                continue
            cur = c.execute("""INSERT OR IGNORE INTO esp32_sensor_readings (node_id, seq, ts, received_at, sensor, value, quality)
                               VALUES (?, ?, ?, ?, ?, ?, ?)""", (node["id"], r.seq, ts, now, r.sensor, r.value, r.quality))
            accepted += cur.rowcount
            if r.sensor == "power.present" and r.value is not None and r.quality != "fault":
                power_transitions.append((ts, r.value))
        st = body.status
        c.execute("""UPDATE esp32_nodes SET last_seen = ?, last_ip_masked = COALESCE(?, last_ip_masked),
                     rssi = COALESCE(?, rssi), uptime_s = COALESCE(?, uptime_s), firmware = COALESCE(?, firmware) WHERE id = ?""",
                  (now, ip_masked, st.rssi if st else None, st.uptime_s if st else None, st.fw if st else None, node["id"]))
        for ts, present in sorted(power_transitions):
            if present < 0.5:
                c.execute("""INSERT OR IGNORE INTO connection_events (terminal_id, kind, cause, start_ts, confidence, evidence_json)
                             SELECT NULL, 'power_loss', 'Sensor ESP32 indicou ausência de alimentação', ?, 'confirmado', ?
                             WHERE NOT EXISTS (SELECT 1 FROM connection_events WHERE kind='power_loss' AND end_ts IS NULL)""",
                          (ts, f'{{"fonte": "sensor_esp32", "no": "{node["device_id"]}"}}'))
            else:
                c.execute("UPDATE connection_events SET end_ts = ?, duration_s = ? - start_ts WHERE kind='power_loss' "
                          "AND end_ts IS NULL AND start_ts <= ?", (ts, ts, ts))
        c.execute("DELETE FROM esp32_nonces WHERE ts < ?", (now - 86400,))
    return {"accepted": accepted, "duplicates_or_rejected": len(body.readings) - accepted, "rejected": rejected,
            "server_time": now}
