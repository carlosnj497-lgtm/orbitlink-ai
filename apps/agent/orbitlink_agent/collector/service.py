"""Coletor assíncrono: status, histórico, obstrução, capacidades, heartbeat e manutenção.

Cada laço tem intervalo próprio, timeout, backoff exponencial com jitter e nunca derruba os outros.
Chamadas gRPC são bloqueantes e rodam em thread.
"""

from __future__ import annotations

import asyncio
import logging
import random
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from .. import __version__
from ..config import Settings
from ..models import DishStatus
from ..starlink.capabilities import Capability, CapStatus, probe
from ..starlink.client import StarlinkClient
from ..starlink.errors import ErrorKind, StarlinkError
from ..starlink.history import boot_id_from_uptime, extract_new_samples
from ..starlink.normalize import normalize_status
from ..starlink.transport import StarlinkTransport
from ..storage import repo
from ..storage.db import Database, now_ts
from .bus import EventBus

log = logging.getLogger("orbitlink.collector")


@dataclass
class LoopStats:
    runs: int = 0
    failures: int = 0
    consecutive_failures: int = 0
    last_ok: int | None = None
    last_error: str | None = None
    last_error_kind: str | None = None
    last_duration_ms: float | None = None


@dataclass
class CollectorState:
    started_at: int = field(default_factory=now_ts)
    mode: str = "real"
    dish_target: str = ""
    dish_reachable: bool | None = None
    terminal_id: int | None = None
    last_status: DishStatus | None = None
    last_status_ts: int | None = None
    boot_id: str | None = None
    capabilities: list[Capability] = field(default_factory=list)
    capabilities_checked: int | None = None
    loops: dict[str, LoopStats] = field(default_factory=dict)
    history_inserted_total: int = 0
    history_lost_total: int = 0


class Collector:
    def __init__(self, settings: Settings, db: Database, transport: StarlinkTransport, bus: EventBus) -> None:
        self.s = settings
        self.db = db
        self.transport = transport
        self.client = StarlinkClient(transport, timeout_s=settings.grpc_timeout_s)
        self.bus = bus
        self.state = CollectorState(mode="fixture" if transport.origin == "fixture" else "real",
                                    dish_target=transport.target)
        self._tasks: list[asyncio.Task[None]] = []
        self._stop = asyncio.Event()
        self._force_caps = asyncio.Event()

    # ------------------------------------------------------------------ ciclo de vida
    async def start(self) -> None:
        await self.db.run(self._detect_agent_downtime)
        loops: list[tuple[str, float, Callable[[], Awaitable[None]]]] = [
            ("capabilities", self.s.capability_refresh_s, self.refresh_capabilities),
            ("status", self.s.status_interval_s, self.poll_status),
            ("history", self.s.history_interval_s, self.poll_history),
            ("obstruction", self.s.obstruction_interval_s, self.poll_obstruction),
            ("heartbeat", self.s.heartbeat_interval_s, self.beat),
            ("maintenance", 3600.0, self.maintenance),
        ]
        for name, interval, fn in loops:
            self.state.loops[name] = LoopStats()
            self._tasks.append(asyncio.create_task(self._loop(name, interval, fn), name=f"loop:{name}"))

    async def stop(self) -> None:
        self._stop.set()
        for t in self._tasks:
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        await self.db.run(repo.heartbeat, self.db, bool(self.state.dish_reachable), None, self.state.last_status_ts,
                          __version__)
        self.transport.close()

    async def _loop(self, name: str, interval: float, fn: Callable[[], Awaitable[None]]) -> None:
        stats = self.state.loops[name]
        if name == "history":
            await asyncio.sleep(2.0)  # deixa o primeiro status identificar o terminal
        while not self._stop.is_set():
            t0 = asyncio.get_running_loop().time()
            try:
                await fn()
                stats.runs += 1
                stats.consecutive_failures = 0
                stats.last_ok = now_ts()
                stats.last_error = None
                stats.last_error_kind = None
                delay = interval
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - cada laço é isolado
                stats.runs += 1
                stats.failures += 1
                stats.consecutive_failures += 1
                kind = exc.kind.value if isinstance(exc, StarlinkError) else "erro"
                stats.last_error = exc.message if isinstance(exc, StarlinkError) else f"{type(exc).__name__}: {exc}"
                stats.last_error_kind = kind
                if not isinstance(exc, StarlinkError):
                    log.exception("falha no laço %s", name)
                backoff = min(interval * (2 ** min(stats.consecutive_failures, 6)), max(interval, 300.0))
                delay = backoff * (0.8 + random.random() * 0.4)
            stats.last_duration_ms = round((asyncio.get_running_loop().time() - t0) * 1000, 1)
            if name == "capabilities":
                try:
                    await asyncio.wait_for(self._force_caps.wait(), timeout=delay)
                    self._force_caps.clear()
                except TimeoutError:
                    pass
            else:
                await asyncio.sleep(delay)

    def request_capability_refresh(self) -> None:
        self._force_caps.set()

    # ------------------------------------------------------------------ disponibilidade
    def capability(self, key: str) -> Capability | None:
        return next((c for c in self.state.capabilities if c.key == key), None)

    def _cap_ok(self, key: str) -> bool:
        c = self.capability(key)
        # Sem matriz ainda: tenta (a própria chamada descobre); com matriz: respeita.
        return c is None or c.status == CapStatus.VERIFICADA

    async def _set_reachable(self, reachable: bool, reason: str | None = None) -> None:
        prev = self.state.dish_reachable
        self.state.dish_reachable = reachable
        if prev is reachable:
            return
        ts = now_ts()
        if not reachable:
            await self.db.run(repo.open_event, self.db, self.state.terminal_id, "unreachable", reason, ts, "indeterminado",
                              {"nota": "O agente não conseguiu falar com a antena. Pode ser a antena, a rede local, "
                                       "o roteador ou este computador — a causa não é determinada."})
            await self.db.run(repo.record_gap, self.db, self.state.terminal_id, "dish_unreachable", ts, None,
                              reason or "antena inacessível")
        else:
            await self.db.run(repo.close_open_events, self.db, "unreachable", ts)
            await self.db.run(repo.close_open_gaps, self.db, "dish_unreachable", ts)
            if prev is False:
                self.request_capability_refresh()
        self.bus.publish("agent", self.agent_snapshot())

    # ------------------------------------------------------------------ laços
    async def refresh_capabilities(self) -> None:
        res = await asyncio.to_thread(probe, self.transport, "dish", timeout=self.s.grpc_timeout_s)
        self.state.capabilities = res.capabilities
        self.state.capabilities_checked = now_ts()
        await self.db.run(repo.save_capabilities, self.db, self.transport.target, res.capabilities)
        self.bus.publish("capabilities", {"checked_at": self.state.capabilities_checked})
        if res.error is not None:
            raise res.error

    async def poll_status(self) -> None:
        try:
            res = await asyncio.to_thread(self.transport.call, "get_status", None, timeout=self.s.grpc_timeout_s)
        except StarlinkError as err:
            if err.kind in (ErrorKind.UNREACHABLE, ErrorKind.TIMEOUT):
                await self._set_reachable(False, err.message)
            raise
        st = normalize_status(res.data, origin=res.origin, drop_threshold=self.s.degraded_drop_rate)
        tid = await self.db.run(repo.upsert_terminal, self.db, st, self.transport.target, self.s.terminal_name)
        self.state.terminal_id = tid
        await self._set_reachable(True)
        await self.db.run(repo.insert_status, self.db, tid, st)
        await self._track_outage(tid, st)
        self.state.last_status = st
        self.state.last_status_ts = int(st.observed_at.timestamp())
        self.bus.publish("status", st.model_dump(mode="json"))

    async def _track_outage(self, tid: int, st: DishStatus) -> None:
        if st.outage is not None:
            start = st.outage.started_at if st.outage.timestamp_quality == "confiavel" else None
            start_ts = int(start.timestamp()) if start else int(st.observed_at.timestamp())
            prev_open = await self.db.run(self.db.one, "SELECT id FROM connection_events WHERE kind='status_outage' "
                                          "AND end_ts IS NULL AND terminal_id = ?", (tid,))
            if prev_open is None:
                await self.db.run(repo.open_event, self.db, tid, "status_outage", st.outage.cause, start_ts, "confirmado",
                                  {"fonte": "get_status.outage", "timestamp": st.outage.timestamp_quality})
        else:
            await self.db.run(repo.close_open_events, self.db, "status_outage", int(st.observed_at.timestamp()), tid)

    async def poll_history(self) -> None:
        tid = self.state.terminal_id
        if tid is None:
            return  # sem status ainda; não há como associar o histórico a um terminal
        if not self._cap_ok("dish.history"):
            return
        poll = datetime.now(UTC)
        raw = await asyncio.to_thread(self.client.get_history_raw)
        cursor = await self.db.run(repo.get_cursor, self.db, tid)
        uptime = None
        if self.state.last_status and "uptime_s" in self.state.last_status.metrics:
            age = (poll - self.state.last_status.observed_at).total_seconds()
            v = self.state.last_status.metrics["uptime_s"].value
            uptime = float(v) + age if isinstance(v, int | float) else None
        current = int(raw.get("current") or 0)
        rebooted = False
        if cursor is not None:
            elapsed = poll.timestamp() - cursor["last_poll_at"]
            if current < cursor["last_current"] or (uptime is not None and uptime < elapsed - 5):
                rebooted = True
        use_cursor = None if (cursor is None or rebooted) else int(cursor["last_current"])
        ex = extract_new_samples(raw, use_cursor, poll)
        if cursor is None or rebooted:
            boot_id = boot_id_from_uptime(poll, uptime) or f"boot-desconhecido-{int(poll.timestamp())}"
        else:
            boot_id = str(cursor["boot_id"])
        if rebooted and cursor is not None:
            await self.db.run(repo.open_event, self.db, tid, "boot", "Reinício da antena detectado",
                              int(poll.timestamp() - (uptime or 0)), "confirmado" if uptime is not None else "derivado",
                              {"fonte": "contador do histórico/uptime", "boot_id": boot_id})
            await self.db.run(repo.close_open_events, self.db, "boot", int(poll.timestamp()), tid)
            # amostras do boot anterior entre o último poll e o reinício foram perdidas
            await self.db.run(repo.record_gap, self.db, tid, "history_lost", int(cursor["last_poll_at"]),
                              int(poll.timestamp() - (uptime or 0)),
                              "Antena reiniciou; amostras finais do boot anterior não puderam ser lidas.")
        result = await self.db.run(repo.ingest_history, self.db, tid, boot_id, ex, self.transport.origin,
                                   int(poll.timestamp()), sync_enabled=bool(self.s.supabase_url))
        outages = raw.get("outages")
        if isinstance(outages, list) and outages:
            await self.db.run(repo.record_dish_outages, self.db, tid, outages)
        self.state.boot_id = boot_id
        self.state.history_inserted_total += result.inserted
        self.state.history_lost_total += result.lost
        self.bus.publish("history", {"inserted": result.inserted, "lost": result.lost, "boot_id": boot_id,
                                     "ts": int(poll.timestamp())})

    async def poll_obstruction(self) -> None:
        tid = self.state.terminal_id
        cap = self.capability("dish.obstruction_map")
        if tid is None or cap is None or cap.status != CapStatus.VERIFICADA:
            return
        m = await asyncio.to_thread(self.client.get_obstruction_map)
        if m is None:
            return
        await self.db.run(repo.insert_obstruction, self.db, tid, int(m.observed_at.timestamp()), m.num_rows, m.num_cols,
                          m.snr, m.min_elevation_deg, m.max_theta_deg, m.origin)

    async def beat(self) -> None:
        await self.db.run(repo.heartbeat, self.db, bool(self.state.dish_reachable), None, self.state.last_status_ts,
                          __version__)
        self.bus.publish("agent", self.agent_snapshot())

    async def maintenance(self) -> None:
        await self.db.run(repo.apply_retention, self.db, self.s.retention_raw_days, self.s.retention_minute_days,
                          self.s.retention_sensor_days, self.s.retention_log_days)

    def _detect_agent_downtime(self) -> None:
        last = self.db.scalar("SELECT MAX(ts) FROM agent_heartbeats")
        now = now_ts()
        # eventos abertos de uma execução anterior são fechados no último heartbeat conhecido
        if last is not None:
            for kind in ("unreachable", "status_outage"):
                repo.close_open_events(self.db, kind, int(last))
            repo.close_open_gaps(self.db, "dish_unreachable", int(last))
            if now - int(last) > 3 * self.s.heartbeat_interval_s:
                repo.record_gap(self.db, None, "agent_offline", int(last), now,
                                "Agente OrbitLink não estava em execução; nada foi observado neste período.")

    # ------------------------------------------------------------------ snapshots
    def agent_snapshot(self) -> dict[str, Any]:
        st = self.state
        now = now_ts()
        age = now - st.last_status_ts if st.last_status_ts else None
        stale = age is None or age > 3 * self.s.status_interval_s
        return {
            "version": __version__,
            "mode": st.mode,
            "started_at": st.started_at,
            "now": now,
            "dish_target": st.dish_target,
            "dish_reachable": st.dish_reachable,
            "terminal_id": st.terminal_id,
            "boot_id": st.boot_id,
            "last_status_ts": st.last_status_ts,
            "status_age_s": age,
            "status_stale": stale,
            "firmware": st.last_status.device.software_version if st.last_status else None,
            "hardware": st.last_status.device.hardware_version if st.last_status else None,
            "capabilities_checked": st.capabilities_checked,
            "history_inserted_total": st.history_inserted_total,
            "history_lost_total": st.history_lost_total,
            "loops": {k: vars(v) for k, v in st.loops.items()},
            "sse_subscribers": self.bus.subscribers,
        }
