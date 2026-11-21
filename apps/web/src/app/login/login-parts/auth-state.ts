import { requestJson } from "@/lib/api";

/**
 * Estado do agente para as telas de acesso. `setup_code_required` diz se o servidor exige o código de
 * configuração/recuperação — o mesmo segredo que libera criar o primeiro administrador e redefinir a senha.
 */
export type RecoveryChannel = "telegram" | "email";

export type AuthState =
  | { setup_required: true; setup_code_required?: boolean; email_recovery?: boolean; recovery_channel?: RecoveryChannel | null; supabase_configured: boolean; version: string }
  | { setup_required: false; setup_code_required?: boolean; email_recovery?: boolean; recovery_channel?: RecoveryChannel | null; supabase_configured: boolean; version: string }
  | { detail: string };

export const AGENT_OFFLINE = "Agente ASTRYON offline. Inicie com scripts\\start.ps1.";

export async function loadAuthState(): Promise<AuthState> {
  const r = await requestJson<AuthState>("/api/auth/state", { cache: "no-store" });
  if (r.ok && r.data) return r.data;
  return { detail: r.status ? (r.error ?? AGENT_OFFLINE) : AGENT_OFFLINE };
}
