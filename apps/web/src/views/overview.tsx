"use client";

import type { AgentInfo, EventsResponse, Quality, StatusResponse, Telemetry, UsagePlan, UsageSeries, UsageSummary } from "@astryon/shared";
import { Activity, ChartArea, House } from "lucide-react";
import { useState } from "react";
import { type SeriesMode, TelemetryChart } from "@/components/charts";
import { CoverageBar, PageHeader, QueryError, SourceBadge } from "@/components/domain";
import { CLOUD } from "@/lib/cloud-flag";
import { Callout, Card, CardBody, CardHeader, EmptyState, Skeleton, Tabs } from "@/components/ui/primitives";
import { useAgent, useStatusInterval } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useBasePath } from "@/lib/demo-context";
import { fmtDuration } from "@/lib/format";
import { qualityScore } from "@/lib/quality-score";
import { AntennaCard, CoverageCard, DiagnosticsCard, EventsCard, UsageCard } from "./dashboard/cards";
import { num } from "./dashboard/parts";
import { DashboardVerdict } from "./overview-parts/dashboard-verdict";
import { EnvironmentCard } from "./overview-parts/environment";
import { OutagesDay } from "./overview-parts/outages-day";
import { EvidenceHeading } from "./overview-parts/verdict";
import { GapNote, RangeTabs } from "./shared";

const SERIES_LABEL: Record<Telemetry["series_source"], string> = {
  history_1s: "Histórico de 1 s da antena",
  minute_aggregates: "Agregados por minuto",
  status_10s: "Amostras de status (10 s)",
  none: "Sem dados",
};

const RANGES = [
  { value: "1h", label: "1h" },
  { value: "6h", label: "6h" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
];

/** Legenda interativa do gráfico de tráfego: cada botão liga/desliga a série. */
function LegendToggle({ label, color, hidden, onToggle }: { label: string; color: string; hidden: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} aria-pressed={!hidden} className={cn("flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium transition-colors hover:bg-surface-2", hidden ? "text-fg-subtle line-through" : "text-fg")}>
      <span className="size-2.5 rounded-full" style={{ background: hidden ? "var(--surface-3)" : color }} aria-hidden />
      {label}
    </button>
  );
}

export default function OverviewView() {
  const base = useBasePath();
  const [mode, setMode] = useState<SeriesMode>("traffic");
  const [range, setRange] = useState("1h");
  const [hideDown, setHideDown] = useState(false);
  const [hideUp, setHideUp] = useState(false);

  const status = useAgent<StatusResponse>("status", { refetchInterval: useStatusInterval(10_000) });
  const agent = useAgent<AgentInfo>("agent", { refetchInterval: 30_000 });
  const spark = useAgent<Telemetry>("telemetry?range=15m", { refetchInterval: 30_000 });
  const tel = useAgent<Telemetry>(`telemetry?range=${range}`, { refetchInterval: range === "1h" ? 30_000 : 120_000 });
  const usage = useAgent<UsageSummary>("usage/summary", { refetchInterval: 60_000 });
  const plan = useAgent<UsagePlan>("usage/plan", { refetchInterval: 60_000 });
  const series = useAgent<UsageSeries>("usage/series?range=30d&bucket=day", { refetchInterval: 120_000 });
  const quality = useAgent<Quality>("quality?range=24h", { refetchInterval: 60_000 });
  // Mesma consulta da tela Eventos (7 d): alimenta as interrupções de 24 h, a comparação e a lista de eventos.
  const events = useAgent<EventsResponse>("events?range=7d&limit=1000", { refetchInterval: 60_000 });

  const st = status.data?.available ? status.data.status : null;
  const obst = num(st?.metrics.obstruction_pct?.value);
  const hasPower = tel.data?.points.some((p) => p.power_w !== null) ?? false;
  const lastPower = [...(spark.data?.points ?? [])].reverse().find((p) => p.power_w !== null)?.power_w ?? null;
  const score = quality.data
    ? qualityScore({ availabilityPct: quality.data.availability_pct, lossPct: quality.data.loss_pct, latencyP50Ms: quality.data.latency_p50_ms, obstructionPct: obst })
    : null;

  return (
    <>
      <div className="lg:hidden">
        <PageHeader title="Dashboard" icon={<House />} description="Visão geral da sua Starlink em tempo real" />
      </div>
      {status.error && (
        <div className="mb-4">
          <QueryError error={status.error} onRetry={() => status.refetch()} />
        </div>
      )}
      {agent.data?.mode === "fixture" && !base && (
        <Callout tone="demo" title="Agente em modo FIXTURE" className="mb-4">
          O agente está lendo um arquivo de fixture (ASTRYON_FIXTURE_FILE). Os dados não são da sua antena.
        </Callout>
      )}

      <DashboardVerdict status={status.data} agent={agent.data} quality={quality.data} events={events.data} score={score} power={lastPower} />

      <EvidenceHeading id="provas-t" title="Por que esse veredito" note="Desempenho, quedas, diagnóstico e eventos registrados" />
      <section aria-labelledby="provas-t" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card className="flex flex-col md:col-span-2">
          <CardHeader
            title={
              <>
                Desempenho da conexão
              </>
            }
            icon={<ChartArea />}
            subtitle={tel.data ? `${SERIES_LABEL[tel.data.series_source]} · resolução ${fmtDuration(tel.data.bucket_s)}` : undefined}
            className="flex-wrap"
            actions={
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Tabs
                  label="Métrica"
                  value={mode}
                  onValueChange={(v) => setMode(v as SeriesMode)}
                  items={[
                    { value: "traffic", label: "Tráfego" },
                    { value: "latency", label: "Latência" },
                    { value: "loss", label: "Perda" },
                    ...(hasPower ? [{ value: "power", label: "Potência" }] : []),
                  ]}
                />
                <RangeTabs value={range} onChange={setRange} options={RANGES} />
              </div>
            }
          />
          <CardBody className="flex flex-1 flex-col">
            {tel.isLoading && <Skeleton className="h-[220px] w-full" />}
            {tel.error && <QueryError error={tel.error} onRetry={() => tel.refetch()} />}
            {tel.data && tel.data.points.length === 0 && (
              <EmptyState icon={<Activity />} title="Sem amostras neste período" className="min-h-[200px] flex-1 py-6">
                O gráfico aparece assim que o agente coletar dados reais da antena.
              </EmptyState>
            )}
            {tel.data && tel.data.points.length > 0 && (
              <>
                {mode === "traffic" && (
                  <div className="mb-1 flex justify-end gap-1">
                    <LegendToggle label="Download" color="var(--chart-down)" hidden={hideDown} onToggle={() => setHideDown((v) => !v)} />
                    <LegendToggle label="Upload" color="var(--chart-up)" hidden={hideUp} onToggle={() => setHideUp((v) => !v)} />
                  </div>
                )}
                <TelemetryChart points={tel.data.points} mode={mode} start={tel.data.start} end={tel.data.end} gaps={tel.data.gaps} height={mode === "traffic" ? 216 : 240} hideDown={hideDown} hideUp={hideUp} />
                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-2">
                  <GapNote gaps={tel.data.gaps} />
                  <div className="ml-auto flex items-center gap-3">
                    <CoverageBar coverage={tel.data.coverage} />
                    <SourceBadge source={tel.data.source} />
                  </div>
                </div>
              </>
            )}
          </CardBody>
        </Card>

        <OutagesDay events={events.data} error={events.error} className="md:col-span-2 xl:col-span-1" />

        {!CLOUD && <DiagnosticsCard className="md:col-span-2 xl:col-span-3" />}
        <EventsCard events={events.data} className={CLOUD ? "md:col-span-2 xl:col-span-3" : "md:col-span-2"} />
        {!CLOUD && <CoverageCard status={status.data} className="md:col-span-2 xl:col-span-1" />}
      </section>

      <EvidenceHeading id="tambem-t" title="Também no painel" />
      <section aria-labelledby="tambem-t" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <UsageCard usage={usage.data} plan={plan.data} series={series.data} />
        <AntennaCard status={status.data} agent={agent.data} />
        {!CLOUD && <EnvironmentCard agent={agent.data} agentError={agent.error} className="md:col-span-2 xl:col-span-1" />}
      </section>
    </>
  );
}
