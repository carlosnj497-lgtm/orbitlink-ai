"""Voz pt-BR via leitura online do Edge; MP3 em memória, sem arquivos temporários."""

from __future__ import annotations

import asyncio
import re
from typing import Any

import edge_tts

MAX_AUDIO_BYTES = 10 * 1024 * 1024


def spoken_text(text: str, limit: int) -> str:
    text = re.sub(r"```.*?```", " Trecho de código disponível na resposta escrita. ", text, flags=re.S)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"https?://\S+", " link disponível no texto ", text)
    text = re.sub(r"(?m)^\s*#{1,6}\s*", "", text)
    text = re.sub(r"[*_`]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > limit:
        text = text[:limit].rsplit(" ", 1)[0] + ". A resposta completa está no texto."
    return text


class Speaker:
    def __init__(self, settings: Any) -> None:
        self.settings = settings

    async def synthesize(self, text: str) -> bytes:
        text = spoken_text(text, self.settings.ai_tts_max_chars)
        if not text:
            raise ValueError("resposta vazia")
        async with asyncio.timeout(self.settings.ai_tts_timeout_s):
            stream = edge_tts.Communicate(text, self.settings.ai_tts_voice)
            audio = bytearray()
            async for chunk in stream.stream():
                if chunk["type"] == "audio":
                    audio.extend(chunk["data"])
                    if len(audio) > MAX_AUDIO_BYTES:
                        raise ValueError("áudio excedeu o limite")
        if not audio:
            raise ValueError("serviço não retornou áudio")
        return bytes(audio)
