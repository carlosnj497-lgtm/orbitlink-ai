"use client";

import type { EventsResponse } from "@astryon/shared";
import { ArrowRight, Bell, CircleCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { hrefOf } from "@/components/shell/nav";
import { Badge, Card, CardBody, CardHeader, EmptyState, Skeleton, Tabs } from "@/components/ui/primitives";
import { useAgent } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useBasePath } from "@/lib/demo-context";
import { fmtDateTime, fmtDuration } from "@/lib/format";
import { causeText, EVENT_META } from "../shared";
import { type RowState, StateIcon } from "./parts";

/* ================================================================= Alertas e eventos */
interface AlertEvent {
  id: number;
  rule_name: string;
  status: "active" | "resolved";
  severity: string;
  started_at: number;
  resolved_at: number | null;
  message: string;
}

interface FeedItem {
  key: string;
  type: "alert" | "conn";
  ts: number;
  state: RowState;
  title: string;
  detail: string;
  badge: { tone: "crit" | "warn" | "ok" | "neutral"; label: string };
  /** Evento de conexão já encerrado: histórico, sem cor de alerta. */
  past?: boolean;
}

const KIND_STATE: Record<string, RowState> = { outage: "fail", status_outage: "fail", ping_drop: "warn", unreachable: "unknown", boot: "unknown" };

export function EventsCard({ events, className }: { events: EventsResponse | undefined; className?: string }) {
  const base = useBasePath();
  const [filter, setFilter] = useState("all");
  const alerts = useAgent<{ events: AlertEvent[] }>("alerts/events?status=all&limit=100", { refetchInterval: 30_000 });
  const feed: FeedItem[] = [
    ...(alerts.data?.events ?? []).map<FeedItem>((a) => ({
      key: `a${a.id}`,
      type: "alert",
      ts: a.started_at,
      state: a.status === "resolved" ? "ok" : a.severity === "crit" ? "fail" : "warn",
      title: a.rule_name,
      detail: a.message,
      badge: a.status === "active" ? { tone: a.severity === "crit" ? "crit" : "warn", label: "ativo" } : { tone: "ok", label: "resolvido" },
    })),
    ...(events?.events ?? []).map<FeedItem>((e) => ({
      key: `c${e.id}`,
      type: "conn",
      ts: e.start_ts,
      state: e.open ? (KIND_STATE[e.kind] ?? "warn") : KIND_STATE[e.kind] === "unknown" ? "unknown" : "warn",
      title: EVENT_META[e.kind]?.label ?? e.kind,
      detail: e.cause && e.kind !== "ping_drop" ? (causeText(e.cause) ?? "") : "",
      badge: e.open ? { tone: "crit", label: "em andamento" } : { tone: "neutral", label: fmtDuration(e.duration_s) },
      past: !e.open,
    })),
  ]
    .filter((i) => filter === "all" || i.type === filter)
    .sort((a, b) => b.ts - a.ts);
  const active = (alerts.data?.events ?? []).filter((a) => a.status === "active").length;
  const loading = !alerts.data && !events;
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader title="Alertas e Eventos" icon={<Bell />} actions={active > 0 ? <Badge tone="crit">{active} ativo{active > 1 ? "s" : ""}</Badge> : undefined} />
      <CardBody className="flex flex-1 flex-col">
        <Tabs
          label="Filtrar eventos"
          value={filter}
          onValueChange={setFilter}
          className="self-start"
          items={[
            { value: "all", label: "Todos" },
            { value: "alert", label: "Alertas" },
            { value: "conn", label: "Conexão" },
          ]}
        />
        {loading ? (
          <Skeleton className="mt-3 h-40 w-full" />
        ) : feed.length === 0 ? (
          <EmptyState className="py-7" icon={<CircleCheck />} title="Nada registrado">
            {filter === "alert" ? "Nenhum alerta disparado recentemente." : "Nenhum evento nos últimos 7 dias."}
          </EmptyState>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {feed.slice(0, 6).map((i) => (
              <li key={i.key} className="flex items-start gap-2.5 py-2.5">
                <span className="mt-0.5">
                  {/* evento já encerrado: mesmo ícone, sem a cor de alerta (é histórico, não um problema agora) */}
                  <StateIcon state={i.state} className={i.past ? "text-fg-subtle" : undefined} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-fg">
                    {i.title}
                    {i.detail && <span className="text-fg-muted"> · {i.detail}</span>}
                  </p>
                  <p className="tabular text-[11px] text-fg-subtle">{fmtDateTime(i.ts)}</p>
                </div>
                <Badge tone={i.badge.tone} className="shrink-0">
                  {i.badge.label}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        <Link
          href={hrefOf(base, filter === "alert" ? "alertas" : "interrupcoes")}
          className="mt-auto flex items-center justify-center gap-1.5 rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-xs font-medium text-accent transition-colors hover:bg-accent/15"
        >
          Ver histórico completo <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </CardBody>
    </Card>
  );
}
