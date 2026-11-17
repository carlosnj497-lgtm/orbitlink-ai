import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const data: Record<string, unknown> = {};
vi.mock("@/lib/api", () => ({
  useAgent: (path: string) => ({ data: data[path], error: null, isLoading: !(path in data) }),
  useStatusInterval: (ms: number) => ms,
}));

import { SystemDiagram } from "./system-diagram";

const status = {
  available: true,
  dish_reachable: true,
  age_s: 5,
  stale: false,
  status: {
    observed_at: "2026-11-16T00:00:00Z",
    origin: "grpc",
    state: "conectada",
    state_reason: null,
    device: { terminal_key: null, hardware_version: null, software_version: null, board_rev: null, bootcount: null },
    metrics: { obstruction_pct: { value: 1.8, unit: "%", source: "real" }, currently_obstructed: { value: false, source: "real" } },
    alerts: [],
    outage: null,
    fields_present: [],
    fields_missing: [],
  },
};

describe("SystemDiagram", () => {
  beforeEach(() => {
    for (const k of Object.keys(data)) delete data[k];
  });

  it("cada peça leva à tela dela e a peça da tela atual fica marcada", () => {
    render(<SystemDiagram current="esp32" />);
    expect(screen.getByRole("link", { name: /Antena/ })).toHaveAttribute("href", "/antena");
    expect(screen.getByRole("link", { name: /Céu/ })).toHaveAttribute("href", "/obstrucoes");
    expect(screen.getByRole("link", { name: /Roteador/ })).toHaveAttribute("href", "/dispositivos#roteador");
    expect(screen.getByRole("link", { name: /Controle/ })).toHaveAttribute("href", "/controle");
    expect(screen.getByRole("link", { name: /ESP32/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Antena/ })).not.toHaveAttribute("aria-current");
  });

  it("roteador sem resposta mostra 'sem leitura' para os aparelhos, nunca zero", () => {
    data.status = status;
    data.devices = { source: "indisponivel", reason: "Roteador não configurado.", devices: [], capability: null };
    data["esp32/nodes"] = { enabled: true, nodes: [] };
    render(<SystemDiagram current="aparelhos" />);
    const devices = screen.getByRole("link", { name: /Aparelhos/ });
    expect(devices).toHaveTextContent("Sem leitura");
    expect(devices).not.toHaveTextContent(/\b0\b/);
    expect(screen.getByRole("link", { name: /Roteador/ })).toHaveTextContent("Não consultado");
    expect(screen.getByRole("img", { name: "Enlace rede local: sem comunicação" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Enlace satélite: com comunicação" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ESP32/ })).toHaveTextContent("Não pareado");
  });

  it("mostra a leitura real da antena e do céu", () => {
    data.status = status;
    render(<SystemDiagram current="antena" />);
    expect(screen.getByRole("link", { name: /Antena/ })).toHaveTextContent("Conectada");
    expect(screen.getByRole("link", { name: /Céu/ })).toHaveTextContent("obstruído");
  });
});
