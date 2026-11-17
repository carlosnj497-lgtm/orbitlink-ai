"use client";

import type { DigestStatus, NotificationStatus } from "@astryon/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BellRing, CalendarClock, Check, History, Plus, Send } from "lucide-react";
import { useState } from "react";
import { PageHeader, QueryError } from "@/components/domain";
import { Badge, Button, Callout, Card, CardBody, CardHeader, EmptyState, Label, Select, Skeleton, Switch } from "@/components/ui/primitives";
import { api, type ApiError, useAgent } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useDemo } from "@/lib/demo-context";
import { fmtAgo, fmtDateTime, fmtDuration } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { type AlertEvent, type Kinds, type Rule, SEVERITY } from "./alerts-parts/phrases";
import { RuleEditor } from "./alerts-parts/rule-editor";
import { RuleRow } from "./alerts-parts/rule-row";

const WEEKDAYS = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"];
const sevTone = (s: string) => SEVERITY[s as Rule["severity"]]?.tone ?? "warn";

/* ----------------------------------------------------------------- Ativos agora */
function ActiveNow({ events, now, onAck, demo }: { events: AlertEvent[] | undefined; now: number; onAck: (id: number) => void; demo: boolean }) {
  if (!events) return <Skeleton className="mb-6 h-20 w-full" />;
  const active = events.filter((e) => e.status === "active");
  const last = events.find((e) => e.status === "resolved");
  if (!active.length) {
    return (
      <div className="ol-card mb-6 flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
        <p className="flex items-center gap-2.5 text-sm text-fg">
          <span className="size-2 rounded-full bg-ok" aria-hidden />
          Nenhum alerta ativo agora.
        </p>
        <p className="text-xs text-fg-subtle">{last ? `Última ocorrência: ${last.rule_name}, ${fmtAgo(last.started_at)}` : "Nenhuma ocorrência registrada ainda."}</p>
      </div>
    );
  }
  return (
    <section aria-labelledby="ativos-t" className="ol-card ol-glow ol-hud mb-6 px-4 py-4">
      <h2 id="ativos-t" className="font-display text-[17px] font-semibold text-fg">
        {active.length === 1 ? "1 alerta ativo agora" : `${active.length} alertas ativos agora`}
      </h2>
      <ul className="mt-3 space-y-2">
        {active.map((e) => {
          const tone = sevTone(e.severity);
          return (
            <li key={e.id} className={cn("flex flex-col gap-2 rounded-md border px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3", tone === "crit" ? "border-crit/40 bg-crit-soft" : tone === "warn" ? "border-warn/40 bg-warn-soft" : "border-border-strong bg-surface-2")}>
              <div className="flex min-w-0 flex-1 items-start gap-3">
              <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", tone === "crit" ? "bg-crit" : tone === "warn" ? "bg-warn" : "bg-fg-muted")} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg">
                  {e.rule_name}
                  {e.occurrences > 1 && <span className="ml-2 text-xs font-normal text-fg-muted"><span className="tabular">{e.occurrences}</span> ocorrências</span>}
                </p>
                <p className="text-xs text-fg-muted">{e.message}</p>
              </div>
              </div>
              <div className="flex items-center justify-between gap-3 pl-5.5 sm:justify-end sm:pl-0">
              {now > 0 && <span className="text-xs text-fg-muted">{fmtAgo(e.started_at, now)}</span>}
              {e.acknowledged_at ? (
                <Badge>reconhecido</Badge>
              ) : (
                <Button size="sm" variant="secondary" disabled={demo} onClick={() => onAck(e.id)}>
                  <Check /> Reconhecer
                </Button>
              )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ----------------------------------------------------------------- Canais de aviso */
function ChannelLine({ name, on }: { name: string; on: boolean }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <span className="flex items-center gap-2 text-sm text-fg">
        <span className={cn("size-2 rounded-full", on ? "bg-ok" : "border border-fg-subtle")} aria-hidden />
        {name}
      </span>
      <span className="text-xs text-fg-muted">{on ? "ativo" : "não configurado"}</span>
    </li>
  );
}

function ChannelsCard() {
  const demo = useDemo();
  const qc = useQueryClient();
  const st = useAgent<NotificationStatus>("alerts/notifications", { refetchInterval: 30_000 });
  const test = useMutation<{ results: Record<string, { ok: boolean; error?: string }> }, ApiError>({
    mutationFn: () => api("alerts/notifications/test", { method: "POST" }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["agent", "alerts/notifications"] }),
  });
  const d = st.data;
  const any = d ? d.channels.telegram || d.channels.webhook : false;
  return (
    <Card>
      <CardHeader title="Canais de aviso" icon={<Send />} actions={<Button size="sm" variant="secondary" disabled={demo || !any} loading={test.isPending} onClick={() => test.mutate()}>Enviar teste</Button>} />
      <CardBody className="space-y-3">
        {st.error && <QueryError error={st.error} />}
        {!d && !st.error && <Skeleton className="h-16 w-full" />}
        {d && (
          <>
            <ul className="divide-y divide-border/60">
              <ChannelLine name="Telegram" on={d.channels.telegram} />
              <ChannelLine name="Webhook" on={d.channels.webhook} />
            </ul>
            <p className="text-xs text-fg-subtle">
              <span className="tabular">{d.pending}</span> na fila · {d.last_sent_at ? `último envio ${fmtAgo(d.last_sent_at)}` : "nada enviado ainda"}
              {d.failed_24h > 0 && (
                <span className="text-warn">
                  {" "}
                  · <span className="tabular">{d.failed_24h}</span> descartado(s) em 24 h
                </span>
              )}
            </p>
            {d.last_error && <p className="text-xs text-warn">Último erro ({d.last_error.channel}): {d.last_error.last_error}</p>}
            {d.telegram_chat?.enabled && (
              <p className="text-xs text-fg-muted">
                Perguntas pelo Telegram: {d.telegram_chat.last_error ? <span className="text-warn">com erro</span> : "ativas"} · <span className="tabular">{d.telegram_chat.answered ?? 0}</span> respondidas
              </p>
            )}
          </>
        )}
        {d && !any && (
          <details className="rounded-md border border-border px-3 py-2 text-xs text-fg-muted">
            <summary className="cursor-pointer text-fg">Como receber no celular</summary>
            <p className="mt-2 leading-relaxed">
              Crie um bot com o @BotFather no Telegram, mande uma mensagem a ele e defina ASTRYON_TELEGRAM_BOT_TOKEN e ASTRYON_TELEGRAM_CHAT_ID (o comando <code className="font-mono">astryonctl telegram-chat-id</code> mostra o número). Depois reinicie o agente. Sem internet, os avisos ficam na fila e saem quando a conexão volta.
            </p>
          </details>
        )}
        {test.data &&
          Object.entries(test.data.results).map(([ch, r]) => (
            <Callout key={ch} tone={r.ok ? "ok" : "crit"}>
              {r.ok ? `Teste enviado por ${ch}. Confira se chegou.` : `Falha no ${ch}: ${r.error}`}
            </Callout>
          ))}
        {test.error && <Callout tone="crit">{test.error.message}</Callout>}
      </CardBody>
    </Card>
  );
}

/* ----------------------------------------------------------------- Resumo semanal */
function DigestCard() {
  const demo = useDemo();
  const qc = useQueryClient();
  const st = useAgent<DigestStatus>("alerts/digest", { refetchInterval: 60_000 });
  const save = useMutation<unknown, ApiError, Partial<{ weekly_digest_enabled: boolean; weekly_digest_weekday: number; weekly_digest_hour: number }>>({
    mutationFn: (body) => api("settings", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent", "alerts/digest"] }),
  });
  const send = useMutation<{ ok: boolean; error?: string }, ApiError>({ mutationFn: () => api("alerts/digest/send", { method: "POST" }) });
  const d = st.data;
  const off = demo || !d?.telegram || save.isPending;
  return (
    <Card>
      <CardHeader title="Resumo semanal" icon={<CalendarClock />} actions={<Button size="sm" variant="secondary" disabled={off} loading={send.isPending} onClick={() => send.mutate()}>Enviar agora</Button>} />
      <CardBody className="space-y-3">
        {st.error && <QueryError error={st.error} />}
        {!d && !st.error && <Skeleton className="h-16 w-full" />}
        {d && (
          <>
            <label className="flex items-center gap-3 text-sm text-fg">
              <Switch label="Enviar o resumo toda semana" checked={d.enabled} disabled={off} onCheckedChange={(v) => save.mutate({ weekly_digest_enabled: v })} />
              Enviar toda semana
            </label>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="digest-weekday">Dia</Label>
                <Select id="digest-weekday" className="block" value={d.weekday} disabled={off || !d.enabled} onChange={(e) => save.mutate({ weekly_digest_weekday: Number(e.target.value) })}>
                  {WEEKDAYS.map((w, i) => (
                    <option key={w} value={i}>
                      {w}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="digest-hour">Hora</Label>
                <Select id="digest-hour" className="block" value={d.hour} disabled={off || !d.enabled} onChange={(e) => save.mutate({ weekly_digest_hour: Number(e.target.value) })}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, "0")}h
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <p className="text-xs text-fg-subtle">
              {!d.telegram ? "Sai só pelo Telegram: configure o bot em Canais de aviso." : d.next_at ? <>Próximo envio: <span className="tabular">{fmtDateTime(d.next_at)}</span>. No bot, /resumo mostra os últimos 7 dias.</> : "Consumo, disponibilidade, quedas e franquia da semana."}
            </p>
          </>
        )}
        {save.error && <Callout tone="crit">{save.error.message}</Callout>}
        {send.data && <Callout tone={send.data.ok ? "ok" : "crit"}>{send.data.ok ? "Resumo enviado. Confira no Telegram." : `Falha no envio: ${send.data.error}`}</Callout>}
        {send.error && <Callout tone="crit">{send.error.message}</Callout>}
      </CardBody>
    </Card>
  );
}

/* ----------------------------------------------------------------- Histórico */
function HistoryCard({ events }: { events: AlertEvent[] | undefined }) {
  const [all, setAll] = useState(false);
  const resolved = (events ?? []).filter((e) => e.status === "resolved");
  const shown = all ? resolved : resolved.slice(0, 6);
  return (
    <Card>
      <CardHeader title="Histórico" icon={<History />} />
      <CardBody>
        {!events && <Skeleton className="h-16 w-full" />}
        {events && !resolved.length && <p className="text-sm text-fg-muted">Nenhuma ocorrência resolvida ainda.</p>}
        <ul className="divide-y divide-border/60">
          {shown.map((e) => (
            <li key={e.id} className="py-2">
              <p className="flex items-center gap-2 text-sm text-fg">
                <span className={cn("size-1.5 shrink-0 rounded-full", sevTone(e.severity) === "crit" ? "bg-crit" : sevTone(e.severity) === "warn" ? "bg-warn" : "bg-fg-subtle")} aria-hidden />
                <span className="truncate">{e.rule_name}</span>
                {e.occurrences > 1 && <span className="tabular text-xs text-fg-subtle">×{e.occurrences}</span>}
              </p>
              <p className="pl-3.5 text-[11px] text-fg-subtle">
                <span className="tabular">{fmtDateTime(e.started_at)}</span>
                {e.resolved_at ? (
                  <>
                    {" "}
                    · durou <span className="tabular">{fmtDuration(e.resolved_at - e.started_at)}</span>
                  </>
                ) : null}
              </p>
            </li>
          ))}
        </ul>
        {resolved.length > 6 && (
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => setAll((v) => !v)}>
            {all ? "Mostrar menos" : `Ver todas (${resolved.length})`}
          </Button>
        )}
      </CardBody>
    </Card>
  );
}

/* ----------------------------------------------------------------- Tela */
export default function AlertsView() {
  const demo = useDemo();
  const qc = useQueryClient();
  const rules = useAgent<{ rules: Rule[] }>("alerts/rules", { refetchInterval: 30_000 });
  const kinds = useAgent<{ kinds: Kinds }>("alerts/kinds");
  const events = useAgent<{ events: AlertEvent[] }>("alerts/events?status=all&limit=100", { refetchInterval: 30_000 });
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const inv = () => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[1]).startsWith("alerts") });
  const toggle = useMutation<unknown, ApiError, Rule>({ mutationFn: (r) => api(`alerts/rules/${r.id}`, { method: "PUT", body: JSON.stringify({ ...r, enabled: !r.enabled }) }), onSuccess: inv });
  const silence = useMutation<unknown, ApiError, { id: number; minutes: number }>({ mutationFn: ({ id, minutes }) => api(`alerts/rules/${id}/silence`, { method: "POST", body: JSON.stringify({ minutes }) }), onSuccess: inv });
  const del = useMutation<unknown, ApiError, number>({ mutationFn: (id) => api(`alerts/rules/${id}`, { method: "DELETE" }), onSuccess: inv });
  const ack = useMutation<unknown, ApiError, number>({ mutationFn: (id) => api(`alerts/events/${id}/ack`, { method: "POST" }), onSuccess: inv });
  const now = useNow(15_000) ?? 0; // 0 até o relógio do cliente existir (sem Date.now no render)
  const actionError = toggle.error ?? silence.error ?? del.error ?? ack.error;
  const list = rules.data?.rules ?? [];
  const on = list.filter((r) => r.enabled).length;

  return (
    <>
      <PageHeader
        title="Alertas e Automações"
        icon={<BellRing />}
        description="Cada regra mostra o valor de agora perto do limite dela. Quando passa do limite pelo tempo definido, o aviso sai no painel, no Telegram e no webhook."
        actions={
          <Button size="sm" variant="primary" disabled={demo || !kinds.data || editing === "new"} onClick={() => setEditing("new")}>
            <Plus /> Nova regra
          </Button>
        }
      />
      {actionError && (
        <Callout tone="crit" className="mb-4" title="A ação não foi concluída">
          {actionError.message}
        </Callout>
      )}

      <ActiveNow events={events.data?.events} now={now} onAck={(id) => ack.mutate(id)} demo={demo} />

      <section aria-labelledby="regras-t" className="mb-8">
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h2 id="regras-t" className="font-display text-[17px] font-semibold text-fg">
            Regras
          </h2>
          {rules.data && (
            <p className="text-xs text-fg-subtle">
              <span className="tabular">{on}</span> de <span className="tabular">{list.length}</span> ligadas
            </p>
          )}
        </div>
        {rules.isLoading && <Skeleton className="h-48 w-full" />}
        {rules.error && <QueryError error={rules.error} />}
        <div className="space-y-2">
          {editing === "new" && kinds.data && <RuleEditor initial={null} kinds={kinds.data.kinds} onDone={() => setEditing(null)} />}
          {rules.data && !list.length && editing !== "new" && (
            <EmptyState title="Nenhuma regra ainda">Crie a primeira a partir de um modelo pronto, como latência alta ou antena fora do ar.</EmptyState>
          )}
          <ul className="space-y-2">
            {list.map((r) =>
              editing === r.id && kinds.data ? (
                <li key={r.id}>
                  <RuleEditor initial={r} kinds={kinds.data.kinds} onDone={() => setEditing(null)} />
                </li>
              ) : (
                <RuleRow
                  key={r.id}
                  r={r}
                  kinds={kinds.data?.kinds}
                  now={now}
                  demo={demo}
                  onToggle={() => toggle.mutate(r)}
                  onSilence={(minutes) => silence.mutate({ id: r.id, minutes })}
                  onEdit={() => setEditing(r.id)}
                  onDelete={() => confirm(`Excluir a regra "${r.name}"? Isso não pode ser desfeito.`) && del.mutate(r.id)}
                />
              ),
            )}
          </ul>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ChannelsCard />
        <DigestCard />
        <div className="md:col-span-2 xl:col-span-1">
          <HistoryCard events={events.data?.events} />
        </div>
      </div>
    </>
  );
}
