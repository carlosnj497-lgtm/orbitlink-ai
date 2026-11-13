import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { CoverageBar, DemoBanner, MetricCard, QueryError, SourceBadge, StatePill } from "./domain";

describe("SourceBadge", () => {
  it("identifica a origem do dado", () => {
    render(<SourceBadge source="real" />);
    expect(screen.getByText("real")).toBeInTheDocument();
  });
  it("trata origem ausente como indisponível", () => {
    render(<SourceBadge source={null} />);
    expect(screen.getByText("indisponível")).toBeInTheDocument();
  });
  it("marca demonstração de forma inequívoca", () => {
    render(<SourceBadge source="demonstracao" />);
    expect(screen.getByLabelText(/Dado fictício/)).toBeInTheDocument();
  });
});

describe("MetricCard", () => {
  it("mostra esqueleto enquanto carrega, sem número", () => {
    const { container } = render(<MetricCard label="Download agora" value="12" loading />);
    expect(container.querySelector(".skeleton")).not.toBeNull();
    expect(screen.queryByText("12")).toBeNull();
  });
  it("exibe travessão quando não há dado (nunca zero inventado)", () => {
    render(<MetricCard label="Latência" value="—" source="indisponivel" />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("indisponível")).toBeInTheDocument();
  });
  it("mostra valor, unidade e rodapé", () => {
    render(<MetricCard label="Upload" value="0" unit="Mbps" source="real" footer="Ocioso (sem tráfego no momento)" />);
    expect(screen.getByText("Mbps")).toBeInTheDocument();
    expect(screen.getByText(/Ocioso/)).toBeInTheDocument();
  });
});

describe("StatePill", () => {
  it("distingue antena inacessível", () => {
    render(<StatePill state="inalcancavel" />);
    expect(screen.getByText("Antena inacessível")).toBeInTheDocument();
  });
  it("mostra estado degradado", () => {
    render(<StatePill state="degradada" />);
    expect(screen.getByText("Degradada")).toBeInTheDocument();
  });
});

describe("QueryError", () => {
  it("explica agente offline", () => {
    render(<QueryError error={new ApiError(502, "x", "agent_offline")} />);
    expect(screen.getByText("Agente OrbitLink offline")).toBeInTheDocument();
  });
  it("mostra mensagem genérica de falha", () => {
    render(<QueryError error={new ApiError(500, "falhou geral")} />);
    expect(screen.getByText("falhou geral")).toBeInTheDocument();
  });
});

describe("CoverageBar / DemoBanner", () => {
  it("mostra a cobertura percentual", () => {
    render(<CoverageBar coverage={0.42} />);
    expect(screen.getByText(/cobertura 42%/)).toBeInTheDocument();
  });
  it("faixa de demonstração é visível", () => {
    render(<DemoBanner />);
    expect(screen.getByRole("note")).toHaveTextContent(/dados fictícios/i);
  });
});
