"""Leitura incremental do buffer circular de `get_history`.

Modelo (o mesmo descrito pela `starlink-grpc-tools`, Unlicense):
* Cada array (ex.: `pop_ping_drop_rate`) é um anel de N amostras de ~1 s.
* `current` conta quantas amostras foram escritas desde o boot. A amostra de contador `c`
  (0 <= c < current) fica no índice `c % N`. Só os contadores `[current - N, current)` existem.
* `current` volta a ~0 quando a antena reinicia.

Este módulo é puro (sem I/O) para ser testável: dado o snapshot e o cursor persistido, devolve
apenas as amostras novas, se houve reset de contador e quantas amostras foram perdidas (lacuna).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from ..models import HistorySample

SAMPLE_PERIOD_S = 1.0

ARRAYS = {
    "pop_ping_drop_rate": "pop_ping_drop_rate",
    "pop_ping_latency_ms": "pop_ping_latency_ms",
    "downlink_throughput_bps": "downlink_throughput_bps",
    "uplink_throughput_bps": "uplink_throughput_bps",
    "power_in": "power_in_w",
}


@dataclass
class Extraction:
    samples: list[HistorySample]
    new_cursor: int  # próximo contador esperado (= current)
    counter_reset: bool  # contador voltou => reinício da antena (ou troca de terminal)
    lost_samples: int  # amostras que existiram mas saíram do anel antes de serem lidas
    lost_from_ts: datetime | None = None
    lost_to_ts: datetime | None = None
    buffer_len: int = 0
    arrays_present: list[str] = field(default_factory=list)


def _buffer_len(data: dict[str, Any]) -> int:
    lengths = [len(v) for k, v in data.items() if k in ARRAYS and isinstance(v, list)]
    return max(lengths) if lengths else 0


def extract_new_samples(data: dict[str, Any], cursor: int | None, poll_time: datetime) -> Extraction:
    """Extrai amostras novas.

    `cursor` = valor de `current` na última leitura bem-sucedida deste boot (None = primeira leitura).
    Timestamps são aproximados: a amostra mais recente (contador `current-1`) recebe `poll_time - 1 s`.
    """
    raw_current = data.get("current")
    current = int(raw_current) if raw_current is not None else 0
    n = _buffer_len(data)
    present = sorted(k for k in ARRAYS if isinstance(data.get(k), list))
    if n == 0 or current <= 0:
        return Extraction([], new_cursor=max(current, 0), counter_reset=bool(cursor and current < cursor),
                          lost_samples=0, buffer_len=n, arrays_present=present)

    reset = cursor is not None and current < cursor
    oldest_available = max(0, current - n)
    if cursor is None or reset:
        start = oldest_available
        # Num reset, amostras do boot novo anteriores ao anel não são recuperáveis
        lost = oldest_available if reset else 0
    else:
        start = max(cursor, oldest_available)
        lost = max(0, oldest_available - cursor)

    def ts_of(counter: int) -> datetime:
        return poll_time - timedelta(seconds=(current - counter) * SAMPLE_PERIOD_S)

    samples: list[HistorySample] = []
    for c in range(start, current):
        idx = c % n
        values: dict[str, float | None] = {}
        for src, dst in ARRAYS.items():
            arr = data.get(src)
            if isinstance(arr, list) and len(arr) == n:
                v = arr[idx]
                values[dst] = float(v) if v is not None else None
            else:
                values[dst] = None
        samples.append(HistorySample(counter=c, ts=ts_of(c), **values))

    lost_from = ts_of(start - lost) if lost else None
    lost_to = ts_of(start) if lost else None
    return Extraction(samples, new_cursor=current, counter_reset=reset, lost_samples=lost,
                      lost_from_ts=lost_from, lost_to_ts=lost_to, buffer_len=n, arrays_present=present)


def boot_id_from_uptime(observed_at: datetime, uptime_s: float | int | None, *, resolution_s: int = 60) -> str | None:
    """Identificador estável de sessão de boot: horário de boot arredondado.

    O arredondamento absorve jitter entre polls. Um reboot muda o horário em > resolução.
    """
    if uptime_s is None:
        return None
    boot = observed_at - timedelta(seconds=float(uptime_s))
    epoch = int(boot.timestamp())
    return f"boot-{epoch - epoch % resolution_s}"
