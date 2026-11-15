"use client";

import type { AgentInfo, EventsResponse, Quality, StatusResponse, Telemetry, UsagePlan, UsageSeries, UsageSummary } from "@astryon/shared";
import { Activity, ArrowDown, ArrowUp, ChartArea, Clock, House, Radar, Zap } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { type SeriesMode, TelemetryChart } from "@/components/charts";
import { CoverageBar, PageHeader, QueryError, SourceBadge } from "@/components/domain";
import { WeatherCard } from "@/components/weather";
import { hrefOf } from "@/components/shell/nav";
import { Callout, Card, CardBody, CardHeader, EmptyState, Skeleton, Tabs } from "@/components/ui/primitives";
import { useAgent, useStatusInterval } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useBasePath } from "@/lib/demo-context";
import { fmtDuration, fmtMbps, fmtNumber, fmtPct } from "@/lib/format";
import { qualityScore } from "@/lib/quality-score";
import { AntennaCard, CoverageCard, DiagnosticsCard, EventsCard, OutagesCard, QualityCard, ServicesCard, UsageCard } from "./dashboard/cards";
import { Hero } from "./dashboard/Hero";
import { MiniSpark, num, StatTile } from "./dashboard/parts";
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
  const m = st?.metrics;
  const down = num(m?.downlink_mbps?.value);
  const up = num(m?.uplink_mbps?.value);
  const lat = num(m?.pop_latency_ms?.value);
  const drop = num(m?.pop_drop_pct?.value);
  const obst = num(m?.obstruction_pct?.value);
  const hasPower = tel.data?.points.some((p) => p.power_w !== null) ?? false;
  const lastPower = [...(spark.data?.points ?? [])].reverse().find((p) => p.power_w !== null)?.power_w ?? null;
  const unavailable = status.data ? ("indisponivel" as const) : null;
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-6 min-[105rem]:grid-cols-[repeat(6,minmax(0,1fr))_21.5rem]">
        <div className="md:col-span-6">
          <Hero status={status.data} agent={agent.data} score={score} />
        </div>

        <section aria-label="Indicadores atuais" className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:col-span-6 xl:grid-cols-5">
          <StatTile
            label="Download agora"
            icon={<ArrowDown />}
            color="green"
            value={down === null ? "—" : fmtMbps(down)}
            unit={down === null ? undefined : "Mbps"}
            source={m?.downlink_mbps?.source ?? unavailable}
            loading={!status.data}
            hint="Tráfego corrente reportado pela antena — NÃO é a velocidade máxima da conexão nem um teste de velocidade. 0 Mbps normalmente significa conexão ociosa."
            footer={down === null ? "Sem leitura da antena" : down === 0 ? "Ocioso (sem tráfego no momento)" : "Tráfego corrente, não capacidade"}
          >
            {spark.data?.points.some((p) => p.down_mbps !== null) ? <MiniSpark data={spark.data.points} k="down_mbps" color="var(--chart-down)" /> : null}
          </StatTile>
          <StatTile
            label="Upload agora"
            icon={<ArrowUp />}
            color="violet"
            value={up === null ? "—" : fmtMbps(up)}
            unit={up === null ? undefined : "Mbps"}
            source={m?.uplink_mbps?.source ?? unavailable}
            loading={!status.data}
            hint="Tráfego corrente de envio reportado pela antena. Não é a capacidade máxima da conexão."
            footer={up === null ? "Sem leitura da antena" : up === 0 ? "Ocioso (sem tráfego no momento)" : "Tráfego corrente, não capacidade"}
          >
            {spark.data?.points.some((p) => p.up_mbps !== null) ? <MiniSpark data={spark.data.points} k="up_mbps" color="var(--chart-up)" /> : null}
          </StatTile>
          <StatTile
            label="Latência"
            icon={<Clock />}
            color="blue"
            value={lat === null ? "—" : fmtNumber(lat, 0)}
            unit={lat === null ? undefined : "ms"}
            source={m?.pop_latency_ms?.source ?? unavailable}
            loading={!status.data}
            tone={lat !== null && lat > 100 ? "warn" : undefined}
            hint="Latência medida pela própria antena até o ponto de presença (PoP) da Starlink. Não é o ping até sites da internet."
            footer={lat === null ? "Sem leitura da antena" : lat <= 60 ? "Baixa · até o PoP" : lat <= 100 ? "Moderada · até o PoP" : "Alta · até o PoP"}
          />
          <StatTile
            label="Perda de pacotes"
            icon={<Activity />}
            color="red"
            value={drop === null ? "—" : fmtPct(drop, 2)}
            source={m?.pop_drop_pct?.source ?? unavailable}
            loading={!status.data}
            tone={drop !== null && drop >= 5 ? "crit" : drop !== null && drop > 1 ? "warn" : undefined}
            hint="Fração de pings da antena ao PoP sem resposta na amostra mais recente."
            footer={drop === null ? "Sem leitura da antena" : drop >= 5 ? "Anomalia: perda elevada" : drop > 1 ? "Acima do normal" : "Dentro do normal"}
          />
          {hasPower || lastPower !== null ? (
            <StatTile
              wide
              className="col-span-2 sm:col-span-1"
              label="Potência"
              icon={<Zap />}
              color="amber"
              value={lastPower === null ? "—" : `≈ ${fmtNumber(lastPower, 0)}`}
              unit={lastPower === null ? undefined : "W"}
              source={tel.data?.source === "demonstracao" ? "demonstracao" : "real"}
              hint="Potência de entrada reportada pelo histórico da antena (power_in). Exibida apenas quando o firmware fornece."
              footer="Consumo elétrico da antena"
            />
          ) : (
            <StatTile
              wide
              className="col-span-2 sm:col-span-1"
              label="Obstrução"
              icon={<Radar />}
              color="amber"
              value={obst === null ? "—" : fmtPct(obst, 2)}
              source={m?.obstruction_pct?.source ?? unavailable}
              loading={!status.data}
              tone={obst !== null && obst > 5 ? "warn" : undefined}
              hint="Fração do tempo com visão do céu obstruída, segundo a própria antena. A potência (W) aparece aqui quando o firmware a informa."
              footer={
                obst === null ? (
                  "Não informado pelo firmware"
                ) : (
                  <Link href={hrefOf(base, "obstrucoes")} className="text-accent hover:underline">
                    Ver mapa do céu
                  </Link>
                )
              }
            />
          )}
        </section>

        <Card className="ol-glow ol-hud flex flex-col md:col-span-6 xl:col-span-4">
          <div aria-hidden className="ol-ruler mx-4 mt-3 opacity-70" />
          <CardHeader
            title={
              <>
                Desempenho da Conexão <span className="font-normal text-fg-muted">(tempo real)</span>
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

        <UsageCard usage={usage.data} plan={plan.data} series={series.data} className="md:col-span-3 xl:col-span-2" />
        <AntennaCard status={status.data} agent={agent.data} className="md:col-span-3 xl:col-span-2" />
        <OutagesCard events={events.data} error={events.error} className="md:col-span-3 xl:col-span-2" />
        <QualityCard quality={quality.data} score={score} className="md:col-span-3 xl:col-span-2" />

        {/* Coluna lateral em telas muito largas (linhas 1–4); Diagnóstico e Serviços ocupam a largura toda abaixo dela. Em telas menores, vira uma linha de dois cards. */}
        <div className="grid min-w-0 grid-cols-1 content-start gap-4 md:col-span-6 md:grid-cols-2 min-[105rem]:col-span-1 min-[105rem]:col-start-7 min-[105rem]:row-span-4 min-[105rem]:row-start-1 min-[105rem]:grid-cols-1">
          <CoverageCard status={status.data} />
          <EventsCard events={events.data} />
        </div>

        <DiagnosticsCard className="md:col-span-6 xl:col-span-4 min-[105rem]:col-span-5" />
        <WeatherCard className="md:col-span-6 xl:col-span-2 min-[105rem]:col-span-2" />
        <ServicesCard agent={agent.data} agentError={agent.error} className="md:col-span-6 min-[105rem]:col-span-7" />
      </div>
    </>
  );
}
