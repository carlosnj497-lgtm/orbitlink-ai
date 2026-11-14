"""Diagnóstico por regras (sem IA) e detecção estatística de anomalias.

Cada achado classifica-se como:
* `evento_observado` — fato registrado (ex.: 12 min de perda total).
* `hipotese`        — explicação plausível sustentada por evidência indireta.
* `causa_confirmada`— causa informada explicitamente pela própria antena (ex.: outage.cause).
Nunca se afirma causalidade a partir de correlação.
"""

from __future__ import annotations

import statistics
from dataclasses import asdict, dataclass
from typing import Any

from ..storage import queries
from ..storage.db import Database, now_ts


@dataclass
class Finding:
    severity: str  # info | warn | crit
    kind: str  # evento_observado | hipotese | causa_confirmada
    text: str
    evidence: str


def _mad(values: list[float]) -> tuple[float, float]:
    med = statistics.median(values)
    mad = statistics.median([abs(v - med) for v in values]) or 0.0
    return med, mad


def anomalies(db: Database, terminal_id: int | None, start: int, end: int, tz: str, *,
              baseline_days: int = 14, k: float = 3.5, min_samples: int = 600) -> list[dict[str, Any]]:
    """Horas do período cuja perda/latência excede mediana + k·MAD da mesma hora do dia no baseline."""
    base_start = start - baseline_days * 86400
    rows = db.query(
        """SELECT (minute_ts / 3600) * 3600 AS h, SUM(samples) AS n,
                  SUM(drop_avg * drop_samples) / NULLIF(SUM(drop_samples), 0) AS loss,
                  SUM(latency_avg * latency_samples) / NULLIF(SUM(latency_samples), 0) AS lat
           FROM quality_minutes WHERE minute_ts >= ? AND minute_ts < ? AND (? IS NULL OR terminal_id = ?)
           GROUP BY h""",
        (base_start, end, terminal_id, terminal_id),
    )
    from datetime import datetime
    from zoneinfo import ZoneInfo

    z = ZoneInfo(tz)
    by_hod: dict[int, dict[str, list[float]]] = {}
    target = []
    for r in rows:
        if r["n"] < min_samples:
            continue
        hod = datetime.fromtimestamp(r["h"], z).hour
        if r["h"] < start:
            b = by_hod.setdefault(hod, {"loss": [], "lat": []})
            if r["loss"] is not None:
                b["loss"].append(r["loss"])
            if r["lat"] is not None:
                b["lat"].append(r["lat"])
        else:
            target.append((r, hod))
    out = []
    for r, hod in target:
        base = by_hod.get(hod)
        if not base:
            continue
        for metric, key, floor in (("perda", "loss", 0.005), ("latencia", "lat", 5.0)):
            series = base[key]
            val = r[key]
            if val is None or len(series) < 5:
                continue
            med, mad = _mad(series)
            limit = med + k * max(mad * 1.4826, floor)
            if val > limit:
                out.append({
                    "hour_ts": r["h"], "metric": metric, "value": val, "baseline_median": med, "limit": limit,
                    "baseline_days": len(series), "kind": "evento_observado",
                    "method": f"Mediana + {k}×MAD da mesma hora do dia nos {baseline_days} dias anteriores",
                })
    return sorted(out, key=lambda a: a["hour_ts"], reverse=True)


def summary(db: Database, terminal_id: int | None, start: int, end: int, tz: str,
            obstruction_pct: float | None = None, esp32_power_events: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    q = queries.quality(db, terminal_id, start, end, tz)
    evs = queries.events(db, start, end)
    findings: list[Finding] = []
    observed = q["observed_seconds"]

    if observed == 0:
        return {
            "generated_at": now_ts(), "engine": "regras", "source": "indisponivel",
            "headline": "Sem dados observados no período — nenhum diagnóstico possível.",
            "findings": [], "quality": q,
        }

    if q["coverage"] < 0.9:
        findings.append(Finding("info", "evento_observado",
                                f"Cobertura de observação de {q['coverage'] * 100:.0f}% no período.",
                                "Lacunas (agente parado/antena inacessível) não entram nos cálculos."))

    avail = q["availability_pct"]
    if avail is not None and avail < 99.0:
        sev = "crit" if avail < 95 else "warn"
        findings.append(Finding(sev, "evento_observado",
                                f"Disponibilidade observada de {avail:.2f}% ({q['full_drop_seconds']} s de perda total de ping ao PoP).",
                                "Fonte: histórico de 1 s da antena (pop_ping_drop_rate)."))

    drops = [e for e in evs if e["kind"] == "ping_drop"]
    if len(drops) >= 5:
        findings.append(Finding("warn", "evento_observado", f"{len(drops)} episódios de perda total de ping no período.",
                                "Eventos derivados; a causa não é determinada pelo histórico."))

    confirmed = [e for e in evs if e["kind"] in ("outage", "status_outage") and e["confidence"] == "confirmado"]
    causes: dict[str, int] = {}
    for e in confirmed:
        causes[e["cause"] or "UNKNOWN"] = causes.get(e["cause"] or "UNKNOWN", 0) + 1
    for cause, n in sorted(causes.items(), key=lambda kv: -kv[1]):
        findings.append(Finding("warn", "causa_confirmada", f"A antena reportou {n} interrupção(ões) com causa {cause}.",
                                "Fonte: campo outage da própria antena."))

    unreachable = [e for e in evs if e["kind"] == "unreachable"]
    if unreachable:
        total = sum((e["duration_s"] or 0) for e in unreachable)
        text = (f"O agente perdeu comunicação com a antena {len(unreachable)} vez(es) ({int(total)} s no total). "
                "Pode ser a antena desligada, rede local, roteador ou este computador.")
        findings.append(Finding("warn", "evento_observado", text, "Fonte: falhas de conexão gRPC do agente."))
        if esp32_power_events:
            overlap = [p for p in esp32_power_events for e in unreachable
                       if p["start_ts"] <= (e["end_ts"] or end) and (p["end_ts"] or end) >= e["start_ts"]]
            if overlap:
                findings.append(Finding("warn", "hipotese",
                                        "Perdas de comunicação coincidem com queda de alimentação detectada pelo ESP32.",
                                        "Coincidência temporal entre sensor de alimentação e eventos 'antena inacessível'."))

    if q["latency_p95_ms"] is not None and q["latency_p95_ms"] > 120:
        findings.append(Finding("warn", "evento_observado", f"Latência p95 até o PoP de {q['latency_p95_ms']:.0f} ms.",
                                q["latency_note"]))

    if obstruction_pct is not None and obstruction_pct > 5:
        findings.append(Finding("warn", "hipotese",
                                f"Obstrução de {obstruction_pct:.1f}% pode contribuir para perdas.",
                                "Estatística de obstrução da antena; correlação não comprova causa."))

    an = anomalies(db, terminal_id, start, end, tz)
    if an:
        findings.append(Finding("warn", "evento_observado",
                                f"{len(an)} hora(s) com perda/latência acima do padrão histórico do mesmo horário.",
                                an[0]["method"]))

    good = (avail is None or avail >= 99.5) and (q["loss_pct"] or 0) < 1 and not unreachable
    if good:
        headline = (f"Conexão satelital estável no período observado: disponibilidade {avail:.2f}%, "
                    f"latência mediana {q['latency_p50_ms'] or 0:.0f} ms até o PoP. "
                    "Se houve lentidão percebida, a origem provável está fora do enlace satelital (Wi-Fi, roteador ou dispositivo).")
        findings.append(Finding("info", "hipotese",
                                "Problemas percebidos neste período provavelmente não vieram do enlace satelital.",
                                "A antena não registrou perda relevante ao PoP; não há medição do Wi-Fi local."))
    else:
        worst = max(findings, key=lambda f: {"crit": 2, "warn": 1, "info": 0}[f.severity], default=None)
        headline = worst.text if worst else "Período com observações parciais."

    order = {"crit": 0, "warn": 1, "info": 2}
    findings.sort(key=lambda f: order[f.severity])
    return {
        "generated_at": now_ts(), "engine": "regras", "source": q["source"], "headline": headline,
        "findings": [asdict(f) for f in findings], "quality": q,
        "period": {"start": start, "end": end, "timezone": tz},
    }
