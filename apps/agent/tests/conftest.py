"""Fixtures de teste.

`fake_dish` sobe um servidor gRPC LOCAL com schema sintético e reflection habilitada, para testar
o caminho real do `GrpcTransport` sem a antena. Os dados vêm de `fixtures/dish_synthetic_v1.json`.
"""

from __future__ import annotations

import copy
import importlib
import json
import sys
from concurrent import futures
from pathlib import Path
from typing import Any

import pytest

HERE = Path(__file__).parent
FIXTURES = HERE / "fixtures"


def load_fixture(name: str = "dish_synthetic_v1.json") -> dict[str, Any]:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


@pytest.fixture
def fixture_data() -> dict[str, Any]:
    return load_fixture()


@pytest.fixture(scope="session")
def fake_pb(tmp_path_factory: pytest.TempPathFactory) -> Any:
    from grpc_tools import protoc

    out = tmp_path_factory.mktemp("fakegrpc")
    proto_dir = HERE / "fakegrpc"
    rc = protoc.main([
        "protoc", f"-I{proto_dir}", f"--python_out={out}", f"--grpc_python_out={out}", str(proto_dir / "fake_device.proto"),
    ])
    assert rc == 0, "falha ao compilar proto sintético"
    sys.path.insert(0, str(out))
    pb2 = importlib.import_module("fake_device_pb2")
    pb2_grpc = importlib.import_module("fake_device_pb2_grpc")
    return pb2, pb2_grpc


class FakeDishState:
    def __init__(self, data: dict[str, Any]) -> None:
        self.responses = copy.deepcopy(data["responses"])
        self.calls: list[str] = []


@pytest.fixture
def fake_dish(fake_pb: Any, fixture_data: dict[str, Any]) -> Any:
    import grpc
    from google.protobuf import json_format
    from grpc_reflection.v1alpha import reflection

    pb2, pb2_grpc = fake_pb
    state = FakeDishState(fixture_data)

    class Servicer(pb2_grpc.DeviceServicer):  # type: ignore[misc,name-defined]
        def Handle(self, request: Any, context: Any) -> Any:  # noqa: N802
            which = request.WhichOneof("request")
            state.calls.append(which)
            entry = state.responses.get(which)
            if entry is None:
                context.abort(grpc.StatusCode.UNIMPLEMENTED, "Unimplemented")
            if "error" in entry:
                context.abort(getattr(grpc.StatusCode, entry["error"]), entry["error"])
            resp = pb2.Response()
            json_format.ParseDict(entry["data"], getattr(resp, entry["response_field"]))
            return resp

    server = grpc.server(futures.ThreadPoolExecutor(max_workers=4))
    pb2_grpc.add_DeviceServicer_to_server(Servicer(), server)
    reflection.enable_server_reflection(
        (pb2.DESCRIPTOR.services_by_name["Device"].full_name, reflection.SERVICE_NAME), server
    )
    port = server.add_insecure_port("127.0.0.1:0")
    server.start()
    state.target = f"127.0.0.1:{port}"  # type: ignore[attr-defined]
    yield state
    server.stop(grace=None)
