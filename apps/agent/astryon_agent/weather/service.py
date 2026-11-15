"""Clima local estimado pela Open-Meteo (gratuita, sem chave).

O clima entra no painel só para CORRELACIONAR com a conexão ("a queda coincidiu com chuva forte"). É uma
estimativa regional do modelo meteorológico, não um sensor no telhado, e nunca é apresentado como causa.

Privacidade: a única coisa enviada para fora são as coordenadas da localização escolhida pelo usuário,
arredondadas para 2 casas decimais (~1 km). A localização da antena nunca é consultada.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import asdict, dataclass
from typing import Any

import httpx

from ..config import Settings
from ..storage.db import Database, now_ts

log = logging.getLogger("astryon.weather")

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
PROVIDER = "Open-Meteo"
SOURCE = "open-meteo"
HOURLY_FIELDS = ["temperature_2m", "precipitation", "rain", "cloud_cover", "wind_speed_10m", "wind_gusts_10m",
                 "weather_code"]
CURRENT_FIELDS = [*HOURLY_FIELDS, "is_day"]
TIMEOUT = httpx.Timeout(15.0, connect=10.0)
KV_LOCATION = "weather:location"
KV_CURRENT = "weather:current"
KV_STATE = "weather:state"


@dataclass
class Location:
    name: str
    latitude: float
    longitude: float


def rain_level(mm: float | None) -> str | None:
    """Intensidade da precipitação na hora (mm/h), nas faixas usuais de meteorologia."""
    if mm is None:
        return None
    if mm < 0.1:
        return "sem_chuva"
    if mm < 2.5:
        return "fraca"
    if mm < 7.6:
        return "moderada"
    if mm < 50:
        return "forte"
    return "muito_forte"


# ------------------------------------------------------------------ localização
def get_location(db: Database, settings: Settings) -> Location | None:
    raw = db.get_kv(KV_LOCATION)
    if raw:
        try:
            d = json.loads(raw)
            return Location(str(d["name"]), float(d["latitude"]), float(d["longitude"]))
        except (ValueError, KeyError, TypeError):
            log.warning("localização do clima inválida no banco; ignorada")
    if settings.weather_latitude is not None and settings.weather_longitude is not None:
        return Location(settings.weather_location_name or "Local configurado", settings.weather_latitude,
                        settings.weather_longitude)
    return None


def set_location(db: Database, loc: Location | None) -> None:
    if loc is None:
        db.execute("DELETE FROM settings_kv WHERE key IN (?, ?, ?)", (KV_LOCATION, KV_CURRENT, KV_STATE))
        db.execute("DELETE FROM weather_hourly")
        return
    db.set_kv(KV_LOCATION, json.dumps(asdict(loc), ensure_ascii=False))


# ------------------------------------------------------------------ Open-Meteo
async def fetch(loc: Location, transport: httpx.AsyncBaseTransport | None = None) -> dict[str, Any]:
    params: dict[str, Any] = {
        "latitude": round(loc.latitude, 2),
        "longitude": round(loc.longitude, 2),
        "hourly": ",".join(HOURLY_FIELDS),
        "current": ",".join(CURRENT_FIELDS),
        "past_days": 2,
        "forecast_days": 2,
        "timezone": "UTC",
        "timeformat": "unixtime",
        "wind_speed_unit": "kmh",
    }
    async with httpx.AsyncClient(timeout=TIMEOUT, transport=transport) as http:
        r = await http.get(FORECAST_URL, params=params)
        r.raise_for_status()
        data: dict[str, Any] = r.json()
        return data


def _num(v: Any) -> float | None:
    return float(v) if isinstance(v, int | float) else None


def parse(raw: dict[str, Any], fetched_at: int) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    """Converte a resposta da Open-Meteo em linhas por hora + leitura atual. Valor ausente fica None (nunca 0)."""
    h = raw.get("hourly") or {}
    times = h.get("time") or []
    rows = []
    for i, t in enumerate(times):
        if not isinstance(t, int | float):
            continue

        def col(name: str, i: int = i) -> float | None:
            arr = h.get(name) or []
            return _num(arr[i]) if i < len(arr) else None

        code = col("weather_code")
        rows.append({
            "hour_ts": int(t),
            "temperature_c": col("temperature_2m"),
            "precipitation_mm": col("precipitation"),
            "rain_mm": col("rain"),
            "cloud_cover_pct": col("cloud_cover"),
            "wind_kmh": col("wind_speed_10m"),
            "gust_kmh": col("wind_gusts_10m"),
            "weather_code": int(code) if code is not None else None,
            "is_forecast": 1 if int(t) > fetched_at else 0,
        })
    c = raw.get("current")
    current = None
    if isinstance(c, dict) and isinstance(c.get("time"), int | float):
        code = _num(c.get("weather_code"))
        current = {
            "ts": int(c["time"]),
            "temperature_c": _num(c.get("temperature_2m")),
            "precipitation_mm": _num(c.get("precipitation")),
            "rain_mm": _num(c.get("rain")),
            "cloud_cover_pct": _num(c.get("cloud_cover")),
            "wind_kmh": _num(c.get("wind_speed_10m")),
            "gust_kmh": _num(c.get("wind_gusts_10m")),
            "weather_code": int(code) if code is not None else None,
            "is_day": bool(c.get("is_day")) if c.get("is_day") is not None else None,
        }
    return rows, current


def store(db: Database, rows: list[dict[str, Any]], current: dict[str, Any] | None, fetched_at: int) -> int:
    with db.tx() as c:
        for r in rows:
            c.execute(
                """INSERT INTO weather_hourly (hour_ts, temperature_c, precipitation_mm, rain_mm, cloud_cover_pct, wind_kmh,
                     gust_kmh, weather_code, is_forecast, fetched_at, source)
                   VALUES (:hour_ts, :temperature_c, :precipitation_mm, :rain_mm, :cloud_cover_pct, :wind_kmh, :gust_kmh,
                     :weather_code, :is_forecast, :fetched_at, :source)
                   ON CONFLICT(hour_ts) DO UPDATE SET temperature_c = excluded.temperature_c,
                     precipitation_mm = excluded.precipitation_mm, rain_mm = excluded.rain_mm,
                     cloud_cover_pct = excluded.cloud_cover_pct, wind_kmh = excluded.wind_kmh, gust_kmh = excluded.gust_kmh,
                     weather_code = excluded.weather_code, is_forecast = excluded.is_forecast,
                     fetched_at = excluded.fetched_at, source = excluded.source""",
                {**r, "fetched_at": fetched_at, "source": SOURCE},
            )
    if current is not None:
        db.set_kv(KV_CURRENT, json.dumps({**current, "fetched_at": fetched_at}))
    return len(rows)


def _set_state(db: Database, **kw: Any) -> None:
    state = _state(db)
    state.update(kw)
    db.set_kv(KV_STATE, json.dumps(state, ensure_ascii=False))


def _state(db: Database) -> dict[str, Any]:
    raw = db.get_kv(KV_STATE)
    try:
        return dict(json.loads(raw)) if raw else {}
    except ValueError:
        return {}


async def refresh(db: Database, settings: Settings, transport: httpx.AsyncBaseTransport | None = None) -> bool:
    """Busca e grava o clima. Devolve False (e registra o erro) se não houver localização ou a busca falhar."""
    loc = await db.run(get_location, db, settings)
    if loc is None or not settings.weather_enabled:
        return False
    ts = now_ts()
    try:
        raw = await fetch(loc, transport)
        rows, current = parse(raw, ts)
        n = await db.run(store, db, rows, current, ts)
    except (httpx.HTTPError, ValueError) as exc:
        msg = f"{type(exc).__name__}: {str(exc)[:200]}"
        log.warning("falha ao buscar o clima: %s", msg)
        await db.run(_set_state, db, last_error=msg, last_error_at=ts)
        return False
    await db.run(_set_state, db, last_ok_at=ts, last_error=None, last_error_at=None)
    log.info("clima atualizado (%d horas)", n)
    return True


async def run(db: Database, settings: Settings) -> None:
    while True:
        try:
            await refresh(db, settings)
        except Exception:  # noqa: BLE001
            log.exception("falha inesperada no clima")
        await asyncio.sleep(settings.weather_interval_s)


# ------------------------------------------------------------------ consultas
def hourly(db: Database, start: int, end: int) -> list[dict[str, Any]]:
    rows = db.query(
        """SELECT hour_ts, temperature_c, precipitation_mm, rain_mm, cloud_cover_pct, wind_kmh, gust_kmh, weather_code,
                  is_forecast FROM weather_hourly WHERE hour_ts >= ? AND hour_ts < ? ORDER BY hour_ts""",
        ((start // 3600) * 3600, end),
    )
    return [{**r, "is_forecast": bool(r["is_forecast"]), "rain_level": rain_level(r["precipitation_mm"])} for r in rows]


def status(db: Database, settings: Settings) -> dict[str, Any]:
    loc = get_location(db, settings)
    state = _state(db)
    current = None
    raw = db.get_kv(KV_CURRENT) if loc else None
    if raw:
        try:
            current = json.loads(raw)
            current["rain_level"] = rain_level(current.get("precipitation_mm"))
            current["stale"] = now_ts() - int(current.get("fetched_at", 0)) > settings.weather_interval_s * 3
        except ValueError:
            current = None
    return {
        "enabled": settings.weather_enabled,
        "configured": loc is not None,
        "location": asdict(loc) if loc else None,
        "current": current,
        "last_ok_at": state.get("last_ok_at"),
        "last_error": state.get("last_error"),
        "provider": PROVIDER,
        "source": "estimada",
        "note": "Estimativa regional do modelo meteorológico para a localização escolhida, não um sensor no local. "
                "Serve para correlacionar com a conexão, não para apontar causa.",
    }


async def geocode(query: str, transport: httpx.AsyncBaseTransport | None = None) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(timeout=TIMEOUT, transport=transport) as http:
        r = await http.get(GEOCODE_URL, params={"name": query, "count": 6, "language": "pt", "format": "json"})
        r.raise_for_status()
        out = []
        for g in r.json().get("results") or []:
            if not isinstance(g.get("latitude"), int | float) or not isinstance(g.get("longitude"), int | float):
                continue
            parts = [g.get("name"), g.get("admin1"), g.get("country")]
            out.append({"name": ", ".join(str(p) for p in parts if p), "latitude": g["latitude"],
                        "longitude": g["longitude"]})
        return out


# ------------------------------------------------------------------ uso pelo bot, alertas e IA
WMO_PT = {0: "céu limpo", 1: "predomínio de sol", 2: "parcialmente nublado", 3: "nublado", 45: "neblina", 48: "neblina",
          51: "garoa", 53: "garoa", 55: "garoa", 56: "garoa congelante", 57: "garoa congelante",
          61: "chuva fraca", 63: "chuva moderada", 65: "chuva forte", 66: "chuva congelante", 67: "chuva congelante",
          71: "neve", 73: "neve", 75: "neve", 77: "neve", 80: "pancadas fracas", 81: "pancadas moderadas",
          82: "pancadas fortes", 85: "neve", 86: "neve", 95: "trovoada", 96: "trovoada com granizo", 99: "trovoada com granizo"}
RAIN_PT = {"sem_chuva": "sem chuva", "fraca": "chuva fraca", "moderada": "chuva moderada", "forte": "chuva forte",
           "muito_forte": "chuva muito forte"}
NOTABLE = {"moderada", "forte", "muito_forte"}
FRESH_S = 3 * 3600  # previsão buscada há mais que isso não alimenta alerta


def describe(code: int | None) -> str:
    return WMO_PT.get(code, "condição desconhecida") if code is not None else "sem dado"


def note(h: dict[str, Any] | None) -> str | None:
    """Frase curta sobre uma hora, só quando há algo relevante para a conexão (chuva moderada+, trovoada, rajada)."""
    if not h:
        return None
    parts = []
    level = rain_level(h.get("precipitation_mm"))
    if level in NOTABLE:
        parts.append(f"{RAIN_PT[level]} ({h['precipitation_mm']:.1f} mm/h)".replace(".", ","))
    if (h.get("weather_code") or 0) >= 95:
        parts.append("trovoada")
    if (h.get("gust_kmh") or 0) >= 60:
        parts.append(f"rajadas de {round(h['gust_kmh'])} km/h")
    return " · ".join(parts) or None


def at(db: Database, ts: int) -> dict[str, Any] | None:
    """Clima registrado para a hora que contém `ts` (None se não houver)."""
    return db.one("SELECT * FROM weather_hourly WHERE hour_ts = ?", ((ts // 3600) * 3600,))


def forecast_max_mm(db: Database, horizon_s: int, now: int | None = None) -> tuple[float, int] | None:
    """Maior chuva prevista (mm/h) nas próximas `horizon_s` e a hora em que ela cai. None sem previsão recente."""
    now = now or now_ts()
    row = db.one("""SELECT precipitation_mm, hour_ts FROM weather_hourly
                    WHERE hour_ts >= ? AND hour_ts <= ? AND fetched_at >= ? AND precipitation_mm IS NOT NULL
                    ORDER BY precipitation_mm DESC, hour_ts LIMIT 1""",
                 ((now // 3600) * 3600, now + horizon_s, now - FRESH_S))
    return (float(row["precipitation_mm"]), int(row["hour_ts"])) if row else None


def period_summary(db: Database, start: int, end: int) -> dict[str, Any]:
    """Resumo de um período passado: horas com chuva relevante e eventos de conexão que coincidiram com elas."""
    hours = [h for h in hourly(db, start, end) if not h["is_forecast"]]
    rainy = [h for h in hours if h["rain_level"] in NOTABLE]
    events = db.query("""SELECT kind, start_ts, duration_s FROM connection_events
                         WHERE start_ts >= ? AND start_ts < ? AND kind IN ('outage','status_outage','ping_drop','unreachable')
                         ORDER BY start_ts""", (start, end))
    coincide = []
    for e in events:
        n = note(at(db, e["start_ts"]))
        if n:
            coincide.append({**e, "clima": n})
    return {
        "horas_com_clima": len(hours),
        "horas_com_chuva_relevante": len(rainy),
        "maior_chuva_mm_h": max((h["precipitation_mm"] or 0 for h in hours), default=None) if hours else None,
        "eventos_no_periodo": len(events),
        "eventos_com_chuva_ou_tempestade": coincide[:50],
        "aviso": "Clima é estimativa regional (Open-Meteo). Coincidir com chuva não prova que a chuva causou o evento.",
    }
