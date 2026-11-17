"use client";

import type { AgentInfo, EventsResponse, Quality, StatusResponse } from "@astryon/shared";
import Link from "next/link";
import type { ReactNode } from "react";
import { DishArt } from "@/components/art/DishArt";
import { HeroArt } from "@/components/art/HeroArt";
import { CoverageBar, SourceBadge } from "@/components/domain";
import { hrefOf } from "@/components/shell/nav";
import { useBasePath } from "@/lib/demo-context";
import { fmtDuration, fmtMbps, fmtNumber } from "@/lib/format";
import { summarizeOutages } from "@/lib/outages";
import type { QualityScore } from "@/lib/quality-score";
import { num, SignalBars } from "../dashboard/parts";
import { type Figure, N, Verdict, type VerdictTone } from "./verdict";

export interface DashboardVerdictText {
  tone: VerdictTone;
  word: string;
  headline: ReactNode;
  /** true quando o estado de agora foi confirmado pela antena (liga o eco de radar). */
  live: boolean;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * Responde "minha internet está boa agora e hoje?". O "agora" vem do status da antena; o "hoje" da nota de
 * qualidade das últimas 24 h. "Conectada" só aparece com o estado conectada confirmado e dado não atrasado.
 */
export function dashboardVerdict(status: StatusResponse | undefined, score: QualityScore | null): DashboardVerdictText | null {
  if (!status) return null;
  if (!status.available) {
    return status.dish_reachable === false
      ? { tone: "crit", word: "Antena inacessível", live: false, headline: "O painel não consegue falar com a antena agora, então não dá para confirmar se a internet está no ar." }
      : { tone: "unknown", word: "Sem leitura", live: false, headline: "Ainda não há leitura da antena; o estado da internet agora não está confirmado." };
  }
  if (status.stale) {
    return { tone: "warn", word: "Atrasado", live: false, headline: <>A última leitura da antena chegou há <N>{fmtDuration(status.age_s)}</N>; o estado de agora não está confirmado.</> };
  }
  const drop = num(status.status.metrics.pop_drop_pct?.value);
  switch (status.status.state) {
    case "conectada": {
      if (drop !== null && drop >= 5) return { tone: "warn", word: "Instável", live: true, headline: <>Sua internet está no ar, mas perdendo <N>{fmtNumber(drop, 1)}%</N> dos pacotes agora.</> };
      const lat = num(status.status.metrics.pop_latency_ms?.value);
      if (lat !== null && lat > 100) return { tone: "warn", word: "Conectada", live: true, headline: <>Sua internet está no ar, mas com latência alta agora: <N>{fmtNumber(lat, 0)} ms</N> até o PoP.</> };
      if (!score) return { tone: "ok", word: "Conectada", live: true, headline: "Sua internet está no ar agora; as últimas 24 h ainda não têm medições suficientes para uma avaliação." };
      if (score.tone === "ok") return { tone: "ok", word: "Conectada", live: true, headline: `Sua internet está boa agora e foi ${score.label === "Excelente" ? "excelente" : "boa"} nas últimas 24 h.` };
      return { tone: "warn", word: "Conectada", live: true, headline: `Sua internet está no ar agora, mas as últimas 24 h foram ${score.tone === "warn" ? "instáveis" : "ruins"}.` };
    }
    case "degradada":
      return { tone: "warn", word: "Degradada", live: false, headline: "Sua internet está no ar, mas degradada agora." };
    case "buscando":
      return { tone: "warn", word: "Sem enlace", live: false, headline: "A antena está buscando satélites; a internet pode estar fora agora." };
    case "inicializando":
      return { tone: "warn", word: "Iniciando", live: false, headline: "A antena está iniciando; a internet ainda não está disponível." };
    case "offline":
      return { tone: "crit", word: "Offline", live: false, headline: "Sua internet está fora do ar agora." };
    default:
      return { tone: "unknown", word: "Desconhecido", live: false, headline: "A antena respondeu, mas sem um estado de conexão reconhecido." };
  }
}

/** Frase de apoio das últimas 24 h. Só cita o que foi medido; lacuna de observação não vira queda nem tempo bom. */
export function dayDetail(quality: Quality | undefined, events: EventsResponse | undefined): ReactNode {
  if (!quality) return null;
  const parts: ReactNode[] = [];
  if (quality.availability_pct !== null) parts.push(<><N>{fmtNumber(quality.availability_pct, 2)}%</N> do tempo no ar</>);
  if (quality.latency_p50_ms !== null) parts.push(<>latência mediana de <N>{fmtNumber(quality.latency_p50_ms, 0)} ms</N></>);
  if (quality.loss_pct !== null) parts.push(<>perda média de <N>{fmtNumber(quality.loss_pct, 2)}%</N></>);
  if (events) {
    const o = summarizeOutages(events.events, events.end);
    parts.push(
      o.last.length === 0 ? (
        <>nenhuma queda registrada</>
      ) : (
        <>
          <N>{o.last.length}</N> {plural(o.last.length, "queda", "quedas")} somando <N>{fmtDuration(o.total)}</N>
        </>
      ),
    );
  }
  const cov = quality.coverage;
  return (
    <>
      {parts.length ? (
        <>
          Nas últimas 24 h:{" "}
          {parts.map((p, i) => (
            <span key={i}>
              {i > 0 && (i === parts.length - 1 ? " e " : ", ")}
              {p}
            </span>
          ))}
          .
        </>
      ) : (
        "Nas últimas 24 h ainda não há medições de disponibilidade, latência ou perda."
      )}
      {cov < 0.9 && (
        <>
          {" "}
          O agente observou <N>{fmtNumber(cov * 100, 0)}%</N> do período; trechos sem observação não contam como queda nem como conexão boa.
        </>
      )}
    </>
  );
}

export function DashboardVerdict({
  status,
  agent,
  quality,
  events,
  score,
  power,
}: {
  status: StatusResponse | undefined;
  agent: AgentInfo | undefined;
  quality: Quality | undefined;
  events: EventsResponse | undefined;
  score: QualityScore | null;
  power: number | null;
}) {
  const base = useBasePath();
  const v = dashboardVerdict(status, score);
  const st = status?.available ? status.status : null;
  const m = st?.metrics;
  const down = num(m?.downlink_mbps?.value);
  const up = num(m?.uplink_mbps?.value);
  const lat = num(m?.pop_latency_ms?.value);
  const drop = num(m?.pop_drop_pct?.value);
  const uptime = num(m?.uptime_s?.value);
  const firmware = st?.device.software_version ?? agent?.firmware ?? null;
  const outages = events ? summarizeOutages(events.events, events.end) : null;
  const avail = quality?.availability_pct ?? null;
  const loading = !status;

  const figures: Figure[] = [
    {
      key: "avail",
      label: "No ar (24 h)",
      value: avail === null ? "—" : fmtNumber(avail, 2),
      unit: avail === null ? undefined : "%",
      tone: avail !== null && avail < 99 ? "warn" : undefined,
      note: !quality ? "Consultando" : avail === null ? "Sem medições suficientes" : quality.coverage < 0.9 ? `Observado ${fmtNumber(quality.coverage * 100, 0)}% do período` : "Disponibilidade observada",
    },
    {
      key: "lat",
      label: "Latência agora",
      value: lat === null ? "—" : fmtNumber(lat, 0),
      unit: lat === null ? undefined : "ms",
      tone: lat !== null && lat > 100 ? "warn" : undefined,
      note: lat === null ? "Sem leitura da antena" : quality?.latency_p50_ms != null ? `Até o PoP · mediana 24 h ${fmtNumber(quality.latency_p50_ms, 0)} ms` : "Até o PoP da Starlink",
    },
    {
      key: "drop",
      label: "Perda agora",
      value: drop === null ? "—" : fmtNumber(drop, 2),
      unit: drop === null ? undefined : "%",
      tone: drop !== null && drop >= 5 ? "crit" : drop !== null && drop > 1 ? "warn" : undefined,
      note: drop === null ? "Sem leitura da antena" : quality?.loss_pct != null ? `Média 24 h ${fmtNumber(quality.loss_pct, 2)}%` : "Pings ao PoP sem resposta",
    },
    {
      key: "outages",
      label: "Quedas (24 h)",
      value: outages ? outages.last.length : "—",
      note: !outages ? "Consultando eventos" : outages.last.length ? `${fmtDuration(outages.total)} fora do ar · 24 h antes: ${outages.previousCount}` : `24 h antes: ${outages.previousCount}`,
    },
    {
      key: "down",
      label: "Download agora",
      value: down === null ? "—" : fmtMbps(down),
      unit: down === null ? undefined : "Mbps",
      note: down === null ? "Sem leitura da antena" : `Upload ${fmtMbps(up)} Mbps · tráfego, não capacidade`,
    },
  ];

  return (
    <Verdict
      label="Minha internet está boa agora e hoje?"
      tone={v?.tone ?? "unknown"}
      word={v?.word}
      live={v?.live}
      loading={loading}
      headline={v?.headline}
      detail={
        <>
          {dayDetail(quality, events)}
          {status && !status.available && (
            <>
              {" "}
              <Link href={hrefOf(base, "instalacao")} className="font-medium text-accent underline-offset-4 hover:underline">
                Testar conexão
              </Link>
            </>
          )}
        </>
      }
      figures={figures}
      art={
        <>
          <HeroArt />
          <DishArt className="absolute left-3 top-3 hidden w-40 md:block" dim={!v?.live} />
        </>
      }
      bodyClassName="md:min-h-36 md:pl-48"
      meta={
        <>
          <span className="flex items-center gap-2">
            <SignalBars level={score ? Math.max(1, Math.ceil(score.score / 25)) : 0} tone={score ? score.tone : "neutral"} />
            <Link href={hrefOf(base, "qualidade")} className="group underline-offset-4 hover:text-fg-muted">
              Nota de qualidade (24 h): <span className="tabular text-accent group-hover:underline">{score ? `${score.score}/100 · ${score.label}` : "sem dados"}</span>
            </Link>
          </span>
          <span>
            {agent?.terminal_name ?? "Starlink Mini"} · firmware <span className="tabular text-fg-muted">{firmware ?? "não identificado"}</span>
          </span>
          {status?.available && (
            <span>
              Ligada há <span className="tabular text-fg-muted">{uptime !== null ? fmtDuration(uptime) : "—"}</span>
            </span>
          )}
          {power !== null && (
            <span>
              Potência <span className="tabular text-fg-muted">≈ {fmtNumber(power, 0)} W</span>
            </span>
          )}
          <span className="ml-auto flex items-center gap-3">
            {quality && <CoverageBar coverage={quality.coverage} />}
            <SourceBadge source={st ? (st.origin === "grpc" ? "real" : "demonstracao") : "indisponivel"} />
          </span>
        </>
      }
    />
  );
}
