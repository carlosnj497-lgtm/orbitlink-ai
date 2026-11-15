"""Buffer circular de get_history: ordem, wrap, reset de contador, lacunas e idempotência."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from astryon_agent.starlink.history import boot_id_from_uptime, extract_new_samples

T0 = datetime(2026, 11, 12, 12, 0, 0, tzinfo=UTC)


def ring(current: int, n: int = 10) -> dict:
    """Anel sintético onde o valor de cada amostra = seu contador (facilita conferir a ordem)."""
    arr = [None] * n
    for c in range(max(0, current - n), current):
        arr[c % n] = float(c)
    # posições nunca escritas (current < n) ficam 0, como no dispositivo
    arr = [0.0 if v is None else v for v in arr]
    return {"current": current, "pop_ping_drop_rate": [0.0] * n, "downlink_throughput_bps": arr,
            "uplink_throughput_bps": arr, "pop_ping_latency_ms": arr}


def test_first_read_takes_available_in_order():
    ex = extract_new_samples(ring(25), None, T0)
    assert [s.counter for s in ex.samples] == list(range(15, 25))
    assert [s.downlink_throughput_bps for s in ex.samples] == [float(c) for c in range(15, 25)]
    assert ex.new_cursor == 25 and not ex.counter_reset and ex.lost_samples == 0
    assert ex.samples[-1].ts == T0 - timedelta(seconds=1)


def test_first_read_partial_buffer():
    ex = extract_new_samples(ring(4), None, T0)
    assert [s.counter for s in ex.samples] == [0, 1, 2, 3]


def test_incremental_no_duplicates():
    ex1 = extract_new_samples(ring(25), None, T0)
    ex2 = extract_new_samples(ring(28), ex1.new_cursor, T0 + timedelta(seconds=3))
    assert [s.counter for s in ex2.samples] == [25, 26, 27]
    assert ex2.lost_samples == 0
    # mesmo poll repetido => nada novo
    ex3 = extract_new_samples(ring(28), ex2.new_cursor, T0 + timedelta(seconds=3))
    assert ex3.samples == []


def test_wrap_across_buffer_end():
    ex = extract_new_samples(ring(33), 27, T0)
    assert [s.counter for s in ex.samples] == list(range(27, 33))
    assert [s.downlink_throughput_bps for s in ex.samples] == [float(c) for c in range(27, 33)]


def test_gap_when_poll_too_late():
    ex = extract_new_samples(ring(50), 30, T0)
    # disponíveis 40..49; 30..39 perdidos
    assert ex.samples[0].counter == 40
    assert ex.lost_samples == 10
    assert ex.lost_from_ts == T0 - timedelta(seconds=20)
    assert ex.lost_to_ts == T0 - timedelta(seconds=10)


def test_counter_reset_on_reboot():
    ex = extract_new_samples(ring(6), 500, T0)
    assert ex.counter_reset
    assert [s.counter for s in ex.samples] == list(range(0, 6))
    assert ex.lost_samples == 0


def test_reboot_with_ring_already_wrapped():
    ex = extract_new_samples(ring(15), 500, T0)
    assert ex.counter_reset
    assert ex.samples[0].counter == 5 and ex.lost_samples == 5


def test_missing_array_is_none_not_zero():
    data = ring(12)
    del data["uplink_throughput_bps"]
    ex = extract_new_samples(data, None, T0)
    assert all(s.uplink_throughput_bps is None for s in ex.samples)
    assert "uplink_throughput_bps" not in ex.arrays_present


def test_empty_history():
    ex = extract_new_samples({"current": 0}, None, T0)
    assert ex.samples == [] and ex.new_cursor == 0


def test_boot_id_stable_and_changes_on_reboot():
    a = boot_id_from_uptime(T0, 3600)
    b = boot_id_from_uptime(T0 + timedelta(seconds=10), 3610)
    c = boot_id_from_uptime(T0 + timedelta(seconds=10), 5)
    assert a == b and a != c
