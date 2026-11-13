"use client";

import type { Quality, Telemetry } from "@orbitlink/shared";
import { Gauge, Info } from "lucide-react";
import { useState } from "react";
import { TelemetryChart } from "@/components/charts";
import { CoverageBar, MetricCard, PageHeader, QueryError, SourceBadge } from "@/components/domain";
import { Card, CardBody, CardHeader, EmptyState, Skeleton, Tip } from "@/components/ui/primitives";
import { useAgent } from "@/lib/api";
import { fmtDuration, fmtNumber, fmtPct } from "@/lib/format";
import { GapNote, RangeTabs } from "./shared";

function heat(v: number | null, max: number) {
  if (v === null) return "var(--surface-2)";
  const k = Math.min(1, v / Math.max(max, 0.001));
  return `rgb(248 113 113 / ${0.1 + k * 0.8})`;
}

export default function QualityView() {
  const [range, setRange] = useState("24h");
  const q = useAgent<Quality>(`quality?range=${range}`, { refetchInterval: 60_000 });
  const tel = useAgent<Telemetry>(`telemetry?range=${range}`, { refetchInterval: 60_000 });
  const d = q.data;
  const maxLoss = Math.max(0.1, ...(d?.by_hour.map((h) => h.loss_pct ?? 0) ?? [0]));

  return (
    <>
      <PageHeader
        title="Qualidade da Conexão"
        icon={<Gauge />}
        description="Latência e perda medidas pela própria antena até o PoP da Starlink. Lacunas de observação ficam fora dos cálculos."
        actions={<RangeTabs value={range} onChange={setRange} />}
      />
      {q.error && <QueryError error={q.error} onRetry={() => q.refetch()} />}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MetricCard label="Disponibilidade observada" value={fmtPct(d?.availability_pct, 2)} source={d?.source} loading={!d} hint={d?.availability_note} tone={d?.availability_pct != null && d.availability_pct < 99 ? "warn" : undefined} />
        <MetricCard label="Perda média" value={fmtPct(d?.loss_pct, 2)} source={d?.source} loading={!d} />
        <MetricCard label="Latência p50" value={fmtNumber(d?.latency_p50_ms, 1)} unit="ms" source={d?.source} loading={!d} hint={d?.latency_note} />
        <MetricCard label="Latência p95" value={fmtNumber(d?.latency_p95_ms, 1)} unit="ms" source={d?.source} loading={!d} hint={d?.latency_note} />
        <MetricCard label="Jitter estimado" value={fmtNumber(d?.jitter_ms, 2)} unit="ms" source={d?.jitter_ms != null ? (d?.source === "demonstracao" ? "demonstracao" : "calculada") : "indisponivel"} loading={!d} hint={d?.jitter_note} />
      </div>
      {d && (
        <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-fg-subtle">
          <CoverageBar coverage={d.coverage} />
          <span>Observado: {fmtDuration(d.observed_seconds)}</span>
          <span>Perda total: {fmtDuration(d.full_drop_seconds)}</span>
          <GapNote gaps={d.gaps} />
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {(["latency", "loss"] as const).map((mode) => (
          <Card key={mode}>
            <CardHeader title={mode === "latency" ? "Latência até o PoP" : "Perda de ping ao PoP"} actions={tel.data && <SourceBadge source={tel.data.source} />} />
            <CardBody>
              {tel.isLoading && <Skeleton className="h-56 w-full" />}
              {tel.data && !tel.data.points.length && <EmptyState title="Sem amostras no período" />}
              {tel.data && tel.data.points.length > 0 && <TelemetryChart points={tel.data.points} mode={mode} start={tel.data.start} end={tel.data.end} gaps={tel.data.gaps} height={220} />}
            </CardBody>
          </Card>
        ))}
      </div>

      <Card className="mt-4">
        <CardHeader title="Perda e latência por hora do dia" subtitle="Responde: quais horários têm mais perda? (America/Fortaleza)" icon={<Info />} />
        <CardBody>
          {!d && <Skeleton className="h-24 w-full" />}
          {d && d.observed_seconds === 0 && <EmptyState title="Ainda não há observações suficientes" />}
          {d && d.observed_seconds > 0 && (
            <div className="overflow-x-auto">
              <div className="grid min-w-[640px] grid-cols-24 gap-1" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>
                {d.by_hour.map((h) => (
                  <Tip key={h.hour} content={`${String(h.hour).padStart(2, "0")}h — perda ${fmtPct(h.loss_pct, 2)}, latência ${fmtNumber(h.latency_avg_ms, 1)} ms, observado ${fmtDuration(h.observed_seconds)}`}>
                    <div tabIndex={0} className="flex flex-col items-center gap-1">
                      <div className="h-12 w-full rounded-sm border border-border" style={{ background: h.observed_seconds ? heat(h.loss_pct, maxLoss) : "repeating-linear-gradient(45deg,var(--surface-2) 0 3px,transparent 3px 6px)" }} />
                      <span className="text-[10px] tabular text-fg-subtle">{h.hour}</span>
                    </div>
                  </Tip>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-fg-subtle">Cor mais intensa = maior perda média. Hachurado = hora sem observação.</p>
            </div>
          )}
        </CardBody>
      </Card>
    </>
  );
}
