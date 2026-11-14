"""Escrita idempotente: terminais, status, histórico, agregados, eventos e lacunas."""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from typing import Any

from ..models import DishStatus
from ..starlink.history import Extraction
from .db import Database, now_ts

FULL_DROP = 0.999  # drop_rate >= isto => segundo sem resposta do PoP
MIN_DROP_RUN_S = 2  # sequências menores não viram evento


def upsert_terminal(db: Database, status: DishStatus, target: str, name: str | None = None) -> int:
    key = status.device.terminal_key or f"ut-desconhecido-{target}"
    ts = int(status.observed_at.timestamp())
    with db.tx() as c:
        c.execute(
            """INSERT INTO terminals (terminal_key, name, target, hardware_version, software_version, origin, first_seen, last_seen)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(terminal_key) DO UPDATE SET
                 target = excluded.target,
                 hardware_version = COALESCE(excluded.hardware_version, terminals.hardware_version),
                 software_version = COALESCE(excluded.software_version, terminals.software_version),
                 last_seen = excluded.last_seen""",
            (key, name, target, status.device.hardware_version, status.device.software_version, status.origin, ts, ts),
        )
        row = c.execute("SELECT id FROM terminals WHERE terminal_key = ?", (key,)).fetchone()
    return int(row[0])


def insert_status(db: Database, terminal_id: int, st: DishStatus) -> None:
    def val(k: str) -> Any:
        m = st.metrics.get(k)
        return m.value if m is not None else None

    def raw_bps(k: str) -> float | None:
        v = val(k)
        return float(v) * 1_000_000 if isinstance(v, int | float) else None

    drop = val("pop_drop_pct")
    obs = val("obstruction_pct")
    cur_obs = val("currently_obstructed")
    db.execute(
        """INSERT OR IGNORE INTO status_samples (terminal_id, ts, state, state_reason, downlink_bps, uplink_bps,
             pop_latency_ms, pop_drop_rate, obstruction_fraction, currently_obstructed, uptime_s, software_version,
             alerts_json, outage_json, origin)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            terminal_id, int(st.observed_at.timestamp()), st.state.value, st.state_reason,
            raw_bps("downlink_mbps"), raw_bps("uplink_mbps"), val("pop_latency_ms"),
            float(drop) / 100 if isinstance(drop, int | float) else None,
            float(obs) / 100 if isinstance(obs, int | float) else None,
            int(cur_obs) if isinstance(cur_obs, bool) else None,
            val("uptime_s"), st.device.software_version,
            json.dumps(st.alerts), st.outage.model_dump_json() if st.outage else None, st.origin,
        ),
    )


@dataclass
class HistoryIngest:
    inserted: int
    minutes_touched: int
    lost: int
    drop_events: int


def get_cursor(db: Database, terminal_id: int) -> dict[str, Any] | None:
    return db.one("SELECT * FROM history_cursors WHERE terminal_id = ?", (terminal_id,))


def ingest_history(db: Database, terminal_id: int, boot_id: str, ex: Extraction, origin: str,
                   poll_ts: int, *, sync_enabled: bool = False) -> HistoryIngest:
    source = "calculada" if origin == "grpc" else "demonstracao"
    rows = [
        (terminal_id, boot_id, s.counter, int(s.ts.timestamp()), s.pop_ping_drop_rate, s.pop_ping_latency_ms,
         s.downlink_throughput_bps, s.uplink_throughput_bps, s.power_in_w, origin)
        for s in ex.samples
    ]
    with db.tx() as c:
        before = c.total_changes
        c.executemany(
            """INSERT OR IGNORE INTO history_samples
               (terminal_id, boot_id, counter, ts, drop_rate, latency_ms, downlink_bps, uplink_bps, power_w, origin)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            rows,
        )
        inserted = c.total_changes - before
        c.execute(
            """INSERT INTO history_cursors (terminal_id, boot_id, last_current, last_poll_at, buffer_len)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(terminal_id) DO UPDATE SET boot_id = excluded.boot_id, last_current = excluded.last_current,
                 last_poll_at = excluded.last_poll_at, buffer_len = excluded.buffer_len""",
            (terminal_id, boot_id, ex.new_cursor, poll_ts, ex.buffer_len),
        )
        if ex.lost_samples and ex.lost_from_ts and ex.lost_to_ts:
            c.execute(
                """INSERT OR IGNORE INTO observation_gaps (terminal_id, kind, start_ts, end_ts, samples_lost, detail)
                   VALUES (?, 'history_lost', ?, ?, ?, ?)""",
                (terminal_id, int(ex.lost_from_ts.timestamp()), int(ex.lost_to_ts.timestamp()), ex.lost_samples,
                 "Amostras saíram do buffer circular da antena antes de serem lidas (agente parado ou poll atrasado)."),
            )
        minutes = sorted({r[3] // 60 * 60 for r in rows})
        for m in minutes:
            _recompute_minute(c, terminal_id, m, source, sync_enabled)
        events = _derive_drop_events(c, terminal_id, rows[0][3] - 900, rows[-1][3]) if rows else 0
    return HistoryIngest(inserted=inserted, minutes_touched=len(minutes), lost=ex.lost_samples, drop_events=events)


def _recompute_minute(c: sqlite3.Connection, terminal_id: int, minute: int, source: str, sync_enabled: bool) -> None:
    """Recalcula o minuto a partir das amostras (idempotente: substitui, nunca soma em cima)."""
    rows = c.execute(
        """SELECT ts, counter, drop_rate, latency_ms, downlink_bps, uplink_bps, power_w FROM history_samples
           WHERE terminal_id = ? AND ts >= ? AND ts < ? ORDER BY boot_id, counter""",
        (terminal_id, minute, minute + 60),
    ).fetchall()
    if not rows:
        return
    down = [r["downlink_bps"] for r in rows if r["downlink_bps"] is not None]
    up = [r["uplink_bps"] for r in rows if r["uplink_bps"] is not None]
    n_traffic = max(len(down), len(up))
    if n_traffic:
        c.execute(
            """INSERT INTO usage_minutes (terminal_id, minute_ts, bytes_down, bytes_up, samples, coverage, source)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(terminal_id, minute_ts) DO UPDATE SET bytes_down = excluded.bytes_down, bytes_up = excluded.bytes_up,
                 samples = excluded.samples, coverage = excluded.coverage, source = excluded.source""",
            (terminal_id, minute, sum(down) / 8.0, sum(up) / 8.0, n_traffic, min(1.0, n_traffic / 60.0), source),
        )
        if sync_enabled:
            enqueue_sync(c, "usage_minute", f"{terminal_id}:{minute}",
                         {"terminal_id": terminal_id, "minute_ts": minute, "bytes_down": sum(down) / 8.0,
                          "bytes_up": sum(up) / 8.0, "samples": n_traffic, "coverage": min(1.0, n_traffic / 60.0),
                          "source": source})
    drops = [r["drop_rate"] for r in rows if r["drop_rate"] is not None]
    lats = [r["latency_ms"] for r in rows
            if r["latency_ms"] is not None and (r["drop_rate"] is None or r["drop_rate"] < FULL_DROP)]
    jit = [abs(b - a) for a, b in zip(lats, lats[1:], strict=False)]
    powers = [r["power_w"] for r in rows if r["power_w"] is not None]
    c.execute(
        """INSERT INTO quality_minutes (terminal_id, minute_ts, samples, latency_samples, latency_avg, latency_min, latency_max,
             jitter_avg, drop_avg, drop_samples, full_drop_s, downlink_max_bps, uplink_max_bps, power_avg_w, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(terminal_id, minute_ts) DO UPDATE SET samples = excluded.samples, latency_samples = excluded.latency_samples,
             latency_avg = excluded.latency_avg, latency_min = excluded.latency_min, latency_max = excluded.latency_max,
             jitter_avg = excluded.jitter_avg, drop_avg = excluded.drop_avg, drop_samples = excluded.drop_samples,
             full_drop_s = excluded.full_drop_s,
             downlink_max_bps = excluded.downlink_max_bps, uplink_max_bps = excluded.uplink_max_bps,
             power_avg_w = excluded.power_avg_w, source = excluded.source""",
        (
            terminal_id, minute, len(rows), len(lats),
            sum(lats) / len(lats) if lats else None, min(lats) if lats else None, max(lats) if lats else None,
            sum(jit) / len(jit) if jit else None,
            sum(drops) / len(drops) if drops else None, len(drops),
            sum(1 for d in drops if d >= FULL_DROP),
            max(down) if down else None, max(up) if up else None,
            sum(powers) / len(powers) if powers else None, source,
        ),
    )


def _derive_drop_events(c: sqlite3.Connection, terminal_id: int, start: int, end: int) -> int:
    """Sequências de perda total de ping => evento `ping_drop` (confiança: derivado)."""
    rows = c.execute(
        """SELECT boot_id, counter, ts, drop_rate FROM history_samples
           WHERE terminal_id = ? AND ts >= ? AND ts <= ? ORDER BY boot_id, counter""",
        (terminal_id, start, end),
    ).fetchall()
    runs: list[tuple[int, int, int]] = []
    run_start: int | None = None
    run_len = 0
    last_ts = 0
    prev_key: tuple[str, int] | None = None
    for r in rows:
        contiguous = prev_key is not None and prev_key[0] == r["boot_id"] and r["counter"] == prev_key[1] + 1
        is_drop = r["drop_rate"] is not None and r["drop_rate"] >= FULL_DROP
        if run_start is not None and (not is_drop or not contiguous):
            runs.append((run_start, last_ts, run_len))
            run_start, run_len = None, 0
        if is_drop:
            if run_start is None:
                run_start = r["ts"]
            run_len += 1
            last_ts = r["ts"]
        prev_key = (r["boot_id"], r["counter"])
    if run_start is not None:
        runs.append((run_start, last_ts, run_len))
    n = 0
    for s, e, length in runs:
        if length < MIN_DROP_RUN_S:
            continue
        c.execute(
            """INSERT INTO connection_events (terminal_id, kind, cause, start_ts, end_ts, duration_s, confidence, evidence_json)
               VALUES (?, 'ping_drop', ?, ?, ?, ?, 'derivado', ?)
               ON CONFLICT(terminal_id, kind, start_ts) DO UPDATE SET end_ts = excluded.end_ts,
                 duration_s = excluded.duration_s, evidence_json = excluded.evidence_json""",
            (terminal_id, "Perda total de ping ao PoP", s, e + 1, float(length),
             json.dumps({"fonte": "get_history.pop_ping_drop_rate", "amostras": length,
                         "nota": "Evento observado; a causa não é determinada por este dado."})),
        )
        n += 1
    return n


def record_dish_outages(db: Database, terminal_id: int, outages: list[dict[str, Any]]) -> int:
    """Interrupções reportadas pela própria antena (`get_history.outages`)."""
    from datetime import UTC, datetime

    from ..starlink.normalize import parse_outage

    n = 0
    now = datetime.now(UTC)
    with db.tx() as c:
        for raw in outages:
            o = parse_outage(raw, now)
            if o is None or o.started_at is None:
                continue
            start = int(o.started_at.timestamp())
            dur = o.duration_s
            c.execute(
                """INSERT INTO connection_events (terminal_id, kind, cause, start_ts, end_ts, duration_s, confidence, evidence_json)
                   VALUES (?, 'outage', ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(terminal_id, kind, start_ts) DO UPDATE SET end_ts = excluded.end_ts,
                     duration_s = excluded.duration_s""",
                (terminal_id, o.cause, start, start + int(dur) if dur is not None else None, dur,
                 "confirmado" if o.timestamp_quality == "confiavel" else "indeterminado",
                 json.dumps({"fonte": "get_history.outages", "timestamp": o.timestamp_quality,
                             "did_switch": o.did_switch})),
            )
            n += 1
    return n


def open_event(db: Database, terminal_id: int | None, kind: str, cause: str | None, start_ts: int, confidence: str,
               evidence: dict[str, Any]) -> None:
    db.execute(
        """INSERT OR IGNORE INTO connection_events (terminal_id, kind, cause, start_ts, confidence, evidence_json)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (terminal_id, kind, cause, start_ts, confidence, json.dumps(evidence)),
    )


def close_open_events(db: Database, kind: str, end_ts: int, terminal_id: int | None = None) -> int:
    cur = db.execute(
        """UPDATE connection_events SET end_ts = ?, duration_s = ? - start_ts
           WHERE end_ts IS NULL AND kind = ? AND (? IS NULL OR terminal_id IS ? OR terminal_id = ?)""",
        (end_ts, end_ts, kind, terminal_id, terminal_id, terminal_id),
    )
    return cur.rowcount


def record_gap(db: Database, terminal_id: int | None, kind: str, start_ts: int, end_ts: int | None, detail: str) -> None:
    db.execute(
        """INSERT INTO observation_gaps (terminal_id, kind, start_ts, end_ts, detail) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(terminal_id, kind, start_ts) DO UPDATE SET end_ts = excluded.end_ts""",
        (terminal_id, kind, start_ts, end_ts, detail),
    )


def close_open_gaps(db: Database, kind: str, end_ts: int) -> None:
    db.execute("UPDATE observation_gaps SET end_ts = ? WHERE kind = ? AND end_ts IS NULL", (end_ts, kind))


def insert_obstruction(db: Database, terminal_id: int, ts: int, rows: int, cols: int, snr: list[float],
                       min_el: float | None, max_theta: float | None, origin: str) -> None:
    db.execute(
        """INSERT OR IGNORE INTO obstruction_snapshots (terminal_id, ts, num_rows, num_cols, snr_json, min_elevation_deg,
             max_theta_deg, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (terminal_id, ts, rows, cols, json.dumps(snr), min_el, max_theta, origin),
    )


def save_capabilities(db: Database, target: str, caps: list[Any]) -> None:
    with db.tx() as c:
        for cap in caps:
            c.execute(
                """INSERT INTO capabilities (target, key, device, label, origin, kind, status, available, offered, detail, checked_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(target, key) DO UPDATE SET status = excluded.status, available = excluded.available,
                     detail = excluded.detail, checked_at = excluded.checked_at, label = excluded.label,
                     offered = excluded.offered""",
                (target, cap.key, cap.device, cap.label, cap.origin, cap.kind, cap.status.value, int(cap.available),
                 int(cap.offered_by_orbitlink), cap.detail, int(cap.checked_at.timestamp())),
            )


def heartbeat(db: Database, dish_reachable: bool, router_reachable: bool | None, last_status_ts: int | None,
              version: str) -> None:
    db.execute("INSERT OR REPLACE INTO agent_heartbeats VALUES (?, ?, ?, ?, ?)",
               (now_ts(), int(dish_reachable), None if router_reachable is None else int(router_reachable),
                last_status_ts, version))


def enqueue_sync(c: sqlite3.Connection | Database, entity: str, key: str, payload: dict[str, Any]) -> None:
    c.execute(
        """INSERT INTO sync_queue (entity, record_key, payload_json, created_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(entity, record_key) DO UPDATE SET payload_json = excluded.payload_json, synced_at = NULL,
             attempts = 0, last_error = NULL""",
        (entity, key, json.dumps(payload), now_ts()),
    )


def apply_retention(db: Database, raw_days: int, minute_days: int, sensor_days: int = 30,
                    log_days: int = 90) -> dict[str, int]:
    """Apaga o que passou da retenção. Nada que ainda esteja em aberto (evento sem fim, alerta ativo,
    notificação pendente, controle em andamento) é apagado."""
    now = now_ts()
    raw_cut = now - raw_days * 86400
    min_cut = now - minute_days * 86400
    sensor_cut = now - sensor_days * 86400
    log_cut = now - log_days * 86400
    out = {}
    with db.tx() as c:
        out["history_samples"] = c.execute("DELETE FROM history_samples WHERE ts < ?", (raw_cut,)).rowcount
        out["status_samples"] = c.execute("DELETE FROM status_samples WHERE ts < ?", (raw_cut,)).rowcount
        out["usage_minutes"] = c.execute("DELETE FROM usage_minutes WHERE minute_ts < ?", (min_cut,)).rowcount
        out["quality_minutes"] = c.execute("DELETE FROM quality_minutes WHERE minute_ts < ?", (min_cut,)).rowcount
        out["heartbeats"] = c.execute("DELETE FROM agent_heartbeats WHERE ts < ?", (raw_cut,)).rowcount
        out["obstruction"] = c.execute("DELETE FROM obstruction_snapshots WHERE ts < ?", (min_cut,)).rowcount
        out["sync_done"] = c.execute("DELETE FROM sync_queue WHERE synced_at IS NOT NULL AND synced_at < ?",
                                     (raw_cut,)).rowcount
        # Pendentes cujo minuto de origem já saiu da retenção: não há mais o que reenviar.
        out["sync_stale"] = c.execute("DELETE FROM sync_queue WHERE synced_at IS NULL AND created_at < ?",
                                      (min_cut,)).rowcount
        out["sessions"] = c.execute("DELETE FROM sessions WHERE expires_at < ?", (now,)).rowcount
        out["esp32_readings"] = c.execute("DELETE FROM esp32_sensor_readings WHERE received_at < ?",
                                          (sensor_cut,)).rowcount
        out["notifications"] = c.execute(
            "DELETE FROM notification_outbox WHERE (sent_at IS NOT NULL OR failed_at IS NOT NULL) AND created_at < ?",
            (log_cut,)).rowcount
        out["alert_events"] = c.execute("DELETE FROM alert_events WHERE status = 'resolved' AND resolved_at < ?",
                                        (log_cut,)).rowcount
        out["connection_events"] = c.execute(
            "DELETE FROM connection_events WHERE end_ts IS NOT NULL AND end_ts < ?", (min_cut,)).rowcount
        out["observation_gaps"] = c.execute(
            "DELETE FROM observation_gaps WHERE end_ts IS NOT NULL AND end_ts < ?", (min_cut,)).rowcount
        out["control_requests"] = c.execute(
            "DELETE FROM control_requests WHERE status NOT IN ('pending', 'executing') AND created_at < ?",
            (min_cut,)).rowcount
        out["control_audit"] = c.execute("DELETE FROM control_audit_logs WHERE ts < ?", (min_cut,)).rowcount
    return out
