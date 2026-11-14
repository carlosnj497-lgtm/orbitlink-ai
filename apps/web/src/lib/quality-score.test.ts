import { describe, expect, it } from "vitest";
import { qualityScore } from "./quality-score";

describe("pontuação de qualidade", () => {
  it("conexão perfeita vale 100", () => {
    const s = qualityScore({ availabilityPct: 100, lossPct: 0, latencyP50Ms: 30, obstructionPct: 0 });
    expect(s).toMatchObject({ score: 100, label: "Excelente", tone: "ok", partial: false });
  });

  it("pondera cada critério de forma linear", () => {
    // 40*(0.5) + 25*(0.5) + 20*(0.5) + 15*(0.5) = 50
    const s = qualityScore({ availabilityPct: 97.5, lossPct: 2.5, latencyP50Ms: 95, obstructionPct: 5 });
    expect(s?.score).toBe(50);
    expect(s?.label).toBe("Regular");
  });

  it("não inventa nota sem as medições obrigatórias", () => {
    expect(qualityScore({ availabilityPct: null, lossPct: 0, latencyP50Ms: 30, obstructionPct: 0 })).toBeNull();
    expect(qualityScore({ availabilityPct: 100, lossPct: undefined, latencyP50Ms: 30, obstructionPct: 0 })).toBeNull();
    expect(qualityScore({ availabilityPct: 100, lossPct: 0, latencyP50Ms: Number.NaN, obstructionPct: 0 })).toBeNull();
  });

  it("sem obstrução informada, reescala e marca como parcial", () => {
    const s = qualityScore({ availabilityPct: 100, lossPct: 0, latencyP50Ms: 30, obstructionPct: null });
    expect(s).toMatchObject({ score: 100, partial: true });
    expect(s?.parts.find((p) => p.key === "obstruction")?.points).toBeNull();
  });

  it("limita os extremos (nunca abaixo de 0)", () => {
    const s = qualityScore({ availabilityPct: 60, lossPct: 40, latencyP50Ms: 900, obstructionPct: 80 });
    expect(s).toMatchObject({ score: 0, label: "Ruim", tone: "crit" });
  });
});
