// Executa um binário do venv do agente de forma multiplataforma (Windows: Scripts\x.exe, Linux: bin/x).
// Uso: node scripts/venv.mjs <python|ruff|mypy> [args...]   (cwd = apps/agent)
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const agent = resolve(dirname(fileURLToPath(import.meta.url)), "..", "apps", "agent");
const [tool, ...args] = process.argv.slice(2);
const win = process.platform === "win32";
const exe = join(agent, ".venv", win ? "Scripts" : "bin", win ? `${tool}.exe` : tool);
if (!existsSync(exe)) {
  console.error(`não encontrado: ${exe}\nCrie o venv: ${win ? "scripts\\install.ps1" : "python3 -m venv apps/agent/.venv && apps/agent/.venv/bin/pip install --require-hashes -r apps/agent/requirements-dev.lock && apps/agent/.venv/bin/pip install --no-deps -e apps/agent"}`);
  process.exit(1);
}
const r = spawnSync(exe, args, { cwd: agent, stdio: "inherit" });
process.exit(r.status ?? 1);
