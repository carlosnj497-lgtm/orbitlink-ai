"""Autenticação local: usuário administrador com senha (scrypt) e sessões opacas com expiração.

Sessões ficam armazenadas apenas como hash SHA-256. O token claro só existe no cookie httpOnly
mantido pelo servidor Next.js.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import time
from collections import defaultdict, deque
from typing import Any

from ..storage.db import Database, now_ts

SESSION_TTL_S = 12 * 3600
MIN_PASSWORD_LEN = 10
_N, _R, _P = 2**14, 8, 1

# Código de recuperação por e-mail: curto para digitar, mas com 40 bits de entropia, validade de 15 min,
# uso único e no máximo 5 tentativas — força bruta fica inviável.
RESET_TTL_S = 15 * 60
RESET_MAX_ATTEMPTS = 5
_RESET_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # sem I/O/0/1 para não confundir na leitura
_EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$")


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


def normalize_email(value: str) -> str:
    email = value.strip().lower()
    if len(email) > 200 or not _EMAIL_RE.match(email):
        raise ValueError("Informe um e-mail válido.")
    return email


def setup_admin(db: Database, username: str, password: str, email: str | None = None) -> int:
    if len(password) < MIN_PASSWORD_LEN:
        raise ValueError(f"A senha precisa de pelo menos {MIN_PASSWORD_LEN} caracteres.")
    normalized = normalize_email(email) if email and email.strip() else None
    with db.tx() as c:
        if c.execute("SELECT COUNT(*) FROM local_users").fetchone()[0]:
            raise PermissionError("O administrador já foi configurado.")
        cur = c.execute(
            "INSERT INTO local_users (username, password_hash, role, email, created_at) VALUES (?, ?, 'admin', ?, ?)",
            (username, hash_password(password), normalized, now_ts()),
        )
        return int(cur.lastrowid or 0)


def set_email(db: Database, user_id: int, email: str) -> None:
    normalized = normalize_email(email)
    with db.tx() as c:
        if c.execute("SELECT 1 FROM local_users WHERE id = ?", (user_id,)).fetchone() is None:
            raise ValueError("Usuário não encontrado.")
        c.execute("UPDATE local_users SET email = ? WHERE id = ?", (normalized, user_id))


def email_for(db: Database, user_id: int) -> str | None:
    value = db.scalar("SELECT email FROM local_users WHERE id = ?", (user_id,))
    return str(value) if value else None


def _reset_code() -> str:
    return "".join(secrets.choice(_RESET_ALPHABET) for _ in range(8))


def _normalize_code(code: str) -> str:
    return "".join(ch for ch in code.upper() if ch.isalnum())


def _reset_hash(username: str, code: str) -> str:
    return hashlib.sha256(f"{username}:{code}".encode()).hexdigest()


_RESET_INVALID = "Código inválido ou expirado. Peça um novo."


def _user_by_email(db: Database, email: str) -> dict[str, Any] | None:
    return db.one("SELECT id, username, email FROM local_users WHERE email IS NOT NULL AND lower(email) = ?",
                  (email.strip().lower(),))


def _admin_user(db: Database) -> dict[str, Any] | None:
    """Administrador local (o painel tem um só). É para ele que vai o código pelo Telegram."""
    return db.one("SELECT id, username, email FROM local_users WHERE role = 'admin' ORDER BY id LIMIT 1")


def _issue_code(db: Database, user: dict[str, Any]) -> str:
    """Cria um código novo para o usuário; um pedido novo invalida o código anterior."""
    code = _reset_code()
    now = now_ts()
    with db.tx() as c:
        c.execute("DELETE FROM password_reset_tokens WHERE user_id = ?", (user["id"],))
        c.execute("INSERT INTO password_reset_tokens (user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)",
                  (user["id"], _reset_hash(str(user["username"]), code), now, now + RESET_TTL_S))
    return code


def _consume_code(db: Database, user: dict[str, Any], code: str, new: str) -> None:
    """Confere o código e, se estiver certo, grava a senha e encerra as sessões. Errado não altera nada."""
    if len(new) < MIN_PASSWORD_LEN:
        raise ValueError(f"A senha precisa de pelo menos {MIN_PASSWORD_LEN} caracteres.")
    token = db.one(
        "SELECT id, token_hash, expires_at, attempts FROM password_reset_tokens "
        "WHERE user_id = ? AND used_at IS NULL ORDER BY id DESC LIMIT 1",
        (user["id"],),
    )
    now = now_ts()
    if token is None or int(token["expires_at"]) <= now or int(token["attempts"]) >= RESET_MAX_ATTEMPTS:
        raise ValueError(_RESET_INVALID)
    received = _normalize_code(code)
    ok = bool(received) and hmac.compare_digest(_reset_hash(str(user["username"]), received), str(token["token_hash"]))
    new_hash = hash_password(new) if ok else ""
    error: str | None = None
    with db.tx() as c:
        c.execute("UPDATE password_reset_tokens SET attempts = attempts + 1 WHERE id = ?", (token["id"],))
        if not ok:
            # A tentativa é gravada mesmo errada; ao chegar no limite o código morre.
            if int(token["attempts"]) + 1 >= RESET_MAX_ATTEMPTS:
                c.execute("UPDATE password_reset_tokens SET used_at = ? WHERE id = ?", (now, token["id"]))
            error = _RESET_INVALID
        else:
            c.execute("UPDATE local_users SET password_hash = ? WHERE id = ?", (new_hash, user["id"]))
            c.execute("DELETE FROM sessions WHERE user_id = ?", (user["id"],))
            c.execute("DELETE FROM password_reset_tokens WHERE user_id = ?", (user["id"],))
    if error:
        raise ValueError(error)


def request_password_reset(db: Database, email: str) -> tuple[str, str, str] | None:
    """Cria um código para o e-mail cadastrado.

    Devolve `(usuário, e-mail, código)` ou None quando o endereço não pertence a ninguém — a rota responde
    igual nos dois casos para não revelar quais e-mails existem.
    """
    row = _user_by_email(db, email)
    if row is None or not row["email"]:
        return None
    return str(row["username"]), str(row["email"]), _issue_code(db, row)


def request_telegram_reset(db: Database) -> tuple[str, str] | None:
    """Cria um código para o administrador, que será enviado ao chat do Telegram já configurado."""
    row = _admin_user(db)
    if row is None:
        return None
    return str(row["username"]), _issue_code(db, row)


def confirm_password_reset(db: Database, email: str, code: str, new: str) -> None:
    """Troca a senha usando o código recebido por e-mail. Código errado não altera nada."""
    user = _user_by_email(db, email)
    if user is None:
        if len(new) < MIN_PASSWORD_LEN:
            raise ValueError(f"A senha precisa de pelo menos {MIN_PASSWORD_LEN} caracteres.")
        raise ValueError(_RESET_INVALID)
    _consume_code(db, user, code, new)


def confirm_telegram_reset(db: Database, code: str, new: str) -> None:
    """Troca a senha usando o código entregue no Telegram. Código errado não altera nada."""
    user = _admin_user(db)
    if user is None:
        if len(new) < MIN_PASSWORD_LEN:
            raise ValueError(f"A senha precisa de pelo menos {MIN_PASSWORD_LEN} caracteres.")
        raise ValueError(_RESET_INVALID)
    _consume_code(db, user, code, new)


def change_password(db: Database, user_id: int, old: str, new: str) -> None:
    row = db.one("SELECT password_hash FROM local_users WHERE id = ?", (user_id,))
    if row is None or not verify_password(old, row["password_hash"]):
        raise PermissionError("Senha atual incorreta.")
    if len(new) < MIN_PASSWORD_LEN:
        raise ValueError(f"A senha precisa de pelo menos {MIN_PASSWORD_LEN} caracteres.")
    with db.tx() as c:
        c.execute("UPDATE local_users SET password_hash = ? WHERE id = ?", (hash_password(new), user_id))
        c.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))


def reset_password(db: Database, username: str, new: str) -> None:
    """Define uma senha nova para um administrador existente, sem exigir a senha atual.

    Só pode ser chamada depois que a rota validou o código de recuperação, um segredo que vive no servidor
    (`ASTRYON_SETUP_CODE`). Sem essa prova, qualquer um que alcançasse o painel tomaria a conta trocando a senha.
    Invalida as sessões do usuário, como a troca de senha comum.
    """
    if len(new) < MIN_PASSWORD_LEN:
        raise ValueError(f"A senha precisa de pelo menos {MIN_PASSWORD_LEN} caracteres.")
    with db.tx() as c:
        row = c.execute("SELECT id FROM local_users WHERE username = ? AND role = 'admin'", (username,)).fetchone()
        if row is None:
            raise ValueError("Administrador não encontrado.")
        c.execute("UPDATE local_users SET password_hash = ? WHERE id = ?", (hash_password(new), row["id"]))
        c.execute("DELETE FROM sessions WHERE user_id = ?", (row["id"],))


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
        """SELECT u.id, u.username, u.role, u.email, s.expires_at FROM sessions s
           JOIN local_users u ON u.id = s.user_id
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


def recover_admin(db: Database, username: str, password: str) -> None:
    """Recuperação pelo console local de um administrador sem hash após backup sanitizado."""
    if len(password) < MIN_PASSWORD_LEN:
        raise ValueError(f"A senha precisa de pelo menos {MIN_PASSWORD_LEN} caracteres.")
    with db.tx() as c:
        row = c.execute("SELECT id FROM local_users WHERE username = ? AND role = 'admin' AND password_hash = ''",
                        (username,)).fetchone()
        if row is None:
            raise ValueError("Administrador sem senha não encontrado. Use a troca de senha normal para contas ativas.")
        c.execute("UPDATE local_users SET password_hash = ? WHERE id = ?", (hash_password(password), row["id"]))
        c.execute("DELETE FROM sessions WHERE user_id = ?", (row["id"],))
