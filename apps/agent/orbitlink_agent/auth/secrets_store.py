"""Proteção de segredos em repouso.

* Windows: DPAPI (CryptProtectData, escopo do usuário) via ctypes.
* Linux/macOS: Fernet (AES-128-CBC + HMAC-SHA256, pacote `cryptography`) com chave em arquivo SEPARADO dos dados
  (`ORBITLINK_SECRETS_KEY_FILE`, padrão `/etc/orbitlink/secrets.key` no servidor; o instalador cria com 0640
  root:orbitlink). Assim um backup do diretório de dados não carrega a chave.
* Formato antigo `plain:` continua legível (migração transparente).
"""

from __future__ import annotations

import base64
import os
import sys
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from cryptography.fernet import Fernet


def _dpapi(data: bytes, protect: bool) -> bytes:
    if sys.platform != "win32":  # também faz o mypy no Linux não procurar ctypes.windll
        raise OSError("DPAPI só existe no Windows")
    import ctypes
    from ctypes import wintypes

    class Blob(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]

    buf = ctypes.create_string_buffer(data, len(data))
    blob_in = Blob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))
    blob_out = Blob()
    crypt32 = ctypes.windll.crypt32
    entropy = b"orbitlink-ai"
    ebuf = ctypes.create_string_buffer(entropy, len(entropy))
    blob_ent = Blob(len(entropy), ctypes.cast(ebuf, ctypes.POINTER(ctypes.c_char)))
    fn = crypt32.CryptProtectData if protect else crypt32.CryptUnprotectData
    ok = fn(ctypes.byref(blob_in), None, ctypes.byref(blob_ent), None, None, 0x01, ctypes.byref(blob_out))
    if not ok:
        raise OSError("DPAPI falhou")
    try:
        return ctypes.string_at(blob_out.pbData, blob_out.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(blob_out.pbData)


def key_file() -> Path:
    explicit = os.environ.get("ORBITLINK_SECRETS_KEY_FILE")
    if explicit:
        return Path(explicit)
    from ..config import get_settings

    return get_settings().data_dir / "secrets.key"


def _fernet() -> Fernet:
    from cryptography.fernet import Fernet

    path = key_file()
    if not path.exists():
        # Desenvolvimento: cria a chave com permissão restrita. No servidor o instalador já a criou em /etc/orbitlink.
        path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(Fernet.generate_key())
    return Fernet(path.read_bytes().strip())


def protect(secret: str) -> str:
    if sys.platform == "win32":
        return "dpapi:" + base64.b64encode(_dpapi(secret.encode("utf-8"), True)).decode()
    token = _fernet().encrypt(secret.encode("utf-8"))
    return "fernet:" + token.decode()


def unprotect(stored: str) -> str:
    if stored.startswith("dpapi:"):
        return _dpapi(base64.b64decode(stored[6:]), False).decode("utf-8")
    if stored.startswith("fernet:"):
        plain = _fernet().decrypt(stored[7:].encode())
        return plain.decode("utf-8")
    if stored.startswith("plain:"):
        return stored[6:]
    raise ValueError("formato de segredo desconhecido")
