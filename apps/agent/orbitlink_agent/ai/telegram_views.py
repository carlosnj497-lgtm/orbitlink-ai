"""Consultas do Telegram: texto legível, dados locais e nenhuma chamada à IA."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

from ..alerts.notify import Notifier
from ..reports.builder import _fmt_bytes
from ..storage import queries
from ..storage.db import Database, now_ts
from ..weather import service as weather

PERIODS = {"1h": 3600, "6h": 21600, "24h": 86400, "7d": 604800, "30d": 2592000}
REPORTS = {"consumo", "qualidade", "quedas"}
COMMANDS = {
    "menu": "Abrir a central ASTRYON",
    "status": "Diagnóstico rápido sem IA",
    "consumo": "Consumo estimado por período",
    "franquia": "Ciclo, saldo e projeção do plano",
    "qualidade": "Latência, perda e disponibilidade",
    "quedas": "Interrupções recentes",
    "alertas": "Alertas ativos",
    "clima": "Clima agora e próximas horas",
    "resumo": "Resumo dos últimos 7 dias",
    "bot": "Recursos, cotas e notificações",
    "nova": "Começar uma conversa nova",
    "audio": "Ativar ou desativar respostas em voz",
    "ajuda": "Comandos e exemplos",
}


def keyboard(section: str = "menu") -> dict[str, Any]:
    def button(label: str, action: str) -> dict[str, str]:
        return {"text": label, "callback_data": f"ol:{action}"}

    if section in REPORTS:
        rows = [[button(p, f"{section} {p}") for p in ("1h", "24h", "7d", "30d")]]
    elif section == "menu":
        rows = [
            [button("🛰 Status", "status"), button("📊 Resumo", "resumo")],
            [button("📶 Consumo", "consumo"), button("📦 Franquia", "franquia")],
            [button("⏱ Qualidade", "qualidade"), button("📉 Quedas", "quedas")],
            [button("🔔 Alertas", "alertas"), button("🌦 Clima", "clima")],
            [button("⚙️ Meu bot", "bot")],
            [button("💬 Nova conversa", "nova"), button("❓ Ajuda", "ajuda")],
            [button("🔊 Respostas em áudio", "audio")],
        ]
    else:
        rows = []
    if section != "menu":
        rows.append([button("‹ Menu principal", "menu")])
    return {"inline_keyboard": rows}


def number(value: Any, unit: str = "") -> str:
    return "indisponível" if value is None else f"{value:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".") + unit


def render(db: Database, settings: Any, command: str, period: str = "24h") -> str:
    end = now_ts()
    start = end - PERIODS[period]
    tz = settings.timezone
    zone = ZoneInfo(tz)

    def when(ts: int) -> str:
        return datetime.fromtimestamp(ts, zone).strftime("%d/%m %H:%M")

    tid = db.scalar("SELECT id FROM terminals ORDER BY last_seen DESC LIMIT 1")
    stamp = f"{when(start)} → {when(end)} · {tz}"
    if command == "consumo":
        u = queries.usage_between(db, tid, start, end)
        lines = ["📶 **Consumo estimado**", stamp, ""]
        if u["observed_seconds"]:
            lines += [f"Total: **{_fmt_bytes(u['bytes_total'])}**",
                      f"↓ Download: {_fmt_bytes(u['bytes_download'])}",
                      f"↑ Upload: {_fmt_bytes(u['bytes_upload'])}"]
        else:
            lines.append("Sem dados observados neste período.")
        lines += [f"\nCobertura: {number(u['coverage'] * 100, '%')} · fonte: {u['source']}",
                  "Estimativa local. Lacunas não são consumo zero; a fatura oficial pode diferir."]
        return "\n".join(lines)
    if command == "franquia":
        p = queries.usage_plan(db, tid, tz, settings.usage_monthly_limit_gb, settings.usage_cycle_start_day)
        lines = ["📦 **Franquia do plano**", f"Ciclo: {when(p['cycle_start'])} → {when(p['cycle_end'])}", ""]
        if not p["configured"]:
            lines.append("Franquia não configurada. Defina o limite e o início do ciclo nas configurações do painel.")
        else:
            lines += [f"Limite: {_fmt_bytes(p['cap_bytes'])}",
                      f"Utilizado: {number(p['pct_used'], '%')}",
                      f"Saldo estimado: {_fmt_bytes(p['remaining_bytes']) if p['remaining_bytes'] is not None else 'indisponível'}",
                      f"Projeção ao fim do ciclo: {number(p['projected_pct'], '%')}"]
        lines += [f"\nCobertura: {number(p['used']['coverage'] * 100, '%')} · fonte: {p['source']}",
                  "Estimativa local; com lacunas, o consumo real pode ser maior."]
        return "\n".join(lines)
    if command == "qualidade":
        q = queries.quality(db, tid, start, end, tz)
        return "\n".join([
            "⏱ **Qualidade da conexão**", stamp, "",
            f"Disponibilidade observada: {number(q['availability_pct'], '%')}",
            f"Latência mediana: {number(q['latency_p50_ms'], ' ms')}",
            f"Latência p95: {number(q['latency_p95_ms'], ' ms')}",
            f"Jitter estimado: {number(q['jitter_ms'], ' ms')}",
            f"Perda de ping: {number(q['loss_pct'], '%')}",
            f"\nCobertura: {number(q['coverage'] * 100, '%')} · fonte: {q['source']}",
            "Latência antena → PoP; percentis das médias por minuto. Lacunas ficam fora da disponibilidade.",
        ])
    if command == "quedas":
        events = queries.events(db, start, end, limit=11)
        lines = ["📉 **Interrupções recentes**", stamp, ""]
        labels = {"ping_drop": "Perda de ping", "unreachable": "Antena inacessível", "power_loss": "Falta de energia",
                  "outage": "Interrupção reportada pela antena", "status_outage": "Antena reportou indisponibilidade",
                  "boot": "Reinício da antena"}
        rained = False
        for e in events[:10]:
            duration = "em andamento" if e["open"] else number(e["duration_s"], " s")
            wx = weather.note(weather.at(db, e["start_ts"]))
            rained = rained or bool(wx)
            lines.append(f"• {when(e['start_ts'])} · {labels.get(e['kind'], e['kind'])} · {duration}"
                         + (f" · 🌧 {wx}" if wx else ""))
        if not events:
            lines.append("Nenhuma interrupção registrada. Isso não comprova conexão contínua em períodos sem coleta.")
        if len(events) > 10:
            lines.append("Mostrando as 10 mais recentes; veja o histórico completo no painel.")
        lines.append("\nFonte: eventos locais. Duração pode incluir tempo anterior ao período selecionado.")
        if rained:
            lines.append("🌧 = clima estimado naquela hora (Open-Meteo). Coincidência, não prova de causa.")
        return "\n".join(lines)
    if command == "alertas":
        rows = db.query("SELECT severity, message, started_at FROM alert_events WHERE status='active' "
                        "ORDER BY started_at DESC LIMIT 11")
        lines = ["🔔 **Alertas ativos**", f"Consultado em {when(end)} · {tz}", ""]
        icons = {"crit": "🚨", "warn": "⚠️", "info": "ℹ️"}
        for r in rows[:10]:
            lines.append(f"{icons.get(r['severity'], '•')} {r['message'][:400]}\n{when(r['started_at'])}")
        if not rows:
            lines.append("Nenhum alerta ativo registrado.")
        if len(rows) > 10:
            lines.append("Mostrando os 10 mais recentes; todos os alertas estão no painel.")
        lines.append("\nFonte: regras locais de monitoramento.")
        return "\n".join(lines)
    if command == "bot":
        day = datetime.now(UTC).strftime("%Y-%m-%d")
        used = db.scalar("SELECT requests FROM ai_usage_daily WHERE day = ?", (day,)) or 0
        n = Notifier(db, settings).status()
        ai = bool(settings.groq_api_key and settings.groq_api_key.get_secret_value())
        return "\n".join([
            "⚙️ **Meu ASTRYON**", "",
            f"Assistente: {'IA configurada' if ai else 'diagnóstico por regras'}",
            f"Perguntas hoje (UTC, compartilhadas com o painel): {used}/{settings.ai_daily_request_limit}",
            f"Notas de voz: {'ativadas' if ai and settings.ai_transcribe_enabled else 'desativadas'}",
            f"Notificações pendentes: {n['pending']} · falhas nas últimas 24 h: {n['failed_24h']}",
            f"Resumo semanal: {'ativado' if settings.weekly_digest_enabled else 'desativado'}",
            f"Clima: {loc.name if (loc := weather.get_location(db, settings)) else 'sem cidade (defina em Configurações → Clima)'}",
            f"Fuso: {tz}", "",
            "Os comandos de consulta não gastam a cota de IA.",
            "Envie texto ou uma nota de voz para conversar. Use /nova para reiniciar o contexto.",
        ])
    if command == "clima":
        return render_weather(db, settings, when)
    raise ValueError("consulta desconhecida")


def render_weather(db: Database, settings: Any, when: Any) -> str:
    st = weather.status(db, settings)
    if not st["configured"]:
        return "\n".join(["🌦 **Clima**", "",
                          "Nenhuma cidade definida. Escolha a cidade da antena no painel, em Configurações → Clima.",
                          "Depois disso o clima aparece aqui, nos gráficos e junto das quedas."])
    c = st["current"]
    lines = ["🌦 **Clima**", f"{st['location']['name']}", ""]
    if not c:
        lines.append(f"Ainda sem dados. {('Último erro: ' + st['last_error']) if st['last_error'] else 'Aguardando a primeira busca.'}")
        return "\n".join(lines)
    lines += [f"Agora: **{describe_temp(c['temperature_c'])}** · {weather.describe(c['weather_code'])}",
              f"Chuva: {number(c['precipitation_mm'], ' mm/h')} · Vento: {number(c['wind_kmh'], ' km/h')}"
              f" · Rajadas: {number(c['gust_kmh'], ' km/h')} · Nuvens: {number(c['cloud_cover_pct'], '%')}"]
    nxt = [h for h in weather.hourly(db, now_ts(), now_ts() + 7 * 3600) if h["is_forecast"]][:6]
    if nxt:
        lines += ["", "Próximas horas:"]
        for h in nxt:
            rain = f" · {h['precipitation_mm']:.1f} mm/h".replace(".", ",") if h["precipitation_mm"] else ""
            lines.append(f"• {when(h['hour_ts'])[-5:-3]}h · {describe_temp(h['temperature_c'])} · "
                         f"{weather.describe(h['weather_code'])}{rain}")
    f = weather.forecast_max_mm(db, 3 * 3600)
    if f and f[0] >= 7.6:
        lines += ["", f"⚠️ Chuva forte prevista por volta das {when(f[1])[-5:-3]}h: a conexão pode oscilar."]
    lines += ["", f"Atualizado {when(c['fetched_at'])}{' (desatualizado)' if c['stale'] else ''}.",
              "Estimativa regional (Open-Meteo), não um sensor no local."]
    return "\n".join(lines)


def describe_temp(v: Any) -> str:
    return "indisponível" if v is None else f"{round(v)} °C"
