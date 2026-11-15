"""CLI do agente: `python -m orbitlink_agent <comando>`."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


def _cmd_diagnose(args: argparse.Namespace) -> int:
    from .config import Settings
    from .diagnostics.report import render_text, run_diagnose, sanitize

    overrides: dict[str, Any] = {}
    if args.fixture:
        overrides["fixture_file"] = Path(args.fixture)
    if args.dish:
        overrides["dish_target"] = args.dish
    if args.router:
        overrides["router_target"] = args.router
    if args.no_router:
        overrides["router_enabled"] = False
    settings = Settings(**overrides)
    report = run_diagnose(settings, save_fixture=Path(args.save_fixture) if args.save_fixture else None)
    shareable = sanitize(report, mask_lan_ips=True)
    if args.out:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.with_suffix(".json").write_text(json.dumps(shareable, indent=2, ensure_ascii=False), encoding="utf-8")
        out.with_suffix(".txt").write_text(render_text(shareable), encoding="utf-8")
    if args.json:
        print(json.dumps(shareable if args.share else report, indent=2, ensure_ascii=False))
    else:
        print(render_text(shareable if args.share else report))
    return 0 if report["summary"]["verdict"] == "antena acessível" else 2


def _cmd_serve(args: argparse.Namespace) -> int:
    import uvicorn

    from .config import get_settings

    s = get_settings()
    host = args.host or s.host
    if host not in ("127.0.0.1", "localhost", "::1") and not s.allow_lan:
        print("Recusado: escutar fora do loopback exige ORBITLINK_ALLOW_LAN=true e pareamento.", file=sys.stderr)
        return 1
    uvicorn.run("orbitlink_agent.api.app:create_app", factory=True, host=host, port=args.port or s.port,
                log_config=None, access_log=False)
    return 0


def _cmd_supabase_token(args: argparse.Namespace) -> int:
    """Gera token do agente localmente e imprime o SQL que registra apenas o HASH no Supabase."""
    import hashlib
    import secrets

    token = "olk_" + secrets.token_hex(32)
    digest = hashlib.sha256(token.encode()).hexdigest()
    email = args.email.replace("'", "''")
    name = args.name.replace("'", "''")[:60]
    print("1) Execute no SQL Editor do Supabase (registra somente o hash):\n")
    print("insert into public.agents (workspace_id, name, token_hash)")
    print(f"select w.id, '{name}', '{digest}'")
    print("  from public.workspaces w join auth.users u on u.id = w.owner_id")
    print(f" where u.email = '{email}' limit 1;\n")
    print("2) Adicione ao .env (não compartilhe):\n")
    print(f"ORBITLINK_SUPABASE_AGENT_TOKEN={token}")
    return 0


def _cmd_telegram_chat_id(_args: argparse.Namespace) -> int:
    """Lista os chats que falaram com o bot recentemente, para preencher ORBITLINK_TELEGRAM_CHAT_ID."""
    import httpx

    from .config import Settings

    tok = Settings().telegram_bot_token
    if not tok or not tok.get_secret_value():
        print("Defina ORBITLINK_TELEGRAM_BOT_TOKEN (token do @BotFather) e rode de novo.", file=sys.stderr)
        return 1
    try:
        r = httpx.get(f"https://api.telegram.org/bot{tok.get_secret_value()}/getUpdates", timeout=10)
    except httpx.HTTPError as exc:
        print(f"Sem conexão com o Telegram ({type(exc).__name__}).", file=sys.stderr)
        return 2
    body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    if not r.is_success or not body.get("ok"):
        print(f"O Telegram recusou: HTTP {r.status_code} {body.get('description', '')}".strip(), file=sys.stderr)
        return 2
    chats: dict[int, str] = {}
    for upd in body.get("result", []):
        msg = upd.get("message") or upd.get("channel_post") or upd.get("my_chat_member") or {}
        chat = msg.get("chat") or {}
        if "id" in chat:
            label = chat.get("title") or chat.get("username") or chat.get("first_name") or ""
            chats[int(chat["id"])] = f"{chat.get('type', '?')}: {label}".strip()
    if not chats:
        print("Nenhuma conversa encontrada. Abra o bot no Telegram, envie qualquer mensagem (ex.: /start) e rode de novo.")
        return 1
    print("Chats que falaram com o bot (use o número em ORBITLINK_TELEGRAM_CHAT_ID):\n")
    for cid, label in chats.items():
        print(f"  {cid}    {label}")
    return 0


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(prog="orbitlink-agent", description="OrbitLink AI — agente local")
    sub = p.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("diagnose", help="Diagnostica rede, antena e roteador (somente leitura)")
    d.add_argument("--json", action="store_true", help="Saída JSON")
    d.add_argument("--share", action="store_true", help="Mascara IPs da LAN na saída (relatório compartilhável)")
    d.add_argument("--out", help="Grava <arquivo>.json e <arquivo>.txt sanitizados")
    d.add_argument("--fixture", help="Usa um arquivo de fixture em vez da antena (modo teste)")
    d.add_argument("--save-fixture", help="Salva respostas reais anonimizadas como fixture")
    d.add_argument("--dish", help="Alvo da antena (padrão 192.168.100.1:9200)")
    d.add_argument("--router", help="Alvo do roteador (padrão 192.168.1.1:9000)")
    d.add_argument("--no-router", action="store_true", help="Não testa o roteador")
    d.set_defaults(func=_cmd_diagnose)

    s = sub.add_parser("serve", help="Inicia a API/coletor do agente")
    s.add_argument("--host")
    s.add_argument("--port", type=int)
    s.set_defaults(func=_cmd_serve)

    t = sub.add_parser("supabase-token", help="Gera token de agente e o SQL para registrar seu hash no Supabase")
    t.add_argument("--email", required=True, help="E-mail da sua conta no Supabase (dono do workspace)")
    t.add_argument("--name", default="Agente OrbitLink")
    t.set_defaults(func=_cmd_supabase_token)

    tg = sub.add_parser("telegram-chat-id", help="Descobre o chat_id para os alertas no Telegram")
    tg.set_defaults(func=_cmd_telegram_chat_id)

    args = p.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
