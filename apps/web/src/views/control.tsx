"use client";

import type { Capability, CapStatus } from "@astryon/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { History, Power, RefreshCw, ShieldCheck, SlidersHorizontal, TableProperties } from "lucide-react";
import { useEffect, useState } from "react";
import { CAP_META, PageHeader, QueryError } from "@/components/domain";
import { Badge, Button, Callout, Card, CardBody, CardHeader, Dialog, EmptyState, Input, Label, Skeleton } from "@/components/ui/primitives";
import { api, ApiError, serverNow, useAgent } from "@/lib/api";
import { useDemo } from "@/lib/demo-context";
import { cn } from "@/lib/cn";
import { fmtDateTime } from "@/lib/format";
import { SectionHead } from "./antenna-parts/section";
import { type PartState, StateLight, SystemDiagram } from "./antenna-parts/system-diagram";

interface ActionInfo {
  action: string;
  label: string;
  consequences: string[];
  capability: Capability | null;
  enabled: boolean;
  reason: string | null;
}
interface Prepared {
  operation_id: string;
  nonce: string;
  expires_at: number;
  label: string;
  target: string;
  confirm_text: string;
  consequences: string[];
}
interface RequestsResponse {
  requests: { operation_id: string; action: string; status: string; created_at: number; result_detail: string | null; requested_by: string; origin: string }[];
  audit: { operation_id: string | null; ts: number; actor: string; event: string; detail: string | null }[];
}

/** Palavras do histórico em português; o código original do agente fica no título (dica ao passar o mouse). */
const STATUS_WORD: Record<string, string> = {
  accepted: "aceita", failed: "falhou", timeout: "sem resposta", expired: "expirou", cancelled: "cancelada", pending: "aguardando", executing: "executando",
};
const toneState = (t: string | undefined): PartState => (t === "ok" ? "ok" : t === "warn" ? "warn" : t === "crit" ? "crit" : t === "info" ? "info" : "off");
/** Rótulos desta tela: "No schema" lê como falta; aqui diz o que é (o recurso consta no firmware, ainda não testado). */
const CAP_LABEL: Partial<Record<CapStatus, string>> = { schema_presente: "Consta no firmware" };
const capLabel = (st: CapStatus) => CAP_LABEL[st] ?? CAP_META[st]?.label ?? st;

const STATUS_TONE: Record<string, "ok" | "warn" | "crit" | "neutral" | "info"> = {
  accepted: "ok", failed: "crit", timeout: "warn", expired: "neutral", cancelled: "neutral", pending: "info", executing: "info",
};

function ConfirmDialog({ prepared, onClose }: { prepared: Prepared | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [left, setLeft] = useState(0);
  const confirm = useMutation({
    mutationFn: () => api<{ status: string; detail: string }>("control/confirm", { method: "POST", body: JSON.stringify({ operation_id: prepared!.operation_id, nonce: prepared!.nonce, confirm_text: text }) }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["agent", "control/requests"] }),
  });
  useEffect(() => {
    if (!prepared) return;
    // Relógio do servidor (ajustado pelo cabeçalho Date): o do aparelho pode estar adiantado ou atrasado.
    const tick = () => setLeft(Math.max(0, prepared.expires_at - Math.floor(serverNow())));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [prepared]);
  // Com o comando já enviado, "cancelar" não teria efeito no agente (já está executando) e esconderia o
  // resultado: a janela fica aberta até a resposta chegar.
  const running = confirm.isPending;
  async function cancel() {
    if (running) return;
    if (prepared && !confirm.data) await api(`control/cancel/${prepared.operation_id}`, { method: "POST" }).catch(() => undefined);
    setText("");
    confirm.reset();
    onClose();
  }
  const result = confirm.data;
  return (
    <Dialog
      open={!!prepared}
      onOpenChange={(o) => !o && cancel()}
      title={prepared ? `Confirmar: ${prepared.label}` : ""}
      description={prepared ? `Alvo: ${prepared.target} · operação ${prepared.operation_id.slice(0, 8)}…` : undefined}
      footer={
        result ? (
          <Button onClick={cancel}>Fechar</Button>
        ) : (
          <>
            {!running && <Button variant="ghost" onClick={cancel}>Cancelar</Button>}
            <Button variant="danger" loading={confirm.isPending} disabled={!prepared || text.trim().toUpperCase() !== prepared.confirm_text || left === 0} onClick={() => confirm.mutate()}>
              <Power /> Executar agora
            </Button>
          </>
        )
      }
    >
      {prepared && !result && (
        <div className="space-y-3">
          <ul className="list-disc space-y-1 pl-5 text-sm text-fg-muted">
            {prepared.consequences.map((c) => <li key={c}>{c}</li>)}
          </ul>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-text">Digite <span className="font-mono text-fg">{prepared.confirm_text}</span> para confirmar</Label>
            <Input id="confirm-text" autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <p className="text-xs text-fg-subtle tabular">
            {running ? "Comando enviado à antena. Aguarde a resposta; não é mais possível cancelar." : `Esta confirmação expira em ${left}s e só pode ser usada uma vez.`}
          </p>
          {confirm.error && <Callout tone="crit">{(confirm.error as ApiError).message}</Callout>}
        </div>
      )}
      {result && (
        <Callout tone={result.status === "accepted" ? "ok" : result.status === "timeout" ? "warn" : "crit"} title={`Resultado: ${result.status}`}>
          {result.detail}
        </Callout>
      )}
    </Dialog>
  );
}

export default function ControlView() {
  const demo = useDemo();
  const qc = useQueryClient();
  const actions = useAgent<{ actions: ActionInfo[]; policy: string }>("control/actions", { refetchInterval: 30_000 });
  const caps = useAgent<{ checked_at: number | null; capabilities: Capability[] }>("capabilities", { refetchInterval: 60_000 });
  const reqs = useAgent<RequestsResponse>("control/requests", { refetchInterval: 15_000 });
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const prepare = useMutation({
    mutationFn: (action: string) => api<Prepared>("control/prepare", { method: "POST", body: JSON.stringify({ action }) }),
    onSuccess: setPrepared,
  });
  const refresh = useMutation({
    mutationFn: () => api("capabilities/refresh", { method: "POST" }),
    onSuccess: () => setTimeout(() => qc.invalidateQueries({ queryKey: ["agent", "capabilities"] }), 4000),
  });
  const list = caps.data?.capabilities ?? [];
  const groups = (["dish", "router"] as const).map((device) => ({ device, title: device === "dish" ? "Antena" : "Roteador", items: list.filter((c) => c.device === device) })).filter((g) => g.items.length);
  const verified = list.filter((c) => c.status === "verificada").length;

  return (
    <>
      <PageHeader title="Controle da Starlink" icon={<SlidersHorizontal />} description="Informações do terminal, matriz de capacidades e ações suportadas — sempre com confirmação manual e auditoria." />

      <SystemDiagram current="controle" />

      {/* ---------------------------------------------------------- Agora: ações e capacidades */}
      <section aria-labelledby="agora-t" className="mb-8 space-y-3">
        <SectionHead id="agora-t" title="Agora">
          O que este firmware permite ler e comandar
        </SectionHead>
        <Callout tone="info" icon={<ShieldCheck />}>
          {actions.data?.policy ?? "Ações exigem administrador, confirmação com código de uso único e são auditadas."} A IA nunca executa ações.
        </Callout>
        <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)]">
          <Card>
            <CardHeader title="Ações" icon={<Power />} subtitle="Cada uma pede confirmação digitada e expira" />
            <CardBody className="space-y-3">
              {actions.isLoading && <Skeleton className="h-24 w-full" />}
              {actions.error && <QueryError error={actions.error} />}
              {actions.data && !actions.data.actions.length && <p className="text-sm text-fg-muted">Nenhuma ação oferecida por este firmware.</p>}
              {actions.data?.actions.map((a) => (
                <div key={a.action} className="rounded-md border border-border bg-bg-elev p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-fg">{a.label}</p>
                    {a.capability ? <Badge tone={CAP_META[a.capability.status].tone}>{capLabel(a.capability.status)}</Badge> : <Badge>não verificada</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-fg-subtle">{a.enabled ? "Disponível no schema do firmware. A autorização só é conhecida ao executar." : a.reason}</p>
                  <Button className="mt-3" size="sm" variant="danger" disabled={!a.enabled || demo} loading={prepare.isPending} onClick={() => prepare.mutate(a.action)}>
                    <Power /> {a.label}…
                  </Button>
                </div>
              ))}
              {prepare.error && <Callout tone="crit">{(prepare.error as ApiError).message}</Callout>}
              {refresh.error && <Callout tone="crit">{(refresh.error as ApiError).message}</Callout>}
              <p className="text-xs text-fg-subtle">Factory reset e APIs privadas não são oferecidos.</p>
            </CardBody>
          </Card>

          <Card className="min-w-0">
            <CardHeader
              title="Matriz de capacidades"
              icon={<TableProperties />}
              subtitle={caps.data?.checked_at ? <>Verificada em <span className="tabular">{fmtDateTime(caps.data.checked_at)}</span>{list.length > 0 && <> · <span className="tabular">{verified}</span> de <span className="tabular">{list.length}</span> verificadas</>}</> : "Ainda não verificada"}
              actions={
                <Button size="sm" onClick={() => refresh.mutate()} loading={refresh.isPending} disabled={demo}>
                  <RefreshCw /> Verificar agora
                </Button>
              }
            />
            <CardBody>
              {caps.isLoading && <Skeleton className="h-40 w-full" />}
              {caps.error && <QueryError error={caps.error} />}
              {caps.data && !list.length && <EmptyState title="Nenhuma capacidade registrada">Aguardando a primeira conexão com a antena.</EmptyState>}
              {groups.map((g) => (
                <div key={g.device} className="mb-3 last:mb-0">
                  <h4 className="ol-label mb-1">{g.title}</h4>
                  <ul className="divide-y divide-border/60">
                    {g.items.map((c) => (
                      <li key={`${c.target}-${c.key}`} className="grid gap-x-4 gap-y-0.5 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto]">
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2 text-sm text-fg">
                            {c.label}
                            <span className={cn("text-[11px]", c.kind === "controle" ? "text-fg-muted" : "text-fg-subtle")}>{c.kind}</span>
                          </p>
                          {c.detail && <p className="mt-0.5 break-words text-xs text-fg-subtle">{c.detail}</p>}
                        </div>
                        <StateLight state={toneState(CAP_META[c.status]?.tone)} label={capLabel(c.status)} className="sm:justify-self-end" />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      </section>

      {/* ---------------------------------------------------------- Histórico */}
      <section aria-labelledby="historico-t">
        <SectionHead id="historico-t" title="Histórico e auditoria">
          Toda ação pedida fica registrada, com quem pediu e por onde
        </SectionHead>
        <Card>
          <CardBody className="pt-4">
            {reqs.isLoading && <Skeleton className="h-16 w-full" />}
            {reqs.error && <QueryError error={reqs.error} />}
            {reqs.data && !reqs.data.requests.length && <EmptyState icon={<History />} title="Nenhuma ação solicitada" className="py-6" />}
            {reqs.data && reqs.data.requests.length > 0 && (
              <ul className="divide-y divide-border/60">
                {reqs.data.requests.map((r) => (
                  <li key={r.operation_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
                    <span className="tabular text-xs text-fg-subtle">{fmtDateTime(r.created_at)}</span>
                    <span className="text-fg">{r.action}</span>
                    <span title={r.status}>
                      <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{STATUS_WORD[r.status] ?? r.status}</Badge>
                    </span>
                    <span className="text-xs text-fg-subtle">por {r.requested_by} via {r.origin}</span>
                    {r.result_detail && <span className="w-full text-xs text-fg-muted">{r.result_detail}</span>}
                  </li>
                ))}
              </ul>
            )}
            {reqs.data && reqs.data.audit.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-accent">Registro de auditoria ({reqs.data.audit.length})</summary>
                <ul className="mt-2 space-y-1 text-xs text-fg-muted">
                  {reqs.data.audit.map((a, i) => (
                    <li key={i} className="tabular">
                      {fmtDateTime(a.ts)} · {a.actor} · {a.event}
                      {a.detail ? ` — ${a.detail}` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </CardBody>
        </Card>
      </section>
      <ConfirmDialog prepared={prepared} onClose={() => setPrepared(null)} />
    </>
  );
}
