"""Transcrição de áudio (nota de voz) com Whisper via Groq.

O mesmo `ASTRYON_GROQ_API_KEY` do copiloto serve: a chave nunca sai do agente. A Groq reamostra o
áudio para 16 kHz mono antes de transcrever, então o Opus que o Telegram envia (`.ogg`) é aceito
direto, sem ffmpeg.

Limites e contabilidade:
* duração e tamanho máximos por áudio (configuráveis);
* cota diária própria (`ai_audio_daily_request_limit`), separada da cota de texto (que conta tokens);
* custo estimado registrado por hora de áudio — a Groq cobra no mínimo 10 s por requisição.

O áudio é enviado para a Groq e NÃO fica salvo em disco: só o texto transcrito entra no histórico
(com a mesma retenção das conversas de texto).
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from typing import Any

import httpx

from ..config import Settings
from ..storage.db import Database

log = logging.getLogger("astryon.transcribe")

GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
MIN_BILLED_SECONDS = 10  # a Groq cobra no mínimo 10 s por requisição
# USD por hora de áudio transcrito (modelos publicados pela Groq).
AUDIO_PRICING_USD_PER_HOUR: dict[str, float] = {"whisper-large-v3-turbo": 0.04, "whisper-large-v3": 0.111}

# Formatos aceitos pelo endpoint de áudio da Groq.
_MIME_EXT: dict[str, str] = {
    "audio/ogg": ".ogg",
    "audio/opus": ".ogg",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/mp4": ".m4a",
    "audio/m4a": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/x-pn-wav": ".wav",
    "audio/webm": ".webm",
    "audio/flac": ".flac",
    "audio/x-flac": ".flac",
}
_EXT_MIME: dict[str, str] = {
    ".ogg": "audio/ogg",
    ".oga": "audio/ogg",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".wav": "audio/wav",
    ".webm": "audio/webm",
    ".flac": "audio/flac",
}


class TranscriptionError(Exception):
    """O áudio não pôde ser transcrito (formato, serviço indisponível ou limite excedido)."""


def filename_for(mime: str | None, fallback: str | None = None) -> str:
    """Nome do arquivo no upload: a extensão vem do mime_type, não do nome do Telegram."""
    ext = _MIME_EXT.get((mime or "").lower().strip())
    if ext is None and fallback and "." in fallback:
        candidate = "." + fallback.rsplit(".", 1)[-1].lower()
        ext = candidate if candidate in _EXT_MIME else None
    return f"audio{ext or '.ogg'}"


def mime_for(filename: str) -> str:
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return _EXT_MIME.get(ext, "application/octet-stream")


def extension_from_path(file_path: str | None) -> str | None:
    """Extensão vinda do path do Telegram (ex.: `voice/file_1.oga`), quando ela serve."""
    if not file_path or "." not in file_path:
        return None
    ext = "." + file_path.rsplit(".", 1)[-1].lower()
    return ext if ext in _EXT_MIME else None


def _today() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%d")


def check_audio_quota(db: Database, settings: Settings) -> None:
    """Recusa o áudio antes de gastar (e antes de baixar o arquivo) quando a cota do dia acabou."""
    n = int(db.scalar("SELECT requests FROM ai_audio_usage_daily WHERE day = ?", (_today(),)) or 0)
    limit = int(getattr(settings, "ai_audio_daily_request_limit", 50))
    if n >= limit:
        raise PermissionError(f"Limite diário de {limit} áudios ao assistente atingido.")


def record_audio_usage(db: Database, settings: Settings, seconds: int) -> float:
    """Grava o uso e devolve o custo estimado em USD (mínimo de 10 s cobrados pela Groq)."""
    billed = max(int(seconds), MIN_BILLED_SECONDS)
    model = str(getattr(settings, "ai_transcribe_model", "whisper-large-v3-turbo"))
    cost = round(billed / 3600 * AUDIO_PRICING_USD_PER_HOUR.get(model, 0.0), 10)
    db.execute(
        """INSERT INTO ai_audio_usage_daily (day, requests, audio_seconds, estimated_cost_usd)
           VALUES (?, 1, ?, ?)
           ON CONFLICT(day) DO UPDATE SET requests = requests + 1,
             audio_seconds = audio_seconds + excluded.audio_seconds,
             estimated_cost_usd = estimated_cost_usd + excluded.estimated_cost_usd""",
        (_today(), billed, cost),
    )
    return cost


class Transcriber:
    """Cliente do endpoint de áudio da Groq (formato OpenAI, multipart)."""

    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.s = settings
        self._transport = transport

    @property
    def model(self) -> str:
        return str(getattr(self.s, "ai_transcribe_model", "whisper-large-v3-turbo"))

    def enabled(self) -> bool:
        key = getattr(self.s, "groq_api_key", None)
        return bool(getattr(self.s, "ai_transcribe_enabled", True) and key and key.get_secret_value())

    async def transcribe(self, data: bytes, mime: str | None = None, filename: str | None = None) -> str:
        key = getattr(self.s, "groq_api_key", None)
        if not key or not key.get_secret_value():
            raise TranscriptionError("chave da Groq ausente")
        if not data:
            raise TranscriptionError("áudio vazio")
        name = filename_for(mime, filename)
        form: dict[str, str] = {"model": self.model, "response_format": "json"}
        language = str(getattr(self.s, "ai_transcribe_language", "pt") or "").strip()
        if language:
            form["language"] = language
        timeout = float(getattr(self.s, "ai_transcribe_timeout_s", 60.0))
        async with httpx.AsyncClient(timeout=timeout, transport=self._transport) as http:
            r: httpx.Response | None = None
            for attempt in range(2):
                r = await http.post(
                    GROQ_TRANSCRIBE_URL,
                    headers={"Authorization": f"Bearer {key.get_secret_value()}"},
                    files={"file": (name, data, mime_for(name))},
                    data=form,
                )
                if r.status_code in (429, 500, 502, 503) and attempt == 0:
                    await asyncio.sleep(2.0)
                    continue
                break
        if r is None:
            raise TranscriptionError("sem resposta da Groq")
        if r.status_code >= 400:
            # O corpo do erro só vai para o log; o usuário recebe uma mensagem genérica.
            log.warning("Groq transcrição HTTP %s", r.status_code)
            raise TranscriptionError(f"HTTP {r.status_code}")
        try:
            body: dict[str, Any] = r.json() or {}
        except ValueError:
            raise TranscriptionError("resposta inválida da Groq") from None
        return str(body.get("text") or "").strip()
