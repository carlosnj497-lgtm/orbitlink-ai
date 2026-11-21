import { describe, expect, it } from "vitest";
import { powerStatistics } from "./energy";

describe("estatísticas de energia", () => {
  it("converte a janela de segundos para horas (50 W por 24 h = 1,2 kWh)", () => {
    const stats = powerStatistics([{ power_w: 50 }, { power_w: 50 }], 1_700_000_000, 1_700_086_400);
    expect(stats?.avg).toBe(50);
    expect(stats?.kwh).toBeCloseTo(1.2, 10);
  });

  it("não estima energia sem potência ou com janela inválida", () => {
    expect(powerStatistics([{ power_w: null }], 0, 3600)).toBeNull();
    expect(powerStatistics([{ power_w: 50 }], 3600, 3600)?.kwh).toBeNull();
  });
});
