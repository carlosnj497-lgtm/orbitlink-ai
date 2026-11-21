"use client";

import { AlertTriangle, ArrowLeft, Check, CheckCircle2, Eye, EyeOff, KeyRound, Link2Off } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useId, useState, useSyncExternalStore } from "react";
import { Button, Callout, Input, Label, Skeleton } from "@/components/ui/primitives";
import { requestJson } from "@/lib/api";
import { cn } from "@/lib/cn";
import { reloadTo } from "@/lib/navigation";
import { PasswordStrength } from "../login-parts/password-strength";
import { LoginShell } from "../login-parts/shell";

export interface RecoveryLink {
  access_token?: string;
  refresh_token?: string;
  token_hash?: string;
  /** Erro informado pelo próprio link (ex.: expirado). */
  error?: string;
}

/**
 * Lê o link de recuperação do Supabase: sessão no fragmento (`#access_token=…&refresh_token=…&type=recovery`)
 * ou `?token_hash=…&type=recovery` (modelo de e-mail personalizado).
 */
export function parseRecoveryLink(hash: string, search: string): RecoveryLink | null {
  const h = new URLSearchParams(hash.replace(/^#/, ""));
  const q = new URLSearchParams(search.replace(/^\?/, ""));
  const err = h.get("error_description") ?? q.get("error_description");
  if (err) return { error: err.replace(/\+/g, " ") };
  if (h.get("access_token") && h.get("refresh_token")) return { access_token: h.get("access_token")!, refresh_token: h.get("refresh_token")! };
  if (q.get("token_hash")) return { token_hash: q.get("token_hash")! };
  return null;
}

const noop = () => () => {};
const readLocation = () => `${window.location.hash}|${window.location.search}`;

/** Pausa entre salvar a senha e entrar no painel; a barra de progresso segue o mesmo tempo. */
const REDIRECT_MS = 1500;

export function ResetPasswordForm() {
  // Fragmento e query só existem no navegador; no prerender o formulário espera.
  const loc = useSyncExternalStore(noop, readLocation, () => null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const link = loc === null ? undefined : parseRecoveryLink(...(loc.split("|") as [string, string]));
  const mismatch = confirm.length > 0 && confirm !== password;
  const id = useId();
  const helpId = `${id}-password-help`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!link || link.error || mismatch || password.length < 10) return;
    setError(null);
    setBusy(true);
    const r = await requestJson("/api/auth/reset", { json: { ...link, password } });
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? "Não foi possível salvar a senha.");
      return;
    }
    setSuccess(true);
    // Os tokens do link não ficam no histórico do navegador.
    window.history.replaceState(null, "", window.location.pathname);
    window.setTimeout(() => reloadTo("/"), REDIRECT_MS);
  }

  const invalid = link === null || link?.error;
  // Após salvar, o replaceState limpa os tokens da URL e o link passa a ler como inválido;
  // o sucesso já decidido prevalece — senão a tela piscaria "Link inválido" antes do redirect.
  const showInvalid = !success && invalid;

  return (
    <LoginShell
      mode="nuvem"
      status={{ tone: "info", label: "Recuperação de conta" }}
      showDemo={false}
      title={showInvalid ? "Link inválido" : "Criar senha nova"}
      subtitle={showInvalid ? "Este link de recuperação não pode ser usado." : "Escolha uma senha forte para a sua conta ASTRYON."}
    >
      {link === undefined ? (
        <FormSkeleton />
      ) : showInvalid ? (
        <InvalidLink error={link?.error} />
      ) : success ? (
        <SavedState />
      ) : (
        <form onSubmit={submit} className="animate-rise space-y-4" aria-label="Criar senha nova">
          {error && (
            <Callout tone="crit" icon={<AlertTriangle className="size-4" />}>
              {error}
            </Callout>
          )}

          <p className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
            <span aria-hidden className="size-1.5 rounded-full bg-ok shadow-[0_0_8px_rgba(0_214_143,0.55)]" />
            Link de recuperação reconhecido.
          </p>

          <div className="space-y-1">
            <Label htmlFor={`${id}-np`}>Senha nova</Label>
            <div className="relative">
              <Input
                id={`${id}-np`}
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={10}
                maxLength={256}
                disabled={busy}
                aria-describedby={helpId}
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
            <div id={helpId} className="pt-1">
              <PasswordStrength password={password} />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor={`${id}-cp`}>Repita a senha</Label>
            <Input
              id={`${id}-cp`}
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              maxLength={256}
              disabled={busy}
              aria-invalid={mismatch}
              className={`h-11 sm:h-9${mismatch ? " border-crit/70" : ""}`}
            />
            {/* Linha de confirmação com altura reservada: o formulário não pula ao digitar. */}
            <p className={cn("flex min-h-4 items-center gap-1 pt-0.5 text-[11px] leading-4", mismatch ? "text-crit" : "text-ok")}>
              {mismatch ? (
                "As senhas não conferem."
              ) : confirm.length > 0 ? (
                <>
                  <Check className="size-3.5" aria-hidden /> As senhas conferem.
                </>
              ) : null}
            </p>
          </div>

          <Button type="submit" variant="primary" className="h-11 w-full sm:h-9" loading={busy} disabled={mismatch || password.length < 10}>
            <KeyRound /> Salvar e entrar
          </Button>

          <p className="text-center">
            <Link
              href="/login"
              className="inline-flex min-h-10 items-center gap-1 text-xs text-fg-subtle transition-colors hover:text-fg hover:underline"
            >
              <ArrowLeft className="size-3.5" aria-hidden /> Voltar para o login
            </Link>
          </p>
        </form>
      )}
    </LoginShell>
  );
}

/** Placeholder do formulário enquanto o link é lido no navegador (o prerender não vê o fragmento). */
function FormSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <span className="sr-only">Verificando o link de recuperação…</span>
      <Skeleton className="h-3.5 w-44" />
      <div className="space-y-1">
        <Skeleton className="h-3.5 w-20" />
        <Skeleton className="h-11 w-full sm:h-9" />
        <Skeleton className="mt-2 h-1.5 w-full" />
      </div>
      <div className="space-y-1">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-11 w-full sm:h-9" />
      </div>
      <Skeleton className="h-11 w-full sm:h-9" />
    </div>
  );
}

/** Link inválido, expirado ou já usado: ícone de instrumento em tom de sinalização. */
function InvalidLink({ error }: { error?: string }) {
  return (
    <div className="animate-rise flex flex-col items-center py-2 text-center">
      <div className="ol-hud mb-3 grid size-11 place-items-center rounded-md border border-warn/30 bg-warn-soft text-warn">
        <Link2Off className="size-5 stroke-[1.5]" aria-hidden />
      </div>
      <p className="max-w-[32ch] text-sm leading-relaxed text-fg-muted">
        {error ? `O link expirou ou já foi usado (${error}).` : "Este endereço não contém um link de recuperação válido."} Peça um link novo em{" "}
        <span className="text-fg">“Esqueci a senha”</span>, na tela de login.
      </p>
      <Button asChild variant="secondary" className="mt-4 h-11 w-full sm:h-9">
        <Link href="/login">
          <ArrowLeft /> Voltar para o login
        </Link>
      </Button>
    </div>
  );
}

/** Confirmação de senha salva, com a barra de progresso no mesmo tempo do redirecionamento. */
function SavedState() {
  return (
    <div className="animate-rise flex flex-col items-center py-3 text-center" role="status">
      <div className="mb-3 grid size-11 place-items-center rounded-full border border-ok/30 bg-ok-soft text-ok">
        <CheckCircle2 className="size-5 stroke-[1.75]" aria-hidden />
      </div>
      <p className="text-sm font-medium text-fg">Senha salva</p>
      <p className="mt-1 text-sm text-fg-muted">Redirecionando para o painel…</p>
      <div className="mt-4 h-0.5 w-36 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <div className="ol-fill h-full w-full origin-left bg-ok" style={{ animationDuration: `${REDIRECT_MS}ms` }} />
      </div>
    </div>
  );
}
