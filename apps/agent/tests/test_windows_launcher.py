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
