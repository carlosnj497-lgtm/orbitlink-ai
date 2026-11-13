"""Relatórios: CSV (agregados por minuto), JSON (backup técnico) e PDF (resumo executivo)."""

from __future__ import annotations

import csv
import io
import json
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

from .. import __version__
from ..diagnostics import engine
from ..storage import queries
from ..storage.db import Database

DISCLAIMER = ("OrbitLink AI — projeto independente, sem afiliação com a Starlink/SpaceX. Consumo e disponibilidade são "
              "estimativas locais baseadas na telemetria da antena; não substituem dados oficiais do plano.")


def _fmt_bytes(v: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(v) < 1000 or unit == "TB":
            return f"{v:,.2f} {unit}".replace(",", "X").replace(".", ",").replace("X", ".")
        v /= 1000
    return str(v)


def collect(db: Database, terminal_id: int | None, start: int, end: int, tz: str) -> dict[str, Any]:
    return {
        "periodo": {"inicio_utc": datetime.fromtimestamp(start, UTC).isoformat(),
                    "fim_utc": datetime.fromtimestamp(end, UTC).isoformat(), "fuso_exibicao": tz},
        "consumo": queries.usage_between(db, terminal_id, start, end),
        "consumo_metodo": queries.METHOD_USAGE,
        "consumo_diario": queries.usage_series(db, terminal_id, start, end, "day", tz)["points"],
        "qualidade": queries.quality(db, terminal_id, start, end, tz),
        "eventos": queries.events(db, start, end, limit=2000),
        "lacunas": queries.gaps_between(db, start, end),
        "diagnostico": engine.summary(db, terminal_id, start, end, tz),
    }


def to_csv(db: Database, terminal_id: int | None, start: int, end: int, tz: str) -> str:
    z = ZoneInfo(tz)
    rows = db.query(
        """SELECT q.minute_ts, u.bytes_down, u.bytes_up, u.coverage, q.latency_avg, q.latency_max, q.jitter_avg, q.drop_avg,
                  q.full_drop_s, q.power_avg_w, q.source
           FROM quality_minutes q LEFT JOIN usage_minutes u ON u.terminal_id=q.terminal_id AND u.minute_ts=q.minute_ts
           WHERE q.minute_ts >= ? AND q.minute_ts < ? AND (? IS NULL OR q.terminal_id = ?) ORDER BY q.minute_ts""",
        (start, end, terminal_id, terminal_id),
    )
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";")
    w.writerow(["minuto_utc", "minuto_local", "bytes_download_estimado", "bytes_upload_estimado", "cobertura",
                "latencia_media_ms", "latencia_max_ms", "jitter_estimado_ms", "perda_media_pct", "segundos_perda_total",
                "potencia_media_w", "fonte"])
    for r in rows:
        w.writerow([
            datetime.fromtimestamp(r["minute_ts"], UTC).isoformat(), datetime.fromtimestamp(r["minute_ts"], z).isoformat(),
            round(r["bytes_down"] or 0), round(r["bytes_up"] or 0), r["coverage"],
            r["latency_avg"], r["latency_max"], r["jitter_avg"],
            round((r["drop_avg"] or 0) * 100, 3) if r["drop_avg"] is not None else "", r["full_drop_s"], r["power_avg_w"],
            r["source"],
        ])
    return buf.getvalue()


def to_json(db: Database, terminal_id: int | None, start: int, end: int, tz: str, settings_public: dict[str, Any]) -> str:
    data = collect(db, terminal_id, start, end, tz)
    data["orbitlink"] = {"versao": __version__, "aviso": DISCLAIMER, "gerado_em": datetime.now(UTC).isoformat()}
    data["capacidades"] = db.query("SELECT key, label, status, detail, checked_at FROM capabilities")
    data["configuracao_sem_segredos"] = settings_public
    data["regras_alerta"] = db.query("SELECT name, kind, threshold, min_duration_s, window_s, severity, enabled FROM alert_rules")
    return json.dumps(data, ensure_ascii=False, indent=2, default=str)


def to_pdf(db: Database, terminal_id: int | None, start: int, end: int, tz: str, terminal_name: str) -> bytes:
    from reportlab.graphics.charts.barcharts import VerticalBarChart
    from reportlab.graphics.shapes import Drawing
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import cm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    data = collect(db, terminal_id, start, end, tz)
    z = ZoneInfo(tz)
    fmt = lambda ts: datetime.fromtimestamp(ts, z).strftime("%d/%m/%Y %H:%M")  # noqa: E731
    styles = getSampleStyleSheet()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, title="Relatório OrbitLink AI", leftMargin=1.8 * cm, rightMargin=1.8 * cm)
    q = data["qualidade"]
    u = data["consumo"]
    story: list[Any] = [
        Paragraph("Relatório OrbitLink AI", styles["Title"]),
        Paragraph(f"{terminal_name} · {fmt(start)} a {fmt(end)} ({tz})", styles["Normal"]),
        Spacer(1, 10),
        Paragraph("Resumo executivo", styles["Heading2"]),
        Paragraph(data["diagnostico"]["headline"], styles["Normal"]),
        Spacer(1, 8),
    ]

    def pct(v: float | None, nd: int = 2) -> str:
        return "—" if v is None else f"{v:.{nd}f}%".replace(".", ",")

    def ms(v: float | None) -> str:
        return "—" if v is None else f"{v:.1f} ms".replace(".", ",")

    rows = [
        ["Indicador", "Valor", "Fonte"],
        ["Consumo estimado (total)", _fmt_bytes(u["bytes_total"]), u["source"]],
        ["Download / Upload", f"{_fmt_bytes(u['bytes_download'])} / {_fmt_bytes(u['bytes_upload'])}", u["source"]],
        ["Cobertura de observação", pct(q["coverage"] * 100, 1), "calculada"],
        ["Disponibilidade observada", pct(q["availability_pct"]), q["source"]],
        ["Perda média de ping ao PoP", pct(q["loss_pct"]), q["source"]],
        ["Latência p50 / p95 (PoP)", f"{ms(q['latency_p50_ms'])} / {ms(q['latency_p95_ms'])}", q["source"]],
        ["Jitter estimado", ms(q["jitter_ms"]), "calculada"],
        ["Eventos registrados", str(len(data["eventos"])), "—"],
        ["Lacunas de observação", str(len(data["lacunas"])), "—"],
    ]
    t = Table(rows, colWidths=[7 * cm, 6 * cm, 3.5 * cm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f1622")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#c0c8d4")), ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f2f5f9")]),
    ]))
    story += [t, Spacer(1, 12)]

    daily = data["consumo_diario"][-31:]
    if daily:
        story.append(Paragraph("Consumo estimado por dia (GB)", styles["Heading2"]))
        d = Drawing(480, 160)
        bc = VerticalBarChart()
        bc.x, bc.y, bc.width, bc.height = 30, 20, 440, 120
        bc.data = [[p["bytes_total"] / 1e9 for p in daily]]
        bc.categoryAxis.categoryNames = [datetime.fromtimestamp(p["t"], z).strftime("%d/%m") for p in daily]
        bc.categoryAxis.labels.fontSize = 6
        bc.categoryAxis.labels.angle = 45
        bc.valueAxis.labels.fontSize = 7
        bc.bars[0].fillColor = colors.HexColor("#06b6d4")
        d.add(bc)
        story += [d, Spacer(1, 8)]

    story.append(Paragraph("Achados do diagnóstico (regras, sem IA)", styles["Heading2"]))
    for f in data["diagnostico"]["findings"][:12]:
        label = {"evento_observado": "Evento observado", "hipotese": "Hipótese", "causa_confirmada": "Causa confirmada"}[f["kind"]]
        story.append(Paragraph(f"<b>[{label}]</b> {f['text']} <i>({f['evidence']})</i>", styles["Normal"]))
    if not data["diagnostico"]["findings"]:
        story.append(Paragraph("Nenhum achado no período observado.", styles["Normal"]))

    story += [Spacer(1, 8), Paragraph("Eventos (até 40 mais recentes)", styles["Heading2"])]
    ev_rows = [["Início", "Duração (s)", "Tipo", "Causa", "Confiança"]]
    for e in data["eventos"][:40]:
        ev_rows.append([fmt(e["start_ts"]), f"{e['duration_s']:.0f}" if e["duration_s"] else "—", e["kind"],
                        (e["cause"] or "—")[:30], e["confidence"]])
    et = Table(ev_rows, colWidths=[3.2 * cm, 2.2 * cm, 3 * cm, 5 * cm, 3 * cm])
    et.setStyle(TableStyle([("FONTSIZE", (0, 0), (-1, -1), 7.5), ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
                            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e6ebf2"))]))
    story += [et, Spacer(1, 8)]

    if data["lacunas"]:
        story.append(Paragraph("Lacunas de observação (não contadas como queda)", styles["Heading2"]))
        for g in data["lacunas"][:30]:
            story.append(Paragraph(f"{fmt(g['start_ts'])} → {fmt(g['end_ts']) if g['end_ts'] else 'em aberto'}: {g['kind']}",
                                   styles["Normal"]))
    story += [Spacer(1, 12), Paragraph(f"<font size=7>{DISCLAIMER} {queries.METHOD_USAGE}</font>", styles["Normal"])]
    doc.build(story)
    return buf.getvalue()
