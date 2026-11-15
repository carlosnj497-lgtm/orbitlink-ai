#!/usr/bin/env python3
"""Assinatura Ed25519 do latest.json da atualização automática do Windows.

  keygen                     gera um par de chaves NOVO e imprime as duas partes (nada é gravado em disco).
                             Privada -> secret RELEASE_SIGNING_KEY do GitHub. Pública -> variável
                             ASTRYON_UPDATE_PUBKEY (vai embutida no instalador; não é segredo).
  sign VERSION URL SETUP.exe imprime o latest.json assinado. Lê a chave privada de RELEASE_SIGNING_KEY.
  verify LATEST.json PUBKEY  confere um latest.json (útil antes de publicar).

O formato assinado é o de packaging/windows/launcher.py:signed_message. Requer `cryptography`
(packaging/windows/requirements-sign.txt).
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import sys
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

DOMAIN = "astryon-update-v1"


def message(version: str, url: str, sha256: str) -> bytes:
    return f"{DOMAIN}\n{version}\n{url}\n{sha256}\n".encode()


def b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode()


def keygen() -> None:
    key = Ed25519PrivateKey.generate()
    priv = key.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption())
    pub = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    print("RELEASE_SIGNING_KEY (secret, NUNCA commite):", b64(priv))
    print("ASTRYON_UPDATE_PUBKEY (variável pública):   ", b64(pub))


def sign(version: str, url: str, setup: str) -> None:
    raw = os.environ.get("RELEASE_SIGNING_KEY", "").strip()
    if not raw:
        sys.exit("RELEASE_SIGNING_KEY vazio")
    key = Ed25519PrivateKey.from_private_bytes(base64.b64decode(raw, validate=True))
    sha = hashlib.sha256(Path(setup).read_bytes()).hexdigest()
    sig = key.sign(message(version, url, sha))
    print(json.dumps({"version": version, "url": url, "sha256": sha, "signature": b64(sig)}, indent=2))


def verify(latest: str, pubkey: str) -> None:
    info = json.loads(Path(latest).read_text(encoding="utf-8-sig"))
    key = Ed25519PublicKey.from_public_bytes(base64.b64decode(pubkey, validate=True))
    key.verify(base64.b64decode(info["signature"], validate=True), message(info["version"], info["url"], info["sha256"]))
    print("assinatura OK")


if __name__ == "__main__":
    cmd, *args = sys.argv[1:] or ["-h"]
    if cmd == "keygen" and not args:
        keygen()
    elif cmd == "sign" and len(args) == 3:
        sign(*args)
    elif cmd == "verify" and len(args) == 2:
        verify(*args)
    else:
        sys.exit(__doc__)
