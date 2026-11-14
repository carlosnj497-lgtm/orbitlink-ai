"""Entrega de notificações de alerta (webhook genérico e Telegram) com fila persistente e reenvio.

- Cada alerta disparado ou resolvido vira uma linha por canal em `notification_outbox`.
- A entrega tenta de novo com backoff exponencial; se a internet estiver fora (caso típico de "antena inacessível"),
  a mensagem sai quando a conexão volta, marcada com o horário original do evento.
- Erros permanentes (4xx exceto 429) e mensagens mais velhas que `notification_max_age_h` são descartados.
- O token do bot nunca é gravado na fila, em `last_error` nem nos logs.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from ..storage.db import Database, now_ts

log = logging.getLogger("orbitlink.notify")

SEVERITY_LABEL = {"info": "Informação", "warn": "Atenção", "crit": "Crítico"}
SEVERITY_ICON = {"info": "ℹ️", "warn": "⚠️", "crit": "🚨"}
LATE_AFTER_S = 120
BATCH = 20
DIGEST_MAX = 4000  # o Telegram aceita 4096 caracteres por mensagem


class PermanentError(Exception):
    """Erro que não melhora com nova tentativa (token inválido, chat inexistente, URL recusada)."""


class Notifier:
    def __init__(self, db: Database, settings: Any, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.db = db
        self.settings = settings
        self._transport = transport

    # ------------------------------------------------------------------ configuração
    def _telegram(self) -> tuple[str, str] | None:
        tok = getattr(self.settings, "telegram_bot_token", None)
        chat = getattr(self.settings, "telegram_chat_id", None)
        if tok and chat and tok.get_secret_value():
            return tok.get_secret_value(), str(chat)
        return None

    def channels(self) -> dict[str, bool]:
        return {"webhook": bool(getattr(self.settings, "alert_webhook_url", None)), "telegram": self._telegram() is not None}

    # ------------------------------------------------------------------ fila
    def enqueue(self, event: dict[str, Any]) -> int:
        """Grava o evento para cada canal ativo. Síncrono: pode ser chamado de dentro da avaliação de alertas."""
        payload = {
            "status": event.get("status", "active"),
            "severity": event.get("severity", "warn"),
            "message": str(event.get("message", ""))[:1000],
            "rule_id": event.get("rule_id"),
            "event_ts": int(event.get("ts") or now_ts()),
        }
        ts = now_ts()
        n = 0
        for channel, on in self.channels().items():
            if on:
                self.db.execute("INSERT INTO notification_outbox (channel, payload_json, created_at, next_attempt_at) "
                                "VALUES (?, ?, ?, ?)", (channel, json.dumps(payload, ensure_ascii=False), ts, ts))
                n += 1
        return n

    def enqueue_digest(self, text: str) -> int:
        """Resumo periódico: só Telegram (o webhook recebe apenas alertas). Também passa pela fila e pelo reenvio."""
        if not self.channels()["telegram"]:
            return 0
        ts = now_ts()
        payload = {"status": "digest", "severity": "info", "message": text[:DIGEST_MAX], "rule_id": None, "event_ts": ts}
        self.db.execute("INSERT INTO notification_outbox (channel, payload_json, created_at, next_attempt_at) "
                        "VALUES ('telegram', ?, ?, ?)", (json.dumps(payload, ensure_ascii=False), ts, ts))
        return 1

    async def send_digest_now(self, text: str) -> dict[str, Any]:
        """Envia um resumo agora, fora da fila (botão do painel). Devolve {"ok": bool, "error"?: str}."""
        payload = {"status": "digest", "severity": "info", "message": text[:DIGEST_MAX], "rule_id": None,
                   "event_ts": now_ts()}
        async with self._client() as client:
            try:
                await self._send(client, "telegram", payload)
                return {"ok": True}
            except (PermanentError, RetryLater) as exc:
                return {"ok": False, "error": str(exc)[:300]}
            except httpx.HTTPError as exc:
                return {"ok": False, "error": f"sem conexão ({type(exc).__name__})"}

    async def deliver_due(self) -> int:
        """Tenta entregar o que está vencido. Devolve quantas mensagens saíram."""
        now = now_ts()
        max_age = int(getattr(self.settings, "notification_max_age_h", 24)) * 3600
        self.db.execute("UPDATE notification_outbox SET failed_at=?, last_error=COALESCE(last_error, 'expirada') "
                        "WHERE sent_at IS NULL AND failed_at IS NULL AND created_at < ?", (now, now - max_age))
        rows = self.db.query("SELECT * FROM notification_outbox WHERE sent_at IS NULL AND failed_at IS NULL "
                             "AND next_attempt_at <= ? ORDER BY id LIMIT ?", (now, BATCH))
        if not rows:
            return 0
        sent = 0
        async with self._client() as client:
            for r in rows:
                payload = json.loads(r["payload_json"])
                try:
                    await self._send(client, r["channel"], payload)
                except PermanentError as exc:
                    self.db.execute("UPDATE notification_outbox SET attempts=attempts+1, failed_at=?, last_error=? WHERE id=?",
                                    (now_ts(), str(exc)[:300], r["id"]))
                    log.warning("notificação %s descartada: %s", r["channel"], exc)
                except (httpx.HTTPError, RetryLater) as exc:
                    attempts = r["attempts"] + 1
                    wait = exc.after if isinstance(exc, RetryLater) else min(3600, 30 * 2 ** min(attempts, 7))
                    err = str(exc) if isinstance(exc, RetryLater) else type(exc).__name__
                    self.db.execute("UPDATE notification_outbox SET attempts=?, next_attempt_at=?, last_error=? WHERE id=?",
                                    (attempts, now_ts() + wait, err[:300], r["id"]))
                    if isinstance(exc, httpx.TransportError):
                        break  # sem conexão: não adianta tentar as demais agora
                else:
                    self.db.execute("UPDATE notification_outbox SET attempts=attempts+1, sent_at=?, last_error=NULL WHERE id=?",
                                    (now_ts(), r["id"]))
                    sent += 1
        return sent

    async def send_test(self) -> dict[str, dict[str, Any]]:
        """Envia uma mensagem de teste agora, sem passar pela fila, e devolve o resultado por canal."""
        payload = {"status": "test", "severity": "info", "message": "Mensagem de teste do OrbitLink AI. Se chegou, as "
                   "notificações de alerta estão funcionando.", "rule_id": None, "event_ts": now_ts()}
        out: dict[str, dict[str, Any]] = {}
        async with self._client() as client:
            for channel, on in self.channels().items():
                if not on:
                    continue
                try:
                    await self._send(client, channel, payload)
                    out[channel] = {"ok": True}
                except (PermanentError, RetryLater) as exc:
                    out[channel] = {"ok": False, "error": str(exc)[:300]}
                except httpx.HTTPError as exc:
                    out[channel] = {"ok": False, "error": f"sem conexão ({type(exc).__name__})"}
        return out

    def status(self) -> dict[str, Any]:
        q = self.db.one(
            """SELECT SUM(sent_at IS NULL AND failed_at IS NULL) AS pending,
                      SUM(failed_at IS NOT NULL AND failed_at >= :d) AS failed_24h,
                      MAX(sent_at) AS last_sent_at
               FROM notification_outbox""", {"d": now_ts() - 86400}) or {}
        last_err = self.db.one("SELECT channel, last_error, COALESCE(failed_at, next_attempt_at) AS at FROM notification_outbox "
                               "WHERE last_error IS NOT NULL AND sent_at IS NULL ORDER BY id DESC LIMIT 1")
        return {"channels": self.channels(), "pending": int(q.get("pending") or 0), "failed_24h": int(q.get("failed_24h") or 0),
                "last_sent_at": q.get("last_sent_at"), "last_error": last_err}

    # ------------------------------------------------------------------ envio
    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=10, transport=self._transport)

    def _text(self, p: dict[str, Any]) -> str:
        if p["status"] == "digest":
            return str(p["message"])  # já formatado e com o período; atraso não muda o conteúdo
        tz = ZoneInfo(getattr(self.settings, "timezone", "UTC"))
        when = datetime.fromtimestamp(p["event_ts"], tz).strftime("%d/%m %H:%M")
        name = getattr(self.settings, "terminal_name", "Starlink")
        if p["status"] == "resolved":
            head = f"✅ Resolvido — {name}"
        elif p["status"] == "test":
            head = f"🛰️ Teste — {name}"
        else:
            head = f"{SEVERITY_ICON.get(p['severity'], '⚠️')} {SEVERITY_LABEL.get(p['severity'], 'Alerta')} — {name}"
        lines = [head, p["message"], f"Ocorrido em {when}"]
        if now_ts() - p["event_ts"] > LATE_AFTER_S:
            lines.append("(entregue com atraso: o servidor estava sem conexão com a internet)")
        return "\n".join(lines)

    async def _send(self, client: httpx.AsyncClient, channel: str, p: dict[str, Any]) -> None:
        if channel == "telegram":
            cfg = self._telegram()
            if not cfg:
                raise PermanentError("Telegram não configurado")
            token, chat = cfg
            r = await client.post(f"https://api.telegram.org/bot{token}/sendMessage",
                                  json={"chat_id": chat, "text": self._text(p), "disable_web_page_preview": True})
            _check(r, telegram=True)
        elif channel == "webhook":
            url = getattr(self.settings, "alert_webhook_url", None)
            if not url:
                raise PermanentError("webhook não configurado")
            body = {"source": "OrbitLink AI", "status": p["status"], "severity": p["severity"], "message": p["message"],
                    "ts": p["event_ts"], "text": self._text(p)}
            r = await client.post(url, content=json.dumps(body, ensure_ascii=False).encode(),
                                  headers={"Content-Type": "application/json"})
            _check(r, telegram=False)
        else:
            raise PermanentError(f"canal desconhecido: {channel}")


class RetryLater(Exception):
    def __init__(self, msg: str, after: int) -> None:
        super().__init__(msg)
        self.after = after


def _check(r: httpx.Response, *, telegram: bool) -> None:
    if r.is_success:
        return
    detail = ""
    if telegram:
        try:
            body = r.json()
            detail = str(body.get("description", ""))[:200]
            after = int((body.get("parameters") or {}).get("retry_after") or 0)
        except (ValueError, AttributeError):
            after = 0
    else:
        after = 0
    msg = f"HTTP {r.status_code}" + (f": {detail}" if detail else "")
    if r.status_code == 429:
        raise RetryLater(msg, max(after, 30))
    if 400 <= r.status_code < 500:
        raise PermanentError(msg)
    raise RetryLater(msg, 60)
