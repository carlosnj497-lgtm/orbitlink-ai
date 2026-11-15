"use client";

import { Eye, LogIn, ShieldCheck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { Button, Callout, Card, Input, Label } from "@/components/ui/primitives";
import { safeNext } from "@/lib/safe-next";

type AuthState = { setup_required: boolean; setup_code_required?: boolean; supabase_configured: boolean } | { detail: string };

export function LoginForm() {
  const params = useSearchParams();
  const [state, setState] = useState<AuthState | null>(null);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/state")
      .then(async (r) => setState(await r.json()))
      .catch(() => setState({ detail: "Agente ASTRYON offline. Inicie com scripts\\start.ps1." }));
  }, []);

  const setup = state && "setup_required" in state && state.setup_required;
  const needCode = setup && "setup_code_required" in state && state.setup_code_required;
  const offline = state && "detail" in state;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (setup && password !== confirm) {
      setError("As senhas não conferem.");
      return;
    }
    setBusy(true);
    const r = await fetch(`/api/auth/${setup ? "setup" : "login"}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(setup && needCode ? { username, password, setup_code: setupCode } : { username, password }),
    }).catch(() => null);
    setBusy(false);
    if (!r) {
      setError("Não foi possível falar com o painel.");
      return;
    }
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      setError(typeof body.detail === "string" ? body.detail : "Falha na autenticação.");
      return;
    }
    window.location.href = safeNext(params.get("next"), window.location.origin);
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-5 flex flex-col items-center text-center">
        {/* Antena e logo: imagens enviadas pelo dono (fundo transparente). */}
        <Image src="/dish-login.webp" alt="" width={338} height={420} unoptimized preload className="h-28 w-auto drop-shadow-[0_10px_24px_rgba(0,0,0,0.7)] sm:h-32" />
        <h1 className="mt-3">
          <Image src="/astryon-logo.webp" alt="ASTRYON — Space Systems" width={800} height={298} unoptimized preload className="h-auto w-56 sm:w-64" />
        </h1>
        <p className="sr-only">Painel local da sua Starlink Mini</p>
      </div>
      <Card className="ol-glow ol-hud p-6">
        <h2 className="text-base font-semibold">{setup ? "Criar administrador local" : "Entrar"}</h2>
        <p className="mt-1 text-sm text-fg-muted">
          {setup
            ? "Primeiro acesso: defina o usuário que poderá ver dados e confirmar ações. A senha fica somente neste computador (hash scrypt)."
            : "Use o usuário local configurado na instalação."}
        </p>
        {offline && (
          <Callout tone="crit" className="mt-4" title="Sem conexão com o agente">
            {(state as { detail: string }).detail}
          </Callout>
        )}
        <form onSubmit={submit} className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="u">Usuário</Label>
            <Input id="u" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p">Senha</Label>
            <Input id="p" type="password" autoComplete={setup ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={setup ? 10 : 1} />
          </div>
          {setup && (
            <div className="space-y-1.5">
              <Label htmlFor="c">Confirmar senha</Label>
              <Input id="c" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={10} />
              <p className="text-xs text-fg-subtle">Mínimo de 10 caracteres.</p>
            </div>
          )}
          {needCode && (
            <div className="space-y-1.5">
              <Label htmlFor="sc">Código de configuração do servidor</Label>
              <Input id="sc" autoComplete="off" value={setupCode} onChange={(e) => setSetupCode(e.target.value)} required />
              <p className="text-xs text-fg-subtle">No servidor: <code className="font-mono">sudo cat /etc/astryon/setup-code</code></p>
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-crit">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={!!offline || state === null}>
            {setup ? <ShieldCheck /> : <LogIn />}
            {setup ? "Criar e entrar" : "Entrar"}
          </Button>
        </form>
      </Card>
      <div className="mt-4 flex items-center justify-center text-xs text-fg-subtle">
        <Link href="/demo" className="inline-flex items-center gap-1 hover:text-fg">
          <Eye className="size-3.5" /> Ver demonstração (dados fictícios)
        </Link>
        <span className="sr-only">Sem afiliação com a Starlink/SpaceX</span>
      </div>
    </div>
  );
}
