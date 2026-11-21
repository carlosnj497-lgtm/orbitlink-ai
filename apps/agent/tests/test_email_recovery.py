"""Recuperação de senha por e-mail no modo local: cadastro do e-mail, código temporário e uso único."""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from astryon_agent import mailer, recovery
from astryon_agent.api.app import create_app
from astryon_agent.config import Settings
from astryon_agent.storage.db import Database

SVC = {"Authorization": "Bearer svc-token"}
SMTP = dict(smtp_host="smtp.exemplo.com", smtp_port=587, smtp_user="painel@exemplo.com",
            smtp_password="segredo-de-teste", smtp_from="ASTRYON <painel@exemplo.com>")
CODE_RE = re.compile(r"Código: ([A-Z2-9]{4}-[A-Z2-9]{4})")
# telegram_chat_enabled=False evita que o bot de conversa suba no teste; o canal de recuperação segue ativo.
TELEGRAM = dict(telegram_bot_token="123456:token-de-teste", telegram_chat_id="8560810900",
                telegram_chat_enabled=False)


def settings(tmp_path: Path, **kw: object) -> Settings:
    base: dict[str, object] = dict(_env_file=None, data_dir=tmp_path, api_token="svc-token",
                                   status_interval_s=3600, history_interval_s=3600, obstruction_interval_s=3600,
                                   heartbeat_interval_s=3600, capability_refresh_s=3600)
    base.update(kw)
    return Settings(**base)


@pytest.fixture
def outbox(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, str]]:
    """Captura os e-mails em vez de abrir conexão SMTP de verdade."""
    sent: list[dict[str, str]] = []

    def fake(_settings: Settings, to: str, subject: str, text: str) -> None:
        sent.append({"to": to, "subject": subject, "text": text})

    monkeypatch.setattr(mailer, "send_mail", fake)
    return sent


def code_from(text: str) -> str:
    match = CODE_RE.search(text)
    assert match, f"código não encontrado no e-mail: {text!r}"
    return match.group(1)


def recovery_mails(outbox: list[dict[str, str]]) -> list[dict[str, str]]:
    """Só os códigos de recuperação; o aviso de boas-vindas do cadastro pode chegar antes."""
    return [m for m in outbox if "Código para redefinir" in m["subject"]]


def test_email_recovery_depends_on_smtp(tmp_path: Path) -> None:
    with TestClient(create_app(settings(tmp_path), start_collector=False)) as c:
        assert c.get("/v1/auth/state", headers=SVC).json()["email_recovery"] is False
        assert c.post("/v1/auth/recover/request", headers=SVC,
                      json={"email": "admin@exemplo.com"}).status_code == 503
    second = tmp_path / "com-smtp"
    second.mkdir()
    with TestClient(create_app(settings(second, **SMTP), start_collector=False)) as c:
        assert c.get("/v1/auth/state", headers=SVC).json()["email_recovery"] is True


def test_setup_stores_email_and_requires_it_when_smtp_is_ready(tmp_path: Path, outbox: list[dict[str, str]]) -> None:
    app = create_app(settings(tmp_path, **SMTP), start_collector=False)
    with TestClient(app) as c:
        missing = c.post("/v1/auth/setup", headers=SVC,
                         json={"username": "admin", "password": "senha-forte-123"})
        assert missing.status_code == 422
        assert "e-mail" in missing.json()["detail"]
        created = c.post("/v1/auth/setup", headers=SVC,
                         json={"username": "admin", "password": "senha-forte-123", "email": "Admin@Exemplo.com "})
        assert created.status_code == 201
        token = c.post("/v1/auth/login", headers=SVC,
                       json={"username": "admin", "password": "senha-forte-123"}).json()["session"]
        me = c.get("/v1/auth/me", headers={**SVC, "X-ASTRYON-Session": token}).json()
        assert me["email"] == "admin@exemplo.com"


def test_email_recovery_end_to_end(tmp_path: Path, outbox: list[dict[str, str]]) -> None:
    app = create_app(settings(tmp_path, **SMTP), start_collector=False)
    with TestClient(app) as c:
        assert c.post("/v1/auth/setup", headers=SVC, json={
            "username": "admin", "password": "senha-forte-123", "email": "admin@exemplo.com",
        }).status_code == 201
        token = c.post("/v1/auth/login", headers=SVC,
                       json={"username": "admin", "password": "senha-forte-123"}).json()["session"]
        session = {**SVC, "X-ASTRYON-Session": token}

        # Endereço sem conta: mesma resposta 204 e nenhum e-mail (não revela quem tem cadastro).
        assert c.post("/v1/auth/recover/request", headers=SVC,
                      json={"email": "ninguem@exemplo.com"}).status_code == 204
        assert recovery_mails(outbox) == []

        # Pedido real: o endereço é normalizado e o código chega no destino cadastrado.
        assert c.post("/v1/auth/recover/request", headers=SVC,
                      json={"email": "ADMIN@exemplo.com"}).status_code == 204
        sent = recovery_mails(outbox)
        assert len(sent) == 1
        assert sent[0]["to"] == "admin@exemplo.com"
        code = code_from(sent[0]["text"])

        # Código errado não altera a senha nem derruba a sessão.
        wrong = c.post("/v1/auth/recover/confirm", headers=SVC, json={
            "email": "admin@exemplo.com", "code": "AAAA-AAAA", "new_password": "senha-nova-1234",
        })
        assert wrong.status_code == 422
        assert c.get("/v1/auth/me", headers=session).status_code == 200

        # Código certo: senha trocada, sessões antigas encerradas, código não pode ser reutilizado.
        ok = c.post("/v1/auth/recover/confirm", headers=SVC, json={
            "email": "admin@exemplo.com", "code": code, "new_password": "senha-nova-1234",
        })
        assert ok.status_code == 204
        assert c.get("/v1/auth/me", headers=session).status_code == 401
        reuse = c.post("/v1/auth/recover/confirm", headers=SVC, json={
            "email": "admin@exemplo.com", "code": code, "new_password": "outra-senha-1234",
        })
        assert reuse.status_code == 422
        assert c.post("/v1/auth/login", headers=SVC,
                      json={"username": "admin", "password": "senha-forte-123"}).status_code == 401
        assert c.post("/v1/auth/login", headers=SVC,
                      json={"username": "admin", "password": "senha-nova-1234"}).status_code == 200


def test_new_request_invalidates_previous_code(tmp_path: Path, outbox: list[dict[str, str]]) -> None:
    app = create_app(settings(tmp_path, **SMTP), start_collector=False)
    with TestClient(app) as c:
        assert c.post("/v1/auth/setup", headers=SVC, json={
            "username": "admin", "password": "senha-forte-123", "email": "admin@exemplo.com",
        }).status_code == 201
        assert c.post("/v1/auth/recover/request", headers=SVC,
                      json={"email": "admin@exemplo.com"}).status_code == 204
        first = code_from(recovery_mails(outbox)[0]["text"])
        assert c.post("/v1/auth/recover/request", headers=SVC,
                      json={"email": "admin@exemplo.com"}).status_code == 204
        second = code_from(recovery_mails(outbox)[1]["text"])
        assert first != second
        assert c.post("/v1/auth/recover/confirm", headers=SVC, json={
            "email": "admin@exemplo.com", "code": first, "new_password": "senha-nova-1234",
        }).status_code == 422
        assert c.post("/v1/auth/recover/confirm", headers=SVC, json={
            "email": "admin@exemplo.com", "code": second, "new_password": "senha-nova-1234",
        }).status_code == 204


def test_recovery_email_can_be_changed_in_the_panel(tmp_path: Path) -> None:
    app = create_app(settings(tmp_path), start_collector=False)
    with TestClient(app) as c:
        assert c.post("/v1/auth/setup", headers=SVC, json={
            "username": "admin", "password": "senha-forte-123",
        }).status_code == 201
        token = c.post("/v1/auth/login", headers=SVC,
                       json={"username": "admin", "password": "senha-forte-123"}).json()["session"]
        session = {**SVC, "X-ASTRYON-Session": token}
        assert c.post("/v1/auth/email", headers=session, json={"email": "nao-vale"}).status_code == 422
        assert c.post("/v1/auth/email", headers=session, json={"email": "Novo@Exemplo.com"}).status_code == 204
        assert c.get("/v1/auth/me", headers=session).json()["email"] == "novo@exemplo.com"


def test_code_dies_after_five_wrong_attempts(tmp_path: Path) -> None:
    db = Database(tmp_path / "astryon.sqlite3")
    try:
        from astryon_agent.auth import local

        local.setup_admin(db, "admin", "senha-forte-123", "admin@exemplo.com")
        result = local.request_password_reset(db, "admin@exemplo.com")
        assert result is not None
        _, email, code = result
        for _ in range(5):
            with pytest.raises(ValueError):
                local.confirm_password_reset(db, email, "AAAA-AAAA", "senha-nova-1234")
        with pytest.raises(ValueError):
            local.confirm_password_reset(db, email, code, "senha-nova-1234")
    finally:
        db.close()


class _FakeSMTP:
    def __init__(self, calls: dict[str, object]) -> None:
        self.calls = calls

    def __call__(self, host: str, port: int, timeout: float | None = None, context: object | None = None) -> _FakeSMTP:
        self.calls.setdefault("connect", (host, port))
        return self

    def __enter__(self) -> _FakeSMTP:
        return self

    def __exit__(self, *_exc: object) -> bool:
        return False

    def ehlo(self) -> None:
        self.calls["ehlo"] = int(self.calls.get("ehlo", 0)) + 1

    def starttls(self, context: object | None = None) -> None:
        self.calls["starttls"] = True

    def login(self, user: str, password: str) -> None:
        self.calls["login"] = (user, password)

    def send_message(self, msg: object) -> None:
        self.calls["from"] = msg["From"]  # type: ignore[index]
        self.calls["to"] = msg["To"]  # type: ignore[index]
        self.calls["subject"] = msg["Subject"]  # type: ignore[index]


def test_mailer_uses_starttls_and_credentials(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: dict[str, object] = {}
    monkeypatch.setattr(mailer.smtplib, "SMTP", _FakeSMTP(calls))
    mailer.send_mail(settings(tmp_path, **SMTP), "dest@exemplo.com", "Assunto", "Corpo")
    assert calls["connect"] == ("smtp.exemplo.com", 587)
    assert calls["starttls"] is True
    assert calls["login"] == ("painel@exemplo.com", "segredo-de-teste")
    assert calls["to"] == "dest@exemplo.com"


def test_mailer_uses_ssl_when_asked(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: dict[str, object] = {}
    monkeypatch.setattr(mailer.smtplib, "SMTP_SSL", _FakeSMTP(calls))
    mailer.send_mail(settings(tmp_path, **{**SMTP, "smtp_security": "ssl", "smtp_port": 465}),
                     "dest@exemplo.com", "Assunto", "Corpo")
    assert calls["connect"] == ("smtp.exemplo.com", 465)
    assert "starttls" not in calls


def test_mailer_refuses_when_not_configured(tmp_path: Path) -> None:
    with pytest.raises(mailer.MailerError):
        mailer.send_mail(settings(tmp_path), "dest@exemplo.com", "Assunto", "Corpo")


def test_smtp_can_be_configured_in_the_panel(tmp_path: Path) -> None:
    """Configurações → Credenciais ligam a recuperação por e-mail na hora, sem reiniciar o agente."""
    app = create_app(settings(tmp_path), start_collector=False)
    with TestClient(app) as c:
        assert c.post("/v1/auth/setup", headers=SVC,
                      json={"username": "admin", "password": "senha-forte-123"}).status_code == 201
        token = c.post("/v1/auth/login", headers=SVC,
                       json={"username": "admin", "password": "senha-forte-123"}).json()["session"]
        session = {**SVC, "X-ASTRYON-Session": token}
        assert c.get("/v1/auth/state", headers=SVC).json()["recovery_channel"] is None
        saved = c.put("/v1/settings/credentials", headers=session, json={"credentials": {
            "smtp_host": "smtp.exemplo.com", "smtp_port": "587", "smtp_security": "starttls",
            "smtp_user": "painel@exemplo.com", "smtp_password": "segredo-de-teste",
            "smtp_from": "ASTRYON <painel@exemplo.com>",
        }})
        assert saved.status_code == 200
        assert saved.json()["secrets_configured"]["smtp_host"] is True
        state = c.get("/v1/auth/state", headers=SVC).json()
        assert state["recovery_channel"] == "email"
        assert state["email_recovery"] is True


@pytest.fixture
def telegram_outbox(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, object]]:
    """Captura as chamadas ao sendMessage do Telegram em vez de falar com a internet."""
    sent: list[dict[str, object]] = []

    class FakeResponse:
        status_code = 200

    def fake_post(url: str, **kwargs: object) -> FakeResponse:
        sent.append({"url": url, "json": kwargs.get("json")})
        return FakeResponse()

    monkeypatch.setattr(recovery.httpx, "post", fake_post)
    return sent


def test_telegram_is_the_preferred_channel(tmp_path: Path) -> None:
    both = settings(tmp_path, **{**SMTP, **TELEGRAM})
    assert recovery.channel(both) == "telegram"
    assert recovery.channel(settings(tmp_path, **SMTP)) == "email"
    assert recovery.channel(settings(tmp_path)) is None


def test_telegram_recovery_end_to_end(tmp_path: Path, telegram_outbox: list[dict[str, object]]) -> None:
    app = create_app(settings(tmp_path, **TELEGRAM), start_collector=False)
    with TestClient(app) as c:
        state = c.get("/v1/auth/state", headers=SVC).json()
        assert state["recovery_channel"] == "telegram"
        assert state["email_recovery"] is False
        # E-mail é opcional quando o canal é o Telegram.
        assert c.post("/v1/auth/setup", headers=SVC,
                      json={"username": "admin", "password": "senha-forte-123"}).status_code == 201
        token = c.post("/v1/auth/login", headers=SVC,
                       json={"username": "admin", "password": "senha-forte-123"}).json()["session"]
        session = {**SVC, "X-ASTRYON-Session": token}

        assert c.post("/v1/auth/recover/request", headers=SVC, json={}).status_code == 204
        assert len(telegram_outbox) == 1
        body = telegram_outbox[0]["json"]
        assert isinstance(body, dict)
        assert body["chat_id"] == "8560810900"
        assert "sendMessage" in str(telegram_outbox[0]["url"])
        code = code_from(str(body["text"]))

        wrong = c.post("/v1/auth/recover/confirm", headers=SVC,
                       json={"code": "AAAA-AAAA", "new_password": "senha-nova-1234"})
        assert wrong.status_code == 422
        assert c.get("/v1/auth/me", headers=session).status_code == 200

        ok = c.post("/v1/auth/recover/confirm", headers=SVC,
                    json={"code": code, "new_password": "senha-nova-1234"})
        assert ok.status_code == 204
        assert c.get("/v1/auth/me", headers=session).status_code == 401
        assert c.post("/v1/auth/login", headers=SVC,
                      json={"username": "admin", "password": "senha-forte-123"}).status_code == 401
        assert c.post("/v1/auth/login", headers=SVC,
                      json={"username": "admin", "password": "senha-nova-1234"}).status_code == 200


def test_telegram_failure_surfaces_without_leaking(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    class Refused:
        status_code = 401

    monkeypatch.setattr(recovery.httpx, "post", lambda *a, **k: Refused())
    app = create_app(settings(tmp_path, **TELEGRAM), start_collector=False)
    with TestClient(app) as c:
        assert c.post("/v1/auth/setup", headers=SVC,
                      json={"username": "admin", "password": "senha-forte-123"}).status_code == 201
        r = c.post("/v1/auth/recover/request", headers=SVC, json={})
        assert r.status_code == 502
        assert "token-de-teste" not in r.text
