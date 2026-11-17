import type { Quality, QualityHour } from "@astryon/shared";
import type { ReactNode } from "react";
import { fmtDuration, fmtNumber } from "@/lib/format";
import { qualityScore } from "@/lib/quality-score";
import { N, type VerdictTone } from "../overview-parts/verdict";

/** Perda alta a partir deste valor (%): mesma régua do mapa por hora. */
export const HIGH_LOSS = 2;

export const RANGE_PHRASE: Record<string, string> = {
  "1h": "na última hora",
  "6h": "nas últimas 6 h",
  "24h": "nas últimas 24 h",
  "7d": "nos últimos 7 dias",
  "30d": "nos últimos 30 dias",
};

const hh = (h: number) => `${String(h).padStart(2, "0")}h`;

/** Agrupa horas consecutivas (inclusive virando a meia-noite) em faixas: [19,20,21] → "19h–21h". */
export function hourRanges(hours: number[]): string[] {
  const set = new Set(hours);
  const out: string[] = [];
  const seen = new Set<number>();
  for (const h of [...set].sort((a, b) => a - b)) {
    if (seen.has(h)) continue;
    // Começo da faixa: hora cuja anterior não está no conjunto (ou o conjunto cobre o dia todo).
    if (set.has((h + 23) % 24) && set.size < 24) continue;
    let end = h;
    seen.add(h);
    while (set.has((end + 1) % 24) && !seen.has((end + 1) % 24)) {
      end = (end + 1) % 24;
      seen.add(end);
    }
    out.push(end === h ? hh(h) : `${hh(h)}–${hh(end)}`);
  }
  return out;
}

export interface WorstHours {
  /** Faixas de horário com perda alta (≥ HIGH_LOSS), ou a pior hora isolada quando nenhuma passa da régua. */
  label: string | null;
  /** Perda média nas horas destacadas. */
  loss: number | null;
  high: boolean;
}

export function worstHours(byHour: QualityHour[]): WorstHours {
  const seen = byHour.filter((h) => h.observed_seconds > 0 && h.loss_pct !== null) as (QualityHour & { loss_pct: number })[];
  if (seen.length < 2) return { label: null, loss: null, high: false };
  const high = seen.filter((h) => h.loss_pct >= HIGH_LOSS);
  if (high.length) {
    const w = high.reduce((a, h) => a + h.observed_seconds, 0);
    const loss = high.reduce((a, h) => a + h.loss_pct * h.observed_seconds, 0) / w;
    const ranges = hourRanges(high.map((h) => h.hour));
    return { label: ranges.length > 3 ? `${ranges.slice(0, 3).join(", ")} e outros horários` : ranges.join(", ").replace(/, ([^,]*)$/, " e $1"), loss, high: true };
  }
  const worst = seen.reduce((a, h) => (h.loss_pct > a.loss_pct ? h : a));
  return worst.loss_pct >= 0.5 ? { label: hh(worst.hour), loss: worst.loss_pct, high: false } : { label: null, loss: null, high: false };
}

export interface QualityVerdictText {
  tone: VerdictTone;
  word: string;
  headline: ReactNode;
  detail: ReactNode;
}

/** Responde "a conexão é estável e quando piora?" só com o que a antena mediu no período. */
export function qualityVerdict(q: Quality, range: string): QualityVerdictText {
  const when = RANGE_PHRASE[range] ?? "no período";
  const score = qualityScore({ availabilityPct: q.availability_pct, lossPct: q.loss_pct, latencyP50Ms: q.latency_p50_ms, obstructionPct: null });
  if (q.observed_seconds === 0 || !score) {
    return {
      tone: "unknown",
      word: "Sem dados",
      headline: `Ainda não há medições suficientes ${when} para dizer se a conexão é estável.`,
      detail: "A avaliação aparece quando houver disponibilidade, perda e latência medidas pela antena. Trechos sem observação não contam como conexão boa nem como queda.",
    };
  }
  const w = range === "1h" ? { label: null, loss: null, high: false } : worstHours(q.by_hour);
  const stable = score.tone === "ok";
  const adjective = stable ? "estável" : score.tone === "warn" ? "instável" : "ruim";
  const headline = (
    <>
      A conexão foi {adjective} {when}
      {w.label ? (
        w.high ? (
          <>
            {stable ? " e piora" : ", principalmente"} entre <N>{w.label}</N>.
          </>
        ) : (
          <>
            ; o pior horário é <N>{w.label}</N>.
          </>
        )
      ) : (
        <>{range === "1h" ? "." : " e nenhum horário se destaca."}</>
      )}
    </>
  );
  const detail = (
    <>
      <N>{fmtNumber(q.availability_pct, 2)}%</N> do tempo no ar, perda média de <N>{fmtNumber(q.loss_pct, 2)}%</N> e latência mediana de <N>{fmtNumber(q.latency_p50_ms, 0)} ms</N>
      {q.latency_p95_ms !== null && (
        <>
          {" "}
          (os 5% piores passam de <N>{fmtNumber(q.latency_p95_ms, 0)} ms</N>)
        </>
      )}
      .{" "}
      {q.full_drop_seconds > 0 ? (
        <>
          Sem resposta nenhuma por <N>{fmtDuration(q.full_drop_seconds)}</N>.
        </>
      ) : (
        "Nenhum trecho com perda total."
      )}
      {w.label && w.loss !== null && (
        <>
          {" "}
          {w.high ? "Nesses horários" : "Nesse horário"} a perda média sobe para <N>{fmtNumber(w.loss, 2)}%</N>.
        </>
      )}
      {q.coverage < 0.9 && (
        <>
          {" "}
          O agente observou <N>{fmtNumber(q.coverage * 100, 0)}%</N> do período; o resto fica fora das contas.
        </>
      )}
    </>
  );
  return { tone: score.tone, word: adjective[0].toUpperCase() + adjective.slice(1), headline, detail };
}
