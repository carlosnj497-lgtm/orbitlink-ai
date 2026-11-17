import type { UsagePlan, UsageSummary } from "@astryon/shared";
import type { ReactNode } from "react";
import { fmtBytesStr, fmtDay, fmtNumber } from "@/lib/format";
import { N, type VerdictTone } from "../overview-parts/verdict";

export interface UsageVerdictText {
  tone: VerdictTone;
  word: string;
  headline: ReactNode;
  /** Média diária que cabe no que resta da franquia (bytes/dia), quando dá para calcular. */
  dailyBudget: number | null;
}

/**
 * Responde "quanto usei e vou estourar a franquia?". Consumo é estimativa local; com períodos sem observação o valor
 * é mínimo ("pelo menos"). Sem franquia ou sem projeção, a frase diz que não dá para responder a segunda parte.
 */
export function usageVerdict(plan: UsagePlan | undefined, summary: UsageSummary | undefined): UsageVerdictText | null {
  if (!plan && !summary) return null;
  if (!plan?.configured) {
    const month = summary?.month;
    const used = month ? (
      <>
        Você usou {month.coverage < 1 ? "pelo menos " : ""}
        <N>{fmtBytesStr(month.bytes_total)}</N> este mês
      </>
    ) : (
      <>O consumo do mês ainda está sendo calculado</>
    );
    return { tone: "unknown", word: "Sem franquia", dailyBudget: null, headline: <>{used}; sem a franquia configurada, não dá para dizer se vai estourar.</> };
  }
  const usedTxt = (
    <>
      Você usou {plan.lower_bound ? "pelo menos " : ""}
      <N>{fmtBytesStr(plan.used.bytes_total)}</N> de <N>{fmtBytesStr(plan.cap_bytes)}</N>
      {plan.pct_used !== null && (
        <>
          {" "}
          (<N>{fmtNumber(plan.pct_used, 0)}%</N>)
        </>
      )}
    </>
  );
  const end = fmtDay(plan.cycle_end - 1).replace(/\.$/, "");
  const dailyBudget = plan.remaining_bytes !== null && plan.days_remaining > 0 ? plan.remaining_bytes / plan.days_remaining : null;
  const pct = plan.pct_used;
  if (pct !== null && pct >= 100) {
    return { tone: "crit", word: "Estourou", dailyBudget: null, headline: <>Você já passou da franquia: {usedTxt}, e o ciclo só vira em <N>{end}</N>.</> };
  }
  const proj = plan.projection?.available ? plan.projection : null;
  if (proj && plan.projected_pct !== null) {
    if (plan.projected_pct >= 100) {
      return { tone: "warn", word: "Vai estourar", dailyBudget, headline: <>{usedTxt} e, no ritmo atual, deve estourar a franquia: projeção de <N>{fmtBytesStr(proj.bytes_total)}</N> até <N>{end}</N>.</> };
    }
    return {
      tone: pct !== null && pct >= 80 ? "warn" : "ok",
      word: "Dentro da franquia",
      dailyBudget,
      headline: (
        <>
          {usedTxt} e, no ritmo atual, deve fechar o ciclo em <N>{fmtBytesStr(proj.bytes_total)}</N> (<N>{fmtNumber(plan.projected_pct, 0)}%</N>), dentro da franquia.
        </>
      ),
    };
  }
  return {
    tone: pct !== null && pct >= 80 ? "warn" : "unknown",
    word: "Sem projeção",
    dailyBudget,
    headline: <>{usedTxt}; ainda não há dias observados suficientes para prever se vai estourar.</>,
  };
}
