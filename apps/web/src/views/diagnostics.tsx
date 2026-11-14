"use client";

import type { Quality, Source, StatusResponse } from "@orbitlink/shared";
import { Activity, ArrowRight, CircleCheck, CircleX, Info, MessagesSquare, Sparkles, TriangleAlert, Wrench } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { PageHeader, QueryError, SourceBadge } from "@/components/domain";
import { hrefOf } from "@/components/shell/nav";
import { Badge, Card, CardBody, CardHeader, EmptyState, Skeleton } from "@/components/ui/primitives";
import { useAgent, useStatusInterval } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useBasePath } from "@/lib/demo-context";
import { fmtDateTime } from "@/lib/format";
import { qualityScore } from "@/lib/quality-score";
import { QualityCard } from "./dashboard/cards";
import { num } from "./dashboard/parts";
import { RangeTabs } from "./shared";

interface DiagnosticSummary {
  generated_at: number;
  source: Source;
  engine: "regras" | "groq";
  headline: string;
  findings: { severity: "info" | "warn" | "crit"; kind: "evento_observado" | "hipotese" | "causa_confirmada"; text: string; evidence: string }[];
}

const KIND = {
  causa_confirmada: { label: "causa confirmada", tone: "accent", help: "Reportada explicitamente pela antena." },
  hipotese: { label: "hipótese", tone: "warn", help: "Explicação possível; correlação não comprova causa." },
  evento_observado: { label: "evento observado", tone: "neutral", help: "Fato registrado, sem causa determinada." },
} as const;

const SEV = {
  crit: { icon: CircleX, cls: "border-crit/30 bg-crit/10 text-crit", label: "crítico" },
  warn: { icon: TriangleAlert, cls: "border-warn/30 bg-warn/10 text-warn", label: "atenção" },
  info: { icon: Info, cls: "border-border-strong bg-surface-2 text-fg-muted", label: "informativo" },
} as const;

function Shortcut({ href, icon, title, children }: { href: string; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Link href={href} className="group flex items-center gap-3 rounded-md border border-border bg-bg-elev/60 p-3 transition-colors hover:border-accent/40 hover:bg-surface-2/60">
      <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-border-strong bg-surface text-accent [&>svg]:size-5">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-fg">{title}</span>
        <span className="block text-xs text-fg-muted">{children}</span>
      </span>
      <ArrowRight className="size-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-accent" aria-hidden />
    </Link>
  );
}

export default function DiagnosticsView() {
  const base = useBasePath();
  const [range, setRange] = useState("24h");
  const q = useAgent<DiagnosticSummary>(`diagnostics/summary?range=${range}`, { refetchInterval: 60_000 });
  const quality = useAgent<Quality>("quality?range=24h", { refetchInterval: 60_000 });
  const status = useAgent<StatusResponse>("status", { refetchInterval: useStatusInterval(30_000) });
  const obst = status.data?.available ? num(status.data.status.metrics.obstruction_pct?.value) : null;
  const score = quality.data
    ? qualityScore({ availabilityPct: quality.data.availability_pct, lossPct: quality.data.loss_pct, latencyP50Ms: quality.data.latency_p50_ms, obstructionPct: obst })
    : null;
  const d = q.data;
  const counts = { crit: 0, warn: 0, info: 0 };
  for (const f of d?.findings ?? []) counts[f.severity]++;

  return (
    <>
      <PageHeader
        title="Diagnósticos"
        icon={<Activity />}
        description="Análise por regras determinísticas sobre os dados que o agente registrou. Cada achado informa se é um evento observado, uma hipótese ou uma causa confirmada pela antena."
        actions={<RangeTabs value={range} onChange={setRange} options={[{ value: "24h", label: "24h" }, { value: "7d", label: "7d" }, { value: "30d", label: "30d" }]} />}
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Resumo do período"
            icon={<Sparkles />}
            subtitle={d ? `Motor: ${d.engine === "regras" ? "regras determinísticas" : "Groq"} · gerado em ${fmtDateTime(d.generated_at)}` : undefined}
            actions={d && <SourceBadge source={d.source} />}
          />
          <CardBody>
            {q.isLoading && <Skeleton className="h-40 w-full" />}
            {q.error && <QueryError error={q.error} onRetry={() => q.refetch()} />}
            {d && (
              <>
                <p className="text-[15px] leading-relaxed text-fg">{d.headline}</p>
                <p className="mt-3 flex flex-wrap gap-2">
                  <Badge tone={counts.crit ? "crit" : "neutral"}>{counts.crit} crítico(s)</Badge>
                  <Badge tone={counts.warn ? "warn" : "neutral"}>{counts.warn} de atenção</Badge>
                  <Badge>{counts.info} informativo(s)</Badge>
                </p>
                {d.findings.length === 0 ? (
                  <EmptyState icon={<CircleCheck />} title="Nenhuma anomalia detectada" className="py-8">
                    As regras não encontraram problemas no período observado. Períodos sem coleta não são avaliados.
                  </EmptyState>
                ) : (
                  <ul className="mt-4 space-y-2.5">
                    {d.findings.map((f, i) => {
                      const s = SEV[f.severity] ?? SEV.info;
                      const k = KIND[f.kind] ?? KIND.evento_observado;
                      const Icon = s.icon;
                      return (
                        <li key={i} className="flex items-start gap-3 rounded-md border border-border bg-bg-elev/50 p-3">
                          <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg border", s.cls)}>
                            <Icon className="size-[18px]" aria-hidden />
                            <span className="sr-only">{s.label}</span>
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-fg">{f.text}</p>
                            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                              <Badge tone={k.tone} title={k.help}>
                                {k.label}
                              </Badge>
                              <span>Evidência: {f.evidence}</span>
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </CardBody>
        </Card>

        <div className="grid grid-cols-1 content-start gap-4 md:grid-cols-2 xl:grid-cols-1">
          <QualityCard quality={quality.data} score={score} />
          <Card>
            <CardHeader title="Outras verificações" icon={<Wrench />} />
            <CardBody className="space-y-2">
              <Shortcut href={hrefOf(base, "instalacao")} icon={<Wrench />} title="Teste de conexão">
                Verifica ambiente, rede e a comunicação com a antena.
              </Shortcut>
              <Shortcut href={hrefOf(base, "qualidade")} icon={<Activity />} title="Qualidade por horário">
                Latência e perda detalhadas, hora a hora.
              </Shortcut>
              <Shortcut href={hrefOf(base, "assistente")} icon={<MessagesSquare />} title="Central de IA">
                Perguntas em texto sobre os dados registrados.
              </Shortcut>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
