"""ASTRYON para Windows: iniciador com ícone na bandeja.

* Prepara %LOCALAPPDATA%\\ASTRYON (dados, logs e astryon.env com token aleatório na primeira execução).
* Sobe o agente (astryon-agent.exe) e o painel (node.exe + server.js) escondidos, só em 127.0.0.1.
* Vigia os dois: se um cair, sobe de novo (com espera crescente).
* Ícone verde (agente e painel respondendo) ou vermelho (algum dos dois fora do ar). A situação da antena
  aparece no próprio painel.
* Menu: Abrir painel, Reiniciar serviços, Ver logs, Editar configurações, Iniciar com o Windows, Sair.
* Uma única instância: abrir de novo só abre o navegador.

A pasta de dados fica fora da pasta do programa: atualizar ou reinstalar não apaga nada.
"""

from __future__ import annotations

import os
import secrets
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path
from typing import Any

APP_NAME = "ASTRYON"
PANEL_URL = "http://127.0.0.1:3000"
AGENT_URL = "http://127.0.0.1:8787/v1/health"
LOG_MAX = 5 * 1024 * 1024


def app_dir() -> Path:
    return Path(sys.executable).parent if getattr(sys, "frozen", False) else Path(__file__).parent


def data_root() -> Path:
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    return Path(base) / APP_NAME


# ------------------------------------------------------------------ configuração
def ensure_env(root: Path) -> Path:
    """Cria a pasta de dados e o astryon.env na primeira execução (token de serviço aleatório)."""
    (root / "data").mkdir(parents=True, exist_ok=True)
    (root / "logs").mkdir(parents=True, exist_ok=True)
    env = root / "astryon.env"
    if not env.exists():
        env.write_text(
            "# Configuração do ASTRYON. Depois de editar, use \"Reiniciar serviços\" no ícone da bandeja.\n"
            "# Telegram, IA (Groq), clima e franquia: veja o .env.example do projeto.\n"
            f"ORBITLINK_API_TOKEN={secrets.token_urlsafe(36)}\n"
            f"ORBITLINK_DATA_DIR={root / 'data'}\n"
            "ORBITLINK_HOST=127.0.0.1\n"
            "ORBITLINK_COOKIE_SECURE=false\n"
            "ORBITLINK_TIMEZONE=America/Sao_Paulo\n"
            "ORBITLINK_TELEGRAM_BOT_TOKEN=\n"
            "ORBITLINK_TELEGRAM_CHAT_ID=\n"
            "ORBITLINK_GROQ_API_KEY=\n",
            encoding="utf-8",
        )
    return env


def read_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        if v.strip():
            out[k.strip()] = v.strip()
    return out


def child_env(root: Path) -> dict[str, str]:
    env_file = ensure_env(root)
    env = dict(os.environ)
    env.update(read_env(env_file))
    env.update({"ORBITLINK_ENV_FILE": str(env_file), "NODE_ENV": "production", "PORT": "3000",
                "HOSTNAME": "127.0.0.1", "ORBITLINK_AGENT_URL": "http://127.0.0.1:8787"})
    return env


def commands(base: Path) -> dict[str, list[str]]:
    return {
        "agente": [str(base / "agent" / "astryon-agent.exe"), "serve"],
        "painel": [str(base / "web" / "node.exe"), str(base / "web" / "apps" / "web" / "server.js")],
    }


# ------------------------------------------------------------------ processos
class Supervisor:
    def __init__(self, base: Path, root: Path) -> None:
        self.base, self.root = base, root
        self.procs: dict[str, subprocess.Popen[bytes] | None] = {"agente": None, "painel": None}
        self.failures = {"agente": 0, "painel": 0}
        self.stopping = False
        self.lock = threading.Lock()

    def _log(self, name: str) -> Any:
        path = self.root / "logs" / f"{name}.log"
        if path.exists() and path.stat().st_size > LOG_MAX:
            path.replace(path.with_suffix(".log.1"))
        return path.open("ab")

    def start(self, name: str) -> None:
        cmd = commands(self.base)[name]
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        cwd = str(Path(cmd[1]).parent) if name == "painel" else str(self.base / "agent")
        log = self._log(name)
        self.procs[name] = subprocess.Popen(cmd, cwd=cwd, env=child_env(self.root), stdout=log, stderr=log,
                                            creationflags=flags)

    def start_all(self) -> None:
        with self.lock:
            for name in self.procs:
                self.start(name)

    def stop_all(self) -> None:
        with self.lock:
            for p in self.procs.values():
                if p and p.poll() is None:
                    p.terminate()
            for p in self.procs.values():
                if p:
                    try:
                        p.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        p.kill()

    def restart_all(self) -> None:
        self.stop_all()
        self.failures = {k: 0 for k in self.failures}
        self.start_all()

    def watch(self) -> None:
        while not self.stopping:
            with self.lock:
                dead = [n for n, p in self.procs.items() if p is not None and p.poll() is not None]
            for name in dead:
                self.failures[name] += 1
                time.sleep(min(60, 2 ** self.failures[name]))  # espera fora da trava: o menu continua respondendo
                with self.lock:
                    p = self.procs[name]
                    if not self.stopping and p is not None and p.poll() is not None:
                        self.start(name)
            time.sleep(5)


def http_ok(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=3) as r:  # noqa: S310 - só 127.0.0.1
            return 200 <= r.status < 400
    except OSError:
        return False


def health() -> str:
    """'ok' quando o agente e o painel respondem; 'fora' caso contrário."""
    return "ok" if http_ok(AGENT_URL) and http_ok(PANEL_URL + "/login") else "fora"


# ------------------------------------------------------------------ Windows
RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"


def autostart_enabled() -> bool:
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as k:
            winreg.QueryValueEx(k, APP_NAME)
            return True
    except OSError:
        return False


def set_autostart(on: bool) -> None:
    import winreg

    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as k:
        if on:
            winreg.SetValueEx(k, APP_NAME, 0, winreg.REG_SZ, f'"{sys.executable}" --minimizado')
        else:
            try:
                winreg.DeleteValue(k, APP_NAME)
            except OSError:
                pass


def single_instance() -> bool:
    """True se esta é a única instância (mutex nomeado do Windows)."""
    import ctypes

    ctypes.windll.kernel32.CreateMutexW(None, False, "Local\\ASTRYON-launcher")
    return ctypes.windll.kernel32.GetLastError() != 183  # ERROR_ALREADY_EXISTS


def icon_image(state: str) -> Any:
    from PIL import Image, ImageDraw

    base = Image.open(app_dir() / "astryon.ico").convert("RGBA").resize((64, 64))
    color = {"ok": (34, 197, 94), "fora": (239, 68, 68)}[state]
    d = ImageDraw.Draw(base)
    d.ellipse((40, 40, 62, 62), fill=color, outline=(5, 8, 15), width=3)
    return base


def main() -> int:
    if sys.platform != "win32":
        print("O iniciador da bandeja é só para Windows.")
        return 1
    root, base = data_root(), app_dir()
    minimized = "--minimizado" in sys.argv
    if not single_instance():
        webbrowser.open(PANEL_URL)
        return 0
    import pystray

    sup = Supervisor(base, root)
    sup.start_all()
    threading.Thread(target=sup.watch, daemon=True).start()

    def open_panel(*_: Any) -> None:
        webbrowser.open(PANEL_URL)

    def toggle_autostart(*_: Any) -> None:
        set_autostart(not autostart_enabled())

    def quit_app(icon: Any, *_: Any) -> None:
        sup.stopping = True
        sup.stop_all()
        icon.stop()

    menu = pystray.Menu(
        pystray.MenuItem("Abrir painel", open_panel, default=True),
        pystray.MenuItem("Reiniciar serviços", lambda *_: sup.restart_all()),
        pystray.MenuItem("Ver logs", lambda *_: os.startfile(root / "logs")),  # type: ignore[attr-defined]
        pystray.MenuItem("Editar configurações", lambda *_: os.startfile(root / "astryon.env")),  # type: ignore[attr-defined]
        pystray.MenuItem("Iniciar com o Windows", toggle_autostart, checked=lambda _: autostart_enabled()),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Sair", quit_app),
    )
    icon = pystray.Icon(APP_NAME, icon_image("fora"), "ASTRYON · iniciando", menu)

    def monitor() -> None:
        opened = minimized
        while not sup.stopping:
            st = health()
            icon.icon = icon_image(st)
            icon.title = "ASTRYON · no ar" if st == "ok" else "ASTRYON · serviço fora do ar"
            if st != "fora" and not opened:
                open_panel()
                opened = True
            time.sleep(15)

    threading.Thread(target=monitor, daemon=True).start()
    icon.run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
