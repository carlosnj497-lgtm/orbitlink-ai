"""Motor de alertas com duração mínima (debounce), histerese, cooldown e agrupamento.

Valores ausentes (sem dados) nunca disparam nem resolvem um alerta.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from ..collector.bus import EventBus
from ..collector.service import Collector
from ..storage import queries
from ..storage.db import Database, now_ts
from ..weather import service as weather
from .notify import Notifier

log = logging.getLogger("orbitlink.alerts")

KINDS: dict[str, dict[str, Any]] = {
    "dish_unreachable": {"label": "Antena inacessível", "unit": "s", "operator": "gt"},
    "latency_high": {"label": "Latência alta (média na janela)", "unit": "ms", "operator": "gt"},
    "loss_high": {"label": "Perda de ping elevada (média na janela)", "unit": "%", "operator": "gt"},
    "multiple_drops": {"label": "Múltiplas quedas na janela", "unit": "eventos", "operator": "gt"},
    "usage_month": {"label": "Consumo estimado do mês acima do limite local", "unit": "GB", "operator": "gt"},
    "usage_cap_pct": {"label": "Franquia do plano consumida no ciclo (estimativa)", "unit": "%", "operator": "gt"},
    "obstruction_high": {"label": "Obstrução acima do limite", "unit": "%", "operator": "gt"},
    "esp32_offline": {"label": "ESP32 sem heartbeat", "unit": "s", "operator": "gt"},
    "esp32_voltage_low": {"label": "Subtensão (sensor ESP32)", "unit": "V", "operator": "lt"},
    "esp32_voltage_high": {"label": "Sobretensão (sensor ESP32)", "unit": "V", "operator": "gt"},
    "esp32_power_lost": {"label": "Alimentação interrompida (sensor ESP32)", "unit": "", "operator": "lt"},
    "esp32_temp_high": {"label": "Temperatura alta (sensor ESP32)", "unit": "°C", "operator": "gt"},
    "weather_rain_forecast": {"label": "Chuva forte prevista (clima estimado)", "unit": "mm/h", "operator": "gt"},
}

DEFAULT_RULES = [
    ("Antena inacessível por 2 min", "dish_unreachable", 120, 0, 300, "crit"),
    ("Latência média > 150 ms (5 min)", "latency_high", 150, 300, 300, "warn"),
    ("Perda média > 10% (5 min)", "loss_high", 10, 300, 300, "warn"),
    ("5+ quedas em 1 h", "multiple_drops", 4, 0, 3600, "warn"),
    ("ESP32 sem heartbeat por 5 min", "esp32_offline", 300, 0, 300, "warn"),
]

# Só avaliam quando a franquia está configurada (sem franquia o valor é "sem dados" e nada dispara).
# O valor só cresce dentro do ciclo, então cada limiar avisa uma vez por ciclo e se resolve na virada.
USAGE_CAP_RULES = [
    ("Franquia: 80% consumida", "usage_cap_pct", 80, 0, 3600, "warn"),
    ("Franquia: 100% consumida", "usage_cap_pct", 100, 0, 3600, "crit"),
]

# Aviso antecipado: maior chuva prevista nas próximas 3 h (janela) acima de 7,6 mm/h ("forte"). Só avalia com a
# localização do clima definida e previsão recente; sem isso o valor é "sem dados" e nada dispara.
WEATHER_RULES = [
    ("Chuva forte prevista nas próximas 3 h", "weather_rain_forecast", 7.6, 0, 10800, "warn"),
]


def _insert_rule(db: Database, name: str, kind: str, thr: float, dur: int, win: int, sev: str, ts: int) -> None:
    db.execute("""INSERT INTO alert_rules (name, kind, operator, threshold, min_duration_s, window_s, severity,
                    cooldown_s, hysteresis, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 900, 0.1, 1, ?, ?)""",
               (name, kind, KINDS[kind]["operator"], thr, dur, win, sev, ts, ts))


def seed_defaults(db: Database) -> None:
    ts = now_ts()
    if not db.scalar("SELECT COUNT(*) FROM alert_rules"):
        for rule in DEFAULT_RULES:
            _insert_rule(db, *rule, ts)
    # Regras acrescentadas em versões novas entram uma única vez, também em bancos já existentes
    # (se o usuário apagar depois, não voltam).
    if db.get_kv("alerts:seed:usage_cap") is None:
        if not db.scalar("SELECT COUNT(*) FROM alert_rules WHERE kind = 'usage_cap_pct'"):
            for rule in USAGE_CAP_RULES:
                _insert_rule(db, *rule, ts)
        db.set_kv("alerts:seed:usage_cap", "1")
    if db.get_kv("alerts:seed:weather") is None:
        if not db.scalar("SELECT COUNT(*) FROM alert_rules WHERE kind = 'weather_rain_forecast'"):
            for wrule in WEATHER_RULES:
                _insert_rule(db, *wrule, ts)
        db.set_kv("alerts:seed:weather", "1")


def measure(db: Database, collector: Collector | None, kind: str, window_s: int, tz: str,
            settings: Any | None = None) -> float | None:
    now = now_ts()
    start = now - window_s
    if kind == "dish_unreachable":
        if collector is None or collector.state.dish_reachable is None:
            return None
        if collector.state.dish_reachable:
            return 0.0
        ev = db.one("SELECT start_ts FROM connection_events WHERE kind='unreachable' AND end_ts IS NULL ORDER BY start_ts DESC")
        return float(now - ev["start_ts"]) if ev else 0.0
    if kind == "latency_high":
        v = db.scalar("SELECT AVG(latency_ms) FROM history_samples WHERE ts >= ? AND drop_rate < 0.999", (start,))
        return float(v) if v is not None else None
    if kind == "loss_high":
        v = db.scalar("SELECT AVG(drop_rate) * 100 FROM history_samples WHERE ts >= ?", (start,))
        return float(v) if v is not None else None
    if kind == "multiple_drops":
        return float(db.scalar("SELECT COUNT(*) FROM connection_events WHERE kind IN ('ping_drop','outage','status_outage') "
                               "AND start_ts >= ?", (start,)) or 0)
    if kind == "usage_month":
        s = queries.usage_summary(db, None, tz)
        return s["month"]["bytes_total"] / 1e9 if s["month"]["observed_seconds"] else None
    if kind == "usage_cap_pct":
        cap = getattr(settings, "usage_monthly_limit_gb", None)
        if not cap or cap <= 0:
            return None
        p = queries.usage_plan(db, None, tz, cap, getattr(settings, "usage_cycle_start_day", 1))
        return float(p["pct_used"]) if p["pct_used"] is not None else None
    if kind == "weather_rain_forecast":
        if settings is not None and not getattr(settings, "weather_enabled", True):
            return None
        f = weather.forecast_max_mm(db, window_s, now)
        return f[0] if f else None
    if kind == "obstruction_high":
        if collector and collector.state.last_status:
            m = collector.state.last_status.metrics.get("obstruction_pct")
            return float(m.value) if m and isinstance(m.value, int | float) else None
        return None
    if kind == "esp32_offline":
        v = db.scalar("SELECT MAX(? - COALESCE(last_seen, created_at)) FROM esp32_nodes WHERE enabled = 1", (now,))
        return float(v) if v is not None else None
    sensor = {"esp32_voltage_low": "power.voltage_v", "esp32_voltage_high": "power.voltage_v",
              "esp32_power_lost": "power.present", "esp32_temp_high": "env.temp_c"}.get(kind)
    if sensor:
        v = db.scalar("""SELECT value FROM esp32_sensor_readings WHERE sensor = ? AND quality != 'fault' AND received_at >= ?
                         ORDER BY ts DESC LIMIT 1""", (sensor, now - max(window_s, 600)))
        return float(v) if v is not None else None
    return None


def _breach(op: str, value: float, thr: float) -> bool:
    return value > thr if op == "gt" else value < thr


def _recovered(op: str, value: float, thr: float, hyst: float) -> bool:
    margin = abs(thr) * hyst
    return value <= thr - margin if op == "gt" else value >= thr + margin


@dataclass
class AlertEngine:
    db: Database
    bus: EventBus
    collector: Collector | None
    tz: str
    settings: Any | None = None
    notifier: Notifier | None = None
    first_breach: dict[int, int] = field(default_factory=dict)

    def _emit(self, ev: dict[str, Any]) -> None:
        self.bus.publish("alert", ev)
        if self.notifier:
            self.notifier.enqueue(ev)

    def evaluate(self) -> list[dict[str, Any]]:
        fired = []
        now = now_ts()
        for r in self.db.query("SELECT * FROM alert_rules WHERE enabled = 1"):
            value = measure(self.db, self.collector, r["kind"], r["window_s"], self.tz, self.settings)
            active = self.db.one("SELECT * FROM alert_events WHERE rule_id = ? AND status = 'active'", (r["id"],))
            if value is None:
                continue
            if active:
                self.db.execute("UPDATE alert_events SET last_value = ? WHERE id = ?", (value, active["id"]))
                if _recovered(r["operator"], value, r["threshold"], r["hysteresis"]):
                    self.db.execute("UPDATE alert_events SET status='resolved', resolved_at=? WHERE id=?", (now, active["id"]))
                    self.first_breach.pop(r["id"], None)
                    unit = KINDS.get(r["kind"], {}).get("unit", "")
                    done = (f"{r['name']}: a previsão não indica mais chuva forte" if r["kind"] == "weather_rain_forecast"
                            else f"{r['name']}: normalizado (valor atual {value:.2f} {unit})".strip())
                    self._emit({"id": active["id"], "rule_id": r["id"], "status": "resolved", "severity": r["severity"],
                                "message": done, "ts": now})
                continue
            if not _breach(r["operator"], value, r["threshold"]):
                self.first_breach.pop(r["id"], None)
                continue
            first = self.first_breach.setdefault(r["id"], now)
            if now - first < r["min_duration_s"]:
                continue
            if r["silenced_until"] and r["silenced_until"] > now:
                continue
            unit = KINDS.get(r["kind"], {}).get("unit", "")
            msg = f"{r['name']}: valor {value:.2f} {unit} (limiar {r['threshold']:g} {unit})".strip()
            if r["kind"] in ("usage_cap_pct", "usage_month"):
                msg += ". Estimativa local; a fatura oficial pode diferir"
            if r["kind"] == "weather_rain_forecast":
                f = weather.forecast_max_mm(self.db, r["window_s"], now)
                when = datetime.fromtimestamp(f[1], ZoneInfo(self.tz)).strftime("%Hh") if f else "as próximas horas"
                msg = (f"🌧️ Chuva forte prevista para {when} ({value:.1f} mm/h)".replace(".", ",")
                       + ". A conexão pode oscilar. Previsão regional (Open-Meteo), não é certeza")
            last = self.db.one("SELECT * FROM alert_events WHERE rule_id = ? ORDER BY started_at DESC LIMIT 1", (r["id"],))
            if last and last["resolved_at"] and now - last["resolved_at"] < r["cooldown_s"]:
                # dentro do cooldown: agrupa na ocorrência anterior em vez de criar outro evento. Ainda assim
                # avisa: o último aviso enviado foi "resolvido", e calar aqui deixaria o usuário achando que está tudo bem.
                occ = int(last["occurrences"] or 1) + 1
                self.db.execute("UPDATE alert_events SET status='active', resolved_at=NULL, occurrences=?, "
                                "last_value=?, message=? WHERE id=?", (occ, value, msg, last["id"]))
                ev = {"id": last["id"], "rule_id": r["id"], "severity": r["severity"], "status": "active",
                      "message": f"{msg} (voltou; ocorrência {occ})", "ts": now, "occurrences": occ}
                fired.append(ev)
                self._emit(ev)
                continue
            cur = self.db.execute("""INSERT INTO alert_events (rule_id, status, severity, started_at, last_value, message)
                                     VALUES (?, 'active', ?, ?, ?, ?)""", (r["id"], r["severity"], now, value, msg))
            ev = {"id": cur.lastrowid, "rule_id": r["id"], "severity": r["severity"], "message": msg, "status": "active",
                  "ts": now}
            fired.append(ev)
            self._emit(ev)
        return fired

    async def run(self, interval_s: float = 30.0) -> None:
        await asyncio.to_thread(seed_defaults, self.db)
        while True:
            try:
                await asyncio.to_thread(self.evaluate)
            except Exception:  # noqa: BLE001
                log.exception("falha ao avaliar alertas")
            if self.notifier:
                try:
                    await self.notifier.deliver_due()
                except Exception:  # noqa: BLE001
                    log.exception("falha ao entregar notificações")
            await asyncio.sleep(interval_s)
