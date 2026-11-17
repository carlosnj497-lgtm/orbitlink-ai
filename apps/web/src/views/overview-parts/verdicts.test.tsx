import type { Quality, StatusResponse, UsagePlan } from "@astryon/shared";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { qualityScore } from "@/lib/quality-score";
import { outageFacts } from "../outages-parts/outages-verdict";
import { hourRanges, qualityVerdict } from "../quality-parts/quality-verdict";
import { usageVerdict } from "../usage-parts/usage-verdict";
import { dashboardVerdict } from "./dashboard-verdict";

const text = (n: ReactNode) => render(<p>{n}</p>).container.textContent ?? "";

function status(state: "conectada" | "offline", drop = 0, stale = false): StatusResponse {
  return {
    available: true, dish_reachable: true, age_s: stale ? 300 : 0, stale,
    status: {
      observed_at: "2026-11-14T12:00:00Z", origin: "grpc", state, state_reason: null,
      device: { terminal_key: null, hardware_version: null, software_version: null, board_rev: null, bootcount: null },
      metrics: { pop_drop_pct: { value: drop, source: "real" } },
      alerts: [], outage: null, fields_present: [], fields_missing: [],
    },
  };
}

describe("veredito do Dashboard", () => {
  const good = qualityScore({ availabilityPct: 99.9, lossPct: 0.1, latencyP50Ms: 30, obstructionPct: 0 });
  it("só diz 'boa' com o estado conectada confirmado e nota boa", () => {
    const v = dashboardVerdict(status("conectada"), good)!;
    expect(v.tone).toBe("ok");
    expect(text(v.headline)).toMatch(/boa agora/);
  });
  it("dado atrasado não é tratado como online", () => {
    const v = dashboardVerdict(status("conectada", 0, true), good)!;
    expect(v.tone).toBe("warn");
    expect(v.word).not.toBe("Conectada");
  });
  it("latência alta com a antena conectada vira atenção", () => {
    const st = status("conectada");
    if (st.available) st.status.metrics.pop_latency_ms = { value: 180, source: "real" };
    const v = dashboardVerdict(st, good)!;
    expect(v.tone).toBe("warn");
    expect(text(v.headline)).toMatch(/latência alta agora: 180 ms/);
  });
  it("antena inacessível vira falha; sem resposta ainda, sem dados", () => {
    expect(dashboardVerdict({ available: false, dish_reachable: false, reason: "x", error_kind: "timeout" }, good)!.tone).toBe("crit");
    expect(dashboardVerdict(undefined, good)).toBeNull();
  });
  it("sem medições de 24 h, não inventa avaliação do dia", () => {
    expect(text(dashboardVerdict(status("conectada"), null)!.headline)).toMatch(/não têm medições suficientes/);
  });
});

describe("veredito da Qualidade", () => {
  it("agrupa horas consecutivas, inclusive na virada do dia", () => {
    expect(hourRanges([19, 20, 21, 22])).toEqual(["19h–22h"]);
    expect(hourRanges([23, 0, 1, 5])).toEqual(["05h", "23h–01h"]);
  });
  it("sem observação, tom 'sem dados'", () => {
    const q = { observed_seconds: 0, availability_pct: null, loss_pct: null, latency_p50_ms: null, by_hour: [], coverage: 0 } as unknown as Quality;
    expect(qualityVerdict(q, "24h").tone).toBe("unknown");
  });
});

describe("veredito do Consumo", () => {
  const plan = (over: Partial<UsagePlan>): UsagePlan => ({
    configured: true, cap_bytes: 100e9, cycle_start_day: 1, cycle_start: 0, cycle_end: 86400 * 30, days_remaining: 10,
    used: { start: 0, end: 1, bytes_download: 0, bytes_upload: 0, bytes_total: 70e9, observed_seconds: 1, coverage: 1, source: "calculada" },
    pct_used: 70, remaining_bytes: 30e9, lower_bound: false, projection: { available: true, bytes_total: 130e9 }, projected_pct: 130, source: "calculada", method: "", ...over,
  });
  it("projeção acima da franquia avisa que vai estourar", () => {
    const v = usageVerdict(plan({}), undefined)!;
    expect(v.tone).toBe("warn");
    expect(text(v.headline)).toMatch(/deve estourar/);
    expect(v.dailyBudget).toBe(3e9);
  });
  it("sem franquia, não responde se vai estourar", () => {
    expect(usageVerdict(plan({ configured: false }), undefined)!.tone).toBe("unknown");
  });
  it("com lacunas, o consumo é apresentado como mínimo", () => {
    expect(text(usageVerdict(plan({ lower_bound: true }), undefined)!.headline)).toMatch(/pelo menos/);
  });
});

describe("fatos dos Eventos", () => {
  it("antena inacessível não conta como queda", () => {
    const ev = (id: number, kind: string, s: number) => ({ id, terminal_id: null, kind, cause: null, start_ts: id * 100, end_ts: id * 100 + s, duration_s: s, confidence: "derivado" as const, evidence: {}, open: false });
    const f = outageFacts([ev(1, "ping_drop", 10), ev(2, "unreachable", 600), ev(3, "outage", 40)]);
    expect(f.drops).toHaveLength(2);
    expect(f.total).toBe(50);
    expect(f.unreachable).toHaveLength(1);
    expect(f.longest?.id).toBe(3);
  });
});
