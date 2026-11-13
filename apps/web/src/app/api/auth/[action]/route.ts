import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { agentFetch, cookieOptions, sameOrigin, SESSION_COOKIE } from "@/lib/server/agent";

const credentials = z.object({
  username: z.string().min(3).max(64).regex(/^[A-Za-z0-9_.-]+$/),
  password: z.string().min(1).max(256),
  setup_code: z.string().max(64).optional(),
});

async function passthrough(res: Response) {
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  const session = request.cookies.get(SESSION_COOKIE)?.value ?? null;
  if (action === "state") return passthrough(await agentFetch("/v1/auth/state"));
  if (action === "me") return passthrough(await agentFetch("/v1/auth/me", { session }));
  return NextResponse.json({ detail: "não encontrado" }, { status: 404 });
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  if (!sameOrigin(request)) return NextResponse.json({ detail: "Origem não permitida" }, { status: 403 });
  const session = request.cookies.get(SESSION_COOKIE)?.value ?? null;

  if (action === "logout") {
    if (session) await agentFetch("/v1/auth/logout", { method: "POST", session });
    const res = NextResponse.json({ ok: true });
    res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  if (action === "password") {
    const body = await request.text();
    return passthrough(
      await agentFetch("/v1/auth/password", {
        method: "POST",
        body,
        session,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }

  if (action !== "login" && action !== "setup") {
    return NextResponse.json({ detail: "não encontrado" }, { status: 404 });
  }
  const parsed = credentials.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ detail: "Dados inválidos", issues: parsed.error.issues }, { status: 422 });
  }
  const forwarded = request.headers.get("x-forwarded-for") ?? "local";
  if (action === "setup") {
    const r = await agentFetch("/v1/auth/setup", {
      method: "POST",
      body: JSON.stringify(parsed.data),
      headers: { "Content-Type": "application/json" },
    });
    if (!r.ok) return passthrough(r);
  }
  const { username, password } = parsed.data;
  const r = await agentFetch("/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
    headers: { "Content-Type": "application/json", "User-Agent": request.headers.get("user-agent") ?? "", "X-Forwarded-For": forwarded },
  });
  if (!r.ok) return passthrough(r);
  const { session: token, expires_at } = (await r.json()) as { session: string; expires_at: number };
  const res = NextResponse.json({ ok: true, expires_at });
  res.cookies.set(SESSION_COOKIE, token, cookieOptions(expires_at));
  return res;
}
