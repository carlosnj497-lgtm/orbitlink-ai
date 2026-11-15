"""Comparação de períodos e melhores horários, a partir do que o agente observou.

* compare: período atual × anterior de mesmo tamanho (disponibilidade, perda, latência, jitter, consumo,
  quedas) e, com o clima configurado, a perda nas horas com e sem chuva.
* best_hours: ranking das horas do dia pela perda e latência médias dos últimos dias (só horas com
  observação suficiente) e as próximas janelas boas, evitando as horas com chuva prevista.

Tudo é estatística do passado observado: o painel apresenta como tendência, não como garantia.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from ..storage import queries
from ..storage.db import Database, now_ts
from ..weather import service as weather

MIN_SAMPLES_HOUR = 1800  # pelo menos 30 min observados naquela hora do dia para entrar no ranking
DROP_KINDS = ("outage", "status_outage", "ping_drop", "unreachable")


def _tid(db: Database) -> int | None:
    v = db.scalar("SELECT id FROM terminals ORDER BY last_seen DESC LIMIT 1")
    return int(v) if v is not None else None


def _period(db: Database, tid: int | None, start: int, end: int, tz: str) -> dict[str, Any]:
    q = queries.quality(db, tid, start, end, tz)
    u = queries.usage_between(db, tid, start, end)
    drops = db.scalar(f"SELECT COUNT(*) FROM connection_events WHERE start_ts >= ? AND start_ts < ? "  # noqa: S608
                      f"AND kind IN ({','.join('?' * len(DROP_KINDS))})", (start, end, *DROP_KINDS)) or 0
    return {
        "start": start, "end": end,
        "availability_pct": q["availability_pct"], "loss_pct": q["loss_pct"],
        "latency_p50_ms": q["latency_p50_ms"], "latency_p95_ms": q["latency_p95_ms"], "jitter_ms": q["jitter_ms"],
        "bytes_total": u["bytes_total"] if u["observed_seconds"] else None,
        "drops": int(drops), "coverage": q["coverage"], "source": q["source"],
    }


def _rain_split(db: Database, start: int, end: int) -> dict[str, Any] | None:
    """Perda média nas horas com chuva relevante × horas sem chuva (só horas com clima e observação)."""
    rows = db.query("""SELECT (q.minute_ts / 3600) * 3600 AS h, SUM(q.drop_avg * q.drop_samples) AS w,
                              SUM(q.drop_samples) AS n FROM quality_minutes q
                       WHERE q.minute_ts >= ? AND q.minute_ts < ? AND q.drop_samples > 0 GROUP BY h""", (start, end))
    if not rows:
        return None
    rain = {h["hour_ts"]: h["rain_level"] for h in weather.hourly(db, start, end)}
    acc = {"chuva": [0.0, 0], "sem_chuva": [0.0, 0]}
    for r in rows:
        level = rain.get(r["h"])
        if level is None:
            continue
        key = "chuva" if level in weather.NOTABLE else "sem_chuva"
        acc[key][0] += r["w"] or 0
        acc[key][1] += r["n"] or 0
    out = {k: {"loss_pct": round(w / n * 100, 3) if n else None, "observed_seconds": n} for k, (w, n) in acc.items()}
    return out if any(v["observed_seconds"] for v in out.values()) else None


def compare(db: Database, settings: Any, start: int, end: int) -> dict[str, Any]:
    tid, tz = _tid(db), settings.timezone
    span = end - start
    cur = _period(db, tid, start, end, tz)
    prev = _period(db, tid, start - span, start, tz)
    configured = weather.get_location(db, settings) is not None
    return {
        "current": cur, "previous": prev,
        "rain": _rain_split(db, start, end) if configured else None,
        "weather_configured": configured,
        "note": "Comparação entre períodos observados. Lacunas ficam fora das contas; chuva é estimativa regional.",
    }


def best_hours(db: Database, settings: Any, days: int = 14, now: int | None = None) -> dict[str, Any]:
    now = now or now_ts()
    tz = ZoneInfo(settings.timezone)
    start = now - days * 86400
    rows = db.query("""SELECT minute_ts, drop_avg, drop_samples, latency_avg, latency_samples FROM quality_minutes
                       WHERE minute_ts >= ? AND minute_ts < ?""", (start, now))
    acc: dict[int, dict[str, float]] = {}
    for r in rows:
        h = datetime.fromtimestamp(r["minute_ts"], tz).hour
        a = acc.setdefault(h, {"dw": 0.0, "dn": 0, "lw": 0.0, "ln": 0})
        if r["drop_avg"] is not None and r["drop_samples"]:
            a["dw"] += r["drop_avg"] * r["drop_samples"]
            a["dn"] += r["drop_samples"]
        if r["latency_avg"] is not None and r["latency_samples"]:
            a["lw"] += r["latency_avg"] * r["latency_samples"]
            a["ln"] += r["latency_samples"]
    hours = []
    for h, a in sorted(acc.items()):
        if a["dn"] < MIN_SAMPLES_HOUR:
            continue
        hours.append({"hour": h, "loss_pct": round(a["dw"] / a["dn"] * 100, 3),
                      "latency_ms": round(a["lw"] / a["ln"], 1) if a["ln"] else None, "observed_seconds": int(a["dn"])})
    ranked = sorted(hours, key=lambda x: (x["loss_pct"], x["latency_ms"] if x["latency_ms"] is not None else 1e9))
    good = {x["hour"] for x in ranked[: max(1, len(ranked) // 3)]}  # o terço melhor

    upcoming = []
    forecast = {h["hour_ts"]: h for h in weather.hourly(db, now, now + 24 * 3600)}
    base = (now // 3600) * 3600 + 3600
    for i in range(24):
        ts = base + i * 3600
        hour = datetime.fromtimestamp(ts, tz).hour
        f = forecast.get(ts)
        rainy = bool(f and f["rain_level"] in weather.NOTABLE)
        if hour in good and not rainy:
            upcoming.append({"ts": ts, "hour": hour})
    return {
        "days": days, "hours": hours, "best": ranked[:3], "worst": list(reversed(ranked[-3:])) if len(ranked) > 3 else [],
        "next_good": upcoming[:4], "enough_data": len(hours) >= 6,
        "note": "Ranking pela perda e latência médias observadas em cada hora do dia nos últimos dias; horas com chuva "
                "prevista ficam fora das sugestões. É tendência, não garantia.",
    }
