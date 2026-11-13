import { describe, expect, it } from "vitest";
import { demoFetch } from "./demo-data";
import { fmtBytes, fmtDuration, fmtMbps, fmtPct, fmtTime } from "./format";

describe("formatação pt-BR", () => {
  it("bytes em unidades decimais", () => {
    expect(fmtBytes(5_500_000_000)).toEqual({ value: "5,5", unit: "GB" });
    expect(fmtBytes(null)).toEqual({ value: "—", unit: "" });
  });
  it("Mbps e porcentagem", () => {
    expect(fmtMbps(12.5)).toBe("12,5");
    expect(fmtMbps(0)).toBe("0");
    expect(fmtMbps(null)).toBe("—");
    expect(fmtPct(1.25, 2)).toBe("1,25%");
  });
  it("duração legível", () => {
    expect(fmtDuration(3725)).toBe("1h 2min");
    expect(fmtDuration(45)).toBe("45s");
  });
  it("horário em America/Fortaleza (UTC-3)", () => {
    expect(fmtTime(Date.UTC(2026, 10, 12, 15, 0, 0) / 1000)).toBe("12:00:00");
  });
});

describe("dados de demonstração", () => {
  it("toda telemetria de demonstração vem marcada como tal", async () => {
    const t = (await demoFetch("telemetry?range=1h")) as { source: string; points: unknown[] };
    expect(t.source).toBe("demonstracao");
    expect(t.points.length).toBeGreaterThan(0);
    const s = (await demoFetch("status")) as { status: { origin: string; metrics: Record<string, { source: string }> } };
    expect(s.status.origin).toBe("fixture");
    expect(Object.values(s.status.metrics).every((m) => m.source === "demonstracao")).toBe(true);
  });
});
