"""Fluxo auditado de ações de controle: prepare → confirm → execute → audit.

Garantias:
1. A ação precisa estar na matriz de capacidades como `schema_presente` ou `verificada` e ser oferecida.
2. Somente administrador autenticado; a confirmação precisa vir do MESMO usuário que preparou.
3. `operation_id` único, nonce de uso único (armazenado como hash), TTL curto, texto de confirmação.
4. A execução ocorre no agente (nunca no navegador nem por resposta de modelo de IA).
5. Cada etapa gera registro de auditoria; erros são sanitizados.
6. Sucesso só é registrado se o dispositivo aceitar o comando; timeout é reportado como timeout.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import secrets
import uuid
from dataclasses import dataclass
from typing import Any

from ..starlink.capabilities import CapStatus
from ..starlink.client import StarlinkClient
from ..starlink.errors import ErrorKind, StarlinkError
from ..storage.db import Database, now_ts

TTL_S = 120

ACTIONS: dict[str, dict[str, Any]] = {
    "reboot": {
        "capability": "dish.reboot",
        "request": "reboot",
        "label": "Reiniciar a antena",
        "confirm_text": "REINICIAR",
        "consequences": [
            "A internet ficará indisponível por alguns minutos enquanto a antena reinicia.",
            "Conexões ativas (chamadas, downloads) serão interrompidas.",
            "O histórico de ~15 min mantido pela antena é zerado; o ASTRYON registra o reinício.",
        ],
    },
}


class ControlError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def audit(db: Database, operation_id: str | None, actor: str, event: str, detail: str | None = None) -> None:
    db.execute("INSERT INTO control_audit_logs (operation_id, ts, actor, event, detail) VALUES (?, ?, ?, ?, ?)",
               (operation_id, now_ts(), actor, event, (detail or "")[:500]))


def _hash(nonce: str) -> str:
    return hashlib.sha256(nonce.encode()).hexdigest()


@dataclass
class Prepared:
    operation_id: str
    nonce: str
    expires_at: int
    action: str
    label: str
    target: str
    confirm_text: str
    consequences: list[str]


def capability_allows(cap: Any) -> bool:
    return cap is not None and cap.offered_by_astryon and cap.status in (CapStatus.SCHEMA_PRESENTE, CapStatus.VERIFICADA)


def prepare(db: Database, cap: Any, action: str, user: dict[str, Any], target: str, origin: str = "ui",
            reason: str | None = None) -> Prepared:
    spec = ACTIONS.get(action)
    if spec is None:
        raise ControlError(404, "Ação desconhecida ou não suportada pelo ASTRYON.")
    if not capability_allows(cap):
        status = cap.status.value if cap is not None else "nao_verificada"
        audit(db, None, user["username"], "prepare_recusado", f"{action}: capacidade {status}")
        raise ControlError(409, f"Ação indisponível: a matriz de capacidades indica '{status}'.")
    op = uuid.uuid4().hex
    nonce = secrets.token_urlsafe(16)
    exp = now_ts() + TTL_S
    db.execute(
        """INSERT INTO control_requests (operation_id, action, target, requested_by, origin, reason, nonce_hash, status,
             created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)""",
        (op, action, target, user["id"], origin, (reason or "")[:200], _hash(nonce), now_ts(), exp),
    )
    audit(db, op, user["username"], "preparado", f"{action} via {origin}")
    return Prepared(op, nonce, exp, action, spec["label"], target, spec["confirm_text"], spec["consequences"])


def _expire_if_due(db: Database, operation_id: str) -> bool:
    """Marca como 'expired' o pedido pendente cujo prazo já passou. Devolve True se marcou."""
    cur = db.execute("UPDATE control_requests SET status='expired', finished_at=? "
                     "WHERE operation_id=? AND status='pending' AND expires_at < ?", (now_ts(), operation_id, now_ts()))
    return cur.rowcount > 0


def _claim(db: Database, operation_id: str, nonce: str, confirm_text: str, user: dict[str, Any]) -> dict[str, Any]:
    if _expire_if_due(db, operation_id):
        # Marcado como expirado numa transação própria, já gravada: uma exceção dentro do tx() desfaria o UPDATE.
        raise ControlError(410, "Confirmação expirada. Prepare a ação novamente.")
    with db.tx() as c:
        row = c.execute("SELECT * FROM control_requests WHERE operation_id = ?", (operation_id,)).fetchone()
        if row is None:
            raise ControlError(404, "Operação não encontrada.")
        row = dict(row)
        if row["requested_by"] != user["id"]:
            raise ControlError(403, "A confirmação deve ser feita pelo mesmo usuário que preparou a ação.")
        if row["status"] != "pending":
            raise ControlError(409, f"Operação já está em estado '{row['status']}' (proteção contra repetição).")
        if row["expires_at"] < now_ts():  # venceu entre a checagem acima e esta transação
            raise ControlError(410, "Confirmação expirada. Prepare a ação novamente.")
        if not hmac.compare_digest(row["nonce_hash"], _hash(nonce)):
            raise ControlError(403, "Código de confirmação inválido.")
        expected = ACTIONS[row["action"]]["confirm_text"]
        if confirm_text.strip().upper() != expected:
            raise ControlError(422, f"Digite exatamente '{expected}' para confirmar.")
        c.execute("UPDATE control_requests SET status='executing', confirmed_at=? WHERE operation_id=? AND status='pending'",
                  (now_ts(), operation_id))
    return row


async def confirm_and_execute(db: Database, client: StarlinkClient, operation_id: str, nonce: str, confirm_text: str,
                              user: dict[str, Any], timeout_s: float = 15.0) -> dict[str, Any]:
    try:
        row = await asyncio.to_thread(_claim, db, operation_id, nonce, confirm_text, user)
    except ControlError as exc:
        await asyncio.to_thread(audit, db, operation_id, user["username"], "confirmacao_recusada", exc.message)
        raise
    await asyncio.to_thread(audit, db, operation_id, user["username"], "confirmado", None)
    spec = ACTIONS[row["action"]]
    status = "failed"
    detail: str
    try:
        await asyncio.wait_for(asyncio.to_thread(client.execute_control, spec["request"], timeout=timeout_s - 1),
                               timeout=timeout_s)
        status = "accepted"
        detail = "Comando aceito pela antena. O reinício será confirmado quando o agente detectar o novo boot."
    except TimeoutError:
        status, detail = "timeout", "Sem resposta no tempo limite. O estado real é desconhecido; verifique a antena."
    except StarlinkError as err:
        if err.kind == ErrorKind.TIMEOUT:
            status, detail = "timeout", "Sem resposta no tempo limite. O estado real é desconhecido."
        elif err.kind == ErrorKind.PERMISSION_DENIED:
            detail = "O firmware recusou o comando (PERMISSION_DENIED). Use o app oficial para esta ação."
        elif err.kind == ErrorKind.UNIMPLEMENTED:
            detail = "O firmware não implementa este comando (UNIMPLEMENTED)."
        else:
            detail = f"Falha: {err.kind.value}"
    except Exception as exc:  # noqa: BLE001
        # Erro inesperado: nunca deixar a operação presa em "executing" sem resultado na auditoria.
        status = "failed"
        detail = (f"Erro inesperado ao enviar o comando ({type(exc).__name__}). O estado real da antena é "
                  "desconhecido; verifique se ela reiniciou.")
    await asyncio.to_thread(db.execute,
                            "UPDATE control_requests SET status=?, finished_at=?, result_detail=? WHERE operation_id=?",
                            (status, now_ts(), detail, operation_id))
    await asyncio.to_thread(audit, db, operation_id, user["username"], f"resultado_{status}", detail)
    return {"operation_id": operation_id, "status": status, "detail": detail}


def cancel(db: Database, operation_id: str, user: dict[str, Any]) -> None:
    cur = db.execute("UPDATE control_requests SET status='cancelled', finished_at=? WHERE operation_id=? AND status='pending' "
                     "AND requested_by=?", (now_ts(), operation_id, user["id"]))
    if cur.rowcount:
        audit(db, operation_id, user["username"], "cancelado", None)
