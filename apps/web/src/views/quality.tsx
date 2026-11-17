"use client";

import type { Quality, Telemetry, WeatherHourly } from "@astryon/shared";
import { CloudRain, Gauge, Info } from "lucide-react";
import { useMemo, useState } from "react";
import { TelemetryChart } from "@/components/charts";
import { CoverageBar, PageHeader, QueryError, SourceBadge } from "@/components/domain";
import { BestHoursCard, CompareCard } from "@/components/insights";
import { CLOUD } from "@/lib/cloud-flag";
import { Card, CardBody, CardHeader, EmptyState, Skeleton, Tip } from "@/components/ui/primitives";
import { useAgent } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fmtDuration, fmtNumber, fmtPct } from "@/lib/format";
import { useDisplayTimezone } from "@/lib/timezone";
import { rainBands } from "@/lib/weather";
import { type Figure, Verdict } from "./overview-parts/verdict";
import { HIGH_LOSS, qualityVerdict } from "./quality-parts/quality-verdict";
import { GapNote, RangeTabs } from "./shared";

/** Intensidade em azul por escala absoluta (0–5%): uma hora com 0,1% de perda não pode parecer um problema. */
function heat(v: number | null) {
  if (v === null) return "var(--surface-2)";
  const k = Math.min(1, v / 5);
  return `rgb(0 140 255 / ${0.06 + k * 0.74})`;
}

export default function QualityView() {
  const [range, setRange] = useState("24h");
  const q = useAgent<Quality>(`quality?range=${range}`, { refetchInterval: 60_000 });
  const tel = useAgent<Telemetry>(`telemetry?range=${range}`, { refetchInterval: 60_000 });
  const wx = useAgent<WeatherHourly>(`weather/hourly?range=${range}`, { refetchInterval: 15 * 60_000 });
  const d = q.data;
  const tz = useDisplayTimezone();
  const rain = useMemo(() => (tel.data && wx.data ? rainBands(wx.data.hours, tel.data.start, tel.data.end) : []), [tel.data, wx.data]);
  const v = d ? qualityVerdict(d, range) : null;

  const figures: Figure[] = [
    { key: "avail", label: "No ar (disponibilidade)", value: fmtNumber(d?.availability_pct, 2), unit: d?.availability_pct != null ? "%" : undefined, tone: d?.availability_pct != null && d.availability_pct < 99 ? "warn" : undefined, note: d ? `Do tempo observado (${fmtNumber(d.coverage * 100, 0)}% do período)` : undefined },
    { key: "loss", label: "Perda média", value: fmtNumber(d?.loss_pct, 2), unit: d?.loss_pct != null ? "%" : undefined, tone: d?.loss_pct != null && d.loss_pct >= HIGH_LOSS ? "warn" : undefined, note: d ? `Sem resposta por ${fmtDuration(d.full_drop_seconds)}` : undefined },
    { key: "p50", label: "Latência mediana (p50)", value: fmtNumber(d?.latency_p50_ms, 1), unit: d?.latency_p50_ms != null ? "ms" : undefined, note: "Até o PoP da Starlink" },
    { key: "p95", label: "Latência dos 5% piores (p95)", value: fmtNumber(d?.latency_p95_ms, 1), unit: d?.latency_p95_ms != null ? "ms" : undefined, note: d?.latency_max_ms != null ? `Máxima ${fmtNumber(d.latency_max_ms, 0)} ms` : undefined },
    { key: "jitter", label: "Variação (jitter)", value: fmtNumber(d?.jitter_ms, 2), unit: d?.jitter_ms != null ? "ms" : undefined, note: d?.jitter_ms != null ? "Calculado das amostras (estimativa)" : "Não calculado" },
  ];

  return (
    <>
      <PageHeader
        title="Qualidade da Conexão"
        icon={<Gauge />}
        description="Latência e perda medidas pela própria antena até o PoP da Starlink. Lacunas de observação ficam fora dos cálculos."
        actions={<RangeTabs value={range} onChange={setRange} />}
      />
      {q.error && (
        <div className="mb-4">
          <QueryError error={q.error} onRetry={() => q.refetch()} />
        </div>
      )}

      <Verdict
        label="A conexão é estável e quando piora?"
        tone={v?.tone ?? "unknown"}
        word={v?.word}
        loading={!d && !q.error}
        headline={v?.headline ?? (q.error ? "Não foi possível consultar a qualidade da conexão agora." : null)}
        detail={v?.detail}
        figures={figures}
        meta={
          d && (
            <>
              <span>
                Observado: <span className="tabular text-fg-muted">{fmtDuration(d.observed_seconds)}</span>
              </span>
              <GapNote gaps={d.gaps} />
              <span className="ml-auto flex items-center gap-3">
                <CoverageBar coverage={d.coverage} />
                <SourceBadge source={d.source} />
                <Tip content={`${d.availability_note} ${d.latency_note} ${d.jitter_note}`}>
                  <button type="button" aria-label="Como estes números são calculados" className="text-fg-subtle hover:text-fg">
                    <Info className="size-3.5" />
                  </button>
                </Tip>
              </span>
            </>
          )
        }
      />

      {/* Evidência 1: quando piora (responde a segunda metade da pergunta). */}
      <Card className="mb-4">
        <CardHeader title="Quando piora: perda por hora do dia" subtitle={`Média do período, no horário de ${d?.timezone ?? tz}`} />
        <CardBody>
          {!d && <Skeleton className="h-24 w-full" />}
          {d && d.observed_seconds === 0 && <EmptyState title="Ainda não há observações suficientes" />}
          {d && d.observed_seconds > 0 && (
            <div className="overflow-x-auto">
              <div className="grid min-w-[640px] gap-1" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>
                {d.by_hour.map((h) => {
                  const high = h.loss_pct !== null && h.loss_pct >= HIGH_LOSS;
                  return (
                    <Tip key={h.hour} content={h.observed_seconds ? `${String(h.hour).padStart(2, "0")}h: perda ${fmtPct(h.loss_pct, 2)}, latência ${fmtNumber(h.latency_avg_ms, 1)} ms, observado ${fmtDuration(h.observed_seconds)}` : `${String(h.hour).padStart(2, "0")}h: sem observação`}>
                      <div tabIndex={0} className="flex flex-col items-center gap-1" aria-label={`${h.hour}h: ${h.observed_seconds ? `perda ${fmtPct(h.loss_pct, 2)}` : "sem observação"}`}>
                        <div
                          className={cn("h-14 w-full rounded-[3px] border", high ? "border-crit" : "border-border")}
                          style={{ background: h.observed_seconds ? heat(h.loss_pct) : "repeating-linear-gradient(45deg,var(--surface-2) 0 3px,transparent 3px 6px)" }}
                        />
                        <span className={cn("tabular text-[10px]", high ? "text-fg" : "text-fg-subtle")}>{String(h.hour).padStart(2, "0")}</span>
                      </div>
                    </Tip>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] text-fg-subtle">Azul mais intenso = maior perda média (escala fixa até 5%). Contorno vermelho = perda de {HIGH_LOSS}% ou mais. Hachurado = hora sem observação.</p>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Evidência 2: as séries do período. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {(["latency", "loss"] as const).map((mode) => (
          <Card key={mode}>
            <CardHeader title={mode === "latency" ? "Latência até o PoP" : "Perda de ping ao PoP"} actions={tel.data && <SourceBadge source={tel.data.source} />} />
            <CardBody>
              {tel.isLoading && <Skeleton className="h-56 w-full" />}
              {tel.error && <QueryError error={tel.error} onRetry={() => tel.refetch()} />}
              {tel.data && !tel.data.points.length && <EmptyState title="Sem amostras no período" />}
              {tel.data && tel.data.points.length > 0 && <TelemetryChart points={tel.data.points} mode={mode} start={tel.data.start} end={tel.data.end} gaps={tel.data.gaps} rain={rain} height={220} />}
            </CardBody>
          </Card>
        ))}
      </div>

      {rain.length > 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-fg-subtle">
          <CloudRain className="size-3.5 text-accent" aria-hidden />
          Faixas azuis: horas com chuva estimada para a sua cidade (quanto mais forte, mais intensa). Mostram coincidência com a conexão, não causa.
        </p>
      )}

      {/* Evidência 3: comparação com o período anterior e horários bons. */}
      {!CLOUD && (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <CompareCard range={range === "1h" || range === "6h" ? "24h" : range} />
          <BestHoursCard />
        </div>
      )}
    </>
  );
}
