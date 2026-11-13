"""Diagnóstico de rede local — somente leitura. Nunca altera rotas, firewall ou adaptadores.

Endereços MAC nunca são coletados. IPs privados da LAN aparecem no relatório local, mas são
mascarados na versão "compartilhável" (ver `report.sanitize`).
"""

from __future__ import annotations

import ipaddress
import json
import os
import platform
import shutil
import socket
import subprocess  # noqa: S404 - comandos fixos, somente leitura
import time
from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class TcpProbe:
    target: str
    reachable: bool
    latency_ms: float | None
    error: str | None


@dataclass
class RouteInfo:
    destination: str
    local_address: str | None = None
    interface: str | None = None
    next_hop: str | None = None
    method: str = "desconhecido"


@dataclass
class NetworkReport:
    platform: str
    default_gateways: list[str] = field(default_factory=list)
    routes: list[RouteInfo] = field(default_factory=list)
    probes: list[TcpProbe] = field(default_factory=list)
    guidance: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def split_target(target: str) -> tuple[str, int]:
    host, _, port = target.rpartition(":")
    return host, int(port)


def tcp_probe(target: str, timeout: float = 2.0) -> TcpProbe:
    host, port = split_target(target)
    start = time.perf_counter()
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return TcpProbe(target, True, round((time.perf_counter() - start) * 1000, 1), None)
    except TimeoutError:
        return TcpProbe(target, False, None, "timeout")
    except ConnectionRefusedError:
        return TcpProbe(target, False, None, "conexão recusada (host alcançável, porta fechada)")
    except OSError as exc:
        return TcpProbe(target, False, None, f"{type(exc).__name__}: {exc.strerror or exc}")


def local_address_for(dest: str) -> str | None:
    """Endereço local que o SO usaria para `dest` (UDP connect não envia pacotes)."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect((dest, 9))
            return str(s.getsockname()[0])
    except OSError:
        return None


def _powershell_json(command: str, timeout: float = 15.0) -> Any:
    exe = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    try:
        out = subprocess.run(  # noqa: S603 - executável do sistema, comando fixo e somente leitura
            [exe, "-NoProfile", "-NonInteractive", "-Command", f"{command} | ConvertTo-Json -Depth 3"],
            capture_output=True, text=True, timeout=timeout, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if out.returncode != 0 or not out.stdout.strip():
        return None
    try:
        return json.loads(out.stdout)
    except json.JSONDecodeError:
        return None


def windows_route(dest: str) -> RouteInfo | None:
    data = _powershell_json(
        f"Find-NetRoute -RemoteIPAddress {dest} | Select-Object IPAddress,InterfaceAlias,NextHop,DestinationPrefix"
    )
    if data is None:
        return None
    items = data if isinstance(data, list) else [data]
    info = RouteInfo(destination=dest, method="Find-NetRoute")
    for it in items:
        if not isinstance(it, dict):
            continue
        if it.get("IPAddress"):
            info.local_address = it["IPAddress"]
        if it.get("InterfaceAlias"):
            info.interface = it["InterfaceAlias"]
        if it.get("NextHop"):
            info.next_hop = it["NextHop"]
    return info


def windows_default_gateways() -> list[str]:
    data = _powershell_json(
        "Get-NetRoute -DestinationPrefix 0.0.0.0/0 -ErrorAction SilentlyContinue | Select-Object NextHop,RouteMetric"
    )
    if data is None:
        return []
    items = data if isinstance(data, list) else [data]
    return [str(i["NextHop"]) for i in items if isinstance(i, dict) and i.get("NextHop")]


def _ip_json(args: list[str], timeout: float = 5.0) -> Any:
    """Executa `ip -j ...` (iproute2, somente leitura) e devolve o JSON."""
    exe = shutil.which("ip") or "/usr/sbin/ip"
    try:
        out = subprocess.run([exe, "-j", *args], capture_output=True, text=True, timeout=timeout, check=False)  # noqa: S603
    except (OSError, subprocess.TimeoutExpired):
        return None
    if out.returncode != 0 or not out.stdout.strip():
        return None
    try:
        return json.loads(out.stdout)
    except json.JSONDecodeError:
        return None


def parse_linux_route(dest: str, data: Any) -> RouteInfo | None:
    if not isinstance(data, list) or not data or not isinstance(data[0], dict):
        return None
    r = data[0]
    return RouteInfo(destination=dest, local_address=r.get("prefsrc"), interface=r.get("dev"), next_hop=r.get("gateway"),
                     method="ip route get")


def linux_route(dest: str) -> RouteInfo | None:
    return parse_linux_route(dest, _ip_json(["route", "get", dest]))


def parse_linux_default_gateways(data: Any) -> list[str]:
    if not isinstance(data, list):
        return []
    return [str(r["gateway"]) for r in data if isinstance(r, dict) and r.get("dst") == "default" and r.get("gateway")]


def linux_default_gateways() -> list[str]:
    return parse_linux_default_gateways(_ip_json(["route", "show", "default"]))


def _same_subnet(a: str | None, b: str, prefix: int = 24) -> bool:
    if not a:
        return False
    try:
        return ipaddress.ip_address(a) in ipaddress.ip_network(f"{b}/{prefix}", strict=False)
    except ValueError:
        return False


def build_guidance(dish_target: str, router_target: str, probes: dict[str, TcpProbe], gateways: list[str],
                   routes: dict[str, RouteInfo]) -> list[str]:
    dish_host, _ = split_target(dish_target)
    router_host, _ = split_target(router_target)
    dish = probes.get("dish")
    router = probes.get("router")
    g: list[str] = []
    if dish and dish.reachable:
        g.append("A antena respondeu na porta gRPC. Integração local possível.")
        return g
    route = routes.get("dish")
    local = route.local_address if route else None
    g.append(f"A antena ({dish_target}) não respondeu: {dish.error if dish else 'sem teste'}.")
    if router and router.reachable:
        g.append("O roteador Starlink responde, mas a antena não: aguarde o boot da antena ou verifique o cabo/alimentação.")
    elif _same_subnet(local, router_host):
        g.append("Este computador está na sub-rede padrão do roteador Starlink, mas nada respondeu: "
                 "confirme se a Starlink Mini está ligada e terminou de inicializar (pode levar alguns minutos).")
    else:
        gw = ", ".join(gateways) or "desconhecido"
        g.append(f"Gateway atual: {gw}. Este computador não parece estar na rede padrão da Starlink.")
        g.append("Se a Starlink Mini estiver ligada ao seu próprio roteador (modo bypass), o roteador precisa encaminhar "
                 f"{dish_host} pela porta WAN. Em muitos roteadores isso exige uma rota estática "
                 f"'{dish_host}/32 -> interface WAN'. O OrbitLink não altera sua rede; faça isso no painel do roteador.")
        if platform.system() == "Linux":
            g.append(f"Em servidor Linux atrás de roteador próprio, também é possível uma rota estática local, por exemplo "
                     f"'sudo ip route add {dish_host}/32 via <gateway>' (temporária) ou um bloco 'routes' no netplan "
                     "(persistente) — veja docs/LINUX_SERVER.md. Depois execute 'sudo orbitlinkctl diagnose'.")
        else:
            g.append("Alternativa para teste: conecte este computador diretamente ao Wi-Fi da Starlink Mini e execute "
                     "novamente 'scripts\\diagnose.ps1'.")
    return g


def diagnose_network(dish_target: str, router_target: str, *, include_router: bool = True,
                     timeout: float = 2.0) -> NetworkReport:
    rep = NetworkReport(platform=f"{platform.system()} {platform.release()}")
    system = platform.system()
    is_windows = system == "Windows"
    is_linux = system == "Linux"
    rep.default_gateways = windows_default_gateways() if is_windows else linux_default_gateways() if is_linux else []
    probes: dict[str, TcpProbe] = {"dish": tcp_probe(dish_target, timeout)}
    if include_router:
        probes["router"] = tcp_probe(router_target, timeout)
    routes: dict[str, RouteInfo] = {}
    for name, target in (("dish", dish_target), ("router", router_target)):
        if name == "router" and not include_router:
            continue
        host, _ = split_target(target)
        info = windows_route(host) if is_windows else linux_route(host) if is_linux else None
        if info is None:
            info = RouteInfo(destination=host, local_address=local_address_for(host), method="udp-connect")
        routes[name] = info
    rep.routes = list(routes.values())
    rep.probes = list(probes.values())
    rep.guidance = build_guidance(dish_target, router_target, probes, rep.default_gateways, routes)
    return rep
