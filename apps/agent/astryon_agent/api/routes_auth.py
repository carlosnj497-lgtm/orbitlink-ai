"""Rotas de autenticação local (chamadas somente pelo servidor Next)."""

from __future__ import annotations

import hmac
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field

from ..auth import local
from .deps import Ctx, User, require_service

router = APIRouter(prefix="/v1/auth", tags=["auth"], dependencies=[Depends(require_service)])


class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_.\-]+$")
    password: str = Field(min_length=1, max_length=256)


class SetupBody(Credentials):
    setup_code: str | None = Field(default=None, max_length=64)


class PasswordChange(BaseModel):
    old_password: str = Field(max_length=256)
    new_password: str = Field(min_length=local.MIN_PASSWORD_LEN, max_length=256)


def client_ip(x_forwarded_for: str | None) -> str:
    """IP do cliente segundo o último salto confiável.

    O primeiro item do X-Forwarded-For é escolhido pelo próprio cliente; o último é o que o proxy à nossa
    frente (Nginx/Next) acrescentou e não pode ser forjado por quem está do outro lado.
    """
    parts = [p.strip() for p in (x_forwarded_for or "").split(",") if p.strip()]
    return parts[-1] if parts else ""


@router.get("/state")
def auth_state(c: Ctx) -> dict[str, object]:
    return {"setup_required": not local.has_users(c.db), "mode": "local",
            "setup_code_required": bool(c.settings.setup_code),
            "supabase_configured": bool(c.settings.supabase_url)}


@router.post("/setup", status_code=201)
def setup(c: Ctx, body: SetupBody) -> dict[str, object]:
    # O agente só é chamado pelo servidor Next (sempre em loopback), então o IP do socket não diz nada sobre
    # quem abriu o painel. Quando o painel pode ser acessado pela rede, o código de configuração é obrigatório.
    expected = c.settings.setup_code.get_secret_value() if c.settings.setup_code else None
    if not expected and (c.settings.allow_lan or c.settings.appliance):
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "Defina ASTRYON_SETUP_CODE para criar o administrador quando o painel é acessível "
                            "pela rede.")
    if expected:
        if not c.login_limiter.allow("setup"):
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Muitas tentativas. Aguarde alguns minutos.")
        if not body.setup_code or not hmac.compare_digest(body.setup_code.strip().encode(), expected.encode()):
            raise HTTPException(status.HTTP_403_FORBIDDEN,
                                "Código de configuração inválido. No servidor: sudo cat /etc/astryon/setup-code")
    try:
        uid = local.setup_admin(c.db, body.username, body.password)
    except PermissionError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    return {"user_id": uid}


@router.post("/login")
def login(c: Ctx, body: Credentials, user_agent: Annotated[str | None, Header()] = None,
          x_forwarded_for: Annotated[str | None, Header()] = None) -> dict[str, object]:
    key = f"login:{client_ip(x_forwarded_for)}:{body.username}"
    user_key = f"login-user:{body.username}"
    if not c.login_limiter.allow(key) or not c.user_login_limiter.allow(user_key):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Muitas tentativas. Aguarde alguns minutos.")
    res = local.login(c.db, body.username, body.password, user_agent)
    if res is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuário ou senha incorretos")
    c.login_limiter.reset(key)
    c.user_login_limiter.reset(user_key)  # só falhas contam: abrir o painel em vários aparelhos não bloqueia ninguém
    token, expires = res
    return {"session": token, "expires_at": expires}


@router.post("/logout", status_code=204)
def logout(c: Ctx, x_astryon_session: Annotated[str | None, Header()] = None) -> None:
    if x_astryon_session:
        local.logout(c.db, x_astryon_session)


@router.get("/me")
def me(user: User) -> dict[str, object]:
    return {"id": user["id"], "username": user["username"], "role": user["role"], "expires_at": user["expires_at"]}


@router.post("/password", status_code=204)
def change_password(c: Ctx, user: User, body: PasswordChange) -> None:
    try:
        local.change_password(c.db, user["id"], body.old_password, body.new_password)
    except PermissionError as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc
