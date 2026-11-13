// Gera tipos TypeScript a partir do OpenAPI do agente (sem precisar do agente rodando).
// Uso: npm run gen:types   (na raiz)
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const agentDir = join(root, "apps", "agent");
const py = join(agentDir, ".venv", process.platform === "win32" ? "Scripts\\python.exe" : "bin/python");

const spec = execFileSync(
  py,
  ["-c", "import json; from orbitlink_agent.api.app import create_app; print(json.dumps(create_app(start_collector=False).openapi()))"],
  { cwd: agentDir, encoding: "utf8", env: { ...process.env, ORBITLINK_ENV_FILE: "nao-existe.env" } },
);
const ast = await openapiTS(JSON.parse(spec));
const out = join(here, "..", "src", "generated", "agent-openapi.d.ts");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, "// GERADO por scripts/gen-openapi.mjs — não editar à mão.\n" + astToString(ast));
console.log("Tipos gerados em", out);
