import { type NextRequest, NextResponse } from "next/server";
import { agentFetch, sameOrigin, SESSION_COOKIE } from "@/lib/server/agent";
import { accessToken, clearSessionCookies, CloudError, cloudEnabled, setSessionCookies } from "@/lib/server/cloud";
import { cloudGet, cloudMutate } from "@/lib/server/cloud-api";

/**
 * Proxy autenticado navegador → agente. Encaminha somente /v1/<rota> permitidas, injeta o token de
 * serviço (servidor) e a sessão (cookie httpOnly). Suporta streaming (SSE) sem bufferizar.
 */
const BLOCKED_PREFIXES = ["auth/", "esp32/ingest", "esp32/heartbeat", "esp32/pair"];
const PATH_RE = /^[a-z0-9_\-/.]+$/i;

async function handle(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const joined = path.join("/");
  // Segmentos "." ou ".." seriam normalizados pelo fetch (ex.: "./auth/x" -> "/v1/auth/x") e escapariam do bloqueio.
  const dotSegment = path.some((s) => s === "" || /^\.+$/.test(s));
  if (!PATH_RE.test(joined) || dotSegment || joined.includes("..") || BLOCKED_PREFIXES.some((p) => joined.startsWith(p))) {
    return NextResponse.json({ detail: "Rota não permitida" }, { status: 404 });
  }
  if (request.method !== "GET" && !sameOrigin(request)) {
    return NextResponse.json({ detail: "Origem não permitida" }, { status: 403 });
  }
  if (cloudEnabled()) return handleCloud(request, joined);
  const session = request.cookies.get(SESSION_COOKIE)?.value ?? null;
  if (!session) {
    return NextResponse.json({ detail: "Sessão ausente", code: "no_session" }, { status: 401 });
  }
  const search = request.nextUrl.search;
  const headers = new Headers();
  const ct = request.headers.get("content-type");
  if (ct) headers.set("Content-Type", ct);
  const accept = request.headers.get("accept");
  if (accept) headers.set("Accept", accept);
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
  const upstream = await agentFetch(`/v1/${joined}${search}`, {
    method: request.method,
    headers,
    body,
    session,
    requestId: crypto.randomUUID().slice(0, 16),
    signal: request.signal,
  });
  const out = new Headers();
  for (const h of ["content-type", "content-disposition", "x-request-id", "cache-control"]) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  if (!out.has("cache-control")) out.set("cache-control", "no-store");
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;

/** Modo nuvem: as mesmas rotas, respondidas a partir do Supabase com o token da pessoa (RLS). */
async function handleCloud(request: NextRequest, joined: string) {
  const auth = await accessToken(request);
  if (!auth) {
    const res = NextResponse.json({ detail: "Sessão expirada. Entre de novo.", code: "no_session" }, { status: 401 });
    clearSessionCookies(res);
    return res;
  }
  if (joined === "stream") return new Response(null, { status: 204 }); // sem tempo real na nuvem: o painel usa consultas periódicas
  let res: NextResponse;
  try {
    const data =
      request.method === "GET"
        ? await cloudGet(auth.token, joined, request.nextUrl.searchParams)
        : await cloudMutate(auth.token, request.method, joined, ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>);
    res = NextResponse.json(data, { headers: { "cache-control": "no-store" } });
    if (joined === "cloud/export") res.headers.set("content-disposition", 'attachment; filename="astryon-meus-dados.json"');
    if (joined === "cloud/delete-account") clearSessionCookies(res);
  } catch (e) {
    const status = e instanceof CloudError ? e.status : 502;
    res = NextResponse.json({ detail: e instanceof CloudError ? e.message : "Falha ao consultar a nuvem." }, { status });
    if (status === 401) clearSessionCookies(res);
  }
  if (auth.renewed) setSessionCookies(res, auth.renewed);
  return res;
}
