"""Emulador do nó ESP32 (ingest v1, pareamento v2) — para testar pareamento e ingestão sem hardware.

As leituras são SINTÉTICAS e enviadas com o nome de sensor real; use apenas para testes/demonstração e remova o
nó emulado no painel depois (Centro ESP32 → remover). Nada aqui representa medição física.

Uso (PowerShell, com o agente rodando e ASTRYON_ESP32_ENABLED=true):
  apps\\agent\\.venv\\Scripts\\python.exe scripts\\esp32_emulator.py pair --code XXXX-XXXX-XXXX
  apps\\agent\\.venv\\Scripts\\python.exe scripts\\esp32_emulator.py run --count 10
  apps\\agent\\.venv\\Scripts\\python.exe scripts\\esp32_emulator.py replay     # deve ser recusado (401)
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import math
import secrets
import sys
import time
from pathlib import Path

import httpx

STATE = Path(__file__).resolve().parents[1] / "data" / "esp32_emulator.json"


def sign(secret_b64: str, device: str, ts: int, nonce: str, body: bytes) -> str:
    msg = f"{device}\n{ts}\n{nonce}\n{hashlib.sha256(body).hexdigest()}".encode()
    return hmac.new(base64.b64decode(secret_b64), msg, hashlib.sha256).hexdigest()


def load() -> dict:
    if not STATE.exists():
        sys.exit("Emulador não pareado. Rode: esp32_emulator.py pair --code XXXX-XXXX-XXXX")
    return json.loads(STATE.read_text(encoding="utf-8"))


def post_signed(base: str, st: dict, path: str, payload: dict, nonce: str | None = None) -> httpx.Response:
    body = json.dumps(payload).encode()
    ts = int(time.time())
    nonce = nonce or secrets.token_hex(12)
    headers = {"Content-Type": "application/json", "X-OL-Device": st["device_id"], "X-OL-Ts": str(ts), "X-OL-Nonce": nonce,
               "X-OL-Sig": sign(st["secret"], st["device_id"], ts, nonce, body)}
    return httpx.post(base + path, content=body, headers=headers, timeout=10)


def main() -> int:
    p = argparse.ArgumentParser(description="Emulador ESP32 do ASTRYON (dados sintéticos)")
    p.add_argument("--agent", default="http://127.0.0.1:8788")
    sub = p.add_subparsers(dest="cmd", required=True)
    pp = sub.add_parser("pair")
    pp.add_argument("--code", required=True)
    pp.add_argument("--device-id", default="esp32-emulador0001")
    pr = sub.add_parser("run")
    pr.add_argument("--count", type=int, default=5)
    pr.add_argument("--interval", type=float, default=2.0)
    pr.add_argument("--power-loss", action="store_true", help="simula ausência de alimentação na 3ª leitura")
    sub.add_parser("replay")
    a = p.parse_args()

    if a.cmd == "pair":
        # Pareamento v2, como o firmware: o código não é enviado; vai só a prova, e o segredo volta cifrado.
        from astryon_agent.esp32 import protocol

        key = protocol.pair_key(a.code)
        nonce = secrets.token_hex(16)
        r = httpx.post(a.agent + "/esp32/v1/pair", json={
            "v": 2, "device_id": a.device_id, "nonce": nonce, "proof": protocol.pair_proof(key, a.device_id, nonce),
            "firmware": "emulador-0.2", "sensors": ["env.temp_c", "power.present"]}, timeout=10)
        print(r.status_code, r.text if r.status_code != 200 else "pareado")
        if r.status_code == 200:
            out = r.json()
            secret = base64.b64encode(protocol.open_secret(key, out["iv"], out["secret_enc"], a.device_id, nonce)).decode()
            STATE.parent.mkdir(parents=True, exist_ok=True)
            STATE.write_text(json.dumps({"device_id": a.device_id, "secret": secret, "seq": 0}), encoding="utf-8")
        return 0 if r.status_code == 200 else 1

    st = load()
    if a.cmd == "replay":
        payload = {"v": 1, "readings": [], "status": {"uptime_s": 1}}
        nonce = secrets.token_hex(12)
        r1 = post_signed(a.agent, st, "/esp32/v1/heartbeat", payload, nonce)
        r2 = post_signed(a.agent, st, "/esp32/v1/heartbeat", payload, nonce)
        print("1º envio:", r1.status_code, "| replay do mesmo nonce:", r2.status_code, r2.text)
        return 0 if r2.status_code == 401 else 1

    for i in range(a.count):
        st["seq"] += 1
        present = 0.0 if (a.power_loss and i == 2) else 1.0
        readings = [
            {"seq": st["seq"], "ts": int(time.time()), "sensor": "env.temp_c", "value": round(31 + 3 * math.sin(i / 3), 2),
             "quality": "ok"},
            {"seq": st["seq"], "ts": int(time.time()), "sensor": "power.present", "value": present, "quality": "ok"},
        ]
        r = post_signed(a.agent, st, "/esp32/v1/ingest",
                        {"v": 1, "readings": readings, "status": {"rssi": -58, "uptime_s": i * 30, "fw": "emulador-0.1"}})
        print(f"leitura {i + 1}: HTTP {r.status_code} {r.text}")
        STATE.write_text(json.dumps(st), encoding="utf-8")
        time.sleep(a.interval)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
