"""Barramento de eventos em memória para SSE (fan-out com filas limitadas)."""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import Any


@dataclass
class BusMessage:
    event: str
    data: dict[str, Any]

    def sse(self) -> str:
        return f"event: {self.event}\ndata: {json.dumps(self.data, default=str, ensure_ascii=False)}\n\n"


class EventBus:
    """Fan-out para assinantes SSE.

    As filas são `asyncio.Queue`, que não são thread-safe. `publish` pode ser chamado de threads de trabalho
    (por exemplo, o motor de alertas roda em `asyncio.to_thread`), então nesse caso a entrega é agendada no
    loop dos assinantes com `call_soon_threadsafe`, o que também acorda o `q.get()` pendente na hora.
    """

    def __init__(self, max_queue: int = 100) -> None:
        self._subs: set[asyncio.Queue[BusMessage]] = set()
        self._max = max_queue
        self._loop: asyncio.AbstractEventLoop | None = None
        self.last: dict[str, BusMessage] = {}

    def subscribe(self) -> asyncio.Queue[BusMessage]:
        self._loop = asyncio.get_running_loop()
        q: asyncio.Queue[BusMessage] = asyncio.Queue(maxsize=self._max)
        self._subs.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[BusMessage]) -> None:
        self._subs.discard(q)

    def publish(self, event: str, data: dict[str, Any]) -> None:
        msg = BusMessage(event, data)
        self.last[event] = msg
        loop = self._loop
        if loop is not None and not loop.is_closed():
            try:
                running: asyncio.AbstractEventLoop | None = asyncio.get_running_loop()
            except RuntimeError:
                running = None
            if running is not loop:
                try:
                    loop.call_soon_threadsafe(self._deliver, msg)
                except RuntimeError:  # loop fechou entre a checagem e o agendamento
                    pass
                return
        self._deliver(msg)

    def _deliver(self, msg: BusMessage) -> None:
        for q in list(self._subs):
            if q.full():  # cliente lento: descarta o mais antigo
                try:
                    q.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            q.put_nowait(msg)

    @property
    def subscribers(self) -> int:
        return len(self._subs)
