"use client";

import type { Source, TelemetryPoint } from "@astryon/shared";
import { CircleCheck, CircleHelp, CircleX, Info, TriangleAlert } from "lucide-react";
import { memo, type ReactNode, useId } from "react";
import { SourceBadge } from "@/components/domain";
import { Card, Skeleton, Tip } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { bucketMeans, sparkGeometry } from "@/lib/sparkline";

export function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/* ----------------------------------------------------------------- Card de métrica */
// O ícone do indicador é só identificação, não estado: todos usam o mesmo azul. Estado vai no valor (tone).
const TILE_ICON = "border-border bg-bg-elev text-accent";
const TILE = { green: TILE_ICON, violet: TILE_ICON, blue: TILE_ICON, red: TILE_ICON, amber: TILE_ICON } as const;

export function StatTile({
  label,
  icon,
  color,
  value,
  unit,
  source,
  hint,
  footer,
  tone,
  loading,
  className,
  children,
  wide = false,
}: {
  className?: string;
  /** No celular ocupa a linha inteira: valor à esquerda, descrição e origem à direita, sem sobrar vão. */
  wide?: boolean;
  label: string;
  icon: ReactNode;
  color: keyof typeof TILE;
  value: ReactNode;
  unit?: string;
  source?: Source | null;
  hint?: ReactNode;
  footer?: ReactNode;
  tone?: "ok" | "warn" | "crit";
  loading?: boolean;
  children?: ReactNode;
}) {
  const valueCls = tone === "crit" ? "text-crit" : tone === "warn" ? "text-warn" : "text-fg";
  return (
    <Card className={cn("flex min-w-0 flex-col p-2.5", wide && "max-sm:flex-row max-sm:items-center max-sm:gap-3", className)}>
      <div className={cn("flex items-start gap-2", wide && "max-sm:shrink-0")}>
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-md border [&>svg]:size-4 [&>svg]:stroke-[1.75]", TILE[color])}>{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="ol-label flex items-start gap-1 leading-tight max-sm:font-sans max-sm:text-[11.5px] max-sm:normal-case max-sm:tracking-normal max-sm:text-fg-muted">
            <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
            {hint && (
              <Tip content={hint}>
                <button type="button" aria-label={`Sobre ${label}`} className="shrink-0 text-fg-subtle hover:text-fg">
                  <Info className="size-3" />
                </button>
              </Tip>
            )}
          </p>
          {loading ? (
            <Skeleton className="mt-1.5 h-6 w-20" />
          ) : (
            <p className={cn("mt-0.5 flex items-baseline gap-1 tabular", valueCls)}>
              <span className="text-[19px] font-medium leading-none tracking-[-0.03em]">{value}</span>
              {unit && <span className="text-[11px] font-medium text-fg-muted">{unit}</span>}
            </p>
          )}
        </div>
      </div>
      {children}
      <div className={cn("mt-auto flex flex-col items-start gap-1 pt-1.5", wide && "max-sm:ml-auto max-sm:mt-0 max-sm:items-end max-sm:pt-0 max-sm:text-right")}>
        <span className="text-[11px] leading-snug text-fg-subtle">{footer}</span>
        {source && <SourceBadge source={source} />}
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------------- Minigráfico */
const SPARK_W = 100;
const SPARK_H = 22;
const SPARK_BUCKETS = 60;

/**
 * Minigráfico em SVG puro (bem mais leve que um gráfico completo). Reduz a série a ~60 médias; trechos sem
 * dado ficam em branco — nunca são ligados nem tratados como zero.
 */
export const MiniSpark = memo(function MiniSpark({ data, k, color }: { data: TelemetryPoint[]; k: "down_mbps" | "up_mbps"; color: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const { runs, line, area } = sparkGeometry(bucketMeans(data, (p) => p[k], SPARK_BUCKETS), SPARK_W, SPARK_H);
  return (
    <svg viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} preserveAspectRatio="none" className="mt-1.5 h-5 w-full" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {runs.map((r, i) => (
        <path key={`a${i}`} d={area(r)} fill={`url(#${id})`} />
      ))}
      {runs.map((r, i) => (
        <path key={`l${i}`} d={line(r)} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
});

/* ----------------------------------------------------------------- Linha de estado */
export type RowState = "ok" | "warn" | "fail" | "unknown";

const ROW_ICON = { ok: CircleCheck, warn: TriangleAlert, fail: CircleX, unknown: CircleHelp } as const;
const ROW_ICON_CLS = { ok: "text-ok", warn: "text-warn", fail: "text-crit", unknown: "text-fg-subtle" } as const;
const ROW_VALUE_CLS = { ok: "text-ok", warn: "text-warn", fail: "text-crit", unknown: "text-fg-muted" } as const;
const ROW_SR = { ok: "ok", warn: "atenção", fail: "falha", unknown: "desconhecido" } as const;

export function StateIcon({ state, className }: { state: RowState; className?: string }) {
  const Icon = ROW_ICON[state];
  return (
    <>
      <Icon className={cn("size-4 shrink-0", ROW_ICON_CLS[state], className)} aria-hidden />
      <span className="sr-only">{ROW_SR[state]}: </span>
    </>
  );
}

export function StatusRow({ state, label, value, plain = false }: { state: RowState; label: ReactNode; value: ReactNode; plain?: boolean }) {
  return (
    <li className="flex items-center gap-2.5 py-2 text-sm">
      <StateIcon state={state} />
      <span className="min-w-0 flex-1 truncate text-fg-muted">{label}</span>
      <span className={cn("max-w-[60%] truncate text-right font-medium tabular-nums", plain ? "text-fg" : ROW_VALUE_CLS[state])}>{value}</span>
    </li>
  );
}

/* ----------------------------------------------------------------- Anel de progresso */
const RING_R = 42;
const RING_C = 2 * Math.PI * RING_R;
const RING_STROKE = { ok: "var(--ok)", warn: "var(--warn)", crit: "var(--crit)", neutral: "var(--surface-3)" } as const;

export function Ring({ value, tone, className, children }: { value: number | null; tone: keyof typeof RING_STROKE; className?: string; children?: ReactNode }) {
  const frac = value === null ? 0 : Math.max(0, Math.min(1, value / 100));
  return (
    <div className={cn("relative grid shrink-0 place-items-center", className)}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={RING_R} fill="none" stroke="var(--surface-3)" strokeWidth="7" />
        <circle
          cx="50"
          cy="50"
          r={RING_R}
          fill="none"
          stroke={RING_STROKE[tone]}
          strokeWidth="7"
          strokeLinecap="butt"
          strokeDasharray={`${RING_C * frac} ${RING_C}`}
          className="transition-[stroke-dasharray] duration-500 ease-out"
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}

/** Barras de sinal (0–4), como indicador resumido de qualidade. */
export function SignalBars({ level, tone }: { level: number; tone: "ok" | "warn" | "crit" | "neutral" }) {
  const on = tone === "ok" ? "bg-ok" : tone === "warn" ? "bg-warn" : tone === "crit" ? "bg-crit" : "bg-fg-subtle";
  return (
    <span className="flex items-end gap-[3px]" aria-hidden>
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className={cn("w-[4px] rounded-[1px]", i <= level ? on : "bg-surface-3")} style={{ height: 6 + i * 5 }} />
      ))}
    </span>
  );
}
