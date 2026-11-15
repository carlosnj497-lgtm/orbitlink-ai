"""Relatório do ciclo em PDF, enviado pelo Telegram quando o ciclo de cobrança termina.

O ciclo segue o "dia de virada" das Configurações (o mesmo da franquia). O PDF traz o resumo do ciclo, a
comparação com o ciclo anterior e, se o clima estiver configurado, quantas quedas coincidiram com chuva. Tudo
é estimativa local e o relatório diz isso; serve para conversar com o suporte com números na mão.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from ..storage import queries
from ..storage.db import Database
from ..weather import service as weather
from . import builder

log = logging.getLogger("astryon.monthly")

KV_LAST_END = "monthly:last_period_end"
SEND_HOUR = 9  # hora local em que o relatório do ciclo encerrado sai
GRACE_S = 3 * 86400  # se o agente ficou fora do ar, ainda envia até 3 dias depois


def last_closed_cycle(now: datetime, start_day: int) -> tuple[datetime, datetime]:
    cur_start, _ = queries.billing_cycle(now, start_day)
    prev_start, prev_end = queries.billing_cycle(cur_start - timedelta(seconds=1), start_day)
    return prev_start, prev_end


def _summary(db: Database, tid: int | None, start: int, end: int, tz: str) -> dict[str, Any]:
    q = queries.quality(db, tid, start, end, tz)
    u = queries.usage_between(db, tid, start, end)
    ev = [e for e in queries.events(db, start, end, limit=1000)
          if e["kind"] in ("outage", "status_outage", "ping_drop", "unreachable")]
    return {"availability": q["availability_pct"], "loss": q["loss_pct"], "lat50": q["latency_p50_ms"],
            "bytes": u["bytes_total"] if u["observed_seconds"] else None, "drops": len(ev),
            "down_s": sum(e["duration_s"] or 0 for e in ev), "coverage": q["coverage"]}


def _pct(v: float | None) -> str:
    return "—" if v is None else f"{v:.2f}%".replace(".", ",")


def _delta(cur: float | None, prev: float | None, unit: str = "", better_up: bool = True, nd: int = 2) -> str:
    if cur is None or prev is None:
        return "sem comparação"
    d = cur - prev
    if abs(d) < 10 ** -nd:
        return "igual ao ciclo anterior"
    arrow = "▲" if d > 0 else "▼"
    good = (d > 0) == better_up
    num = f"{abs(d):.{nd}f}".replace(".", ",")
    return f"{arrow} {num}{unit} ({'melhor' if good else 'pior'})"


def build(db: Database, settings: Any, start: int, end: int, prev: tuple[int, int] | None) -> tuple[bytes, str]:
    tz = settings.timezone
    tid = db.scalar("SELECT id FROM terminals ORDER BY last_seen DESC LIMIT 1")
    cur = _summary(db, tid, start, end, tz)
    sections: list[tuple[str, list[str]]] = []
    if prev:
        p = _summary(db, tid, prev[0], prev[1], tz)
        sections.append(("Comparação com o ciclo anterior", [
            f"Disponibilidade observada: {_pct(cur['availability'])} · {_delta(cur['availability'], p['availability'], ' p.p.')}",
            f"Perda média de ping: {_pct(cur['loss'])} · {_delta(cur['loss'], p['loss'], ' p.p.', better_up=False)}",
            f"Interrupções registradas: {cur['drops']} · antes {p['drops']}",
            f"Consumo estimado: {builder._fmt_bytes(cur['bytes']) if cur['bytes'] is not None else '—'} · antes "
            f"{builder._fmt_bytes(p['bytes']) if p['bytes'] is not None else '—'}",
            "Comparação entre períodos observados; lacunas de observação ficam fora das contas.",
        ]))
    if weather.get_location(db, settings):
        w = weather.period_summary(db, start, end)
        sections.append(("Clima no ciclo (estimativa regional)", [
            f"Horas com chuva moderada ou mais forte: {w['horas_com_chuva_relevante']} de {w['horas_com_clima']} com dado.",
            f"Interrupções que coincidiram com chuva, trovoada ou rajada forte: "
            f"{len(w['eventos_com_chuva_ou_tempestade'])} de {w['eventos_no_periodo']}.",
            w["aviso"],
        ]))
    pdf = builder.to_pdf(db, tid, start, end, tz, settings.terminal_name, title="Relatório do ciclo · ASTRYON",
                         sections=sections)
    z = ZoneInfo(tz)

    def day(ts: int) -> str:
        return datetime.fromtimestamp(ts, z).strftime("%d/%m")

    caption = "\n".join([
        f"📄 Relatório do ciclo {day(start)} a {day(end - 1)}",
        f"Disponibilidade observada: {_pct(cur['availability'])}",
        f"Interrupções: {cur['drops']} · Consumo estimado: "
        f"{builder._fmt_bytes(cur['bytes']) if cur['bytes'] is not None else '—'}",
        "Estimativa local; a fatura e os registros oficiais da Starlink podem diferir.",
    ])
    return pdf, caption


async def send_pdf(settings: Any, pdf: bytes, caption: str, filename: str,
                   transport: httpx.AsyncBaseTransport | None = None) -> bool:
    if not (settings.telegram_bot_token and settings.telegram_chat_id):
        return False
    token = settings.telegram_bot_token.get_secret_value()
    async with httpx.AsyncClient(timeout=60, transport=transport) as http:
        r = await http.post(f"https://api.telegram.org/bot{token}/sendDocument",
                            data={"chat_id": settings.telegram_chat_id, "caption": caption[:1000]},
                            files={"document": (filename, pdf, "application/pdf")})
    if r.status_code != 200:
        log.warning("Telegram recusou o relatório (HTTP %s)", r.status_code)
    return r.status_code == 200


async def tick(db: Database, settings: Any, now: datetime | None = None,
               transport: httpx.AsyncBaseTransport | None = None) -> str:
    if not settings.monthly_report_enabled or not (settings.telegram_bot_token and settings.telegram_chat_id):
        return "desativado"
    z = ZoneInfo(settings.timezone)
    now = now or datetime.now(z)
    start, end = last_closed_cycle(now, settings.usage_cycle_start_day)
    s, e = int(start.timestamp()), int(end.timestamp())
    last = db.get_kv(KV_LAST_END)
    if last is not None and int(last) >= e:
        return "ja_enviado"
    send_at = end.replace(hour=SEND_HOUR)
    if now < send_at:
        return "aguardando"
    if (now - send_at).total_seconds() > GRACE_S:
        db.set_kv(KV_LAST_END, str(e))
        return "atrasado"
    if not db.scalar("SELECT COUNT(*) FROM quality_minutes WHERE minute_ts >= ? AND minute_ts < ?", (s, e)):
        db.set_kv(KV_LAST_END, str(e))
        return "sem_dados"
    p_start, p_end = last_closed_cycle(start, settings.usage_cycle_start_day)
    pdf, caption = await asyncio.to_thread(build, db, settings, s, e, (int(p_start.timestamp()), int(p_end.timestamp())))
    db.set_kv(KV_LAST_END, str(e))  # marca antes do envio: falha não vira reenvio a cada hora
    ok = await send_pdf(settings, pdf, caption, f"astryon-ciclo-{start:%Y%m%d}.pdf", transport)
    return "enviado" if ok else "falhou"


async def run(db: Database, settings: Any) -> None:
    await asyncio.sleep(60)
    while True:
        try:
            await tick(db, settings)
        except Exception:  # noqa: BLE001
            log.exception("falha no relatório do ciclo")
        await asyncio.sleep(3600)
