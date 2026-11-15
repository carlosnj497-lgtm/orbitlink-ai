"""ASTRYON para Windows: iniciador com ícone na bandeja.

* Prepara %LOCALAPPDATA%\\ASTRYON (dados, logs e astryon.env com token aleatório na primeira execução).
* Sobe o agente (astryon-agent.exe) e o painel (node.exe + server.js) escondidos, só em 127.0.0.1.
* Vigia os dois: se um cair, sobe de novo (com espera crescente).
* Ícone verde (agente e painel respondendo) ou vermelho (algum dos dois fora do ar). A situação da antena
  aparece no próprio painel.
* Menu: Abrir painel, Conectar à conta, Reiniciar serviços, Ver logs, Editar configurações, Iniciar com o Windows,
  Sair. "Conectar à conta" pede o código gerado no painel na nuvem e liga este computador à conta.
* Uma única instância: abrir de novo só abre o navegador.
* Atualização automática (só na versão instalada): de tempos em tempos lê o `latest.json` publicado no
  repositório público de releases. O manifesto precisa estar assinado (Ed25519) pela chave de release cuja
  parte pública foi gravada no build (update.json); sem chave ou com assinatura inválida, nada é baixado. Se
  houver versão mais nova, baixa o instalador (só do mesmo repositório de releases), confere o SHA-256 assinado,
  roda em modo silencioso e fecha; o próprio instalador abre o ASTRYON de novo no fim.

A pasta de dados fica fora da pasta do programa: atualizar ou reinstalar não apaga nada.

Modo portátil (pendrive): com um arquivo `portable.txt` ao lado do ASTRYON.exe, tudo fica na pasta `dados\\`
do próprio pendrive. O caminho é recalculado a cada início (a letra da unidade muda de um PC para outro), a
chave dos segredos fica no pendrive (o DPAPI só vale no mesmo PC/usuário), a coleta grava menos vezes para
poupar o pendrive e a opção "Iniciar com o Windows" some do menu.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
import tempfile
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
UPDATE_FIRST_CHECK_S = 2 * 60  # primeira verificação: alguns minutos depois de abrir
UPDATE_INTERVAL_S = 6 * 60 * 60  # depois, a cada 6 horas
# Destinos aceitos depois dos redirecionamentos do GitHub Releases.
UPDATE_HOSTS = ("https://github.com/", "https://objects.githubusercontent.com/",
                "https://release-assets.githubusercontent.com/")
# Manifesto: https://github.com/<dono>/<repo>/releases/latest/download/latest.json (ou /download/<tag>/latest.json)
MANIFEST_RE = re.compile(r"https://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)/releases/"
                         r"(?:latest/download|download/[A-Za-z0-9_.+-]+)/latest\.json")
SIGNATURE_DOMAIN = "astryon-update-v1"


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


# ------------------------------------------------------------------ atualização automática
def update_config(base: Path) -> dict[str, str]:
    """Versão instalada, endereço do latest.json e chave pública de release (base64, Ed25519), gravados no build
    (update.json). Faltando qualquer um = sem atualização automática."""
    try:
        data = json.loads((base / "update.json").read_text(encoding="utf-8-sig"))
        return {k: str(data[k]) for k in ("version", "manifest", "pubkey") if data.get(k)}
    except (OSError, ValueError):
        return {}


def parse_version(v: str) -> tuple[int, ...]:
    """'v0.2.10' -> (0, 2, 10). Sufixos como '-dev.5' são ignorados; texto inválido -> ()."""
    m = re.match(r"v?(\d+(?:\.\d+)*)", v.strip())
    return tuple(int(x) for x in m.group(1).split(".")) if m else ()


def is_newer(remote: str, local: str) -> bool:
    r, loc = parse_version(remote), parse_version(local)
    if not r:
        return False
    if loc and "-" in local and r == loc:
        return True  # 0.2.0 final substitui 0.2.0-dev.N
    return r > loc


def trusted_url(url: str) -> bool:
    """Destino final aceitável (depois de redirecionamentos) para o manifesto e o instalador."""
    return url.startswith(UPDATE_HOSTS)


def release_prefix(manifest: str) -> str | None:
    """Prefixo obrigatório do instalador: o mesmo repositório de releases do manifesto."""
    m = MANIFEST_RE.fullmatch(manifest)
    return f"https://github.com/{m.group(1)}/{m.group(2)}/releases/download/" if m else None


def signed_message(version: str, url: str, sha256: str) -> bytes:
    """Bytes assinados pelo workflow de release (mesmo formato em scripts/sign-update-manifest.py)."""
    return f"{SIGNATURE_DOMAIN}\n{version}\n{url}\n{sha256}\n".encode()


def verify_signature(pubkey_b64: str, signature_b64: str, message: bytes) -> bool:
    try:
        from cryptography.exceptions import InvalidSignature
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

        key = Ed25519PublicKey.from_public_bytes(base64.b64decode(pubkey_b64, validate=True))
        key.verify(base64.b64decode(signature_b64, validate=True), message)
        return True
    except (InvalidSignature, ValueError, TypeError):
        return False


def fetch_json(url: str) -> dict[str, Any]:
    req = urllib.request.Request(url, headers={"User-Agent": "ASTRYON-updater"})  # noqa: S310 - trusted_url
    with urllib.request.urlopen(req, timeout=20) as r:  # noqa: S310 - só https do GitHub (trusted_url)
        if not trusted_url(r.geturl()):
            raise ValueError("redirecionamento para endereço não confiável")
        data = json.loads(r.read(256 * 1024).decode("utf-8-sig"))
    return data if isinstance(data, dict) else {}


def check_update(base: Path) -> dict[str, str] | None:
    """Devolve {'version', 'url', 'sha256'} se houver versão mais nova publicada E assinada; senão None."""
    cfg = update_config(base)
    prefix = release_prefix(cfg.get("manifest", ""))
    if not prefix or not cfg.get("version") or not cfg.get("pubkey"):
        return None
    info = fetch_json(cfg["manifest"])
    version, url, sha = str(info.get("version", "")), str(info.get("url", "")), str(info.get("sha256", "")).lower()
    if not (url.startswith(prefix) and ".." not in url and re.fullmatch(r"[0-9a-f]{64}", sha)):
        return None
    if not verify_signature(cfg["pubkey"], str(info.get("signature", "")), signed_message(version, url, sha)):
        return None
    if not is_newer(version, cfg["version"]):
        return None
    return {"version": version, "url": url, "sha256": sha}


def download_installer(info: dict[str, str], dest_dir: Path | None = None) -> Path:
    """Baixa o instalador e confere o SHA-256. Arquivo corrompido ou adulterado é apagado e gera erro."""
    # pasta nova e exclusiva: ninguém deixa um .exe pronto com o mesmo nome esperando
    dest_dir = dest_dir or Path(tempfile.mkdtemp(prefix="astryon-update-"))
    dest = dest_dir / f"ASTRYON-Setup-{re.sub(r'[^0-9A-Za-z.-]', '', info['version'])}.exe"
    h = hashlib.sha256()
    req = urllib.request.Request(info["url"], headers={"User-Agent": "ASTRYON-updater"})  # noqa: S310 - trusted_url
    with urllib.request.urlopen(req, timeout=60) as r, dest.open("wb") as f:  # noqa: S310 - trusted_url
        if not trusted_url(r.geturl()):
            raise ValueError("redirecionamento para endereço não confiável")
        while chunk := r.read(1024 * 1024):
            h.update(chunk)
            f.write(chunk)
    if h.hexdigest() != info["sha256"]:
        dest.unlink(missing_ok=True)
        raise ValueError("SHA-256 do instalador não confere")
    return dest


def run_installer(setup: Path) -> None:
    """Instala em silêncio; /atualizacao=1 faz o instalador abrir o ASTRYON de novo no fim."""
    flags = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    args = [str(setup), "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CLOSEAPPLICATIONS", "/atualizacao=1"]
    subprocess.Popen(args, creationflags=flags, close_fds=True)  # noqa: S603 - SHA-256 assinado (Ed25519)


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
        path.parent.mkdir(parents=True, exist_ok=True)  # 1ª execução: a pasta ainda não existe
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
    ensure_env(root, is_portable)  # cria dados\, logs\ e astryon.env antes de iniciar os serviços
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

    updating = threading.Lock()
    can_update = not is_portable and bool(update_config(base).get("manifest"))

    def update_now(manual: bool = False) -> None:
        if not updating.acquire(blocking=False):
            return
        try:
            info = check_update(base)
            if not info:
                if manual:
                    show_message(f"Você já está na versão mais recente ({update_config(base).get('version', '?')}).")
                return
            icon.notify(f"Baixando a versão {info['version']}…", APP_NAME)
            setup = download_installer(info)
            icon.notify(f"Instalando a versão {info['version']}. O ASTRYON volta sozinho em instantes.", APP_NAME)
            run_installer(setup)
            quit_app(icon)
        except Exception as exc:  # noqa: BLE001 - sem rede, GitHub fora etc.: tenta de novo mais tarde
            with (root / "logs" / "atualizacao.log").open("a", encoding="utf-8") as f:
                f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {type(exc).__name__}: {exc}\n")
            if manual:
                show_message("Não foi possível procurar atualizações agora. Tente mais tarde.", error=True)
        finally:
            updating.release()

    def updater() -> None:
        time.sleep(UPDATE_FIRST_CHECK_S)
        while not sup.stopping:
            update_now()
            time.sleep(UPDATE_INTERVAL_S)

    menu = pystray.Menu(
        pystray.MenuItem("Abrir painel", open_panel, default=True),
        pystray.MenuItem("Conectar à conta…", connect_account),
        pystray.MenuItem("Reiniciar serviços", lambda *_: sup.restart_all()),
        pystray.MenuItem("Ver logs", lambda *_: os.startfile(root / "logs")),  # type: ignore[attr-defined]
        pystray.MenuItem("Editar configurações", lambda *_: os.startfile(root / "astryon.env")),  # type: ignore[attr-defined]
        pystray.MenuItem("Iniciar com o Windows", toggle_autostart, checked=lambda _: autostart_enabled(),
                         visible=not is_portable),
        pystray.MenuItem("Procurar atualizações",
                         lambda *_: threading.Thread(target=update_now, args=(True,), daemon=True).start(),
                         visible=can_update),
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
    if can_update:
        threading.Thread(target=updater, daemon=True).start()
    icon.run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
