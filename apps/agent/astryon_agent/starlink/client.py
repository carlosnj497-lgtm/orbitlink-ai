"""Cliente de alto nível para dish e roteador Starlink.

Somente leitura aqui. Ações modificadoras (reboot) ficam em `control/`, que exige matriz de
capacidades, autenticação, confirmação humana e auditoria antes de chamar `execute_control`.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from ..models import DishStatus, ObstructionMap
from .errors import ErrorKind, StarlinkError
from .history import Extraction, extract_new_samples
from .normalize import normalize_obstruction_map, normalize_status
from .transport import CallResult, StarlinkTransport

# Ações de controle que o ASTRYON conhece. Qualquer outra é recusada.
CONTROL_REQUESTS = {"reboot"}


@dataclass
class StarlinkClient:
    transport: StarlinkTransport
    timeout_s: float = 5.0

    @property
    def origin(self) -> str:
        return self.transport.origin

    def raw(self, request: str, params: dict[str, Any] | None = None, *, timeout: float | None = None) -> CallResult:
        if request in CONTROL_REQUESTS:
            raise StarlinkError(ErrorKind.SCHEMA, "Ações de controle não passam por raw(); use control.execute")
        return self.transport.call(request, params, timeout=timeout or self.timeout_s)

    def get_status(self) -> tuple[DishStatus, dict[str, Any]]:
        res = self.raw("get_status")
        return normalize_status(res.data, origin=res.origin, observed_at=datetime.now(UTC)), res.data

    def get_history_raw(self) -> dict[str, Any]:
        return self.raw("get_history", timeout=max(self.timeout_s, 10.0)).data

    def get_history_increment(self, cursor: int | None) -> Extraction:
        poll = datetime.now(UTC)
        return extract_new_samples(self.get_history_raw(), cursor, poll)

    def get_obstruction_map(self) -> ObstructionMap | None:
        res = self.raw("dish_get_obstruction_map", timeout=max(self.timeout_s, 10.0))
        return normalize_obstruction_map(res.data, origin=res.origin)

    def get_device_info(self) -> dict[str, Any]:
        return self.raw("get_device_info").data

    def get_diagnostics(self) -> dict[str, Any]:
        return self.raw("get_diagnostics").data

    def wifi_get_clients(self) -> dict[str, Any]:
        return self.raw("wifi_get_clients").data

    def execute_control(self, request: str, *, timeout: float = 10.0) -> CallResult:
        """Executa uma ação de controle. Chamado SOMENTE pelo fluxo auditado em `control/`."""
        if request not in CONTROL_REQUESTS:
            raise StarlinkError(ErrorKind.SCHEMA, f"Ação '{request}' não é suportada pelo ASTRYON")
        return self.transport.call(request, None, timeout=timeout)
