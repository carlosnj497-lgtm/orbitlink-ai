"use client";

import type { ObstructionResponse, StatusResponse } from "@astryon/shared";
import { ArrowRight, Info, Radar, SatelliteDish } from "lucide-react";
import Link from "next/link";
import { ObstructionGrid } from "@/components/charts";
import { SourceBadge } from "@/components/domain";
import { hrefOf } from "@/components/shell/nav";
import { Badge, Card, CardBody, Skeleton } from "@/components/ui/primitives";
import { useAgent } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useBasePath } from "@/lib/demo-context";
import { fmtAgo } from "@/lib/format";

/* ================================================================= Mapa de cobertura (céu visto pela antena) */
export function CoverageCard({ status, className }: { status: StatusResponse | undefined; className?: string }) {
  const base = useBasePath();
  const q = useAgent<ObstructionResponse>("obstruction?range=7d", { refetchInterval: 300_000 });
  const map = q.data?.map;
  const loading = !q.data && !q.error;
  const unreachable = status?.dish_reachable === false;
  const waiting = q.data?.map_capability?.status === "verificada";
  const needsConnection = !map && (unreachable || !!q.error);
  const emptyTitle = q.error ? "Falha ao consultar o mapa" : unreachable ? "Antena sem comunicação" : waiting ? "Aguardando primeira captura" : "Mapa ainda indisponível";
  const emptyDescription = q.error
    ? "Verifique a conexão com o agente para recuperar a leitura."
    : unreachable
      ? "Restabeleça a conexão para consultar a visibilidade do céu."
      : waiting
        ? "O mapa aparecerá após a próxima coleta da antena."
        : "O firmware ainda não disponibilizou o mapa de obstruções.";
  return (
    <Card aria-label="Mapa de cobertura" className={cn("flex min-w-0 flex-col overflow-hidden", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-accent/20 bg-accent/10 text-accent">
            <Radar className="size-[18px]" aria-hidden />
          </span>
          <div>
            <h3 className="text-sm font-semibold tracking-tight">Mapa de Cobertura</h3>
            <p className="mt-0.5 text-[11px] text-fg-muted">Visibilidade do céu</p>
          </div>
        </div>
        <Badge tone={map ? "accent" : "neutral"} className="gap-1.5 text-[10px]">
          <span className={cn("size-1.5 rounded-full", map ? "bg-accent" : "bg-fg-subtle")} aria-hidden />
          {map ? "Disponível" : loading ? "Consultando" : "Sem mapa"}
        </Badge>
      </div>
      <CardBody className="flex flex-1 flex-col gap-3">
        <div aria-busy={loading} className={cn("relative grid place-items-center overflow-hidden rounded-md border border-border bg-bg-elev/70", map ? "h-56" : "min-h-44")}>
          {loading ? (
            <Skeleton className="size-full rounded-none" />
          ) : map ? (
            <ObstructionGrid rows={map.num_rows} cols={map.num_cols} snr={map.snr} className="aspect-square h-[92%]" />
          ) : (
            <div className="flex flex-col items-center px-5 py-5 text-center">
              <span className="grid size-12 place-items-center rounded-full border border-border-strong bg-surface text-fg-muted ring-4 ring-surface/40">
                <SatelliteDish className="size-5" aria-hidden />
              </span>
              <p className="mt-3 text-sm font-medium text-fg">{emptyTitle}</p>
              <p className="mt-1 max-w-[32ch] text-xs leading-relaxed text-fg-muted">{emptyDescription}</p>
            </div>
          )}
        </div>
        {map && (
          <div className="space-y-2">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-muted">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm bg-accent" aria-hidden /> céu livre
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm bg-warn" aria-hidden /> parcial
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm bg-crit" aria-hidden /> obstruído
              </span>
            </p>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-fg-subtle">
              <span>Capturado {fmtAgo(map.ts)}</span>
              <SourceBadge source={map.source} />
            </div>
          </div>
        )}
        <div className="mt-auto space-y-2.5">
          <Link href={hrefOf(base, needsConnection ? "instalacao" : "obstrucoes")} className="group flex min-h-9 items-center justify-between gap-2 rounded-lg border border-accent/25 bg-accent/10 px-3 py-2 text-xs font-medium text-accent transition-colors hover:border-accent/50 hover:bg-accent/15">
            {needsConnection ? "Verificar conexão" : "Explorar obstruções"}
            <ArrowRight className="size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
          <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-fg-subtle">
            <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
            Visão do céu informada pela antena, sem localização geográfica.
          </p>
        </div>
      </CardBody>
    </Card>
  );
}
