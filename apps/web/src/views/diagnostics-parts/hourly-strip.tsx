"use client";

import type { QualityHour } from "@astryon/shared";
import { cn } from "@/lib/cn";
import { fmtDuration, fmtNumber, fmtPct } from "@/lib/format";

/** Mesma marca da tela Qualidade: hora com perda média de 2% ou mais. */
export const HIGH_LOSS = 2;

/**
 * Evidência compacta: uma barra por hora do dia com a perda média (escala fixa até 5%).
 * Prata = dentro do normal; amarelo = hora com perda alta; contorno tracejado = hora sem observação.
 */
export function HourlyLossStrip({ hours, mark = [] }: { hours: QualityHour[]; /** Horas acima da média do dia (abaixo de 2%), com contorno âmbar. */ mark?: number[] }) {
  const worst = hours.filter((h) => h.observed_seconds > 0 && h.loss_pct !== null && h.loss_pct >= HIGH_LOSS).map((h) => h.hour);
  return (
    <figure className="max-w-xl">
      <div className="flex h-14 items-end gap-[3px]" role="img" aria-label={`${worst.length ? `Horas com perda de 2% ou mais: ${worst.map((h) => `${h}h`).join(", ")}` : "Nenhuma hora com perda média de 2% ou mais"}${mark.length ? `. Acima da média do dia: ${mark.map((h) => `${h}h`).join(", ")}` : ""}`}>
        {hours.map((h) => {
          const seen = h.observed_seconds > 0 && h.loss_pct !== null;
          const v = seen ? Math.min(5, h.loss_pct ?? 0) : 0;
          return (
            <div
              key={h.hour}
              title={seen ? `${String(h.hour).padStart(2, "0")}h: perda ${fmtPct(h.loss_pct, 2)}, latência ${fmtNumber(h.latency_avg_ms, 1)} ms, observado ${fmtDuration(h.observed_seconds)}` : `${String(h.hour).padStart(2, "0")}h: sem observação`}
              className={cn(
                "min-w-0 flex-1 rounded-[2px]",
                !seen ? "h-full border border-dashed border-border-strong" : (h.loss_pct ?? 0) >= HIGH_LOSS ? "bg-warn" : mark.includes(h.hour) ? "border border-warn bg-warn/40" : "bg-fg-muted/45",
              )}
              style={seen ? { height: `${Math.max(6, (v / 5) * 100)}%` } : undefined}
            />
          );
        })}
      </div>
      <div className="tabular mt-1 flex justify-between text-[10px] text-fg-subtle" aria-hidden>
        <span>0h</span>
        <span>6h</span>
        <span>12h</span>
        <span>18h</span>
        <span>23h</span>
      </div>
      <figcaption className="mt-1.5 text-[11px] text-fg-subtle">
        Perda média por hora do dia, escala fixa até 5%. Amarelo sólido: 2% ou mais.{mark.length > 0 && " Contorno amarelo: abaixo de 2%, mas pelo menos o dobro da mediana do dia."} Tracejado: hora sem observação.
      </figcaption>
    </figure>
  );
}
