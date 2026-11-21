"use client";

import { AlertTriangle, Eye, EyeOff, Info, LogIn, RefreshCw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useEffect, useId, useState } from "react";
import { Button, Callout, Input, Label, Skeleton } from "@/components/ui/primitives";
import { requestJson } from "@/lib/api";
import { safeNext } from "@/lib/safe-next";
import { loadAuthState } from "./login-parts/auth-state";
import { PasswordStrength } from "./login-parts/password-strength";
import { LoginShell } from "./login-parts/shell";

const LAST_USER_KEY = "astryon:last-username";

export function LoginForm() {
  const params = useSearchParams();
  const { data: state = null, refetch, isFetching } = useQuery({ queryKey: ["auth", "state"], queryFn: loadAuthState, retry: false });
  const savedUser = typeof window !== "undefined" ? window.localStorage.getItem(LAST_USER_KEY) : "";
  // O foco automático só ajuda em ponteiro fino e viewport alto; no celular ele abre o teclado
  // e rola a página para longe da marca antes de a pessoa ver o card.
  const canAutoFocus =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: fine)").matches &&
    window.innerHeight >= 700;
  const [username, setUsername] = useState(() => savedUser ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setup = state && "setup_required" in state && state.setup_required;
  const needCode = setup && "setup_code_required" in state && state.setup_code_required;
  const channel = state && "setup_required" in state ? (state.recovery_channel ?? (state.email_recovery ? "email" : null)) : null;
  const emailRecovery = channel === "email";
  const telegramRecovery = channel === "telegram";
  const offline = state && "detail" in state;
  const sessionExpired = params.get("motivo") === "expirada";
  const id = useId();
  const passwordHelpId = `${id}-password-help`;

  const status = !state
    ? ({ tone: "info" as const, label: "Consultando sistema" })
    : offline
      ? ({ tone: "crit" as const, label: "Agente offline" })
      : setup
        ? ({ tone: "info" as const, label: "Primeiro acesso" })
        : ({ tone: "ok" as const, label: "Sistema pronto" });

  useEffect(() => {
    if (sessionExpired && window.history.replaceState) {
      const url = new URL(window.location.href);
      url.searchParams.delete("motivo");
      window.history.replaceState({}, "", url);
    }
  }, [sessionExpired]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (setup && password !== confirm) {
      setError("As senhas não conferem.");
      return;
    }
    if (setup && password.length < 10) {
      setError("A senha precisa de pelo menos 10 caracteres.");
      return;
    }
    if (setup && emailRecovery && email.trim().length === 0) {
      setError("Informe um e-mail para recuperar a senha quando precisar.");
      return;
    }
    setBusy(true);
    const payload = {
      username,
      password,
      ...(setup && needCode ? { setup_code: setupCode } : {}),
      ...(setup && email.trim() ? { email: email.trim() } : {}),
    };
    const r = await requestJson(`/api/auth/${setup ? "setup" : "login"}`, { json: payload }, "Não foi possível falar com o painel.");
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? "Falha na autenticação.");
      return;
    }
    if (typeof window !== "undefined" && username.trim()) {
      window.localStorage.setItem(LAST_USER_KEY, username.trim());
    }
    window.location.href = safeNext(params.get("next"), window.location.origin);
  }

  const title = setup ? "Criar administrador local" : "Acessar o console";
  const subtitle = setup
    ? "Defina o usuário administrador. A senha fica somente neste servidor (hash scrypt)."
    : "Autentique-se para monitorar a conexão.";

  return (
    <LoginShell
      mode="local"
      status={status}
      title={title}
      subtitle={subtitle}
      version={state && "version" in state ? state.version : null}
    >
      {!state && (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="h-9 w-full" />
        </div>
      )}

      {state && offline && (
        <Callout tone="crit" icon={<AlertTriangle className="size-4" />} title="Sem conexão com o agente">
          {(state as { detail: string }).detail}
          <div className="mt-3">
            <Button type="button" size="sm" variant="secondary" onClick={() => refetch()} disabled={isFetching} className="h-11 sm:h-8">
              {isFetching ? <RefreshCw className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
              Testar conexão
            </Button>
          </div>
        </Callout>
      )}

      {sessionExpired && (
        <Callout tone="warn" icon={<AlertTriangle className="size-4" />} title="Sessão expirada">
          Sua sessão expirou por inatividade. Entre novamente para continuar.
        </Callout>
      )}

      {state && !offline && (
        <form onSubmit={submit} className="space-y-4" aria-label={title}>
          {error && (
            <Callout tone="crit" icon={<AlertTriangle className="size-4" />}>
              {error}
            </Callout>
          )}

          <div className="space-y-1.5">
            <Label htmlFor={`${id}-u`}>Usuário</Label>
            <Input
              id={`${id}-u`}
              autoComplete="username"
              autoFocus={canAutoFocus}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
              disabled={busy}
              placeholder={setup ? "ex: admin" : undefined}
              className="h-11 sm:h-9"
            />
          </div>

          {setup && (
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-e`}>
                E-mail para recuperação {emailRecovery ? "" : "(opcional)"}
              </Label>
              <Input
                id={`${id}-e`}
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required={emailRecovery}
                maxLength={200}
                disabled={busy}
                aria-describedby={`${id}-e-help`}
                className="h-11 sm:h-9"
              />
              <p id={`${id}-e-help`} className="text-xs leading-relaxed text-fg-subtle">
                {emailRecovery
                  ? "É para cá que enviaremos o código quando você esquecer a senha."
                  : telegramRecovery
                    ? "A recuperação é pelo Telegram. O e-mail é opcional."
                    : "Opcional enquanto nenhum canal de recuperação está configurado no servidor."}
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor={`${id}-p`}>Senha</Label>
            <div className="relative">
              <Input
                id={`${id}-p`}
                type={showPassword ? "text" : "password"}
                autoComplete={setup ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={setup ? 10 : undefined}
                disabled={busy}
                aria-describedby={setup ? passwordHelpId : undefined}
                className="h-11 pr-12 sm:h-9"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-0.5 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-md text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg active:bg-surface-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-2 sm:size-8"
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              >
                {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
              </button>
            </div>
            {setup ? (
              <div id={passwordHelpId} className="space-y-2">
                <p className="text-xs text-fg-subtle">Mínimo de 10 caracteres.</p>
                <PasswordStrength password={password} />
              </div>
            ) : (
              <div className="flex justify-end">
                <Link
                  href="/login/redefinir"
                  className="inline-flex min-h-11 items-center px-1 -mx-1 text-xs text-fg-subtle transition-colors hover:text-fg hover:underline sm:min-h-9"
                >
                  Esqueci a senha
                </Link>
              </div>
            )}
          </div>

          {setup && (
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-c`}>Confirmar senha</Label>
              <Input
                id={`${id}-c`}
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={10}
                disabled={busy}
                aria-invalid={confirm.length > 0 && password !== confirm}
                className="h-11 sm:h-9"
              />
              {confirm.length > 0 && password !== confirm && <p className="text-xs text-crit">As senhas não conferem.</p>}
            </div>
          )}

          {needCode && (
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-sc`}>Código de configuração</Label>
              <Input id={`${id}-sc`} autoComplete="off" value={setupCode} onChange={(e) => setSetupCode(e.target.value)} required disabled={busy} className="h-11 sm:h-9" />
              <p className="text-xs text-fg-subtle">
                No servidor: <code className="rounded-sm bg-surface-2 px-1 py-0.5 font-mono text-[10.5px]">sudo cat /etc/astryon/setup-code</code>
              </p>
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            className="h-11 w-full sm:h-9"
            loading={busy}
            disabled={Boolean(offline || state === null || (setup && password !== confirm) || (setup && emailRecovery && !email.trim()))}
          >
            {setup ? <ShieldCheck /> : <LogIn />}
            {setup ? "Criar e entrar" : "Entrar no console"}
          </Button>

          {setup && (
            <Callout tone="info" icon={<Info className="size-4" />} className="text-xs">
              {emailRecovery
                ? "Guarde a senha em um gerenciador. Se precisar, o código de recuperação chega no e-mail cadastrado."
                : telegramRecovery
                  ? "Guarde a senha em um gerenciador. Se precisar, o código de recuperação chega no seu Telegram."
                  : "Guarde a senha em um gerenciador. O envio de código ainda não está configurado neste servidor."}
            </Callout>
          )}
        </form>
      )}
    </LoginShell>
  );
}
