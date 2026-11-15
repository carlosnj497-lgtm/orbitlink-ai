"""Transportes para a API local gRPC da Starlink.

A API local expõe um único RPC: `SpaceX.API.Device.Device/Handle(Request) -> Response`, onde
`Request` e `Response` têm um `oneof` com dezenas de variantes. O conjunto exato de variantes
depende do firmware. Por isso o `GrpcTransport` NÃO depende de protos compilados: ele obtém o
schema em runtime via gRPC Server Reflection (abordagem também usada pela `starlink-grpc-tools`,
Unlicense) e converte respostas para dict. Campos que o firmware não retorna continuam ausentes.

`FixtureTransport` responde a partir de dicts carregados de arquivos de fixture; é usado em testes
e na rota de demonstração, e SEMPRE se identifica como tal.
"""

from __future__ import annotations

import json
import logging
import threading
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from .errors import ErrorKind, StarlinkError, from_grpc_error

log = logging.getLogger("astryon.grpc")

SERVICE_NAME = "SpaceX.API.Device.Device"
METHOD_PATH = f"/{SERVICE_NAME}/Handle"


@dataclass(frozen=True)
class CallResult:
    """Resultado de uma chamada `Handle`."""

    request: str  # nome do campo do oneof Request (ex.: "get_status")
    response_field: str | None  # nome do campo do oneof Response que veio preenchido
    data: dict[str, Any]  # conteúdo do campo de resposta, como dict
    origin: str  # "grpc" | "fixture"


class StarlinkTransport(Protocol):
    target: str
    origin: str

    def request_fields(self) -> list[str]:
        """Variantes de Request conhecidas pelo schema (vazio se ainda não carregado)."""
        ...

    def schema_info(self) -> dict[str, Any]: ...

    def call(self, request: str, params: Mapping[str, Any] | None = None, *, timeout: float = 5.0) -> CallResult: ...

    def close(self) -> None: ...


@dataclass
class GrpcTransport:
    """Cliente gRPC real com schema obtido por reflection.

    Thread-safe para chamadas concorrentes (o canal gRPC é thread-safe; a carga do schema é
    protegida por lock). As chamadas são bloqueantes: use `asyncio.to_thread` em código async.
    """

    target: str
    connect_timeout: float = 3.0
    origin: str = "grpc"
    _channel: Any = field(default=None, init=False, repr=False)
    _req_cls: Any = field(default=None, init=False, repr=False)
    _resp_cls: Any = field(default=None, init=False, repr=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, init=False, repr=False)
    # Lock só do canal: status, histórico, obstrução e reboot rodam em threads diferentes e compartilham o canal.
    _chan_lock: threading.Lock = field(default_factory=threading.Lock, init=False, repr=False)

    # -------------------------------------------------------------- canal/schema
    def _ensure_channel(self) -> Any:
        import grpc

        with self._chan_lock:
            return self._ensure_channel_locked(grpc)

    def _ensure_channel_locked(self, grpc: Any) -> Any:
        if self._channel is None:
            options = [
                ("grpc.enable_retries", 0),
                ("grpc.max_receive_message_length", 8 * 1024 * 1024),
                ("grpc.initial_reconnect_backoff_ms", 1000),
                ("grpc.max_reconnect_backoff_ms", 10000),
            ]
            self._channel = grpc.insecure_channel(self.target, options=options)
        return self._channel

    def _ensure_schema(self) -> None:
        if self._req_cls is not None:
            return
        with self._lock:
            if self._req_cls is not None:
                return
            import grpc
            from google.protobuf import descriptor_pool, message_factory
            from grpc_reflection.v1alpha.proto_reflection_descriptor_database import (
                ProtoReflectionDescriptorDatabase,
            )

            channel = self._ensure_channel()
            try:
                grpc.channel_ready_future(channel).result(timeout=self.connect_timeout)
            except grpc.FutureTimeoutError as exc:
                self._reset_channel()
                raise StarlinkError(
                    ErrorKind.UNREACHABLE, f"Sem conexão gRPC com {self.target} em {self.connect_timeout:.0f}s"
                ) from exc
            try:
                db = ProtoReflectionDescriptorDatabase(channel)
                pool = descriptor_pool.DescriptorPool(db)
                service = pool.FindServiceByName(SERVICE_NAME)
                method = service.FindMethodByName("Handle")
            except KeyError as exc:
                raise StarlinkError(
                    ErrorKind.SCHEMA, f"Serviço {SERVICE_NAME}/Handle não encontrado via reflection"
                ) from exc
            except Exception as exc:  # noqa: BLE001 - convertido abaixo
                err = from_grpc_error(exc)
                if err.kind == ErrorKind.UNIMPLEMENTED:
                    err = StarlinkError(
                        ErrorKind.SCHEMA,
                        "O dispositivo não oferece gRPC reflection; schema indisponível",
                        grpc_code=err.grpc_code,
                    )
                raise err from exc
            self._req_cls = message_factory.GetMessageClass(method.input_type)
            self._resp_cls = message_factory.GetMessageClass(method.output_type)

    def _reset_channel(self, failed: Any = None) -> None:
        """Fecha o canal. Com `failed`, só fecha se ainda for aquele canal: outra thread pode já ter aberto um novo."""
        with self._chan_lock:
            ch = self._channel
            if ch is None or (failed is not None and ch is not failed):
                return
            self._channel = None
        try:
            ch.close()
        except Exception as exc:  # noqa: BLE001 - fechar um canal já quebrado não pode virar outro erro
            log.debug("falha ao fechar canal gRPC: %s", type(exc).__name__)

    # -------------------------------------------------------------- API
    def request_fields(self) -> list[str]:
        if self._req_cls is None:
            return []
        oneof = self._req_cls.DESCRIPTOR.oneofs_by_name.get("request")
        if oneof is None:
            return []
        return sorted(f.name for f in oneof.fields)

    def response_fields(self) -> list[str]:
        if self._resp_cls is None:
            return []
        oneof = self._resp_cls.DESCRIPTOR.oneofs_by_name.get("response")
        return sorted(f.name for f in oneof.fields) if oneof is not None else []

    def schema_info(self) -> dict[str, Any]:
        self._ensure_schema()
        return {
            "service": SERVICE_NAME,
            "request_fields": self.request_fields(),
            "response_fields": self.response_fields(),
            "source": "grpc_reflection",
        }

    def call(self, request: str, params: Mapping[str, Any] | None = None, *, timeout: float = 5.0) -> CallResult:
        import grpc
        from google.protobuf import json_format

        self._ensure_schema()
        if request not in self.request_fields():
            raise StarlinkError(ErrorKind.SCHEMA, f"Requisição '{request}' não existe no schema deste firmware")
        req = self._req_cls()
        sub = getattr(req, request)
        if params:
            json_format.ParseDict(dict(params), sub)
        else:
            sub.SetInParent()
        channel = self._ensure_channel()  # referência local: um reset em outra thread não troca o canal no meio
        try:
            stub = channel.unary_unary(
                METHOD_PATH,
                request_serializer=lambda m: m.SerializeToString(),
                response_deserializer=self._resp_cls.FromString,
            )
            resp = stub(req, timeout=timeout)
        except grpc.RpcError as exc:
            err = from_grpc_error(exc)
            if err.kind == ErrorKind.UNREACHABLE:
                self._reset_channel(channel)
            raise err from exc
        except (ValueError, AttributeError) as exc:
            # "Cannot invoke RPC on closed channel": outra thread fechou o canal durante uma queda da antena.
            self._reset_channel(channel)
            raise StarlinkError(ErrorKind.UNREACHABLE, f"Canal gRPC com {self.target} foi fechado") from exc
        which = resp.WhichOneof("response")
        if which is None:
            return CallResult(request=request, response_field=None, data={}, origin=self.origin)
        data = json_format.MessageToDict(
            getattr(resp, which),
            preserving_proto_field_name=True,
            always_print_fields_with_no_presence=True,
            unquote_int64_if_possible=True,
        )
        return CallResult(request=request, response_field=which, data=data, origin=self.origin)

    def close(self) -> None:
        self._reset_channel()


# ----------------------------------------------------------------------------- fixtures
FIXTURE_DIR = Path(__file__).resolve().parents[2] / "tests" / "fixtures"


@dataclass
class FixtureTransport:
    """Transporte que responde com dados de fixture.

    Formato do arquivo JSON:
        {"_fixture": {"kind": "sintetica"|"anonimizada", "descricao": "..."},
         "request_fields": [...],
         "responses": {"get_status": {"response_field": "dish_get_status", "data": {...}},
                       "reboot": {"error": "PERMISSION_DENIED"}}}
    """

    responses: dict[str, dict[str, Any]]
    request_list: list[str]
    target: str = "fixture"
    origin: str = "fixture"
    meta: dict[str, Any] = field(default_factory=dict)
    calls: list[str] = field(default_factory=list)

    @classmethod
    def from_file(cls, path: str | Path) -> FixtureTransport:
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
        return cls.from_dict(raw, target=f"fixture:{Path(path).name}")

    @classmethod
    def from_dict(cls, raw: dict[str, Any], *, target: str = "fixture") -> FixtureTransport:
        meta = raw.get("_fixture") or {}
        if not meta.get("kind"):
            raise ValueError("Fixture sem identificação '_fixture.kind' — recusado por política de rastreabilidade")
        responses = raw.get("responses") or {}
        req_list = raw.get("request_fields") or sorted(responses)
        return cls(responses=responses, request_list=list(req_list), target=target, meta=meta)

    def request_fields(self) -> list[str]:
        return sorted(self.request_list)

    def schema_info(self) -> dict[str, Any]:
        return {
            "service": SERVICE_NAME,
            "request_fields": self.request_fields(),
            "response_fields": sorted({r.get("response_field", "") for r in self.responses.values()} - {""}),
            "source": "fixture",
            "fixture": self.meta,
        }

    def call(self, request: str, params: Mapping[str, Any] | None = None, *, timeout: float = 5.0) -> CallResult:
        self.calls.append(request)
        if request not in self.request_list:
            raise StarlinkError(ErrorKind.SCHEMA, f"Requisição '{request}' não existe no schema deste firmware")
        entry = self.responses.get(request)
        if entry is None:
            raise StarlinkError(ErrorKind.UNIMPLEMENTED, "UNIMPLEMENTED", grpc_code="UNIMPLEMENTED")
        if "error" in entry:
            code = str(entry["error"])
            kind = {
                "UNIMPLEMENTED": ErrorKind.UNIMPLEMENTED,
                "PERMISSION_DENIED": ErrorKind.PERMISSION_DENIED,
                "DEADLINE_EXCEEDED": ErrorKind.TIMEOUT,
                "UNAVAILABLE": ErrorKind.UNREACHABLE,
            }.get(code, ErrorKind.UNKNOWN)
            raise StarlinkError(kind, code, grpc_code=code)
        data = entry.get("data") or {}
        return CallResult(
            request=request, response_field=entry.get("response_field"), data=json.loads(json.dumps(data)), origin="fixture"
        )

    def close(self) -> None:
        return None
