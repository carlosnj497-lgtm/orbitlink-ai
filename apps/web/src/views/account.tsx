"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, KeyRound, Laptop, Link2, Server, ShieldAlert, Trash2, UserRound } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PageHeader, QueryError } from "@/components/domain";
import { Badge, Button, Callout, Card, CardBody, CardHeader, EmptyState, Input, Label, Skeleton } from "@/components/ui/primitives";
import { api, type ApiError, downloadFrom, serverNow, useAgent } from "@/lib/api";
import { useDemo } from "@/lib/demo-context";
import { fmtAgo } from "@/lib/format";
import { reloadTo } from "@/lib/navigation";
import { useNow } from "@/lib/use-now";

const DEMO_NOTE = "Indisponível na demonstração: nada aqui mexe em uma conta de verdade.";

interface Account {
  workspace_id: string | null;
  workspace_name: string | null;
  agents: { id: string; name: string; created_at: string; last_seen: string | null; revoked: boolean }[];
}

const toEpoch = (iso: string | null) => (iso ? Math.floor(new Date(iso).getTime() / 1000) : null);

function PairingCard() {
  const demo = useDemo();
  const [name, setName] = useState("");
  const tick = useNow(1000);
  const gen = useMutation({ mutationFn: () => api<{ code: string; expires_at: string }>("cloud/pairing-code", { method: "POST", body: JSON.stringify({ name }) }) });
  // Prazo comparado com o relógio do servidor (ajustado pelo cabeçalho Date), não com o do aparelho.
  const left = gen.data && tick !== null ? Math.max(0, toEpoch(gen.data.expires_at)! - Math.floor(serverNow())) : null;
  return (
    <Card>
      <CardHeader title="Conectar a antena" icon={<Link2 />} subtitle="Gere um código e digite no computador (ou aparelho) ligado à Starlink" />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1 space-y-1">
            <Label htmlFor="an">Nome (opcional)</Label>
            <Input id="an" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="ex.: Starlink do sítio" />
          </div>
          <Button variant="primary" size="sm" onClick={() => gen.mutate()} loading={gen.isPending} disabled={demo}>
            <KeyRound /> Gerar código
          </Button>
        </div>
        {demo && <Callout tone="demo">{DEMO_NOTE}</Callout>}
        {gen.error && <Callout tone="crit">{(gen.error as ApiError).message}</Callout>}
        {gen.data && (
          <div className="rounded-md border border-accent-2/50 bg-accent-soft px-4 py-4 text-center">
            <p className="ol-label">Seu código</p>
            <p className="mt-1 select-all font-mono text-3xl font-semibold tracking-[0.25em] text-fg">{gen.data.code}</p>
            <p className="mt-1 text-xs text-fg-muted">
              {left === null ? "" : left > 0 ? `Vale por mais ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} e só pode ser usado uma vez.` : "Expirou. Gere outro."}
            </p>
          </div>
        )}
        <ol className="grid grid-cols-1 gap-2 text-sm md:grid-cols-3">
          <li className="rounded-md border border-border bg-bg-elev/60 px-3 py-3">
            <p className="flex items-center gap-2 font-medium text-fg"><Laptop className="size-4 text-accent" aria-hidden /> Windows</p>
            <p className="mt-1 text-xs text-fg-muted">Instale o ASTRYON, clique no ícone ao lado do relógio → <b>Conectar à conta</b> e digite o código.</p>
          </li>
          <li className="rounded-md border border-border bg-bg-elev/60 px-3 py-3">
            <p className="flex items-center gap-2 font-medium text-fg"><Server className="size-4 text-accent" aria-hidden /> Aparelho ASTRYON</p>
            <p className="mt-1 text-xs text-fg-muted">Ligue no Wi-Fi da Starlink, abra <span className="font-mono">astryon.local</span> no celular e digite o código.</p>
          </li>
          <li className="rounded-md border border-border bg-bg-elev/60 px-3 py-3">
            <p className="flex items-center gap-2 font-medium text-fg"><Server className="size-4 text-accent" aria-hidden /> Servidor Linux</p>
            <p className="mt-1 text-xs text-fg-muted">
              No painel local: Configurações → Conta na nuvem. Ou no terminal: <span className="font-mono">astryon-agent pair CÓDIGO</span>.
            </p>
          </li>
        </ol>
      </CardBody>
    </Card>
  );
}

function AgentsCard({ a }: { a: Account }) {
  const demo = useDemo();
  const qc = useQueryClient();
  const revoke = useMutation({
    mutationFn: (id: string) => api(`cloud/agents/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[1] === "cloud/account" }),
  });
  const active = a.agents.filter((x) => !x.revoked);
  return (
    <Card>
      <CardHeader title="Agentes conectados" icon={<Server />} subtitle="Cada computador ou aparelho que envia dados da antena para esta conta" />
      <CardBody>
        {!active.length ? (
          <EmptyState icon={<Server />} title="Nenhum agente conectado">Gere um código acima para conectar a sua Starlink.</EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {active.map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm text-fg">{x.name}</p>
                  <p className="text-[11px] text-fg-subtle">{x.last_seen ? `Último envio ${fmtAgo(toEpoch(x.last_seen))}` : "Ainda não enviou dados"}</p>
                </div>
                <Button size="sm" variant="ghost" loading={revoke.isPending && revoke.variables === x.id} disabled={demo} onClick={() => revoke.mutate(x.id)}>
                  Remover acesso
                </Button>
              </li>
            ))}
          </ul>
        )}
        {revoke.error && <Callout tone="crit" className="mt-3">{(revoke.error as ApiError).message}</Callout>}
      </CardBody>
    </Card>
  );
}

function DataCard() {
  const demo = useDemo();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const del = useMutation({
    mutationFn: () => api("cloud/delete-account", { method: "POST", body: JSON.stringify({ confirm }) }),
    onSuccess: () => reloadTo("/login?conta=excluida"),
  });
  async function exportData() {
    setBusy(true);
    setExportError(null);
    try {
      await downloadFrom("/api/agent/cloud/export", "astryon-meus-dados.json");
    } catch (e) {
      setExportError((e as ApiError).message || "Não foi possível baixar os seus dados.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader title="Seus dados" icon={<ShieldAlert />} subtitle="Você controla o que fica guardado" />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-fg-muted">Baixe uma cópia de tudo o que a sua conta guarda (agentes, terminais, eventos e consumo diário).</p>
          <Button size="sm" onClick={exportData} loading={busy} disabled={demo}>
            <Download /> Baixar meus dados
          </Button>
        </div>
        {exportError && <Callout tone="crit">{exportError}</Callout>}
        <div className="rounded-md border border-crit/40 bg-crit-soft px-3 py-3">
          <p className="text-sm font-medium text-fg">Excluir conta</p>
          <p className="mt-1 text-xs text-fg-muted">Apaga a conta, os agentes e todos os dados na nuvem. Não dá para desfazer. Os dados guardados no computador ligado à antena não são apagados.</p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="del">Digite EXCLUIR para confirmar</Label>
              <Input id="del" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" disabled={demo} />
            </div>
            <Button size="sm" variant="ghost" className="border-crit/50 text-crit" disabled={demo || confirm !== "EXCLUIR"} loading={del.isPending} onClick={() => del.mutate()}>
              <Trash2 /> Excluir minha conta
            </Button>
          </div>
          {demo && <p className="mt-2 text-xs text-fg-subtle">{DEMO_NOTE}</p>}
          {del.error && <Callout tone="crit" className="mt-2">{(del.error as ApiError).message}</Callout>}
        </div>
        <p className="text-[11px] text-fg-subtle">
          <Link href="/termos" className="text-accent hover:underline">Termos de uso</Link> · <Link href="/privacidade" className="text-accent hover:underline">Política de privacidade</Link>
        </p>
      </CardBody>
    </Card>
  );
}

export default function AccountView() {
  const q = useAgent<Account>("cloud/account", { refetchInterval: 60_000 });
  return (
    <>
      <PageHeader title="Conta" icon={<UserRound />} description="Conecte a sua Starlink, veja os agentes ligados à conta e cuide dos seus dados." actions={q.data?.workspace_name ? <Badge tone="accent">{q.data.workspace_name}</Badge> : undefined} />
      {q.error && <QueryError error={q.error} onRetry={() => q.refetch()} />}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="xl:col-span-2">
          <PairingCard />
        </div>
        {q.data ? <AgentsCard a={q.data} /> : <Skeleton className="h-48 w-full" />}
        <DataCard />
      </div>
    </>
  );
}
