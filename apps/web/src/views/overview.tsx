"use client";

import type { AgentInfo, EventsResponse, StatusResponse, Telemetry, UsageSummary } from "@orbitlink/shared";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Bot,
  Clock,
  Database,
  Gauge,
  HeartPulse,
  Radar,
  RadioTower,
  Sparkles,
  TriangleAlert,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Sparkline, TelemetryChart, type SeriesMode } from "@/components/charts";
import { CoverageBar, MetricCard, PageHeader, QueryError, SourceBadge, StatePill } from "@/components/domain";
import { Badge, Callout, Card, CardBody, CardHeader, EmptyState, Skeleton, Tabs } from "@/components/ui/primitives";
import { useAgent } from "@/lib/api";
import { useBasePath } from "@/lib/demo-context";
import { fmtAgo, fmtBytes, fmtDuration, fmtFull, fmtMbps, fmtNumber, fmtPct } from "@/lib/format";
import { EventRow, GapNote, RangeTabs } from "./shared";

function num(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

function StatusHero({ status, agent }: { status: StatusResponse | undefined; agent: AgentInfo | undefined }) {
  const base = useBasePath();
  if (!status) {
    return (
      <Card className="p-5 lg:col-span-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="mt-4 h-4 w-64" />
        <Skeleton className="mt-2 h-4 w-48" />
      </Card>
    );
  }
  if (!status.available) {
    return (
      <Card className="flex flex-col gap-3 p-5 lg:col-span-2">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-medium text-fg-muted">Estado da Starlink</span>
          <SourceBadge source="indisponivel" />
        </div>
        <StatePill state={status.dish_reachable === false ? "inalcancavel" : "desconhecida"} className="self-start text-sm" />
        <p className="text-sm text-fg-muted">{status.reason}</p>
        <p className="text-xs text-fg-subtle">
          Nenhum número é exibido sem dados reais.{" "}
          <Link href={`${base}/instalacao`} className="text-accent underline-offset-4 hover:underline">
            Abrir o assistente de conexão
          </Link>
        </p>
      </Card>
    );
  }
  const st = status.status;
  const uptime = num(st.metrics.uptime_s?.value);
  return (
    <Card className="relative overflow-hidden p-5 lg:col-span-2">
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-accent/10 blur-3xl" />
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-fg-muted">
          <RadioTower className="size-3.5 text-fg-subtle" /> Estado da Starlink
        </span>
        <SourceBadge source={st.origin === "grpc" ? "real" : "demonstracao"} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <StatePill state={status.stale ? "desconhecida" : st.state} className="text-sm" />
        {status.stale && <Badge tone="warn">dados atrasados ({fmtDuration(status.age_s)})</Badge>}
        {st.state_reason && <span className="text-sm text-fg-muted">{st.state_reason}</span>}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-fg-subtle">Uptime da antena</dt>
          <dd className="tabular">{uptime !== null ? fmtDuration(uptime) : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-subtle">Última amostra</dt>
          <dd className="tabular" title={fmtFull(Date.parse(st.observed_at) / 1000)}>
            {fmtAgo(Date.parse(st.observed_at) / 1000)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-fg-subtle">Hardware</dt>
          <dd className="truncate">{st.device.hardware_version ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-subtle">Firmware</dt>
          <dd className="truncate font-mono text-xs leading-5">{st.device.software_version ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-subtle">Agente</dt>
          <dd>{agent ? (agent.mode === "fixture" ? "fixture" : `v${agent.version}`) : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-subtle">Alertas da antena</dt>
          <dd>{st.alerts.length ? st.alerts.join(", ") : "nenhum"}</dd>
        </div>
      </dl>
    </Card>
  );
}

function TrafficCard({ dir, status, tel }: { dir: "down" | "up"; status: StatusResponse | undefined; tel: Telemetry | undefined }) {
  const m = status?.available ? status.status.metrics[dir === "down" ? "downlink_mbps" : "uplink_mbps"] : undefined;
  const v = num(m?.value);
  return (
    <MetricCard
      label={dir === "down" ? "Download agora" : "Upload agora"}
      icon={dir === "down" ? <ArrowDown /> : <ArrowUp />}
      value={v === null ? "—" : fmtMbps(v)}
      unit={v === null ? undefined : "Mbps"}
      source={m?.source ?? (status ? "indisponivel" : null)}
      loading={!status}
      hint="Tráfego corrente reportado pela antena — NÃO é a velocidade máxima da conexão nem um teste de velocidade. 0 Mbps normalmente significa conexão ociosa."
      footer={v === 0 ? "Ocioso (sem tráfego no momento)" : "Tráfego corrente, não capacidade"}
    >
      {tel?.points?.length ? (
        <Sparkline data={tel.points} dataKey={dir === "down" ? "down_mbps" : "up_mbps"} color={dir === "down" ? "var(--chart-down)" : "var(--chart-up)"} />
      ) : null}
    </MetricCard>
  );
}

function UsageCard({ usage }: { usage: UsageSummary | undefined }) {
  const base = useBasePath();
  if (!usage) return <MetricCard label="Consumo monitorado" value="" loading />;
  const today = fmtBytes(usage.today.bytes_total);
  const month = fmtBytes(usage.month.bytes_total);
  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-fg-muted">
          <Database className="size-3.5 text-fg-subtle" /> Consumo monitorado
        </span>
        <SourceBadge source={usage.today.source} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-fg-subtle">Hoje</p>
          <p className="tabular text-2xl font-semibold">
            {today.value} <span className="text-sm font-medium text-fg-muted">{today.unit}</span>
          </p>
          <CoverageBar coverage={usage.today.coverage} className="mt-1" />
        </div>
        <div>
          <p className="text-xs text-fg-subtle">Este mês</p>
          <p className="tabular text-2xl font-semibold">
            {month.value} <span className="text-sm font-medium text-fg-muted">{month.unit}</span>
          </p>
          <CoverageBar coverage={usage.month.coverage} className="mt-1" />
        </div>
      </div>
      <p className="mt-auto pt-3 text-[11px] leading-snug text-fg-subtle">
        Estimativa local (integração do tráfego da antena). Não é o consumo oficial do plano.{" "}
        <Link href={`${base}/consumo`} className="text-accent underline-offset-4 hover:underline">
          Detalhes
        </Link>
      </p>
    </Card>
  );
}

function ObstructionCard({ status }: { status: StatusResponse | undefined }) {
  const base = useBasePath();
  const m = status?.available ? status.status.metrics.obstruction_pct : undefined;
  const cur = status?.available ? status.status.metrics.currently_obstructed?.value : undefined;
  const v = num(m?.value);
  return (
    <MetricCard
      label="Obstrução"
      icon={<Radar />}
      value={v === null ? "—" : fmtPct(v, 2)}
      source={m?.source ?? (status ? "indisponivel" : null)}
      loading={!status}
      tone={v !== null && v > 5 ? "warn" : undefined}
      hint="Fração do tempo com visão do céu obstruída, segundo a estatística da própria antena (janela informada pelo firmware)."
      footer={
        v === null ? "Este firmware não informou estatística de obstrução." : (
          <span>
            {cur === true ? "Obstruída neste momento" : cur === false ? "Sem obstrução agora" : ""} ·{" "}
            <Link href={`${base}/obstrucoes`} className="text-accent hover:underline">mapa</Link>
          </span>
        )
      }
    />
  );
}

function HealthCard({ agent }: { agent: AgentInfo | undefined }) {
  if (!agent) return <MetricCard label="Saúde da coleta" value="" loading />;
  const loops = agent.loops ?? {};
  const failing = Object.entries(loops).filter(([, l]) => l.consecutive_failures > 0);
  return (
    <Card className="flex flex-col p-4">
      <span className="flex items-center gap-1.5 text-[12px] font-medium text-fg-muted">
        <HeartPulse className="size-3.5 text-fg-subtle" /> Saúde da coleta
      </span>
      <ul className="mt-3 space-y-1.5 text-sm">
        <li className="flex justify-between gap-2">
          <span className="text-fg-muted">Agente</span>
          <Badge tone="ok">online</Badge>
        </li>
        <li className="flex justify-between gap-2">
          <span className="text-fg-muted">Antena</span>
          <Badge tone={agent.dish_reachable ? "ok" : agent.dish_reachable === false ? "crit" : "neutral"}>
            {agent.dish_reachable ? "acessível" : agent.dish_reachable === false ? "inacessível" : "verificando"}
          </Badge>
        </li>
        <li className="flex justify-between gap-2">
          <span className="text-fg-muted">Última amostra</span>
          <span className="tabular">{fmtAgo(agent.last_status_ts)}</span>
        </li>
        <li className="flex justify-between gap-2">
          <span className="text-fg-muted">Amostras perdidas</span>
          <span className="tabular">{fmtNumber(agent.history_lost_total, 0)}</span>
        </li>
        {agent.supabase_configured && (
          <li className="flex justify-between gap-2">
            <span className="text-fg-muted">Sync pendente</span>
            <span className="tabular">{fmtNumber(agent.sync_pending, 0)}</span>
          </li>
        )}
      </ul>
      {failing.length > 0 && (
        <p className="mt-3 text-xs text-warn">
          {failing.map(([k, l]) => `${k}: ${l.last_error_kind ?? "erro"}`).join(" · ")}
        </p>
      )}
    </Card>
  );
}

interface DiagnosticSummary {
  generated_at: number;
  source: string;
  engine: "regras" | "claude";
  headline: string;
  findings: { severity: "info" | "warn" | "crit"; kind: "evento_observado" | "hipotese" | "causa_confirmada"; text: string; evidence: string }[];
}

function DiagnosticsCard() {
  const base = useBasePath();
  const { data, error, isLoading } = useAgent<DiagnosticSummary>("diagnostics/summary?range=24h", { refetchInterval: 60_000 });
  return (
    <Card className="lg:col-span-2">
      <CardHeader
        title="Diagnóstico das últimas 24 h"
        icon={<Sparkles />}
        subtitle={data ? `Motor: ${data.engine === "regras" ? "regras determinísticas (sem IA)" : "Claude"} · baseado somente em dados registrados` : undefined}
        actions={
          <Link href={`${base}/assistente`} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
            <Bot className="size-3.5" /> Perguntar ao assistente
          </Link>
        }
      />
      <CardBody>
        {isLoading && <Skeleton className="h-16 w-full" />}
        {error && <QueryError error={error} />}
        {data && (
          <>
            <p className="text-sm text-fg">{data.headline}</p>
            <ul className="mt-3 space-y-2">
              {data.findings.slice(0, 5).map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <TriangleAlert className={`mt-0.5 size-3.5 shrink-0 ${f.severity === "crit" ? "text-crit" : f.severity === "warn" ? "text-warn" : "text-fg-subtle"}`} />
                  <div>
                    <p className="text-fg">
                      {f.text}{" "}
                      <Badge tone={f.kind === "causa_confirmada" ? "ok" : f.kind === "hipotese" ? "warn" : "neutral"} className="ml-1 align-middle">
                        {f.kind === "causa_confirmada" ? "causa confirmada" : f.kind === "hipotese" ? "hipótese" : "evento observado"}
                      </Badge>
                    </p>
                    <p className="text-xs text-fg-subtle">{f.evidence}</p>
                  </div>
                </li>
              ))}
              {!data.findings.length && <li className="text-sm text-fg-muted">Nenhuma anomalia detectada no período observado.</li>}
            </ul>
          </>
        )}
      </CardBody>
    </Card>
  );
}

export default function OverviewView() {
  const base = useBasePath();
  const [mode, setMode] = useState<SeriesMode>("traffic");
  const [range, setRange] = useState("1h");
  const status = useAgent<StatusResponse>("status", { refetchInterval: 10_000 });
  const agent = useAgent<AgentInfo>("agent", { refetchInterval: 30_000 });
  const spark = useAgent<Telemetry>("telemetry?range=15m", { refetchInterval: 30_000 });
  const tel = useAgent<Telemetry>(`telemetry?range=${range}`, { refetchInterval: range === "1h" ? 30_000 : 120_000 });
  const usage = useAgent<UsageSummary>("usage/summary", { refetchInterval: 60_000 });
  const events = useAgent<EventsResponse>("events?range=24h&limit=8", { refetchInterval: 60_000 });

  const st = status.data?.available ? status.data.status : null;
  const lat = num(st?.metrics.pop_latency_ms?.value);
  const drop = num(st?.metrics.pop_drop_pct?.value);
  const hasPower = tel.data?.points.some((p) => p.power_w !== null);
  const lastPower = [...(spark.data?.points ?? [])].reverse().find((p) => p.power_w !== null)?.power_w ?? null;

  return (
    <>
      <PageHeader title="Visão Geral" icon={<Activity />} description="Estado atual, tráfego corrente e qualidade da Starlink Mini, com a origem de cada número." />
      {status.error && <QueryError error={status.error} onRetry={() => status.refetch()} />}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Indicadores atuais">
        <StatusHero status={status.data} agent={agent.data} />
        <TrafficCard dir="down" status={status.data} tel={spark.data} />
        <TrafficCard dir="up" status={status.data} tel={spark.data} />
        <MetricCard
          label="Latência até o PoP"
          icon={<Clock />}
          value={lat === null ? "—" : fmtNumber(lat, 1)}
          unit={lat === null ? undefined : "ms"}
          source={st?.metrics.pop_latency_ms?.source ?? (status.data ? "indisponivel" : null)}
          loading={!status.data}
          tone={lat !== null && lat > 100 ? "warn" : undefined}
          hint="Latência medida pela própria antena até o ponto de presença (PoP) da Starlink. Não é o ping até sites da internet."
        />
        <MetricCard
          label="Perda de ping ao PoP"
          icon={<Gauge />}
          value={drop === null ? "—" : fmtPct(drop, 2)}
          source={st?.metrics.pop_drop_pct?.source ?? (status.data ? "indisponivel" : null)}
          loading={!status.data}
          tone={drop !== null && drop >= 5 ? "crit" : drop !== null && drop > 1 ? "warn" : undefined}
          hint="Fração de pings da antena ao PoP sem resposta na amostra mais recente."
        />
        <UsageCard usage={usage.data} />
        {hasPower || lastPower !== null ? (
          <MetricCard
            label="Potência reportada"
            icon={<Zap />}
            value={fmtNumber(lastPower, 1)}
            unit="W"
            source={tel.data?.source === "demonstracao" ? "demonstracao" : "real"}
            hint="Potência de entrada reportada pelo histórico da antena (power_in). Exibida apenas quando o firmware fornece."
          />
        ) : (
          <ObstructionCard status={status.data} />
        )}
      </section>

      <section className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Telemetria"
            icon={<Activity />}
            subtitle={tel.data ? `${tel.data.series_source === "history_1s" ? "Histórico de 1 s da antena" : tel.data.series_source === "minute_aggregates" ? "Agregados por minuto" : tel.data.series_source === "status_10s" ? "Amostras de status (10 s)" : "Sem dados"} · resolução ${fmtDuration(tel.data.bucket_s)}` : undefined}
            actions={
              <>
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
                <RangeTabs value={range} onChange={setRange} options={[{ value: "1h", label: "1h" }, { value: "6h", label: "6h" }, { value: "24h", label: "24h" }, { value: "7d", label: "7d" }]} />
              </>
            }
          />
          <CardBody>
            {tel.isLoading && <Skeleton className="h-[260px] w-full" />}
            {tel.error && <QueryError error={tel.error} onRetry={() => tel.refetch()} />}
            {tel.data && tel.data.points.length === 0 && (
              <EmptyState icon={<Activity />} title="Sem amostras neste período">
                O gráfico permanece vazio até o agente coletar dados reais da antena. Nada é preenchido com zeros.
              </EmptyState>
            )}
            {tel.data && tel.data.points.length > 0 && (
              <>
                <TelemetryChart points={tel.data.points} mode={mode} start={tel.data.start} end={tel.data.end} gaps={tel.data.gaps} />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <GapNote gaps={tel.data.gaps} />
                  <div className="flex items-center gap-3">
                    <CoverageBar coverage={tel.data.coverage} />
                    <SourceBadge source={tel.data.source} />
                  </div>
                </div>
              </>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Linha do tempo (24 h)"
            icon={<Clock />}
            actions={<Link href={`${base}/interrupcoes`} className="text-xs text-accent hover:underline">ver tudo</Link>}
          />
          <CardBody>
            {events.isLoading && <Skeleton className="h-40 w-full" />}
            {events.error && <QueryError error={events.error} />}
            {events.data && events.data.events.length === 0 && (
              <EmptyState title="Nenhum evento nas últimas 24 h">
                {events.data.gaps.length ? "Atenção: houve lacunas de observação — eventos nesses períodos não seriam vistos." : "Período observado sem interrupções registradas."}
              </EmptyState>
            )}
            {events.data && events.data.events.length > 0 && (
              <ul className="divide-y divide-border">
                {events.data.events.map((ev) => (
                  <EventRow key={ev.id} ev={ev} />
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </section>

      <section className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {hasPower || lastPower !== null ? <ObstructionCard status={status.data} /> : null}
        <HealthCard agent={agent.data} />
        <DiagnosticsCard />
      </section>

      {agent.data?.mode === "fixture" && !base && (
        <Callout tone="demo" title="Agente em modo FIXTURE" className="mt-4">
          O agente está lendo um arquivo de fixture (ORBITLINK_FIXTURE_FILE). Os dados não são da sua antena.
        </Callout>
      )}
    </>
  );
}
