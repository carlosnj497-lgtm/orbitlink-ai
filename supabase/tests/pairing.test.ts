/**
 * Pareamento por código curto, exclusão e exportação da conta, em Postgres real (PGlite), sem Docker.
 */
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b1";
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

const newCode = (user: string, ws: string, name = "Mini do sítio") =>
  as("authenticated", user, () => db.query<{ r: { code: string; expires_at: string } }>("select public.create_pairing_code($1, $2) as r", [ws, name])).then((x) => x.rows[0].r);
const claim = (code: string, name: string | null = null) =>
  as("anon", null, () => db.query<{ r: Record<string, string> }>("select public.claim_pairing_code($1, $2) as r", [code, name])).then((x) => x.rows[0].r);

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

describe("código de pareamento", () => {
  it("gera código curto legível, guarda só o hash e troca por um token de agente uma única vez", async () => {
    const { code, expires_at } = await newCode(A, wsA);
    expect(code).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    expect(new Date(expires_at).getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
    const stored = await db.query<{ code_hash: string }>("select code_hash from public.pairing_codes");
    expect(JSON.stringify(stored.rows)).not.toContain(code.replace("-", ""));

    const r = await claim(code.toLowerCase().replace("-", " "));  // digitado de qualquer jeito
    expect(r.agent_token).toMatch(/^olk_/);
    expect(r.workspace_id).toBe(wsA);
    expect(r.workspace_name).toBe("Minha Starlink");
    const ag = await db.query<{ name: string }>("select name from public.agents where id = $1", [r.agent_id]);
    expect(ag.rows[0].name).toBe("Mini do sítio");

    await expect(claim(code)).rejects.toThrow(/inválido, expirado ou já usado/);
  });

  it("o token recebido ingere dados no workspace certo", async () => {
    const { code } = await newCode(A, wsA);
    const { agent_token } = await claim(code, "Notebook");
    const res = await as("anon", null, () =>
      db.query<{ r: { ok: boolean } }>("select public.ingest_batch($1, $2::jsonb) as r", [
        agent_token,
        JSON.stringify({ terminals: [{ local_id: "1", terminal_key: "ut-par", name: "Mini" }], heartbeat: { ts: 1, dish_reachable: true, version: "x", sync_pending: 0 } }),
      ]),
    );
    expect(res.rows[0].r.ok).toBe(true);
    const t = await db.query<{ workspace_id: string }>("select workspace_id from public.starlink_terminals where terminal_key = 'ut-par'");
    expect(t.rows[0].workspace_id).toBe(wsA);
  });

  it("código expirado não vale; letras parecidas (O/0, I/1) são aceitas", async () => {
    const { code } = await newCode(A, wsA);
    await db.query("update public.pairing_codes set expires_at = now() - interval '1 minute' where used_at is null");
    await expect(claim(code)).rejects.toThrow(/expirado/);
    const ok = await newCode(A, wsA);
    expect((await claim(ok.code.replace(/0/g, "O").replace(/1/g, "I"))).agent_token).toMatch(/^olk_/);
  });

  it("B não gera código no workspace de A, e anon não gera nem lê códigos", async () => {
    await expect(newCode(B, wsA)).rejects.toThrow(/sem permissão/);
    await expect(as("anon", null, () => db.query("select public.create_pairing_code($1)", [wsA]))).rejects.toThrow();
    await expect(as("authenticated", A, () => db.query("select * from public.pairing_codes"))).rejects.toThrow(/permission denied/);
  });

  it("limita a 5 códigos ativos por workspace", async () => {
    await db.query("delete from public.pairing_codes");
    for (let i = 0; i < 5; i++) await newCode(A, wsA);
    await expect(newCode(A, wsA)).rejects.toThrow(/muitos códigos/);
  });
});

describe("conta", () => {
  it("exporta os dados da própria conta", async () => {
    const r = await as("authenticated", A, () => db.query<{ r: { workspaces: unknown[]; agentes: unknown[] } }>("select public.export_my_data() as r"));
    expect(r.rows[0].r.workspaces).toHaveLength(1);
    expect(r.rows[0].r.agentes.length).toBeGreaterThan(0);
  });

  it("excluir a conta apaga o workspace, os agentes e os dados em cascata, sem tocar em B", async () => {
    await as("authenticated", A, () => db.query("select public.delete_my_account()"));
    expect((await db.query("select 1 from auth.users where id = $1", [A])).rows).toHaveLength(0);
    expect((await db.query("select 1 from public.workspaces where id = $1", [wsA])).rows).toHaveLength(0);
    expect((await db.query("select 1 from public.agents where workspace_id = $1", [wsA])).rows).toHaveLength(0);
    expect((await db.query("select 1 from public.starlink_terminals where workspace_id = $1", [wsA])).rows).toHaveLength(0);
    expect((await db.query("select 1 from public.workspaces where owner_id = $1", [B])).rows).toHaveLength(1);
  });

  it("anon não exclui conta", async () => {
    await expect(as("anon", null, () => db.query("select public.delete_my_account()"))).rejects.toThrow();
  });
});
