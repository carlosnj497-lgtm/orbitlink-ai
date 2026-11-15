import type { ConnectionEvent, EventsResponse } from "@astryon/shared";
import { sseAgentSchema, sseStatusSchema } from "@astryon/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseRecoveryLink } from "@/app/login/redefinir/reset-form";
import { OutagesCard } from "@/views/dashboard/cards";
import { monthComparison } from "@/views/usage";
import { __setClockOffsetMs, downloadFrom, noteServerDate, parseSse, requestJson, serverNow } from "./api";
import { DemoProvider } from "./demo-context";
import { displayTimezone, localDayKey, setDisplayTimezone, usageForToday } from "./format";
import { DAY, summarizeOutages } from "./outages";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  __setClockOffsetMs(0);
});

function wrap(children: ReactNode, demo = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return demo ? <DemoProvider>{tree}</DemoProvider> : tree;
}

const ev = (over: Partial<ConnectionEvent>): ConnectionEvent => ({
  id: 1, terminal_id: null, kind: "outage", cause: null, start_ts: 0, end_ts: null, duration_s: null, confidence: "confirmado", evidence: {}, open: false, ...over,
});

describe("interrupções nas últimas 24 h", () => {
  const end = 2_000_000_000;

  it("queda longa iniciada ontem e ainda aberta conta, com a duração cortada na janela", () => {
    const s = summarizeOutages([ev({ start_ts: end - 30 * 3600, open: true })], end);
    expect(s.last).toHaveLength(1);
    expect(s.total).toBe(DAY);
    expect(s.last[0].start).toBe(end - DAY);
  });

  it("queda encerrada antes da janela não conta; a que cruza o início conta só a parte dentro", () => {
    const s = summarizeOutages(
      [
        ev({ id: 1, start_ts: end - 30 * 3600, end_ts: end - 26 * 3600, duration_s: 4 * 3600 }),
        ev({ id: 2, start_ts: end - 25 * 3600, end_ts: end - 23 * 3600, duration_s: 2 * 3600 }),
        ev({ id: 3, kind: "boot", start_ts: end - 3600, end_ts: end - 3600, duration_s: 0 }),
      ],
      end,
    );
    expect(s.last.map((o) => o.event.id)).toEqual([2]);
    expect(s.total).toBe(3600);
    expect(s.previousCount).toBe(2);
  });

  it("o card mostra a queda em andamento em vez de '0 interrupções'", () => {
    const events: EventsResponse = { start: end - 7 * DAY, end, gaps: [], events: [ev({ start_ts: end - 30 * 3600, open: true })] };
    render(wrap(<OutagesCard events={events} error={null} />));
    expect(screen.getByText("interrupção")).toBeInTheDocument();
    expect(screen.getAllByText("1d 0h")).toHaveLength(2); // total fora do ar e maior queda
  });
});

describe("/demo/conta", () => {
  it("não chama a API real: botões de excluir, baixar e gerar código ficam desativados", async () => {
    const fetchMock = vi.fn(async () => Response.json({}));
    vi.stubGlobal("fetch", fetchMock);
    const { default: AccountView } = await import("@/views/account");
    render(wrap(<AccountView />, true));
    await screen.findByText("Starlink Mini (demonstração)");
    const user = userEvent.setup();
    const input = screen.getByLabelText("Digite EXCLUIR para confirmar");
    expect(input).toBeDisabled();
    for (const name of [/Excluir minha conta/, /Baixar meus dados/, /Gerar código/, /Remover acesso/]) {
      const b = screen.getByRole("button", { name });
      expect(b).toBeDisabled();
      await user.click(b);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("relógio do servidor", () => {
  it("usa o cabeçalho Date para corrigir o relógio do aparelho adiantado", () => {
    const receivedAt = Date.now();
    const server = new Date(receivedAt - 5 * 60_000); // aparelho 5 min adiantado
    noteServerDate(new Response(null, { headers: { date: server.toUTCString() } }), receivedAt);
    expect(Math.abs(serverNow() - server.getTime() / 1000)).toBeLessThan(2);
  });
});

describe("comparação mês a mês", () => {
  const w = (bytes: number) => ({ start: 0, end: 1, bytes_download: bytes, bytes_upload: 0, bytes_total: bytes, observed_seconds: 1, coverage: 1, source: "calculada" as const });
  it("compara com o mesmo trecho do mês anterior; sem esse dado, não compara", () => {
    expect(monthComparison({ month: w(15e9), previous_month_to_date: w(10e9) })).toBeCloseTo(50);
    expect(monthComparison({ month: w(15e9) })).toBeNull();
    expect(monthComparison({ month: w(15e9), previous_month_to_date: w(0) })).toBeNull();
  });
});

describe("uso de IA de hoje", () => {
  it("pega a linha de hoje no fuso do agente, não a primeira da lista (que pode ser de ontem)", () => {
    const before = displayTimezone();
    setDisplayTimezone("America/Sao_Paulo", false);
    const now = Date.parse("2026-11-15T01:00:00Z") / 1000; // 14/11 22h em São Paulo
    expect(localDayKey(now)).toBe("2026-11-14");
    const rows = [{ day: "2026-11-15", requests: 3 }, { day: "2026-11-14", requests: 18 }];
    expect(usageForToday(rows, now)?.requests).toBe(18);
    expect(usageForToday([{ day: "2026-11-13", requests: 9 }], now)).toBeUndefined();
    setDisplayTimezone(before, false);
  });
});

describe("downloads e requisições", () => {
  it("erro no download vira exceção, não um arquivo com a mensagem de erro", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ detail: "Falha ao consultar a nuvem." }, { status: 502 })));
    await expect(downloadFrom("/api/agent/cloud/export", "x.json")).rejects.toMatchObject({ status: 502, message: "Falha ao consultar a nuvem." });
  });
  it("requestJson nunca lança: rede fora e 204 são tratados", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    expect(await requestJson("/x", {}, "sem rede")).toMatchObject({ ok: false, status: 0, error: "sem rede" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    expect(await requestJson("/x", { json: {} })).toMatchObject({ ok: true, status: 204, data: null });
  });
});

describe("SSE validado", () => {
  it("descarta payload malformado", () => {
    expect(parseSse("{", sseStatusSchema)).toBeNull();
    expect(parseSse(JSON.stringify({ state: 1 }), sseStatusSchema)).toBeNull();
    expect(parseSse(JSON.stringify({ observed_at: "x", state: "conectada", metrics: {} }), sseStatusSchema)).not.toBeNull();
    expect(parseSse(JSON.stringify({ version: "1", mode: "real", dish_reachable: false }), sseAgentSchema)).toMatchObject({ dish_reachable: false });
  });
});

describe("link de recuperação de senha", () => {
  it("lê a sessão do fragmento, o token_hash da query e o erro do link expirado", () => {
    expect(parseRecoveryLink("#access_token=a&refresh_token=r&type=recovery", "")).toEqual({ access_token: "a", refresh_token: "r" });
    expect(parseRecoveryLink("", "?token_hash=abc&type=recovery")).toEqual({ token_hash: "abc" });
    expect(parseRecoveryLink("#error=access_denied&error_description=Email+link+is+invalid+or+has+expired", "")).toEqual({ error: "Email link is invalid or has expired" });
    expect(parseRecoveryLink("", "")).toBeNull();
  });
});

describe("confirmação de reboot", () => {
  it("com o comando em execução, não dá para cancelar nem fechar a janela", async () => {
    let release: (v: Response) => void = () => {};
    const cancelCalls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("control/actions")) return Promise.resolve(Response.json({ policy: "p", actions: [{ action: "reboot", label: "Reiniciar", consequences: [], capability: null, enabled: true, reason: null }] }));
        if (url.includes("control/prepare")) return Promise.resolve(Response.json({ operation_id: "op-123456789", nonce: "n", expires_at: Math.floor(Date.now() / 1000) + 120, label: "Reiniciar", target: "antena", confirm_text: "REINICIAR", consequences: [] }));
        if (url.includes("control/confirm")) return new Promise<Response>((r) => (release = r));
        if (url.includes("control/cancel")) cancelCalls.push(url);
        if (url.includes("control/requests")) return Promise.resolve(Response.json({ requests: [], audit: [] }));
        return Promise.resolve(Response.json({ checked_at: null, capabilities: [] }));
      }),
    );
    const { default: ControlView } = await import("@/views/control");
    render(wrap(<ControlView />));
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Reiniciar…/ }));
    await user.type(await screen.findByLabelText(/para confirmar/), "REINICIAR");
    await user.click(screen.getByRole("button", { name: /Executar agora/ }));
    await screen.findByText(/não é mais possível cancelar/);
    expect(screen.queryByRole("button", { name: "Cancelar" })).toBeNull();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(cancelCalls).toEqual([]);
    release(Response.json({ status: "accepted", detail: "Reinício aceito." }));
    await waitFor(() => expect(screen.getByText("Reinício aceito.")).toBeInTheDocument());
  });
});
