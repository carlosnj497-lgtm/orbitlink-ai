"""Envio de e-mail por SMTP (recuperação de senha no modo local).

Sem servidor configurado nada é enviado: a recuperação por e-mail simplesmente fica desligada e a tela
mostra o caminho alternativo. Nenhuma credencial SMTP é exposta ao navegador.
"""

from __future__ import annotations

import logging
import smtplib
import ssl
from email.message import EmailMessage

from .config import Settings

log = logging.getLogger(__name__)

TIMEOUT_S = 20


class MailerError(RuntimeError):
    """Falha ao entregar o e-mail. A mensagem é segura para mostrar ao usuário (sem detalhes do servidor)."""


def ready(settings: Settings) -> bool:
    """True quando há servidor e remetente: é o que liga a recuperação por e-mail na tela."""
    return bool(settings.smtp_host and settings.smtp_from)


def send_mail(settings: Settings, to: str, subject: str, text: str) -> None:
    if not ready(settings):
        raise MailerError("Envio de e-mail não configurado no servidor.")
    to = to.strip()
    if not to or any(ch in to for ch in "\r\n"):
        raise MailerError("Endereço de e-mail inválido.")
    msg = EmailMessage()
    msg["From"] = settings.smtp_from or ""
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)

    host = (settings.smtp_host or "").strip()
    port = int(settings.smtp_port or (465 if settings.smtp_security == "ssl" else 587))
    security = (settings.smtp_security or "starttls").strip().lower()
    context = ssl.create_default_context()
    try:
        if security == "ssl":
            smtp: smtplib.SMTP = smtplib.SMTP_SSL(host, port, timeout=TIMEOUT_S, context=context)
        else:
            smtp = smtplib.SMTP(host, port, timeout=TIMEOUT_S)
        with smtp:
            smtp.ehlo()
            if security == "starttls":
                smtp.starttls(context=context)
                smtp.ehlo()
            if settings.smtp_user and settings.smtp_password:
                smtp.login(settings.smtp_user, settings.smtp_password.get_secret_value())
            smtp.send_message(msg)
    except (OSError, smtplib.SMTPException) as exc:
        # O detalhe fica no log do agente; a tela recebe uma mensagem curta e sem credenciais.
        log.warning("falha ao enviar e-mail para %s: %s", to, exc)
        raise MailerError("Não foi possível enviar o e-mail agora. Confira as configurações de SMTP.") from exc
