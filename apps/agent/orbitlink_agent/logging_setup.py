"""Logs estruturados em JSON com correlation id e redação de segredos."""

from __future__ import annotations

import contextvars
import json
import logging
import re
import sys
from datetime import UTC, datetime

correlation_id: contextvars.ContextVar[str | None] = contextvars.ContextVar("correlation_id", default=None)

_REDACT = re.compile(r"(?i)(bearer\s+|token[\"'=:\s]+|api[_-]?key[\"'=:\s]+|password[\"'=:\s]+)([A-Za-z0-9._\-~+/=]{6,})")


_TELEGRAM = re.compile(r"/bot\d+:[A-Za-z0-9_-]+")
_GROQ = re.compile(r"\bgsk_[A-Za-z0-9]{8,}")  # chave da Groq em qualquer lugar do texto (ex.: corpo de erro, traceback)


def redact(text: str) -> str:
    text = _TELEGRAM.sub("/bot[redigido]", text)
    text = _GROQ.sub("gsk_[redigido]", text)
    return _REDACT.sub(lambda m: m.group(1) + "[redigido]", text)


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname.lower(),
            "logger": record.name,
            "msg": redact(record.getMessage()),
        }
        cid = correlation_id.get()
        if cid:
            payload["cid"] = cid
        if record.exc_info:
            payload["exc"] = redact(self.formatException(record.exc_info))[-2000:]
        for key in ("path", "status", "duration_ms", "method"):
            if hasattr(record, key):
                payload[key] = getattr(record, key)
        return json.dumps(payload, ensure_ascii=False)


def setup_logging(level: str = "INFO") -> None:
    root = logging.getLogger()
    if any(isinstance(h.formatter, JsonFormatter) for h in root.handlers):
        return
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(JsonFormatter())
    root.handlers = [handler]
    root.setLevel(level)
    logging.getLogger("uvicorn.access").disabled = True
    # httpx registra a URL de cada requisição em INFO; a do Telegram contém o token do bot
    for noisy in ("httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
