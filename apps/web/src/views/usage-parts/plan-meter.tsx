"use client";

import type { UsagePlan } from "@astryon/shared";
import { Gauge } from "lucide-react";
import Link from "next/link";
import { SourceBadge } from "@/components/domain";
import { Badge, Skeleton } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { CLOUD } from "@/lib/cloud-flag";
import { useBasePath } from "@/lib/demo-context";
import { fmtBytesStr, fmtDay, fmtNumber } from "@/lib/format";

/**
 * Medidor da franquia do ciclo: consumo (barra cheia), projeção no fim do ciclo (trecho tracejado até a marca) e as
 * réguas de 80% e 100%. A cor diz o estado do ciclo, não o quanto encheu: estourou = vermelho; vai estourar ou passou
 * de 80% = amarelo; dentro do previsto = azul. Fica dentro do painel de veredito da tela Consumo.
 */
export function PlanCard({ p, className }: { p: UsagePlan | undefined; className?: string }) {
  const base = useBasePath();
  if (!p) return <Skeleton className={cn("h-24 w-full", className)} />;
  const settingsHref = `${base}/configuracoes#plano`;
  if (!p.configured) {
    return (
      <div className={cn("flex flex-wrap items-center gap-3 rounded-md border border-dashed border-border-strong px-3.5 py-3", className)}>
        <Gauge className="size-5 shrink-0 text-fg-muted" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">Franquia do plano não configurada</p>
          <p className="text-xs text-fg-subtle">Informe a franquia mensal e o dia de virada do ciclo para acompanhar o consumo e receber alertas em 80% e 100%.</p>
        </div>
        {!CLOUD && (
          <Link href={settingsHref} className="text-sm font-medium text-accent hover:underline">
            Configurar
          </Link>
        )}
      </div>
    );
  }
  const pct = p.pct_used;
  const proj = p.projected_pct;
  const projOver = proj !== null && proj >= 100;
  const tone = pct === null ? "neutral" : pct >= 100 ? "crit" : pct >= 80 || projOver ? "warn" : "fill";
  const bar = { neutral: "bg-fg-subtle", fill: "bg-accent-2", warn: "bg-warn", crit: "bg-crit" }[tone];
  const used = Math.min(100, pct ?? 0);
  const projEnd = proj === null ? null : Math.min(100, proj);
  return (
    <div className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="tabular text-[24px] font-medium leading-none tracking-[-0.03em] text-fg">{pct === null ? "—" : `${p.lower_bound ? "≥ " : ""}${fmtNumber(pct, 1)}%`}</span>
          <span className="tabular text-sm text-fg-muted">
            {fmtBytesStr(p.used.bytes_total)} de {fmtBytesStr(p.cap_bytes)}
          </span>
        </p>
        <p className="flex items-center gap-2 text-[11px] text-fg-subtle">
          <span className="tabular">
            ciclo {fmtDay(p.cycle_start)} – {fmtDay(p.cycle_end - 1)} · faltam {fmtNumber(p.days_remaining, 1)} dias
          </span>
          <SourceBadge source={p.source} />
        </p>
      </div>

      <div className="relative mt-3 pb-4">
        <div className="relative h-3 overflow-hidden rounded-[3px] bg-surface-3" role="progressbar" aria-label="Franquia consumida" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(used)}>
          {projEnd !== null && projEnd > used && (
            <div
              aria-hidden
              className={cn("absolute inset-y-0 border-y border-r border-dashed", projOver ? "border-warn/80 bg-warn/10" : "border-accent/60 bg-accent/10")}
              style={{ left: `${used}%`, width: `${projEnd - used}%` }}
            />
          )}
          <div className={cn("relative h-full", bar)} style={{ width: `${used}%` }} />
        </div>
        {/* Réguas: 80% (aviso) e 100% (franquia). */}
        {[80, 100].map((mark) => (
          <span key={mark} aria-hidden className="absolute top-0 flex -translate-x-full flex-col items-end" style={{ left: `${mark}%` }}>
            <span className="h-3 w-px bg-fg-subtle" />
            <span className="tabular mt-0.5 text-[10px] text-fg-subtle">{mark}%</span>
          </span>
        ))}
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-fg-muted">
        {p.remaining_bytes !== null && (
          <span>
            Restante estimado: <span className="tabular text-fg">{fmtBytesStr(p.remaining_bytes)}</span>
          </span>
        )}
        {p.projection?.available ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <span>
              Projeção no fim do ciclo: <span className="tabular text-fg">{fmtBytesStr(p.projection.bytes_total)}</span> (<span className="tabular">{fmtNumber(proj, 0)}%</span>)
            </span>
            {projOver && <Badge tone="warn">deve ultrapassar</Badge>}
          </span>
        ) : (
          <span>{p.projection?.reason ?? "Projeção indisponível."}</span>
        )}
      </div>
      {p.lower_bound && pct !== null && (
        <p className="mt-1.5 text-xs text-fg-subtle">Houve períodos sem observação neste ciclo ({fmtNumber(p.used.coverage * 100, 0)}% de cobertura), então o consumo real pode ser maior.</p>
      )}
    </div>
  );
}
