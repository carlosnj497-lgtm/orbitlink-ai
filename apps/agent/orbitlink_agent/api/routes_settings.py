"""Configurações: leitura da configuração efetiva (sem segredos) e ajustes em tempo de execução."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from .. import __version__
from .deps import Admin, Ctx, User

router = APIRouter(prefix="/v1/settings", tags=["configuracoes"])

SECRET_FIELDS = {"api_token", "supabase_anon_key", "supabase_agent_token", "groq_api_key", "setup_code",
                 "telegram_bot_token", "telegram_chat_id", "healthcheck_url",
                 "mqtt_password"}
RUNTIME_KEYS = {"terminal_name", "usage_monthly_limit_gb", "usage_cycle_start_day", "show_mac_addresses",
                "weekly_digest_enabled", "weekly_digest_weekday", "weekly_digest_hour"}


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
    return public_settings(c)


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


def register(app: Any) -> None:
    async def start(ctx: Any) -> None:
        apply_overrides(ctx)

    app.state.startup_hooks.append(start)
