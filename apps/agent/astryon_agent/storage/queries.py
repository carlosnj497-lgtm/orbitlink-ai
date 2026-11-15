"""Consultas de leitura para a API. Toda resposta inclui fonte, cobertura e lacunas do período."""

from __future__ import annotations

import json
import math
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from .db import Database, now_ts

METHOD_USAGE = (
    "Consumo ESTIMADO: integração do tráfego instantâneo reportado pela antena (amostras de 1 s, bps/8). "
    "Não é o valor oficial do plano/fatura. Períodos sem amostras não são contados nem preenchidos."
)


def _source(rows_sources: set[str]) -> str:
    if not rows_sources:
        return "indisponivel"
    if rows_sources == {"demonstracao"}:
        return "demonstracao"
    return "calculada"


def gaps_between(db: Database, start: int, end: int) -> list[dict[str, Any]]:
    return db.query(
        """SELECT kind, start_ts, end_ts, samples_lost, detail FROM observation_gaps
           WHERE start_ts < ? AND COALESCE(end_ts, ?) > ? ORDER BY start_ts""",
        (end, end, start),
    )


# --------------------------------------------------------------------------- telemetria
def telemetry(db: Database, terminal_id: int, start: int, end: int, bucket_s: int | None = None,
              max_points: int = 720) -> dict[str, Any]:
    span = max(1, end - start)
    if bucket_s is None:
        bucket_s = max(1, math.ceil(span / max_points))
        for nice in (1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600, 86400):
            if nice >= bucket_s:
                bucket_s = nice
                break
    if bucket_s < 60:
        rows = db.query(
            """SELECT (ts / :b) * :b AS t, COUNT(*) AS n, AVG(downlink_bps) AS down, AVG(uplink_bps) AS up,
                      MAX(downlink_bps) AS down_max, MAX(uplink_bps) AS up_max,
                      AVG(CASE WHEN drop_rate < 0.999 THEN latency_ms END) AS lat, AVG(drop_rate) AS drop_rate,
                      AVG(power_w) AS power, MAX(origin) AS origin
               FROM history_samples WHERE terminal_id = :tid AND ts >= :s AND ts < :e
               GROUP BY t ORDER BY t""",
            {"b": bucket_s, "tid": terminal_id, "s": start, "e": end},
        )
        series_src = "history_1s"
    else:
        rows = db.query(
            """SELECT (q.minute_ts / :b) * :b AS t, SUM(q.samples) AS n,
                      SUM(u.bytes_down) * 8.0 / NULLIF(SUM(u.samples), 0) AS down,
                      SUM(u.bytes_up) * 8.0 / NULLIF(SUM(u.samples), 0) AS up,
                      MAX(q.downlink_max_bps) AS down_max, MAX(q.uplink_max_bps) AS up_max,
                      SUM(q.latency_avg * q.latency_samples) / NULLIF(SUM(q.latency_samples), 0) AS lat,
                      SUM(q.drop_avg * q.drop_samples) / NULLIF(SUM(q.drop_samples), 0) AS drop_rate,
                      AVG(q.power_avg_w) AS power, MAX(q.source) AS origin
               FROM quality_minutes q LEFT JOIN usage_minutes u ON u.terminal_id = q.terminal_id AND u.minute_ts = q.minute_ts
               WHERE q.terminal_id = :tid AND q.minute_ts >= :s AND q.minute_ts < :e
               GROUP BY t ORDER BY t""",
            {"b": bucket_s, "tid": terminal_id, "s": start, "e": end},
        )
        series_src = "minute_aggregates"
    if not rows:
        # Sem histórico (firmware sem get_history?) — usa amostras de status, se houver.
        rows = db.query(
            """SELECT (ts / :b) * :b AS t, COUNT(*) AS n, AVG(downlink_bps) AS down, AVG(uplink_bps) AS up,
                      MAX(downlink_bps) AS down_max, MAX(uplink_bps) AS up_max, AVG(pop_latency_ms) AS lat,
                      AVG(pop_drop_rate) AS drop_rate, NULL AS power, MAX(origin) AS origin
               FROM status_samples WHERE terminal_id = :tid AND ts >= :s AND ts < :e GROUP BY t ORDER BY t""",
            {"b": max(bucket_s, 10), "tid": terminal_id, "s": start, "e": end},
        )
        series_src = "status_10s" if rows else "none"
    origins = {r["origin"] for r in rows if r["origin"]}
    points = [
        {
            "t": r["t"],
            "n": r["n"],
            "down_mbps": _mbps(r["down"]),
            "up_mbps": _mbps(r["up"]),
            "down_max_mbps": _mbps(r["down_max"]),
            "up_max_mbps": _mbps(r["up_max"]),
            "latency_ms": _r(r["lat"], 1),
            "drop_pct": _r(r["drop_rate"] * 100, 2) if r["drop_rate"] is not None else None,
            "power_w": _r(r["power"], 1),
        }
        for r in rows
    ]
    expected = span / (1 if series_src != "status_10s" else 10)
    observed = sum(r["n"] for r in rows)
    return {
        "start": start, "end": end, "bucket_s": bucket_s, "series_source": series_src,
        "source": "real" if origins & {"grpc", "calculada"} else ("demonstracao" if origins else "indisponivel"),
        "coverage": round(min(1.0, observed / expected), 4) if expected else 0,
        "points": points,
        "gaps": gaps_between(db, start, end),
        "note": "Tráfego = uso corrente reportado pela antena, não é teste de velocidade/capacidade.",
    }


def _mbps(v: float | None) -> float | None:
    return round(v / 1_000_000, 3) if v is not None else None


def _r(v: float | None, nd: int) -> float | None:
    return round(v, nd) if v is not None else None


# --------------------------------------------------------------------------- consumo
def local_day_start(ts: datetime) -> datetime:
    return ts.replace(hour=0, minute=0, second=0, microsecond=0)


def usage_between(db: Database, terminal_id: int | None, start: int, end: int) -> dict[str, Any]:
    params: dict[str, Any] = {"s": start, "e": end, "tid": terminal_id}
    row = db.one(
        """SELECT COALESCE(SUM(bytes_down),0) AS down, COALESCE(SUM(bytes_up),0) AS up, COALESCE(SUM(samples),0) AS samples,
                  COUNT(*) AS minutes, GROUP_CONCAT(DISTINCT source) AS sources
           FROM usage_minutes WHERE minute_ts >= :s AND minute_ts < :e AND (:tid IS NULL OR terminal_id = :tid)""",
        params,
    ) or {}
    span = max(1, min(end, now_ts()) - start)
    sources = set((row.get("sources") or "").split(",")) - {""}
    down, up = float(row.get("down") or 0), float(row.get("up") or 0)
    return {
        "start": start, "end": end,
        "bytes_download": round(down), "bytes_upload": round(up), "bytes_total": round(down + up),
        "observed_seconds": int(row.get("samples") or 0),
        "coverage": round(min(1.0, int(row.get("samples") or 0) / span), 4),
        "source": _source(sources),
    }


def usage_summary(db: Database, terminal_id: int | None, tz: str) -> dict[str, Any]:
    z = ZoneInfo(tz)
    now = datetime.now(z)
    today = local_day_start(now)
    week = today - timedelta(days=today.weekday())
    month = today.replace(day=1)
    prev_month_end = month
    prev_month = (month - timedelta(days=1)).replace(day=1)

    def u(a: datetime, b: datetime) -> dict[str, Any]:
        return usage_between(db, terminal_id, int(a.timestamp()), int(b.timestamp()))

    month_usage = u(month, now)
    days_elapsed = max((now - month).total_seconds() / 86400, 1 / 24)
    next_month = (month + timedelta(days=32)).replace(day=1)
    days_in_month = (next_month - month).days
    projection = _project(db, terminal_id, month, now, days_in_month, days_elapsed, month_usage)
    return {
        "timezone": tz,
        "today": u(today, now),
        "yesterday": u(today - timedelta(days=1), today),
        "week": u(week, now),
        "month": month_usage,
        "previous_month": u(prev_month, prev_month_end),
        # Mesmo trecho do mês anterior (dia 1 até o mesmo dia e hora): comparação justa com o mês em andamento.
        "previous_month_to_date": u(prev_month, same_point_previous_month(now, prev_month, prev_month_end)),
        "projection_month": projection,
        "method": METHOD_USAGE,
    }


def same_point_previous_month(now: datetime, prev_month: datetime, prev_month_end: datetime) -> datetime:
    """O mesmo dia e hora de `now` no mês anterior. Se esse dia não existe lá (ex.: 31/03 → fevereiro), é o fim do
    mês anterior inteiro."""
    prev_days = (prev_month_end - prev_month).days
    if now.day > prev_days:
        return prev_month_end
    return now.replace(year=prev_month.year, month=prev_month.month, day=now.day)


def _project(db: Database, terminal_id: int | None, month: datetime, now: datetime, days_in_month: float,
             days_elapsed: float, month_usage: dict[str, Any]) -> dict[str, Any] | None:
    """Projeção simples: média diária observada × dias do mês, com intervalo ±1,96·dp/√n dos dias completos."""
    daily = []
    d = month
    while d + timedelta(days=1) <= now:
        x = usage_between(db, terminal_id, int(d.timestamp()), int((d + timedelta(days=1)).timestamp()))
        if x["coverage"] >= 0.5:  # só dias razoavelmente observados
            daily.append(x["bytes_total"] / x["coverage"])
        d += timedelta(days=1)
    if len(daily) < 3:
        return {"available": False, "reason": "Menos de 3 dias com cobertura ≥ 50% neste período."}
    mean = sum(daily) / len(daily)
    sd = math.sqrt(sum((v - mean) ** 2 for v in daily) / (len(daily) - 1))
    half = 1.96 * sd / math.sqrt(len(daily))
    remaining = days_in_month - days_elapsed
    base = month_usage["bytes_total"]
    return {
        "available": True,
        "bytes_total": round(base + mean * remaining),
        "low": round(base + max(0.0, mean - half) * remaining),
        "high": round(base + (mean + half) * remaining),
        "days_used": len(daily),
        "source": "estimada",
        "method": "Média dos dias com cobertura ≥ 50% (normalizada pela cobertura) × dias restantes; IC aproximado de 95%.",
    }


def billing_cycle(now: datetime, start_day: int) -> tuple[datetime, datetime]:
    """Ciclo de cobrança que contém `now`: começa à 0h local do dia `start_day` (1–28) e dura um mês."""
    start_day = min(max(int(start_day), 1), 28)
    day0 = local_day_start(now)
    if now.day >= start_day:
        start = day0.replace(day=start_day)
    else:
        start = (day0.replace(day=1) - timedelta(days=1)).replace(day=start_day)
    end = (start.replace(day=1) + timedelta(days=32)).replace(day=start_day)
    return start, end


METHOD_PLAN = ("Soma do consumo estimado localmente desde o início do ciclo, comparada à franquia informada em Configurações. "
               "Períodos em que o agente não observou a antena não entram na soma, então o valor real pode ser maior. "
               "A fatura oficial da Starlink pode diferir.")


def usage_plan(db: Database, terminal_id: int | None, tz: str, cap_gb: float | None, start_day: int) -> dict[str, Any]:
    """Consumo do ciclo de cobrança atual frente à franquia do plano (estimativa local, nunca o valor oficial)."""
    now = datetime.now(ZoneInfo(tz))
    start, end = billing_cycle(now, start_day)
    used = usage_between(db, terminal_id, int(start.timestamp()), int(end.timestamp()))
    days_total = (end - start).total_seconds() / 86400
    days_elapsed = max((now - start).total_seconds() / 86400, 1 / 24)
    projection = _project(db, terminal_id, start, now, days_total, days_elapsed, used)
    configured = bool(cap_gb and cap_gb > 0)
    cap_bytes = round(float(cap_gb) * 1e9) if configured and cap_gb else None
    observed = used["observed_seconds"] > 0
    pct = round(used["bytes_total"] / cap_bytes * 100, 2) if cap_bytes and observed else None
    proj_pct = (round(projection["bytes_total"] / cap_bytes * 100, 1)
                if cap_bytes and projection and projection.get("available") else None)
    return {
        "configured": configured,
        "cap_bytes": cap_bytes,
        "cycle_start_day": start_day,
        "cycle_start": int(start.timestamp()),
        "cycle_end": int(end.timestamp()),
        "days_remaining": round((end - now).total_seconds() / 86400, 1),
        "used": used,
        "pct_used": pct,
        "remaining_bytes": max(0, cap_bytes - used["bytes_total"]) if cap_bytes and observed else None,
        # cobertura < 100%: houve períodos não observados, então o consumo real é igual ou maior que o estimado
        "lower_bound": used["coverage"] < 0.99,
        "projection": projection,
        "projected_pct": proj_pct,
        "source": "calculada" if observed else "indisponivel",
        "method": METHOD_PLAN,
    }


def usage_series(db: Database, terminal_id: int | None, start: int, end: int, bucket: str, tz: str) -> dict[str, Any]:
    z = ZoneInfo(tz)
    rows = db.query(
        """SELECT minute_ts, bytes_down, bytes_up, samples, source FROM usage_minutes
           WHERE minute_ts >= ? AND minute_ts < ? AND (? IS NULL OR terminal_id = ?) ORDER BY minute_ts""",
        (start, end, terminal_id, terminal_id),
    )
    buckets: dict[str, dict[str, Any]] = {}
    for r in rows:
        dt = datetime.fromtimestamp(r["minute_ts"], z)
        if bucket == "hour":
            k = dt.replace(minute=0, second=0, microsecond=0)
            size = 3600
        elif bucket == "month":
            k = dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            size = 86400 * 30
        else:
            k = local_day_start(dt)
            size = 86400
        key = k.isoformat()
        b = buckets.setdefault(key, {"t": int(k.timestamp()), "label": key, "bytes_download": 0.0, "bytes_upload": 0.0,
                                     "samples": 0, "size_s": size, "sources": set()})
        b["bytes_download"] += r["bytes_down"]
        b["bytes_upload"] += r["bytes_up"]
        b["samples"] += r["samples"]
        b["sources"].add(r["source"])
    out = []
    for b in buckets.values():
        out.append({
            "t": b["t"], "label": b["label"],
            "bytes_download": round(b["bytes_download"]), "bytes_upload": round(b["bytes_upload"]),
            "bytes_total": round(b["bytes_download"] + b["bytes_upload"]),
            "coverage": round(min(1.0, b["samples"] / b["size_s"]), 4),
            "source": _source(b["sources"]),
        })
    imported = db.query(
        """SELECT period_start, period_end, bytes_down, bytes_up, bytes_total FROM usage_imported
           WHERE period_start < ? AND period_end > ? ORDER BY period_start""",
        (end, start),
    )
    peak = db.query(
        """SELECT (minute_ts / 3600) * 3600 AS h, SUM(bytes_down + bytes_up) AS b FROM usage_minutes
           WHERE minute_ts >= ? AND minute_ts < ? AND (? IS NULL OR terminal_id = ?) GROUP BY h ORDER BY b DESC LIMIT 1""",
        (start, end, terminal_id, terminal_id),
    )
    return {"bucket": bucket, "timezone": tz, "points": out, "imported": imported,
            "peak_hour": peak[0] if peak else None, "method": METHOD_USAGE, "gaps": gaps_between(db, start, end)}


def usage_by_hour_of_day(db: Database, terminal_id: int | None, start: int, end: int, tz: str) -> list[dict[str, Any]]:
    z = ZoneInfo(tz)
    rows = db.query(
        """SELECT (minute_ts / 3600) * 3600 AS h, SUM(bytes_down + bytes_up) AS b, SUM(samples) AS n FROM usage_minutes
           WHERE minute_ts >= ? AND minute_ts < ? AND (? IS NULL OR terminal_id = ?) GROUP BY h""",
        (start, end, terminal_id, terminal_id),
    )
    acc = {h: {"hour": h, "bytes_total": 0.0, "observed_seconds": 0} for h in range(24)}
    for r in rows:
        hour = datetime.fromtimestamp(r["h"], z).hour
        acc[hour]["bytes_total"] += r["b"]
        acc[hour]["observed_seconds"] += r["n"]
    return [{**v, "bytes_total": round(v["bytes_total"])} for v in acc.values()]


# --------------------------------------------------------------------------- qualidade
def _pct(values: list[float], p: float) -> float | None:
    if not values:
        return None
    v = sorted(values)
    k = (len(v) - 1) * p
    f, c = math.floor(k), math.ceil(k)
    return v[f] if f == c else v[f] + (v[c] - v[f]) * (k - f)


def quality(db: Database, terminal_id: int | None, start: int, end: int, tz: str) -> dict[str, Any]:
    rows = db.query(
        """SELECT minute_ts, samples, latency_samples, latency_avg, latency_max, jitter_avg, drop_avg, drop_samples, full_drop_s,
                  source
           FROM quality_minutes WHERE minute_ts >= ? AND minute_ts < ? AND (? IS NULL OR terminal_id = ?)
           ORDER BY minute_ts""",
        (start, end, terminal_id, terminal_id),
    )
    observed = sum(r["samples"] for r in rows)
    full_drop = sum(r["full_drop_s"] for r in rows)
    lat_minutes = [r["latency_avg"] for r in rows if r["latency_avg"] is not None]
    jit = [r["jitter_avg"] for r in rows if r["jitter_avg"] is not None]
    # Perda e disponibilidade só sobre os segundos em que a perda foi medida: segundo sem medida não é "0% de perda".
    drop_obs = sum(r["drop_samples"] or 0 for r in rows)
    drop_w = sum(r["drop_avg"] * r["drop_samples"] for r in rows if r["drop_avg"] is not None and r["drop_samples"])
    z = ZoneInfo(tz)
    hours: dict[int, dict[str, float]] = {h: {"samples": 0, "drop_n": 0, "drop_w": 0.0, "lat_w": 0.0, "lat_n": 0,
                                              "full_drop_s": 0}
                                          for h in range(24)}
    for r in rows:
        h = datetime.fromtimestamp(r["minute_ts"], z).hour
        hh = hours[h]
        hh["samples"] += r["samples"]
        if r["drop_avg"] is not None and r["drop_samples"]:
            hh["drop_w"] += r["drop_avg"] * r["drop_samples"]
            hh["drop_n"] += r["drop_samples"]
        hh["full_drop_s"] += r["full_drop_s"]
        if r["latency_avg"] is not None:
            hh["lat_w"] += r["latency_avg"] * r["latency_samples"]
            hh["lat_n"] += r["latency_samples"]
    by_hour = [
        {"hour": h, "observed_seconds": int(v["samples"]),
         "loss_pct": round(v["drop_w"] / v["drop_n"] * 100, 3) if v["drop_n"] else None,
         "latency_avg_ms": round(v["lat_w"] / v["lat_n"], 1) if v["lat_n"] else None,
         "full_drop_s": int(v["full_drop_s"])}
        for h, v in hours.items()
    ]
    span = max(1, min(end, now_ts()) - start)
    return {
        "start": start, "end": end, "timezone": tz,
        "source": _source({r["source"] for r in rows}),
        "observed_seconds": observed,
        "coverage": round(min(1.0, observed / span), 4),
        "availability_pct": round((1 - full_drop / drop_obs) * 100, 3) if drop_obs else None,
        "availability_note": "Disponibilidade = segundos com perda medida e sem perda total de ping ao PoP ÷ segundos com "
                             "perda medida. Lacunas de observação e segundos sem medida de perda ficam fora do cálculo "
                             "(não contam como queda nem como conexão boa).",
        "loss_pct": round(drop_w / drop_obs * 100, 3) if drop_obs else None,
        "latency_p50_ms": _r(_pct(lat_minutes, 0.5), 1),
        "latency_p95_ms": _r(_pct(lat_minutes, 0.95), 1),
        "latency_max_ms": _r(max((r["latency_max"] for r in rows if r["latency_max"] is not None), default=None), 1),
        "latency_note": "Percentis calculados sobre as médias por minuto da latência antena→PoP.",
        "jitter_ms": _r(sum(jit) / len(jit), 2) if jit else None,
        "jitter_note": "Jitter estimado = média de |Δlatência| entre amostras consecutivas de 1 s reportadas pela antena.",
        "full_drop_seconds": full_drop,
        "by_hour": by_hour,
        "gaps": gaps_between(db, start, end),
    }


# --------------------------------------------------------------------------- eventos
def events(db: Database, start: int, end: int, kinds: list[str] | None = None, limit: int = 500) -> list[dict[str, Any]]:
    params: list[Any] = [end, end, start]
    sql = """SELECT id, terminal_id, kind, cause, start_ts, end_ts, duration_s, confidence, evidence_json
             FROM connection_events WHERE start_ts < ? AND COALESCE(end_ts, ?) >= ?"""
    if kinds:
        sql += f" AND kind IN ({','.join('?' * len(kinds))})"
        params += kinds
    sql += " ORDER BY start_ts DESC LIMIT ?"
    params.append(limit)
    out = []
    for r in db.query(sql, params):
        r["evidence"] = json.loads(r.pop("evidence_json") or "{}")
        r["open"] = r["end_ts"] is None
        out.append(r)
    return out


def latest_obstruction(db: Database, terminal_id: int | None) -> dict[str, Any] | None:
    r = db.one(
        """SELECT ts, num_rows, num_cols, snr_json, min_elevation_deg, max_theta_deg, origin FROM obstruction_snapshots
           WHERE (? IS NULL OR terminal_id = ?) ORDER BY ts DESC LIMIT 1""",
        (terminal_id, terminal_id),
    )
    if r is None:
        return None
    r["snr"] = json.loads(r.pop("snr_json"))
    r["source"] = "real" if r["origin"] == "grpc" else "demonstracao"
    return r


def obstruction_trend(db: Database, terminal_id: int | None, start: int, end: int) -> list[dict[str, Any]]:
    return db.query(
        """SELECT (ts / 3600) * 3600 AS t, AVG(obstruction_fraction) * 100 AS obstruction_pct,
                  SUM(currently_obstructed) AS obstructed_samples, COUNT(*) AS n
           FROM status_samples WHERE ts >= ? AND ts < ? AND obstruction_fraction IS NOT NULL
             AND (? IS NULL OR terminal_id = ?) GROUP BY t ORDER BY t""",
        (start, end, terminal_id, terminal_id),
    )
