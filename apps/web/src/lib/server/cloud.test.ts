import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { cloudGet, cloudMutate, localMidnight } = await import("./cloud-api");
const { translateAuthError, jwtExp, jwtEmail, CloudError } = await import("./cloud");

type Call = { url: string; body: unknown };
let calls: Call[];

function mockSupabase(handlers: Record<string, unknown>) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url, body });
      const key = Object.keys(handlers).find((k) => url.includes(k));
      if (!key) return new Response(JSON.stringify({ message: "não simulado" }), { status: 500 });
      return new Response(JSON.stringify(handlers[key]), { status: 200 });
    }),
  );
}

beforeEach(() => {
  process.env.ASTRYON_SUPABASE_URL = "https://exemplo.supabase.co";
  process.env.ASTRYON_SUPABASE_ANON_KEY = "anon";
});
afterEach(() => vi.unstubAllGlobals());

const now = Math.floor(Date.now() / 1000);
const STATUS = {
  workspace_id: "ws", workspace_name: "Minha Starlink", agents: 1, agent_last_seen: now,
  terminal: { name: "Mini", hardware_version: "mini1", software_version: "2026.11" },
  heartbeat: { ts: now, dish_reachable: true, version: "0.1.0", sync_pending: 0 },
  last_minute: { ts: now - 120, latency_ms: 31.5, drop_pct: 7.2, power_w: 22, down_mbps: 12.3, up_mbps: 1.1 },
};

describe("adaptador da nuvem", () => {
  it("monta o status a partir do último minuto sincronizado", async () => {
    mockSupabase({ "rpc/cloud_status": STATUS });
    const r = (await cloudGet("tok", "status", new URLSearchParams())) as { available: boolean; status: { state: string; metrics: Record<string, { value: number }> }; stale: boolean };
    expect(r.available).toBe(true);
    expect(r.status.state).toBe("degradada"); // perda >= 5%
    expect(r.status.metrics.pop_latency_ms.value).toBe(31.5);
    expect(r.stale).toBe(false);
    expect(calls[0].url).toContain("/rest/v1/rpc/cloud_status");
  });

  it("sem agente conectado explica o que fazer", async () => {
    mockSupabase({ "rpc/cloud_status": { ...STATUS, agents: 0, last_minute: null, heartbeat: null } });
    const r = (await cloudGet("tok", "status", new URLSearchParams())) as { available: boolean; reason: string };
    expect(r.available).toBe(false);
    expect(r.reason).toContain("Conecte");
  });

  it("telemetria com balde de pelo menos 1 minuto e pontos numéricos", async () => {
    mockSupabase({ "rpc/cloud_telemetry": [{ t: now - 3600, n: 3600, down_mbps: "5.5", up_mbps: 0.5, down_max_mbps: 40, up_max_mbps: 4, latency_ms: 30, drop_pct: 0.5, power_w: 21, source: "calculada" }] });
    const r = (await cloudGet("tok", "telemetry", new URLSearchParams("range=24h"))) as { bucket_s: number; points: { down_mbps: number }[]; series_source: string };
    expect(r.bucket_s).toBeGreaterThanOrEqual(120);
    expect(r.points[0].down_mbps).toBe(5.5);
    expect(r.series_source).toBe("minute_aggregates");
    expect((calls[0].body as { p_bucket: number }).p_bucket).toBe(r.bucket_s);
  });

  it("eventos via PostgREST, com filtro de período e tipo", async () => {
    mockSupabase({ "connection_events?": [{ id: "u1", kind: "ping_drop", cause: null, start_ts: new Date((now - 60) * 1000).toISOString(), end_ts: null, duration_s: null, confidence: "derivado", evidence: {} }] });
    const r = (await cloudGet("tok", "events", new URLSearchParams("range=7d&kind=ping_drop&limit=50"))) as { events: { open: boolean; start_ts: number }[] };
    expect(r.events[0].open).toBe(true);
    expect(r.events[0].start_ts).toBe(now - 60);
    expect(calls[0].url).toContain("kind=eq.ping_drop");
    expect(calls[0].url).toContain("limit=50");
  });

  it("rotas do painel local respondem 404 com explicação", async () => {
    mockSupabase({});
    await expect(cloudGet("tok", "ai/status", new URLSearchParams())).rejects.toMatchObject({ status: 404 });
    await expect(cloudMutate("tok", "POST", "control/prepare", {})).rejects.toBeInstanceOf(CloudError);
  });

  it("gera código de pareamento no workspace da pessoa", async () => {
    mockSupabase({ "rpc/cloud_status": STATUS, "rpc/create_pairing_code": { code: "K7QF-2M9X", expires_at: "x" } });
    const r = (await cloudMutate("tok", "POST", "cloud/pairing-code", { name: "Sítio" })) as { code: string };
    expect(r.code).toBe("K7QF-2M9X");
    expect(calls[1].body).toEqual({ p_workspace: "ws", p_name: "Sítio" });
  });

  it("excluir conta exige a palavra de confirmação", async () => {
    mockSupabase({ "rpc/delete_my_account": null });
    await expect(cloudMutate("tok", "POST", "cloud/delete-account", { confirm: "sim" })).rejects.toMatchObject({ status: 422 });
    expect(calls).toHaveLength(0);
    await cloudMutate("tok", "POST", "cloud/delete-account", { confirm: "EXCLUIR" });
    expect(calls[0].url).toContain("rpc/delete_my_account");
  });
});

describe("auxiliares", () => {
  it("0h local no fuso de São Paulo (UTC−3)", () => {
    const t = Date.UTC(2026, 10, 15, 2, 30) / 1000; // 15/11 02:30 UTC = 14/11 23:30 em SP
    expect(localMidnight(t, "America/Sao_Paulo")).toBe(Date.UTC(2026, 10, 14, 3) / 1000);
    expect(localMidnight(t, "America/Sao_Paulo", -1)).toBe(Date.UTC(2026, 10, 13, 3) / 1000);
  });

  it("0h local usa o deslocamento do dia de destino no horário de verão", () => {
    const spring = Date.UTC(2026, 2, 9, 16) / 1000;
    expect(localMidnight(spring, "America/New_York", -1)).toBe(Date.UTC(2026, 2, 8, 5) / 1000);

    const autumn = Date.UTC(2026, 10, 2, 17) / 1000;
    expect(localMidnight(autumn, "America/New_York", -1)).toBe(Date.UTC(2026, 10, 1, 4) / 1000);
  });

  it("traduz erros do Supabase Auth", () => {
    expect(translateAuthError("Invalid login credentials", 400)).toBe("E-mail ou senha incorretos.");
    expect(translateAuthError("Email not confirmed", 400)).toContain("Confirme o e-mail");
    expect(translateAuthError("User already registered", 422)).toContain("já tem conta");
    expect(translateAuthError("boom", 503)).toContain("indisponível");
  });

  it("lê expiração e e-mail do token", () => {
    const payload = Buffer.from(JSON.stringify({ exp: 123, email: "a@b.c" })).toString("base64url");
    const tok = `x.${payload}.y`;
    expect(jwtExp(tok)).toBe(123);
    expect(jwtEmail(tok)).toBe("a@b.c");
    expect(jwtExp("lixo")).toBe(0);
  });
});
