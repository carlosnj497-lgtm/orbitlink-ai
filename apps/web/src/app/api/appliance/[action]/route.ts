import { type NextRequest, NextResponse } from "next/server";
import { agentFetch, sameOrigin } from "@/lib/server/agent";

/** Aparelho pronto: estado e pareamento sem login (o agente só aceita em modo aparelho e antes de parear). */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  if ((await ctx.params).action !== "state") return NextResponse.json({ detail: "não encontrado" }, { status: 404 });
  const r = await agentFetch("/v1/appliance");
  return NextResponse.json(await r.json().catch(() => ({})), { status: r.status });
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  if ((await ctx.params).action !== "pair") return NextResponse.json({ detail: "não encontrado" }, { status: 404 });
  if (!sameOrigin(request)) return NextResponse.json({ detail: "Origem não permitida" }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { code?: unknown; name?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.slice(0, 20) : "";
  const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim().slice(0, 60) : null;
  const r = await agentFetch("/v1/appliance/pair", { method: "POST", body: JSON.stringify({ code, name }), headers: { "Content-Type": "application/json" } });
  return NextResponse.json(await r.json().catch(() => ({})), { status: r.status });
}
