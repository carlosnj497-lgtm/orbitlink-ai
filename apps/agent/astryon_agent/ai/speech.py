"""Voz pt-BR via leitura online do Edge; MP3 em memória, sem arquivos temporários."""

from __future__ import annotations

import asyncio
import re
from typing import Any

import edge_tts

MAX_AUDIO_BYTES = 10 * 1024 * 1024

# Emojis e símbolos: o TTS lê o nome deles ("sinal de alerta", "satélite") e a frase perde o sentido.
_EMOJI = re.compile("[\U0001F000-\U0001FAFF☀-➿⬀-⯿←-⇿﻿‣⁉‼\ufe0f]")
# Etiquetas técnicas que o copiloto anexa ("Período: agora. Fonte: API local."): úteis na leitura,
# telegráficas na fala. Ficam só no texto escrito.
_TECH_FOOTER = re.compile(r"\b(?:Período|Fonte):\s*[^.;]*[.;]?\s*", re.IGNORECASE)


def spoken_text(text: str, limit: int) -> str:
    """Versão para fala: sem markdown, emojis ou etiquetas técnicas; listas viram frases corridas."""
    text = re.sub(r"```.*?```", " Trecho de código disponível na resposta escrita. ", text, flags=re.S)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"https?://\S+", " link disponível no texto ", text)
    text = re.sub(r"(?m)^\s*#{1,6}\s*", "", text)
    text = re.sub(r"[*_`]", "", text)
    text = _EMOJI.sub("", text)
    text = _TECH_FOOTER.sub("", text)
    text = re.sub(r"(?<=\d)\s*ms\b", " milissegundos", text)  # "35 ms" falado como sigla confunde
    text = re.sub(r"(?m)^\s*[-•]\s*", "", text)  # marcador de lista não se fala
    text = re.sub(r"(?<![.!?:;…])\n", ". ", text)  # linha sem pontuação vira fim de frase
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > limit:  # corta no fim de uma frase, não no meio de uma palavra
        cut = text[:limit]
        end = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
        cut = cut[:end + 1] if end > limit // 2 else cut.rsplit(" ", 1)[0] + "."
        text = cut + " A resposta completa está no texto."
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
