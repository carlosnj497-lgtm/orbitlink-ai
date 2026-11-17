"use client";

import type { ObstructionResponse, StatusResponse } from "@astryon/shared";
import { ArrowRight, Radar } from "lucide-react";
import Link from "next/link";
import { ObstructionGrid } from "@/components/charts";
import { CAP_META, PageHeader, QueryError, SourceBadge } from "@/components/domain";
import { hrefOf } from "@/components/shell/nav";
import { Card, CardBody, CardHeader, EmptyState, Skeleton } from "@/components/ui/primitives";
import { useAgent, useStatusInterval } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useBasePath } from "@/lib/demo-context";
import { fmtDateTime, fmtDuration, fmtPct } from "@/lib/format";
import { SectionHead } from "./antenna-parts/section";
import { type PartState, StateLight, SystemDiagram } from "./antenna-parts/system-diagram";

/** Acima disto a fração obstruída pede atenção (mesmo limite da tela Antena). */
const LIMIT = 5;

/** Cores iguais às do mapa (canvas): céu livre, sinal parcial, obstruído, sem dado. */
const MAP_KEY = [
  { label: "céu livre", swatch: "bg-[rgb(56_189_248/0.55)]" },
  { label: "sinal parcial", swatch: "bg-[rgb(232_185_49/0.75)]" },
  { label: "obstruído", swatch: "bg-[rgb(255_70_85/0.9)]" },
  { label: "sem dado", swatch: "border border-border-strong bg-bg-elev" },
];

function Fact({ label, state, value, note, numeric }: { label: string; state: PartState; value: string; note?: string; numeric?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="min-w-0 text-sm text-fg-muted">
        {label}
        {note && <span className="mt-0.5 block text-[11px] text-fg-subtle">{note}</span>}
      </dt>
      <dd className={cn("flex items-center gap-2 text-right text-sm font-medium", state === "warn" ? "text-warn" : state === "crit" ? "text-crit" : "text-fg")}>
        <StateLight state={state} label="" className="gap-0" />
        <span className={numeric ? "tabular" : undefined}>{value}</span>
      </dd>
    </div>
  );
}

/** Tendência por hora: uma coluna por hora; hora sem dado fica tracejada (nunca vira zero). */
function TrendBars({ trend }: { trend: ObstructionResponse["trend"] }) {
  const shown = trend.slice(-72);
  const max = Math.max(LIMIT * 1.5, ...shown.map((t) => t.obstruction_pct ?? 0));
  const limitPos = (LIMIT / max) * 100;
  return (
    <div>
      <div className="relative h-36" aria-hidden>
        <div className="absolute inset-x-0 border-t border-dashed border-warn/50" style={{ bottom: `${limitPos}%` }}>
          <span className="ol-label absolute -top-4 right-0 text-warn/80">limite {LIMIT}%</span>
        </div>
        <div className="absolute inset-0 flex items-end gap-px border-b border-border-strong">
          {shown.map((t) => (
            <div key={t.t} className="flex h-full min-w-0 flex-1 items-end" title={`${fmtDateTime(t.t)} · ${t.obstruction_pct === null ? "sem dado" : fmtPct(t.obstruction_pct, 2)}`}>
              {t.obstruction_pct === null ? (
                <div className="h-full w-full border border-dashed border-border/70" />
              ) : (
                <div className={cn("w-full rounded-t-[1px]", t.obstruction_pct > LIMIT ? "bg-warn/80" : "bg-fg-muted/45")} style={{ height: `${Math.max(1.5, (t.obstruction_pct / max) * 100)}%` }} />
              )}
            </div>
          ))}
        </div>
      </div>
      {shown.length > 0 && (
        <div className="mt-1.5 flex justify-between text-[10.5px] text-fg-subtle">
          <span className="tabular">{fmtDateTime(shown[0].t)}</span>
          <span className="tabular">{fmtDateTime(shown[shown.length - 1].t)}</span>
        </div>
      )}
    </div>
  );
}

export default function ObstructionsView() {
  const base = useBasePath();
  const status = useAgent<StatusResponse>("status", { refetchInterval: useStatusInterval(30_000) });
  const q = useAgent<ObstructionResponse>("obstruction?range=7d", { refetchInterval: 300_000 });
  const m = status.data?.available ? status.data.status.metrics : undefined;
  const pct = typeof m?.obstruction_pct?.value === "number" ? m.obstruction_pct.value : null;
  const valid = typeof m?.obstruction_valid_s?.value === "number" ? m.obstruction_valid_s.value : null;
  const now = m?.currently_obstructed;
  const cap = q.data?.map_capability;
  const capTone = cap ? CAP_META[cap.status].tone : null;

  return (
    <>
      <PageHeader title="Obstruções" icon={<Radar />} description="Estatística e mapa de obstrução exibidos somente quando o firmware os fornece." />
      {q.error && (
        <div className="mb-4">
          <QueryError error={q.error} onRetry={() => q.refetch()} />
        </div>
      )}

      <SystemDiagram current="ceu" />

      {/* ---------------------------------------------------------- Mapa do céu (principal) + agora */}
      <section aria-labelledby="ceu-t" className="mb-8">
        <SectionHead id="ceu-t" title="O céu visto pela antena">
          Mapa capturado pela antena e a estatística da última leitura
        </SectionHead>
        <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <Card className="min-w-0">
            <CardHeader title="Mapa do céu" icon={<Radar />} actions={q.data?.map && <SourceBadge source={q.data.map.source} />} subtitle={q.data?.map ? `Capturado em ${fmtDateTime(q.data.map.ts)}` : undefined} />
            <CardBody className="flex flex-col items-center">
              {!q.data && !q.error && <Skeleton className="aspect-square w-full max-w-[480px]" />}
              {q.data && !q.data.map && (
                <EmptyState icon={<Radar />} title="Mapa indisponível" className="min-h-72">
                  {cap?.status === "verificada"
                    ? "Aguardando a primeira captura (a cada ~5 min)."
                    : "Este firmware não forneceu o mapa via API local ou a antena não está acessível. Nenhum mapa ilustrativo é exibido no modo real."}
                </EmptyState>
              )}
              {q.data?.map && (
                <>
                  <ObstructionGrid rows={q.data.map.num_rows} cols={q.data.map.num_cols} snr={q.data.map.snr} className="aspect-square w-full max-w-[480px]" />
                  <ul className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-xs text-fg-muted" aria-label="Legenda do mapa">
                    {MAP_KEY.map((k) => (
                      <li key={k.label} className="flex items-center gap-1.5">
                        <span className={cn("size-2.5 rounded-[2px]", k.swatch)} aria-hidden />
                        {k.label}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </CardBody>
          </Card>

          <Card className="min-w-0">
            <CardHeader title="Agora" subtitle="Estatística informada no status da antena" actions={m?.obstruction_pct && <SourceBadge source={m.obstruction_pct.source} />} />
            <CardBody>
              {!status.data ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <dl className="divide-y divide-border/60">
                  <Fact label="Tempo obstruído" note={valid !== null ? `Janela da estatística: ${fmtDuration(valid)}` : "Janela da estatística não informada"} state={pct === null ? "off" : pct > LIMIT ? "warn" : "ok"} value={pct === null ? "sem leitura" : fmtPct(pct, 2)} numeric={pct !== null} />
                  <Fact label="Obstruída agora" state={!now ? "off" : now.value ? "warn" : "ok"} value={!now ? "sem leitura" : now.value ? "Sim" : "Não"} />
                  <Fact
                    label="Mapa de obstrução"
                    note={cap?.detail ?? (cap ? undefined : "Matriz de capacidades ainda não verificada.")}
                    state={!cap ? "off" : capTone === "ok" ? "ok" : capTone === "warn" ? "warn" : capTone === "crit" ? "crit" : "off"}
                    value={cap ? CAP_META[cap.status].label : q.data ? "—" : "lendo"}
                  />
                </dl>
              )}
              <p className="mt-3 text-xs leading-relaxed text-fg-subtle">Acima de {LIMIT}% do tempo obstruído o valor fica amarelo, o mesmo limite usado em Antena e Sinal.</p>
            </CardBody>
          </Card>
        </div>
      </section>

      {/* ---------------------------------------------------------- Tendência */}
      <section aria-labelledby="tendencia-t">
        <SectionHead id="tendencia-t" title="Tendência por hora (72 h)">
          Média da fração obstruída informada no status, últimas 72 horas
        </SectionHead>
        <Card>
          <CardBody className="pt-4">
            {!q.data && !q.error && <Skeleton className="h-36 w-full" />}
            {q.data && !q.data.trend.length && <EmptyState title="Sem histórico de obstrução">O histórico aparece depois das primeiras horas de coleta.</EmptyState>}
            {q.data && q.data.trend.length > 0 && (
              <>
                <TrendBars trend={q.data.trend} />
                <details className="mt-4 rounded-md border border-border px-3 py-2">
                  <summary className="cursor-pointer text-xs text-fg-muted">Ver os valores hora a hora</summary>
                  <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto pr-1">
                    {q.data.trend
                      .slice(-72)
                      .reverse()
                      .map((t) => (
                        <li key={t.t} className="flex items-center justify-between gap-3 text-xs">
                          <span className="tabular text-fg-subtle">{fmtDateTime(t.t)}</span>
                          <span className={cn("tabular", t.obstruction_pct === null ? "text-fg-subtle" : t.obstruction_pct > LIMIT ? "text-warn" : "text-fg")}>{t.obstruction_pct === null ? "sem dado" : fmtPct(t.obstruction_pct, 2)}</span>
                        </li>
                      ))}
                  </ul>
                </details>
              </>
            )}
            <p className="mt-3 flex flex-wrap items-center gap-x-2 text-[11px] text-fg-subtle">
              Correlação com quedas não implica causalidade; veja Interrupções para cruzar horários.
              <Link href={hrefOf(base, "interrupcoes")} className="inline-flex items-center gap-1 text-accent hover:underline">
                Abrir Interrupções <ArrowRight className="size-3" aria-hidden />
              </Link>
            </p>
          </CardBody>
        </Card>
      </section>
    </>
  );
}
