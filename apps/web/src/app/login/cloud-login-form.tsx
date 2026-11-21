"use client";

import { CheckCircle2, Eye, EyeOff, KeyRound, LogIn, UserPlus } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type FormEvent, useId, useState } from "react";
import { Button, Callout, Input, Label, Tabs } from "@/components/ui/primitives";
import { requestJson } from "@/lib/api";
import { safeNext } from "@/lib/safe-next";
import { Checkbox } from "./login-parts/checkbox";
import { PasswordStrength } from "./login-parts/password-strength";
import { LoginShell } from "./login-parts/shell";

type Mode = "login" | "signup" | "recover";

const TITLES: Record<Mode, { head: string; sub: string; icon: typeof LogIn; action: string }> = {
  login: { head: "Entrar", sub: "Use o e-mail da sua conta ASTRYON.", icon: LogIn, action: "Entrar" },
  signup: { head: "Criar conta", sub: "Acompanhe a sua Starlink de qualquer lugar.", icon: UserPlus, action: "Criar conta" },
  recover: { head: "Recuperar senha", sub: "Enviaremos um link para o seu e-mail.", icon: KeyRound, action: "Enviar link" },
};

export function CloudLoginForm() {
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [accept, setAccept] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(params.get("conta") === "excluida" ? "Sua conta foi excluída." : null);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const passwordHelpId = `${id}-password-help`;
  const cfg = TITLES[mode];
  const ActionIcon = cfg.icon;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (mode === "signup" && !accept) {
      setError("Para criar a conta, aceite os termos de uso e a política de privacidade.");
      return;
    }
    if (mode === "signup" && password.length < 10) {
      setError("A senha precisa de pelo menos 10 caracteres.");
      return;
    }
    setBusy(true);
    const r = await requestJson<{ confirm_email?: boolean }>(`/api/auth/${mode}`, { json: mode === "recover" ? { email } : { email, password } });
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? "Não foi possível completar a solicitação.");
      return;
    }
    const body = r.data;
    if (mode === "recover") {
      setInfo("Se existir uma conta com esse e-mail, enviamos um link para criar uma senha nova.");
      setEmail("");
      return;
    }
    if (body?.confirm_email) {
      setInfo("Conta criada! Abra o link que enviamos para o seu e-mail para confirmar e depois entre aqui.");
      setMode("login");
      setPassword("");
      return;
    }
    window.location.href = safeNext(params.get("next"), window.location.origin);
  }

  const tabs = [
    { value: "login" as const, label: "Entrar" },
    { value: "signup" as const, label: "Criar conta" },
    { value: "recover" as const, label: "Recuperar" },
  ];

  return (
    <LoginShell
      mode="nuvem"
      status={{ tone: "ok", label: "Nuvem ASTRYON" }}
      title={cfg.head}
      subtitle={cfg.sub}
    >
      <Tabs label="Modo de acesso" value={mode} onValueChange={(v) => setMode(v as Mode)} items={tabs} className="mb-5 grid w-full grid-cols-3 [&>button]:min-h-11 [&>button]:min-w-0 [&>button]:justify-center [&>button]:px-1 sm:[&>button]:min-h-8 sm:[&>button]:px-2.5" />

      <form onSubmit={submit} className="space-y-4" aria-label={cfg.head}>
        {error && (
          <Callout tone="crit" icon={<KeyRound className="size-4" />}>
            {error}
          </Callout>
        )}
        {info && (
          <Callout tone="ok" icon={<CheckCircle2 className="size-4" />}>
            {info}
          </Callout>
        )}

        <div className="space-y-1">
          <Label htmlFor={`${id}-e`}>E-mail</Label>
          <Input id={`${id}-e`} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={200} disabled={busy} className="h-11 sm:h-9" />
        </div>

        {mode !== "recover" && (
          <div className="space-y-1">
            <Label htmlFor={`${id}-p`}>Senha</Label>
            <div className="relative">
              <Input
                id={`${id}-p`}
                type={showPassword ? "text" : "password"}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={mode === "signup" ? 10 : 1}
                maxLength={256}
                disabled={busy}
                aria-describedby={mode === "signup" ? passwordHelpId : undefined}
                className="h-11 pr-12 sm:h-9"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-0.5 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-md text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg active:bg-surface-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-2"
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              >
                {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
              </button>
            </div>
            {mode === "signup" ? (
              <div id={passwordHelpId} className="pt-1">
                <PasswordStrength password={password} />
              </div>
            ) : (
              <p className="text-[11px] text-fg-subtle">Pelo menos 10 caracteres no cadastro.</p>
            )}
          </div>
        )}

        {mode === "signup" && (
          <Checkbox
            id={`${id}-accept`}
            checked={accept}
            onChange={setAccept}
            label={
              <>
                Li e aceito os{" "}
                <Link href="/termos" className="text-accent hover:text-accent-strong hover:underline" target="_blank">
                  termos de uso
                </Link>{" "}
                e a{" "}
                <Link href="/privacidade" className="text-accent hover:text-accent-strong hover:underline" target="_blank">
                  política de privacidade
                </Link>
                .
              </>
            }
          />
        )}

        <Button type="submit" variant="primary" className="h-11 w-full sm:h-9" loading={busy} disabled={mode === "signup" && !accept}>
          <ActionIcon /> {cfg.action}
        </Button>
      </form>
    </LoginShell>
  );
}
