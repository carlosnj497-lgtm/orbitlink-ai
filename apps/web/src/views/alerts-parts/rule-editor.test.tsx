import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Kinds, Rule } from "./phrases";
import { RuleEditor } from "./rule-editor";
import { RuleRow, RuleSentence } from "./rule-row";

const kinds: Kinds = {
  latency_high: { label: "Latência alta (média na janela)", unit: "ms", operator: "gt" },
  loss_high: { label: "Perda de ping elevada (média na janela)", unit: "%", operator: "gt" },
  dish_rebooted: { label: "Antena reiniciou", unit: "eventos", operator: "gt" },
  server_disk_low: { label: "Pouco espaço livre no disco do servidor", unit: "%", operator: "lt" },
};

const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

const rule = (over: Partial<Rule>): Rule => ({
  id: 1, name: "Latência alta", kind: "latency_high", operator: "gt", threshold: 100, min_duration_s: 300, window_s: 300,
  severity: "warn", cooldown_s: 900, hysteresis: 0.1, enabled: true, silenced_until: null, last_event: null,
  current: { value: 42, measured_at: 1 }, breaching_since: null, ...over,
});

afterEach(() => vi.restoreAllMocks());

describe("frase da regra", () => {
  it("lê a condição em português, com limite e duração", () => {
    render(<p><RuleSentence r={rule({})} kinds={kinds} /></p>);
    expect(screen.getByText(/Avise quando a latência média passar de/)).toBeInTheDocument();
    expect(screen.getByText(/^100\s+ms$/)).toBeInTheDocument();
    expect(screen.getByText(/^5\s+min$/)).toBeInTheDocument();
  });
  it("acontecimento não tem limite", () => {
    render(<p><RuleSentence r={rule({ kind: "dish_rebooted", threshold: 0 })} kinds={kinds} /></p>);
    expect(screen.getByText("Avise quando a antena reiniciar")).toBeInTheDocument();
  });
});

describe("linha da regra", () => {
  const row = (r: Rule) => render(<ul><RuleRow r={r} kinds={kinds} now={1000} demo={false} onToggle={() => {}} onSilence={() => {}} onEdit={() => {}} onDelete={() => {}} /></ul>);
  it("mostra o valor de agora no medidor", () => {
    row(rule({}));
    expect(screen.getByRole("meter", { name: "Valor atual de Latência alta" })).toHaveAttribute("aria-valuenow", "42");
    expect(screen.getByText(/^42\s+ms$/)).toBeInTheDocument();
  });
  it("sem dado recente, diz 'sem leitura' em vez de zero", () => {
    row(rule({ current: { value: null, measured_at: 1 } }));
    expect(screen.getByText("sem leitura")).toBeInTheDocument();
    expect(screen.queryByRole("meter")).toBeNull();
  });
  it("além do limite, conta quanto falta para disparar", () => {
    row(rule({ current: { value: 150, measured_at: 1 }, breaching_since: 900 }));
    expect(screen.getByText(/dispara em 4 min se continuar/)).toBeInTheDocument();
  });
});

describe("editor de regra", () => {
  it("modelo pronto preenche a frase e o nome; salvar envia o corpo do agente", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 201, headers: { "Content-Type": "application/json" } }));
    const done = vi.fn();
    wrap(<RuleEditor initial={null} kinds={kinds} onDone={done} />);
    fireEvent.click(screen.getByRole("button", { name: "Perda de pacotes" }));
    expect(screen.getByLabelText("Nome da regra")).toHaveValue("Perda de pacotes alta");
    expect(screen.getByLabelText("Limite")).toHaveValue(2);
    fireEvent.click(screen.getByRole("radio", { name: "crítico" }));
    fireEvent.click(screen.getByRole("button", { name: /Criar regra/ }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/agent/alerts/rules");
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({ kind: "loss_high", threshold: 2, severity: "crit", name: "Perda de pacotes alta" });
  });
  it("acontecimento esconde o limite e salva limite 0", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
    wrap(<RuleEditor initial={rule({ kind: "dish_rebooted", name: "Antena reiniciou", threshold: 5 })} kinds={kinds} onDone={() => {}} />);
    expect(screen.queryByLabelText("Limite")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Salvar regra/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)).threshold).toBe(0);
  });
});
