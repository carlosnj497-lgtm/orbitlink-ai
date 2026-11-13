/**
 * Testes de isolamento (RLS) e ingestão idempotente, executados em Postgres real (PGlite/WASM), sem Docker.
 * Garante: usuário A nunca vê dados do usuário B; anon não lê tabelas; só agentes com token válido escrevem.
 */
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
let db: PGlite;
let tokenA: string;
let wsA: string;

async function as<T>(role: "anon" | "authenticated" | "postgres", sub: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`reset role; select set_config('request.jwt.claims', '${sub ? JSON.stringify({ sub }) : ""}', false);`);
  if (role !== "postgres") await db.exec(`set role ${role};`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role;");
  }
}

function batch(minutes: number[]) {
  return {
    terminals: [{ local_id: "1", terminal_key: "ut-abc123", name: "Mini", software_version: "2026.10" }],
    usage_minutes: minutes.map((m) => ({ terminal_local_id: "1", minute_ts: m, bytes_down: 1_000_000, bytes_up: 100_000, samples: 60, coverage: 1, source: "calculada" })),
    telemetry_minutes: minutes.map((m) => ({ terminal_local_id: "1", minute_ts: m, samples: 60, latency_avg: 30, drop_avg: 0, full_drop_s: 0, source: "calculada" })),
    events: [{ terminal_local_id: "1", kind: "ping_drop", cause: "x", start_ts: minutes[0], end_ts: minutes[0] + 5, duration_s: 5, confidence: "derivado", evidence: {} },
             { terminal_local_id: null, kind: "power_loss", cause: "esp32", start_ts: minutes[0], end_ts: null, duration_s: null, confidence: "confirmado", evidence: {} }],
    capabilities: [{ terminal_local_id: "1", key: "dish.status", label: "Status", status: "verificada", detail: null, checked_at: minutes[0] }],
    heartbeat: { ts: minutes[0], dish_reachable: true, version: "0.1.0", sync_pending: 0 },
  };
}

async function ingest(token: string, b: unknown) {
  return as("anon", null, () => db.query<{ r: Record<string, unknown> }>("select public.ingest_batch($1, $2::jsonb) as r", [token, JSON.stringify(b)]));
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync(join(here, "auth-stub.sql"), "utf8"));
  const migDir = join(here, "..", "migrations");
  for (const f of readdirSync(migDir).filter((x) => x.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(migDir, f), "utf8"));
  }
  await db.query("insert into auth.users (id, email) values ($1, 'a@exemplo.test'), ($2, 'b@exemplo.test')", [A, B]);
  wsA = (await db.query<{ id: string }>("select id from public.workspaces where owner_id = $1", [A])).rows[0].id;
  tokenA = (await as("authenticated", A, () => db.query<{ t: string }>("select public.create_agent($1, 'PC da sala') as t", [wsA]))).rows[0].t;
}, 60_000);

describe("bootstrap e pareamento", () => {
  it("cria workspace e associa o dono no cadastro", async () => {
    const r = await db.query("select role from public.workspace_members where user_id = $1", [A]);
    expect(r.rows).toEqual([{ role: "owner" }]);
  });

  it("armazena somente o hash do token do agente", async () => {
    const r = await db.query<{ token_hash: string }>("select token_hash from public.agents");
    expect(r.rows[0].token_hash).not.toContain(tokenA);
    expect(tokenA.startsWith("olk_")).toBe(true);
  });

  it("B não pode parear agente no workspace de A", async () => {
    await expect(as("authenticated", B, () => db.query("select public.create_agent($1, 'intruso')", [wsA]))).rejects.toThrow(/permissão/);
  });
});

describe("ingestão", () => {
  const m0 = Math.floor(Date.UTC(2026, 10, 10, 12, 0) / 1000);

  it("rejeita token inválido", async () => {
    await expect(ingest("olk_token_invalido_qualquer_123456", batch([m0]))).rejects.toThrow(/inválido/);
  });

  it("aceita lote do agente e é idempotente ao reenviar", async () => {
    const r1 = await ingest(tokenA, batch([m0, m0 + 60]));
    expect(r1.rows[0].r.ok).toBe(true);
    await ingest(tokenA, batch([m0, m0 + 60]));
    const counts = await db.query<{ u: number; t: number; e: number; d: number }>(
      `select (select count(*)::int from public.usage_intervals) u, (select count(*)::int from public.telemetry_samples) t,
              (select count(*)::int from public.connection_events) e, (select count(*)::int from public.usage_aggregates) d`,
    );
    expect(counts.rows[0]).toEqual({ u: 2, t: 2, e: 2, d: 1 });
    const agg = await db.query<{ bytes_total: number }>("select bytes_total from public.usage_aggregates");
    expect(agg.rows[0].bytes_total).toBe(2 * 1_100_000);
  });
});

describe("isolamento RLS", () => {
  it("A vê os próprios dados", async () => {
    const r = await as("authenticated", A, () => db.query("select * from public.usage_intervals"));
    expect(r.rows.length).toBe(2);
  });

  it("B não vê nada de A em nenhuma tabela de dados", async () => {
    for (const t of ["starlink_terminals", "usage_intervals", "usage_aggregates", "telemetry_samples", "connection_events",
      "terminal_capabilities", "agent_heartbeats", "agents", "workspace_members"]) {
      const r = await as("authenticated", B, () => db.query(`select * from public.${t} where workspace_id = $1`, [wsA]));
      expect(r.rows, t).toEqual([]);
    }
    const own = await as("authenticated", B, () => db.query<{ user_id: string }>("select user_id from public.workspace_members"));
    expect(own.rows.every((m) => m.user_id === B)).toBe(true);
    const ws = await as("authenticated", B, () => db.query("select id from public.workspaces"));
    expect(ws.rows.map((x: Record<string, unknown>) => x.id)).not.toContain(wsA);
  });

  it("anon não lê tabelas diretamente", async () => {
    await expect(as("anon", null, () => db.query("select * from public.usage_intervals"))).rejects.toThrow(/permission denied/);
  });

  it("usuário autenticado não escreve telemetria diretamente", async () => {
    const tid = (await db.query<{ id: string }>("select id from public.starlink_terminals")).rows[0].id;
    await expect(
      as("authenticated", A, () =>
        db.query("insert into public.usage_intervals (terminal_id, workspace_id, minute_ts, bytes_down, bytes_up, samples, coverage, source) values ($1,$2,now(),1,1,1,1,'calculada')", [tid, wsA]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("B não cria regra de alerta no workspace de A", async () => {
    await expect(
      as("authenticated", B, () =>
        db.query("insert into public.alert_rules (workspace_id, name, kind, operator, threshold, severity) values ($1,'x','loss_high','gt',1,'warn')", [wsA]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("agente revogado deixa de ingerir", async () => {
    const agentId = (await db.query<{ id: string }>("select id from public.agents")).rows[0].id;
    await as("authenticated", A, () => db.query("select public.revoke_agent($1)", [agentId]));
    await expect(ingest(tokenA, batch([Math.floor(Date.now() / 1000)]))).rejects.toThrow(/revogado/);
  });
});
