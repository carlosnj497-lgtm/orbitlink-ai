"use client";

import type { ObstructionResponse, StatusResponse } from "@orbitlink/shared";
import { Radar } from "lucide-react";
import { ObstructionGrid } from "@/components/charts";
import { CAP_META, MetricCard, PageHeader, QueryError, SourceBadge } from "@/components/domain";
import { Badge, Card, CardBody, CardHeader, EmptyState, Skeleton } from "@/components/ui/primitives";
import { useAgent, useStatusInterval } from "@/lib/api";
import { fmtDateTime, fmtDuration, fmtPct } from "@/lib/format";

export default function ObstructionsView() {
  const status = useAgent<StatusResponse>("status", { refetchInterval: useStatusInterval(30_000) });
  const q = useAgent<ObstructionResponse>("obstruction?range=7d", { refetchInterval: 300_000 });
  const m = status.data?.available ? status.data.status.metrics : undefined;
  const pct = typeof m?.obstruction_pct?.value === "number" ? m.obstruction_pct.value : null;
  const valid = typeof m?.obstruction_valid_s?.value === "number" ? m.obstruction_valid_s.value : null;
  const cap = q.data?.map_capability;

  return (
    <>
      <PageHeader title="Obstruções" icon={<Radar />} description="Estatística e mapa de obstrução exibidos somente quando o firmware os fornece." />
      {q.error && <QueryError error={q.error} />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard label="Tempo obstruído" value={fmtPct(pct, 2)} source={m?.obstruction_pct?.source ?? (status.data ? "indisponivel" : null)} loading={!status.data} footer={valid !== null ? `Janela da estatística: ${fmtDuration(valid)}` : undefined} />
        <MetricCard
          label="Obstruída agora"
          value={m?.currently_obstructed ? (m.currently_obstructed.value ? "Sim" : "Não") : "—"}
          source={m?.currently_obstructed?.source ?? (status.data ? "indisponivel" : null)}
          loading={!status.data}
          tone={m?.currently_obstructed?.value ? "warn" : undefined}
        />
        <MetricCard label="Mapa de obstrução" value={cap ? CAP_META[cap.status].label : "—"} loading={!q.data} footer={cap?.detail ?? (cap ? undefined : "Matriz de capacidades ainda não verificada.")} />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Mapa do céu" actions={q.data?.map && <SourceBadge source={q.data.map.source} />} subtitle={q.data?.map ? `Capturado em ${fmtDateTime(q.data.map.ts)}` : undefined} />
          <CardBody className="flex flex-col items-center">
            {!q.data && <Skeleton className="aspect-square w-full max-w-[420px]" />}
            {q.data && !q.data.map && (
              <EmptyState icon={<Radar />} title="Mapa indisponível">
                {cap?.status === "verificada"
                  ? "Aguardando a primeira captura (a cada ~5 min)."
                  : "Este firmware não forneceu o mapa via API local ou a antena não está acessível. Nenhum mapa ilustrativo é exibido no modo real."}
              </EmptyState>
            )}
            {q.data?.map && (
              <>
                <ObstructionGrid rows={q.data.map.num_rows} cols={q.data.map.num_cols} snr={q.data.map.snr} />
                <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                  <Badge tone="accent">céu livre</Badge>
                  <Badge tone="warn">sinal parcial</Badge>
                  <Badge tone="crit">obstruído</Badge>
                  <Badge>sem dado</Badge>
                </div>
              </>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Tendência por hora (7 d)" subtitle="Média da fração obstruída informada no status" />
          <CardBody>
            {q.data && !q.data.trend.length && <EmptyState title="Sem histórico de obstrução" />}
            {q.data && q.data.trend.length > 0 && (
              <ul className="max-h-80 space-y-1 overflow-y-auto pr-1">
                {q.data.trend.slice(-72).reverse().map((t) => (
                  <li key={t.t} className="flex items-center gap-2 text-xs">
                    <span className="w-28 tabular text-fg-subtle">{fmtDateTime(t.t)}</span>
                    <div className="h-2 flex-1 rounded-sm bg-surface-2">
                      <div className="h-full rounded-sm bg-warn/70" style={{ width: `${Math.min(100, (t.obstruction_pct ?? 0) * 5)}%` }} />
                    </div>
                    <span className="w-14 text-right tabular">{fmtPct(t.obstruction_pct, 2)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[11px] text-fg-subtle">Correlação com quedas não implica causalidade; veja Interrupções para cruzar horários.</p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
