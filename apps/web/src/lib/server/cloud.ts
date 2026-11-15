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

/**
 * Problema de configuração do modo nuvem, ou null se estiver coerente. A interface (cliente) decide o modo pela
 * flag fixada no build (NEXT_PUBLIC_ASTRYON_CLOUD); o servidor, por ASTRYON_CLOUD em tempo de execução. Se as
 * duas divergirem, ou faltar URL/chave do Supabase, o painel falha alto em vez de cair em silêncio no modo local.
 */
export function cloudConfigError(env: Record<string, string | undefined> = process.env, builtCloud = process.env.NEXT_PUBLIC_ASTRYON_CLOUD === "1"): string | null {
  const wants = env.ASTRYON_CLOUD === "1";
  if (wants !== builtCloud) {
    return wants
      ? "ASTRYON_CLOUD=1, mas o painel foi construído sem NEXT_PUBLIC_ASTRYON_CLOUD=1. Refaça o build com as duas variáveis."
      : "O painel foi construído para a nuvem (NEXT_PUBLIC_ASTRYON_CLOUD=1), mas ASTRYON_CLOUD não é 1 no servidor.";
  }
  if (wants && !(env.ASTRYON_SUPABASE_URL && env.ASTRYON_SUPABASE_ANON_KEY)) {
    return "Modo nuvem ligado sem ASTRYON_SUPABASE_URL e ASTRYON_SUPABASE_ANON_KEY.";
  }
  return null;
}

export function cloudEnabled(): boolean {
  const problem = cloudConfigError();
  if (problem) throw new Error(`Configuração do ASTRYON inválida: ${problem}`);
  return process.env.ASTRYON_CLOUD === "1";
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

async function gotrue(path: string, body: unknown, init: { method?: string; token?: string } = {}): Promise<CloudSession & Record<string, unknown>> {
  let r: Response;
  try {
    r = await fetch(`${base()}/auth/v1/${path}`, {
      method: init.method ?? "POST",
      headers: { apikey: anon(), "Content-Type": "application/json", ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
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
/** Link de recuperação no formato `token_hash` (modelo de e-mail do Supabase): troca por uma sessão. */
export const verifyRecovery = (tokenHash: string) => gotrue("verify", { type: "recovery", token_hash: tokenHash });
/** Define a senha nova da conta dona do token (sessão aberta pelo link de recuperação). */
export async function updatePassword(token: string, password: string) {
  await gotrue("user", { password }, { method: "PUT", token });
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

/** Mensagem genérica para erros do PostgREST (sem detalhes internos do banco). */
export function restErrorText(status: number): string {
  if (status === 401) return "Sua sessão expirou. Entre de novo.";
  if (status === 403) return "Sua conta não tem permissão para isso.";
  if (status === 404) return "Não encontrado na nuvem.";
  if (status === 409) return "Conflito com dados existentes. Atualize a página e tente de novo.";
  if (status >= 500) return "A nuvem está indisponível no momento. Tente de novo em instantes.";
  return "A nuvem recusou o pedido. Confira os dados e tente de novo.";
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
    // O detalhe do PostgREST (nomes de função, constraints...) fica só no log do servidor.
    const msg = data && typeof data === "object" && "message" in data ? String(data.message) : "";
    console.error(`[nuvem] ${init.method ?? "GET"} ${path.split("?")[0]} → ${r.status}: ${msg}`);
    throw new CloudError(r.status === 401 ? 401 : r.status >= 500 ? 502 : r.status, restErrorText(r.status));
  }
  return data;
}

export const rpc = <T,>(token: string, fn: string, args: Record<string, unknown> = {}) =>
  rest<T>(token, `rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
