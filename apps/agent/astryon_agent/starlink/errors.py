"""Erros tipados do conector Starlink.

Todos os erros de transporte são convertidos para `StarlinkError` com um `kind` estável,
para que coletor, diagnóstico e matriz de capacidades tratem cada caso explicitamente.
"""

from __future__ import annotations

from enum import StrEnum


class ErrorKind(StrEnum):
    UNREACHABLE = "inalcancavel"  # rota/TCP/conexão recusada/DNS
    TIMEOUT = "timeout"
    UNIMPLEMENTED = "nao_implementada"  # firmware não implementa a chamada
    PERMISSION_DENIED = "negada"  # firmware recusa (ex.: controle bloqueado localmente)
    SCHEMA = "schema"  # serviço/campo ausente no schema obtido por reflection
    PROTOCOL = "protocolo"  # resposta inesperada
    UNKNOWN = "erro"


class StarlinkError(Exception):
    def __init__(self, kind: ErrorKind, message: str, *, grpc_code: str | None = None) -> None:
        super().__init__(message)
        self.kind = kind
        self.message = message
        self.grpc_code = grpc_code

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return f"StarlinkError({self.kind!s}, {self.message!r}, grpc_code={self.grpc_code!r})"


def from_grpc_error(exc: BaseException) -> StarlinkError:
    """Converte `grpc.RpcError` (ou qualquer exceção) em `StarlinkError`.

    Mensagens são resumidas para não vazar detalhes internos do canal.
    """
    import grpc

    if isinstance(exc, StarlinkError):
        return exc
    if isinstance(exc, grpc.RpcError) and hasattr(exc, "code"):
        code = exc.code()
        details = (exc.details() or "") if hasattr(exc, "details") else ""
        name = code.name if code is not None else "UNKNOWN"
        mapping = {
            grpc.StatusCode.UNAVAILABLE: ErrorKind.UNREACHABLE,
            grpc.StatusCode.DEADLINE_EXCEEDED: ErrorKind.TIMEOUT,
            grpc.StatusCode.UNIMPLEMENTED: ErrorKind.UNIMPLEMENTED,
            grpc.StatusCode.PERMISSION_DENIED: ErrorKind.PERMISSION_DENIED,
            grpc.StatusCode.UNAUTHENTICATED: ErrorKind.PERMISSION_DENIED,
        }
        kind = mapping.get(code, ErrorKind.UNKNOWN)
        return StarlinkError(kind, f"{name}: {details[:200]}".strip(": "), grpc_code=name)
    return StarlinkError(ErrorKind.UNKNOWN, f"{type(exc).__name__}: {str(exc)[:200]}")
