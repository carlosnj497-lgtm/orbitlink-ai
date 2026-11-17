"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Cloud } from "lucide-react";
import { useState } from "react";
import { QueryError } from "@/components/domain";
import { Badge, Button, Callout, Input, Label, Skeleton } from "@/components/ui/primitives";
import { api, ApiError, useAgent } from "@/lib/api";
import { useDemo } from "@/lib/demo-context";
import { fmtAgo, fmtNumber } from "@/lib/format";
import { type ModuleState, Section, type SyncState } from "./shared";

/* ----------------------------------------------------------------- Conta na nuvem */
export function CloudSection() {
  const demo = useDemo();
  const qc = useQueryClient();
  const q = useAgent<SyncState>(demo ? null : "sync", { refetchInterval: 30_000 });
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const refresh = () => qc.invalidateQueries({ predicate: (x) => x.queryKey[1] === "sync" });
  const pair = useMutation({
    mutationFn: () => api("sync/pair", { method: "POST", body: JSON.stringify({ code: code.trim(), name: name.trim() || null }) }),
    onSuccess: () => {
      setCode("");
      refresh();
    },
  });
  const unpair = useMutation({ mutationFn: () => api("sync/pair", { method: "DELETE" }), onSuccess: refresh });
  const p = q.data?.pairing;
  const codeOk = code.replace(/[^A-Za-z0-9]/g, "").length === 8;
  const state: ModuleState = demo ? "off" : !p ? (q.error ? "warn" : "loading") : p.paired ? "ok" : "off";
  return (
    <Section
      id="nuvem"
      title="Conta na nuvem"
      icon={Cloud}
      state={state}
      stateLabel={demo ? "demonstração" : p && !p.cloud_configured ? "não configurada" : p && !p.paired ? "não conectado" : undefined}
      value={demo ? "Indisponível na demonstração" : !p ? "—" : p.paired ? (p.workspace_name ?? "Conectado") : "Não conectado"}
      detail={p?.paired ? `${p.paired_at ? `Pareado ${fmtAgo(p.paired_at)}` : "Via arquivo de ambiente"}${q.data ? ` · ${fmtNumber(q.data.pending, 0)} na fila` : ""}` : "Acompanhe a antena de qualquer lugar"}
      description="Ligue este agente à sua conta para acompanhar a antena de qualquer lugar, sem Tailscale. Gere o código no painel da sua conta, em Dispositivos → Conectar agente."
    >
      {demo && <Callout tone="demo">Na demonstração não é possível conectar uma conta.</Callout>}
      {q.error && <QueryError error={q.error} />}
      {!demo && !q.data && !q.error && <Skeleton className="h-20 w-full" />}
      {p && !p.cloud_configured && (
        <Callout tone="info" title="Nuvem não configurada neste agente">
          Defina ASTRYON_SUPABASE_URL e ASTRYON_SUPABASE_ANON_KEY no arquivo de ambiente e reinicie o agente.
        </Callout>
      )}
      {p && p.cloud_configured && p.paired && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-bg-elev/60 px-3 py-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm text-fg">
              <Badge tone="accent">conectado</Badge>
              {p.workspace_name ? `Conta: ${p.workspace_name}` : "Conta configurada pelo arquivo de ambiente"}
            </p>
            <p className="mt-1 text-[11px] text-fg-subtle">
              {p.paired_at ? `Pareado ${fmtAgo(p.paired_at)}` : "Token definido em ASTRYON_SUPABASE_AGENT_TOKEN"}
              {q.data ? ` · ${fmtNumber(q.data.pending, 0)} registro(s) na fila de envio` : ""}
            </p>
          </div>
          {!p.via_env && (
            <Button size="sm" variant="ghost" onClick={() => unpair.mutate()} loading={unpair.isPending}>
              Desconectar
            </Button>
          )}
        </div>
      )}
      {p && p.cloud_configured && !p.paired && (
        <form
          className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (codeOk) pair.mutate();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="pc">Código da conta</Label>
            <Input id="pc" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="K7QF-2M9X" maxLength={12} autoComplete="off" className="font-mono tracking-widest" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pn">Nome deste agente (opcional)</Label>
            <Input id="pn" value={name} onChange={(e) => setName(e.target.value)} placeholder="ex.: Starlink do sítio" maxLength={60} />
          </div>
          <Button type="submit" variant="primary" size="sm" loading={pair.isPending} disabled={!codeOk}>
            <Cloud /> Conectar
          </Button>
        </form>
      )}
      {(pair.error ?? unpair.error) && <Callout tone="crit" className="mt-3">{((pair.error ?? unpair.error) as ApiError).message}</Callout>}
      <p className="mt-3 text-[11px] leading-relaxed text-fg-subtle">
        O código vale 15 minutos e só pode ser usado uma vez. Depois de conectado, o agente envia consumo, qualidade e quedas para a sua conta; os dados continuam também aqui.
      </p>
    </Section>
  );
}
