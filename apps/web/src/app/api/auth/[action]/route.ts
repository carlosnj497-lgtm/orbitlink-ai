import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { agentFetch, cookieOptions, sameOrigin, SESSION_COOKIE } from "@/lib/server/agent";
import { accessToken, clearSessionCookies, CloudError, cloudEnabled, jwtEmail, recover, setSessionCookies, signIn, signOut, signUp, updatePassword, verifyRecovery } from "@/lib/server/cloud";
import { clientIp } from "@/lib/server/client-ip";
import { relay } from "@/lib/server/relay";

const cloudCreds = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(256) });

function origin(request: NextRequest): string {
  const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  return `${proto}://${request.headers.get("host") ?? request.nextUrl.host}`;
}

async function cloudGetAction(request: NextRequest, action: string) {
  if (action === "state") return NextResponse.json({ cloud: true, setup_required: false, supabase_configured: true });
  if (action === "me") {
    const auth = await accessToken(request);
    if (!auth) return NextResponse.json({ detail: "Sessão ausente" }, { status: 401 });
    const res = NextResponse.json({ username: jwtEmail(auth.token) ?? "conta", role: "owner" });
    if (auth.renewed) setSessionCookies(res, auth.renewed);
    return res;
  }
  return NextResponse.json({ detail: "não encontrado" }, { status: 404 });
}

async function cloudPostAction(request: NextRequest, action: string) {
  if (action === "logout") {
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    // Melhor esforço: os cookies locais são apagados mesmo sem rede ou se a sessão já expirou.
    if (token) await signOut(token).catch(() => undefined);
    const res = NextResponse.json({ ok: true });
    clearSessionCookies(res);
    return res;
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    if (action === "recover") {
      const email = z.string().email().max(200).safeParse(body?.email);
      if (!email.success) return NextResponse.json({ detail: "Informe um e-mail válido." }, { status: 422 });
      await recover(email.data, `${origin(request)}/login/redefinir`);
      return NextResponse.json({ ok: true });  // mesma resposta exista ou não a conta
    }
    if (action === "reset") return await cloudReset(body);
    const parsed = cloudCreds.safeParse(body);
    if (!parsed.success) return NextResponse.json({ detail: "Informe e-mail e senha." }, { status: 422 });
    const { email, password } = parsed.data;
    if (action === "signup") {
      if (password.length < 10) return NextResponse.json({ detail: "A senha precisa de pelo menos 10 caracteres." }, { status: 422 });
      const s = await signUp(email, password, `${origin(request)}/login`);
      if (!s.access_token) return NextResponse.json({ ok: true, confirm_email: true });
      const res = NextResponse.json({ ok: true });
      setSessionCookies(res, s);
      return res;
    }
    if (action === "login") {
      const s = await signIn(email, password);
      const res = NextResponse.json({ ok: true });
      setSessionCookies(res, s);
      return res;
    }
  } catch (e) {
    if (e instanceof CloudError) return NextResponse.json({ detail: e.message }, { status: e.status });
    throw e;
  }
  return NextResponse.json({ detail: "não encontrado" }, { status: 404 });
}

const resetBody = z.object({
  password: z.string().min(10, "A senha precisa de pelo menos 10 caracteres.").max(256),
  access_token: z.string().min(20).max(4096).optional(),
  refresh_token: z.string().min(1).max(4096).optional(),
  token_hash: z.string().min(6).max(512).optional(),
});

/**
 * Senha nova a partir do link de recuperação do e-mail: o link traz uma sessão (`#access_token=…&refresh_token=…`)
 * ou um `token_hash` (trocado aqui por uma sessão). Com ela, PUT /auth/v1/user grava a senha e a pessoa já entra.
 */
async function cloudReset(body: Record<string, unknown> | null) {
  const parsed = resetBody.safeParse(body);
  if (!parsed.success) {
    const tooShort = parsed.error.issues.some((i) => i.path[0] === "password");
    return NextResponse.json({ detail: tooShort ? "A senha precisa de pelo menos 10 caracteres." : "Link de recuperação inválido. Peça outro." }, { status: 422 });
  }
  const { password, access_token, refresh_token, token_hash } = parsed.data;
  let session: { access_token: string; refresh_token: string } | null = null;
  if (token_hash) {
    const s = await verifyRecovery(token_hash);
    session = { access_token: s.access_token, refresh_token: s.refresh_token };
  } else if (access_token && refresh_token) {
    session = { access_token, refresh_token };
  }
  if (!session) return NextResponse.json({ detail: "Link de recuperação inválido ou incompleto. Peça outro." }, { status: 422 });
  await updatePassword(session.access_token, password);
  const res = NextResponse.json({ ok: true });
  setSessionCookies(res, session);
  return res;
}

const credentials = z.object({
  username: z.string().min(3).max(64).regex(/^[A-Za-z0-9_.-]+$/),
  password: z.string().min(1).max(256),
  setup_code: z.string().max(64).optional(),
  email: z.string().max(200).optional(),
});

export async function GET(request: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  if (cloudEnabled()) return cloudGetAction(request, action);
  const session = request.cookies.get(SESSION_COOKIE)?.value ?? null;
  if (action === "state") return relay(await agentFetch("/v1/auth/state"));
  if (action === "me") return relay(await agentFetch("/v1/auth/me", { session }));
  return NextResponse.json({ detail: "não encontrado" }, { status: 404 });
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  if (!sameOrigin(request)) return NextResponse.json({ detail: "Origem não permitida" }, { status: 403 });
  if (cloudEnabled()) return cloudPostAction(request, action);
  const session = request.cookies.get(SESSION_COOKIE)?.value ?? null;

  if (action === "logout") {
    if (session) await agentFetch("/v1/auth/logout", { method: "POST", session }).catch(() => undefined);
    const res = NextResponse.json({ ok: true });
    res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  if (action === "password") {
    const body = await request.text();
    return relay(
      await agentFetch("/v1/auth/password", {
        method: "POST",
        body,
        session,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }

  if (action === "recover") {
    // Redefinição local pela tela: sem sessão (quem esqueceu a senha não tem uma). A prova de identidade é o
    // código de recuperação, validado pelo agente contra ASTRYON_SETUP_CODE.
    const body = await request.text();
    return relay(
      await agentFetch("/v1/auth/recover", {
        method: "POST",
        body,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }

  if (action === "recover-request" || action === "recover-confirm") {
    // Recuperação por e-mail: sem sessão (quem esqueceu a senha não tem uma). O agente valida o código enviado.
    const body = await request.text();
    const path = action === "recover-request" ? "/v1/auth/recover/request" : "/v1/auth/recover/confirm";
    return relay(
      await agentFetch(path, {
        method: "POST",
        body,
        headers: { "Content-Type": "application/json", "X-Forwarded-For": clientIp(request.headers) },
      }),
    );
  }

  if (action === "email") {
    const body = await request.text();
    return relay(
      await agentFetch("/v1/auth/email", {
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
  const forwarded = clientIp(request.headers);
  if (action === "setup") {
    const r = await agentFetch("/v1/auth/setup", {
      method: "POST",
      body: JSON.stringify(parsed.data),
      headers: { "Content-Type": "application/json" },
    });
    if (!r.ok) return relay(r);
  }
  const { username, password } = parsed.data;
  const r = await agentFetch("/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
    headers: { "Content-Type": "application/json", "User-Agent": request.headers.get("user-agent") ?? "", "X-Forwarded-For": forwarded },
  });
  if (!r.ok) return relay(r);
  const { session: token, expires_at } = (await r.json()) as { session: string; expires_at: number };
  const res = NextResponse.json({ ok: true, expires_at });
  res.cookies.set(SESSION_COOKIE, token, cookieOptions(expires_at));
  return res;
}
