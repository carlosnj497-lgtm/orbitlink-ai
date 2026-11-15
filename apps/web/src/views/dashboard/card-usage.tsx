"use client";

import type { UsagePlan, UsageSeries, UsageSummary } from "@astryon/shared";
import { ArrowRight, Info, PieChart } from "lucide-react";
import Link from "next/link";
import { CoverageBar, SourceBadge } from "@/components/domain";
import { hrefOf } from "@/components/shell/nav";
import { Card, CardBody, CardHeader, Skeleton, Tip } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { useBasePath } from "@/lib/demo-context";
import { fmtBytes, fmtBytesStr, fmtDay, fmtPct } from "@/lib/format";

/* ================================================================= Consumo de internet */
const DONUT_R = 40;
const DONUT_C = 2 * Math.PI * DONUT_R;

export function UsageCard({ usage, plan, series, className }: { usage: UsageSummary | undefined; plan: UsagePlan | undefined; series: UsageSeries | undefined; className?: string }) {
  const base = useBasePath();
  const m = usage?.month;
  const total = m?.bytes_total ?? 0;
  const downFrac = total > 0 && m ? m.bytes_download / total : 0;
  const upFrac = total > 0 && m ? m.bytes_upload / total : 0;
  const t = fmtBytes(m?.bytes_total);
  const proj = usage?.projection_month;
  const days = (series?.points ?? []).slice(-14);
  const dayMax = Math.max(1, ...days.map((d) => d.bytes_total));
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader
        title={
          <>
            Consumo de Internet <span className="font-normal text-fg-muted">(este mês)</span>
          </>
        }
        icon={<PieChart />}
        actions={usage && <SourceBadge source={usage.month.source} />}
      />
      <CardBody className="flex flex-1 flex-col gap-3">
        {!usage ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <div className="flex items-center gap-4">
              <div className="relative size-[100px] shrink-0">
                <svg viewBox="0 0 100 100" className="size-full -rotate-90" role="img" aria-label={total > 0 ? `Download ${fmtPct(downFrac * 100, 1)}, upload ${fmtPct(upFrac * 100, 1)} do consumo do mês` : "Sem consumo registrado neste mês"}>
                  <circle cx="50" cy="50" r={DONUT_R} fill="none" stroke="var(--surface-3)" strokeWidth="10" />
                  {total > 0 && (
                    <>
                      <circle cx="50" cy="50" r={DONUT_R} fill="none" stroke="var(--chart-down)" strokeWidth="10" strokeLinecap="butt" strokeDasharray={`${DONUT_C * downFrac} ${DONUT_C}`} />
                      <circle cx="50" cy="50" r={DONUT_R} fill="none" stroke="var(--chart-up)" strokeWidth="10" strokeLinecap="butt" strokeDasharray={`${DONUT_C * upFrac} ${DONUT_C}`} strokeDashoffset={-DONUT_C * downFrac} />
                    </>
                  )}
                </svg>
                <div className="absolute inset-0 grid place-items-center text-center leading-tight">
                  <p>
                    {total > 0 ? (
                      <>
                        <span className="tabular text-[15px] font-medium">{t.value}</span>
                        <span className="ml-0.5 text-[10px] font-medium text-fg-muted">{t.unit}</span>
                      </>
                    ) : (
                      <span className="text-base font-semibold text-fg-subtle">—</span>
                    )}
                    <br />
                    <span className="text-[10px] uppercase tracking-wide text-fg-subtle">Total</span>
                  </p>
                </div>
              </div>
              <dl className="min-w-0 flex-1 space-y-2 text-sm">
                {(
                  [
                    ["Download", "var(--chart-down)", m?.bytes_download, downFrac],
                    ["Upload", "var(--chart-up)", m?.bytes_upload, upFrac],
                  ] as const
                ).map(([label, color, bytes, frac]) => (
                  <div key={label} className="flex items-baseline justify-between gap-2">
                    <dt className="flex items-center gap-2 text-fg-muted">
                      <span className="size-2 rounded-full" style={{ background: color }} aria-hidden /> {label}
                    </dt>
                    <dd className="tabular text-right font-medium">
                      {total > 0 ? fmtBytesStr(bytes) : <span className="text-fg-subtle">—</span>}
                      {total > 0 && <span className="ml-1 text-xs font-normal text-fg-muted">{fmtPct(frac * 100, 0)}</span>}
                    </dd>
                  </div>
                ))}
                {total === 0 && <p className="text-xs leading-snug text-fg-subtle">Nenhum tráfego registrado ainda neste mês.</p>}
              </dl>
            </div>

            {days.length > 1 && (
              <div>
                <p className="mb-1 text-[11px] text-fg-subtle">Últimos {days.length} dias</p>
                <div className="flex h-9 items-end gap-[3px]" role="img" aria-label="Consumo por dia nos últimos dias">
                  {days.map((d) => (
                    <div key={d.t} title={`${fmtDay(d.t)}: ${fmtBytesStr(d.bytes_total)}`} className="flex-1 rounded-t-[2px] bg-accent-2/70 transition-colors hover:bg-accent" style={{ height: `${Math.max(4, (d.bytes_total / dayMax) * 100)}%` }} />
                  ))}
                </div>
              </div>
            )}

            <div className="mt-auto space-y-2 border-t border-border pt-3">
              {plan?.configured && plan.pct_used !== null ? (
                <div>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-fg-muted">
                      Franquia: <span className="tabular font-medium text-fg">{fmtBytesStr(plan.used.bytes_total)}</span> de {fmtBytesStr(plan.cap_bytes)}
                    </span>
                    <span className="tabular font-semibold">{fmtPct(plan.pct_used, 0)}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-label="Franquia consumida no ciclo" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(100, plan.pct_used))}>
                    <div className={cn("h-full rounded-full", plan.pct_used >= 100 ? "bg-crit" : plan.pct_used >= 80 || (plan.projected_pct ?? 0) >= 100 ? "bg-warn" : "bg-accent-2")} style={{ width: `${Math.min(100, plan.pct_used)}%` }} />
                  </div>
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="flex min-w-0 items-center gap-1.5 text-fg-muted">
                  {proj?.available ? (
                    <>
                      Projeção: <span className="tabular font-semibold text-fg">{fmtBytesStr(proj.bytes_total)}</span>
                    </>
                  ) : (
                    <>Projeção indisponível</>
                  )}
                  <Tip
                    content={
                      proj?.available
                        ? `Estimativa estatística, com incerteza${proj.low != null && proj.high != null ? ` (entre ${fmtBytesStr(proj.low)} e ${fmtBytesStr(proj.high)})` : ""}. ${proj.method ?? ""}`
                        : (proj?.reason ?? "Dados insuficientes para projetar o mês.")
                    }
                  >
                    <button type="button" aria-label="Sobre a projeção mensal" className="text-fg-subtle hover:text-fg">
                      <Info className="size-3.5" />
                    </button>
                  </Tip>
                </span>
                <CoverageBar coverage={usage.month.coverage} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] leading-snug text-fg-subtle">Estimativa local — não é o consumo oficial do plano.</p>
                <Link href={hrefOf(base, "consumo")} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-accent hover:underline">
                  Detalhes <ArrowRight className="size-3" />
                </Link>
              </div>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
