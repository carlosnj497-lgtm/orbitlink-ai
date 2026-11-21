import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cloud-flag", () => ({
  CLOUD: true,
  CLOUD_SLUGS: ["", "consumo", "qualidade", "antena", "interrupcoes", "conta"],
}));
vi.mock("@/lib/api", () => ({
  useAgent: () => ({ data: undefined, isFetching: false }),
  useStatusInterval: () => 0,
}));
vi.mock("@/lib/demo-context", () => ({ useBasePath: () => "", useDemo: () => false }));
vi.mock("@/lib/use-now", () => ({ useNow: () => 1_700_000_000 }));
vi.mock("next/navigation", () => ({ usePathname: () => "/consumo" }));
vi.mock("next/image", () => ({ default: () => null }));

const { MobileTabBar } = await import("./AppShell");
const { Sidebar } = await import("./Sidebar");

function withProviders(ui: ReactElement) {
  return <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>;
}

describe("navegação no modo nuvem", () => {
  it("abas móveis não oferecem IA nem Ao Vivo", () => {
    render(withProviders(<MobileTabBar slug="consumo" onOpenMenu={() => undefined} menuOpen={false} />));
    expect(screen.getByRole("link", { name: "Consumo" })).toHaveAttribute("href", "/consumo");
    expect(screen.getByRole("link", { name: "Antena" })).toHaveAttribute("href", "/antena");
    expect(screen.getByRole("link", { name: "Eventos" })).toHaveAttribute("href", "/interrupcoes");
    expect(screen.queryByRole("link", { name: "Ao vivo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "IA" })).not.toBeInTheDocument();
  });

  it("menu lateral leva somente a páginas implementadas pela nuvem", () => {
    render(withProviders(<Sidebar />));
    expect(screen.getByRole("link", { name: "Conexão e Internet" })).toHaveAttribute("href", "/consumo");
    expect(screen.getByRole("link", { name: "Antena e Sinal" })).toHaveAttribute("href", "/antena");
    expect(screen.getByRole("link", { name: "Conta" })).toHaveAttribute("href", "/conta");
    expect(screen.queryByRole("link", { name: "Central de IA" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Configurações" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Dispositivos" })).not.toBeInTheDocument();
  });
});
