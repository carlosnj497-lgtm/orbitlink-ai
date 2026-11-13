"""Relatório de diagnóstico (JSON + texto), sanitizado."""

from __future__ import annotations

import ipaddress
import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .. import __version__
from ..config import Settings
from ..starlink.capabilities import Capability, CapStatus, probe, unreachable_matrix
from ..starlink.history import extract_new_samples
from ..starlink.normalize import normalize_status
from ..starlink.transport import FixtureTransport, GrpcTransport, StarlinkTransport
from .network import NetworkReport, diagnose_network

DISCLAIMER = "OrbitLink AI é um projeto independente, sem afiliação com a Starlink/SpaceX."
WELL_KNOWN_IPS = {"192.168.100.1", "192.168.1.1", "127.0.0.1"}
MAC_RE = re.compile(r"\b[0-9A-Fa-f]{2}(?:[:-][0-9A-Fa-f]{2}){5}\b")
IP_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
SENSITIVE_KEYS = {"id", "lat", "lon", "latitude", "longitude", "alt", "location", "mac", "mac_address",
                  "serial", "serial_number", "utc_offset_s", "country_code", "ssid", "password", "token", "key"}


def _mask_ip(match: re.Match[str]) -> str:
    ip = match.group(0)
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return ip
    if ip in WELL_KNOWN_IPS or addr.is_loopback:
        return ip
    parts = ip.split(".")
    return f"{parts[0]}.{parts[1]}.x.x" if addr.is_private else "x.x.x.x"


def sanitize(obj: Any, *, mask_lan_ips: bool = True) -> Any:
    """Remove chaves sensíveis, MACs e (opcionalmente) mascara IPs."""
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if str(k).lower() in SENSITIVE_KEYS:
                out[k] = "[removido]"
            else:
                out[k] = sanitize(v, mask_lan_ips=mask_lan_ips)
        return out
    if isinstance(obj, list):
        return [sanitize(v, mask_lan_ips=mask_lan_ips) for v in obj]
    if isinstance(obj, str):
        s = MAC_RE.sub("[mac removido]", obj)
        return IP_RE.sub(_mask_ip, s) if mask_lan_ips else s
    return obj


def make_transport(settings: Settings, device: str) -> StarlinkTransport:
    if settings.fixture_file:
        return FixtureTransport.from_file(settings.fixture_file)
    target = settings.dish_target if device == "dish" else settings.router_target
    return GrpcTransport(target, connect_timeout=settings.connect_timeout_s)


def _device_section(settings: Settings, device: str, reachable: bool, transport: StarlinkTransport | None) -> dict[str, Any]:
    if transport is None or (not reachable and transport.origin == "grpc"):
        caps = unreachable_matrix(device, "Porta TCP não respondeu no teste de rede.")
        return {"reachable": False, "origin": "grpc", "capabilities": [c.model_dump(mode="json") for c in caps]}
    res = probe(transport, device, timeout=settings.grpc_timeout_s)
    section: dict[str, Any] = {
        "reachable": res.error is None or res.error.kind.value != "inalcancavel",
        "origin": transport.origin,
        "schema": res.schema,
        "error": {"kind": res.error.kind.value, "message": res.error.message} if res.error else None,
        "capabilities": [c.model_dump(mode="json") for c in res.capabilities],
    }
    if transport.origin == "fixture":
        section["aviso"] = "DADOS DE FIXTURE — não são da sua antena."
    st = res.responses.get("get_status")
    if st is not None and device == "dish":
        status = normalize_status(st.data, origin=st.origin, drop_threshold=settings.degraded_drop_rate)
        section["status"] = status.model_dump(mode="json")
    hist = res.responses.get("get_history")
    if hist is not None:
        ex = extract_new_samples(hist.data, None, datetime.now(UTC))
        section["history"] = {
            "current": hist.data.get("current"),
            "buffer_len": ex.buffer_len,
            "arrays_present": ex.arrays_present,
            "samples_available": len(ex.samples),
            "outages_reported": len(hist.data.get("outages") or []),
        }
    return section


def run_diagnose(settings: Settings, *, save_fixture: Path | None = None) -> dict[str, Any]:
    started = datetime.now(UTC)
    if settings.fixture_file:
        net: NetworkReport | None = None
        dish_ok = router_ok = True
    else:
        net = diagnose_network(settings.dish_target, settings.router_target, include_router=settings.router_enabled)
        dish_ok = any(p.reachable for p in net.probes if p.target == settings.dish_target)
        router_ok = any(p.reachable for p in net.probes if p.target == settings.router_target)

    dish_t = make_transport(settings, "dish")
    router_t = make_transport(settings, "router") if settings.router_enabled and not settings.fixture_file else None
    try:
        dish = _device_section(settings, "dish", dish_ok, dish_t)
        router = (_device_section(settings, "router", router_ok, router_t) if settings.router_enabled
                  and not settings.fixture_file else {"reachable": None, "note": "roteador desabilitado/fixture"})
        if save_fixture and dish_t.origin == "grpc" and dish.get("schema"):
            _save_fixture(dish_t, dish, save_fixture, settings)
    finally:
        dish_t.close()
        if router_t:
            router_t.close()

    caps = [Capability.model_validate(c) for c in dish["capabilities"]]
    verified = [c.key for c in caps if c.status == CapStatus.VERIFICADA]
    verdict = ("antena acessível" if "dish.status" in verified
               else "antena inacessível" if not dish.get("reachable") else "antena acessível com limitações")
    return {
        "orbitlink": {"version": __version__, "disclaimer": DISCLAIMER},
        "generated_at": started.isoformat(),
        "duration_ms": int((datetime.now(UTC) - started).total_seconds() * 1000),
        "mode": "fixture" if settings.fixture_file else "real",
        "targets": {"dish": settings.dish_target, "router": settings.router_target},
        "network": net.to_dict() if net else None,
        "dish": dish,
        "router": router,
        "summary": {"verdict": verdict, "verified": verified},
    }


def _save_fixture(transport: StarlinkTransport, dish: dict[str, Any], path: Path, settings: Settings) -> None:
    responses: dict[str, Any] = {}
    for req in ("get_status", "get_history", "dish_get_obstruction_map", "get_device_info"):
        try:
            r = transport.call(req, None, timeout=settings.grpc_timeout_s)
            responses[req] = {"response_field": r.response_field, "data": sanitize(r.data, mask_lan_ips=True)}
        except Exception as exc:  # noqa: BLE001
            code = getattr(exc, "grpc_code", None) or "UNKNOWN"
            responses[req] = {"error": code}
    fixture = {
        "_fixture": {"kind": "anonimizada", "descricao": "Capturada pelo diagnose do OrbitLink, dados pessoais removidos",
                     "captured_at": datetime.now(UTC).isoformat()},
        "request_fields": (dish.get("schema") or {}).get("request_fields", []),
        "responses": responses,
    }
    path.write_text(json.dumps(fixture, indent=2, ensure_ascii=False), encoding="utf-8")


STATUS_ICON = {"verificada": "OK ", "schema_presente": "SCH", "campo_ausente": "-- ", "inalcancavel": "XX ",
               "nao_implementada": "NI ", "negada": "NEG", "timeout": "T/O", "ausente_no_schema": "N/S",
               "erro": "ERR", "nao_consultada": "N/C"}


def render_text(report: dict[str, Any]) -> str:
    lines = [
        "=" * 72,
        f" OrbitLink AI — diagnóstico ({report['mode']})  {report['generated_at']}",
        f" {report['orbitlink']['disclaimer']}",
        "=" * 72,
    ]
    net = report.get("network")
    if net:
        lines.append(f"Plataforma: {net['platform']}")
        lines.append(f"Gateway(s) padrão: {', '.join(net['default_gateways']) or 'não identificado'}")
        for r in net["routes"]:
            lines.append(f"Rota p/ {r['destination']}: interface={r['interface'] or '?'} origem={r['local_address'] or '?'} "
                         f"próximo salto={r['next_hop'] or '?'} ({r['method']})")
        for p in net["probes"]:
            res = f"OK {p['latency_ms']} ms" if p["reachable"] else f"FALHOU ({p['error']})"
            lines.append(f"TCP {p['target']}: {res}")
    for name in ("dish", "router"):
        sec = report.get(name) or {}
        if "capabilities" not in sec:
            continue
        lines.append("")
        lines.append(f"--- {'Antena' if name == 'dish' else 'Roteador'} ---")
        if sec.get("aviso"):
            lines.append(f"!! {sec['aviso']}")
        if sec.get("error"):
            lines.append(f"Erro: {sec['error']['kind']} — {sec['error']['message']}")
        st = sec.get("status")
        if st:
            dev = st["device"]
            lines.append(f"Estado: {st['state']}{' (' + st['state_reason'] + ')' if st.get('state_reason') else ''}")
            lines.append(f"Hardware: {dev.get('hardware_version') or '?'}  Firmware: {dev.get('software_version') or '?'}")
            for k, m in st["metrics"].items():
                lines.append(f"  {k:24} {m['value']} {m.get('unit') or ''}  [{m['source']}]")
            if st["fields_missing"]:
                lines.append(f"  Campos ausentes neste firmware: {', '.join(st['fields_missing'])}")
        h = sec.get("history")
        if h:
            lines.append(f"Histórico: current={h['current']} buffer={h['buffer_len']} arrays={','.join(h['arrays_present'])}")
        lines.append("Matriz de capacidades:")
        for c in sec["capabilities"]:
            icon = STATUS_ICON.get(c["status"], "?  ")
            lines.append(f"  [{icon}] {c['label']:44} {c['status']}")
    lines.append("")
    lines.append(f"Resumo: {report['summary']['verdict']}")
    if net and net.get("guidance"):
        lines.append("Orientação:")
        lines += [f"  - {g}" for g in net["guidance"]]
    lines.append("Legenda: OK=verificada SCH=presente no schema (não executada) --=campo ausente "
                 "XX=inalcançável NI=não implementada NEG=negada N/S=fora do schema N/C=não consultada")
    return "\n".join(lines)
