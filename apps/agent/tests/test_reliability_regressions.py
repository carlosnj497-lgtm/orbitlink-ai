"""Regressões de sanitização, upload de áudio, diagnóstico e cotas concorrentes."""

from __future__ import annotations

import asyncio
import gzip
import sqlite3

import httpx
from fastapi.testclient import TestClient

from astryon_agent.ai import copilot, transcribe
from astryon_agent.api.app import create_app
from astryon_agent.config import Settings
from astryon_agent.diagnostics import engine
from astryon_agent.ops import backup
from astryon_agent.storage import repo
from astryon_agent.storage.db import Database, local_day, now_ts

from .test_api import login


def _settings(tmp_path, **kw):
    base = dict(_env_file=None, data_dir=tmp_path, api_token="svc-token", timezone="America/Fortaleza")
    base.update(kw)
    return Settings(**base)


def test_telegram_backup_removes_all_secret_kv_formats_and_vacuums(tmp_path):
    db = Database(tmp_path / "original.sqlite3")
    try:
        db.set_kv("secret:groq_api_key", "fernet:SEGREDO_CIFRADO_UNICO")
        db.set_kv("secret:api_token", "plain:SEGREDO_LEGADO_UNICO")
        db.set_kv("sync:agent_token", "plain:TOKEN_NUVEM_UNICO")
        db.set_kv("setting:terminal_name", "Starlink da sala")
        db.set_kv("marca", "controle-nao-sensivel")
        original = backup.make_backup(db, _settings(tmp_path))
        clean = backup.make_sanitized(original)
        raw = gzip.decompress(clean.read_bytes())
    finally:
        db.close()

    restored_path = tmp_path / "telegram.sqlite3"
    restored_path.write_bytes(raw)
    con = sqlite3.connect(restored_path)
    try:
        rows = dict(con.execute("SELECT key, value FROM settings_kv"))
    finally:
        con.close()
    assert rows == {"setting:terminal_name": "Starlink da sala", "marca": "controle-nao-sensivel"}
    # O VACUUM também precisa retirar os valores das páginas livres do arquivo enviado.
    assert b"SEGREDO_CIFRADO_UNICO" not in raw
    assert b"SEGREDO_LEGADO_UNICO" not in raw
    assert b"TOKEN_NUVEM_UNICO" not in raw
    # A sanitização não altera a cópia local completa.
    assert b"plain:SEGREDO_LEGADO_UNICO" in gzip.decompress(original.read_bytes())


def test_http_transcribe_enforces_enabled_and_bounded_size_without_double_quota(tmp_path):
    calls: list[httpx.Request] = []

    def groq(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, json={"text": "transcrição local simulada"})

    settings = _settings(tmp_path, groq_api_key="gsk_teste", ai_audio_max_bytes=1024, ai_audio_daily_request_limit=5)
    app = create_app(settings, start_collector=False)
    with TestClient(app) as client:
        headers = login(client)
        app.state.ctx.extras["audio_transport"] = httpx.MockTransport(groq)
        settings.ai_transcribe_enabled = False
        upload = {"file": ("nota.webm", b"x" * 1024, "audio/webm")}
        disabled = client.post("/v1/ai/transcribe", headers=headers, files=upload)
        assert disabled.status_code == 403 and calls == []

        settings.ai_transcribe_enabled = True
        exact = client.post("/v1/ai/transcribe", headers=headers, files=upload)
        assert exact.status_code == 200 and exact.json() == {"text": "transcrição local simulada"}
        assert len(calls) == 1

        too_large = client.post(
            "/v1/ai/transcribe", headers=headers, files={"file": ("nota.webm", b"x" * 1025, "audio/webm")}
        )
        assert too_large.status_code == 413 and len(calls) == 1
        row = app.state.ctx.db.one("SELECT requests, audio_seconds FROM ai_audio_usage_daily")
        assert row == {"requests": 1, "audio_seconds": 10}  # upload recusado não reserva cota


def test_diagnostic_without_loss_measurements_is_not_reported_as_good(tmp_path):
    db = Database(tmp_path / "diagnostico.sqlite3")
    minute = (now_ts() // 60) * 60 - 120
    try:
        db.execute(
            "INSERT INTO terminals (id, terminal_key, target, origin, first_seen, last_seen) VALUES (1,'k','x','grpc',?,?)",
            (minute, minute),
        )
        for i in range(60):
            db.execute("INSERT INTO history_samples VALUES (1,'b',?,?,?,30,1,1,NULL,'grpc')", (i, minute + i, None))
        with db.tx() as con:
            repo._recompute_minute(con, 1, minute, "grpc", False)
        result = engine.summary(db, 1, minute, minute + 60, "America/Fortaleza")
    finally:
        db.close()

    assert result["quality"]["observed_seconds"] == 60
    assert result["quality"]["availability_pct"] is None and result["quality"]["loss_pct"] is None
    assert "indisponíveis" in result["headline"] and "None" not in result["headline"]
    assert "estável" not in result["headline"]
    assert all("provavelmente não vieram do enlace" not in finding["text"] for finding in result["findings"])


class ConcurrentAI:
    def __init__(self):
        self.calls = 0

    async def create(self, **_payload):
        self.calls += 1
        await asyncio.sleep(0.02)  # mantém as chamadas externas simuladas sobrepostas
        return {
            "usage": {"prompt_tokens": 1, "completion_tokens": 1},
            "choices": [{"finish_reason": "stop", "message": {"role": "assistant", "content": "ok"}}],
        }


async def test_text_quota_reservation_is_atomic_under_concurrency(tmp_path):
    settings = _settings(tmp_path, groq_api_key="gsk_teste", ai_daily_request_limit=3)
    db = Database(tmp_path / "texto.sqlite3")
    client = ConcurrentAI()
    user = {"id": 1, "username": "admin", "role": "admin"}
    try:
        results = await asyncio.gather(
            *(copilot.ask(db, settings, None, user, f"pergunta {i}", None, client=client) for i in range(10)),
            return_exceptions=True,
        )
        successes = [result for result in results if not isinstance(result, BaseException)]
        refused = [result for result in results if isinstance(result, PermissionError)]
        assert len(successes) == 3 and len(refused) == 7 and client.calls == 3
        assert db.scalar("SELECT requests FROM ai_usage_daily WHERE day = ?", (local_day(settings.timezone),)) == 3
    finally:
        db.close()


async def test_audio_quota_reservation_is_atomic_under_concurrency(tmp_path):
    settings = _settings(tmp_path, groq_api_key="gsk_teste", ai_audio_daily_request_limit=4)
    db = Database(tmp_path / "audio.sqlite3")
    calls: list[httpx.Request] = []

    async def groq(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        await asyncio.sleep(0.02)  # sem a reserva atômica, todas as corrotinas passariam pelo check inicial
        return httpx.Response(200, json={"text": "ok"})

    client = transcribe.Transcriber(settings, transport=httpx.MockTransport(groq))

    async def run_one() -> bool:
        try:
            await db.run(transcribe.reserve_audio_quota, db, settings)
        except PermissionError:
            return False
        assert await client.transcribe(b"OPUS-SIMULADO", "audio/ogg") == "ok"
        await db.run(transcribe.record_audio_usage, db, settings, 5)
        return True

    try:
        results = await asyncio.gather(*(run_one() for _ in range(11)))
        assert results.count(True) == 4 and results.count(False) == 7 and len(calls) == 4
        row = db.one("SELECT requests, audio_seconds FROM ai_audio_usage_daily WHERE day = ?", (local_day(settings.timezone),))
        assert row == {"requests": 4, "audio_seconds": 40}
    finally:
        db.close()
