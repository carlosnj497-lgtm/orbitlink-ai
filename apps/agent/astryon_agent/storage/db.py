"""SQLite local em modo WAL com runner de migrations.

Uma única conexão protegida por lock (SQLite serializa escritas de qualquer forma). Código async
deve usar `await db.run(fn, ...)`, que executa em thread para não bloquear o event loop.
"""

from __future__ import annotations

import asyncio
import sqlite3
import threading
import time
from collections.abc import Callable, Iterator, Sequence
from contextlib import contextmanager
from importlib import resources
from pathlib import Path
from typing import Any, TypeVar

T = TypeVar("T")


def now_ts() -> int:
    return int(time.time())


class Database:
    def __init__(self, path: Path | str) -> None:
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None, timeout=10)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        with self._lock:
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA synchronous=NORMAL")
            self._conn.execute("PRAGMA foreign_keys=ON")
            self._conn.execute("PRAGMA busy_timeout=10000")
        self.migrate()

    # ------------------------------------------------------------------ migrations
    def migrate(self) -> list[int]:
        applied: list[int] = []
        with self._lock:
            self._conn.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)"
            )
            done = {r[0] for r in self._conn.execute("SELECT version FROM schema_migrations")}
            files = sorted(
                (f for f in resources.files("astryon_agent.migrations").iterdir() if f.name.endswith(".sql")),
                key=lambda f: f.name,
            )
            for f in files:
                version = int(f.name.split("_", 1)[0])
                if version in done:
                    continue
                sql = f.read_text(encoding="utf-8")
                self._conn.execute("BEGIN IMMEDIATE")
                try:
                    for stmt in _split_sql(sql):
                        self._conn.execute(stmt)
                    self._conn.execute("INSERT INTO schema_migrations VALUES (?, ?)", (version, now_ts()))
                    self._conn.execute("COMMIT")
                except Exception:
                    self._conn.execute("ROLLBACK")
                    raise
                applied.append(version)
        return applied

    # ------------------------------------------------------------------ helpers
    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                yield self._conn
                self._conn.execute("COMMIT")
            except BaseException:
                self._conn.execute("ROLLBACK")
                raise

    def execute(self, sql: str, params: Sequence[Any] | dict[str, Any] = ()) -> sqlite3.Cursor:
        with self._lock:
            return self._conn.execute(sql, params)

    def query(self, sql: str, params: Sequence[Any] | dict[str, Any] = ()) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(r) for r in self._conn.execute(sql, params).fetchall()]

    def one(self, sql: str, params: Sequence[Any] | dict[str, Any] = ()) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(sql, params).fetchone()
            return dict(row) if row is not None else None

    def scalar(self, sql: str, params: Sequence[Any] | dict[str, Any] = ()) -> Any:
        with self._lock:
            row = self._conn.execute(sql, params).fetchone()
            return row[0] if row is not None else None

    async def run(self, fn: Callable[..., T], *args: Any, **kwargs: Any) -> T:
        return await asyncio.to_thread(fn, *args, **kwargs)

    def get_kv(self, key: str) -> str | None:
        v = self.scalar("SELECT value FROM settings_kv WHERE key = ?", (key,))
        return str(v) if v is not None else None

    def set_kv(self, key: str, value: str) -> None:
        self.execute("INSERT INTO settings_kv(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                     (key, value))

    def size_bytes(self) -> int:
        if self.path == ":memory:":
            return 0
        p = Path(self.path)
        return sum(f.stat().st_size for f in (p, p.with_name(p.name + "-wal")) if f.exists())

    def close(self) -> None:
        with self._lock:
            self._conn.close()


def _split_sql(sql: str) -> list[str]:
    """Divide um script em comandos completos (usa `sqlite3.complete_statement`, respeita triggers/strings)."""
    lines = [ln.split("--", 1)[0] if "'" not in ln else ln for ln in sql.splitlines()]
    out: list[str] = []
    buf = ""
    for ln in lines:
        buf += ln + "\n"
        if sqlite3.complete_statement(buf):
            if buf.strip():
                out.append(buf.strip())
            buf = ""
    if buf.strip():
        out.append(buf.strip())
    return out
