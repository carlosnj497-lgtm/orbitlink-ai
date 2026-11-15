"use client";

import { CircleX, Sparkles, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { QueryError } from "@/components/domain";
import { hrefOf } from "@/components/shell/nav";
import { Badge, Card, CardBody, CardHeader, Skeleton } from "@/components/ui/primitives";
import { useAgent } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useBasePath } from "@/lib/demo-context";

/* ================================================================= Diagnóstico por regras */
interface DiagnosticSummary {
  engine: "regras" | "groq";
  headline: string;
  findings: { severity: "info" | "warn" | "crit"; kind: "evento_observado" | "hipotese" | "causa_confirmada"; text: string; evidence: string }[];
}

export function DiagnosticsCard({ className }: { className?: string }) {
  const base = useBasePath();
  const { data, error, isLoading } = useAgent<DiagnosticSummary>("diagnostics/summary?range=24h", { refetchInterval: 60_000 });
  return (
    <Card className={className}>
      <CardHeader
        title={
          <>
            Diagnóstico <span className="font-normal text-fg-muted">(24 h)</span>
          </>
        }
        icon={<Sparkles />}
        subtitle={data ? `Motor: ${data.engine === "regras" ? "regras determinísticas" : "Groq"} · baseado somente em dados registrados` : undefined}
        actions={
          <Link href={hrefOf(base, "diagnosticos")} className="text-xs font-medium text-accent hover:underline">
            Abrir diagnósticos
          </Link>
        }
      />
      <CardBody>
        {isLoading && <Skeleton className="h-16 w-full" />}
        {error && <QueryError error={error} />}
        {data && (
          <>
            <p className="text-sm text-fg">{data.headline}</p>
            <ul className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2.5 md:grid-cols-2 xl:grid-cols-3">
              {data.findings.slice(0, 4).map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  {f.severity === "crit" ? <CircleX className="mt-0.5 size-4 shrink-0 text-crit" aria-hidden /> : <TriangleAlert className={cn("mt-0.5 size-4 shrink-0", f.severity === "warn" ? "text-warn" : "text-fg-subtle")} aria-hidden />}
                  <div className="min-w-0">
                    <p className="text-fg">{f.text}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-fg-subtle">
                      <Badge tone={f.kind === "causa_confirmada" ? "accent" : "neutral"}>{f.kind === "causa_confirmada" ? "causa confirmada" : f.kind === "hipotese" ? "hipótese" : "evento observado"}</Badge>
                      {f.evidence}
                    </p>
                  </div>
                </li>
              ))}
              {!data.findings.length && <li className="text-sm text-fg-muted">Nenhuma anomalia detectada no período observado.</li>}
            </ul>
          </>
        )}
      </CardBody>
    </Card>
  );
}
