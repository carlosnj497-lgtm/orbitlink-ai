"""Configurações: leitura da configuração efetiva (sem segredos) e ajustes em tempo de execução."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import __version__
from ..auth.secrets_store import protect, unprotect
from .deps import Admin, Ctx, User

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/settings", tags=["configuracoes"])

SECRET_FIELDS = {"api_token", "supabase_anon_key", "supabase_agent_token", "groq_api_key", "setup_code",
                 "telegram_bot_token", "telegram_chat_id", "healthcheck_url",
                 # URLs de webhook (Slack, Discord...) levam o próprio segredo no caminho.
                 "alert_webhook_url", "mqtt_username", "mqtt_password", "telegram_allowed_user_ids",
                 # SMTP da recuperação de senha por e-mail (editável em Configurações → Credenciais).
                 "smtp_host", "smtp_port", "smtp_user", "smtp_password", "smtp_from", "smtp_security"}
RUNTIME_KEYS = {"terminal_name", "usage_monthly_limit_gb", "usage_cycle_start_day", "show_mac_addresses",
                "weekly_digest_enabled", "weekly_digest_weekday", "weekly_digest_hour",
                "ai_daily_request_limit", "ai_conversation_retention_days", "ai_audio_daily_request_limit",
                "ai_transcribe_enabled"}
# Ajustes da Central de IA que valem na hora: (mínimo, máximo) dos inteiros. Chave e modelo continuam no .env.
AI_INT_LIMITS = {"ai_daily_request_limit": (1, 10000), "ai_conversation_retention_days": (1, 3650),
                 "ai_audio_daily_request_limit": (0, 500)}

# Campos que, ao serem alterados, só afetam serviços recriados na inicialização do agente.
RESTART_REQUIRED_SECRETS = {"telegram_bot_token", "telegram_allowed_user_ids", "mqtt_username", "mqtt_password",
                          "supabase_anon_key", "supabase_agent_token"}


def _set_secret(settings: Any, key: str, value: str | None) -> None:
    field = type(settings).model_fields[key]
    if value is None:
        setattr(settings, key, None)
        return
    if field.annotation is int:
        setattr(settings, key, int(value))
    elif field.annotation is bool:
        setattr(settings, key, value.lower() in ("true", "1", "yes"))
    elif field.annotation is list[int]:
        setattr(settings, key, [int(x.strip()) for x in value.split(",") if x.strip().lstrip("-").isdigit()])
    else:
        setattr(settings, key, value)


def apply_secret_overrides(c: Any) -> None:
    """Sobrepõe segredos guardados cifrados no KV sobre os valores lidos do arquivo de ambiente."""
    for key in SECRET_FIELDS:
        stored = c.db.get_kv(f"secret:{key}")
        if stored is None:
            continue
        try:
            plain = unprotect(stored)
        except Exception as exc:
            # Segredo corrompido: ignora e deixa o valor original do .env (se houver).
            log.warning("ignorando segredo corrompido em %s: %s", key, exc)
            continue
        if plain == "":
            setattr(c.settings, key, None)
        else:
            _set_secret(c.settings, key, plain)


def public_settings(c: Any) -> dict[str, Any]:
    s = c.settings
    data = s.model_dump(mode="json", exclude=SECRET_FIELDS)
    data["data_dir"] = "<diretório de dados>"
    data["secrets_configured"] = {k: bool(getattr(s, k)) for k in sorted(SECRET_FIELDS)}
    data["runtime_overrides"] = {k: c.db.get_kv(f"setting:{k}") for k in sorted(RUNTIME_KEYS)}
    data["version"] = __version__
    return dict(data)


@router.get("")
def get_settings(c: Ctx, _u: User) -> dict[str, Any]:
    return public_settings(c)


class RuntimeSettings(BaseModel):
    terminal_name: str | None = Field(default=None, min_length=1, max_length=60)
    usage_monthly_limit_gb: float | None = Field(default=None, ge=0, le=100000)  # 0 remove a franquia
    usage_cycle_start_day: int | None = Field(default=None, ge=1, le=28)
    show_mac_addresses: bool | None = None
    weekly_digest_enabled: bool | None = None
    weekly_digest_weekday: int | None = Field(default=None, ge=0, le=6)
    weekly_digest_hour: int | None = Field(default=None, ge=0, le=23)
    ai_daily_request_limit: int | None = Field(default=None, ge=1, le=10000)
    ai_conversation_retention_days: int | None = Field(default=None, ge=1, le=3650)
    ai_audio_daily_request_limit: int | None = Field(default=None, ge=0, le=500)
    ai_transcribe_enabled: bool | None = None


@router.put("")
def put_settings(c: Ctx, _a: Admin, body: RuntimeSettings) -> dict[str, Any]:
    for k, v in body.model_dump(exclude_none=True).items():
        c.db.set_kv(f"setting:{k}", str(v))
        if k == "weekly_digest_enabled":
            c.settings.weekly_digest_enabled = bool(v)
        if k in ("weekly_digest_weekday", "weekly_digest_hour"):
            setattr(c.settings, k, int(v))
        if k == "terminal_name":
            c.settings.terminal_name = str(v)
        if k == "show_mac_addresses":
            c.settings.show_mac_addresses = bool(v)
        if k == "usage_monthly_limit_gb":
            c.settings.usage_monthly_limit_gb = float(v) if v else None
        if k == "usage_cycle_start_day":
            c.settings.usage_cycle_start_day = int(v)
        if k in AI_INT_LIMITS:
            setattr(c.settings, k, int(v))
        if k == "ai_transcribe_enabled":
            c.settings.ai_transcribe_enabled = bool(v)
    return public_settings(c)


class CredentialsInput(BaseModel):
    credentials: dict[str, str | None]


@router.put("/credentials")
def put_credentials(c: Ctx, _a: Admin, body: CredentialsInput) -> dict[str, Any]:
    """Atualiza segredos cifrando-os no banco KV. Os valores nunca retornam ao navegador."""
    restart_required: set[str] = set()
    for key, value in body.credentials.items():
        if key not in SECRET_FIELDS:
            raise HTTPException(422, f"Campo não permitido: {key}")
        kv_key = f"secret:{key}"
        if value is None or value.strip() == "":
            c.db.set_kv(kv_key, "")
            setattr(c.settings, key, None)
        else:
            c.db.set_kv(kv_key, protect(value.strip()))
            _set_secret(c.settings, key, value.strip())
        if key in RESTART_REQUIRED_SECRETS:
            restart_required.add(key)
    data = public_settings(c)
    data["restart_required"] = sorted(restart_required)
    return data


def apply_overrides(c: Any) -> None:
    name = c.db.get_kv("setting:terminal_name")
    if name:
        c.settings.terminal_name = name
    mac = c.db.get_kv("setting:show_mac_addresses")
    if mac is not None:
        c.settings.show_mac_addresses = mac == "True"
    cap = c.db.get_kv("setting:usage_monthly_limit_gb")
    if cap is not None:
        try:
            c.settings.usage_monthly_limit_gb = float(cap) or None
        except ValueError:
            pass
    day = c.db.get_kv("setting:usage_cycle_start_day")
    if day and day.isdigit() and 1 <= int(day) <= 28:
        c.settings.usage_cycle_start_day = int(day)
    dig = c.db.get_kv("setting:weekly_digest_enabled")
    if dig is not None:
        c.settings.weekly_digest_enabled = dig == "True"
    for key, hi in (("weekly_digest_weekday", 6), ("weekly_digest_hour", 23)):
        v = c.db.get_kv(f"setting:{key}")
        if v and v.isdigit() and 0 <= int(v) <= hi:
            setattr(c.settings, key, int(v))
    for key, (lo, hi) in AI_INT_LIMITS.items():
        v = c.db.get_kv(f"setting:{key}")
        if v and v.isdigit() and lo <= int(v) <= hi:
            setattr(c.settings, key, int(v))
    audio = c.db.get_kv("setting:ai_transcribe_enabled")
    if audio is not None:
        c.settings.ai_transcribe_enabled = audio == "True"


def register(app: Any) -> None:
    async def start(ctx: Any) -> None:
        apply_overrides(ctx)
        apply_secret_overrides(ctx)

    app.state.startup_hooks.append(start)
