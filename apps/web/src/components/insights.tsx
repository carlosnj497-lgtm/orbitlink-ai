"use client";

import type { BestHours, InsightsCompare } from "@astryon/shared";
import { ArrowDownRight, ArrowUpRight, CloudRain, Clock, Minus, Scale } from "lucide-react";
import { QueryError, SourceBadge } from "@/components/domain";
import { Badge, Card, CardBody, CardHeader, EmptyState, Skeleton } from "@/components/ui/primitives";
import { useAgent } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useDemo } from "@/lib/demo-context";
import { fmtBytesStr, fmtHM, fmtNumber, fmtPct } from "@/lib/format";

type Metric = { label: string; cur: number | null; prev: number | null; fmt: (v: number | null) => string; betterUp: boolean; unit: string };

function Delta({ cur, prev, betterUp, unit }: { cur: number | null; prev: number | null; betterUp: boolean; unit: string }) {
  if (cur === null || prev === null) return <span className="text-fg-subtle">sem comparação</span>;
  const d = cur - prev;
  if (Math.abs(d) < 0.005) return <span className="inline-flex items-center gap-1 text-fg-muted"><Minus className="size-3.5" aria-hidden /> igual</span>;
  const good = d > 0 === betterUp;
  const Icon = d > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("tabular inline-flex items-center gap-1", good ? "text-ok" : "text-warn")}>
      <Icon className="size-3.5" aria-hidden />
      {fmtNumber(Math.abs(d), 2)}
      {unit} <span className="sr-only">{good ? "melhor" : "pior"}</span>
    </span>
  );
}

/** Período atual × anterior de mesmo tamanho, e perda com e sem chuva quando o clima está configurado. */
export function CompareCard({ range }: { range: string }) {
  const demo = useDemo();
  const q = useAgent<InsightsCompare>(`insights/compare?range=${range}`, { refetchInterval: 5 * 60_000 });
  const d = q.data;
  const ms = (v: number | null) => (v === null ? "—" : `${fmtNumber(v, 1)} ms`);
  const rows: Metric[] = d
    ? [
        { label: "Disponibilidade", cur: d.current.availability_pct, prev: d.previous.availability_pct, fmt: (v) => fmtPct(v, 2), betterUp: true, unit: " p.p." },
        { label: "Perda média", cur: d.current.loss_pct, prev: d.previous.loss_pct, fmt: (v) => fmtPct(v, 2), betterUp: false, unit: " p.p." },
        { label: "Latência p50", cur: d.current.latency_p50_ms, prev: d.previous.latency_p50_ms, fmt: ms, betterUp: false, unit: " ms" },
        { label: "Latência p95", cur: d.current.latency_p95_ms, prev: d.previous.latency_p95_ms, fmt: ms, betterUp: false, unit: " ms" },
        { label: "Interrupções", cur: d.current.drops, prev: d.previous.drops, fmt: (v) => (v === null ? "—" : fmtNumber(v, 0)), betterUp: false, unit: "" },
        { label: "Consumo estimado", cur: d.current.bytes_total, prev: d.previous.bytes_total, fmt: (v) => (v === null ? "—" : fmtBytesStr(v)), betterUp: true, unit: "" },
      ]
    : [];
  return (
    <Card>
      <CardHeader title="Comparação com o período anterior" icon={<Scale />} subtitle={`Últimos ${range} × os ${range} antes deles`} actions={d && <SourceBadge source={demo ? "demonstracao" : d.current.source} />} />
      <CardBody>
        {q.error && <QueryError error={q.error} />}
        {!d && !q.error && <Skeleton className="h-48 w-full" />}
        {d && (
          <>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-fg-subtle">
                <tr className="border-b border-border">
                  <th className="py-1.5 pr-2 font-medium">Indicador</th>
                  <th className="py-1.5 pr-2 font-medium">Agora</th>
                  <th className="py-1.5 pr-2 font-medium">Antes</th>
                  <th className="py-1.5 font-medium">Variação</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label} className="border-b border-border/60 last:border-0">
                    <td className="py-1.5 pr-2 text-fg-muted">{r.label}</td>
                    <td className="tabular py-1.5 pr-2 text-fg">{r.fmt(r.cur)}</td>
                    <td className="tabular py-1.5 pr-2 text-fg-muted">{r.fmt(r.prev)}</td>
                    <td className="py-1.5 text-xs">{r.label === "Consumo estimado" ? <span className="text-fg-subtle">—</span> : <Delta cur={r.cur} prev={r.prev} betterUp={r.betterUp} unit={r.unit} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {d.rain && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-bg-elev/60 px-3 py-2 text-xs">
                <CloudRain className="size-4 text-accent" aria-hidden />
                <span className="text-fg-muted">Perda nas horas com chuva:</span>
                <Badge tone="accent">{fmtPct(d.rain.chuva.loss_pct, 2)}</Badge>
                <span className="text-fg-muted">sem chuva:</span>
                <Badge>{fmtPct(d.rain.sem_chuva.loss_pct, 2)}</Badge>
              </div>
            )}
            <p className="mt-2 text-[11px] text-fg-subtle">{d.note}</p>
          </>
        )}
      </CardBody>
    </Card>
  );
}

/** Horas do dia com menos perda e latência, e as próximas janelas boas sem chuva prevista. */
export function BestHoursCard() {
  const q = useAgent<BestHours>("insights/best-hours", { refetchInterval: 15 * 60_000 });
  const d = q.data;
  const max = Math.max(1, ...(d?.hours.map((h) => h.loss_pct) ?? [1]));
  return (
    <Card>
      <CardHeader title="Melhores horários" icon={<Clock />} subtitle={d ? `Base: últimos ${d.days} dias observados` : undefined} />
      <CardBody>
        {q.error && <QueryError error={q.error} />}
        {!d && !q.error && <Skeleton className="h-48 w-full" />}
        {d && !d.enough_data && <EmptyState icon={<Clock />} title="Ainda não há observação suficiente">É preciso pelo menos 30 minutos observados em 6 horas diferentes do dia.</EmptyState>}
        {d && d.enough_data && (
          <>
            {d.next_good.length > 0 && (
              <p className="mb-3 text-sm text-fg">
                Próximas janelas boas:{" "}
                {d.next_good.map((x) => (
                  <Badge key={x.ts} tone="ok" className="mr-1">
                    {fmtHM(x.ts).slice(0, 2)}h
                  </Badge>
                ))}
              </p>
            )}
            <ul className="space-y-1.5">
              {d.best.map((h) => (
                <li key={`b${h.hour}`} className="flex items-center gap-2 text-sm">
                  <span className="tabular w-10 text-fg">{String(h.hour).padStart(2, "0")}h</span>
                  <span className="h-1.5 flex-1 rounded-full bg-surface-2">
                    <span className="block h-1.5 rounded-full bg-ok" style={{ width: `${Math.max(4, (h.loss_pct / max) * 100)}%` }} />
                  </span>
                  <span className="tabular w-28 text-right text-xs text-fg-muted">perda {fmtPct(h.loss_pct, 2)}</span>
                </li>
              ))}
              {d.worst.map((h) => (
                <li key={`w${h.hour}`} className="flex items-center gap-2 text-sm">
                  <span className="tabular w-10 text-fg-muted">{String(h.hour).padStart(2, "0")}h</span>
                  <span className="h-1.5 flex-1 rounded-full bg-surface-2">
                    <span className="block h-1.5 rounded-full bg-warn" style={{ width: `${Math.max(4, (h.loss_pct / max) * 100)}%` }} />
                  </span>
                  <span className="tabular w-28 text-right text-xs text-warn">perda {fmtPct(h.loss_pct, 2)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-fg-subtle">{d.note}</p>
          </>
        )}
      </CardBody>
    </Card>
  );
}
