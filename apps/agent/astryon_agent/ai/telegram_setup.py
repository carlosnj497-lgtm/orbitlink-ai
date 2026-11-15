"""Publica a apresentação do bot: python -m astryon_agent.ai.telegram_setup."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx

from ..config import Settings
from .telegram_views import COMMANDS

NAME = "ASTRYON · Assistente Starlink"
DESCRIPTION = (
    "🛰 ASTRYON · Sua Starlink, acompanhada de perto.\n\n"
    "Consulte conexão, consumo estimado, franquia, qualidade, quedas e alertas. "
    "Use os botões ou converse em português por texto e nota de voz. "
    "Receba respostas em texto e áudio; ajuste com /audio.\n\n"
    "Comece com /menu. Consultas diretas não gastam a cota de IA.\n\n"
    "Acesso restrito ao chat autorizado. Recursos dependem da configuração do agente.\n"
    "Projeto independente, sem afiliação com a Starlink ou SpaceX."
)
SHORT_DESCRIPTION = "🛰 ASTRYON: conexão, consumo, qualidade e alertas da sua Starlink. Assistente independente com texto e voz."


async def configure(settings: Settings) -> None:
    if not settings.telegram_bot_token or not settings.telegram_chat_id:
        raise ValueError("Configure o token e o chat do Telegram no agente.")
    base = "https://api.telegram.org/bot" + settings.telegram_bot_token.get_secret_value()
    async with httpx.AsyncClient(timeout=20) as client:
        async def call(method: str, payload: dict[str, Any]) -> Any:
            response = await client.post(f"{base}/{method}", json=payload)
            body = response.json()
            if not response.is_success or not body.get("ok"):
                # Nunca imprime URL, token ou corpo de erro do provedor.
                raise RuntimeError(f"{method}: falha na API (HTTP {response.status_code})")
            return body.get("result")

        commands = [{"command": key, "description": value} for key, value in COMMANDS.items()]
        # Português e fallback: a identidade fica consistente em clientes com outros idiomas.
        for language in ("", "pt"):
            for method, payload in (
                ("setMyName", {"name": NAME}),
                ("setMyDescription", {"description": DESCRIPTION}),
                ("setMyShortDescription", {"short_description": SHORT_DESCRIPTION}),
            ):
                await call(method, {**payload, "language_code": language})
            for scope in ({"type": "default"}, {"type": "chat", "chat_id": settings.telegram_chat_id}):
                await call("setMyCommands", {"commands": commands, "scope": scope, "language_code": language})
        await call("setChatMenuButton", {"menu_button": {"type": "commands"}})
        await call("setChatMenuButton", {
            "chat_id": settings.telegram_chat_id, "menu_button": {"type": "commands"},
        })
        for language in ("", "pt"):
            for method, expected in (
                ("getMyName", {"name": NAME}),
                ("getMyDescription", {"description": DESCRIPTION}),
                ("getMyShortDescription", {"short_description": SHORT_DESCRIPTION}),
            ):
                if await call(method, {"language_code": language}) != expected:
                    raise RuntimeError(f"{method}: a configuração publicada diverge da esperada")
            for scope in ({"type": "default"}, {"type": "chat", "chat_id": settings.telegram_chat_id}):
                if await call("getMyCommands", {"scope": scope, "language_code": language}) != commands:
                    raise RuntimeError("O menu publicado diverge do esperado")
        me = await call("getMe", {})
        print(json.dumps({"ok": True, "username": me["username"], "name": me["first_name"],
                          "commands": len(commands), "languages": ["default", "pt"]}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        asyncio.run(configure(Settings()))
    except Exception as exc:
        # Exceções HTTP podem conter a URL autenticada.
        print(f"Não foi possível concluir a configuração ({type(exc).__name__}).")
        raise SystemExit(1) from None
