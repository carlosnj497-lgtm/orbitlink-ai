"use client";

import type { EventsResponse } from "@astryon/shared";
import { Unplug } from "lucide-react";
import Link from "next/link";
import { QueryError } from "@/components/domain";
import { hrefOf } from "@/components/shell/nav";
import { Card, CardBody, CardHeader, Skeleton } from "@/components/ui/primitives";
import type { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useBasePath } from "@/lib/demo-context";
import { fmtAgo, fmtDateTime, fmtDuration, fmtHM } from "@/lib/format";
import { DAY, summarizeOutages } from "@/lib/outages";
import { causeText, EVENT_META } from "../shared";

/* ================================================================= Interrupções (24 h) */
const OUTAGE_TONE: Record<string, string> = { outage: "bg-crit", status_outage: "bg-crit", ping_drop: "bg-warn", unreachable: "bg-fg-subtle" };

/** Interrupções de 24 h no Dashboard: a contagem e o total já estão no veredito; aqui ficam a linha do tempo e as causas. */
export function OutagesDay({ events, error, className }: { events: EventsResponse | undefined; error: ApiError | null; className?: string }) {
  const base = useBasePath();
  const end = events?.end ?? 0;
  // Quedas que começaram antes da janela (inclusive as ainda abertas) contam, com a duração cortada nas 24 h.
  const { from, last, previousCount, longest, latest } = summarizeOutages(events?.events ?? [], end);
  const delta = last.length - previousCount;
  const reasons = Object.entries(
    last.reduce<Record<string, number>>((acc, { event: e }) => {
      const label = e.cause && e.kind !== "ping_drop" ? `${EVENT_META[e.kind]?.label ?? e.kind} · ${causeText(e.cause)}` : (EVENT_META[e.kind]?.label ?? e.kind);
      acc[label] = (acc[label] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  const hadGaps = (events?.gaps ?? []).some((g) => (g.end_ts ?? end) >= from);
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader
        title={
          <>
            Interrupções <span className="font-normal text-fg-muted">(24 h)</span>
          </>
        }
        icon={<Unplug />}
        actions={
          <Link href={hrefOf(base, "interrupcoes")} className="text-xs font-medium text-accent hover:underline">
            ver tudo
          </Link>
        }
      />
      <CardBody className="flex flex-1 flex-col">
        {error ? (
          <QueryError error={error} />
        ) : !events ? (
          <Skeleton className="h-44 w-full" />
        ) : (
          <>
            <div>
              <div className="relative h-7 rounded-md border border-border bg-bg-elev" role="img" aria-label={`Linha do tempo das últimas 24 horas: ${last.length} interrupções`}>
                {[0.25, 0.5, 0.75].map((f) => (
                  <span key={f} className="absolute inset-y-0 w-px bg-border" style={{ left: `${f * 100}%` }} aria-hidden />
                ))}
                {last.map(({ event: e, start, duration }) => (
                  <span
                    key={e.id}
                    title={`${EVENT_META[e.kind]?.label ?? e.kind} · ${fmtDateTime(e.start_ts)} · ${e.open ? "em andamento" : fmtDuration(e.duration_s)}`}
                    className={cn("absolute inset-y-1 min-w-[4px] rounded-sm", OUTAGE_TONE[e.kind] ?? "bg-warn")}
                    style={{ left: `${Math.max(0, Math.min(99, ((start - from) / DAY) * 100))}%`, width: `${Math.min(100, (duration / DAY) * 100)}%` }}
                  />
                ))}
              </div>
              <div className="tabular mt-1 flex justify-between text-[10.5px] text-fg-subtle" aria-hidden>
                {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                  <span key={f}>{f === 1 ? "agora" : fmtHM(from + f * DAY)}</span>
                ))}
              </div>
            </div>
            {reasons.length > 0 ? (
              <ul className="mt-3 space-y-1 text-xs text-fg-muted">
                {reasons.slice(0, 3).map(([label, n]) => (
                  <li key={label} className="flex items-center justify-between gap-2">
                    <span className="truncate">{label}</span>
                    <span className="tabular shrink-0 font-medium text-fg">{n}×</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-xs text-fg-muted">Nenhuma interrupção registrada no período observado.</p>
            )}
            {last.length > 0 && (
              <dl className="mt-auto grid grid-cols-2 gap-3 border-t border-border pt-3">
                <div>
                  <dt className="ol-label">Maior</dt>
                  <dd className="tabular mt-1 text-sm font-medium text-fg">{fmtDuration(longest)}</dd>
                </div>
                <div>
                  <dt className="ol-label">Última</dt>
                  <dd className="tabular mt-1 text-sm font-medium text-fg">{fmtAgo(latest)}</dd>
                </div>
              </dl>
            )}
            <p className={cn("pt-3 text-[11px] text-fg-subtle", last.length === 0 && "mt-auto")}>
              24 h anteriores: <span className="tabular font-medium text-fg-muted">{previousCount}</span>
              {delta !== 0 && <span className={delta > 0 ? "text-warn" : "text-ok"}> ({delta > 0 ? `+${delta}` : delta})</span>}
              {hadGaps && " · houve lacunas de observação: eventos nesses trechos não seriam vistos"}
            </p>
          </>
        )}
      </CardBody>
    </Card>
  );
}
