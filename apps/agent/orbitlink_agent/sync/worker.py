"""Sincronização opcional com Supabase.

* O agente coleta normalmente sem Supabase; a fila `sync_queue` (SQLite) acumula o que falta enviar.
* Envio via RPC `ingest_batch` com a anon key + token do agente pareado (nunca service_role).
* Idempotente: o servidor faz upsert por chave natural; reenviar o mesmo lote não duplica nada.
* Falha de rede/servidor: itens permanecem pendentes, backoff exponencial com jitter.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
from typing import Any

import httpx

from .. import __version__
from ..config import Settings
from ..storage.db import Database, now_ts

log = logging.getLogger("orbitlink.sync")
BATCH = 500


def build_batch(db: Database, dish_reachable: bool) -> tuple[dict[str, Any], list[int]]:
    pending = db.query("SELECT id, payload_json FROM sync_queue WHERE synced_at IS NULL AND entity = 'usage_minute' "
                       "ORDER BY id LIMIT ?", (BATCH,))
    ids = [p["id"] for p in pending]
    usage = [json.loads(p["payload_json"]) for p in pending]
    terminals = db.query("SELECT id, terminal_key, name, hardware_version, software_version, origin FROM terminals")
    tel = []
    for u in usage:
        q = db.one("""SELECT minute_ts, samples, latency_avg, latency_max, jitter_avg, drop_avg, full_drop_s, downlink_max_bps,
                             uplink_max_bps, power_avg_w, source FROM quality_minutes WHERE terminal_id = ? AND minute_ts = ?""",
                   (u["terminal_id"], u["minute_ts"]))
        if q:
            tel.append({**q, "terminal_local_id": str(u["terminal_id"])})
    since = now_ts() - 48 * 3600
    events = db.query("""SELECT terminal_id, kind, cause, start_ts, end_ts, duration_s, confidence, evidence_json
                         FROM connection_events WHERE start_ts >= ? OR end_ts IS NULL ORDER BY start_ts LIMIT 1000""", (since,))
    caps = db.query("SELECT key, label, status, detail, checked_at FROM capabilities WHERE device = 'dish'")
    first_tid = str(terminals[0]["id"]) if terminals else None
    batch = {
        "terminals": [{"local_id": str(t["id"]), **{k: t[k] for k in ("terminal_key", "name", "hardware_version",
                                                                        "software_version", "origin")}} for t in terminals],
        "usage_minutes": [{**{k: v for k, v in u.items() if k != "terminal_id"}, "terminal_local_id": str(u["terminal_id"])}
                          for u in usage],
        "telemetry_minutes": tel,
        "events": [{"terminal_local_id": str(e["terminal_id"]) if e["terminal_id"] is not None else None,
                    "kind": e["kind"], "cause": e["cause"], "start_ts": e["start_ts"], "end_ts": e["end_ts"],
                    "duration_s": e["duration_s"], "confidence": e["confidence"],
                    "evidence": json.loads(e["evidence_json"] or "{}")} for e in events],
        "capabilities": [{**c, "terminal_local_id": first_tid} for c in caps] if first_tid else [],
        "heartbeat": {"ts": now_ts(), "dish_reachable": dish_reachable, "version": __version__,
                      "sync_pending": db.scalar("SELECT COUNT(*) FROM sync_queue WHERE synced_at IS NULL")},
    }
    return batch, ids


def mark(db: Database, ids: list[int], error: str | None) -> None:
    if not ids:
        return
    marks = ",".join("?" * len(ids))
    if error is None:
        db.execute(f"UPDATE sync_queue SET synced_at = ?, last_error = NULL WHERE id IN ({marks})", (now_ts(), *ids))  # noqa: S608
    else:
        db.execute(f"UPDATE sync_queue SET attempts = attempts + 1, last_error = ? WHERE id IN ({marks})",  # noqa: S608
                   (error[:200], *ids))


async def push_once(db: Database, settings: Settings, client: httpx.AsyncClient, dish_reachable: bool) -> dict[str, Any]:
    if not (settings.supabase_url and settings.supabase_anon_key and settings.supabase_agent_token):
        raise RuntimeError("Supabase não configurado")
    batch, ids = await asyncio.to_thread(build_batch, db, dish_reachable)
    anon = settings.supabase_anon_key.get_secret_value()
    url = settings.supabase_url.rstrip("/") + "/rest/v1/rpc/ingest_batch"
    try:
        r = await client.post(url, json={"p_agent_token": settings.supabase_agent_token.get_secret_value(), "p_batch": batch},
                              headers={"apikey": anon, "Authorization": f"Bearer {anon}"}, timeout=30)
    except httpx.HTTPError as exc:
        await asyncio.to_thread(mark, db, ids, f"rede: {type(exc).__name__}")
        raise
    if r.status_code >= 400:
        detail = r.text[:200]
        await asyncio.to_thread(mark, db, ids, f"HTTP {r.status_code}: {detail}")
        raise RuntimeError(f"Supabase respondeu {r.status_code}")
    await asyncio.to_thread(mark, db, ids, None)
    result: dict[str, Any] = r.json() if r.content else {}
    return {"sent_usage": len(ids), "server": result}


async def run(db: Database, settings: Settings, state: dict[str, Any], reachable: Any) -> None:
    failures = 0
    async with httpx.AsyncClient() as client:
        while True:
            try:
                res = await push_once(db, settings, client, bool(reachable()))
                state.update(last_ok=now_ts(), last_error=None, last_result=res)
                failures = 0
                delay = settings.sync_interval_s if res["sent_usage"] < BATCH else 2.0
            except Exception as exc:  # noqa: BLE001 - nunca derruba o agente
                failures += 1
                state.update(last_error=f"{type(exc).__name__}: {str(exc)[:150]}", last_error_at=now_ts())
                log.warning("sincronização falhou (%s); dados permanecem na fila local", type(exc).__name__)
                delay = min(settings.sync_interval_s * 2 ** min(failures, 5), 1800) * (0.8 + random.random() * 0.4)
            await asyncio.sleep(delay)
