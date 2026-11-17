"use client";

import { useQuery } from "@tanstack/react-query";
import { KeyRound, UserRound } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button, Callout, Input, Label } from "@/components/ui/primitives";
import { requestJson } from "@/lib/api";
import { useDemo } from "@/lib/demo-context";
import { reloadTo } from "@/lib/navigation";
import { Row, Section } from "./shared";

/* ----------------------------------------------------------------- Conta */
export function AccountSection() {
  const demo = useDemo();
  const me = useQuery<{ username: string; role: string } | null>({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      const r = await fetch("/api/auth/me");
      return r.ok ? r.json() : null;
    },
    enabled: !demo,
    staleTime: 300_000,
  });
  const [old, setOld] = useState("");
  const [nw, setNw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const mismatch = confirm.length > 0 && confirm !== nw;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (mismatch) return;
    setBusy(true);
    const r = await requestJson("/api/auth/password", { json: { old_password: old, new_password: nw } });
    setBusy(false);
    if (r.ok) {
      setMsg({ ok: true, text: "Senha alterada. Todas as sessões foram encerradas; entre novamente." });
      setTimeout(() => reloadTo("/login"), 1500);
    } else {
      setMsg({ ok: false, text: r.status ? (r.error ?? "Falha ao alterar a senha.") : "Não foi possível falar com o painel. A senha não foi alterada." });
    }
  }
  return (
    <Section
      id="conta"
      title="Conta e segurança"
      icon={UserRound}
      state={demo ? "off" : me.data ? "ok" : me.isLoading ? "loading" : "warn"}
      stateLabel={demo ? "demonstração" : undefined}
      value={demo ? "Visitante" : (me.data?.username ?? "—")}
      detail={demo ? "Troca de senha indisponível" : me.data?.role === "admin" ? "Administrador local · trocar senha" : "Trocar senha"}
      description="Usuário local deste painel. Trocar a senha encerra todas as sessões abertas."
    >
      <dl className="mb-4">
        <Row label="Usuário" value={demo ? "Visitante (demonstração)" : (me.data?.username ?? "—")} />
        <Row label="Papel" value={demo ? "—" : me.data?.role === "admin" ? "Administrador local" : (me.data?.role ?? "—")} />
      </dl>
      <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="old">Senha atual</Label>
          <Input id="old" type="password" autoComplete="current-password" value={old} onChange={(e) => setOld(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="new">Nova senha (mínimo de 10 caracteres)</Label>
          <Input id="new" type="password" autoComplete="new-password" minLength={10} maxLength={256} value={nw} onChange={(e) => setNw(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="new2">Repita a nova senha</Label>
          <Input id="new2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={mismatch} aria-describedby={mismatch ? "new2-err" : undefined} />
          {mismatch && (
            <p id="new2-err" className="text-xs text-crit">
              As senhas não conferem.
            </p>
          )}
        </div>
        <div className="sm:col-span-3">
          <Button size="sm" type="submit" loading={busy} disabled={demo || !old || nw.length < 10 || confirm !== nw}>
            <KeyRound /> Alterar senha
          </Button>
        </div>
        {msg && (
          <Callout tone={msg.ok ? "ok" : "crit"} className="sm:col-span-3">
            {msg.text}
          </Callout>
        )}
      </form>
    </Section>
  );
}
