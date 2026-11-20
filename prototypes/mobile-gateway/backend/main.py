"""
ASTRYON Mobile Gateway — Backend de protótipo.

FastAPI simples que recebe telemetria de apps mobile conectados na rede local
da antena Starlink.
"""

import os
import secrets
import sqlite3
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

DB_PATH = Path(
    os.environ.get("ASTRYON_DB_PATH", str(Path(__file__).with_name("gateway.db")))
)


# ---------------------------------------------------------------------------
# Modelos Pydantic
# ---------------------------------------------------------------------------


class PairingCreate(BaseModel):
    user_id: str = Field(..., min_length=1)


class PairingResponse(BaseModel):
    pairing_code: str
    expires_at: str


class DeviceRegister(BaseModel):
    pairing_code: str
    device_name: str
    starlink_ip: str = "192.168.100.1"
    starlink_model: str = "unknown"


class DeviceRegisterResponse(BaseModel):
    device_id: str
    device_token: str
    status: str


class TelemetryPayload(BaseModel):
    timestamp: str
    source: str = "mobile_gateway"
    data: dict[str, Any]


class TelemetryResponse(BaseModel):
    status: str
    received_at: str


class DeviceOut(BaseModel):
    id: str
    name: str
    status: str
    last_seen: str | None


# ---------------------------------------------------------------------------
# Banco de dados SQLite simples
# ---------------------------------------------------------------------------


def init_db() -> None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS pairing_codes (
                code TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                used INTEGER DEFAULT 0,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS devices (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                name TEXT NOT NULL,
                token TEXT UNIQUE NOT NULL,
                starlink_ip TEXT NOT NULL,
                starlink_model TEXT NOT NULL,
                status TEXT DEFAULT 'active',
                created_at TEXT NOT NULL,
                last_seen TEXT
            );

            CREATE TABLE IF NOT EXISTS telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                source TEXT,
                payload TEXT NOT NULL,
                received_at TEXT NOT NULL
            );
            """
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def generate_code() -> str:
    """Gera um código de pareamento legível, ex: A3B7-X9K2."""
    raw = secrets.token_hex(4).upper()
    return f"{raw[:4]}-{raw[4:]}"


def generate_token() -> str:
    return secrets.token_urlsafe(32)


def get_device_by_token(conn: sqlite3.Connection, token: str) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT id, user_id, name, status, last_seen FROM devices WHERE token = ?",
        (token,),
    ).fetchone()
    if row is None:
        return None
    return {
        "id": row[0],
        "user_id": row[1],
        "name": row[2],
        "status": row[3],
        "last_seen": row[4],
    }


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


STATIC_DIR = Path(__file__).with_name("static")

app = FastAPI(
    title="ASTRYON Mobile Gateway API",
    version="0.1.0",
    description="Backend de protótipo para o app-gateway ASTRYON.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Protótipo — restrinja em produção.
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/dashboard", include_in_schema=False)
def dashboard():
    """Serve o dashboard web de protótipo."""
    return FileResponse(STATIC_DIR / "index.html")


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    """Retorna erro genérico sem vazar detalhes internos."""
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.post("/api/v1/auth/pairing", response_model=PairingResponse)
def create_pairing_code(payload: PairingCreate):
    """Cria um código de pareamento para um usuário."""
    code = generate_code()
    expires_at = datetime.now(timezone.utc) + timedelta(hours=24)

    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            INSERT INTO pairing_codes (code, user_id, expires_at, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (code, payload.user_id, expires_at.isoformat(), now_iso()),
        )

    return PairingResponse(
        pairing_code=code,
        expires_at=expires_at.isoformat(),
    )


@app.post("/api/v1/devices/register", response_model=DeviceRegisterResponse)
def register_device(payload: DeviceRegister):
    """Registra um dispositivo mobile usando um código de pareamento válido."""
    with sqlite3.connect(DB_PATH) as conn:
        row = conn.execute(
            """
            SELECT user_id, used, expires_at FROM pairing_codes WHERE code = ?
            """,
            (payload.pairing_code,),
        ).fetchone()

        if row is None:
            raise HTTPException(status_code=404, detail="Pairing code not found")

        user_id, used, expires_at = row

        if used:
            raise HTTPException(status_code=400, detail="Pairing code already used")

        if datetime.fromisoformat(expires_at) < datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="Pairing code expired")

        device_id = f"dev_{secrets.token_hex(8)}"
        device_token = generate_token()
        created_at = now_iso()

        conn.execute(
            """
            INSERT INTO devices
            (id, user_id, name, token, starlink_ip, starlink_model, created_at, last_seen)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                device_id,
                user_id,
                payload.device_name,
                device_token,
                payload.starlink_ip,
                payload.starlink_model,
                created_at,
                created_at,
            ),
        )

        conn.execute(
            "UPDATE pairing_codes SET used = 1 WHERE code = ?",
            (payload.pairing_code,),
        )

    return DeviceRegisterResponse(
        device_id=device_id,
        device_token=device_token,
        status="active",
    )


@app.post("/api/v1/telemetry", response_model=TelemetryResponse)
def receive_telemetry(
    payload: TelemetryPayload,
    x_device_token: str = Header(..., alias="X-Device-Token"),
):
    """Recebe um pacote de telemetria de um app-gateway."""
    with sqlite3.connect(DB_PATH) as conn:
        device = get_device_by_token(conn, x_device_token)
        if device is None:
            raise HTTPException(status_code=401, detail="Invalid device token")

        if device["status"] != "active":
            raise HTTPException(status_code=403, detail="Device inactive")

        received_at = now_iso()

        conn.execute(
            """
            INSERT INTO telemetry (device_id, user_id, timestamp, source, payload, received_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                device["id"],
                device["user_id"],
                payload.timestamp,
                payload.source,
                __import__("json").dumps(payload.data),
                received_at,
            ),
        )

        conn.execute(
            "UPDATE devices SET last_seen = ? WHERE id = ?",
            (received_at, device["id"]),
        )

    return TelemetryResponse(status="ok", received_at=received_at)


@app.get("/api/v1/devices")
def list_devices():
    """Lista todos os dispositivos cadastrados (protótipo — em produção filtre por usuário)."""
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT id, name, status, last_seen FROM devices ORDER BY created_at DESC
            """
        ).fetchall()

    return {
        "devices": [
            DeviceOut(
                id=row["id"],
                name=row["name"],
                status=row["status"],
                last_seen=row["last_seen"],
            )
            for row in rows
        ]
    }


@app.get("/api/v1/devices/{device_id}/telemetry")
def get_device_telemetry(device_id: str):
    """Retorna os últimos registros de telemetria de um dispositivo."""
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT timestamp, source, payload, received_at
            FROM telemetry
            WHERE device_id = ?
            ORDER BY received_at DESC
            LIMIT 50
            """,
            (device_id,),
        ).fetchall()

    return {
        "telemetry": [
            {
                "timestamp": row["timestamp"],
                "source": row["source"],
                "payload": __import__("json").loads(row["payload"]),
                "received_at": row["received_at"],
            }
            for row in rows
        ]
    }


@app.get("/api/v1/summary")
def summary():
    """Resumo agregado para o dashboard web."""
    online_window = timedelta(minutes=5)
    cutoff = datetime.now(timezone.utc) - online_window

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        devices = conn.execute(
            "SELECT id, name, status, last_seen FROM devices ORDER BY created_at DESC"
        ).fetchall()

        sample_count = conn.execute(
            "SELECT COUNT(*) FROM telemetry"
        ).fetchone()[0]

        recent_rows = conn.execute(
            """
            SELECT device_id, timestamp, payload, received_at
            FROM telemetry
            ORDER BY received_at DESC
            LIMIT 60
            """
        ).fetchall()

    device_list = []
    online_count = 0
    for row in devices:
        last_seen = row["last_seen"]
        online = False
        if last_seen:
            try:
                online = datetime.fromisoformat(last_seen) >= cutoff
            except ValueError:
                online = False
        if online:
            online_count += 1
        device_list.append(
            {
                "id": row["id"],
                "name": row["name"],
                "status": row["status"],
                "last_seen": last_seen,
                "online": online,
            }
        )

    recent_telemetry = []
    for row in reversed(recent_rows):
        try:
            payload = __import__("json").loads(row["payload"])
        except (ValueError, TypeError):
            payload = {}
        recent_telemetry.append(
            {
                "device_id": row["device_id"],
                "timestamp": row["timestamp"],
                "payload": payload,
                "received_at": row["received_at"],
            }
        )

    return {
        "generated_at": now_iso(),
        "device_count": len(device_list),
        "online_count": online_count,
        "sample_count": sample_count,
        "devices": device_list,
        "recent_telemetry": recent_telemetry,
    }


@app.get("/api/v1/health")
def health():
    return {"status": "ok", "time": now_iso()}
