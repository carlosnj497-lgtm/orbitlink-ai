"""Pareamento do agente com a conta na nuvem por código curto (ex.: K7QF-2M9X).

O dono gera o código no painel na nuvem; aqui o agente troca o código pelo próprio token (RPC
claim_pairing_code) e o guarda protegido no banco local (DPAPI no Windows, Fernet no Linux). Assim ninguém
precisa copiar token nem editar .env. Um token definido em ASTRYON_SUPABASE_AGENT_TOKEN continua valendo e
tem prioridade (instalações antigas).
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx

from ..auth import secrets_store
from ..config import Settings
from ..storage.db import Database, now_ts

KV_TOKEN = "sync:agent_token"  # noqa: S105 - nome da chave no banco, não o segredo
KV_INFO = "sync:paired"


class PairingError(Exception):
    pass


def cloud_configured(settings: Settings) -> bool:
    return bool(settings.supabase_url and settings.supabase_anon_key)


def agent_token(db: Database, settings: Settings) -> str | None:
    if settings.supabase_agent_token:
        return settings.supabase_agent_token.get_secret_value()
    stored = db.get_kv(KV_TOKEN)
    if not stored:
        return None
    try:
        return secrets_store.unprotect(stored)
    except Exception:  # noqa: BLE001 - chave trocada ou banco copiado de outra máquina
        return None


def info(db: Database, settings: Settings) -> dict[str, Any]:
    raw = db.get_kv(KV_INFO)
    data = json.loads(raw) if raw else {}
    return {
        "cloud_configured": cloud_configured(settings),
        "paired": agent_token(db, settings) is not None,
        "via_env": bool(settings.supabase_agent_token),
        "workspace_name": data.get("workspace_name"),
        "agent_name": data.get("agent_name"),
        "paired_at": data.get("paired_at"),
    }


async def claim(db: Database, settings: Settings, code: str, agent_name: str | None = None,
                transport: httpx.AsyncBaseTransport | None = None) -> dict[str, Any]:
    if not cloud_configured(settings):
        raise PairingError("Nuvem não configurada: defina ASTRYON_SUPABASE_URL e ASTRYON_SUPABASE_ANON_KEY.")
    if not code or len("".join(ch for ch in code if ch.isalnum())) != 8:
        raise PairingError("O código tem 8 letras e números, como K7QF-2M9X.")
    assert settings.supabase_url and settings.supabase_anon_key
    anon = settings.supabase_anon_key.get_secret_value()
    url = settings.supabase_url.rstrip("/") + "/rest/v1/rpc/claim_pairing_code"
    async with httpx.AsyncClient(timeout=20, transport=transport) as http:
        try:
            r = await http.post(url, json={"p_code": code, "p_agent_name": agent_name or settings.terminal_name},
                                headers={"apikey": anon, "Authorization": f"Bearer {anon}"})
        except httpx.HTTPError as exc:
            raise PairingError(f"Sem conexão com a nuvem ({type(exc).__name__}). Confira a internet e tente de novo.") from exc
    if r.status_code >= 400:
        msg = ""
        try:
            msg = str(r.json().get("message") or "")
        except ValueError:
            pass
        if "inválido" in msg or "expirado" in msg or r.status_code in (400, 401, 403):
            raise PairingError("Código inválido, expirado ou já usado. Gere outro no painel da sua conta.")
        raise PairingError(f"A nuvem recusou o pareamento (HTTP {r.status_code}).")
    data: dict[str, Any] = r.json()
    token = str(data.get("agent_token") or "")
    if not token.startswith("olk_"):
        raise PairingError("Resposta inesperada da nuvem.")
    info_json = json.dumps({"workspace_name": data.get("workspace_name"), "agent_name": agent_name or settings.terminal_name,
                            "paired_at": now_ts()}, ensure_ascii=False)
    # Cifrar o token e gravar no SQLite fora do event loop.
    return await asyncio.to_thread(_store, db, settings, token, info_json)


def _store(db: Database, settings: Settings, token: str, info_json: str) -> dict[str, Any]:
    db.set_kv(KV_TOKEN, secrets_store.protect(token))
    db.set_kv(KV_INFO, info_json)
    return info(db, settings)


def unpair(db: Database) -> None:
    db.execute("DELETE FROM settings_kv WHERE key IN (?, ?)", (KV_TOKEN, KV_INFO))
