"use client";

import type { Quality } from "@astryon/shared";
import { Info, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { CoverageBar, SourceBadge } from "@/components/domain";
import { hrefOf } from "@/components/shell/nav";
import { Card, CardBody, CardHeader, Skeleton, Tip } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { useBasePath } from "@/lib/demo-context";
import { fmtNumber, fmtPct } from "@/lib/format";
import type { QualityPart, QualityScore } from "@/lib/quality-score";
import { Ring, type RowState, StateIcon } from "./parts";

/* ================================================================= Qualidade da conexão */
function partState(p: QualityPart): RowState {
  if (p.points === null) return "unknown";
  const f = p.points / p.max;
  return f >= 0.8 ? "ok" : f >= 0.5 ? "warn" : "fail";
}

function partValue(p: QualityPart): string {
  if (p.value === null) return "Não informado";
  if (p.key === "latency") return `${fmtNumber(p.value, 0)} ms`;
  if (p.key === "stability") return `${fmtPct(p.value, 2)} disponível`;
  return fmtPct(p.value, 2);
}

export function QualityCard({ quality, score, className }: { quality: Quality | undefined; score: QualityScore | null; className?: string }) {
  const base = useBasePath();
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader
        title={
          <>
            Qualidade da Conexão <span className="font-normal text-fg-muted">(24 h)</span>
          </>
        }
        icon={<ShieldCheck />}
        actions={
          <>
            <Tip content="Pontuação de 0 a 100 calculada pelo painel: estabilidade (40 pts, disponibilidade de 95% a 100%), perda de pacotes (25 pts, de 5% a 0%), latência mediana (20 pts, de 150 ms a 40 ms) e obstruções (15 pts, de 10% a 0%). Sem medições reais suficientes, nenhuma nota é exibida.">
              <button type="button" aria-label="Como a pontuação é calculada" className="text-fg-subtle hover:text-fg">
                <Info className="size-4" />
              </button>
            </Tip>
            {quality && <SourceBadge source={quality.source === "demonstracao" ? "demonstracao" : score ? "calculada" : "indisponivel"} />}
          </>
        }
      />
      <CardBody className="flex flex-1 flex-col">
        {!quality ? (
          <Skeleton className="h-44 w-full" />
        ) : (
          <>
            <div className="flex items-center gap-4">
              <Ring value={score?.score ?? null} tone={score?.tone ?? "neutral"} className="size-[116px]">
                <p className="leading-tight">
                  <span className="tabular text-[26px] font-semibold">{score ? score.score : "—"}</span>
                  <br />
                  <span className={cn("text-xs font-medium", score ? (score.tone === "ok" ? "text-ok" : score.tone === "warn" ? "text-warn" : "text-crit") : "text-fg-subtle")}>{score ? score.label : "sem nota"}</span>
                </p>
              </Ring>
              {score ? (
                <ul className="min-w-0 flex-1 space-y-2 text-sm">
                  {score.parts.map((p) => (
                    <li key={p.key} className="flex items-center gap-2">
                      <StateIcon state={partState(p)} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-fg">{p.label}</span>
                        <span className="tabular block truncate text-[11px] text-fg-subtle">{partValue(p)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="min-w-0 flex-1 text-sm text-fg-muted">Dados insuficientes nas últimas 24 h para calcular a pontuação. Ela aparece quando houver medições reais de disponibilidade, perda e latência.</p>
              )}
            </div>
            <div className="mt-auto flex items-center justify-between gap-2 pt-3">
              <CoverageBar coverage={quality.coverage} />
              <Link href={hrefOf(base, "qualidade")} className="text-xs font-medium text-accent hover:underline">
                Detalhes
              </Link>
            </div>
            {score?.partial && <p className="mt-1 text-[11px] text-fg-subtle">Obstrução não informada pelo firmware: nota calculada com os outros três critérios.</p>}
          </>
        )}
      </CardBody>
    </Card>
  );
}
