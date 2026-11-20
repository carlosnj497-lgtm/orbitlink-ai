"""
ASTRYON Mobile Gateway — Backend de protótipo.

FastAPI simples que recebe telemetria de apps mobile conectados na rede local
da antena Starlink.
"""

import hashlib
import json
import os
import re
import secrets
import sqlite3
import urllib.error
import urllib.request
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

DB_PATH = Path(
    os.environ.get("ASTRYON_DB_PATH", str(Path(__file__).with_name("gateway.db")))
)

# Token opcional para as rotas de leitura agregada (protótipo). Sem ele
# configurado, o acesso continua aberto.
ADMIN_TOKEN = os.environ.get("ASTRYON_ADMIN_TOKEN", "").strip()

# Diretório onde ficam os APKs publicados e metadados da atualização do app.
APK_DIR = Path(
    os.environ.get("ASTRYON_APK_DIR", str(Path(__file__).with_name("releases")))
)
APP_VERSION = os.environ.get("ASTRYON_APP_VERSION", "").strip()
APP_NOTES = os.environ.get("ASTRYON_APP_NOTES", "").strip()
PUBLIC_URL = os.environ.get("ASTRYON_PUBLIC_URL", "").strip()

# Manifesto remoto da atualização (ex.: o latest.json de uma GitHub Release).
# Quando definido, tem prioridade sobre os APKs locais de APK_DIR.
RELEASE_MANIFEST_URL = os.environ.get("ASTRYON_RELEASE_MANIFEST_URL", "").strip()


def cors_origins() -> list[str]:
    """Origens permitidas no CORS, configuráveis por variável de ambiente."""
    raw = os.environ.get("ASTRYON_CORS_ORIGINS", "*")
    origins = [item.strip() for item in raw.split(",") if item.strip()]
    return origins or ["*"]


def require_admin(x_admin_token: str | None) -> None:
    """Exige o token de administrador quando configurado."""
    if not ADMIN_TOKEN:
        return
    if x_admin_token != ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="Admin token inválido")


_VERSION_RE = re.compile(r"(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)")


def sha256_file(path: Path) -> str:
    """Hash sha256 do arquivo, lido em blocos."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def latest_apk() -> Path | None:
    """APK mais recente publicado (por data de modificação)."""
    if not APK_DIR.is_dir():
        return None
    apks = sorted(
        APK_DIR.glob("*.apk"), key=lambda item: item.stat().st_mtime, reverse=True
    )
    return apks[0] if apks else None


def apk_version(path: Path) -> str:
    """Versão do APK: da variável de ambiente ou do nome do arquivo."""
    if APP_VERSION:
        return APP_VERSION
    match = _VERSION_RE.search(path.stem)
    return match.group(1) if match else "0.0.0"


def public_base(request: Request) -> str:
    """URL base pública usada no manifesto de atualização."""
    if PUBLIC_URL:
        return PUBLIC_URL.rstrip("/")
    return str(request.base_url).rstrip("/")


def remote_manifest() -> dict[str, Any] | None:
    """Lê o manifesto remoto da atualização, quando configurado."""
    if not RELEASE_MANIFEST_URL:
        return None
    request = urllib.request.Request(
        RELEASE_MANIFEST_URL, headers={"User-Agent": "ASTRYON-mobile-updater"}
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:  # noqa: S310
            data = json.loads(response.read().decode("utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def release_from_remote(remote: dict[str, Any], base: str) -> "AppRelease | None":
    """Normaliza o manifesto remoto para o formato do /app/latest."""
    version = str(remote.get("version", "")).strip()
    sha256 = str(remote.get("sha256", "")).strip().lower()
    if not version or not sha256:
        return None
    return AppRelease(
        version=version,
        url=f"{base}/api/v1/app/download",
        sha256=sha256,
        size=int(remote.get("size", 0) or 0),
        filename=str(remote.get("filename") or "astryon-mobile.apk"),
        notes=str(remote["notes"]) if remote.get("notes") else None,
    )


def iter_remote(response: Any):
    """Itera os blocos do APK remoto e fecha a conexão ao terminar."""
    try:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            yield chunk
    finally:
        response.close()


def stream_remote(url: str, filename: str) -> StreamingResponse:
    """Serve o APK remoto pelo backend, para o app falar só com ele."""
    request = urllib.request.Request(url, headers={"User-Agent": "ASTRYON-mobile-updater"})
    try:
        response = urllib.request.urlopen(request, timeout=30)  # noqa: S310
    except (OSError, ValueError) as error:
        raise HTTPException(status_code=502, detail="Falha ao baixar do servidor de releases") from error
    return StreamingResponse(
        iter_remote(response),
        media_type="application/vnd.android.package-archive",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
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


class AppRelease(BaseModel):
    version: str
    url: str
    sha256: str
    size: int
    filename: str
    notes: str | None = None


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
    allow_origins=cors_origins(),
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
                json.dumps(payload.data),
                received_at,
            ),
        )

        conn.execute(
            "UPDATE devices SET last_seen = ? WHERE id = ?",
            (received_at, device["id"]),
        )

    return TelemetryResponse(status="ok", received_at=received_at)


@app.get("/api/v1/devices")
def list_devices(x_admin_token: str | None = Header(None, alias="X-Admin-Token")):
    """Lista todos os dispositivos cadastrados (protótipo — em produção filtre por usuário)."""
    require_admin(x_admin_token)
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
def get_device_telemetry(
    device_id: str,
    x_admin_token: str | None = Header(None, alias="X-Admin-Token"),
):
    """Retorna os últimos registros de telemetria de um dispositivo."""
    require_admin(x_admin_token)
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
                "payload": json.loads(row["payload"]),
                "received_at": row["received_at"],
            }
            for row in rows
        ]
    }


@app.get("/api/v1/summary")
def summary(x_admin_token: str | None = Header(None, alias="X-Admin-Token")):
    """Resumo agregado para o dashboard web."""
    require_admin(x_admin_token)
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
            payload = json.loads(row["payload"])
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


@app.get("/api/v1/app/latest", response_model=AppRelease)
def app_latest(request: Request):
    """Versão mais recente do app mobile publicada neste backend."""
    base = public_base(request)

    remote = remote_manifest()
    if remote is not None:
        release = release_from_remote(remote, base)
        if release is not None:
            return release

    apk = latest_apk()
    if apk is None:
        raise HTTPException(status_code=404, detail="Nenhuma versão publicada")
    return AppRelease(
        version=apk_version(apk),
        url=f"{base}/api/v1/app/download",
        sha256=sha256_file(apk),
        size=apk.stat().st_size,
        filename=apk.name,
        notes=APP_NOTES or None,
    )


@app.get("/api/v1/app/download")
def app_download():
    """Baixa o APK mais recente publicado (local ou do manifesto remoto)."""
    remote = remote_manifest()
    if remote is not None and remote.get("url"):
        return stream_remote(
            str(remote["url"]),
            str(remote.get("filename") or "astryon-mobile.apk"),
        )

    apk = latest_apk()
    if apk is None:
        raise HTTPException(status_code=404, detail="Nenhuma versão publicada")
    return FileResponse(
        apk,
        media_type="application/vnd.android.package-archive",
        filename=apk.name,
    )


@app.get("/api/v1/health")
def health():
    return {"status": "ok", "time": now_iso()}
