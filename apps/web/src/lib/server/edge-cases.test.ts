import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const agentFetch = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>();
vi.mock("@/lib/server/agent", async () => {
  const real = await vi.importActual<typeof import("./agent")>("./agent");
  return { ...real, agentFetch: (path: string, init?: RequestInit) => agentFetch(path, init) };
});

const { relay } = await import("./relay");
const { clientIp } = await import("./client-ip");
const { cloudGet, localMonthStart, summaryBounds, range } = await import("./cloud-api");
const { cloudConfigError, restErrorText, rest } = await import("./cloud");
const authRoute = await import("@/app/api/auth/[action]/route");

const params = (action: string) => ({ params: Promise.resolve({ action }) });

beforeEach(() => {
  process.env.ASTRYON_SUPABASE_URL = "https://exemplo.supabase.co";
  process.env.ASTRYON_SUPABASE_ANON_KEY = "anon";
  agentFetch.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.ASTRYON_CLOUD;
  delete process.env.NEXT_PUBLIC_ASTRYON_CLOUD;
});

describe("relay (resposta do agente → navegador)", () => {
  it("204 do agente vira 204 sem corpo (NextResponse.json lançaria exceção)", async () => {
    const r = await relay(new Response(null, { status: 204 }));
    expect(r.status).toBe(204);
    expect(await r.text()).toBe("");
  });
  it("erro com corpo inválido vira detail legível, sem 500", async () => {
    const r = await relay(new Response("<html>", { status: 502 }));
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ detail: "Erro 502 no agente." });
  });
});

describe("rota /api/auth/password (painel local)", () => {
  it("troca de senha com 204 do agente responde 204, não 500", async () => {
    agentFetch.mockResolvedValue(new Response(null, { status: 204 }));
    const req = new NextRequest("http://localhost/api/auth/password", {
      method: "POST",
      body: JSON.stringify({ old_password: "a", new_password: "b" }),
      headers: { cookie: "astryon_session=s", "content-type": "application/json" },
    });
    const res = await authRoute.POST(req, params("password"));
    expect(res.status).toBe(204);
    expect(agentFetch).toHaveBeenCalledWith("/v1/auth/password", expect.objectContaining({ session: "s" }));
  });

  it("recover não exige sessão: quem esqueceu a senha não tem uma", async () => {
    agentFetch.mockResolvedValue(new Response(null, { status: 204 }));
    const req = new NextRequest("http://localhost/api/auth/recover", {
      method: "POST",
      body: JSON.stringify({ username: "admin", new_password: "x", recovery_code: "c" }),
      headers: { "content-type": "application/json" },
    });
    const res = await authRoute.POST(req, params("recover"));
    expect(res.status).toBe(204);
    expect(agentFetch).toHaveBeenCalledWith("/v1/auth/recover", expect.objectContaining({ method: "POST" }));
  });

  it("recover por e-mail não exige sessão e repassa o IP do último salto", async () => {
    agentFetch.mockResolvedValue(new Response(null, { status: 204 }));
    const req = new NextRequest("http://localhost/api/auth/recover-request", {
      method: "POST",
      body: JSON.stringify({ email: "admin@exemplo.com" }),
      headers: { "x-forwarded-for": "6.6.6.6, 192.168.1.20", "content-type": "application/json" },
    });
    const res = await authRoute.POST(req, params("recover-request"));
    expect(res.status).toBe(204);
    const [path, init] = agentFetch.mock.calls[0];
    expect(path).toBe("/v1/auth/recover/request");
    expect((init?.headers as Record<string, string>)["X-Forwarded-For"]).toBe("192.168.1.20");
    expect(init).not.toHaveProperty("session");
  });

  it("recover-confirm repassa o código ao agente sem sessão", async () => {
    agentFetch.mockResolvedValue(new Response(null, { status: 204 }));
    const req = new NextRequest("http://localhost/api/auth/recover-confirm", {
      method: "POST",
      body: JSON.stringify({ email: "admin@exemplo.com", code: "ABCD-EFGH", new_password: "senha-nova-123" }),
      headers: { "content-type": "application/json" },
    });
    const res = await authRoute.POST(req, params("recover-confirm"));
    expect(res.status).toBe(204);
    expect(agentFetch).toHaveBeenCalledWith("/v1/auth/recover/confirm", expect.objectContaining({ method: "POST" }));
  });

  it("e-mail de recuperação é salvo com a sessão do usuário", async () => {
    agentFetch.mockResolvedValue(new Response(null, { status: 204 }));
    const req = new NextRequest("http://localhost/api/auth/email", {
      method: "POST",
      body: JSON.stringify({ email: "novo@exemplo.com" }),
      headers: { cookie: "astryon_session=s", "content-type": "application/json" },
    });
    const res = await authRoute.POST(req, params("email"));
    expect(res.status).toBe(204);
    expect(agentFetch).toHaveBeenCalledWith("/v1/auth/email", expect.objectContaining({ session: "s" }));
  });

  it("cadastro do administrador leva o e-mail ao agente", async () => {
    agentFetch.mockResolvedValueOnce(Response.json({ user_id: 1 }, { status: 201 }));
    agentFetch.mockResolvedValueOnce(Response.json({ session: "t", expires_at: 0 }));
    const req = new NextRequest("http://localhost/api/auth/setup", {
      method: "POST",
      body: JSON.stringify({ username: "admin", password: "senha-forte-123", email: "admin@exemplo.com" }),
      headers: { "content-type": "application/json" },
    });
    const res = await authRoute.POST(req, params("setup"));
    expect(res.status).toBe(200);
    const body = JSON.parse(String(agentFetch.mock.calls[0][1]?.body)) as Record<string, string>;
    expect(body.email).toBe("admin@exemplo.com");
  });

  it("login repassa ao agente o IP do último salto, não o escolhido pelo cliente", async () => {
    agentFetch.mockResolvedValue(Response.json({ detail: "Usuário ou senha inválidos." }, { status: 401 }));
    const req = new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "admin", password: "x" }),
      headers: { "x-forwarded-for": "6.6.6.6, 192.168.1.20", "content-type": "application/json" },
    });
    const res = await authRoute.POST(req, params("login"));
    expect(res.status).toBe(401);
    const headers = agentFetch.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers["X-Forwarded-For"]).toBe("192.168.1.20");
  });
});

describe("clientIp", () => {
  it("prefere X-Real-IP (definido pelo Nginx) e, sem ele, o último item do X-Forwarded-For", () => {
    expect(clientIp(new Headers({ "x-real-ip": "10.0.0.5", "x-forwarded-for": "1.1.1.1" }))).toBe("10.0.0.5");
    expect(clientIp(new Headers({ "x-forwarded-for": "evil, 10.0.0.9" }))).toBe("10.0.0.9");
    expect(clientIp(new Headers())).toBe("local");
  });
});

describe("modo nuvem: fim do ciclo e limites do resumo", () => {
  const TZ = "America/Sao_Paulo";
  const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);

  it("próximo mês a partir de 29/01 é 01/02 (antes pulava para 01/03)", () => {
    expect(localMonthStart(at("2027-01-29T15:00:00-03:00"), TZ, -1)).toBe(at("2027-02-01T00:00:00-03:00"));
    expect(localMonthStart(at("2026-12-31T23:00:00-03:00"), TZ, -1)).toBe(at("2027-01-01T00:00:00-03:00"));
  });

  it("usage/plan em 29/01 termina o ciclo em 01/02 e faltam 3 dias", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-01-29T12:00:00-03:00"));
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ start: 0, end: 0, bytes_total: 0 })));
    const r = (await cloudGet("tok", "usage/plan", new URLSearchParams())) as { cycle_end: number; days_remaining: number };
    expect(r.cycle_end).toBe(at("2027-02-01T00:00:00-03:00"));
    expect(r.days_remaining).toBe(3);
  });

  it("semana começa na segunda (igual ao agente) e o mês anterior é comparado até o mesmo ponto", () => {
    const t = at("2026-11-12T10:00:00-03:00"); // quinta-feira
    const b = summaryBounds(t, TZ);
    expect(b.week).toBe(at("2026-11-09T00:00:00-03:00"));
    expect(b.previousMonth).toBe(at("2026-10-01T00:00:00-03:00"));
    expect(b.previousMonthToDate).toBe(at("2026-10-12T10:00:00-03:00"));
    // 31/03: o trecho equivalente de fevereiro é limitado ao fim de fevereiro
    const m = summaryBounds(at("2027-03-31T12:00:00-03:00"), TZ);
    expect(m.previousMonthToDate).toBe(at("2027-03-01T00:00:00-03:00"));
  });

  it("usage/summary manda previous_month_to_date", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ start: 0, end: 0, bytes_total: 1 })));
    const r = (await cloudGet("tok", "usage/summary", new URLSearchParams())) as Record<string, unknown>;
    expect(r.previous_month_to_date).toEqual({ start: 0, end: 0, bytes_total: 1 });
  });

  it("série mensal pede date_trunc por mês e calcula a cobertura sobre o mês inteiro", async () => {
    const t = at("2026-10-01T00:00:00-03:00");
    const fetchMock = vi.fn(async () => Response.json([{ t, bytes_download: 10, bytes_upload: 5, observed: 31 * 86400 }]));
    vi.stubGlobal("fetch", fetchMock);
    const r = (await cloudGet("tok", "usage/series", new URLSearchParams("range=90d&bucket=month"))) as { bucket: string; points: { coverage: number; bytes_total: number }[] };
    expect(r.bucket).toBe("month");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ p_bucket: "month" });
    const observed = r.points.find((p) => p.bytes_total === 15)!;
    expect(observed.coverage).toBeCloseTo(1);
  });
});

describe("modo nuvem: validação de parâmetros", () => {
  it("recusa start/end/range/limit inválidos e janelas longas demais", async () => {
    expect(() => range(new URLSearchParams("start=abc"), "1h")).toThrow(/start/);
    expect(() => range(new URLSearchParams("start=1"), "1h")).toThrow(/longo demais/);
    expect(() => range(new URLSearchParams("range=10y"), "1h")).toThrow(/range/);
    const e = Math.floor(Date.now() / 1000);
    expect(() => range(new URLSearchParams(`start=${e}&end=${e - 10}`), "1h")).toThrow(/antes do fim/);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([])));
    await expect(cloudGet("tok", "events", new URLSearchParams("limit=-1"))).rejects.toMatchObject({ status: 422 });
    await expect(cloudGet("tok", "events", new URLSearchParams({ kind: "ping_drop&or=(end_ts.is.null)" }))).rejects.toMatchObject({ status: 422 });
  });

  it("eventos incluem quedas que começaram antes da janela e seguem abertas", async () => {
    const fetchMock = vi.fn(async () => Response.json([]));
    vi.stubGlobal("fetch", fetchMock);
    await cloudGet("tok", "events", new URLSearchParams("range=24h"));
    const url = decodeURIComponent(String((fetchMock.mock.calls[0] as unknown as [string])[0]));
    expect(url).toContain("or=(end_ts.is.null,end_ts.gt.");
    expect(url).not.toContain("start_ts=gte.");
  });

  it("erro do PostgREST não vaza detalhes internos para o navegador", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ message: "permission denied for function apply_retention" }, { status: 403 })));
    await expect(rest("tok", "rpc/x")).rejects.toMatchObject({ status: 403, message: restErrorText(403) });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("coerência do modo nuvem", () => {
  it("acusa flags divergentes ou Supabase ausente", () => {
    expect(cloudConfigError({}, false)).toBeNull();
    expect(cloudConfigError({ ASTRYON_CLOUD: "1", ASTRYON_SUPABASE_URL: "u", ASTRYON_SUPABASE_ANON_KEY: "k" }, true)).toBeNull();
    expect(cloudConfigError({ ASTRYON_CLOUD: "1", ASTRYON_SUPABASE_URL: "u", ASTRYON_SUPABASE_ANON_KEY: "k" }, false)).toMatch(/construído sem/);
    expect(cloudConfigError({}, true)).toMatch(/construído para a nuvem/);
    expect(cloudConfigError({ ASTRYON_CLOUD: "1" }, true)).toMatch(/SUPABASE/);
  });
});

describe("logout revoga a sessão sem impedir a saída local por falha de rede", () => {
  it("nuvem chama GoTrue com Bearer server-side e limpa os dois cookies mesmo se a revogação falhar", async () => {
    process.env.ASTRYON_CLOUD = "1";
    process.env.NEXT_PUBLIC_ASTRYON_CLOUD = "1";
    const fetchMock = vi.fn(async () => Response.json({}));
    vi.stubGlobal("fetch", fetchMock);
    const req = () => new NextRequest("http://localhost/api/auth/logout", { method: "POST", headers: { cookie: "astryon_session=access-secreto; astryon_refresh=refresh-secreto" } });
    const res = await authRoute.POST(req(), params("logout"));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith("https://exemplo.supabase.co/auth/v1/logout?scope=local", expect.objectContaining({ method: "POST", headers: expect.objectContaining({ Authorization: "Bearer access-secreto", apikey: "anon" }) }));
    expect(res.headers.get("set-cookie")).toContain("astryon_session=;");
    expect(res.headers.get("set-cookie")).toContain("astryon_refresh=;");
    expect(await res.text()).not.toContain("access-secreto");

    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const offline = await authRoute.POST(req(), params("logout"));
    expect(offline.status).toBe(200);
    expect(offline.headers.get("set-cookie")).toContain("astryon_session=;");
  });

  it("painel local também apaga o cookie se o agente estiver fora", async () => {
    agentFetch.mockRejectedValue(new Error("offline"));
    const res = await authRoute.POST(new NextRequest("http://localhost/api/auth/logout", { method: "POST", headers: { cookie: "astryon_session=s" } }), params("logout"));
    expect(agentFetch).toHaveBeenCalledWith("/v1/auth/logout", expect.objectContaining({ method: "POST", session: "s" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("astryon_session=;");
  });
});

describe("rota /api/auth/reset (senha nova pelo link do e-mail)", () => {
  beforeEach(() => {
    process.env.ASTRYON_CLOUD = "1";
    process.env.NEXT_PUBLIC_ASTRYON_CLOUD = "1";
  });

  it("com a sessão do link, grava a senha (PUT /auth/v1/user) e abre a sessão", async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => Response.json({ id: "u" }));
    vi.stubGlobal("fetch", fetchMock);
    const req = new NextRequest("http://localhost/api/auth/reset", {
      method: "POST",
      body: JSON.stringify({ access_token: "a".repeat(40), refresh_token: "r", password: "senha-nova-123" }),
      headers: { "content-type": "application/json" },
    });
    const res = await authRoute.POST(req, params("reset"));
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://exemplo.supabase.co/auth/v1/user");
    expect(init?.method).toBe("PUT");
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${"a".repeat(40)}`);
    expect(res.headers.get("set-cookie")).toContain("astryon_session=");
  });

  it("token_hash é trocado por sessão antes de gravar a senha; senha curta é recusada", async () => {
    const fetchMock = vi.fn(async (url: string) => (url.endsWith("/verify") ? Response.json({ access_token: "t".repeat(40), refresh_token: "r", expires_at: 0, user: { id: "u" } }) : Response.json({})));
    vi.stubGlobal("fetch", fetchMock);
    const ok = await authRoute.POST(new NextRequest("http://localhost/api/auth/reset", { method: "POST", body: JSON.stringify({ token_hash: "abcdef123", password: "senha-nova-123" }) }), params("reset"));
    expect(ok.status).toBe(200);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["https://exemplo.supabase.co/auth/v1/verify", "https://exemplo.supabase.co/auth/v1/user"]);
    const short = await authRoute.POST(new NextRequest("http://localhost/api/auth/reset", { method: "POST", body: JSON.stringify({ token_hash: "abcdef123", password: "curta" }) }), params("reset"));
    expect(short.status).toBe(422);
  });

  it("'Esqueci a senha' manda o link para /login/redefinir", async () => {
    const fetchMock = vi.fn(async () => Response.json({}));
    vi.stubGlobal("fetch", fetchMock);
    await authRoute.POST(new NextRequest("http://localhost/api/auth/recover", { method: "POST", body: JSON.stringify({ email: "a@b.co" }) }), params("recover"));
    expect(decodeURIComponent(String((fetchMock.mock.calls[0] as unknown as [string])[0]))).toContain("redirect_to=http://localhost/login/redefinir");
  });
});
