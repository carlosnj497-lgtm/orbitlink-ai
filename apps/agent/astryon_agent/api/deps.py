"""Dependências da API: contexto, autenticação de serviço (Next→agente) e de usuário."""

from __future__ import annotations

import hmac
from dataclasses import dataclass, field
from typing import Annotated, Any

from fastapi import Depends, Header, HTTPException, Request, status

from ..auth.local import RateLimiter, validate_session
from ..collector.bus import EventBus
from ..collector.service import Collector
from ..config import Settings
from ..storage.db import Database


@dataclass
class AppContext:
    settings: Settings
    db: Database
    bus: EventBus
    collector: Collector | None
    extras: dict[str, Any] = field(default_factory=dict)
    login_limiter: RateLimiter = field(default_factory=lambda: RateLimiter(5, 300))
    # Limite global por nome de usuário, independente do IP: impede força bruta trocando o X-Forwarded-For.
    user_login_limiter: RateLimiter = field(default_factory=lambda: RateLimiter(20, 900))
    api_limiter: RateLimiter = field(default_factory=lambda: RateLimiter(600, 60))


def ctx(request: Request) -> AppContext:
    c: AppContext = request.app.state.ctx
    return c


Ctx = Annotated[AppContext, Depends(ctx)]


def require_service(c: Ctx, authorization: Annotated[str | None, Header()] = None) -> None:
    """Toda chamada vem do servidor Next (ou CLI) com o token do agente. O navegador nunca o vê."""
    token = c.settings.api_token.get_secret_value() if c.settings.api_token else None
    if not token:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "ASTRYON_API_TOKEN não configurado. Execute scripts\\install.ps1.")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token de serviço ausente")
    if not hmac.compare_digest(authorization[7:].encode(), token.encode()):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token de serviço inválido")


def require_user(
    c: Ctx,
    _svc: Annotated[None, Depends(require_service)],
    x_astryon_session: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    user = validate_session(c.db, x_astryon_session)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessão inválida ou expirada")
    if not c.api_limiter.allow(f"user:{user['id']}"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Muitas requisições")
    return user


User = Annotated[dict[str, Any], Depends(require_user)]


def require_admin(user: User) -> dict[str, Any]:
    if user.get("role") != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Requer perfil administrador")
    return user


Admin = Annotated[dict[str, Any], Depends(require_admin)]
