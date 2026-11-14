import type { StatusResponse, Telemetry, TelemetryPoint } from "@orbitlink/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetReadings } from "@/lib/live-buffer";
import LiveView, { windowStats } from "./live";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  useAgentStream: () => "open",
  useStatusInterval: () => 60_000,
}));

vi.mock("@/components/charts", () => ({
  TelemetryChart: ({ points, mode }: { points: Telemetry["points"]; mode: string }) => <div data-testid={`chart-${mode}`}>{points[0]?.down_mbps}</div>,
}));

const point = (over: Partial<TelemetryPoint>): TelemetryPoint => ({
  t: 1_794_657_601, n: 1, down_mbps: 12, up_mbps: 2, down_max_mbps: null, up_max_mbps: null, latency_ms: 30, drop_pct: 0, power_w: null, ...over,
});

function status(down: number): StatusResponse {
  return {
    available: true, dish_reachable: true, age_s: 0, stale: false,
    status: {
      observed_at: "2026-11-14T12:00:00Z", origin: "grpc", state: "conectada", state_reason: null,
      device: { terminal_key: null, hardware_version: null, software_version: null, board_rev: null, bootcount: null },
      metrics: { downlink_mbps: { value: down, source: "real" } },
      alerts: [], outage: null, fields_present: [], fields_missing: [],
    },
  };
}

function telemetry(down: number): Telemetry {
  return {
    start: 1_794_657_600, end: 1_794_658_500, bucket_s: 1, series_source: "history_1s", source: "real",
    coverage: 1, gaps: [], note: "", points: [point({ down_mbps: down })],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetReadings();
});

function mount(st: StatusResponse, tel: Telemetry) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(["agent", "status"], st);
  client.setQueryData(["agent", "telemetry?range=15m"], tel);
  client.setQueryData(["agent", "events?range=15m&limit=50"], { start: 0, end: 0, events: [], gaps: [] });
  render(
    <QueryClientProvider client={client}>
      <LiveView />
    </QueryClientProvider>,
  );
  return client;
}

describe("Monitoramento ao Vivo", () => {
  it("congela métricas, gráficos e CSV apesar de atualizações externas no cache; retomar usa os dados atuais", async () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => "blob:telemetry-test");
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = createObjectURL;
        static revokeObjectURL = vi.fn();
      },
    );
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const client = mount(status(12), telemetry(12));
    const reading = within(screen.getByRole("region", { name: "Download" }));
    expect(reading.getByText("12")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Pausar" }));
    act(() => {
      client.setQueryData(["agent", "status"], status(77));
      client.setQueryData(["agent", "telemetry?range=15m"], telemetry(77));
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Retomar" })).toBeVisible());
    expect(reading.getByText("12")).toBeInTheDocument();
    expect(screen.getByTestId("chart-traffic")).toHaveTextContent("12");
    expect(screen.getByRole("button", { name: "6 h" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Exportar CSV" }));
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    const csv = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob);
    });
    expect(csv).toContain(";12;2;30;0;");
    expect(csv).not.toContain(";77;");

    fireEvent.click(screen.getByRole("button", { name: "Retomar" }));
    await waitFor(() => expect(reading.getByText("77")).toBeInTheDocument());
    expect(screen.getByTestId("chart-traffic")).toHaveTextContent("77");
    expect(screen.getByRole("button", { name: "6 h" })).toBeEnabled();
    client.clear();
  });

  it("não confunde o canal SSE aberto com a antena conectada", () => {
    const client = mount(
      { available: false, dish_reachable: false, reason: "Sem conexão com endereço interno", error_kind: "timeout" },
      { ...telemetry(0), points: [], coverage: 0, series_source: "none", source: "indisponivel" },
    );
    expect(screen.getByText("SSE conectado")).toBeInTheDocument();
    expect(screen.getByText("Antena inacessível")).toBeInTheDocument();
    expect(screen.queryByText("Conectada", { exact: true })).toBeNull();
    expect(within(screen.getByRole("region", { name: "Download" })).getByText("—")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exportar CSV" })).toBeDisabled();
    expect(screen.queryByTestId("chart-traffic")).toBeNull();
    expect(screen.queryByText(/endereço interno/)).toBeNull();
    client.clear();
  });
});

describe("estatísticas da janela", () => {
  it("calcula média, pico, mediana, p95 e tempo sem resposta só com valores reais", () => {
    const pts = [
      point({ down_mbps: 10, down_max_mbps: 40, up_mbps: 1, latency_ms: 20, drop_pct: 0 }),
      point({ down_mbps: 30, up_mbps: 3, latency_ms: 40, drop_pct: 100 }),
      point({ down_mbps: null, up_mbps: null, latency_ms: null, drop_pct: null }),
      point({ down_mbps: 20, up_mbps: 2, latency_ms: 30, drop_pct: 2 }),
    ];
    const s = windowStats(pts, 2);
    expect(s.downAvg).toBe(20);
    expect(s.downPeak).toBe(40);
    expect(s.upAvg).toBe(2);
    expect(s.latP50).toBe(30);
    expect(s.latP95).toBe(30);
    expect(s.lossAvg).toBe(34);
    expect(s.fullDropS).toBe(2);
  });
});
