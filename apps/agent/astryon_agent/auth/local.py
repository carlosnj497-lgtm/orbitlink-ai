"""Autenticação local: usuário administrador com senha (scrypt) e sessões opacas com expiração.

Sessões ficam armazenadas apenas como hash SHA-256. O token claro só existe no cookie httpOnly
mantido pelo servidor Next.js.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import time
from collections import defaultdict, deque
from typing import Any

from ..storage.db import Database, now_ts

SESSION_TTL_S = 12 * 3600
MIN_PASSWORD_LEN = 10
_N, _R, _P = 2**14, 8, 1


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return f"scrypt${_N}${_R}${_P}${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt_b64, dk_b64 = stored.split("$")
        if algo != "scrypt":
            return False
        dk = hashlib.scrypt(password.encode("utf-8"), salt=base64.b64decode(salt_b64), n=int(n), r=int(r), p=int(p),
                            dklen=32)
        return hmac.compare_digest(dk, base64.b64decode(dk_b64))
    except (ValueError, TypeError):
        return False


# Hash fictício calculado uma vez: o login de um usuário inexistente custa o mesmo único scrypt que o de um
# usuário real com senha errada, e o tempo de resposta não revela quais nomes existem.
_DUMMY_HASH = hash_password(secrets.token_urlsafe(16))


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def has_users(db: Database) -> bool:
    return bool(db.scalar("SELECT COUNT(*) FROM local_users"))


def setup_admin(db: Database, username: str, password: str) -> int:
    if len(password) < MIN_PASSWORD_LEN:
        raise ValueError(f"A senha precisa de pelo menos {MIN_PASSWORD_LEN} caracteres.")
    with db.tx() as c:
        if c.execute("SELECT COUNT(*) FROM local_users").fetchone()[0]:
            raise PermissionError("O administrador já foi configurado.")
        cur = c.execute("INSERT INTO local_users (username, password_hash, role, created_at) VALUES (?, ?, 'admin', ?)",
                        (username, hash_password(password), now_ts()))
        return int(cur.lastrowid or 0)


def change_password(db: Database, user_id: int, old: str, new: str) -> None:
    row = db.one("SELECT password_hash FROM local_users WHERE id = ?", (user_id,))
    if row is None or not verify_password(old, row["password_hash"]):
        raise PermissionError("Senha atual incorreta.")
    if len(new) < MIN_PASSWORD_LEN:
        raise ValueError(f"A senha precisa de pelo menos {MIN_PASSWORD_LEN} caracteres.")
    with db.tx() as c:
        c.execute("UPDATE local_users SET password_hash = ? WHERE id = ?", (hash_password(new), user_id))
        c.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))


def login(db: Database, username: str, password: str, user_agent: str | None = None) -> tuple[str, int] | None:
    row = db.one("SELECT id, password_hash FROM local_users WHERE username = ?", (username,))
    if row is None:
        verify_password(password, _DUMMY_HASH)
        return None
    if not verify_password(password, row["password_hash"]):
        return None
    token = secrets.token_urlsafe(32)
    expires = now_ts() + SESSION_TTL_S
    db.execute("INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)",
               (_token_hash(token), row["id"], now_ts(), expires, (user_agent or "")[:200]))
    return token, expires


def validate_session(db: Database, token: str | None) -> dict[str, Any] | None:
    if not token:
        return None
    return db.one(
        """SELECT u.id, u.username, u.role, s.expires_at FROM sessions s JOIN local_users u ON u.id = s.user_id
           WHERE s.token_hash = ? AND s.expires_at > ?""",
        (_token_hash(token), now_ts()),
    )


def logout(db: Database, token: str) -> None:
    db.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))


class RateLimiter:
    """Janela deslizante simples em memória."""

    def __init__(self, max_events: int, window_s: float) -> None:
        self.max = max_events
        self.window = window_s
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        if len(self._hits) > 1024:
            self._prune(now)  # chaves antigas (IPs que já foram embora) não ficam na memória para sempre
        q = self._hits[key]
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.max:
            return False
        q.append(now)
        return True

    def exceeded(self, key: str) -> bool:
        """True se a chave já atingiu o limite na janela atual (sem contar um novo evento)."""
        now = time.monotonic()
        q = self._hits.get(key)
        if not q:
            return False
        while q and now - q[0] > self.window:
            q.popleft()
        return len(q) >= self.max

    def _prune(self, now: float) -> None:
        for k in [k for k, q in self._hits.items() if not q or now - q[-1] > self.window]:
            del self._hits[k]

    def reset(self, key: str) -> None:
        """Zera a contagem (login certo): o limite existe contra senhas erradas, não contra o próprio usuário."""
        self._hits.pop(key, None)
