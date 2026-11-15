"use client";

import { KeyRound, LogIn, Mail, UserPlus } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button, Callout, Card, Input, Label } from "@/components/ui/primitives";
import { safeNext } from "@/lib/safe-next";

type Mode = "login" | "signup" | "recover";

const TITLES: Record<Mode, string> = { login: "Entrar", signup: "Criar conta", recover: "Recuperar senha" };

/** Entrada do painel na nuvem: conta por e-mail (Supabase Auth). */
export function CloudLoginForm() {
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accept, setAccept] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(params.get("conta") === "excluida" ? "Sua conta foi excluída." : null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (mode === "signup" && !accept) {
      setError("Para criar a conta, aceite os termos de uso e a política de privacidade.");
      return;
    }
    setBusy(true);
    const r = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mode === "recover" ? { email } : { email, password }),
    }).catch(() => null);
    setBusy(false);
    const body = r ? ((await r.json().catch(() => ({}))) as { detail?: string; confirm_email?: boolean }) : null;
    if (!r || !r.ok) {
      setError(body?.detail && typeof body.detail === "string" ? body.detail : "Não foi possível falar com o servidor.");
      return;
    }
    if (mode === "recover") {
      setInfo("Se existir uma conta com esse e-mail, enviamos um link para criar uma senha nova.");
      return;
    }
    if (body?.confirm_email) {
      setInfo("Conta criada! Abra o link que enviamos para o seu e-mail para confirmar e depois entre aqui.");
      setMode("login");
      return;
    }
    window.location.href = safeNext(params.get("next"), window.location.origin);
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-6 flex justify-center">
        <Image src="/astryon-logo.webp" alt="ASTRYON" width={220} height={83} priority />
      </div>
      <Card className="ol-hud px-6 py-6">
        <h1 className="text-base font-semibold">{TITLES[mode]}</h1>
        <p className="mt-1 text-sm text-fg-muted">
          {mode === "signup" ? "Acompanhe a sua Starlink de qualquer lugar." : mode === "recover" ? "Enviaremos um link para o seu e-mail." : "Use o e-mail da sua conta ASTRYON."}
        </p>
        <form onSubmit={submit} className="mt-5 space-y-4">
          <div className="space-y-1">
            <Label htmlFor="e">E-mail</Label>
            <Input id="e" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={200} />
          </div>
          {mode !== "recover" && (
            <div className="space-y-1">
              <Label htmlFor="p">Senha</Label>
              <Input id="p" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === "signup" ? 10 : 1} maxLength={256} />
              {mode === "signup" && <p className="text-[11px] text-fg-subtle">Pelo menos 10 caracteres.</p>}
            </div>
          )}
          {mode === "signup" && (
            <label className="flex items-start gap-2 text-xs text-fg-muted">
              <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="mt-0.5" />
              <span>
                Li e aceito os <Link href="/termos" className="text-accent hover:underline" target="_blank">termos de uso</Link> e a{" "}
                <Link href="/privacidade" className="text-accent hover:underline" target="_blank">política de privacidade</Link>.
              </span>
            </label>
          )}
          {error && <Callout tone="crit">{error}</Callout>}
          {info && <Callout tone="ok">{info}</Callout>}
          <Button type="submit" variant="primary" className="w-full" loading={busy}>
            {mode === "signup" ? <UserPlus /> : mode === "recover" ? <Mail /> : <LogIn />}
            {mode === "signup" ? "Criar conta" : mode === "recover" ? "Enviar link" : "Entrar"}
          </Button>
        </form>
        <div className="mt-4 flex flex-wrap justify-between gap-2 text-xs">
          {mode !== "login" ? (
            <button type="button" className="text-accent hover:underline" onClick={() => setMode("login")}>Já tenho conta</button>
          ) : (
            <button type="button" className="text-accent hover:underline" onClick={() => setMode("signup")}>Criar conta</button>
          )}
          {mode !== "recover" && (
            <button type="button" className="inline-flex items-center gap-1 text-fg-muted hover:text-fg" onClick={() => setMode("recover")}>
              <KeyRound className="size-3.5" aria-hidden /> Esqueci a senha
            </button>
          )}
        </div>
      </Card>
      <p className="mt-4 text-center text-[11px] text-fg-subtle">
        Projeto independente, sem afiliação com a Starlink ou a SpaceX. ·{" "}
        <Link href="/demo" className="hover:underline">Ver demonstração</Link>
      </p>
    </div>
  );
}
