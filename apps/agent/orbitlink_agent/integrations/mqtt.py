"""Publicação MQTT (Home Assistant e afins), opcional.

Cliente MQTT 3.1.1 mínimo e só de publicação (QoS 0, mensagens retidas), sem dependência extra:
CONNECT com "last will" (status offline), PUBLISH e PINGREQ. Com `ORBITLINK_MQTT_DISCOVERY`, publica a
descoberta automática do Home Assistant: os sensores aparecem sozinhos em Configurações → Dispositivos.

Tópicos (prefixo padrão "astryon"):
  astryon/<id>/status  "online" / "offline" (retido; offline via last will se o agente cair)
  astryon/<id>/state   JSON com os valores atuais (retido)

Valor ausente vai como null: o Home Assistant mostra "desconhecido", nunca zero inventado.
"""

from __future__ import annotations

import asyncio
import json
import logging
import ssl
import struct
from typing import Any

from ..config import Settings
from ..storage import queries
from ..storage.db import Database, now_ts

log = logging.getLogger("orbitlink.mqtt")

SENSORS: list[dict[str, Any]] = [
    {"key": "download_mbps", "name": "Download", "unit": "Mbit/s", "device_class": "data_rate", "icon": "mdi:download"},
    {"key": "upload_mbps", "name": "Upload", "unit": "Mbit/s", "device_class": "data_rate", "icon": "mdi:upload"},
    {"key": "latency_ms", "name": "Latência até o PoP", "unit": "ms", "device_class": "duration", "icon": "mdi:timer-outline"},
    {"key": "drop_pct", "name": "Perda de ping", "unit": "%", "icon": "mdi:lan-disconnect"},
    {"key": "obstruction_pct", "name": "Obstrução", "unit": "%", "icon": "mdi:tree"},
    {"key": "state", "name": "Estado da conexão", "icon": "mdi:satellite-uplink"},
    {"key": "usage_cycle_pct", "name": "Franquia usada no ciclo", "unit": "%", "icon": "mdi:chart-donut"},
    {"key": "availability_24h", "name": "Disponibilidade 24 h", "unit": "%", "icon": "mdi:check-network"},
    {"key": "rain_mm", "name": "Chuva agora (estimada)", "unit": "mm/h", "device_class": "precipitation_intensity",
     "icon": "mdi:weather-rainy"},
]
BINARY = [{"key": "dish_reachable", "name": "Antena acessível", "device_class": "connectivity"}]


# ------------------------------------------------------------------ protocolo
def _str(s: str) -> bytes:
    b = s.encode()
    return struct.pack("!H", len(b)) + b


def _remaining(n: int) -> bytes:
    out = bytearray()
    while True:
        byte, n = n % 128, n // 128
        out.append(byte | (0x80 if n else 0))
        if not n:
            return bytes(out)


def connect_packet(client_id: str, will_topic: str, username: str | None, password: str | None,
                   keepalive: int = 60) -> bytes:
    flags = 0x02 | 0x04 | 0x20  # clean session + will + will retain (QoS 0)
    payload = _str(client_id) + _str(will_topic) + _str("offline")
    if username:
        flags |= 0x80
        payload += _str(username)
        if password:
            flags |= 0x40
            payload += _str(password)
    var = _str("MQTT") + bytes([4, flags]) + struct.pack("!H", keepalive)
    body = var + payload
    return bytes([0x10]) + _remaining(len(body)) + body


def publish_packet(topic: str, payload: str, retain: bool = True) -> bytes:
    body = _str(topic) + payload.encode()
    return bytes([0x30 | (0x01 if retain else 0)]) + _remaining(len(body)) + body


class MqttError(Exception):
    pass


# ------------------------------------------------------------------ dados
def node_id(db: Database) -> str:
    key = db.scalar("SELECT terminal_key FROM terminals ORDER BY last_seen DESC LIMIT 1")
    tail = "".join(ch for ch in str(key or "astryon") if ch.isalnum())[-12:].lower()
    return tail or "astryon"


def state_payload(db: Database, settings: Settings, collector: Any) -> dict[str, Any]:
    st = collector.state.last_status if collector else None

    def metric(k: str) -> Any:
        m = st.metrics.get(k) if st else None
        return m.value if m is not None and isinstance(m.value, int | float) else None

    tz = settings.timezone
    now = now_ts()
    q = queries.quality(db, None, now - 86400, now, tz)
    plan = queries.usage_plan(db, None, tz, settings.usage_monthly_limit_gb, settings.usage_cycle_start_day)
    from ..weather import service as weather

    w = weather.status(db, settings)["current"]
    return {
        "download_mbps": metric("downlink_mbps"), "upload_mbps": metric("uplink_mbps"),
        "latency_ms": metric("pop_latency_ms"), "drop_pct": metric("pop_drop_pct"),
        "obstruction_pct": metric("obstruction_pct"), "state": st.state if st else "desconhecida",
        "dish_reachable": "ON" if collector and collector.state.dish_reachable else "OFF",
        "usage_cycle_pct": plan["pct_used"], "availability_24h": q["availability_pct"],
        "rain_mm": w["precipitation_mm"] if w else None, "updated_at": now,
    }


def discovery_messages(settings: Settings, nid: str) -> list[tuple[str, str]]:
    base = f"{settings.mqtt_topic_prefix}/{nid}"
    device = {"identifiers": [f"astryon_{nid}"], "name": f"ASTRYON · {settings.terminal_name}",
              "manufacturer": "ASTRYON (projeto independente)", "model": "Starlink Mini (monitor local)"}
    out = []
    for s in SENSORS:
        cfg: dict[str, Any] = {"name": s["name"], "unique_id": f"astryon_{nid}_{s['key']}", "state_topic": f"{base}/state",
                               "value_template": f"{{{{ value_json.{s['key']} }}}}", "availability_topic": f"{base}/status",
                               "device": device, "icon": s["icon"]}
        if "unit" in s:
            cfg["unit_of_measurement"] = s["unit"]
            cfg["state_class"] = "measurement"
        if "device_class" in s:
            cfg["device_class"] = s["device_class"]
        out.append((f"homeassistant/sensor/astryon_{nid}/{s['key']}/config", json.dumps(cfg, ensure_ascii=False)))
    for b in BINARY:
        cfg = {"name": b["name"], "unique_id": f"astryon_{nid}_{b['key']}", "state_topic": f"{base}/state",
               "value_template": f"{{{{ value_json.{b['key']} }}}}", "availability_topic": f"{base}/status",
               "device_class": b["device_class"], "device": device}
        out.append((f"homeassistant/binary_sensor/astryon_{nid}/{b['key']}/config", json.dumps(cfg, ensure_ascii=False)))
    return out


# ------------------------------------------------------------------ laço
async def _session(db: Database, settings: Settings, collector: Any, state: dict[str, Any]) -> None:
    ctx = ssl.create_default_context() if settings.mqtt_tls else None
    reader, writer = await asyncio.wait_for(
        asyncio.open_connection(settings.mqtt_host, settings.mqtt_port, ssl=ctx), timeout=10)
    try:
        nid = await db.run(node_id, db)
        base = f"{settings.mqtt_topic_prefix}/{nid}"
        pwd = settings.mqtt_password.get_secret_value() if settings.mqtt_password else None
        writer.write(connect_packet(f"astryon-{nid}", f"{base}/status", settings.mqtt_username, pwd))
        await writer.drain()
        ack = await asyncio.wait_for(reader.readexactly(4), timeout=10)
        if ack[0] != 0x20 or ack[3] != 0:
            raise MqttError(f"broker recusou a conexão (código {ack[3]})")
        writer.write(publish_packet(f"{base}/status", "online"))
        if settings.mqtt_discovery:
            for topic, payload in discovery_messages(settings, nid):
                writer.write(publish_packet(topic, payload))
        await writer.drain()
        state.update(connected=True, last_error=None)
        log.info("MQTT conectado em %s:%s", settings.mqtt_host, settings.mqtt_port)
        while True:
            values = await db.run(state_payload, db, settings, collector)
            writer.write(publish_packet(f"{base}/state", json.dumps(values, ensure_ascii=False)))
            writer.write(bytes([0xC0, 0x00]))  # PINGREQ: mantém a sessão viva
            await writer.drain()
            state["last_publish"] = now_ts()
            await asyncio.sleep(settings.mqtt_interval_s)
    finally:
        state["connected"] = False
        writer.close()


async def run(db: Database, settings: Settings, collector: Any, state: dict[str, Any]) -> None:
    failures = 0
    while True:
        try:
            await _session(db, settings, collector, state)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - MQTT nunca derruba o agente
            failures += 1
            state["last_error"] = f"{type(exc).__name__}: {str(exc)[:150]}"
            log.warning("MQTT indisponível (%s); nova tentativa em breve", type(exc).__name__)
            await asyncio.sleep(min(300, 5 * 2 ** min(failures, 6)))
        else:
            failures = 0
