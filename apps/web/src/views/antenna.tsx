"use client";

import type { AgentInfo, MetricKey, StatusResponse, Telemetry } from "@orbitlink/shared";
import { Activity, ArrowRight, Clock, Cpu, Navigation, Radar, RadioTower, RefreshCw, SatelliteDish, ShieldCheck, SlidersHorizontal, Zap } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DishArt } from "@/components/art/DishArt";
import { TelemetryChart } from "@/components/charts";
import { CoverageBar, PageHeader, QueryError, SourceBadge, StatePill } from "@/components/domain";
import { hrefOf } from "@/components/shell/nav";
import { Badge, Button, Callout, Card, CardBody, CardHeader, EmptyState, Skeleton } from "@/components/ui/primitives";
import { useAgent, useStatusInterval } from "@/lib/api";
import { useBasePath } from "@/lib/demo-context";
import { fmtDateTime, fmtDuration, fmtNumber, fmtPct } from "@/lib/format";
import { num, StatTile } from "./dashboard/parts";
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

export default function AntennaView() {
  const base = useBasePath();
  const [range, setRange] = useState("24h");
  const status = useAgent<StatusResponse>("status", { refetchInterval: useStatusInterval(10_000) });
  const agent = useAgent<AgentInfo>("agent", { refetchInterval: 30_000 });
  const tel = useAgent<Telemetry>(`telemetry?range=${range}`, { refetchInterval: 120_000 });
  const st = status.data?.available ? status.data.status : null;
  const m = st?.metrics;
  const uptime = num(m?.uptime_s?.value);
  const obst = num(m?.obstruction_pct?.value);
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
  const source = st ? (st.origin === "grpc" ? "real" : "demonstracao") : "indisponivel";
  const refresh = () => { void status.refetch(); void agent.refetch(); void tel.refetch(); };

  return (
    <>
      <PageHeader
        title="Antena e Sinal"
        icon={<SatelliteDish />}
        description="Uma visão completa do seu terminal: conexão, visibilidade do céu e energia."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={refresh} disabled={status.isFetching || agent.isFetching || tel.isFetching}><RefreshCw className="size-4" /> Atualizar</Button>
            <Link href={hrefOf(base, "controle")} className="inline-flex h-8 items-center gap-2 rounded-lg border border-accent/30 bg-accent/10 px-3 text-sm font-medium text-accent hover:bg-accent/20">
              <SlidersHorizontal className="size-4" /> Controle da antena
            </Link>
          </div>
        }
      />
      {status.error && (
        <div className="mb-4">
          <QueryError error={status.error} onRetry={() => status.refetch()} />
        </div>
      )}

      <div className="space-y-5">
        {stale && <Callout tone="warn" title="Aguardando uma nova leitura">Os dados abaixo são da última comunicação e podem estar desatualizados.</Callout>}
        <section className="relative isolate overflow-hidden ol-hud rounded-md border border-accent-2/30 bg-[radial-gradient(ellipse_at_25%_40%,rgb(0_82_136/0.28),transparent_65%)]">
          <div className="grid lg:grid-cols-[1.1fr_1fr]">
            <div className="relative flex min-h-80 flex-col justify-between overflow-hidden p-6 sm:p-8">
              <div className="flex flex-wrap items-center justify-end gap-3">
                {status.data && <SourceBadge source={source} />}
              </div>
              <div className="flex flex-wrap items-center gap-5 py-5 sm:flex-nowrap">
                <div className="relative grid size-44 shrink-0 place-items-center rounded-full border border-accent/15 bg-accent/5 sm:size-52">
                  <div aria-hidden className="absolute inset-4 rounded-full border border-dashed border-accent/20" />
                  <DishArt className="relative w-44 sm:w-52" dim={state !== "conectada" && state !== "degradada"} />
                </div>
                <div className="min-w-0">
                  <h2 className="break-words text-2xl font-semibold tracking-tight sm:text-3xl">{agent.data?.terminal_name ?? "Starlink Mini"}</h2>
                  <div className="mt-3">{state ? <StatePill state={state} /> : loading ? <Skeleton className="h-6 w-28" /> : <Badge>Sem comunicação</Badge>}</div>
                  <p className="mt-3 max-w-xs text-sm leading-relaxed text-fg-muted">{status.data && !status.data.available ? status.data.reason : "Telemetria do equipamento pela API local da Starlink."}</p>
                </div>
              </div>
              <p className="flex items-center gap-2 text-xs text-fg-muted"><Clock className="size-3.5 shrink-0" /> Última leitura: {st ? fmtDateTime(Date.parse(st.observed_at) / 1000) : "aguardando dados"}</p>
            </div>
            <div className="flex flex-col justify-center gap-3 border-t border-border bg-bg-elev/40 p-5 sm:p-6 lg:border-l lg:border-t-0">
              <h2 className="mb-1 text-sm font-semibold">Condições de recepção</h2>
              {[
                { icon: RadioTower, label: "Sinal de rádio", value: signal === true ? "Acima do piso de ruído" : signal === false ? "Abaixo do piso de ruído" : "Não informado", ok: signal === true, warn: signal === false, note: "Indicador reportado pela antena" },
                { icon: Radar, label: "Visibilidade do céu", value: obstructed === true ? "Obstrução neste momento" : obstructed === false ? "Sem obstrução no momento" : "Não informada", ok: obstructed === false, warn: obstructed === true, note: "Condição na última leitura" },
                { icon: Navigation, label: "Posicionamento GPS", value: gps === true ? "Posição válida" : gps === false ? "Sem posição válida" : "Não informado", ok: gps === true, warn: gps === false, note: num(m?.gps_sats?.value) !== null ? `${fmtNumber(num(m?.gps_sats?.value)!, 0)} satélites GPS em uso` : "Satélites GPS não informados" },
              ].map(({ icon: Icon, label, value, ok, warn, note }) => (
                <div key={label} className="flex items-center gap-3 rounded-md border border-border bg-surface/70 p-3.5">
                  <span className={`grid size-10 shrink-0 place-items-center rounded-md ${!stale && ok ? "bg-ok/10 text-ok" : warn ? "bg-warn/10 text-warn" : "bg-surface-3 text-fg-muted"}`}><Icon className="size-5" /></span>
                  <div className="min-w-0 flex-1"><p className="text-xs text-fg-muted">{label}</p>{loading ? <Skeleton className="mt-1 h-5 w-32" /> : <p className="mt-0.5 text-sm font-medium">{value}</p>}<p className="mt-0.5 text-[11px] text-fg-subtle">{note}</p></div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile label="Tempo ligada" icon={<Clock />} color="blue" value={uptime === null ? "—" : fmtDuration(uptime)} source={m?.uptime_s?.source ?? unavailable} loading={loading} footer="Desde a última reinicialização" />
          <StatTile label="Latência até o PoP" icon={<Activity />} color="blue" value={num(m?.pop_latency_ms?.value) === null ? "—" : fmtNumber(num(m?.pop_latency_ms?.value)!, 0)} unit="ms" source={m?.pop_latency_ms?.source ?? unavailable} loading={loading} footer="Tempo de resposta da rede Starlink" />
          <StatTile
            label="Obstrução"
            icon={<Radar />}
            color="amber"
            value={obst === null ? "—" : fmtPct(obst, 2)}
            source={m?.obstruction_pct?.source ?? unavailable}
            loading={loading}
            tone={obst !== null && obst > 5 ? "warn" : undefined}
            footer={
              <Link href={hrefOf(base, "obstrucoes")} className="text-accent hover:underline">
                Ver mapa do céu
              </Link>
            }
          />
          <StatTile
            label="Última potência registrada"
            icon={<Zap />}
            color="green"
            value={lastPower === null ? "—" : fmtNumber(lastPower, 1)}
            unit={lastPower === null ? undefined : "W"}
            source={lastPower === null ? (tel.data ? "indisponivel" : null) : tel.data?.source === "demonstracao" ? "demonstracao" : "real"}
            loading={!tel.data && !tel.error}
            footer={lastPower === null ? "Não informado por este firmware" : "Entrada de energia (power_in)"}
          />
        </div>

        <div className="grid items-start gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Card className="min-w-0">
          <CardHeader title="Histórico de energia" icon={<Zap />} subtitle="Potência de entrada reportada pela antena · watts" />
          <CardBody>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-fg-muted">Selecione o período</p>
              <RangeTabs value={range} onChange={setRange} options={[{ value: "1h", label: "1h" }, { value: "6h", label: "6h" }, { value: "24h", label: "24h" }, { value: "7d", label: "7d" }]} />
            </div>
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

        <Card className="min-w-0">
          <CardHeader title="Saúde do equipamento" icon={<ShieldCheck />} subtitle="Alertas reportados na última comunicação" />
          <CardBody>
            {loading ? <Skeleton className="h-24 w-full" /> : !st ? <EmptyState title="Aguardando a antena" className="py-6">Os alertas aparecerão quando houver uma leitura disponível.</EmptyState> : (
              <Callout tone={stale || st.alerts.length ? "warn" : "ok"} title={stale ? "Leitura desatualizada" : st.alerts.length ? `${st.alerts.length} alerta(s) da antena` : "Nenhum alerta reportado"}>
                {st.alerts.length ? <ul className="list-inside list-disc break-words">{st.alerts.map((alert) => <li key={alert}>{alert}</li>)}</ul> : "A última leitura não contém alertas do equipamento."}
              </Callout>
            )}
            <p className="mt-3 text-xs leading-relaxed text-fg-subtle">A API local não informa temperatura ou modo de energia. Superaquecimento, quando reportado, aparece nos alertas.</p>
            <div className="mt-5 space-y-2 border-t border-border pt-4">
              {[
                { slug: "obstrucoes" as const, title: "Explorar o mapa do céu", text: "Confira a visibilidade e as obstruções.", icon: Radar },
                { slug: "diagnosticos" as const, title: "Abrir diagnósticos", text: "Investigue a comunicação com a antena.", icon: Activity },
              ].map(({ slug, title, text, icon: Icon }) => (
                <Link key={slug} href={hrefOf(base, slug)} className="group flex items-center gap-3 rounded-md p-3 transition-colors hover:bg-surface-2">
                  <Icon className="size-5 shrink-0 text-accent" /><div className="flex-1"><p className="text-sm font-medium">{title}</p><p className="mt-0.5 text-xs text-fg-muted">{text}</p></div><ArrowRight className="size-4 text-fg-subtle group-hover:text-accent" />
                </Link>
              ))}
            </div>
          </CardBody>
        </Card>
        </div>

        <div className="grid items-start gap-5 xl:grid-cols-[1fr_1.6fr]">
        <Card className="min-w-0">
          <CardHeader title="Identificação do terminal" icon={<Cpu />} subtitle="Hardware, software e comunicação local" />
          <CardBody>
            {agent.error && <QueryError error={agent.error} onRetry={() => agent.refetch()} />}
            <dl className="divide-y divide-border text-sm">
              {[
                ["Hardware", st?.device.hardware_version ?? agent.data?.hardware ?? "Não identificado"],
                ["Firmware", st?.device.software_version ?? agent.data?.firmware ?? "Não identificado"],
                ["Reinicializações", st?.device.bootcount != null ? fmtNumber(st.device.bootcount, 0) : "Não informado"],
                ["Endereço consultado", agent.data?.dish_target ?? "—"],
              ].map(([label, value]) => (
                <div key={label} className="py-3"><dt className="text-xs text-fg-muted">{label}</dt><dd className="mt-1 break-all font-mono text-xs leading-relaxed">{value}</dd></div>
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
                    <li key={t.key} className="border-b border-border py-3">
                      <p className="text-xs text-fg-muted">{t.label}</p>
                      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2"><span className="tabular text-sm font-medium">{techValue(metric.value, metric.unit, t.fmt)}</span><SourceBadge source={metric.source} /></div>
                    </li>
                  );
                })}
              </ul>
            )}
            {st && st.fields_missing.length > 0 && (
              <details className="mt-4 rounded-lg border border-border bg-surface-2/40 p-3">
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
        <p className="text-xs text-fg-subtle">Leituras da API local. Valores ausentes são indicados por “—”; a origem dos dados acompanha cada indicador.</p>
      </div>
    </>
  );
}
