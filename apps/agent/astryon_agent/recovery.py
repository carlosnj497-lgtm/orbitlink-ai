"""Entrega do código de recuperação de senha.

Canais, em ordem de preferência:
- **Telegram**: usa o bot que já envia os alertas (nenhum cadastro novo, nenhuma porta aberta).
- **E-mail** (SMTP): configurado em Configurações → Credenciais ou por `ASTRYON_SMTP_*`.

Sem canal configurado, a recuperação pela tela fica desligada de propósito e sobra o código do servidor.
Nenhuma senha trafega por aqui: só um código temporário, de uso único.
"""

from __future__ import annotations

import logging

import httpx

from . import mailer
from .auth import local
from .config import Settings

log = logging.getLogger(__name__)

TELEGRAM = "telegram"
EMAIL = "email"
_TIMEOUT_S = 15


class RecoveryError(RuntimeError):
    """Falha ao entregar o código. A mensagem é segura para mostrar na tela, sem detalhes do provedor."""


def telegram_ready(settings: Settings) -> bool:
    token = getattr(settings, "telegram_bot_token", None)
    chat = getattr(settings, "telegram_chat_id", None)
    return bool(token and chat and token.get_secret_value())


def channel(settings: Settings) -> str | None:
    """Canal ativo. O Telegram tem prioridade: não depende de SMTP nem de terceiros."""
    if telegram_ready(settings):
        return TELEGRAM
    if mailer.ready(settings):
        return EMAIL
    return None


def message(username: str, code: str) -> str:
    minutes = local.RESET_TTL_S // 60
    return (
        "Redefinição de senha do painel ASTRYON\n\n"
        f"Usuário: {username}\n"
        f"Código: {code[:4]}-{code[4:]}\n\n"
        f"Vale por {minutes} minutos e só pode ser usado uma vez. "
        'Digite-o na tela "Redefinir senha" junto com a senha nova.\n\n'
        "Se não foi você, ignore esta mensagem: a sua senha continua a mesma."
    )


def send_code(settings: Settings, username: str, code: str, *, email: str | None = None) -> str:
    """Entrega o código pelo canal ativo. Devolve o canal usado; levanta RecoveryError se falhar."""
    active = channel(settings)
    text = message(username, code)
    if active == TELEGRAM:
        _send_telegram(settings, text)
        return TELEGRAM
    if active == EMAIL and email:
        try:
            mailer.send_mail(settings, email, "Código para redefinir sua senha · ASTRYON", text)
        except mailer.MailerError as exc:
            raise RecoveryError(str(exc)) from exc
        return EMAIL
    raise RecoveryError("Nenhum canal de recuperação configurado.")


def _send_telegram(settings: Settings, text: str) -> None:
    token = settings.telegram_bot_token.get_secret_value() if settings.telegram_bot_token else ""
    chat = str(settings.telegram_chat_id or "")
    try:
        response = httpx.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat, "text": text, "disable_web_page_preview": True},
            timeout=_TIMEOUT_S,
        )
    except httpx.HTTPError as exc:
        log.warning("falha ao enviar código pelo Telegram: %s", exc)
        raise RecoveryError("Não foi possível enviar o código pelo Telegram agora.") from exc
    if response.status_code != 200:
        # O token nunca vai para o log.
        log.warning("Telegram recusou o envio do código (HTTP %s)", response.status_code)
        raise RecoveryError("Não foi possível enviar o código pelo Telegram agora.")
