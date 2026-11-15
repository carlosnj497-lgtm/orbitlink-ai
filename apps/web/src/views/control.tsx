"use client";

import type { Capability } from "@orbitlink/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Power, RefreshCw, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { CAP_META, PageHeader, QueryError } from "@/components/domain";
import { Badge, Button, Callout, Card, CardBody, CardHeader, Dialog, EmptyState, Input, Label, Skeleton } from "@/components/ui/primitives";
import { api, ApiError, useAgent } from "@/lib/api";
import { useDemo } from "@/lib/demo-context";
import { fmtDateTime } from "@/lib/format";

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
    const tick = () => setLeft(Math.max(0, prepared.expires_at - Math.floor(Date.now() / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [prepared]);
  async function cancel() {
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
            <Button variant="ghost" onClick={cancel}>Cancelar</Button>
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
          <p className="text-xs text-fg-subtle tabular">Esta confirmação expira em {left}s e só pode ser usada uma vez.</p>
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

  return (
    <>
      <PageHeader title="Controle da Starlink" icon={<SlidersHorizontal />} description="Informações do terminal, matriz de capacidades e ações suportadas — sempre com confirmação manual e auditoria." />
      <Callout tone="info" icon={<ShieldCheck />} className="mb-4">
        {actions.data?.policy ?? "Ações exigem administrador, confirmação com código de uso único e são auditadas."} A IA nunca executa ações.
      </Callout>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Ações" />
          <CardBody className="space-y-3">
            {actions.isLoading && <Skeleton className="h-24 w-full" />}
            {actions.error && <QueryError error={actions.error} />}
            {actions.data?.actions.map((a) => (
              <div key={a.action} className="rounded-lg border border-border bg-bg-elev/60 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{a.label}</p>
                  {a.capability ? <Badge tone={CAP_META[a.capability.status].tone}>{CAP_META[a.capability.status].label}</Badge> : <Badge>não verificada</Badge>}
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
        <Card className="lg:col-span-2">
          <CardHeader
            title="Matriz de capacidades"
            subtitle={caps.data?.checked_at ? `Verificada em ${fmtDateTime(caps.data.checked_at)}` : "Ainda não verificada"}
            actions={<Button size="sm" onClick={() => refresh.mutate()} loading={refresh.isPending} disabled={demo}><RefreshCw /> Verificar agora</Button>}
          />
          <CardBody>
            {caps.isLoading && <Skeleton className="h-40 w-full" />}
            {caps.data && !caps.data.capabilities.length && <EmptyState title="Nenhuma capacidade registrada">Aguardando a primeira conexão com a antena.</EmptyState>}
            {caps.data && caps.data.capabilities.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px] text-sm">
                  <thead className="text-left text-xs text-fg-subtle">
                    <tr className="border-b border-border">
                      <th className="py-2 pr-3 font-medium">Recurso</th>
                      <th className="py-2 pr-3 font-medium">Dispositivo</th>
                      <th className="py-2 pr-3 font-medium">Tipo</th>
                      <th className="py-2 pr-3 font-medium">Estado</th>
                      <th className="py-2 font-medium">Detalhe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {caps.data.capabilities.map((c) => (
                      <tr key={`${c.target}-${c.key}`} className="border-b border-border/60 align-top">
                        <td className="py-2 pr-3">{c.label}</td>
                        <td className="py-2 pr-3 text-fg-muted">{c.device === "dish" ? "antena" : "roteador"}</td>
                        <td className="py-2 pr-3 text-fg-muted">{c.kind}</td>
                        <td className="py-2 pr-3"><Badge tone={CAP_META[c.status]?.tone}>{CAP_META[c.status]?.label ?? c.status}</Badge></td>
                        <td className="py-2 text-xs text-fg-subtle">{c.detail ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
      <Card className="mt-4">
        <CardHeader title="Histórico e auditoria" />
        <CardBody>
          {reqs.data && !reqs.data.requests.length && <EmptyState title="Nenhuma ação solicitada" />}
          {reqs.data && reqs.data.requests.length > 0 && (
            <ul className="divide-y divide-border">
              {reqs.data.requests.map((r) => (
                <li key={r.operation_id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                  <span className="tabular text-fg-subtle">{fmtDateTime(r.created_at)}</span>
                  <span>{r.action}</span>
                  <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</Badge>
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
                  <li key={i} className="tabular">{fmtDateTime(a.ts)} · {a.actor} · {a.event}{a.detail ? ` — ${a.detail}` : ""}</li>
                ))}
              </ul>
            </details>
          )}
        </CardBody>
      </Card>
      <ConfirmDialog prepared={prepared} onClose={() => setPrepared(null)} />
    </>
  );
}
