"""ASTRYON para Windows: iniciador com ícone na bandeja.

* Prepara %LOCALAPPDATA%\\ASTRYON (dados, logs e astryon.env com token aleatório na primeira execução).
* Sobe o agente (astryon-agent.exe) e o painel (node.exe + server.js) escondidos, só em 127.0.0.1.
* Vigia os dois: se um cair, sobe de novo (com espera crescente).
* Ícone verde (agente e painel respondendo) ou vermelho (algum dos dois fora do ar). A situação da antena
  aparece no próprio painel.
* Menu: Abrir painel, Conectar à conta, Reiniciar serviços, Ver logs, Editar configurações, Iniciar com o Windows,
  Sair. "Conectar à conta" pede o código gerado no painel na nuvem e liga este computador à conta.
* Uma única instância: abrir de novo só abre o navegador.

A pasta de dados fica fora da pasta do programa: atualizar ou reinstalar não apaga nada.

Modo portátil (pendrive): com um arquivo `portable.txt` ao lado do ASTRYON.exe, tudo fica na pasta `dados\\`
do próprio pendrive. O caminho é recalculado a cada início (a letra da unidade muda de um PC para outro), a
chave dos segredos fica no pendrive (o DPAPI só vale no mesmo PC/usuário), a coleta grava menos vezes para
poupar o pendrive e a opção "Iniciar com o Windows" some do menu.
"""

from __future__ import annotations

import json
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


def portable(base: Path | None = None) -> bool:
    """Modo pendrive: existe `portable.txt` ao lado do executável."""
    return ((base or app_dir()) / "portable.txt").exists()


def data_root(base: Path | None = None) -> Path:
    base = base or app_dir()
    if portable(base):
        return base / "dados"
    local = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    return Path(local) / APP_NAME


# Menos gravações no pendrive (memória flash barata gasta com escrita contínua). Valores só valem se a pessoa
# não tiver definido outro no astryon.env.
PORTABLE_DEFAULTS = {
    "ASTRYON_STATUS_INTERVAL_S": "30",
    "ASTRYON_HISTORY_INTERVAL_S": "60",
    "ASTRYON_RETENTION_RAW_DAYS": "2",
}


# ------------------------------------------------------------------ configuração
def ensure_env(root: Path, is_portable: bool = False) -> Path:
    """Cria a pasta de dados e o astryon.env na primeira execução (token de serviço aleatório)."""
    (root / "data").mkdir(parents=True, exist_ok=True)
    (root / "logs").mkdir(parents=True, exist_ok=True)
    env = root / "astryon.env"
    if not env.exists():
        # No pendrive a pasta de dados é calculada a cada início (a letra da unidade muda).
        data_line = "# ASTRYON_DATA_DIR: automático (pasta dados\\data do pendrive)\n" if is_portable \
            else f"ASTRYON_DATA_DIR={root / 'data'}\n"
        env.write_text(
            "# Configuração do ASTRYON. Depois de editar, use \"Reiniciar serviços\" no ícone da bandeja.\n"
            "# Telegram, IA (Groq), clima e franquia: veja o .env.example do projeto.\n"
            f"ASTRYON_API_TOKEN={secrets.token_urlsafe(36)}\n"
            + data_line +
            "ASTRYON_HOST=127.0.0.1\n"
            "ASTRYON_COOKIE_SECURE=false\n"
            "ASTRYON_TIMEZONE=America/Sao_Paulo\n"
            "ASTRYON_TELEGRAM_BOT_TOKEN=\n"
            "ASTRYON_TELEGRAM_CHAT_ID=\n"
            "ASTRYON_GROQ_API_KEY=\n",
            encoding="utf-8",
        )
    return env


def cloud_defaults(base: Path) -> dict[str, str]:
    """Endereço e chave pública da nuvem gravados no build (cloud.json); a chave anon do Supabase é pública."""
    try:
        data = json.loads((base / "cloud.json").read_text(encoding="utf-8"))
        return {k: str(v) for k, v in data.items() if k in ("ASTRYON_SUPABASE_URL", "ASTRYON_SUPABASE_ANON_KEY") and v}
    except (OSError, ValueError):
        return {}


def ensure_cloud(env_file: Path, base: Path) -> None:
    """Acrescenta a configuração da nuvem ao astryon.env se ainda não estiver lá (não sobrescreve ajustes)."""
    current = read_env(env_file)
    missing = {k: v for k, v in cloud_defaults(base).items() if k not in current}
    if missing:
        with env_file.open("a", encoding="utf-8") as f:
            f.write("".join(f"{k}={v}\n" for k, v in missing.items()))


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


def child_env(root: Path, base: Path | None = None) -> dict[str, str]:
    base = base or app_dir()
    is_portable = portable(base)
    env_file = ensure_env(root, is_portable)
    ensure_cloud(env_file, base)
    env = dict(os.environ)
    if is_portable:
        env.update(PORTABLE_DEFAULTS)
    env.update(read_env(env_file))
    env.update({"ASTRYON_ENV_FILE": str(env_file), "NODE_ENV": "production", "PORT": "3000",
                "HOSTNAME": "127.0.0.1", "ASTRYON_AGENT_URL": "http://127.0.0.1:8787"})
    if is_portable:
        # Sempre por último: o caminho atual do pendrive vence qualquer letra antiga gravada no arquivo.
        env.update({"ASTRYON_PORTABLE": "1", "ASTRYON_DATA_DIR": str(root / "data"),
                    "ASTRYON_SECRETS_KEY_FILE": str(root / "data" / "secrets.key")})
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
        self.procs[name] = subprocess.Popen(cmd, cwd=cwd, env=child_env(self.root, self.base), stdout=log, stderr=log,
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


def pair_with_code(base: Path, root: Path, code: str) -> tuple[bool, str]:
    """Roda `astryon-agent pair CÓDIGO` com a configuração deste computador. Devolve (ok, mensagem)."""
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        r = subprocess.run([str(base / "agent" / "astryon-agent.exe"), "pair", code.strip()], env=child_env(root, base),
                           capture_output=True, text=True, timeout=60, creationflags=flags)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, f"Não foi possível rodar o agente ({type(exc).__name__})."
    out = (r.stdout or r.stderr or "").strip().splitlines()
    return r.returncode == 0, out[-1] if out else ("Pareado." if r.returncode == 0 else "Falhou.")


def ask_code() -> str | None:
    import tkinter as tk
    from tkinter import simpledialog

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    code = simpledialog.askstring(APP_NAME, "Digite o código gerado em Conta → Conectar a antena\n(ex.: K7QF-2M9X):",
                                  parent=root)
    root.destroy()
    return code


def show_message(text: str, error: bool = False) -> None:
    import tkinter as tk
    from tkinter import messagebox

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    (messagebox.showerror if error else messagebox.showinfo)(APP_NAME, text, parent=root)
    root.destroy()


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
    """True se esta é a única instância (mutex nomeado do Windows). Instalado e portátil usam as mesmas
    portas 3000/8787, então os dois compartilham o mesmo mutex: não dá para rodar ambos ao mesmo tempo."""
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
    base = app_dir()
    root, is_portable = data_root(base), portable(base)
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

    def connect_account(*_: Any) -> None:
        def run() -> None:
            code = ask_code()
            if not code:
                return
            ok, msg = pair_with_code(base, root, code)
            if ok:
                sup.restart_all()
                show_message(msg.replace(" Reinicie o agente para começar a sincronizar.", "") + "\nOs dados começam a aparecer na sua conta em alguns minutos.")
            else:
                show_message(msg, error=True)

        threading.Thread(target=run, daemon=True).start()

    def toggle_autostart(*_: Any) -> None:
        set_autostart(not autostart_enabled())

    def quit_app(icon: Any, *_: Any) -> None:
        sup.stopping = True
        sup.stop_all()
        icon.stop()

    menu = pystray.Menu(
        pystray.MenuItem("Abrir painel", open_panel, default=True),
        pystray.MenuItem("Conectar à conta…", connect_account),
        pystray.MenuItem("Reiniciar serviços", lambda *_: sup.restart_all()),
        pystray.MenuItem("Ver logs", lambda *_: os.startfile(root / "logs")),  # type: ignore[attr-defined]
        pystray.MenuItem("Editar configurações", lambda *_: os.startfile(root / "astryon.env")),  # type: ignore[attr-defined]
        pystray.MenuItem("Iniciar com o Windows", toggle_autostart, checked=lambda _: autostart_enabled(),
                         visible=not is_portable),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Sair", quit_app),
    )
    label = "ASTRYON portátil" if is_portable else "ASTRYON"
    icon = pystray.Icon(APP_NAME, icon_image("fora"), f"{label} · iniciando", menu)

    def monitor() -> None:
        opened = minimized
        while not sup.stopping:
            st = health()
            icon.icon = icon_image(st)
            icon.title = f"{label} · no ar" if st == "ok" else f"{label} · serviço fora do ar"
            if st != "fora" and not opened:
                open_panel()
                opened = True
            time.sleep(15)

    threading.Thread(target=monitor, daemon=True).start()
    icon.run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
