import type { UsagePlan, UsageWindow } from "@orbitlink/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlanCard } from "./usage";

const used = (bytes: number, coverage: number): UsageWindow => ({
  start: 0, end: 1, bytes_download: bytes * 0.9, bytes_upload: bytes * 0.1, bytes_total: bytes, observed_seconds: 100, coverage, source: "calculada",
});

const plan = (over: Partial<UsagePlan>): UsagePlan => ({
  configured: true, cap_bytes: 100e9, cycle_start_day: 1, cycle_start: 1_793_502_000, cycle_end: 1_796_094_000, days_remaining: 10,
  used: used(85e9, 1), pct_used: 85, remaining_bytes: 15e9, lower_bound: false,
  projection: { available: false, reason: "Menos de 3 dias com cobertura ≥ 50% neste período." }, projected_pct: null,
  source: "calculada", method: "", ...over,
});

describe("PlanCard (franquia)", () => {
  it("sem franquia, convida a configurar em vez de mostrar 0%", () => {
    render(<PlanCard p={plan({ configured: false, cap_bytes: null, pct_used: null })} />);
    expect(screen.getByText("Franquia do plano não configurada")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Configurar" })).toHaveAttribute("href", "/configuracoes");
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
  it("mostra o percentual e a barra limitada a 100%", () => {
    render(<PlanCard p={plan({ pct_used: 120, used: used(120e9, 1), remaining_bytes: 0 })} />);
    expect(screen.getByRole("progressbar", { name: "Franquia consumida" })).toHaveAttribute("aria-valuenow", "100");
  });
  it("com cobertura incompleta, apresenta o valor como mínimo (≥) e explica", () => {
    render(<PlanCard p={plan({ lower_bound: true, used: used(85e9, 0.7) })} />);
    expect(screen.getByText(/^≥ 85/)).toBeInTheDocument();
    expect(screen.getByText(/consumo real pode ser maior/)).toBeInTheDocument();
  });
  it("avisa quando a projeção ultrapassa a franquia", () => {
    render(<PlanCard p={plan({ projection: { available: true, bytes_total: 130e9, low: 120e9, high: 140e9, days_used: 5, source: "estimada" }, projected_pct: 130 })} />);
    expect(screen.getByText("deve ultrapassar")).toBeInTheDocument();
  });
});
