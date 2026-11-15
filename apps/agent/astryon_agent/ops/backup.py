"""Backup automático do banco: cópia diária na pasta de dados e cópia semanal no seu chat do Telegram.

A cópia usa a API de backup do SQLite (consistente mesmo com o agente gravando) e é compactada com gzip.
Restaurar: pare o agente, descompacte o arquivo como `data/astryon.sqlite3` e inicie de novo.

O arquivo contém o histórico e as configurações do painel (inclusive hashes de senha e o segredo do ESP32
protegido). Os tokens do .env NÃO estão nele. Ele vai só para o chat autorizado do bot.
"""

from __future__ import annotations

import asyncio
import gzip
import logging
import shutil
import sqlite3
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from ..config import Settings
from ..storage.db import Database, now_ts

log = logging.getLogger("astryon.backup")

KV_TELEGRAM = "backup:telegram_last"
TELEGRAM_MAX = 45 * 1024 * 1024  # a Bot API aceita até 50 MB por documento


def backup_dir(settings: Settings) -> Path:
    return Path(settings.data_dir) / "backups"


def list_backups(settings: Settings) -> list[Path]:
    d = backup_dir(settings)
    return sorted(d.glob("astryon-*.sqlite3.gz")) if d.exists() else []


def make_backup(db: Database, settings: Settings, now: int | None = None) -> Path:
    """Cria a cópia compactada e apaga as mais antigas além de backup_keep."""
    now = now or now_ts()
    d = backup_dir(settings)
    d.mkdir(parents=True, exist_ok=True)
    stamp = datetime.fromtimestamp(now, ZoneInfo(settings.timezone)).strftime("%Y%m%d-%H%M%S")
    out = d / f"astryon-{stamp}.sqlite3.gz"
    with tempfile.TemporaryDirectory(dir=d) as tmp:
        raw = Path(tmp) / "copia.sqlite3"
        src = sqlite3.connect(str(db.path))
        dst = sqlite3.connect(str(raw))
        try:
            src.backup(dst)
        finally:
            dst.close()
            src.close()
        partial = out.with_suffix(".part")
        with raw.open("rb") as fi, gzip.open(partial, "wb", compresslevel=6) as fo:
            shutil.copyfileobj(fi, fo)
        partial.replace(out)  # nunca deixa um backup pela metade com o nome final
    for old in list_backups(settings)[: -settings.backup_keep]:
        old.unlink(missing_ok=True)
    return out


async def send_telegram(path: Path, settings: Settings, transport: httpx.AsyncBaseTransport | None = None) -> bool:
    if not (settings.telegram_bot_token and settings.telegram_chat_id):
        return False
    size = (await asyncio.to_thread(path.stat)).st_size
    if size > TELEGRAM_MAX:
        log.warning("backup com %d MB: grande demais para o Telegram; ficou só na pasta local", size // 2**20)
        return False
    token = settings.telegram_bot_token.get_secret_value()
    caption = (f"🗄️ Backup do ASTRYON ({size / 2**20:.1f} MB).\n"
               "Guarde este arquivo: tem o histórico e as configurações do painel. Não compartilhe.\n"
               "Para restaurar: pare o agente, descompacte como data/astryon.sqlite3 e inicie de novo.")
    content = await asyncio.to_thread(path.read_bytes)
    async with httpx.AsyncClient(timeout=120, transport=transport) as http:
        r = await http.post(f"https://api.telegram.org/bot{token}/sendDocument",
                            data={"chat_id": settings.telegram_chat_id, "caption": caption},
                            files={"document": (path.name, content, "application/gzip")})
    if r.status_code != 200:
        log.warning("Telegram recusou o backup (HTTP %s)", r.status_code)
        return False
    return True


async def run_once(db: Database, settings: Settings, transport: httpx.AsyncBaseTransport | None = None,
                   force: bool = False) -> dict[str, Any]:
    """Faz a cópia diária se a última tiver mais de 24 h (ou se `force`); envia ao Telegram a cada N dias."""
    now = now_ts()
    backups = list_backups(settings)
    last = int(backups[-1].stat().st_mtime) if backups else None
    made = None
    if force or last is None or now - last >= 24 * 3600:
        made = await asyncio.to_thread(make_backup, db, settings, now)
        log.info("backup criado: %s", made.name)
    sent = False
    if settings.backup_telegram and (made or backups):
        last_tg = int(db.get_kv(KV_TELEGRAM) or 0)
        if force or now - last_tg >= settings.backup_telegram_every_days * 86400:
            target = made or backups[-1]
            sent = await send_telegram(target, settings, transport)
            if sent:
                db.set_kv(KV_TELEGRAM, str(now))
    return {"created": made.name if made else None, "sent_telegram": sent,
            "backups": [p.name for p in list_backups(settings)]}


async def run(db: Database, settings: Settings) -> None:
    await asyncio.sleep(120)  # deixa o agente estabilizar depois de iniciar
    while True:
        try:
            await run_once(db, settings)
        except Exception:  # noqa: BLE001
            log.exception("falha no backup automático")
        await asyncio.sleep(3600)
