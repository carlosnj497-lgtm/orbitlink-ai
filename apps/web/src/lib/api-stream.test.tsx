import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentStream } from "./api";

class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static all: FakeEventSource[] = [];
  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeEventSource.all.push(this);
  }
  addEventListener() {}
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
  open() {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.();
  }
  die() {
    this.readyState = FakeEventSource.CLOSED;
    this.onerror?.();
  }
}

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;

describe("useAgentStream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.all = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reabre o canal sozinho quando ele fecha (ex.: agente reiniciando)", async () => {
    let agentUp = false;
    vi.stubGlobal("fetch", vi.fn(async () => (agentUp ? new Response("{}", { status: 200 }) : new Response("{}", { status: 502 }))));
    const { result, unmount } = renderHook(() => useAgentStream(), { wrapper });
    expect(FakeEventSource.all).toHaveLength(1);
    act(() => FakeEventSource.all[0].open());
    expect(result.current).toBe("open");

    act(() => FakeEventSource.all[0].die()); // agente caiu: o navegador desiste
    expect(result.current).toBe("reconnecting");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000); // 1ª tentativa: agente ainda fora (502)
    });
    expect(FakeEventSource.all).toHaveLength(1);

    agentUp = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000); // 2ª tentativa, com espera dobrada
    });
    expect(FakeEventSource.all).toHaveLength(2);
    act(() => FakeEventSource.all[1].open());
    expect(result.current).toBe("open");
    unmount();
  });
});

describe("errorText", () => {
  it("lê o detail em texto e o erro de validação do FastAPI sem quebrar", async () => {
    const { errorText } = await import("./api");
    expect(errorText({ detail: "Senha atual incorreta" }, 401)).toBe("Senha atual incorreta");
    expect(errorText({ detail: [{ loc: ["body", "new"], msg: "String should have at most 256 characters" }] }, 422)).toBe("Dados inválidos: String should have at most 256 characters");
    expect(errorText({}, 502)).toBe("Erro 502");
    expect(errorText(null, 500)).toBe("Erro 500");
  });
});
