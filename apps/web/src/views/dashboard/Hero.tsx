"use client";

import type { AgentInfo, StatusResponse } from "@astryon/shared";
import { CircleCheck, CircleHelp, CircleX, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { DishArt } from "@/components/art/DishArt";
import { HeroArt } from "@/components/art/HeroArt";
import { SourceBadge } from "@/components/domain";
import { Skeleton } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { useBasePath } from "@/lib/demo-context";
import { fmtDuration } from "@/lib/format";
import type { QualityScore } from "@/lib/quality-score";
import { hrefOf } from "@/components/shell/nav";
import { num, SignalBars } from "./parts";

type Tone = "ok" | "warn" | "crit" | "neutral";

const TONE_TEXT: Record<Tone, string> = { ok: "text-ok", warn: "text-warn", crit: "text-crit", neutral: "text-fg-muted" };
const TONE_CHIP: Record<Tone, string> = {
  ok: "border-ok/40 bg-ok/10",
  warn: "border-warn/40 bg-warn/10",
  crit: "border-crit/40 bg-crit/10",
  neutral: "border-border-strong bg-surface-2/70",
};
const TONE_ICON = { ok: CircleCheck, warn: TriangleAlert, crit: CircleX, neutral: CircleHelp } as const;

/** Título e resumo do banner. "Online" só aparece quando a antena reporta o estado conectada. */
function headline(status: StatusResponse): { title: string; tone: Tone; link: string; linkTone: Tone } {
  if (!status.available) {
    return status.dish_reachable === false
      ? { title: "Antena inacessível", tone: "crit", link: "Sem comunicação", linkTone: "crit" }
      : { title: "Sem dados da antena", tone: "neutral", link: "Indisponível", linkTone: "neutral" };
  }
  if (status.stale) return { title: "Dados atrasados", tone: "warn", link: "Não confirmada", linkTone: "warn" };
  const drop = num(status.status.metrics.pop_drop_pct?.value);
  switch (status.status.state) {
    case "conectada":
      return { title: "Starlink Online", tone: "ok", ...(drop === null ? { link: "Ativa", linkTone: "ok" as const } : drop < 1 ? { link: "Estável", linkTone: "ok" as const } : { link: "Instável", linkTone: "warn" as const }) };
    case "degradada":
      return { title: "Starlink Degradada", tone: "warn", link: "Degradada", linkTone: "warn" };
    case "buscando":
      return { title: "Buscando satélites", tone: "warn", link: "Sem enlace", linkTone: "warn" };
    case "inicializando":
      return { title: "Antena inicializando", tone: "warn", link: "Sem enlace", linkTone: "warn" };
    case "offline":
      return { title: "Starlink Offline", tone: "crit", link: "Sem conexão", linkTone: "crit" };
    default:
      return { title: "Estado desconhecido", tone: "neutral", link: "Indisponível", linkTone: "neutral" };
  }
}

export function Hero({ status, agent, score }: { status: StatusResponse | undefined; agent: AgentInfo | undefined; score: QualityScore | null }) {
  const base = useBasePath();
  const h = status ? headline(status) : null;
  const st = status?.available ? status.status : null;
  const uptime = num(st?.metrics.uptime_s?.value);
  const firmware = st?.device.software_version ?? agent?.firmware ?? null;
  const Icon = h ? TONE_ICON[h.tone] : CircleHelp;
  const live = !!status?.available && !status.stale && (status.status.state === "conectada" || status.status.state === "degradada");
  return (
    <section aria-label="Estado da Starlink" className="ol-card ol-glow ol-hud relative isolate col-span-full overflow-hidden">
      <HeroArt />
      <div aria-hidden className="ol-ruler absolute inset-x-4 bottom-2 opacity-50 md:left-44" />
      <DishArt className="absolute -bottom-2 left-2 hidden w-40 md:block" dim={!live} />
      <div className="relative flex min-h-32 flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 md:pl-44">
        {!status || !h ? (
          <div className="flex-1">
            <Skeleton className="h-7 w-56 max-w-full" />
            <Skeleton className="mt-2 h-3 w-64 max-w-full" />
            <Skeleton className="mt-1.5 h-3 w-40 max-w-full" />
          </div>
        ) : (
          <>
            <div className="min-w-0 flex-1 basis-64">
              <div className="flex items-center gap-2.5">
                <span className={cn("grid size-8 shrink-0 place-items-center rounded-md border bg-bg/60", TONE_CHIP[h.tone], TONE_TEXT[h.tone])}>
                  <Icon className="size-4" aria-hidden />
                </span>
                <h2 className="text-xl font-semibold leading-tight text-fg sm:text-[24px]">{h.title}</h2>
              </div>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-fg">
                <span>{agent?.terminal_name ?? "Starlink Mini"}</span>
                <span aria-hidden className="text-fg-subtle">•</span>
                <span>Firmware: {firmware ?? "não identificado"}</span>
              </p>
              {status.available ? (
                <p className="mt-1 text-xs text-fg-muted">
                  Tempo online: <span className="tabular font-medium text-fg">{uptime !== null ? fmtDuration(uptime) : "não informado"}</span>
                  {status.stale && <span className="text-warn"> · última leitura há {fmtDuration(status.age_s)}</span>}
                  {st?.state_reason && <span> · {st.state_reason}</span>}
                </p>
              ) : (
                <p className="mt-1 max-w-xl text-xs leading-relaxed text-fg-muted">
                  {status.dish_reachable === false ? "Sem comunicação com a antena." : "Aguardando dados da antena."}{" "}
                  <Link href={hrefOf(base, "instalacao")} className="font-medium text-accent underline-offset-4 hover:underline">
                    Testar conexão
                  </Link>
                </p>
              )}
            </div>
            <div className="flex min-w-0 flex-col items-start gap-2">
              <div className="flex items-center gap-2">
                <SignalBars level={score ? Math.max(1, Math.ceil(score.score / 25)) : 0} tone={score ? score.tone : "neutral"} />
                <p className="text-xs leading-tight text-fg-muted">
                  Qualidade (24 h)
                  <br />
                  <span className={cn("text-xs font-semibold", score ? TONE_TEXT[score.tone] : "text-fg-muted")}>{score ? `${score.score} · ${score.label}` : "sem dados"}</span>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <p className={cn("rounded-[4px] border px-2.5 py-1 text-xs text-fg", TONE_CHIP[h.linkTone])}>
                  Conexão: <span className={cn("font-semibold", TONE_TEXT[h.linkTone])}>{h.link}</span>
                </p>
                <SourceBadge source={st ? (st.origin === "grpc" ? "real" : "demonstracao") : "indisponivel"} />
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
