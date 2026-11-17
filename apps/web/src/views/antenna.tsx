"use client";

import type { AgentInfo, MetricKey, Source, StatusResponse, Telemetry } from "@astryon/shared";
import { Activity, ArrowRight, Clock, Cpu, Radar, RadioTower, RefreshCw, SatelliteDish, ShieldCheck, SlidersHorizontal, Zap } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { TelemetryChart } from "@/components/charts";
import { CoverageBar, PageHeader, QueryError, SourceBadge, StatePill } from "@/components/domain";
import { hrefOf } from "@/components/shell/nav";
import { Badge, Button, Callout, Card, CardBody, CardHeader, EmptyState, Skeleton } from "@/components/ui/primitives";
import { useAgent, useStatusInterval } from "@/lib/api";
import { useBasePath } from "@/lib/demo-context";
import { fmtDateTime, fmtDuration, fmtNumber } from "@/lib/format";
import { SectionHead } from "./antenna-parts/section";
import { type PartState, StateLight, SystemDiagram } from "./antenna-parts/system-diagram";
import { num } from "./dashboard/parts";
import { RangeTabs } from "./shared";

/** Leituras técnicas exibidas na tabela, na ordem em que aparecem (só as que o firmware informar). */
const TECH: { key: MetricKey; label: string; fmt?: "duration" | "bool" }[] = [
  { key: "snr_above_noise_floor", label: "Sinal acima do piso de ruído", fmt: "bool" },
  { key: "pop_latency_ms", label: "Latência até o PoP" },
  { key: "pop_drop_pct", label: "Perda de ping ao PoP" },
  { key: "eth_speed_mbps", label: "Velocidade da porta Ethernet" },
  { key: "gps_valid", label: "GPS com posição válida", fmt: "bool" },
  { key: "gps_sats", label: "Satélites GPS em uso" },
  { key: "obstruction_pct", label: "Tempo com céu obstruído" },
  { key: "currently_obstructed", label: "Obstruída neste momento", fmt: "bool" },
  { key: "obstruction_valid_s", label: "Janela da estatística de obstrução", fmt: "duration" },
  { key: "uptime_s", label: "Tempo ligada", fmt: "duration" },
];

function techValue(v: unknown, unit: string | null | undefined, fmt?: "duration" | "bool"): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean" || fmt === "bool") return v ? "Sim" : "Não";
  if (typeof v === "number") return fmt === "duration" ? fmtDuration(v) : `${fmtNumber(v, 2)}${unit ? ` ${unit}` : ""}`;
  return String(v);
}

const LINK_CLASS = "inline-flex h-8 items-center gap-2 rounded-md border border-accent-2/40 bg-accent-soft px-3 text-sm font-medium text-accent transition-colors hover:border-accent";

export default function AntennaView() {
  const base = useBasePath();
  const [range, setRange] = useState("24h");
  const status = useAgent<StatusResponse>("status", { refetchInterval: useStatusInterval(10_000) });
  const agent = useAgent<AgentInfo>("agent", { refetchInterval: 30_000 });
  const tel = useAgent<Telemetry>(`telemetry?range=${range}`, { refetchInterval: 120_000 });
  const st = status.data?.available ? status.data.status : null;
  const m = st?.metrics;
  const hasPower = tel.data?.points.some((p) => p.power_w !== null) ?? false;
  const lastPower = [...(tel.data?.points ?? [])].reverse().find((p) => p.power_w !== null)?.power_w ?? null;
  const unavailable = status.data ? ("indisponivel" as const) : null;
  const rows = TECH.filter((t) => m?.[t.key]);
  const state = !status.data ? null : !status.data.available ? (status.data.dish_reachable === false ? "inalcancavel" : "desconhecida") : status.data.stale ? "desconhecida" : status.data.status.state;
  const stale = status.data?.available && status.data.stale;
  const loading = status.isLoading;
  const signal = m?.snr_above_noise_floor?.value;
  const gps = m?.gps_valid?.value;
  const obstructed = m?.currently_obstructed?.value;
  const gpsSats = num(m?.gps_sats?.value);
  const source = st ? (st.origin === "grpc" ? "real" : "demonstracao") : "indisponivel";
  const refresh = () => {
    void status.refetch();
    void agent.refetch();
    void tel.refetch();
  };
  // Leitura boa só conta como "ok" com dado novo; atrasada, vira neutra.
  const light = (ok: boolean, warn: boolean): PartState => (warn ? "warn" : ok && !stale ? "ok" : "off");

  const lat = num(m?.pop_latency_ms?.value);
  const drop = num(m?.pop_drop_pct?.value);
  const keyNumbers: { label: string; value: string | null; unit?: string; source: Source | null; loading: boolean; warn?: boolean }[] = [
    { label: "Latência até o PoP", value: lat === null ? null : fmtNumber(lat, 0), unit: "ms", source: m?.pop_latency_ms?.source ?? unavailable, loading },
    { label: "Perda de ping ao PoP", value: drop === null ? null : fmtNumber(drop, 2), unit: "%", source: m?.pop_drop_pct?.source ?? unavailable, loading, warn: drop !== null && drop > 5 },
    {
      label: "Última potência registrada",
      value: lastPower === null ? null : fmtNumber(lastPower, 1),
      unit: "W",
      source: lastPower === null ? (tel.data ? "indisponivel" : null) : tel.data?.source === "demonstracao" ? "demonstracao" : "real",
      loading: !tel.data && !tel.error,
    },
  ];
  const conditions = [
    { label: "Sinal de rádio", value: signal === true ? "Acima do piso de ruído" : signal === false ? "Abaixo do piso de ruído" : "Não informado", state: light(signal === true, signal === false), note: "Indicador reportado pela antena" },
    { label: "Visibilidade do céu", value: obstructed === true ? "Obstrução neste momento" : obstructed === false ? "Sem obstrução no momento" : "Não informada", state: light(obstructed === false, obstructed === true), note: "Condição na última leitura" },
    { label: "Posicionamento GPS", value: gps === true ? "Posição válida" : gps === false ? "Sem posição válida" : "Não informado", state: light(gps === true, gps === false), note: gpsSats !== null ? `${fmtNumber(gpsSats, 0)} satélites GPS em uso` : "Satélites GPS não informados" },
  ];

  return (
    <>
      <PageHeader
        title="Antena e Sinal"
        icon={<SatelliteDish />}
        description="Uma visão completa do seu terminal: conexão, visibilidade do céu e energia."
        actions={
          <>
            <Button size="sm" onClick={refresh} disabled={status.isFetching || agent.isFetching || tel.isFetching}>
              <RefreshCw className="size-4" /> Atualizar
            </Button>
            <Link href={hrefOf(base, "controle")} className={LINK_CLASS}>
              <SlidersHorizontal className="size-4" /> Controle da antena
            </Link>
          </>
        }
      />
      {status.error && (
        <div className="mb-4">
          <QueryError error={status.error} onRetry={() => status.refetch()} />
        </div>
      )}

      <SystemDiagram current="antena" />

      {/* ---------------------------------------------------------- Agora */}
      <section aria-labelledby="agora-t" className="mb-8 space-y-3">
        <SectionHead id="agora-t" title="Agora">
          Estado da antena na última leitura da API local
        </SectionHead>
        {stale && <Callout tone="warn" title="Aguardando uma nova leitura">Os dados abaixo são da última comunicação e podem estar desatualizados.</Callout>}

        <div className="ol-card">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3.5">
            <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
              <h3 className="break-words font-display text-[19px] font-semibold text-fg">{agent.data?.terminal_name ?? "Starlink Mini"}</h3>
              {state ? <StatePill state={state} /> : loading ? <Skeleton className="h-6 w-28" /> : <Badge>Sem comunicação</Badge>}
              {status.data && !status.data.available && <p className="w-full text-sm text-fg-muted sm:w-auto">{status.data.reason}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <p className="flex items-center gap-2 text-xs text-fg-muted">
                <Clock className="size-3.5 shrink-0" aria-hidden /> Última leitura: {st ? <span className="tabular">{fmtDateTime(Date.parse(st.observed_at) / 1000)}</span> : "aguardando dados"}
              </p>
              {status.data && <SourceBadge source={source} />}
            </div>
          </div>
          {/* Números-chave que o diagrama não mostra (estado, céu e tempo ligada já estão nele). */}
          <dl className="grid grid-cols-1 divide-y divide-border border-t border-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {keyNumbers.map((k) => (
              <div key={k.label} className="flex items-center justify-between gap-3 px-4 py-3 sm:flex-col sm:items-start sm:justify-start sm:gap-1.5">
                <dt className="ol-label">{k.label}</dt>
                <dd className="flex flex-wrap items-baseline justify-end gap-x-2 gap-y-1 sm:justify-start">
                  {k.loading ? (
                    <Skeleton className="h-5 w-20" />
                  ) : k.value === null ? (
                    <span className="text-sm text-fg-subtle">sem leitura</span>
                  ) : (
                    <span className={k.warn ? "text-warn" : "text-fg"}>
                      <span className="tabular text-[19px] font-medium tracking-[-0.03em]">{k.value}</span>
                      {k.unit && <span className="ml-1 text-[11px] text-fg-muted">{k.unit}</span>}
                    </span>
                  )}
                  {k.source && <SourceBadge source={k.source} className="self-center" />}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="grid items-start gap-3 lg:grid-cols-[1.2fr_1fr]">
          <Card className="min-w-0">
            <CardHeader title="Condições de recepção" icon={<RadioTower />} subtitle="O que a antena informou sobre sinal, céu e GPS" />
            <CardBody>
              <ul className="divide-y divide-border/60">
                {conditions.map((c) => (
                  <li key={c.label} className="flex items-start justify-between gap-4 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm text-fg-muted">{c.label}</p>
                      <p className="mt-0.5 text-[11px] text-fg-subtle">{c.note}</p>
                    </div>
                    {loading ? (
                      <Skeleton className="h-5 w-32" />
                    ) : (
                      <span className="flex items-center gap-2 text-right text-sm font-medium text-fg">
                        <StateLight state={c.state} label="" className="gap-0" />
                        {c.value}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card className="min-w-0">
            <CardHeader title="Saúde do equipamento" icon={<ShieldCheck />} subtitle="Alertas reportados na última comunicação" />
            <CardBody>
              {loading ? (
                <Skeleton className="h-24 w-full" />
              ) : !st ? (
                <EmptyState title="Aguardando a antena" className="py-6">
                  Os alertas aparecerão quando houver uma leitura disponível.
                </EmptyState>
              ) : (
                <Callout tone={stale || st.alerts.length ? "warn" : "ok"} title={stale ? "Leitura desatualizada" : st.alerts.length ? `${st.alerts.length} alerta(s) da antena` : "Nenhum alerta reportado"}>
                  {st.alerts.length ? (
                    <ul className="list-inside list-disc break-words">
                      {st.alerts.map((alert) => (
                        <li key={alert}>{alert}</li>
                      ))}
                    </ul>
                  ) : (
                    "A última leitura não contém alertas do equipamento."
                  )}
                </Callout>
              )}
              <p className="mt-3 text-xs leading-relaxed text-fg-subtle">A API local não informa temperatura ou modo de energia. Superaquecimento, quando reportado, aparece nos alertas.</p>
              <div className="mt-4 space-y-1 border-t border-border pt-3">
                {[
                  { slug: "obstrucoes" as const, title: "Explorar o mapa do céu", text: "Confira a visibilidade e as obstruções.", icon: Radar },
                  { slug: "diagnosticos" as const, title: "Abrir diagnósticos", text: "Investigue a comunicação com a antena.", icon: Activity },
                ].map(({ slug, title, text, icon: Icon }) => (
                  <Link key={slug} href={hrefOf(base, slug)} className="group flex items-center gap-3 rounded-md p-2.5 transition-colors hover:bg-surface-2">
                    <Icon className="size-4 shrink-0 stroke-[1.75] text-accent" aria-hidden />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-fg">{title}</p>
                      <p className="mt-0.5 text-xs text-fg-muted">{text}</p>
                    </div>
                    <ArrowRight className="size-4 text-fg-subtle group-hover:text-accent" aria-hidden />
                  </Link>
                ))}
              </div>
            </CardBody>
          </Card>
        </div>
      </section>

      {/* ---------------------------------------------------------- Tendência */}
      <section aria-labelledby="tendencia-t" className="mb-8">
        <SectionHead id="tendencia-t" title="Energia ao longo do tempo" actions={<RangeTabs value={range} onChange={setRange} options={[{ value: "1h", label: "1h" }, { value: "6h", label: "6h" }, { value: "24h", label: "24h" }, { value: "7d", label: "7d" }]} />}>
          Potência de entrada reportada pela antena, em watts
        </SectionHead>
        <Card className="min-w-0">
          <CardBody className="pt-4">
            {tel.isLoading && <Skeleton className="h-60 w-full" />}
            {tel.error && <QueryError error={tel.error} onRetry={() => tel.refetch()} />}
            {tel.data && !hasPower && (
              <EmptyState icon={<Zap />} title="Potência não informada" className="min-h-60">
                Este firmware não forneceu a potência (power_in) no período, ou a antena não está acessível. Nenhum valor é estimado.
              </EmptyState>
            )}
            {tel.data && hasPower && (
              <>
                <TelemetryChart points={tel.data.points} mode="power" start={tel.data.start} end={tel.data.end} gaps={tel.data.gaps} height={240} />
                <div className="mt-2 flex items-center justify-end gap-3">
                  <CoverageBar coverage={tel.data.coverage} />
                  <SourceBadge source={tel.data.source} />
                </div>
              </>
            )}
          </CardBody>
        </Card>
      </section>

      {/* ---------------------------------------------------------- Detalhes técnicos */}
      <section aria-labelledby="detalhes-t" className="mb-4">
        <SectionHead id="detalhes-t" title="Detalhes técnicos">
          Identificação e leituras brutas, somente o que o firmware informou
        </SectionHead>
        <div className="grid items-start gap-3 xl:grid-cols-[1fr_1.6fr]">
          <Card className="min-w-0">
            <CardHeader title="Identificação do terminal" icon={<Cpu />} subtitle="Hardware, software e comunicação local" />
            <CardBody>
              {agent.error && <QueryError error={agent.error} onRetry={() => agent.refetch()} />}
              <dl className="divide-y divide-border/60 text-sm">
                {[
                  ["Hardware", st?.device.hardware_version ?? agent.data?.hardware ?? "Não identificado"],
                  ["Firmware", st?.device.software_version ?? agent.data?.firmware ?? "Não identificado"],
                  ["Reinicializações", st?.device.bootcount != null ? fmtNumber(st.device.bootcount, 0) : "Não informado"],
                  ["Endereço consultado", agent.data?.dish_target ?? "—"],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-start justify-between gap-4 py-2.5">
                    <dt className="text-sm text-fg-muted">{label}</dt>
                    <dd className="max-w-[60%] break-all text-right font-mono text-xs leading-relaxed text-fg">{value}</dd>
                  </div>
                ))}
              </dl>
            </CardBody>
          </Card>
          <Card className="min-w-0">
            <CardHeader title="Leituras técnicas" icon={<RadioTower />} subtitle="Somente o que a antena informou agora" />
            <CardBody>
              {loading ? (
                <Skeleton className="h-48 w-full" />
              ) : rows.length === 0 ? (
                <EmptyState title="Sem leituras" className="py-8">
                  A antena não está enviando dados no momento.
                </EmptyState>
              ) : (
                <ul className="grid gap-x-6 sm:grid-cols-2">
                  {rows.map((t) => {
                    const metric = m![t.key]!;
                    return (
                      <li key={t.key} className="flex items-center justify-between gap-3 border-b border-border/60 py-2.5">
                        <div className="min-w-0">
                          <p className="text-xs text-fg-muted">{t.label}</p>
                          <p className="tabular mt-0.5 text-sm font-medium text-fg">{techValue(metric.value, metric.unit, t.fmt)}</p>
                        </div>
                        <SourceBadge source={metric.source} />
                      </li>
                    );
                  })}
                </ul>
              )}
              {st && st.fields_missing.length > 0 && (
                <details className="mt-4 rounded-md border border-border bg-surface-2/40 p-3">
                  <summary className="cursor-pointer text-xs text-fg-muted">Campos não fornecidos pelo firmware ({st.fields_missing.length})</summary>
                  <p className="mt-1.5 flex flex-wrap gap-1.5">
                    {st.fields_missing.map((f) => (
                      <Badge key={f} className="font-mono text-[10.5px]">
                        {f}
                      </Badge>
                    ))}
                  </p>
                </details>
              )}
            </CardBody>
          </Card>
        </div>
      </section>
      <p className="text-xs text-fg-subtle">Leituras da API local. Valores ausentes são indicados por “—”; a origem dos dados acompanha cada indicador.</p>
    </>
  );
}
