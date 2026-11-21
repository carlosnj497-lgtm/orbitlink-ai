/**
 * Consultas do painel na nuvem: agregação correta e isolamento (cada um só vê o próprio workspace).
 */
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const A = "00000000-0000-4000-8000-0000000000c1";
const B = "00000000-0000-4000-8000-0000000000c2";
let db: PGlite;
let agentToken: string;
const T0 = 1_763_164_800; // 15/11/2025 00:00 UTC, múltiplo de 3600

async function as<T>(sub: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`reset role; select set_config('request.jwt.claims', '${sub ? JSON.stringify({ sub }) : ""}', false);`);
  await db.exec(`set role ${sub ? "authenticated" : "anon"};`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role;");
  }
}
const one = async <T,>(sub: string | null, sql: string, args: unknown[] = []) => (await as(sub, () => db.query<{ r: T }>(sql, args))).rows[0].r;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync(join(here, "auth-stub.sql"), "utf8"));
  const migDir = join(here, "..", "migrations");
  for (const f of readdirSync(migDir).filter((x) => x.endsWith(".sql")).sort()) await db.exec(readFileSync(join(migDir, f), "utf8"));
  await db.query("insert into auth.users (id, email) values ($1, 'a@x.test'), ($2, 'b@x.test')", [A, B]);
  const ws = (await db.query<{ id: string }>("select id from public.workspaces where owner_id = $1", [A])).rows[0].id;
  const code = (await as(A, () => db.query<{ r: { code: string } }>("select public.create_pairing_code($1) as r", [ws]))).rows[0].r.code;
  agentToken = (await as(null, () => db.query<{ r: { agent_token: string } }>("select public.claim_pairing_code($1) as r", [code]))).rows[0].r.agent_token;
  // 120 minutos: 1ª hora com 4% de perda e 2 s de queda total por minuto; 2ª hora limpa.
  const minutes = Array.from({ length: 120 }, (_, i) => T0 + i * 60);
  const batch = {
    terminals: [{ local_id: "1", terminal_key: "ut-a", name: "Mini", software_version: "2026.11" }],
    usage_minutes: minutes.map((m) => ({ terminal_local_id: "1", minute_ts: m, bytes_down: 7_500_000, bytes_up: 750_000, samples: 60, coverage: 1, source: "calculada" })),
    telemetry_minutes: minutes.map((m, i) => ({ terminal_local_id: "1", minute_ts: m, samples: 60, latency_avg: i < 60 ? 40 : 20, latency_max: 90, jitter_avg: 3, drop_avg: i < 60 ? 0.04 : 0, full_drop_s: i < 60 ? 2 : 0, source: "calculada" })),
    events: [{ terminal_local_id: "1", kind: "ping_drop", cause: null, start_ts: T0 + 300, end_ts: T0 + 306, duration_s: 6, confidence: "derivado", evidence: {} }],
    heartbeat: { ts: T0 + 7200, dish_reachable: true, version: "0.1.0", sync_pending: 0 },
  };
  await as(null, () => db.query("select public.ingest_batch($1, $2::jsonb)", [agentToken, JSON.stringify(batch)]));
}, 60_000);

describe("consultas do painel na nuvem", () => {
  it("telemetria agregada por hora", async () => {
    const rows = (await as(A, () => db.query<{ t: number; down_mbps: number; latency_ms: number; drop_pct: number }>("select * from public.cloud_telemetry($1, $2, 3600)", [T0, T0 + 7200]))).rows;
    expect(rows.map((r) => Number(r.t))).toEqual([T0, T0 + 3600]);
    expect(rows[0].down_mbps).toBeCloseTo(1.0, 5); // 7,5 MB/min = 1 Mbit/s
    expect(rows[0].latency_ms).toBeCloseTo(40, 3);
    expect(rows[0].drop_pct).toBeCloseTo(4, 3);
    expect(rows[1].drop_pct).toBeCloseTo(0, 6);
  });

  it("qualidade com disponibilidade, perda, percentis e horas", async () => {
    const q = await one<Record<string, unknown>>(A, "select public.cloud_quality($1, $2, 'UTC') as r", [T0, T0 + 7200]);
    expect(q.observed_seconds).toBe(7200);
    expect(Number(q.availability_pct)).toBeCloseTo(98.333, 2); // 120 s de 7200
    expect(Number(q.loss_pct)).toBeCloseTo(2, 3);
    expect(Number(q.latency_p50_ms)).toBeCloseTo(30, 0);
    const hours = q.by_hour as { hour: number; observed_seconds: number }[];
    expect(hours).toHaveLength(24);
    expect(hours[0].observed_seconds).toBe(3600);
  });

  it("consumo por janela e por dia, e status do último minuto", async () => {
    const w = await one<Record<string, number>>(A, "select public.cloud_usage_window($1, $2) as r", [T0, T0 + 7200]);
    expect(w.bytes_total).toBe(120 * 8_250_000);
    const days = (await as(A, () => db.query<{ observed: number }>("select * from public.cloud_usage_series($1, $2, 'UTC', 'day')", [T0, T0 + 86400]))).rows;
    expect(days).toHaveLength(1);
    expect(Number(days[0].observed)).toBe(7200);
    const st = await one<{ terminal: { name: string }; heartbeat: { dish_reachable: boolean }; last_minute: { latency_ms: number } }>(A, "select public.cloud_status() as r");
    expect(st.terminal.name).toBe("Mini");
    expect(st.heartbeat.dish_reachable).toBe(true);
    expect(st.last_minute.latency_ms).toBeCloseTo(20, 3);
  });

  it("drop_avg NULL fica fora da disponibilidade e uma hora sem buckets vira lacuna", async () => {
    const tid = (await db.query<{ id: string }>("select id from public.starlink_terminals where terminal_key = 'ut-a'")).rows[0].id;
    const ws = (await db.query<{ workspace_id: string }>("select workspace_id from public.starlink_terminals where id = $1", [tid])).rows[0].workspace_id;
    await db.query(
      "insert into public.telemetry_samples (terminal_id, workspace_id, ts, samples, latency_avg_ms, drop_avg, full_drop_s, source) values ($1,$2,to_timestamp($3),60,25,null,0,'calculada')",
      [tid, ws, T0 - 60],
    );
    const q = await one<Record<string, unknown>>(A, "select public.cloud_quality($1, $2, 'UTC') as r", [T0 - 60, T0]);
    expect(q.observed_seconds).toBe(60);
    expect(q.availability_pct).toBeNull();
    expect(q.loss_pct).toBeNull();
    expect(q.gaps).toEqual([]);

    const withGap = await one<{ gaps: { start_ts: number; end_ts: number }[] }>(A, "select public.cloud_quality($1, $2, 'UTC') as r", [T0, T0 + 10800]);
    expect(withGap.gaps).toEqual([expect.objectContaining({ start_ts: T0 + 7200, end_ts: T0 + 10800 })]);
  });

  it("status e históricos agregam os mesmos dois terminais do workspace", async () => {
    const batch = {
      terminals: [
        { local_id: "1", terminal_key: "ut-a", name: "Mini" },
        { local_id: "2", terminal_key: "ut-b", name: "Mini 2" },
      ],
      usage_minutes: [
        { terminal_local_id: "1", minute_ts: T0 + 7260, bytes_down: 7_500_000, bytes_up: 750_000, samples: 60, coverage: 1, source: "calculada" },
        { terminal_local_id: "2", minute_ts: T0 + 7260, bytes_down: 15_000_000, bytes_up: 1_500_000, samples: 60, coverage: 1, source: "calculada" },
      ],
      telemetry_minutes: [
        { terminal_local_id: "1", minute_ts: T0 + 7260, samples: 60, latency_avg: 20, drop_avg: 0, full_drop_s: 0, source: "calculada" },
        { terminal_local_id: "2", minute_ts: T0 + 7260, samples: 60, latency_avg: 40, drop_avg: 0.1, full_drop_s: 0, source: "calculada" },
      ],
    };
    await as(null, () => db.query("select public.ingest_batch($1, $2::jsonb)", [agentToken, JSON.stringify(batch)]));
    const st = await one<{ terminal: { name: string; count: number; scope: string }; last_minute: { latency_ms: number; drop_pct: number; down_mbps: number } }>(A, "select public.cloud_status() as r");
    expect(st.terminal).toMatchObject({ name: "2 terminais", count: 2, scope: "workspace" });
    expect(st.last_minute.latency_ms).toBeCloseTo(30, 3);
    expect(st.last_minute.drop_pct).toBeCloseTo(5, 3);
    expect(st.last_minute.down_mbps).toBeCloseTo(3, 3);
    const rows = (await as(A, () => db.query<{ down_mbps: number }>("select * from public.cloud_telemetry($1, $2, 60)", [T0 + 7260, T0 + 7320]))).rows;
    expect(rows[0].down_mbps).toBeCloseTo(3, 3);
  });

  it("exporta telemetria e intervalos sem vazar dados para outro workspace", async () => {
    const mine = await one<{ telemetria: unknown[]; consumo_intervalos: unknown[]; agentes: Record<string, unknown>[] }>(A, "select public.export_my_data() as r");
    expect(mine.telemetria.length).toBeGreaterThanOrEqual(122);
    expect(mine.consumo_intervalos.length).toBeGreaterThanOrEqual(122);
    expect(mine.agentes[0]).not.toHaveProperty("token_hash");
    const other = await one<{ telemetria: unknown[]; consumo_intervalos: unknown[] }>(B, "select public.export_my_data() as r");
    expect(other.telemetria).toEqual([]);
    expect(other.consumo_intervalos).toEqual([]);
    expect(JSON.stringify(other)).not.toContain("ut-a");
  });

  it("RPCs authenticated recusam janelas, buckets e fusos inválidos", async () => {
    await expect(as(A, () => db.query("select * from public.cloud_telemetry($1, $2, 60)", [0, T0 + 7200]))).rejects.toThrow();
    await expect(as(A, () => db.query("select * from public.cloud_telemetry($1, $2, 60)", [T0, T0 + 401 * 86400]))).rejects.toThrow(/longa demais/);
    await expect(as(A, () => db.query("select * from public.cloud_telemetry($1, $2, 30)", [T0, T0 + 7200]))).rejects.toThrow(/bucket/);
    await expect(as(A, () => db.query("select * from public.cloud_telemetry($1, $2, 60)", [T0, T0 + 100 * 86400]))).rejects.toThrow(/720/);
    await expect(as(A, () => db.query("select * from public.cloud_usage_series($1, $2, 'UTC', 'week')", [T0, T0 + 7200]))).rejects.toThrow(/bucket/);
    await expect(as(A, () => db.query("select public.cloud_quality($1, $2, 'Fuso/Inexistente')", [T0, T0 + 7200]))).rejects.toThrow();
    await expect(as(A, () => db.query("select public.cloud_usage_window($1, $2)", [T0 + 7200, T0]))).rejects.toThrow(/janela/);
  });

  it("B não vê nada de A em nenhuma consulta", async () => {
    expect((await as(B, () => db.query("select * from public.cloud_telemetry($1, $2, 3600)", [T0, T0 + 7200]))).rows).toHaveLength(0);
    const q = await one<{ observed_seconds: number; availability_pct: null }>(B, "select public.cloud_quality($1, $2, 'UTC') as r", [T0, T0 + 7200]);
    expect(q.observed_seconds).toBe(0);
    expect(q.availability_pct).toBeNull();
    const st = await one<{ terminal: null; agents: number }>(B, "select public.cloud_status() as r");
    expect(st.terminal).toBeNull();
    expect(Number(st.agents)).toBe(0);
  });

  it("anon não usa as consultas", async () => {
    await expect(as(null, () => db.query("select public.cloud_status()"))).rejects.toThrow(/permission denied/);
  });
});
