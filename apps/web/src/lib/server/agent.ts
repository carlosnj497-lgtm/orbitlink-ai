import "server-only";

/**
 * Acesso servidor→agente. O token de serviço e a URL do agente NUNCA vão para o navegador.
 */
export const SESSION_COOKIE = "orbitlink_session";

export function agentBaseUrl(): string {
  return (process.env.ORBITLINK_AGENT_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
}

function serviceToken(): string | null {
  return process.env.ORBITLINK_API_TOKEN || null;
}

export class AgentUnavailableError extends Error {}

export async function agentFetch(
  path: string,
  init: RequestInit & { session?: string | null; requestId?: string } = {},
): Promise<Response> {
  const token = serviceToken();
  if (!token) {
    return Response.json(
      { detail: "ORBITLINK_API_TOKEN não configurado no servidor do painel. Execute scripts\\install.ps1." },
      { status: 503 },
    );
  }
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.session) headers.set("X-OrbitLink-Session", init.session);
  if (init.requestId) headers.set("X-Request-ID", init.requestId);
  try {
    return await fetch(`${agentBaseUrl()}${path}`, { ...init, headers, cache: "no-store" });
  } catch {
    return Response.json(
      { detail: "Agente OrbitLink offline ou inacessível em " + agentBaseUrl(), code: "agent_offline" },
      { status: 502 },
    );
  }
}

export function cookieOptions(expiresAt: number) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.ORBITLINK_COOKIE_SECURE === "true",
    path: "/",
    expires: new Date(expiresAt * 1000),
  };
}

/** Bloqueia requisições mutantes de outras origens (defesa adicional ao SameSite=Strict). */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // navegação/fetch de mesma origem sem Origin (GET)
  try {
    const host = request.headers.get("host");
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
