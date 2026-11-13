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
    def __init__(self, max_queue: int = 100) -> None:
        self._subs: set[asyncio.Queue[BusMessage]] = set()
        self._max = max_queue
        self.last: dict[str, BusMessage] = {}

    def subscribe(self) -> asyncio.Queue[BusMessage]:
        q: asyncio.Queue[BusMessage] = asyncio.Queue(maxsize=self._max)
        self._subs.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[BusMessage]) -> None:
        self._subs.discard(q)

    def publish(self, event: str, data: dict[str, Any]) -> None:
        msg = BusMessage(event, data)
        self.last[event] = msg
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
