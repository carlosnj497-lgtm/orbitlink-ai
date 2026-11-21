"""Rotas de autenticação local (chamadas somente pelo servidor Next)."""

from __future__ import annotations

import hmac
import logging
import threading
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field

from .. import mailer, recovery
from ..auth import local
from ..config import Settings
from .deps import Ctx, User, require_service

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/auth", tags=["auth"], dependencies=[Depends(require_service)])


class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_.\-]+$")
    password: str = Field(min_length=1, max_length=256)


class SetupBody(Credentials):
    setup_code: str | None = Field(default=None, max_length=64)
    # Cadastrado no primeiro acesso: é para cá que vão os códigos de recuperação.
    email: str | None = Field(default=None, max_length=200)


class PasswordChange(BaseModel):
    old_password: str = Field(max_length=256)
    new_password: str = Field(min_length=local.MIN_PASSWORD_LEN, max_length=256)


class RecoveryReset(BaseModel):
    username: str = Field(min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_.\-]+$")
    new_password: str = Field(min_length=local.MIN_PASSWORD_LEN, max_length=256)
    recovery_code: str | None = Field(default=None, max_length=64)


class RecoveryRequest(BaseModel):
    # Só o canal de e-mail usa o endereço; o Telegram vai para o chat já configurado.
    email: str | None = Field(default=None, max_length=200)


class RecoveryConfirm(BaseModel):
    email: str | None = Field(default=None, max_length=200)
    code: str = Field(min_length=1, max_length=32)
    new_password: str = Field(min_length=local.MIN_PASSWORD_LEN, max_length=256)


class EmailChange(BaseModel):
    email: str = Field(min_length=3, max_length=200)


def _welcome_text(username: str) -> str:
    return (
        f"Olá, {username}.\n\n"
        "Este endereço foi cadastrado como contato de recuperação do painel ASTRYON.\n\n"
        "Quando você esquecer a senha, use a opção \"Esqueci a senha\" na tela de login: "
        "enviaremos um código temporário para cá. O código vale por 15 minutos, serve uma única vez "
        "e nenhuma senha é enviada por e-mail.\n\n"
        "Se você não reconhece este cadastro, ignore esta mensagem.\n"
    )


def _send_welcome(settings: Settings, address: str, username: str) -> None:
    """Aviso de boas-vindas em segundo plano: SMTP fora do ar não pode impedir a criação do administrador."""
    try:
        mailer.send_mail(settings, address, "Recuperação de senha ativada · ASTRYON", _welcome_text(username))
    except mailer.MailerError as exc:
        log.warning("e-mail de boas-vindas não enviado: %s", exc)


def client_ip(x_forwarded_for: str | None) -> str:
    """IP do cliente segundo o último salto confiável.

    O primeiro item do X-Forwarded-For é escolhido pelo próprio cliente; o último é o que o proxy à nossa
    frente (Nginx/Next) acrescentou e não pode ser forjado por quem está do outro lado.
    """
    parts = [p.strip() for p in (x_forwarded_for or "").split(",") if p.strip()]
    return parts[-1] if parts else ""


@router.get("/state")
def auth_state(c: Ctx) -> dict[str, object]:
    from .. import __version__
    channel = recovery.channel(c.settings)
    return {"setup_required": not local.has_users(c.db), "mode": "local",
            "setup_code_required": bool(c.settings.setup_code),
            "email_recovery": channel == recovery.EMAIL,
            "recovery_channel": channel,
            "supabase_configured": bool(c.settings.supabase_url),
            "version": __version__}


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
    # Só o canal de e-mail depende do endereço; com Telegram configurado o cadastro do e-mail é opcional.
    if recovery.channel(c.settings) == recovery.EMAIL and not (body.email or "").strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                            "Informe um e-mail para recuperação de senha.")
    try:
        uid = local.setup_admin(c.db, body.username, body.password, body.email)
    except PermissionError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    if body.email and mailer.ready(c.settings):
        address = local.normalize_email(body.email)
        threading.Thread(target=_send_welcome, args=(c.settings, address, body.username), daemon=True).start()
    return {"user_id": uid}


@router.post("/recover/request", status_code=204)
def request_recovery(c: Ctx, body: RecoveryRequest,
                     x_forwarded_for: Annotated[str | None, Header()] = None) -> None:
    """Envia um código temporário pelo canal ativo (Telegram ou e-mail).

    No e-mail, responde 204 mesmo quando o endereço não existe, para não revelar quais têm conta. Um pedido novo
    invalida o código anterior; o limite por IP e por endereço impede bombardeio de mensagens.
    """
    active = recovery.channel(c.settings)
    if active is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "Recuperação não configurada. Configure o Telegram ou o SMTP em Configurações → "
                            "Credenciais; ou use o código do servidor.")
    email = (body.email or "").strip().lower()
    if active == recovery.EMAIL and not email:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Informe o e-mail cadastrado na conta.")
    key_suffix = email if active == recovery.EMAIL else "telegram"
    if (not c.login_limiter.allow(f"recover-ip:{client_ip(x_forwarded_for)}")
            or not c.user_login_limiter.allow(f"recover-target:{key_suffix}")):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Muitas tentativas. Aguarde alguns minutos.")
    username: str
    address: str | None
    if active == recovery.TELEGRAM:
        found = local.request_telegram_reset(c.db)
        if found is None:
            return
        username, code = found
        address = None
    else:
        result = local.request_password_reset(c.db, email)
        if result is None:
            return
        username, address, code = result
    try:
        recovery.send_code(c.settings, username, code, email=address)
    except recovery.RecoveryError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


@router.post("/recover/confirm", status_code=204)
def confirm_recovery(c: Ctx, body: RecoveryConfirm,
                     x_forwarded_for: Annotated[str | None, Header()] = None) -> None:
    ip_key = f"recover-confirm-ip:{client_ip(x_forwarded_for)}"
    if not c.login_limiter.allow(ip_key):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Muitas tentativas. Aguarde alguns minutos.")
    try:
        if (body.email or "").strip():
            local.confirm_password_reset(c.db, body.email or "", body.code, body.new_password)
        else:
            local.confirm_telegram_reset(c.db, body.code, body.new_password)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


@router.post("/email", status_code=204)
def change_email(c: Ctx, user: User, body: EmailChange) -> None:
    try:
        local.set_email(c.db, user["id"], body.email)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


@router.post("/recover", status_code=204)
def recover(c: Ctx, body: RecoveryReset) -> None:
    """Redefine a senha local a partir do código de recuperação (o mesmo segredo exigido no primeiro acesso).

    O código é obrigatório mesmo em loopback: o painel é publicado pelo Nginx e toda chamada chega ao agente
    vinda de 127.0.0.1, então o IP não distingue o dono de alguém da LAN. Sem `ASTRYON_SETUP_CODE` a
    redefinição pela tela fica desligada de propósito.
    """
    expected = c.settings.setup_code.get_secret_value() if c.settings.setup_code else None
    if not expected:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "Redefinição pela tela desativada: defina ASTRYON_SETUP_CODE no servidor e reinicie "
                            "o agente. No Linux: sudo cat /etc/astryon/setup-code")
    if not c.login_limiter.allow("recover"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Muitas tentativas. Aguarde alguns minutos.")
    if not body.recovery_code or not hmac.compare_digest(body.recovery_code.strip().encode(), expected.encode()):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Código de recuperação inválido.")
    try:
        local.reset_password(c.db, body.username, body.new_password)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


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
    return {"id": user["id"], "username": user["username"], "role": user["role"], "email": user.get("email"),
            "expires_at": user["expires_at"]}


@router.post("/password", status_code=204)
def change_password(c: Ctx, user: User, body: PasswordChange) -> None:
    try:
        local.change_password(c.db, user["id"], body.old_password, body.new_password)
    except PermissionError as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc
