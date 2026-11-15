import "server-only";
import { NextResponse } from "next/server";

/** Status HTTP que não podem ter corpo: `NextResponse.json` lança exceção com eles. */
const NULL_BODY = new Set([101, 204, 205, 304]);

/**
 * Repassa a resposta do agente para o navegador mantendo o status. Respostas sem corpo (204/205/304) seguem
 * sem corpo; JSON inválido vira `{}` no sucesso e `{detail}` genérico no erro (nunca 500 no painel).
 */
export async function relay(res: Response): Promise<NextResponse> {
  if (NULL_BODY.has(res.status)) return new NextResponse(null, { status: res.status });
  const fallback = res.ok ? {} : { detail: `Erro ${res.status} no agente.` };
  const data: unknown = await res.json().catch(() => fallback);
  return NextResponse.json(data ?? fallback, { status: res.status });
}
