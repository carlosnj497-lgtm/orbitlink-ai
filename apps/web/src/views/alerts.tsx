"use client";

import type { NotificationStatus } from "@orbitlink/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BellOff, BellRing, Check, Plus, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { PageHeader, QueryError } from "@/components/domain";
import { Badge, Button, Callout, Card, CardBody, CardHeader, Dialog, EmptyState, Input, Label, Select, Skeleton, Switch } from "@/components/ui/primitives";
import { api, ApiError, useAgent } from "@/lib/api";
import { useDemo } from "@/lib/demo-context";
import { fmtDateTime, fmtDuration } from "@/lib/format";
import { useNow } from "@/lib/use-now";

interface Rule {
  id: number;
  name: string;
  kind: string;
  operator: "gt" | "lt";
  threshold: number;
  min_duration_s: number;
  window_s: number;
  severity: "info" | "warn" | "crit";
  cooldown_s: number;
  hysteresis: number;
  enabled: boolean;
  silenced_until: number | null;
  last_event: { status: string; started_at: number; resolved_at: number | null; occurrences: number } | null;
}
interface AlertEvent {
  id: number;
  rule_name: string;
  status: "active" | "resolved";
  severity: string;
  started_at: number;
  resolved_at: number | null;
  message: string;
  occurrences: number;
  acknowledged_at: number | null;
}
type Kinds = Record<string, { label: string; unit: string; operator: string }>;

const SEV_TONE = { info: "info", warn: "warn", crit: "crit" } as const;

function NotificationsCard() {
  const demo = useDemo();
  const qc = useQueryClient();
  const st = useAgent<NotificationStatus>("alerts/notifications", { refetchInterval: 30_000 });
  const test = useMutation({
    mutationFn: () => api<{ results: Record<string, { ok: boolean; error?: string }> }>("alerts/notifications/test", { method: "POST" }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["agent", "alerts/notifications"] }),
  });
  const d = st.data;
  const any = d ? d.channels.telegram || d.channels.webhook : false;
  return (
    <Card className="mb-4">
      <CardHeader
        title="Notificações"
        icon={<Send />}
        subtitle="Alertas disparados e resolvidos saem por Telegram e/ou webhook. Sem internet, ficam na fila e são reenviados quando a conexão volta."
        actions={<Button size="sm" variant="secondary" disabled={demo || !any} loading={test.isPending} onClick={() => test.mutate()}><Send /> Enviar teste</Button>}
      />
      <CardBody className="space-y-3">
        {st.error && <QueryError error={st.error} />}
        {!d && !st.error && <Skeleton className="h-10 w-full" />}
        {d && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <span className="flex items-center gap-2">Telegram <Badge tone={d.channels.telegram ? "ok" : "neutral"}>{d.channels.telegram ? "configurado" : "ausente"}</Badge></span>
            <span className="flex items-center gap-2">Webhook <Badge tone={d.channels.webhook ? "ok" : "neutral"}>{d.channels.webhook ? "configurado" : "ausente"}</Badge></span>
            <span className="text-fg-muted tabular">Na fila: {d.pending}</span>
            {d.failed_24h > 0 && <Badge tone="warn">{d.failed_24h} descartada(s) em 24 h</Badge>}
            {d.last_sent_at && <span className="text-xs text-fg-subtle tabular">Último envio: {fmtDateTime(d.last_sent_at)}</span>}
          </div>
        )}
        {d?.last_error && <p className="text-xs text-fg-subtle">Último erro ({d.last_error.channel}): {d.last_error.last_error}</p>}
        {d && !any && (
          <Callout tone="info">
            Para receber no celular: crie um bot com o @BotFather no Telegram, envie uma mensagem a ele e defina ORBITLINK_TELEGRAM_BOT_TOKEN e ORBITLINK_TELEGRAM_CHAT_ID (o comando <code>orbitlinkctl telegram-chat-id</code> mostra o número). Depois reinicie o agente.
          </Callout>
        )}
        {test.data &&
          Object.entries(test.data.results).map(([ch, r]) => (
            <Callout key={ch} tone={r.ok ? "ok" : "crit"}>{r.ok ? `Teste enviado por ${ch}. Confira se chegou.` : `Falha no ${ch}: ${r.error}`}</Callout>
          ))}
        {test.error && <Callout tone="crit">{(test.error as ApiError).message}</Callout>}
      </CardBody>
    </Card>
  );
}
const EMPTY = { name: "", kind: "latency_high", threshold: 100, min_duration_s: 300, window_s: 300, severity: "warn", cooldown_s: 900, hysteresis: 0.1, enabled: true };

function RuleDialog({ open, onClose, kinds, initial }: { open: boolean; onClose: () => void; kinds: Kinds; initial: (Partial<Rule> & { id?: number }) | null }) {
  const qc = useQueryClient();
  const [f, setF] = useState<typeof EMPTY>({ ...EMPTY, ...(initial ?? {}) } as typeof EMPTY);
  const save = useMutation({
    mutationFn: () => api(initial?.id ? `alerts/rules/${initial.id}` : "alerts/rules", { method: initial?.id ? "PUT" : "POST", body: JSON.stringify(f) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent", "alerts/rules"] });
      onClose();
    },
  });
  const set = (k: keyof typeof EMPTY, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const unit = kinds[f.kind]?.unit ?? "";
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={initial?.id ? "Editar regra" : "Nova regra de alerta"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()} disabled={f.name.length < 3}>Salvar</Button></>}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2"><Label htmlFor="r-name">Nome</Label><Input id="r-name" value={f.name} onChange={(e) => set("name", e.target.value)} /></div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="r-kind">Condição</Label>
          <Select id="r-kind" className="w-full" value={f.kind} onChange={(e) => set("kind", e.target.value)}>
            {Object.entries(kinds).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
        </div>
        <div className="space-y-1"><Label htmlFor="r-thr">Limiar ({kinds[f.kind]?.operator === "lt" ? "abaixo de" : "acima de"}) {unit}</Label><Input id="r-thr" type="number" step="any" value={f.threshold} onChange={(e) => set("threshold", Number(e.target.value))} /></div>
        <div className="space-y-1"><Label htmlFor="r-sev">Severidade</Label><Select id="r-sev" className="w-full" value={f.severity} onChange={(e) => set("severity", e.target.value)}><option value="info">info</option><option value="warn">atenção</option><option value="crit">crítico</option></Select></div>
        <div className="space-y-1"><Label htmlFor="r-dur">Duração mínima (s)</Label><Input id="r-dur" type="number" min={0} value={f.min_duration_s} onChange={(e) => set("min_duration_s", Number(e.target.value))} /></div>
        <div className="space-y-1"><Label htmlFor="r-win">Janela de avaliação (s)</Label><Input id="r-win" type="number" min={60} value={f.window_s} onChange={(e) => set("window_s", Number(e.target.value))} /></div>
        <div className="space-y-1"><Label htmlFor="r-cd">Cooldown / agrupamento (s)</Label><Input id="r-cd" type="number" min={0} value={f.cooldown_s} onChange={(e) => set("cooldown_s", Number(e.target.value))} /></div>
        <div className="space-y-1"><Label htmlFor="r-hy">Histerese (0–0,9)</Label><Input id="r-hy" type="number" step="0.05" min={0} max={0.9} value={f.hysteresis} onChange={(e) => set("hysteresis", Number(e.target.value))} /></div>
      </div>
      {save.error && <Callout tone="crit" className="mt-3">{(save.error as ApiError).message}</Callout>}
    </Dialog>
  );
}

export default function AlertsView() {
  const demo = useDemo();
  const qc = useQueryClient();
  const rules = useAgent<{ rules: Rule[] }>("alerts/rules", { refetchInterval: 30_000 });
  const kinds = useAgent<{ kinds: Kinds }>("alerts/kinds");
  const events = useAgent<{ events: AlertEvent[] }>("alerts/events?status=all&limit=100", { refetchInterval: 30_000 });
  const [editing, setEditing] = useState<Partial<Rule> | null>(null);
  const inv = () => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[1]).startsWith("alerts") });
  const toggle = useMutation({ mutationFn: (r: Rule) => api(`alerts/rules/${r.id}`, { method: "PUT", body: JSON.stringify({ ...r, enabled: !r.enabled }) }), onSuccess: inv });
  const silence = useMutation({ mutationFn: ({ id, minutes }: { id: number; minutes: number }) => api(`alerts/rules/${id}/silence`, { method: "POST", body: JSON.stringify({ minutes }) }), onSuccess: inv });
  const del = useMutation({ mutationFn: (id: number) => api(`alerts/rules/${id}`, { method: "DELETE" }), onSuccess: inv });
  const ack = useMutation({ mutationFn: (id: number) => api(`alerts/events/${id}/ack`, { method: "POST" }), onSuccess: inv });
  const now = useNow(30_000) ?? 0;

  return (
    <>
      <PageHeader
        title="Alertas e Automações"
        icon={<BellRing />}
        description="Regras com duração mínima, histerese, cooldown e agrupamento para evitar spam. Notificações no aplicativo, no Telegram e por webhook."
        actions={<Button size="sm" variant="primary" disabled={demo} onClick={() => setEditing({})}><Plus /> Nova regra</Button>}
      />
      <NotificationsCard />
      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader title="Regras" />
          <CardBody>
            {rules.isLoading && <Skeleton className="h-40 w-full" />}
            {rules.error && <QueryError error={rules.error} />}
            {rules.data && !rules.data.rules.length && <EmptyState title="Nenhuma regra" />}
            <ul className="divide-y divide-border">
              {rules.data?.rules.map((r) => {
                const k = kinds.data?.kinds[r.kind];
                const silenced = r.silenced_until && r.silenced_until > now;
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                    <Switch label={`Ativar ${r.name}`} checked={r.enabled} onCheckedChange={() => toggle.mutate(r)} disabled={demo} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{r.name} <Badge tone={SEV_TONE[r.severity]} className="ml-1">{r.severity}</Badge>{silenced && <Badge className="ml-1">silenciada</Badge>}</p>
                      <p className="text-xs text-fg-subtle">
                        {k?.label ?? r.kind} {r.operator === "gt" ? ">" : "<"} {r.threshold} {k?.unit} · janela {fmtDuration(r.window_s)} · mínimo {fmtDuration(r.min_duration_s)} · cooldown {fmtDuration(r.cooldown_s)}
                        {r.last_event && ` · última: ${fmtDateTime(r.last_event.started_at)} (${r.last_event.status})`}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" disabled={demo} onClick={() => silence.mutate({ id: r.id, minutes: silenced ? 0 : 60 })}><BellOff /> {silenced ? "Reativar" : "1 h"}</Button>
                      <Button size="sm" variant="ghost" disabled={demo} onClick={() => setEditing(r)}>Editar</Button>
                      <Button size="icon" variant="ghost" aria-label={`Excluir ${r.name}`} disabled={demo} onClick={() => confirm(`Excluir a regra "${r.name}"?`) && del.mutate(r.id)}><Trash2 /></Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Ocorrências" />
          <CardBody>
            {events.data && !events.data.events.length && <EmptyState title="Nenhum alerta disparado" />}
            <ul className="divide-y divide-border">
              {events.data?.events.map((e) => (
                <li key={e.id} className="py-2.5">
                  <div className="flex items-center gap-2">
                    <Badge tone={e.status === "active" ? SEV_TONE[e.severity as keyof typeof SEV_TONE] ?? "warn" : "neutral"}>{e.status === "active" ? "ativo" : "resolvido"}</Badge>
                    <span className="text-sm">{e.rule_name}</span>
                    {e.occurrences > 1 && <Badge>×{e.occurrences}</Badge>}
                    {e.status === "active" && !e.acknowledged_at && (
                      <Button size="sm" variant="ghost" className="ml-auto h-7" disabled={demo} onClick={() => ack.mutate(e.id)}><Check /> Reconhecer</Button>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-fg-muted">{e.message}</p>
                  <p className="text-[11px] text-fg-subtle tabular">{fmtDateTime(e.started_at)}{e.resolved_at ? ` → ${fmtDateTime(e.resolved_at)}` : ""}</p>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
      {editing && kinds.data && <RuleDialog open onClose={() => setEditing(null)} kinds={kinds.data.kinds} initial={editing} />}
    </>
  );
}
