import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import AssistantView from "./assistant";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("funciona quando scrollIntoView devolve uma Promise (Chrome recente)", async () => {
  // Nos Chrome atuais scrollIntoView() retorna Promise; antes isso virava a "limpeza" do efeito e quebrava a tela.
  Element.prototype.scrollIntoView = vi.fn(() => Promise.resolve()) as unknown as Element["scrollIntoView"];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("ai/status")
        ? Response.json({ configured: true, model: "openai/gpt-oss-120b", daily_limit: 50, usage: [] })
        : Response.json({
            conversation_id: 1,
            answer: "### Estado\n- Antena **inacessível**.",
            engine: "groq",
            model: "openai/gpt-oss-120b",
            tools_used: ["get_starlink_status"],
            proposal: null,
          }),
    ),
  );
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});

  const { unmount } = render(
    <QueryClientProvider client={new QueryClient()}>
      <AssistantView />
    </QueryClientProvider>,
  );
  await screen.findByText(/0\/50 hoje/);
  fireEvent.click(screen.getByText("Como está minha Starlink agora?"));
  expect(await screen.findByRole("heading", { name: "Estado" })).toBeInTheDocument();
  unmount();

  expect(errors.mock.calls.flat().join(" ")).not.toMatch(/is not a function/);
});

it("apaga todas as conversas do histórico depois de confirmar", async () => {
  Element.prototype.scrollIntoView = vi.fn() as unknown as Element["scrollIntoView"];
  const calls: { url: string; method: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET" });
      if (url.includes("ai/status")) return Response.json({ configured: true, model: "m", daily_limit: 50, usage: [] });
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (url.endsWith("ai/conversations"))
        return Response.json({
          conversations: [
            { id: 1, title: "Primeira", created_at: 1, updated_at: 1 },
            { id: 2, title: "Segunda", created_at: 2, updated_at: 2 },
          ],
        });
      return Response.json({});
    }),
  );

  render(
    <QueryClientProvider client={new QueryClient()}>
      <AssistantView />
    </QueryClientProvider>,
  );
  const [openAll] = await screen.findAllByRole("button", { name: /Apagar todas as conversas \(2\)/ });
  fireEvent.click(openAll);
  fireEvent.click(await screen.findByRole("button", { name: /Apagar 2 conversas/ }));
  await waitFor(() => expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual(["/api/agent/ai/conversations/1", "/api/agent/ai/conversations/2"]));
});
