"""Resumo semanal enviado pelo Telegram.

- Período: os 7 dias completos (0h local a 0h local) que terminam no dia do envio. Com o padrão (segunda, 8h),
  cobre de segunda a domingo da semana anterior.
- Mesmos números do painel (`storage.queries`), com as mesmas ressalvas: consumo e disponibilidade são estimativas
  locais, lacunas de observação ficam fora dos cálculos e a cobertura aparece sempre.
- Sai pela fila de notificações (`notification_outbox`): se a internet estiver fora na hora, o resumo é entregue
  quando ela voltar. Cada semana é enviada no máximo uma vez (marcador em `settings_kv`).
- Semana sem nenhum dado observado não gera resumo (nada a dizer, e "0 GB" seria falso).
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from ..alerts.notify import Notifier
from ..storage import queries
from ..storage.db import Database, now_ts
from .builder import _fmt_bytes

log = logging.getLogger("astryon.digest")

KV_LAST_END = "digest:last_period_end"
GRACE_S = 24 * 3600  # agente fora do ar no horário: ainda envia se voltar em até 24 h; depois pula a semana
CHECK_EVERY_S = 300
WEEKDAYS = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"]
WEEKDAYS_SHORT = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"]
MIN_HOUR_SAMPLES = 1800  # pior horário só entre horas com ao menos 30 min observados na semana
FOOTER = "Estimativas locais pela telemetria da antena. A fatura oficial da Starlink pode diferir."


# --------------------------------------------------------------------------- agenda
def scheduled_before(now: datetime, weekday: int, hour: int) -> datetime:
    """Último horário agendado (dia da semana + hora local) igual ou anterior a `now` (com fuso)."""
    at = now.replace(hour=hour, minute=0, second=0, microsecond=0) - timedelta(days=(now.weekday() - weekday) % 7)
    if at > now:
        at -= timedelta(days=7)
    return at


def next_scheduled(now: datetime, weekday: int, hour: int) -> datetime:
    return scheduled_before(now, weekday, hour) + timedelta(days=7)


def week_ending(at: datetime) -> tuple[int, int]:
    """Período coberto pelo envio em `at`: 7 dias completos terminando à 0h local do dia do envio."""
    end = queries.local_day_start(at)
    start = end - timedelta(days=7)
    return int(start.timestamp()), int(end.timestamp())


# --------------------------------------------------------------------------- dados
def _tid(db: Database) -> int | None:
    v = db.scalar("SELECT id FROM terminals ORDER BY last_seen DESC LIMIT 1")
    return int(v) if v is not None else None


def collect(db: Database, settings: Any, start: int, end: int) -> dict[str, Any]:
    tz = getattr(settings, "timezone", "UTC")
    tid = _tid(db)
    span = end - start
    usage = queries.usage_between(db, tid, start, end)
    prev = queries.usage_between(db, tid, start - span, start)
    q = queries.quality(db, tid, start, end, tz)
    days = queries.usage_series(db, tid, start, end, "day", tz)["points"]
    evs = queries.events(db, start, end, limit=5000)
    drops = [e for e in evs if e["kind"] == "ping_drop"]
    unreachable = [e for e in evs if e["kind"] == "unreachable"]
    alerts = db.one("SELECT COUNT(*) AS n, COALESCE(SUM(severity = 'crit'), 0) AS crit FROM alert_events "
                    "WHERE started_at >= ? AND started_at < ?", (start, end)) or {}
    cap = getattr(settings, "usage_monthly_limit_gb", None)
    plan = (queries.usage_plan(db, tid, tz, cap, int(getattr(settings, "usage_cycle_start_day", 1)))
            if cap else None)
    hours = [h for h in q["by_hour"] if h["observed_seconds"] >= MIN_HOUR_SAMPLES and h["loss_pct"] is not None]
    worst = max(hours, key=lambda h: h["loss_pct"], default=None)
    return {
        "start": start, "end": end, "timezone": tz,
        "terminal_name": getattr(settings, "terminal_name", "Starlink"),
        "usage": usage, "previous_usage": prev,
        "busiest_day": max((d for d in days if d["bytes_total"] > 0), key=lambda d: d["bytes_total"], default=None),
        "quality": q,
        "drops": {"count": len(drops), "longest": max(drops, key=lambda e: e["duration_s"] or 0, default=None)},
        "unreachable": {"count": len(unreachable), "seconds": int(sum(e["duration_s"] or 0 for e in unreachable))},
        "alerts": {"count": int(alerts.get("n") or 0), "crit": int(alerts.get("crit") or 0)},
        "worst_hour": worst,
        "plan": plan,
    }


def has_data(d: dict[str, Any]) -> bool:
    return bool(d["usage"]["observed_seconds"] or d["quality"]["observed_seconds"])


# --------------------------------------------------------------------------- texto
def _n(v: float, nd: int = 1) -> str:
    return f"{v:,.{nd}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _dur(seconds: float) -> str:
    s = int(round(seconds))
    if s < 60:
        return f"{s} s"
    if s < 3600:
        return f"{s // 60} min" + (f" {s % 60} s" if s % 60 and s < 600 else "")
    return f"{s // 3600} h {s % 3600 // 60:02d} min"


def render(d: dict[str, Any], *, title: str = "Resumo semanal") -> str:
    """Texto puro (sem marcação), pronto para o Telegram. Só mostra o que foi observado."""
    z = ZoneInfo(d["timezone"])
    start = datetime.fromtimestamp(d["start"], z)
    last = datetime.fromtimestamp(d["end"] - 1, z)
    u, q = d["usage"], d["quality"]
    lines = [f"📊 {title} — {d['terminal_name']}", f"{start:%d/%m} a {last:%d/%m}", ""]

    if u["observed_seconds"]:
        lines.append(f"📶 Consumo: {_fmt_bytes(u['bytes_total'])} "
                     f"(↓ {_fmt_bytes(u['bytes_download'])} · ↑ {_fmt_bytes(u['bytes_upload'])})")
        p = d["previous_usage"]
        # comparação só quando as duas semanas foram bem observadas: senão a diferença seria da cobertura
        if u["coverage"] >= 0.9 and p["coverage"] >= 0.9 and p["bytes_total"] > 0:
            diff = (u["bytes_total"] - p["bytes_total"]) / p["bytes_total"] * 100
            lines.append(f"   Semana anterior: {_fmt_bytes(p['bytes_total'])} ({'+' if diff >= 0 else ''}{_n(diff, 0)}%)")
        b = d["busiest_day"]
        if b:
            bd = datetime.fromtimestamp(b["t"], z)
            lines.append(f"   Dia de maior uso: {WEEKDAYS_SHORT[bd.weekday()]} {bd:%d/%m} ({_fmt_bytes(b['bytes_total'])})")
    else:
        lines.append("📶 Consumo: sem observação no período")

    plan = d["plan"]
    if plan and plan["pct_used"] is not None:
        txt = f"📦 Franquia: {_n(plan['pct_used'], 0)}% do ciclo usado"
        if plan["lower_bound"]:
            txt += " (no mínimo)"
        if plan["projected_pct"] is not None:
            end_c = datetime.fromtimestamp(plan["cycle_end"], z)
            txt += f" · projeção {_n(plan['projected_pct'], 0)}% até {end_c:%d/%m}"
        lines.append(txt)

    lines.append("")
    if q["observed_seconds"]:
        avail = q["availability_pct"]
        lines.append(f"{'✅' if avail is not None and avail >= 99.5 else '⚠️'} Disponibilidade: "
                     f"{_n(avail, 2) if avail is not None else '—'}%")
        dr = d["drops"]
        if dr["count"]:
            txt = f"   Quedas: {dr['count']} · {_dur(q['full_drop_seconds'])} sem conexão ao PoP"
            lg = dr["longest"]
            if lg and (lg["duration_s"] or 0) >= 10:
                lt = datetime.fromtimestamp(lg["start_ts"], z)
                txt += f" · maior {_dur(lg['duration_s'])} em {lt:%d/%m %H:%M}"
            lines.append(txt)
        else:
            lines.append("   Nenhuma queda registrada")
        if q["latency_p50_ms"] is not None:
            lines.append(f"⏱️ Latência ao PoP: mediana {_n(q['latency_p50_ms'], 0)} ms · p95 {_n(q['latency_p95_ms'] or 0, 0)} ms")
        if q["loss_pct"] is not None:
            lines.append(f"📉 Perda de ping: {_n(q['loss_pct'], 2)}%")
        w = d["worst_hour"]
        if w and w["loss_pct"] >= 0.5:
            lines.append(f"   Pior horário: {w['hour']:02d}h–{(w['hour'] + 1) % 24:02d}h (perda {_n(w['loss_pct'], 1)}%)")
    else:
        lines.append("⚠️ Qualidade: sem observação no período")

    un = d["unreachable"]
    if un["count"]:
        lines.append(f"🔌 Antena inacessível: {un['count']} vez(es), {_dur(un['seconds'])} no total")
    al = d["alerts"]
    if al["count"]:
        lines.append(f"🔔 Alertas: {al['count']} disparado(s)" + (f", {al['crit']} crítico(s)" if al["crit"] else ""))

    cov = max(u["coverage"], q["coverage"])
    lines.append("")
    if cov < 0.99:
        lines.append(f"👁️ Cobertura: {_n(cov * 100, 0)}% do período observado. O consumo real é igual ou maior.")
    lines.append(FOOTER)
    return "\n".join(lines)


def build_rolling(db: Database, settings: Any, days: int = 7) -> str | None:
    """Resumo dos últimos `days` dias até agora (comando /resumo e botão do painel). None se não há dados."""
    end = now_ts()
    d = collect(db, settings, end - days * 86400, end)
    return render(d, title=f"Últimos {days} dias") if has_data(d) else None


# --------------------------------------------------------------------------- agendamento
def enabled(settings: Any, notifier: Notifier) -> bool:
    return bool(getattr(settings, "weekly_digest_enabled", True)) and notifier.channels().get("telegram", False)


def tick(db: Database, settings: Any, notifier: Notifier, now: datetime | None = None) -> str:
    """Verifica se o resumo da semana já deveria ter saído. Devolve o que fez (para log e testes)."""
    if not enabled(settings, notifier):
        return "desativado"
    z = ZoneInfo(getattr(settings, "timezone", "UTC"))
    now = now or datetime.now(z)
    at = scheduled_before(now, int(settings.weekly_digest_weekday), int(settings.weekly_digest_hour))
    start, end = week_ending(at)
    last = db.get_kv(KV_LAST_END)
    if last is not None and int(last) >= end:
        return "ja_enviado"
    db.set_kv(KV_LAST_END, str(end))  # marca antes: uma falha ao montar não vira reenvio a cada 5 min
    if (now - at).total_seconds() > GRACE_S:
        log.info("resumo semanal de %s pulado: o agente estava fora do ar no horário", at.date())
        return "atrasado"
    d = collect(db, settings, start, end)
    if not has_data(d):
        log.info("resumo semanal de %s sem dados observados: não enviado", at.date())
        return "sem_dados"
    notifier.enqueue_digest(render(d))
    log.info("resumo semanal de %s na fila", at.date())
    return "enfileirado"


def status(db: Database, settings: Any, notifier: Notifier) -> dict[str, Any]:
    z = ZoneInfo(getattr(settings, "timezone", "UTC"))
    nxt = next_scheduled(datetime.now(z), int(settings.weekly_digest_weekday), int(settings.weekly_digest_hour))
    last = db.get_kv(KV_LAST_END)
    return {
        "enabled": bool(settings.weekly_digest_enabled),
        "telegram": notifier.channels().get("telegram", False),
        "weekday": int(settings.weekly_digest_weekday),
        "hour": int(settings.weekly_digest_hour),
        "next_at": int(nxt.timestamp()) if enabled(settings, notifier) else None,
        "last_period_end": int(last) if last else None,
    }


async def run(db: Database, settings: Any, notifier: Notifier, first_delay_s: float = 30.0) -> None:
    await asyncio.sleep(first_delay_s)  # deixa os ajustes do painel (Configurações) serem aplicados antes
    while True:
        try:
            await asyncio.to_thread(tick, db, settings, notifier)
        except Exception:  # noqa: BLE001 - o resumo nunca derruba o agente
            log.exception("falha no resumo semanal")
        await asyncio.sleep(CHECK_EVERY_S)
