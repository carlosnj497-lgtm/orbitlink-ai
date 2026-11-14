/**
 * Pontuação de qualidade da conexão (0–100), calculada SOMENTE a partir de medições reais do período:
 *
 *   critério          peso   nota máxima quando…   nota zero quando…
 *   Estabilidade       40    disponibilidade 100%   disponibilidade ≤ 95%
 *   Perda de pacotes   25    perda 0%               perda ≥ 5%
 *   Latência           20    mediana ≤ 40 ms        mediana ≥ 150 ms
 *   Obstruções         15    0% do tempo            ≥ 10% do tempo
 *
 * Entre os extremos a nota é linear. Estabilidade, perda e latência são obrigatórias: sem qualquer uma delas
 * não há pontuação (a tela mostra "dados insuficientes"). Se só a obstrução faltar (firmware não informa),
 * a nota é reescalada sobre os 85 pontos restantes e marcada como parcial.
 */
export interface QualityInputs {
  availabilityPct: number | null | undefined;
  lossPct: number | null | undefined;
  latencyP50Ms: number | null | undefined;
  obstructionPct: number | null | undefined;
}

export type QualityLabel = "Excelente" | "Boa" | "Regular" | "Ruim";

export interface QualityPart {
  key: "stability" | "loss" | "latency" | "obstruction";
  label: string;
  /** Valor medido, já com unidade, ou null quando não informado. */
  value: number | null;
  points: number | null;
  max: number;
}

export interface QualityScore {
  score: number;
  label: QualityLabel;
  tone: "ok" | "warn" | "crit";
  parts: QualityPart[];
  /** true quando a obstrução não foi informada e a nota usa só os outros três critérios. */
  partial: boolean;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** 1 no melhor valor, 0 no pior, linear entre eles. */
function linear(v: number, best: number, worst: number): number {
  return Math.max(0, Math.min(1, (worst - v) / (worst - best)));
}

export function qualityScore(i: QualityInputs): QualityScore | null {
  if (!isNum(i.availabilityPct) || !isNum(i.lossPct) || !isNum(i.latencyP50Ms)) return null;
  const parts: QualityPart[] = [
    { key: "stability", label: "Estabilidade", value: i.availabilityPct, max: 40, points: 40 * linear(i.availabilityPct, 100, 95) },
    { key: "loss", label: "Perda de pacotes", value: i.lossPct, max: 25, points: 25 * linear(i.lossPct, 0, 5) },
    { key: "latency", label: "Latência", value: i.latencyP50Ms, max: 20, points: 20 * linear(i.latencyP50Ms, 40, 150) },
    { key: "obstruction", label: "Obstruções", value: isNum(i.obstructionPct) ? i.obstructionPct : null, max: 15, points: isNum(i.obstructionPct) ? 15 * linear(i.obstructionPct, 0, 10) : null },
  ];
  const scored = parts.filter((p) => p.points !== null);
  const total = scored.reduce((a, p) => a + (p.points ?? 0), 0);
  const max = scored.reduce((a, p) => a + p.max, 0);
  const score = Math.round((total / max) * 100);
  const label: QualityLabel = score >= 90 ? "Excelente" : score >= 75 ? "Boa" : score >= 50 ? "Regular" : "Ruim";
  return { score, label, tone: score >= 75 ? "ok" : score >= 50 ? "warn" : "crit", parts, partial: scored.length < parts.length };
}
