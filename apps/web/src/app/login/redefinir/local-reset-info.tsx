"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Check, CheckCircle2, Copy, Eye, EyeOff, KeyRound, Mail, Send, Server, ShieldCheck, Terminal } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useEffect, useId, useState } from "react";
import { Button, Callout, Input, Label, Skeleton } from "@/components/ui/primitives";
import { requestJson } from "@/lib/api";
import { cn } from "@/lib/cn";
import { loadAuthState } from "../login-parts/auth-state";
import { PasswordStrength } from "../login-parts/password-strength";
import { LoginShell } from "../login-parts/shell";

/**
 * Recuperação local. Com SMTP configurado, o código temporário vai para o e-mail cadastrado na conta.
 * Sem SMTP, a tela não inventa um caminho inseguro: mostra o código do servidor (quando existe) e o
 * procedimento pelo terminal. A senha nunca é trocada sem uma prova de identidade.
 */
const MANUAL_CMD = `sudo systemctl stop astryon-agent
sudo -u astryon sqlite3 /var/lib/astryon/astryon.sqlite3 "DELETE FROM sessions; DELETE FROM local_users;"
sudo systemctl start astryon-agent
sudo astryonctl setup-code`;

/** Fallback para http na LAN, onde a API de clipboard pode não existir. */
function fallbackCopy(text: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

export function LocalResetInfo() {
  const { data: state = null, refetch, isFetching } = useQuery({ queryKey: ["auth", "state"], queryFn: loadAuthState, retry: false });
  const [done, setDone] = useState(false);

  const offlineMessage = state !== null && "detail" in state ? state.detail : null;
  const channel = state !== null && "setup_required" in state
    ? (state.recovery_channel ?? (state.email_recovery ? "email" : null))
    : null;
  const serverCode = state !== null && "setup_required" in state && state.setup_code_required === true;

  const status = state === null
    ? ({ tone: "info" as const, label: "Consultando sistema" })
    : offlineMessage !== null
      ? ({ tone: "crit" as const, label: "Agente offline" })
      : channel !== null
        ? ({ tone: "ok" as const, label: channel === "telegram" ? "Recuperação por Telegram" : "Recuperação por e-mail" })
        : serverCode
          ? ({ tone: "warn" as const, label: "Recuperação pelo servidor" })
          : ({ tone: "warn" as const, label: "Recuperação desligada" });

  return (
    <LoginShell
      mode="local"
      status={status}
      title={done ? "Senha redefinida" : "Redefinir senha"}
      subtitle={
        done
          ? "Entre no painel com a senha nova."
          : channel === "telegram"
            ? "Enviaremos um código temporário para o seu Telegram."
            : channel === "email"
              ? "Enviaremos um código temporário para o e-mail cadastrado na conta."
              : serverCode
                ? "Confirme com o código do servidor e escolha uma senha forte."
                : "Recupere o acesso direto no servidor que executa o ASTRYON."
      }
    >
      {state === null ? (
        <FormSkeleton />
      ) : done ? (
        <SavedState />
      ) : offlineMessage !== null ? (
        <OfflineState message={offlineMessage} onRetry={() => void refetch()} retrying={isFetching} />
      ) : channel !== null ? (
        <ResetFlow channel={channel} onDone={() => setDone(true)} />
      ) : serverCode ? (
        <CodeFallback onDone={() => setDone(true)} />
      ) : (
        <DisabledState />
      )}
    </LoginShell>
  );
}

/* ----------------------------------------------------------------- Telegram / e-mail */

/**
 * Dois passos. No Telegram, o pedido é um clique (o código vai para o chat já configurado). No e-mail, a pessoa
 * informa o endereço cadastrado. A resposta do pedido é sempre a mesma, exista ou não a conta.
 */
function ResetFlow({ channel, onDone }: { channel: "telegram" | "email"; onDone: () => void }) {
  const [step, setStep] = useState<"start" | "code">("start");
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const id = useId();
  const helpId = `${id}-password-help`;
  const isEmail = channel === "email";
  const mismatch = confirm.length > 0 && confirm !== password;

  // Contagem do reenvio: evita que um clique duplo dispare várias mensagens e mostra quando é possível repetir.
  useEffect(() => {
    if (cooldown === 0) return;
    const t = window.setTimeout(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  async function sendCode(target?: string) {
    const value = (target ?? email).trim();
    if (isEmail && !value) return;
    setError(null);
    setBusy(true);
    const r = await requestJson("/api/auth/recover-request", { json: isEmail ? { email: value } : {} });
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? "Não foi possível enviar o código.");
      return;
    }
    setSentTo(value);
    setStep("code");
    setCooldown(60);
  }

  function changeTarget() {
    setStep("start");
    setCode("");
    setError(null);
    setCooldown(0);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (mismatch || password.length < 10 || code.trim().length === 0) return;
    setError(null);
    setBusy(true);
    const r = await requestJson("/api/auth/recover-confirm", {
      json: { ...(isEmail ? { email: sentTo } : {}), code: code.trim(), new_password: password },
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? "Não foi possível redefinir a senha.");
      return;
    }
    onDone();
  }

  if (step === "start") {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void sendCode();
        }}
        className="animate-rise space-y-4"
        aria-label="Pedir código de recuperação"
      >
        {error && (
          <Callout tone="crit" icon={<AlertTriangle className="size-4" />}>
            {error}
          </Callout>
        )}

        {isEmail ? (
          <>
            <p className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
              <span aria-hidden className="size-1.5 rounded-full bg-ok shadow-[0_0_8px_rgba(0_214_143,0.55)]" />
              Recuperação por e-mail ativa
            </p>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-email`}>E-mail da conta</Label>
              <Input
                id={`${id}-email`}
                type="email"
                inputMode="email"
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                maxLength={200}
                disabled={busy}
                aria-describedby={`${id}-email-help`}
                className="h-11 sm:h-9"
              />
              <p id={`${id}-email-help`} className="text-xs leading-relaxed text-fg-subtle">
                É o endereço cadastrado no primeiro acesso ou em Configurações → Conta e segurança.
              </p>
            </div>
          </>
        ) : (
          <Callout tone="info" icon={<Send className="size-4" />} title="Código pelo Telegram">
            O código temporário chega na conversa com o bot do ASTRYON — o mesmo que envia os alertas. Nenhuma
            senha vai por mensagem.
          </Callout>
        )}

        <Button
          type="submit"
          variant="primary"
          className="h-11 w-full sm:h-9"
          loading={busy}
          disabled={busy || (isEmail && email.trim().length < 3)}
        >
          {isEmail ? <Mail /> : <Send />} Enviar código
        </Button>

        <BackToLogin />
      </form>
    );
  }

  return (
    <form onSubmit={submit} className="animate-rise space-y-4" aria-label="Usar código de recuperação">
      {error && (
        <Callout tone="crit" icon={<AlertTriangle className="size-4" />}>
          {error}
        </Callout>
      )}

      <Callout tone="info" icon={isEmail ? <Mail className="size-4" /> : <Send className="size-4" />} title="Código enviado">
        {isEmail ? (
          <p>
            Se <strong className="font-medium text-fg">{sentTo}</strong> estiver cadastrado, o código chega em
            instantes. Confira também a pasta de spam.
          </p>
        ) : (
          <p>Confira a conversa com o bot do ASTRYON no Telegram. O código chega em segundos.</p>
        )}
        <button type="button" onClick={changeTarget} className="mt-1 text-xs font-medium text-accent-2 hover:underline">
          {isEmail ? "Trocar e-mail" : "Reenviar ou ver instruções"}
        </button>
      </Callout>

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-code`}>Código recebido</Label>
        <Input
          id={`${id}-code`}
          autoComplete="one-time-code"
          inputMode="text"
          autoCapitalize="characters"
          spellCheck={false}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
          maxLength={9}
          disabled={busy}
          placeholder="ABCD-EFGH"
          className="h-11 font-mono tracking-[0.18em] sm:h-9"
        />
        <div className="flex items-center justify-between gap-2 pt-0.5">
          <p className="text-xs text-fg-subtle">Vale por 15 minutos e só pode ser usado uma vez.</p>
          <button
            type="button"
            onClick={() => void sendCode(sentTo)}
            disabled={busy || cooldown > 0}
            className="shrink-0 text-xs font-medium text-accent-2 transition-colors hover:underline disabled:cursor-not-allowed disabled:text-fg-subtle disabled:no-underline"
          >
            {cooldown > 0 ? `Reenviar em ${cooldown}s` : "Reenviar"}
          </button>
        </div>
      </div>

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
          <MinLengthHint password={password} />
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
          className={cn("h-11 sm:h-9", mismatch && "border-crit/70")}
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

      <Button
        type="submit"
        variant="primary"
        className="h-11 w-full sm:h-9"
        loading={busy}
        disabled={mismatch || password.length < 10 || code.trim().length === 0}
      >
        <KeyRound /> Redefinir senha
      </Button>

      <BackToLogin />
    </form>
  );
}

/* ----------------------------------------------------------------- Código do servidor (sem SMTP) */

/** Reserva para quando o e-mail ainda não está configurado: o código do servidor continua valendo. */
function CodeFallback({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState("admin");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const helpId = `${id}-password-help`;
  const mismatch = confirm.length > 0 && confirm !== password;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (mismatch || password.length < 10 || code.trim().length === 0) return;
    setError(null);
    setBusy(true);
    const r = await requestJson("/api/auth/recover", {
      json: { username: username.trim(), recovery_code: code.trim(), new_password: password },
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? "Não foi possível redefinir a senha.");
      return;
    }
    onDone();
  }

  return (
    <form onSubmit={submit} className="animate-rise space-y-4" aria-label="Redefinir senha com o código do servidor">
      <Callout tone="info" icon={<Send className="size-4" />} title="Recuperação por mensagem ainda não configurada">
        Configure o Telegram ou o SMTP em <strong className="font-medium text-fg">Configurações → Credenciais</strong>{" "}
        para receber o código. Enquanto isso, use o código do servidor.
      </Callout>

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
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          minLength={3}
          maxLength={64}
          disabled={busy}
          className="h-11 sm:h-9"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-code`}>Código do servidor</Label>
        <Input
          id={`${id}-code`}
          autoComplete="off"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
          disabled={busy}
          aria-describedby={`${id}-code-help`}
          className="h-11 sm:h-9"
        />
        <p id={`${id}-code-help`} className="text-xs leading-relaxed text-fg-subtle">
          No servidor: <code className="rounded-sm bg-surface-2 px-1 py-0.5 font-mono text-[10.5px]">sudo cat /etc/astryon/setup-code</code> (instalação Linux) ou a variável{" "}
          <code className="rounded-sm bg-surface-2 px-1 py-0.5 font-mono text-[10.5px]">ASTRYON_SETUP_CODE</code> no{" "}
          <code className="rounded-sm bg-surface-2 px-1 py-0.5 font-mono text-[10.5px]">.env</code>
        </p>
      </div>

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
          <MinLengthHint password={password} />
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
          className={cn("h-11 sm:h-9", mismatch && "border-crit/70")}
        />
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

      <Button type="submit" variant="primary" className="h-11 w-full sm:h-9" loading={busy} disabled={mismatch || password.length < 10 || code.trim().length === 0}>
        <ShieldCheck /> Redefinir senha
      </Button>

      <BackToLogin />
    </form>
  );
}

/* ----------------------------------------------------------------- Estados auxiliares */

/** Explica por que o botão ainda está desativado; sem isso, a barra de força deixa o limite sutil demais. */
function MinLengthHint({ password }: { password: string }) {
  const missing = 10 - password.length;
  if (missing <= 0) return null;
  return (
    <p className="pt-0.5 text-xs leading-relaxed text-warn">
      {missing === 1 ? "Falta 1 caractere" : `Faltam ${missing} caracteres`} para o mínimo de 10. O botão habilita ao atingir.
    </p>
  );
}

function BackToLogin() {
  return (
    <p className="text-center">
      <Link href="/login" className="inline-flex min-h-10 items-center gap-1 text-xs text-fg-subtle transition-colors hover:text-fg hover:underline">
        <ArrowLeft className="size-3.5" aria-hidden /> Voltar para o login
      </Link>
    </p>
  );
}

/** Placeholder enquanto o estado do agente é consultado. */
function FormSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <span className="sr-only">Consultando o servidor...</span>
      <Skeleton className="h-3.5 w-40" />
      <Skeleton className="h-11 w-full sm:h-9" />
      <div className="space-y-1">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-11 w-full sm:h-9" />
      </div>
      <Skeleton className="h-11 w-full sm:h-9" />
    </div>
  );
}

/** Senha salva: o painel não abre sessão aqui; a pessoa entra pela tela de login. */
function SavedState() {
  return (
    <div className="animate-rise flex flex-col items-center py-3 text-center" role="status">
      <div className="mb-3 grid size-11 place-items-center rounded-full border border-ok/30 bg-ok-soft text-ok">
        <CheckCircle2 className="size-5 stroke-[1.75]" aria-hidden />
      </div>
      <p className="text-sm text-fg-muted">Todas as sessões abertas foram encerradas. Entre com a senha nova.</p>
      <Button asChild variant="primary" className="mt-4 h-11 w-full sm:h-9">
        <Link href="/login">
          <KeyRound /> Entrar no painel
        </Link>
      </Button>
    </div>
  );
}

/** Agente inalcançável: sem ele não há como validar nada. */
function OfflineState({ message, onRetry, retrying }: { message: string; onRetry: () => void; retrying: boolean }) {
  return (
    <div className="animate-rise">
      <Callout tone="crit" icon={<AlertTriangle className="size-4" />} title="Sem resposta do servidor">
        {message}
      </Callout>
      <Button variant="secondary" className="mt-4 h-11 w-full sm:h-9" loading={retrying} onClick={onRetry}>
        Tentar de novo
      </Button>
      <div className="mt-3">
        <BackToLogin />
      </div>
    </div>
  );
}

/** Passo do procedimento manual: a ordem evita abrir o SQLite enquanto o agente o utiliza. */
function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[1.75rem_1fr] gap-x-3">
      <span aria-hidden className="grid size-7 place-items-center rounded-md border border-border-strong bg-bg-elev font-mono text-[11px] text-accent">
        {n}
      </span>
      <div className="min-w-0 pb-5 last:pb-0">
        <p className="text-sm font-medium text-fg">{title}</p>
        <div className="mt-1 text-sm leading-relaxed text-fg-muted">{children}</div>
      </div>
    </li>
  );
}

/** Sem SMTP e sem código do servidor: a tela não redefine sozinha; mostra o caminho seguro pelo terminal. */
function DisabledState() {
  const [copied, setCopied] = useState(false);

  async function copyCommand() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(MANUAL_CMD);
      ok = true;
    } catch {
      ok = fallbackCopy(MANUAL_CMD);
    }
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="animate-rise">
      <Callout tone="warn" icon={<AlertTriangle className="size-4" />} title="Redefinição pela tela desligada">
        O servidor não tem SMTP nem código de recuperação definidos, então esta tela não troca a senha para não
        deixar qualquer um na rede tomar a conta. Recupere pelo terminal — ou configure o e-mail para liberar a
        recuperação.
      </Callout>

      <div className="mt-4 rounded-md border border-border bg-bg-elev p-3">
        <p className="flex items-center gap-1.5 text-xs font-medium text-fg">
          <Send className="size-3.5 text-accent" aria-hidden /> Para liberar a recuperação pela tela
        </p>
        <p className="mt-1 text-xs leading-relaxed text-fg-subtle">
          Entre no painel e abra <strong className="font-medium text-fg">Configurações → Credenciais</strong>: o
          Telegram (bot e chat) ou o SMTP. Com o Telegram configurado, o código de recuperação chega na conversa com
          o bot. Também vale definir <code className="rounded-sm bg-surface-2 px-1 py-0.5 font-mono text-[10.5px]">ASTRYON_SMTP_*</code>{" "}
          ou <code className="rounded-sm bg-surface-2 px-1 py-0.5 font-mono text-[10.5px]">ASTRYON_TELEGRAM_*</code> no{" "}
          <code className="rounded-sm bg-surface-2 px-1 py-0.5 font-mono text-[10.5px]">.env</code> e reiniciar o agente.
        </p>
      </div>

      <section className="mt-5" aria-labelledby="manual-steps-title">
        <div className="mb-3 flex items-center gap-2">
          <Server className="size-4 text-accent" aria-hidden />
          <h2 id="manual-steps-title" className="text-sm font-medium text-fg">
            Recuperar pelo terminal
          </h2>
        </div>
        <ol className="list-none">
          <Step n={1} title="Abra o terminal do servidor">
            Conecte-se ao Ubuntu que executa o painel. Você precisa de uma conta com permissão para usar{" "}
            <code className="rounded-sm bg-bg-elev px-1 py-0.5 font-mono text-[11px] text-fg">sudo</code>.
          </Step>
          <Step n={2} title="Execute o procedimento abaixo">
            O agente é pausado antes da alteração e iniciado novamente em seguida. Isso remove somente o acesso local
            anterior e suas sessões.
          </Step>
          <Step n={3} title="Crie o administrador novamente">
            O último comando mostra o código de configuração. Volte ao painel e use esse código no primeiro acesso
            para definir uma senha nova.
          </Step>
        </ol>
      </section>

      <div className="ol-hud overflow-hidden rounded-md border border-accent-2/35 bg-bg-elev shadow-[0_16px_40px_-26px_rgb(0_140_255/0.55)]">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <span className="ol-label flex items-center gap-1.5 text-fg-muted">
            <Terminal className="size-3.5 text-accent" aria-hidden /> Cole no terminal do servidor
          </span>
          <button
            type="button"
            onClick={copyCommand}
            className={cn(
              "inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-[4px] px-2.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-2",
              copied ? "bg-ok-soft text-ok" : "bg-surface-2 text-fg hover:bg-surface-3",
            )}
          >
            {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
            {copied ? "Copiado" : "Copiar comandos"}
          </button>
        </div>
        <code className="block whitespace-pre-wrap break-words px-3 py-3 font-mono text-[11px] leading-[1.75] text-fg-muted">{MANUAL_CMD}</code>
      </div>

      <div className="mt-4">
        <BackToLogin />
      </div>
    </div>
  );
}
