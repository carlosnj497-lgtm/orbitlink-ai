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
from . import pairing

log = logging.getLogger("astryon.sync")
BATCH = 500
# Item recusado pelo servidor (HTTP 4xx) sozinho este número de vezes sai da fila de envio (fica registrado com o
# erro), para um dado defeituoso não travar a sincronização de todo o resto.
MAX_ATTEMPTS = 5


def build_batch(db: Database, dish_reachable: bool, limit: int = BATCH) -> tuple[dict[str, Any], list[int]]:
    batch, sent = build_batch_snapshot(db, dish_reachable, limit)
    return batch, [i for i, _ in sent]


def build_batch_snapshot(db: Database, dish_reachable: bool, limit: int = BATCH,
                         with_extras: bool = True) -> tuple[dict[str, Any], list[tuple[int, str]]]:
    """Lote + (id, payload) de cada item enviado, para marcar como enviado SÓ o que não mudou durante o envio."""
    pending = db.query("SELECT id, payload_json FROM sync_queue WHERE synced_at IS NULL AND entity = 'usage_minute' "
                       "AND attempts < ? ORDER BY id LIMIT ?", (MAX_ATTEMPTS, limit))
    sent = [(p["id"], p["payload_json"]) for p in pending]
    usage = [json.loads(p["payload_json"]) for p in pending]
    terminals = db.query("SELECT id, terminal_key, name, hardware_version, software_version, origin FROM terminals")
    tel = []
    for u in usage:
        q = db.one("""SELECT minute_ts, samples, latency_avg, latency_max, jitter_avg, drop_avg, full_drop_s, downlink_max_bps,
                             uplink_max_bps, power_avg_w, source FROM quality_minutes WHERE terminal_id = ? AND minute_ts = ?""",
                   (u["terminal_id"], u["minute_ts"]))
        if q:
            tel.append({**q, "terminal_local_id": str(u["terminal_id"])})
    events, _ = event_snapshot(db) if with_extras else ([], [])
    caps = [] if not with_extras else db.query(
        "SELECT key, label, status, detail, checked_at FROM capabilities WHERE device = 'dish'")
    first_tid = str(terminals[0]["id"]) if terminals else None
    batch = {
        "terminals": [{"local_id": str(t["id"]), **{k: t[k] for k in ("terminal_key", "name", "hardware_version",
                                                                        "software_version", "origin")}} for t in terminals],
        "usage_minutes": [{**{k: v for k, v in u.items() if k != "terminal_id"}, "terminal_local_id": str(u["terminal_id"])}
                          for u in usage],
        "telemetry_minutes": tel,
        "events": events,
        "capabilities": [{**c, "terminal_local_id": first_tid} for c in caps] if first_tid else [],
        "heartbeat": {"ts": now_ts(), "dish_reachable": dish_reachable, "version": __version__,
                      "sync_pending": db.scalar("SELECT (SELECT COUNT(*) FROM sync_queue WHERE synced_at IS NULL) "
                      "+ (SELECT COUNT(*) FROM event_sync WHERE synced_revision < revision)")},
    }
    return batch, sent


def event_snapshot(db: Database) -> tuple[list[dict[str, Any]], list[tuple[int, int]]]:
    rows = db.query("""SELECT e.*, q.revision FROM connection_events e JOIN event_sync q ON q.event_id = e.id
                       WHERE q.synced_revision < q.revision ORDER BY e.id LIMIT 1000""")
    payloads = [{"terminal_local_id": str(e["terminal_id"]) if e["terminal_id"] is not None else None,
                 **{k: e[k] for k in ("kind", "cause", "start_ts", "end_ts", "duration_s", "confidence")},
                 "evidence": json.loads(e["evidence_json"] or "{}")} for e in rows]
    return payloads, [(e["id"], e["revision"]) for e in rows]


def confirm_events(db: Database, sent: list[tuple[int, int]]) -> None:
    with db.tx() as c:
        for event_id, revision in sent:
            c.execute("UPDATE event_sync SET synced_revision = MAX(synced_revision, ?) WHERE event_id = ?",
                      (revision, event_id))


def mark_sent(db: Database, sent: list[tuple[int, str]]) -> int:
    """Marca como enviados os itens cujo payload ainda é o que foi enviado. Se o minuto foi recalculado durante o
    envio (o upsert zera synced_at e troca o payload), ele continua pendente e sai no próximo lote."""
    ts = now_ts()
    n = 0
    with db.tx() as c:
        for item_id, payload in sent:
            n += c.execute("UPDATE sync_queue SET synced_at = ?, last_error = NULL WHERE id = ? AND payload_json = ?",
                           (ts, item_id, payload)).rowcount
    return n


def mark_error_only(db: Database, ids: list[int], error: str) -> None:
    marks = ",".join("?" * len(ids))
    db.execute(f"UPDATE sync_queue SET last_error = ? WHERE id IN ({marks})", (error[:200], *ids))  # noqa: S608


def mark(db: Database, ids: list[int], error: str | None) -> None:
    if not ids:
        return
    marks = ",".join("?" * len(ids))
    if error is None:
        db.execute(f"UPDATE sync_queue SET synced_at = ?, last_error = NULL WHERE id IN ({marks})", (now_ts(), *ids))  # noqa: S608
    else:
        db.execute(f"UPDATE sync_queue SET attempts = attempts + 1, last_error = ? WHERE id IN ({marks})",  # noqa: S608
                   (error[:200], *ids))


class Rejected(RuntimeError):
    """O servidor recusou o lote (HTTP 4xx que não é de autenticação/limite): provável item defeituoso."""

    def __init__(self, message: str, size: int, with_extras: bool = False) -> None:
        super().__init__(message)
        self.size = size
        self.with_extras = with_extras  # o lote recusado levava eventos/capacidades (suspeitos antes do consumo)


async def push_once(db: Database, settings: Settings, client: httpx.AsyncClient, dish_reachable: bool,
                    limit: int = BATCH, with_extras: bool = True) -> dict[str, Any]:
    token = await asyncio.to_thread(pairing.agent_token, db, settings)
    if not (settings.supabase_url and settings.supabase_anon_key and token):
        raise RuntimeError("Supabase não configurado")
    batch, sent = await asyncio.to_thread(build_batch_snapshot, db, dish_reachable, limit, with_extras)
    events, event_sent = await asyncio.to_thread(event_snapshot, db) if with_extras else ([], [])
    batch["events"] = events
    ids = [i for i, _ in sent]
    has_extras = bool(batch["events"] or batch["capabilities"])
    anon = settings.supabase_anon_key.get_secret_value()
    url = settings.supabase_url.rstrip("/") + "/rest/v1/rpc/ingest_batch"
    try:
        r = await client.post(url, json={"p_agent_token": token, "p_batch": batch},
                              headers={"apikey": anon, "Authorization": f"Bearer {anon}"}, timeout=30)
    except httpx.HTTPError as exc:
        await asyncio.to_thread(mark, db, ids, f"rede: {type(exc).__name__}")
        raise
    if r.status_code >= 400:
        detail = r.text[:200]
        rejected = 400 <= r.status_code < 500 and r.status_code not in (401, 403, 408, 429)
        if rejected and (len(ids) > 1 or has_extras):
            # Lote recusado: ainda não se sabe qual item é o defeituoso (pode ser um evento ou capacidade, não o
            # consumo); não conta tentativa para ninguém.
            await asyncio.to_thread(mark_error_only, db, ids, f"HTTP {r.status_code}: {detail}")
        elif ids:
            await asyncio.to_thread(mark, db, ids, f"HTTP {r.status_code}: {detail}")
        if rejected:
            raise Rejected(f"Supabase recusou o lote ({r.status_code})", len(ids), has_extras)
        raise RuntimeError(f"Supabase respondeu {r.status_code}")
    confirmed = await asyncio.to_thread(mark_sent, db, sent)
    await asyncio.to_thread(confirm_events, db, event_sent)
    result: dict[str, Any] = r.json() if r.content else {}
    return {"sent_usage": len(ids), "confirmed": confirmed, "sent_events": len(event_sent), "server": result}


async def run(db: Database, settings: Settings, state: dict[str, Any], reachable: Any) -> None:
    failures = 0
    limit = BATCH
    extras_suspect = False  # o último lote recusado levava eventos/capacidades: reenviar só o consumo
    extras_off_until = 0
    async with httpx.AsyncClient() as client:
        while True:
            with_extras = not extras_suspect and now_ts() >= extras_off_until
            try:
                res = await push_once(db, settings, client, bool(reachable()), limit, with_extras)
                state.update(last_ok=now_ts(), last_error=None, last_result=res)
                failures = 0
                if extras_suspect:
                    # O consumo passou sem os extras: o defeito está nos eventos/capacidades. Eles ficam de fora por
                    # uma hora, e o consumo continua sincronizando em vez de ser descartado item a item.
                    extras_off_until = now_ts() + 3600
                    extras_suspect = False
                    log.warning("Supabase recusa eventos/capacidades; enviando só o consumo pela próxima hora")
                delay = settings.sync_interval_s if res["sent_usage"] < limit and res["sent_events"] < 1000 else 2.0
                limit = BATCH
            except Rejected as exc:
                if exc.with_extras:
                    # Primeiro descarta a hipótese dos extras: mesmo lote de consumo, sem eventos/capacidades.
                    extras_suspect = True
                else:
                    # Divide o lote até isolar o item defeituoso; sozinho, ele sai da fila após MAX_ATTEMPTS recusas.
                    limit = max(1, exc.size // 2)
                state.update(last_error=str(exc), last_error_at=now_ts())
                log.warning("Supabase recusou um lote; tentando com %d item(ns) por vez", limit)
                delay = 2.0
            except Exception as exc:  # noqa: BLE001 - nunca derruba o agente
                failures += 1
                state.update(last_error=f"{type(exc).__name__}: {str(exc)[:150]}", last_error_at=now_ts())
                log.warning("sincronização falhou (%s); dados permanecem na fila local", type(exc).__name__)
                delay = min(settings.sync_interval_s * 2 ** min(failures, 5), 1800) * (0.8 + random.random() * 0.4)
            await asyncio.sleep(delay)
