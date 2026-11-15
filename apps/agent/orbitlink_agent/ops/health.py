"""Saúde do próprio servidor e vigias: o ASTRYON também precisa avisar quando ELE tem problema.

* Leituras locais (sem dependências extras): disco livre da pasta de dados, tamanho do banco, temperatura
  (zonas térmicas do Linux), memória livre e carga. O que o sistema não informa fica None, nunca 0.
* Aviso de volta: ao iniciar, se o último heartbeat for antigo, avisa pelo Telegram/webhook quanto tempo o
  agente ficou fora do ar (nada foi monitorado nesse período).
* Vigia externo opcional (ORBITLINK_HEALTHCHECK_URL): um GET periódico para um serviço como healthchecks.io,
  que avisa quando os sinais param, inclusive se o servidor desligar de vez (algo que ele não consegue
  avisar sozinho).
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from ..config import Settings
from ..storage.db import Database, now_ts

log = logging.getLogger("orbitlink.ops")

THERMAL = Path("/sys/class/thermal")


def cpu_temp_c(root: Path = THERMAL) -> float | None:
    """Maior temperatura entre as zonas térmicas (°C). None fora do Linux ou sem sensores."""
    temps = []
    for zone in sorted(root.glob("thermal_zone*")):
        try:
            v = int((zone / "temp").read_text().strip())
        except (OSError, ValueError):
            continue
        if 0 < v < 150_000:  # milésimos de °C; descarta leituras absurdas
            temps.append(v / 1000)
    return round(max(temps), 1) if temps else None


def mem_available_pct(meminfo: Path = Path("/proc/meminfo")) -> float | None:
    try:
        info = {k.strip(): int(v.split()[0]) for k, v in (line.split(":", 1) for line in meminfo.read_text().splitlines())}
        return round(info["MemAvailable"] / info["MemTotal"] * 100, 1)
    except (OSError, KeyError, ValueError, ZeroDivisionError):
        return None


def server_health(db: Database, settings: Settings) -> dict[str, Any]:
    data_dir = Path(settings.data_dir)
    disk: dict[str, float | None]
    try:
        du = shutil.disk_usage(data_dir)
        disk = {"free_bytes": du.free, "total_bytes": du.total, "free_pct": round(du.free / du.total * 100, 1)}
    except OSError:
        disk = {"free_bytes": None, "total_bytes": None, "free_pct": None}
    try:
        load = round(os.getloadavg()[0], 2)
    except (OSError, AttributeError):
        load = None
    backups = sorted((data_dir / "backups").glob("orbitlink-*.sqlite3.gz")) if (data_dir / "backups").exists() else []
    return {
        "disk": disk,
        "db_size_bytes": db.size_bytes(),
        "cpu_temp_c": cpu_temp_c(),
        "mem_available_pct": mem_available_pct(),
        "load_1m": load,
        "cpus": os.cpu_count(),
        "last_backup_at": int(backups[-1].stat().st_mtime) if backups else None,
        "healthcheck_configured": bool(settings.healthcheck_url),
        "checked_at": now_ts(),
    }


def _fmt_span(s: int) -> str:
    h, m = divmod(s // 60, 60)
    d, h = divmod(h, 24)
    parts = [f"{d} d" if d else "", f"{h} h" if h else "", f"{m} min" if m or not (d or h) else ""]
    return " ".join(p for p in parts if p)


def downtime_notice(db: Database, settings: Settings, now: int | None = None) -> dict[str, Any] | None:
    """Evento de aviso se o agente ficou parado mais que o limite. Lê o heartbeat ANTES do coletor gravar o novo."""
    now = now or now_ts()
    last = db.scalar("SELECT MAX(ts) FROM agent_heartbeats")
    if last is None or now - int(last) < settings.downtime_notice_min * 60:
        return None
    tz = ZoneInfo(settings.timezone)

    def fmt(ts: int) -> str:
        return datetime.fromtimestamp(ts, tz).strftime("%d/%m %H:%M")

    gap = now - int(last)
    return {
        "status": "active", "severity": "info", "rule_id": None, "ts": now,
        "message": (f"🔌 O ASTRYON voltou depois de {_fmt_span(gap)} fora do ar ({fmt(int(last))} → {fmt(now)}). "
                    "Nada foi monitorado nesse período: pode ter sido falta de energia, reinício ou manutenção do "
                    "servidor. A internet da Starlink não necessariamente caiu."),
    }


async def healthcheck_loop(settings: Settings, transport: httpx.AsyncBaseTransport | None = None) -> None:
    url = settings.healthcheck_url
    if not url:
        return
    async with httpx.AsyncClient(timeout=10, transport=transport) as http:
        while True:
            try:
                await http.get(url)
            except httpx.HTTPError as exc:
                log.warning("vigia externo não respondeu (%s)", type(exc).__name__)
            await asyncio.sleep(settings.healthcheck_interval_s)
