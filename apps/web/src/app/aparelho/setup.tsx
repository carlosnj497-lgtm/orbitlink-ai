"use client";

import { CircleCheck, Link2 } from "lucide-react";
import Image from "next/image";
import { type FormEvent, useEffect, useState } from "react";
import { Button, Callout, Card, Input, Label, Skeleton } from "@/components/ui/primitives";

type State = { appliance: boolean; cloud_configured: boolean; paired: boolean; workspace_name: string | null; terminal_name: string } | { detail: string };

/** Primeira configuração do aparelho ASTRYON: digitar o código da conta e pronto. */
export function ApplianceSetup() {
  const [st, setSt] = useState<State | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const r = await fetch("/api/appliance/state").catch(() => null);
    setSt(r ? await r.json().catch(() => ({ detail: "erro" })) : { detail: "O aparelho ainda está iniciando. Aguarde um minuto e recarregue." });
  }
  useEffect(() => {
    void load();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const r = await fetch("/api/appliance/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) }).catch(() => null);
    setBusy(false);
    const body = r ? ((await r.json().catch(() => ({}))) as { detail?: string }) : null;
    if (!r || !r.ok) {
      setError(typeof body?.detail === "string" ? body.detail : "Não foi possível falar com o aparelho.");
      return;
    }
    await load();
  }

  const ok = st && "paired" in st;
  const codeOk = code.replace(/[^A-Za-z0-9]/g, "").length === 8;
  return (
    <div className="w-full max-w-sm">
      <div className="mb-6 flex justify-center">
        <Image src="/astryon-logo.webp" alt="ASTRYON" width={220} height={83} priority />
      </div>
      <Card className="ol-hud px-6 py-6">
        {!st && <Skeleton className="h-40 w-full" />}
        {st && "detail" in st && <Callout tone="warn">{st.detail}</Callout>}
        {ok && !st.appliance && <Callout tone="info">Este ASTRYON não está em modo aparelho. Entre no painel para conectar a conta em Configurações → Conta na nuvem.</Callout>}
        {ok && st.appliance && st.paired && (
          <div className="text-center">
            <CircleCheck className="mx-auto size-10 text-ok" aria-hidden />
            <h1 className="mt-3 text-base font-semibold">Aparelho conectado</h1>
            <p className="mt-1 text-sm text-fg-muted">{st.workspace_name ? `Conta: ${st.workspace_name}. ` : ""}Os dados começam a aparecer no painel da sua conta em alguns minutos.</p>
            <p className="mt-3 text-xs text-fg-subtle">Você já pode fechar esta página.</p>
          </div>
        )}
        {ok && st.appliance && !st.paired && (
          <>
            <h1 className="text-base font-semibold">Conectar à sua conta</h1>
            <p className="mt-1 text-sm text-fg-muted">No painel da sua conta, abra Conta → Conectar a antena, gere um código e digite aqui.</p>
            {!st.cloud_configured && <Callout tone="crit" className="mt-3">Este aparelho está sem a configuração da nuvem. Fale com quem forneceu o aparelho.</Callout>}
            <form onSubmit={submit} className="mt-5 space-y-4">
              <div className="space-y-1">
                <Label htmlFor="c">Código</Label>
                <Input id="c" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="K7QF-2M9X" maxLength={12} autoComplete="off" className="text-center font-mono text-lg tracking-[0.25em]" />
              </div>
              {error && <Callout tone="crit">{error}</Callout>}
              <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={!codeOk || !st.cloud_configured}>
                <Link2 /> Conectar
              </Button>
            </form>
          </>
        )}
      </Card>
      <p className="mt-4 text-center text-[11px] text-fg-subtle">ASTRYON · projeto independente, sem afiliação com a Starlink ou a SpaceX.</p>
    </div>
  );
}
