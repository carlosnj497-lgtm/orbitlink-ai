"use client";

import { KeyRound } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { type FormEvent, useState, useSyncExternalStore } from "react";
import { Button, Callout, Card, Input, Label } from "@/components/ui/primitives";
import { requestJson } from "@/lib/api";
import { reloadTo } from "@/lib/navigation";

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

export function ResetPasswordForm() {
  // Fragmento e query só existem no navegador; no prerender o formulário espera.
  const loc = useSyncExternalStore(noop, readLocation, () => null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const link = loc === null ? undefined : parseRecoveryLink(...(loc.split("|") as [string, string]));
  const mismatch = confirm.length > 0 && confirm !== password;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!link || link.error || mismatch) return;
    setError(null);
    setBusy(true);
    const r = await requestJson("/api/auth/reset", { json: { ...link, password } });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    // Os tokens do link não ficam no histórico do navegador.
    window.history.replaceState(null, "", window.location.pathname);
    reloadTo("/");
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-6 flex justify-center">
        <Image src="/astryon-logo.webp" alt="ASTRYON" width={220} height={83} priority />
      </div>
      <Card className="ol-hud px-6 py-6">
        <h1 className="text-base font-semibold">Criar senha nova</h1>
        {link === null || link?.error ? (
          <>
            <Callout tone="warn" className="mt-4">
              {link?.error ? `O link não vale mais (${link.error}).` : "Este endereço não tem um link de recuperação válido."} Peça um link novo em “Esqueci a senha”.
            </Callout>
            <Link href="/login" className="mt-4 inline-block text-sm text-accent hover:underline">Voltar para o login</Link>
          </>
        ) : (
          <form onSubmit={submit} className="mt-5 space-y-4">
            <div className="space-y-1">
              <Label htmlFor="np">Senha nova</Label>
              <Input id="np" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} maxLength={256} />
              <p className="text-[11px] text-fg-subtle">Pelo menos 10 caracteres.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="cp">Repita a senha</Label>
              <Input id="cp" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required maxLength={256} aria-invalid={mismatch} />
              {mismatch && <p className="text-[11px] text-crit">As senhas não conferem.</p>}
            </div>
            {error && <Callout tone="crit">{error}</Callout>}
            <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={!link || mismatch || password.length < 10}>
              <KeyRound /> Salvar e entrar
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
