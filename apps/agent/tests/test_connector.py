"""Conector gRPC: reflection real (servidor sintético), normalização, erros e matriz de capacidades."""

from __future__ import annotations

import copy
from datetime import UTC, datetime, timedelta

import pytest

from orbitlink_agent.models import ConnState, Source
from orbitlink_agent.starlink.capabilities import CapStatus, probe
from orbitlink_agent.starlink.client import StarlinkClient
from orbitlink_agent.starlink.errors import ErrorKind, StarlinkError
from orbitlink_agent.starlink.normalize import normalize_status, outage_timestamp
from orbitlink_agent.starlink.transport import FixtureTransport, GrpcTransport


def test_grpc_reflection_status(fake_dish):
    t = GrpcTransport(fake_dish.target, connect_timeout=3)
    try:
        info = t.schema_info()
        assert info["source"] == "grpc_reflection"
        assert "get_status" in info["request_fields"] and "reboot" in info["request_fields"]
        status, raw = StarlinkClient(t).get_status()
    finally:
        t.close()
    assert status.origin == "grpc"
    assert status.state == ConnState.CONECTADA
    assert status.metrics["downlink_mbps"].value == 12.5
    assert status.metrics["downlink_mbps"].source == Source.REAL
    assert status.metrics["uplink_mbps"].value == 0.85
    assert status.metrics["pop_latency_ms"].value == 31.5
    assert status.metrics["obstruction_pct"].value == 1.25
    # eth_speed_mbps = 0 está no schema: deve aparecer como 0 (não ausente)
    assert status.metrics["eth_speed_mbps"].value == 0
    assert status.device.terminal_key and status.device.terminal_key.startswith("ut-")
    assert "TESTE" not in status.model_dump_json(), "ID bruto do terminal não pode vazar"
    assert raw["device_state"]["uptime_s"] == 3600  # int64 convertido para int


def test_grpc_unimplemented_and_permission(fake_dish):
    t = GrpcTransport(fake_dish.target)
    try:
        with pytest.raises(StarlinkError) as e:
            t.call("dish_get_obstruction_map")
        assert e.value.kind == ErrorKind.UNIMPLEMENTED
        with pytest.raises(StarlinkError) as e2:
            t.call("reboot")
        assert e2.value.kind == ErrorKind.PERMISSION_DENIED
        with pytest.raises(StarlinkError) as e3:
            t.call("wifi_get_clients")
        assert e3.value.kind == ErrorKind.SCHEMA
    finally:
        t.close()


def test_raw_refuses_control(fake_dish):
    t = GrpcTransport(fake_dish.target)
    try:
        with pytest.raises(StarlinkError):
            StarlinkClient(t).raw("reboot")
        assert "reboot" not in fake_dish.calls
    finally:
        t.close()


def test_unreachable_target_is_reported():
    t = GrpcTransport("127.0.0.1:1", connect_timeout=0.5)
    with pytest.raises(StarlinkError) as e:
        t.schema_info()
    assert e.value.kind == ErrorKind.UNREACHABLE


def test_capability_matrix_never_executes_control(fake_dish):
    t = GrpcTransport(fake_dish.target)
    try:
        res = probe(t, "dish")
    finally:
        t.close()
    caps = {c.key: c for c in res.capabilities}
    assert caps["dish.status"].status == CapStatus.VERIFICADA
    assert caps["dish.history"].status == CapStatus.VERIFICADA
    assert caps["dish.obstruction_map"].status == CapStatus.NAO_IMPLEMENTADA
    assert caps["dish.diagnostics"].status == CapStatus.NAO_IMPLEMENTADA
    assert caps["dish.reboot"].status == CapStatus.SCHEMA_PRESENTE
    assert caps["dish.location"].status == CapStatus.AUSENTE_NO_SCHEMA
    assert caps["history.power"].status == CapStatus.VERIFICADA
    assert caps["metric.obstruction"].status == CapStatus.VERIFICADA
    assert "reboot" not in fake_dish.calls
    assert "get_location" not in fake_dish.calls


def test_missing_fields_stay_missing(fixture_data):
    data = copy.deepcopy(fixture_data["responses"]["get_status"]["data"])
    for k in ("obstruction_stats", "gps_stats", "uplink_throughput_bps"):
        data.pop(k)
    st = normalize_status(data, origin="grpc")
    assert "obstruction_pct" not in st.metrics
    assert "gps_valid" not in st.metrics
    assert "uplink_mbps" not in st.metrics
    assert set(st.fields_missing) >= {"obstruction_stats", "gps_stats", "uplink_throughput_bps"}


def test_unknown_extra_fields_are_tolerated(fixture_data):
    data = copy.deepcopy(fixture_data["responses"]["get_status"]["data"])
    data["some_future_field"] = {"x": 1}
    st = normalize_status(data, origin="grpc")
    assert "some_future_field" in st.fields_present


def test_zero_throughput_is_idle_not_degraded(fixture_data):
    data = copy.deepcopy(fixture_data["responses"]["get_status"]["data"])
    data["downlink_throughput_bps"] = 0
    data["uplink_throughput_bps"] = 0
    st = normalize_status(data, origin="grpc")
    assert st.state == ConnState.CONECTADA
    assert st.metrics["downlink_mbps"].value == 0


@pytest.mark.parametrize(
    "cause,expected",
    [("BOOTING", ConnState.INICIALIZANDO), ("NO_SCHEDULE", ConnState.BUSCANDO), ("OBSTRUCTED", ConnState.OFFLINE)],
)
def test_outage_states(fixture_data, cause, expected):
    data = copy.deepcopy(fixture_data["responses"]["get_status"]["data"])
    data["outage"] = {"cause": cause, "start_timestamp_ns": 0, "duration_ns": 5_000_000_000}
    st = normalize_status(data, origin="grpc")
    assert st.state == expected
    assert st.outage and st.outage.duration_s == 5.0


def test_degraded_by_drop_rate(fixture_data):
    data = copy.deepcopy(fixture_data["responses"]["get_status"]["data"])
    data["pop_ping_drop_rate"] = 0.2
    st = normalize_status(data, origin="grpc")
    assert st.state == ConnState.DEGRADADA


def test_outage_timestamp_epochs():
    now = datetime(2026, 11, 12, 12, 0, tzinfo=UTC)
    unix_ns = int((now - timedelta(minutes=3)).timestamp() * 1e9)
    ts, q = outage_timestamp(unix_ns, now)
    assert q == "confiavel" and ts and abs((ts - (now - timedelta(minutes=3))).total_seconds()) < 1
    gps_s = (now - timedelta(minutes=3) - datetime(1980, 1, 6, tzinfo=UTC)).total_seconds() + 18
    ts2, q2 = outage_timestamp(int(gps_s * 1e9), now)
    assert q2 == "confiavel" and ts2 and abs((ts2 - (now - timedelta(minutes=3))).total_seconds()) < 1
    assert outage_timestamp(123, now)[1] == "incerta"


def test_fixture_transport_requires_label():
    with pytest.raises(ValueError):
        FixtureTransport.from_dict({"responses": {}})


def test_fixture_origin_is_demonstration(fixture_data):
    t = FixtureTransport.from_dict(fixture_data)
    st, _ = StarlinkClient(t).get_status()
    assert st.metrics["downlink_mbps"].source == Source.DEMONSTRACAO
