/**
 * Funções internas não podem ser chamadas pela API (anon/authenticated), mesmo com os default privileges do
 * Supabase (reproduzidos em auth-stub.sql), e quem sai do workspace perde acesso às mensagens da IA.
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
let wsA: string;

async function as<T>(role: "anon" | "authenticated", sub: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`reset role; select set_config('request.jwt.claims', '${sub ? JSON.stringify({ sub }) : ""}', false);`);
  await db.exec(`set role ${role};`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role;");
  }
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
}, 60_000);

const internal: [string, unknown[]][] = [
  ["select public.apply_retention(0, 0)", []],
  ["select public._new_agent($1, 'x')", ["00000000-0000-4000-8000-000000000000"]],
  ["select public._norm_code('abc')", []],
];

describe("funções internas fechadas à API", () => {
  for (const role of ["anon", "authenticated"] as const) {
    for (const [sql, params] of internal) {
      it(`${role} não executa ${sql.split("(")[0].replace("select ", "")}`, async () => {
        const params2 = sql.includes("_new_agent") ? [wsA] : params;
        await expect(as(role, role === "authenticated" ? A : null, () => db.query(sql, params2))).rejects.toThrow(/permission denied/);
      });
    }
  }

  it("apply_retention não apagou nada e segue disponível para o dono (pg_cron)", async () => {
    const r = await db.query<{ r: Record<string, number> }>("select public.apply_retention() as r");
    expect(r.rows[0].r).toHaveProperty("telemetry_samples");
  });

  it("só a lista explícita de funções é executável por anon", async () => {
    const r = await db.query<{ f: string }>(
      `select p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') order by 1`,
    );
    expect(r.rows.map((x) => x.f)).toEqual(["claim_pairing_code", "ingest_batch"]);
  });

  it("funções criadas depois não ganham EXECUTE automático", async () => {
    await db.exec("create function public.__probe() returns int language sql as $$ select 1 $$;");
    await expect(as("anon", null, () => db.query("select public.__probe()"))).rejects.toThrow(/permission denied/);
    await db.exec("drop function public.__probe();");
  });

  it("anon não lê nem escreve tabelas", async () => {
    await expect(as("anon", null, () => db.query("select * from public.workspaces"))).rejects.toThrow(/permission denied/);
    await expect(as("anon", null, () => db.query("select * from public.pairing_codes"))).rejects.toThrow(/permission denied/);
  });
});

describe("ai_messages exige continuar membro do workspace", () => {
  it("quem foi removido do workspace perde acesso às próprias mensagens", async () => {
    await db.query("insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'viewer')", [wsA, B]);
    const conv = await as("authenticated", B, () =>
      db.query<{ id: string }>("insert into public.ai_conversations (workspace_id, user_id, title) values ($1, $2, 't') returning id", [wsA, B]),
    );
    const convId = conv.rows[0].id;
    await as("authenticated", B, () => db.query("insert into public.ai_messages (conversation_id, role, content) values ($1, 'user', 'oi')", [convId]));
    const before = await as("authenticated", B, () => db.query("select * from public.ai_messages where conversation_id = $1", [convId]));
    expect(before.rows).toHaveLength(1);

    await db.query("delete from public.workspace_members where workspace_id = $1 and user_id = $2", [wsA, B]);
    const after = await as("authenticated", B, () => db.query("select * from public.ai_messages where conversation_id = $1", [convId]));
    expect(after.rows).toHaveLength(0);
    await expect(
      as("authenticated", B, () => db.query("insert into public.ai_messages (conversation_id, role, content) values ($1, 'user', 'x')", [convId])),
    ).rejects.toThrow(/row-level security/);
  });
});
