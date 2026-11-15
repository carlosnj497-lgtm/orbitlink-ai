"""Iniciador do Windows (packaging/windows/launcher.py): partes que não dependem do Windows, incluindo o modo
portátil (pendrive)."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

LAUNCHER = Path(__file__).resolve().parents[3] / "packaging" / "windows" / "launcher.py"


@pytest.fixture
def launcher():
    spec = importlib.util.spec_from_file_location("astryon_launcher", LAUNCHER)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(mod)
    return mod


def test_instalado_guarda_dados_no_localappdata(launcher, tmp_path, monkeypatch):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local"))
    base = tmp_path / "Programas" / "ASTRYON"
    base.mkdir(parents=True)
    assert not launcher.portable(base)
    root = launcher.data_root(base)
    assert root == tmp_path / "local" / "ASTRYON"
    env = launcher.child_env(root, base)
    assert "ASTRYON_PORTABLE" not in env
    assert env["ASTRYON_DATA_DIR"] == str(root / "data")
    assert "ASTRYON_DATA_DIR=" in (root / "astryon.env").read_text(encoding="utf-8")


def test_portatil_guarda_tudo_no_pendrive(launcher, tmp_path, monkeypatch):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local"))
    monkeypatch.delenv("ASTRYON_PORTABLE", raising=False)
    base = tmp_path / "E" / "ASTRYON"
    base.mkdir(parents=True)
    (base / "portable.txt").write_text("x", encoding="utf-8")
    assert launcher.portable(base)
    root = launcher.data_root(base)
    assert root == base / "dados"
    env = launcher.child_env(root, base)
    assert env["ASTRYON_PORTABLE"] == "1"
    assert env["ASTRYON_DATA_DIR"] == str(root / "data")
    assert env["ASTRYON_SECRETS_KEY_FILE"] == str(root / "data" / "secrets.key")
    assert env["ASTRYON_STATUS_INTERVAL_S"] == "30"  # menos gravações no pendrive
    assert env["ASTRYON_RETENTION_RAW_DAYS"] == "2"
    # O caminho não fica gravado no arquivo: a letra da unidade muda de um PC para outro.
    text = (root / "astryon.env").read_text(encoding="utf-8")
    assert "\nASTRYON_DATA_DIR=" not in text
    assert not (tmp_path / "local").exists()


def test_portatil_ignora_caminho_antigo_e_respeita_ajustes(launcher, tmp_path):
    base = tmp_path / "F" / "ASTRYON"
    (base / "dados").mkdir(parents=True)
    (base / "portable.txt").write_text("x", encoding="utf-8")
    (base / "dados" / "astryon.env").write_text(
        "ASTRYON_API_TOKEN=abc\nASTRYON_DATA_DIR=E:\\ASTRYON\\dados\\data\nASTRYON_STATUS_INTERVAL_S=15\n",
        encoding="utf-8")
    root = launcher.data_root(base)
    env = launcher.child_env(root, base)
    assert env["ASTRYON_DATA_DIR"] == str(root / "data")  # letra antiga (E:) não vale mais
    assert env["ASTRYON_STATUS_INTERVAL_S"] == "15"  # ajuste da pessoa vence o padrão do pendrive
    assert env["ASTRYON_API_TOKEN"] == "abc"


def test_segredo_portatil_abre_com_a_chave_do_pendrive(tmp_path, monkeypatch):
    from astryon_agent.auth import secrets_store

    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setenv("ASTRYON_PORTABLE", "1")
    key = tmp_path / "dados" / "data" / "secrets.key"
    monkeypatch.setenv("ASTRYON_SECRETS_KEY_FILE", str(key))
    stored = secrets_store.protect("token-da-conta")
    assert stored.startswith("fernet:")  # não DPAPI: precisa abrir em outro PC
    assert key.exists()
    assert secrets_store.unprotect(stored) == "token-da-conta"


def test_log_na_primeira_execucao_cria_a_pasta(launcher, tmp_path):
    """Primeira execução: a pasta logs\\ ainda não existe e o iniciador não pode quebrar ao abrir o log."""
    root = tmp_path / "local" / "ASTRYON"
    sup = launcher.Supervisor(tmp_path / "app", root)
    with sup._log("agente") as f:
        f.write(b"ok")
    assert (root / "logs" / "agente.log").read_bytes() == b"ok"


# ------------------------------------------------------------------ atualização automática
def test_comparacao_de_versoes(launcher):
    assert launcher.is_newer("0.2.0", "0.1.0")
    assert launcher.is_newer("v0.10.0", "0.9.9")
    assert launcher.is_newer("0.2.0", "0.2.0-dev.7")  # versão final substitui a de teste
    assert not launcher.is_newer("0.2.0", "0.2.0")
    assert not launcher.is_newer("0.1.9", "0.2.0")
    assert not launcher.is_newer("lixo", "0.1.0")


REPO_MANIFEST = "https://github.com/x/astryon-releases/releases/latest/download/latest.json"
REPO_DL = "https://github.com/x/astryon-releases/releases/download/"


def _keys():
    import base64

    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    key = Ed25519PrivateKey.generate()
    pub = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return key, base64.b64encode(pub).decode()


def _signed(launcher, key, version, url, sha):
    import base64

    sig = key.sign(launcher.signed_message(version, url, sha))
    return {"version": version, "url": url, "sha256": sha, "signature": base64.b64encode(sig).decode()}


def _instalado(tmp_path, version="0.1.0", manifest=REPO_MANIFEST, pubkey=None):
    import json

    base = tmp_path / "app"
    base.mkdir(exist_ok=True)
    cfg = {"version": version, "manifest": manifest}
    if pubkey:
        cfg["pubkey"] = pubkey
    (base / "update.json").write_text(json.dumps(cfg), encoding="utf-8-sig")
    return base


def test_sem_update_json_nao_procura_atualizacao(launcher, tmp_path, monkeypatch):
    monkeypatch.setattr(launcher, "fetch_json", lambda url: pytest.fail("não deveria acessar a rede"))
    assert launcher.check_update(tmp_path) is None


def test_sem_chave_publica_nao_procura_atualizacao(launcher, tmp_path, monkeypatch):
    monkeypatch.setattr(launcher, "fetch_json", lambda url: pytest.fail("não deveria acessar a rede"))
    assert launcher.check_update(_instalado(tmp_path)) is None


def test_encontra_versao_nova_assinada_e_recusa_enderecos_estranhos(launcher, tmp_path, monkeypatch):
    key, pub = _keys()
    sha = "a" * 64
    url = REPO_DL + "v0.2.0/s.exe"
    remote = _signed(launcher, key, "0.2.0", url, sha)
    monkeypatch.setattr(launcher, "fetch_json", lambda u: dict(remote))
    base = _instalado(tmp_path, pubkey=pub)
    assert launcher.check_update(base) == {"version": "0.2.0", "url": url, "sha256": sha}

    # mesmo assinado, o instalador precisa vir do MESMO repositório de releases
    for bad in ("https://exemplo-malicioso.com/s.exe", "https://github.com/x/s.exe",
                "https://github.com/outro/astryon-releases/releases/download/v0.2.0/s.exe",
                REPO_DL + "../../../outro/x/releases/download/v1/s.exe"):
        remote.clear()
        remote.update(_signed(launcher, key, "0.2.0", bad, sha))
        assert launcher.check_update(base) is None, bad
    remote.clear()
    remote.update(_signed(launcher, key, "0.2.0", url, "curto"))
    assert launcher.check_update(base) is None
    assert launcher.check_update(_instalado(tmp_path, version="0.2.0", pubkey=pub)) is None  # já atualizado
    assert launcher.check_update(_instalado(tmp_path, manifest="http://github.com/latest.json", pubkey=pub)) is None
    assert launcher.check_update(_instalado(tmp_path, manifest="https://github.com/x/latest.json", pubkey=pub)) is None


def test_manifesto_sem_assinatura_ou_adulterado_e_recusado(launcher, tmp_path, monkeypatch):
    key, pub = _keys()
    other, _ = _keys()
    url = REPO_DL + "v0.2.0/s.exe"
    base = _instalado(tmp_path, pubkey=pub)
    cases = [
        {"version": "0.2.0", "url": url, "sha256": "a" * 64},                                   # sem assinatura
        _signed(launcher, other, "0.2.0", url, "a" * 64),                                        # outra chave
        {**_signed(launcher, key, "0.2.0", url, "a" * 64), "sha256": "b" * 64},                  # hash trocado
        {**_signed(launcher, key, "0.2.0", url, "a" * 64), "version": "9.9.9"},                  # versão trocada
        {**_signed(launcher, key, "0.2.0", url, "a" * 64), "signature": "não-é-base64!"},
    ]
    for remote in cases:
        monkeypatch.setattr(launcher, "fetch_json", lambda u, r=remote: dict(r))
        assert launcher.check_update(base) is None, remote


def test_assinatura_do_script_de_release_bate_com_o_launcher(launcher, tmp_path, monkeypatch, capsys):
    import base64
    import json
    import runpy

    from cryptography.hazmat.primitives import serialization

    key, pub = _keys()
    raw = key.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption())
    setup = tmp_path / "s.exe"
    setup.write_bytes(b"instalador")
    url = REPO_DL + "v0.2.0/s.exe"
    monkeypatch.setenv("RELEASE_SIGNING_KEY", base64.b64encode(raw).decode())
    monkeypatch.setattr(sys, "argv", ["release-signing.py", "sign", "0.2.0", url, str(setup)])
    runpy.run_path(str(LAUNCHER.parents[2] / "scripts" / "release-signing.py"), run_name="__main__")
    remote = json.loads(capsys.readouterr().out)
    monkeypatch.setattr(launcher, "fetch_json", lambda u: dict(remote))
    info = launcher.check_update(_instalado(tmp_path, pubkey=pub))
    assert info and info["sha256"] == __import__("hashlib").sha256(b"instalador").hexdigest()


class _Resp:
    def __init__(self, data: bytes, url: str = "https://objects.githubusercontent.com/x"):
        self._data, self._url = data, url

    def read(self, n: int = -1) -> bytes:
        chunk, self._data = self._data[: n if n > 0 else None], self._data[n if n > 0 else len(self._data):]
        return chunk

    def geturl(self) -> str:
        return self._url

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_download_confere_o_sha256(launcher, tmp_path, monkeypatch):
    import hashlib

    payload = b"instalador" * 1000
    info = {"version": "0.2.0", "url": "https://github.com/x/s.exe", "sha256": hashlib.sha256(payload).hexdigest()}
    monkeypatch.setattr(launcher.urllib.request, "urlopen", lambda req, timeout: _Resp(payload))
    dest = launcher.download_installer(info, tmp_path)
    assert dest.name == "ASTRYON-Setup-0.2.0.exe" and dest.read_bytes() == payload

    info["sha256"] = "0" * 64
    with pytest.raises(ValueError, match="SHA-256"):
        launcher.download_installer(info, tmp_path)
    assert not dest.exists()  # arquivo adulterado é apagado
