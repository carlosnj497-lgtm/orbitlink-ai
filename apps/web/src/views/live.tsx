"use client";

import type { EventsResponse, Source, StatusResponse, Telemetry, TelemetryPoint } from "@orbitlink/shared";
import { Activity, ArrowDown, ArrowRight, ArrowUp, ChartArea, Clock, Download, Info, ListChecks, Pause, Play, Radar, RadioTower, RefreshCw, Timer, TrendingDown, TrendingUp, Waves } from "lucide-react";
import Link from "next/link";
import { memo, type ReactNode, useId, useState } from "react";
import { TelemetryChart } from "@/components/charts";
import { CoverageBar, SourceBadge, STATE_META } from "@/components/domain";
import { hrefOf } from "@/components/shell/nav";
import { Badge, Button, Callout, Card, CardBody, CardHeader, Skeleton, Tip } from "@/components/ui/primitives";
import { useAgent, useAgentStream, useStatusInterval } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useBasePath, useDemo } from "@/lib/demo-context";
import { fmtAgo, fmtDateTime, fmtDuration, fmtMbps, fmtNumber, fmtPct, fmtTime } from "@/lib/format";
import { type LiveReading, useLiveReadings } from "@/lib/live-buffer";
import { useNow } from "@/lib/use-now";
import { num } from "./dashboard/parts";
import { EVENT_META, GapNote } from "./shared";

export function downloadCsv(filename: string, header: string[], rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => (v === null ? "" : /[",;\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const csv = [header.join(";"), ...rows.map((r) => r.map(esc).join(";"))].join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

const RANGES = [
  { value: "15m", label: "15 min" },
  { value: "1h", label: "1 h" },
  { value: "6h", label: "6 h" },
];

const SERIES_LABEL: Record<Telemetry["series_source"], string> = {
  history_1s: "Histórico de 1 s da antena",
  minute_aggregates: "Agregados por minuto",
  status_10s: "Amostras de status (10 s)",
  none: "Sem série disponível",
};

const STREAM_LABEL = { open: "SSE conectado", connecting: "Conectando ao agente", reconnecting: "Reconectando ao agente", closed: "Canal desconectado", demo: "Demonstração" } as const;

/* ================================================================= Estatísticas da janela (calculadas dos pontos reais) */
interface WindowStats {
  downAvg: number | null;
  downPeak: number | null;
  upAvg: number | null;
  upPeak: number | null;
  latP50: number | null;
  latP95: number | null;
  lossAvg: number | null;
  fullDropS: number;
}

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
}

export function windowStats(points: TelemetryPoint[], bucketS: number): WindowStats {
  const avg = (k: keyof TelemetryPoint) => {
    const v = points.map((p) => p[k]).filter((x): x is number => typeof x === "number");
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const peak = (k: "down_mbps" | "up_mbps", kmax: "down_max_mbps" | "up_max_mbps") => {
    const v = points.flatMap((p) => [p[kmax], p[k]]).filter((x): x is number => typeof x === "number");
    return v.length ? Math.max(...v) : null;
  };
  const lat = points.map((p) => p.latency_ms).filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
  return {
    downAvg: avg("down_mbps"),
    downPeak: peak("down_mbps", "down_max_mbps"),
    upAvg: avg("up_mbps"),
    upPeak: peak("up_mbps", "up_max_mbps"),
    latP50: quantile(lat, 0.5),
    latP95: quantile(lat, 0.95),
    lossAvg: avg("drop_pct"),
    fullDropS: points.filter((p) => (p.drop_pct ?? 0) >= 99).length * bucketS,
  };
}

/* ================================================================= Traço das leituras da sessão */
const TRACE_W = 120;
const TRACE_H = 30;

const Trace = memo(function Trace({ values, color }: { values: (number | null)[]; color: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  if (values.filter((v) => v !== null).length < 2) {
    return <div className="mt-2 grid h-[30px] place-items-center rounded-md border border-dashed border-border text-[10.5px] text-fg-subtle">aguardando leituras</div>;
  }
  const max = Math.max(0.001, ...values.map((v) => v ?? 0));
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * TRACE_W;
  const y = (v: number) => TRACE_H - 2 - (v / max) * (TRACE_H - 5);
  // Trechos contínuos; leituras sem valor quebram a linha (nunca viram zero).
  const runs: [number, number][][] = [];
  let run: [number, number][] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (run.length > 1) runs.push(run);
      run = [];
    } else run.push([x(i), y(v)]);
  });
  if (run.length > 1) runs.push(run);
  const line = (r: [number, number][]) => r.map(([px, py], j) => `${j ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join("");
  const last = values.length - 1;
  const lastV = values[last];
  return (
    <svg viewBox={`0 0 ${TRACE_W} ${TRACE_H}`} preserveAspectRatio="none" className="mt-2 h-[30px] w-full overflow-visible" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {runs.map((r, i) => (
        <g key={i}>
          <path d={`${line(r)}L${r[r.length - 1][0].toFixed(1)} ${TRACE_H}L${r[0][0].toFixed(1)} ${TRACE_H}Z`} fill={`url(#${id})`} />
          <path d={line(r)} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </g>
      ))}
      {lastV !== null && <circle cx={x(last)} cy={y(lastV)} r="2.2" fill={color} />}
    </svg>
  );
});

/* ================================================================= Leitura atual */
// Ícone de identificação, não de estado: o mesmo azul para todas as leituras.
const TILE_ICON = "border-border bg-bg-elev text-accent";
const TILE = { green: TILE_ICON, violet: TILE_ICON, blue: TILE_ICON, red: TILE_ICON } as const;

function Reading({
  label,
  icon,
  color,
  stroke,
  value,
  unit,
  note,
  loading,
  source,
  tone,
  hint,
  trace,
  delta,
  deltaFmt,
  higherIsBetter,
}: {
  label: string;
  icon: ReactNode;
  color: keyof typeof TILE;
  stroke: string;
  value: string;
  unit: string;
  note: string;
  loading: boolean;
  source?: Source | null;
  tone?: "warn" | "crit";
  hint: string;
  trace: (number | null)[];
  delta: number | null;
  deltaFmt: (v: number) => string;
  higherIsBetter: boolean;
}) {
  const better = delta !== null && delta !== 0 && (delta > 0) === higherIsBetter;
  return (
    <Card role="region" aria-label={label} className="flex min-w-0 flex-col p-3 sm:p-3.5">
      <div className="flex items-center gap-2.5">
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-md border sm:size-9 [&>svg]:size-4 sm:[&>svg]:size-[18px]", TILE[color])}>{icon}</span>
        <p className="min-w-0 flex-1 truncate text-xs font-medium text-fg-muted sm:text-[13px]">{label}</p>
        <Tip content={hint}>
          <button type="button" aria-label={`Sobre ${label}`} className="shrink-0 text-fg-subtle hover:text-fg">
            <Info className="size-3.5" />
          </button>
        </Tip>
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-8 w-24" />
      ) : (
        <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <p className={cn("tabular text-2xl font-semibold leading-none tracking-tight sm:text-[30px]", tone === "crit" ? "text-crit" : tone === "warn" ? "text-warn" : "text-fg")}>
            {value}
            <span className="ml-1 text-sm font-medium text-fg-muted">{unit}</span>
          </p>
          {delta !== null && delta !== 0 && (
            <span className={cn("tabular flex items-center gap-0.5 text-[11px] font-medium", better ? "text-ok" : "text-warn")} title="Variação desde a leitura anterior">
              {delta > 0 ? <TrendingUp className="size-3.5" aria-hidden /> : <TrendingDown className="size-3.5" aria-hidden />}
              {delta > 0 ? "+" : "−"}
              {deltaFmt(Math.abs(delta))}
            </span>
          )}
        </div>
      )}
      <Trace values={trace} color={stroke} />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="text-[11px] text-fg-subtle">{note}</span>
        {loading ? <span className="text-[11px] text-fg-subtle">Consultando antena</span> : <SourceBadge source={source} />}
      </div>
    </Card>
  );
}

/* ================================================================= Relógio "há X s" isolado (não re-renderiza os gráficos) */
function SinceLast({ t }: { t: number | null }) {
  const now = useNow(1000);
  return <>{t && now ? fmtAgo(t, now) : "—"}</>;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] text-fg-subtle">{label}</dt>
      <dd className="tabular truncate text-sm font-semibold text-fg">
        {value}
        {sub && <span className="ml-1 text-[11px] font-normal text-fg-muted">{sub}</span>}
      </dd>
    </div>
  );
}

function ChartBody({ data, loading, error, height, children }: { data?: Telemetry; loading: boolean; error: boolean; height: number; children: ReactNode }) {
  if (loading) return <div aria-hidden className="skeleton w-full rounded-md" style={{ height }} />;
  if (!data?.points.length)
    return (
      <div className="flex flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-border px-6 text-center" style={{ minHeight: height }}>
        <Waves className="size-6 text-fg-subtle" aria-hidden />
        <p className="text-sm font-medium text-fg">{error ? "Telemetria indisponível" : "Aguardando telemetria"}</p>
        <p className="max-w-sm text-xs text-fg-muted">{error ? "Verifique a comunicação com o agente." : "As amostras aparecem quando chegam da antena. Nada é preenchido com zeros."}</p>
      </div>
    );
  return <>{children}</>;
}

/* ================================================================= Tela */
interface Snapshot {
  status?: StatusResponse;
  telemetry?: Telemetry;
  events?: EventsResponse;
  readings: LiveReading[];
}

export default function LiveView() {
  const base = useBasePath();
  const demo = useDemo();
  const syncId = useId();
  const [range, setRange] = useState("15m");
  // O cabeçalho também assina o SSE: pausar congela uma cópia dos dados exibidos,
  // mesmo que outros componentes continuem atualizando o cache.
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const paused = snapshot !== null;
  const [hideDown, setHideDown] = useState(false);
  const [hideUp, setHideUp] = useState(false);
  const stream = useAgentStream(!paused);
  const statusInterval = useStatusInterval(10_000);
  const status = useAgent<StatusResponse>("status", { enabled: !paused, refetchInterval: paused ? false : statusInterval });
  const tel = useAgent<Telemetry>(`telemetry?range=${range}`, { enabled: !paused, refetchInterval: paused ? false : 15_000 });
  const ev = useAgent<EventsResponse>(`events?range=${range}&limit=50`, { enabled: !paused, refetchInterval: paused ? false : 30_000 });
  const liveReadings = useLiveReadings(demo ? "demo" : "agent", status.data, !paused);

  const statusData = paused ? snapshot.status : status.data;
  const telemetry = paused ? snapshot.telemetry : tel.data;
  const events = paused ? snapshot.events : ev.data;
  const readings = paused ? snapshot.readings : liveReadings;

  const st = statusData?.available ? statusData.status : null;
  const m = st?.metrics;
  const down = num(m?.downlink_mbps?.value);
  const up = num(m?.uplink_mbps?.value);
  const latency = num(m?.pop_latency_ms?.value);
  const loss = num(m?.pop_drop_pct?.value);
  const obstructed = m?.currently_obstructed?.value;
  const loading = !paused && status.isLoading;
  const stale = !!statusData?.available && statusData.stale;
  const conn = st ? STATE_META[st.state] : statusData?.dish_reachable === false ? STATE_META.inalcancavel : STATE_META.desconhecida;
  const connected = !!st && !stale && st.state === "conectada";
  const observed = st ? Date.parse(st.observed_at) / 1000 : null;
  const channelActive = !paused && (stream === "open" || stream === "demo");
  const stats = telemetry?.points.length ? windowStats(telemetry.points, telemetry.bucket_s) : null;
  const winEvents = (events?.events ?? []).slice().sort((a, b) => b.start_ts - a.start_ts);

  const series = (k: keyof Omit<LiveReading, "t" | "state" | "obstructed">) => readings.map((r) => r[k]);
  const delta = (k: keyof Omit<LiveReading, "t" | "state" | "obstructed">) => {
    const a = readings.at(-2)?.[k];
    const b = readings.at(-1)?.[k];
    return typeof a === "number" && typeof b === "number" && readings.at(-1)?.t === observed ? b - a : null;
  };
  const sessionSpan = readings.length > 1 ? readings[readings.length - 1].t - readings[0].t : 0;

  function togglePause() {
    setSnapshot(paused ? null : { status: status.data, telemetry: tel.data, events: ev.data, readings: liveReadings });
  }

  function exportCsv() {
    if (!telemetry) return;
    downloadCsv(
      `orbitlink-telemetria-${range}.csv`,
      ["timestamp_utc", "horario_local", "download_mbps", "upload_mbps", "latencia_pop_ms", "perda_pct", "potencia_w", "amostras", "fonte"],
      telemetry.points.map((p) => [new Date(p.t * 1000).toISOString(), fmtDateTime(p.t), p.down_mbps, p.up_mbps, p.latency_ms, p.drop_pct, p.power_w, p.n, telemetry.source]),
    );
  }

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold tracking-tight lg:hidden">Monitoramento ao Vivo</h1>

      {/* Barra de controle: estado do canal, última leitura, janela e ações */}
      <div className="ol-card mb-4 flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className={cn("relative grid size-9 shrink-0 place-items-center rounded-full border", paused ? "border-warn/40 bg-warn/10 text-warn" : channelActive ? "border-ok/40 bg-ok/10 text-ok" : "border-border-strong bg-surface-2 text-fg-muted")}>
            {paused ? <Pause className="size-4" aria-hidden /> : <RadioTower className="size-4" aria-hidden />}
            {channelActive && <span className="absolute -right-0.5 -top-0.5 size-2.5 animate-pulse-dot rounded-full bg-ok ring-2 ring-bg-elev" aria-hidden />}
          </span>
          <div className="min-w-0 leading-tight">
            <p className={cn("text-sm font-semibold", paused ? "text-warn" : "text-fg")}>{paused ? "Visualização pausada" : STREAM_LABEL[stream]}</p>
            <p className="tabular text-xs text-fg-muted">
              Última leitura: <span className="font-medium text-fg">{observed ? fmtTime(observed) : "—"}</span> · <SinceLast t={observed} />
            </p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Janela de telemetria" className="inline-flex rounded-lg border border-border bg-bg-elev p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.value}
                type="button"
                aria-pressed={range === r.value}
                disabled={paused}
                onClick={() => setRange(r.value)}
                className="rounded-md px-3 py-1 text-xs font-medium text-fg-muted transition-colors hover:text-fg disabled:opacity-45 aria-pressed:bg-accent-soft aria-pressed:text-accent aria-pressed:shadow-[inset_0_0_0_1px_rgb(0_140_255/0.45)]"
              >
                {r.label}
              </button>
            ))}
          </div>
          <Button size="sm" variant={paused ? "primary" : "secondary"} onClick={togglePause} aria-pressed={paused}>
            {paused ? <Play /> : <Pause />} {paused ? "Retomar" : "Pausar"}
          </Button>
          <Button size="sm" onClick={exportCsv} disabled={!telemetry?.points.length}>
            <Download /> Exportar CSV
          </Button>
        </div>
      </div>

      {paused && (
        <Callout tone="warn" icon={<Pause />} className="mb-4">
          Visualização congelada. A coleta continua no agente; retome para atualizar os dados ou trocar a janela.
        </Callout>
      )}
      {!paused && (status.error || tel.error) && (
        <Callout tone="crit" icon={<Info />} className="mb-4" title="Falha ao atualizar">
          Não foi possível atualizar {status.error && tel.error ? "o status e o histórico" : status.error ? "o status da antena" : "o histórico de telemetria"}.
          <Button
            size="sm"
            variant="ghost"
            className="ml-2 h-6 px-2"
            onClick={() => {
              void status.refetch();
              void tel.refetch();
            }}
          >
            <RefreshCw /> Tentar novamente
          </Button>
        </Callout>
      )}
      {stale && (
        <Callout tone="warn" icon={<Clock />} className="mb-4">
          Dados atrasados · última leitura há {fmtDuration(statusData?.available ? statusData.age_s : null)}.
        </Callout>
      )}

      {/* Leituras atuais com a tendência das leituras recebidas nesta aba */}
      <section aria-label="Leituras atuais" className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Reading label="Download" icon={<ArrowDown />} color="green" stroke="var(--chart-down)" value={fmtMbps(down)} unit="Mbps" note={down === null ? "Sem leitura" : down === 0 ? "Conexão ociosa" : "Tráfego recebido agora"} loading={loading} source={m?.downlink_mbps?.source} hint="Tráfego corrente recebido pela antena. Não é a velocidade máxima da conexão nem um teste de velocidade." trace={series("down")} delta={delta("down")} deltaFmt={fmtMbps} higherIsBetter />
        <Reading label="Upload" icon={<ArrowUp />} color="violet" stroke="var(--chart-up)" value={fmtMbps(up)} unit="Mbps" note={up === null ? "Sem leitura" : up === 0 ? "Conexão ociosa" : "Tráfego enviado agora"} loading={loading} source={m?.uplink_mbps?.source} hint="Tráfego corrente enviado pela antena. Zero indica ausência de tráfego no momento." trace={series("up")} delta={delta("up")} deltaFmt={fmtMbps} higherIsBetter />
        <Reading label="Latência" icon={<Clock />} color="blue" stroke="var(--accent)" value={fmtNumber(latency, 1)} unit="ms" note="Até o PoP Starlink" loading={loading} source={m?.pop_latency_ms?.source} tone={latency !== null && latency > 100 ? "warn" : undefined} hint="Latência entre a antena e o ponto de presença (PoP) da Starlink. Não corresponde ao ping até sites da internet." trace={series("lat")} delta={delta("lat")} deltaFmt={(v) => `${fmtNumber(v, 1)} ms`} higherIsBetter={false} />
        <Reading label="Perda de pacotes" icon={<Activity />} color="red" stroke="var(--chart-loss)" value={fmtNumber(loss, 2)} unit="%" note="Pings ao PoP sem resposta" loading={loading} source={m?.pop_drop_pct?.source} tone={loss !== null && loss >= 5 ? "crit" : loss !== null && loss > 1 ? "warn" : undefined} hint="Fração dos pings da antena ao PoP sem resposta na amostra mais recente." trace={series("loss")} delta={delta("loss")} deltaFmt={(v) => `${fmtNumber(v, 2)} pp`} higherIsBetter={false} />
      </section>
      <p className="-mt-2 mb-4 flex items-center gap-1.5 text-[11px] text-fg-subtle">
        <Info className="size-3 shrink-0" aria-hidden />
        Traços: {readings.length} leitura(s) recebidas nesta aba{sessionSpan > 0 ? ` nos últimos ${fmtDuration(sessionSpan)}` : ""} (até 15 min, só em memória). Os gráficos abaixo usam o histórico gravado pelo agente.
      </p>

      {/* Tráfego ao lado do estado do enlace; abaixo, latência, perda e eventos lado a lado (nenhuma coluna termina antes). */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
          {/* Tráfego */}
          <Card className="min-w-0">
            <CardHeader
              title={
                <>
                  Tráfego da conexão <span className="font-normal text-fg-muted">(Mbps)</span>
                </>
              }
              icon={<ChartArea />}
              subtitle={telemetry ? `${SERIES_LABEL[telemetry.series_source]} · resolução ${fmtDuration(telemetry.bucket_s)}` : undefined}
              actions={
                <div role="group" aria-label="Séries do gráfico" className="flex gap-1">
                  {[
                    { label: "Download", color: "var(--chart-down)", hidden: hideDown, toggle: () => setHideDown((v) => !v) },
                    { label: "Upload", color: "var(--chart-up)", hidden: hideUp, toggle: () => setHideUp((v) => !v) },
                  ].map((s) => (
                    <button key={s.label} type="button" onClick={s.toggle} aria-pressed={!s.hidden} className={cn("flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium transition-colors hover:bg-surface-2", s.hidden ? "text-fg-subtle line-through" : "text-fg")}>
                      <span className="size-2.5 rounded-full" style={{ background: s.hidden ? "var(--surface-3)" : s.color }} aria-hidden />
                      {s.label}
                    </button>
                  ))}
                </div>
              }
            />
            <CardBody>
              <ChartBody data={telemetry} loading={!paused && tel.isLoading} error={!!tel.error} height={280}>
                <TelemetryChart points={telemetry?.points ?? []} mode="traffic" start={telemetry?.start ?? 0} end={telemetry?.end ?? 0} gaps={telemetry?.gaps} height={280} hideDown={hideDown} hideUp={hideUp} syncId={syncId} />
              </ChartBody>
              <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3 sm:grid-cols-4">
                <Stat label="Download médio" value={stats ? fmtMbps(stats.downAvg) : "—"} sub="Mbps" />
                <Stat label="Pico de download" value={stats ? fmtMbps(stats.downPeak) : "—"} sub="Mbps" />
                <Stat label="Upload médio" value={stats ? fmtMbps(stats.upAvg) : "—"} sub="Mbps" />
                <Stat label="Pico de upload" value={stats ? fmtMbps(stats.upPeak) : "—"} sub="Mbps" />
              </dl>
              <p className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-fg-subtle">
                <span>Tráfego observado, não capacidade da conexão.</span>
                {telemetry && <SourceBadge source={telemetry.source} />}
              </p>
            </CardBody>
          </Card>

          <Card className="min-w-0">
            <CardHeader title="Estado do enlace" icon={<RadioTower />} actions={statusData && <SourceBadge source={st ? (st.origin === "grpc" ? "real" : "demonstracao") : "indisponivel"} />} />
            <CardBody>
              <div className="flex items-center gap-3">
                <span className={cn("grid size-11 shrink-0 place-items-center rounded-full border", connected ? "border-ok/40 bg-ok/10 text-ok" : stale ? "border-warn/40 bg-warn/10 text-warn" : st ? "border-warn/40 bg-warn/10 text-warn" : "border-crit/40 bg-crit/10 text-crit")}>
                  <span className={cn("size-3 rounded-full", connected ? "bg-ok animate-pulse-dot" : stale || st ? "bg-warn" : "bg-crit")} aria-hidden />
                </span>
                <div className="min-w-0 leading-tight">
                  <p className="text-base font-semibold text-fg">{loading ? "Consultando antena" : stale ? "Dados atrasados" : conn.label}</p>
                  <p className="text-xs text-fg-muted">{stale ? "Aguardando uma leitura atualizada." : connected ? "Enlace reportado pela antena." : st ? "Estado informado pela antena." : "Aguardando comunicação com a antena."}</p>
                </div>
              </div>
              <dl className="mt-3 divide-y divide-border text-sm">
                {[
                  [<Timer key="i" />, "Tempo ligada", fmtDuration(num(m?.uptime_s?.value))],
                  [<Radar key="i" />, "Obstruída agora", typeof obstructed === "boolean" ? (obstructed ? "Sim" : "Não") : "Não informado"],
                  [<RadioTower key="i" />, "Canal de dados", paused ? "Pausado na tela" : stream === "demo" ? "Demonstração" : stream === "open" ? "SSE ativo" : "Consulta periódica"],
                  [<ListChecks key="i" />, "Registros na janela", telemetry ? fmtNumber(telemetry.points.length, 0) : "—"],
                ].map(([icon, k, v]) => (
                  <div key={k as string} className="flex items-center gap-2 py-2">
                    <dt className="flex flex-1 items-center gap-2 text-fg-muted">
                      <span className="text-fg-subtle [&>svg]:size-3.5" aria-hidden>
                        {icon}
                      </span>
                      {k}
                    </dt>
                    <dd className="tabular font-medium">{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-3 border-t border-border pt-3">
                <CoverageBar coverage={telemetry?.coverage ?? null} />
                {telemetry && <GapNote gaps={telemetry.gaps} />}
              </div>
              <Link href={hrefOf(base, "diagnosticos")} className="mt-3 flex items-center justify-center gap-1.5 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs font-medium text-accent transition-colors hover:bg-accent/15">
                Abrir diagnóstico <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </CardBody>
          </Card>
        <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:col-span-2 xl:grid-cols-3">
          {/* Latência */}
          <Card>
            <CardHeader
              title={
                <>
                  Latência <span className="font-normal text-fg-muted">(ms)</span>
                </>
              }
              icon={<Clock />}
              subtitle="Antena → PoP da Starlink"
            />
            <CardBody>
              <ChartBody data={telemetry} loading={!paused && tel.isLoading} error={!!tel.error} height={190}>
                <TelemetryChart points={telemetry?.points ?? []} mode="latency" start={telemetry?.start ?? 0} end={telemetry?.end ?? 0} gaps={telemetry?.gaps} height={190} syncId={syncId} />
              </ChartBody>
              <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3">
                <Stat label="Mediana" value={stats?.latP50 != null ? fmtNumber(stats.latP50, 0) : "—"} sub="ms" />
                <Stat label="Pior 5% (p95)" value={stats?.latP95 != null ? fmtNumber(stats.latP95, 0) : "—"} sub="ms" />
              </dl>
            </CardBody>
          </Card>

          {/* Perda */}
          <Card>
            <CardHeader
              title={
                <>
                  Perda de pacotes <span className="font-normal text-fg-muted">(%)</span>
                </>
              }
              icon={<Waves />}
              subtitle="Pings ao PoP sem resposta"
            />
            <CardBody>
              <ChartBody data={telemetry} loading={!paused && tel.isLoading} error={!!tel.error} height={190}>
                <TelemetryChart points={telemetry?.points ?? []} mode="loss" start={telemetry?.start ?? 0} end={telemetry?.end ?? 0} gaps={telemetry?.gaps} height={190} syncId={syncId} />
              </ChartBody>
              <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3">
                <Stat label="Perda média" value={stats?.lossAvg != null ? fmtPct(stats.lossAvg, 2) : "—"} />
                <Stat label="Sem resposta (100%)" value={stats ? fmtDuration(stats.fullDropS) : "—"} />
              </dl>
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="Eventos na janela"
              icon={<ListChecks />}
              actions={
                <Link href={hrefOf(base, "interrupcoes")} className="text-xs font-medium text-accent hover:underline">
                  ver tudo
                </Link>
              }
            />
            <CardBody>
              {!events && !ev.error ? (
                <Skeleton className="h-24 w-full" />
              ) : winEvents.length === 0 ? (
                <p className="py-4 text-center text-sm text-fg-muted">{ev.error ? "Não foi possível consultar os eventos." : "Nenhum evento registrado nesta janela."}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {winEvents.slice(0, 6).map((e) => {
                    const meta = EVENT_META[e.kind];
                    return (
                      <li key={e.id} className="flex items-start gap-2.5 py-2">
                        <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", meta?.tone === "crit" ? "bg-crit" : meta?.tone === "warn" ? "bg-warn" : "bg-fg-subtle")} aria-hidden />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-fg">{meta?.label ?? e.kind}</p>
                          <p className="tabular text-[11px] text-fg-subtle">{fmtTime(e.start_ts)}</p>
                        </div>
                        <Badge tone={e.open ? "crit" : "neutral"}>{e.open ? "em andamento" : fmtDuration(e.duration_s)}</Badge>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <p className="mt-4 flex items-start gap-1.5 text-[11px] leading-snug text-fg-subtle">
        <Info className="mt-px size-3 shrink-0" aria-hidden />
        <span>
          Status via SSE (~10 s). O histórico é consultado a cada 15 s e chega com cerca de 30 s de atraso. Lacunas de coleta ficam em branco e não contam como queda.
          {telemetry && ` Janela: ${fmtDateTime(telemetry.start)} → ${fmtDateTime(telemetry.end)}.`}
        </span>
      </p>
    </>
  );
}
