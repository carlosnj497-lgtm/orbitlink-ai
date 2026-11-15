import "server-only";
import type { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "./agent";

/**
 * Modo nuvem (painel hospedado, ex.: Vercel): login pelo Supabase Auth e leitura dos dados sincronizados pelos
 * agentes, sempre com o token da própria pessoa (a RLS do banco decide o que ela vê). Sem SDK: chamadas REST.
 *
 * Variáveis (só no servidor): ASTRYON_CLOUD=1, ASTRYON_SUPABASE_URL, ASTRYON_SUPABASE_ANON_KEY.
 * Cookies httpOnly: astryon_session (token de acesso, ~1 h) e astryon_refresh (renovação).
 */
export const REFRESH_COOKIE = "astryon_refresh";

export function cloudEnabled(): boolean {
  return process.env.ASTRYON_CLOUD === "1" && Boolean(process.env.ASTRYON_SUPABASE_URL && process.env.ASTRYON_SUPABASE_ANON_KEY);
}

function base(): string {
  return (process.env.ASTRYON_SUPABASE_URL ?? "").replace(/\/$/, "");
}

function anon(): string {
  return process.env.ASTRYON_SUPABASE_ANON_KEY ?? "";
}

export class CloudError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface CloudSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: { id: string; email?: string };
}

async function gotrue(path: string, body: unknown): Promise<CloudSession & Record<string, unknown>> {
  let r: Response;
  try {
    r = await fetch(`${base()}/auth/v1/${path}`, {
      method: "POST",
      headers: { apikey: anon(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new CloudError(502, "Não foi possível falar com o servidor de contas. Tente de novo em instantes.");
  }
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) {
    const raw = String(data.error_description ?? data.msg ?? data.message ?? data.error ?? "");
    throw new CloudError(r.status === 400 || r.status === 422 ? 400 : r.status, translateAuthError(raw, r.status));
  }
  return data as unknown as CloudSession & Record<string, unknown>;
}

/** Mensagens do Supabase Auth em português, sem expor detalhes internos. */
export function translateAuthError(raw: string, status: number): string {
  const m = raw.toLowerCase();
  if (m.includes("invalid login") || m.includes("invalid credentials")) return "E-mail ou senha incorretos.";
  if (m.includes("email not confirmed")) return "Confirme o e-mail pelo link que enviamos antes de entrar.";
  if (m.includes("already registered") || m.includes("already exists")) return "Este e-mail já tem conta. Use \"Entrar\" ou \"Esqueci a senha\".";
  if (m.includes("password") && (m.includes("6") || m.includes("short") || m.includes("weak"))) return "A senha precisa de pelo menos 10 caracteres.";
  if (m.includes("rate") || status === 429) return "Muitas tentativas. Espere alguns minutos.";
  if (m.includes("refresh") || m.includes("jwt")) return "Sua sessão expirou. Entre de novo.";
  return status >= 500 ? "O servidor de contas está indisponível no momento." : "Não foi possível concluir. Confira os dados e tente de novo.";
}

export const signIn = (email: string, password: string) => gotrue("token?grant_type=password", { email, password });
export const refresh = (refresh_token: string) => gotrue("token?grant_type=refresh_token", { refresh_token });
export async function signUp(email: string, password: string, redirectTo: string) {
  return gotrue(`signup?redirect_to=${encodeURIComponent(redirectTo)}`, { email, password });
}
export async function recover(email: string, redirectTo: string) {
  await gotrue(`recover?redirect_to=${encodeURIComponent(redirectTo)}`, { email });
}

function jwtPayload(token: string): { exp?: number; email?: string } {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")) as { exp?: number; email?: string };
  } catch {
    return {};
  }
}

/** E-mail da conta (do próprio token, já validado pelo Supabase em cada consulta). */
export const jwtEmail = (token: string): string | null => jwtPayload(token).email ?? null;

/** Expiração (epoch s) do JWT, sem validar a assinatura: só para decidir quando renovar. */
export function jwtExp(token: string): number {
  return jwtPayload(token).exp ?? 0;
}

function cookieBase(maxAge: number) {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge };
}

export function setSessionCookies(res: NextResponse, s: Pick<CloudSession, "access_token" | "refresh_token">) {
  res.cookies.set(SESSION_COOKIE, s.access_token, cookieBase(60 * 60 * 24 * 30));
  res.cookies.set(REFRESH_COOKIE, s.refresh_token, cookieBase(60 * 60 * 24 * 30));
}

export function clearSessionCookies(res: NextResponse) {
  res.cookies.delete(SESSION_COOKIE);
  res.cookies.delete(REFRESH_COOKIE);
}

/**
 * Token válido para esta requisição: renova se faltar menos de 60 s. Devolve também a sessão nova (se houve
 * renovação) para a rota gravar os cookies na resposta.
 */
export async function accessToken(request: NextRequest): Promise<{ token: string; renewed: CloudSession | null } | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const rt = request.cookies.get(REFRESH_COOKIE)?.value;
  if (token && jwtExp(token) - 60 > Date.now() / 1000) return { token, renewed: null };
  if (!rt) return null;
  try {
    const s = await refresh(rt);
    return { token: s.access_token, renewed: s };
  } catch {
    return null;
  }
}

/** Consulta o PostgREST com o token da pessoa (RLS aplicada). */
export async function rest<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${base()}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: anon(), Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
  });
  const data = (await r.json().catch(() => null)) as T & { message?: string };
  if (!r.ok) {
    const msg = data && typeof data === "object" && "message" in data ? String(data.message) : "";
    throw new CloudError(r.status === 401 ? 401 : r.status >= 500 ? 502 : r.status, msg || `Erro ${r.status} na nuvem`);
  }
  return data;
}

export const rpc = <T,>(token: string, fn: string, args: Record<string, unknown> = {}) =>
  rest<T>(token, `rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
