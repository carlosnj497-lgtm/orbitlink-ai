"""MQTT: pacotes conforme o protocolo 3.1.1, descoberta do Home Assistant e falha honesta."""

from __future__ import annotations

import asyncio
import contextlib
import json
import struct

import pytest

from astryon_agent.config import Settings
from astryon_agent.integrations import mqtt
from astryon_agent.storage.db import Database


def _parse_remaining(buf: bytes, i: int) -> tuple[int, int]:
    mult, value = 1, 0
    while True:
        b = buf[i]
        value += (b & 0x7F) * mult
        i += 1
        if not b & 0x80:
            return value, i
        mult *= 128


def _read_str(buf: bytes, i: int) -> tuple[str, int]:
    n = struct.unpack("!H", buf[i:i + 2])[0]
    return buf[i + 2:i + 2 + n].decode(), i + 2 + n


def test_connect_packet_layout():
    p = mqtt.connect_packet("astryon-x", "astryon/x/status", "ha", "segredo")
    assert p[0] == 0x10
    length, i = _parse_remaining(p, 1)
    assert length == len(p) - i
    proto, i = _read_str(p, i)
    assert proto == "MQTT" and p[i] == 4
    flags = p[i + 1]
    assert flags & 0x80 and flags & 0x40 and flags & 0x20 and flags & 0x04 and flags & 0x02
    i += 4
    cid, i = _read_str(p, i)
    will_topic, i = _read_str(p, i)
    will_msg, i = _read_str(p, i)
    user, i = _read_str(p, i)
    pwd, _ = _read_str(p, i)
    assert (cid, will_topic, will_msg, user, pwd) == ("astryon-x", "astryon/x/status", "offline", "ha", "segredo")


def test_publish_packet_with_long_payload_uses_multibyte_length():
    payload = "x" * 300
    p = mqtt.publish_packet("t/a", payload)
    assert p[0] == 0x31  # PUBLISH, retido
    length, i = _parse_remaining(p, 1)
    assert length == 2 + 3 + 300 and len(p) == i + length


def test_discovery_has_units_and_unknown_not_zero(tmp_path):
    s = Settings(_env_file=None, data_dir=tmp_path, api_token="t", mqtt_host="broker")
    msgs = dict(mqtt.discovery_messages(s, "abc123"))
    cfg = json.loads(msgs["homeassistant/sensor/astryon_abc123/latency_ms/config"])
    assert cfg["unit_of_measurement"] == "ms" and cfg["state_topic"] == "astryon/abc123/state"
    assert cfg["availability_topic"] == "astryon/abc123/status"
    assert "homeassistant/binary_sensor/astryon_abc123/dish_reachable/config" in msgs

    db = Database(tmp_path / "m.sqlite3")
    values = mqtt.state_payload(db, s, None)
    assert values["download_mbps"] is None and values["dish_reachable"] is None


class Broker:
    def __init__(self, rc: int = 0):
        self.rc = rc
        self.publishes: list[tuple[str, str]] = []
        self.got_state = asyncio.Event()

    async def handle(self, reader, writer):
        try:
            while True:
                head = await reader.readexactly(1)
                n, mult = 0, 1
                while True:
                    b = (await reader.readexactly(1))[0]
                    n += (b & 0x7F) * mult
                    mult *= 128
                    if not b & 0x80:
                        break
                body = await reader.readexactly(n) if n else b""
                kind = head[0] >> 4
                if kind == 1:
                    writer.write(bytes([0x20, 0x02, 0x00, self.rc]))
                    await writer.drain()
                elif kind == 3:
                    topic, i = _read_str(body, 0)
                    self.publishes.append((topic, body[i:].decode()))
                    if topic.endswith("/state"):
                        self.got_state.set()
        except asyncio.IncompleteReadError:
            pass


async def _run_against(broker: Broker, tmp_path, **kw):
    server = await asyncio.start_server(broker.handle, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    s = Settings(_env_file=None, data_dir=tmp_path, api_token="t", mqtt_host="127.0.0.1", mqtt_port=port, **kw)
    db = Database(tmp_path / "m.sqlite3")
    state: dict = {}
    task = asyncio.create_task(mqtt._session(db, s, None, state))
    return server, task, state


async def test_session_publishes_status_discovery_and_state(tmp_path):
    broker = Broker()
    server, task, state = await _run_against(broker, tmp_path, mqtt_username="ha", mqtt_password="x")
    await asyncio.wait_for(broker.got_state.wait(), 5)
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task
    server.close()
    topics = [t for t, _ in broker.publishes]
    assert topics[0].endswith("/status") and broker.publishes[0][1] == "online"
    assert any(t.startswith("homeassistant/sensor/") for t in topics)
    state_msg = json.loads(next(p for t, p in broker.publishes if t.endswith("/state")))
    assert "latency_ms" in state_msg and state["last_publish"]


async def test_session_refused_by_broker(tmp_path):
    server, task, _ = await _run_against(Broker(rc=5), tmp_path)
    with pytest.raises(mqtt.MqttError, match="código 5"):
        await asyncio.wait_for(task, 5)
    server.close()
