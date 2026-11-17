"""Backup automático do banco: cópia diária na pasta de dados e cópia semanal no seu chat do Telegram.

A cópia usa a API de backup do SQLite (consistente mesmo com o agente gravando) e é compactada com gzip.
Restaurar: pare o agente, descompacte o arquivo como `data/astryon.sqlite3` e inicie de novo.

A cópia local é completa. A do Telegram (desligada por padrão, ASTRYON_BACKUP_TELEGRAM) é SANITIZADA: sem sessões,
sem hashes de senha, sem segredos cifrados (ESP32, token da nuvem) e sem os hashes de código de controle. Ela
nunca vai para chat de grupo. Restaurar a cópia do Telegram exige recover-admin no console local e reparear ESP32/nuvem.
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
    return sorted(p for p in d.glob("astryon-*.sqlite3.gz") if ".telegram." not in p.name) if d.exists() else []


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


# Comandos que tiram da cópia enviada para fora tudo o que serve para entrar no painel ou se passar por um
# dispositivo. Tabelas ausentes (bancos antigos) são ignoradas.
_SANITIZE = (
    "DELETE FROM sessions",
    "UPDATE local_users SET password_hash = ''",
    "UPDATE esp32_nodes SET secret_enc = ''",
    "DELETE FROM esp32_pairing_codes",
    "DELETE FROM esp32_nonces",
    "UPDATE control_requests SET nonce_hash = ''",
    "DELETE FROM settings_kv WHERE key = 'sync:agent_token'",
)


def make_sanitized(src_gz: Path) -> Path:
    """Gera, ao lado do backup, uma cópia compactada sem credenciais (para enviar ao Telegram)."""
    out = src_gz.with_name(src_gz.name.replace(".sqlite3.gz", ".telegram.sqlite3.gz"))
    with tempfile.TemporaryDirectory(dir=src_gz.parent) as tmp:
        raw = Path(tmp) / "copia.sqlite3"
        with gzip.open(src_gz, "rb") as fi, raw.open("wb") as fo:
            shutil.copyfileobj(fi, fo)
        con = sqlite3.connect(str(raw))
        try:
            for stmt in _SANITIZE:
                try:
                    con.execute(stmt)
                except sqlite3.OperationalError:
                    pass  # tabela ou coluna não existe nesta versão do banco
            con.commit()
            con.execute("VACUUM")  # sem isso os valores apagados continuariam nas páginas livres do arquivo
        finally:
            con.close()
        partial = out.with_suffix(".part")
        with raw.open("rb") as fi, gzip.open(partial, "wb", compresslevel=6) as fo:
            shutil.copyfileobj(fi, fo)
        partial.replace(out)
    return out


async def send_telegram(path: Path, settings: Settings, transport: httpx.AsyncBaseTransport | None = None) -> bool:
    if not (settings.telegram_bot_token and settings.telegram_chat_id):
        return False
    if str(settings.telegram_chat_id).strip().startswith("-"):
        log.warning("backup não enviado: o chat do Telegram é um grupo; o arquivo ficou só na pasta local")
        return False
    size = (await asyncio.to_thread(path.stat)).st_size
    if size > TELEGRAM_MAX:
        log.warning("backup com %d MB: grande demais para o Telegram; ficou só na pasta local", size // 2**20)
        return False
    token = settings.telegram_bot_token.get_secret_value()
    caption = (f"🗄️ Backup do ASTRYON ({size / 2**20:.1f} MB).\n"
               "Cópia sem senhas nem segredos: tem o histórico e as configurações do painel. Não compartilhe.\n"
               "Para restaurar: pare o agente, descompacte como data/astryon.sqlite3, execute no console local "
               "astryon-agent recover-admin --username SEU_USUARIO "
               "--database CAMINHO_DO_BANCO e inicie de novo (ESP32 e nuvem precisam ser pareados outra vez).")
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
        last_tg = int(await db.run(db.get_kv, KV_TELEGRAM) or 0)
        if force or now - last_tg >= settings.backup_telegram_every_days * 86400:
            target = await asyncio.to_thread(make_sanitized, made or backups[-1])
            try:
                sent = await send_telegram(target, settings, transport)
            finally:
                target.unlink(missing_ok=True)
            if sent:
                await db.run(db.set_kv, KV_TELEGRAM, str(now))
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
