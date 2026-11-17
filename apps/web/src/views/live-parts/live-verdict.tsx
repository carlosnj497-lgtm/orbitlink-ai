import type { ConnectionEvent, StatusResponse } from "@astryon/shared";
import type { ReactNode } from "react";
import { STATE_META } from "@/components/domain";
import { fmtDuration, fmtMbps, fmtNumber, fmtTime } from "@/lib/format";
import { num } from "../dashboard/parts";
import { N, type VerdictTone } from "../overview-parts/verdict";

export interface LiveVerdictText {
  tone: VerdictTone;
  word: string;
  headline: ReactNode;
  live: boolean;
}

/**
 * Responde "o que está acontecendo neste momento?" com a leitura mais recente da antena. O canal SSE aberto não
 * conta como antena conectada; só o estado reportado pela antena, sem atraso, acende o verde.
 */
export function liveVerdict(status: StatusResponse | undefined, opts: { paused: boolean; pausedAt: number | null }): LiveVerdictText | null {
  if (!status) return null;
  if (opts.paused) {
    return {
      tone: "unknown",
      word: "Pausado",
      live: false,
      headline: opts.pausedAt ? <>Visualização congelada na leitura das <N>{fmtTime(opts.pausedAt)}</N>; retome para ver o momento atual.</> : "Visualização congelada; retome para ver o momento atual.",
    };
  }
  if (!status.available) {
    return status.dish_reachable === false
      ? { tone: "crit", word: STATE_META.inalcancavel.label, live: false, headline: "O agente não consegue falar com a antena neste momento, então não há leitura ao vivo." }
      : { tone: "unknown", word: "Sem leitura", live: false, headline: "Aguardando a primeira leitura da antena." };
  }
  if (status.stale) {
    return { tone: "warn", word: "Dados atrasados", live: false, headline: <>A última leitura chegou há <N>{fmtDuration(status.age_s)}</N>; o que aparece aqui não é o momento atual.</> };
  }
  const m = status.status.metrics;
  const down = num(m.downlink_mbps?.value);
  const lat = num(m.pop_latency_ms?.value);
  const drop = num(m.pop_drop_pct?.value);
  const state = status.status.state;
  if (state !== "conectada") {
    const meta = STATE_META[state] ?? STATE_META.desconhecida;
    const tone: VerdictTone = meta.tone === "crit" ? "crit" : meta.tone === "warn" ? "warn" : "unknown";
    return { tone, word: meta.label, live: false, headline: <>A antena informa: {meta.label.toLowerCase()} neste momento{status.status.state_reason ? ` (${status.status.state_reason})` : ""}.</> };
  }
  if (drop !== null && drop >= 5) return { tone: "warn", word: "Conectada", live: true, headline: <>Conectada, mas perdendo <N>{fmtNumber(drop, 1)}%</N> dos pacotes neste momento.</> };
  if (lat !== null && lat > 100) return { tone: "warn", word: "Conectada", live: true, headline: <>Conectada, com latência alta neste momento: <N>{fmtNumber(lat, 0)} ms</N> até o PoP.</> };
  const tail: ReactNode[] = [];
  if (lat !== null) tail.push(<>latência de <N>{fmtNumber(lat, 0)} ms</N></>);
  if (drop !== null) tail.push(<>perda de <N>{fmtNumber(drop, drop === 0 ? 0 : 2)}%</N></>);
  const joined = tail.map((t, i) => (
    <span key={i}>
      {i > 0 && " e "}
      {t}
    </span>
  ));
  if (down === null) return { tone: "ok", word: "Conectada", live: true, headline: <>Conectada agora{tail.length ? <>, com {joined}</> : ""}.</> };
  if (down === 0) return { tone: "ok", word: "Conectada", live: true, headline: <>Conectada e sem tráfego agora{tail.length ? <>, com {joined}</> : ""}.</> };
  return {
    tone: "ok",
    word: "Conectada",
    live: true,
    headline: (
      <>
        Conectada, recebendo <N>{fmtMbps(down)} Mbps</N> agora{tail.length ? <>, com {joined}</> : ""}.
      </>
    ),
  };
}

/** Quantos eventos da janela ainda estão abertos (queda em andamento neste momento). */
export function openEvents(events: ConnectionEvent[]): number {
  return events.filter((e) => e.open && e.kind !== "boot").length;
}
