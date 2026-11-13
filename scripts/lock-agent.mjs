#!/usr/bin/env node
// Regenera as versões travadas do agente Python (com hash de cada arquivo):
//   apps/agent/requirements.lock      execução + IA  -> usado pelo servidor Ubuntu (deploy/linux)
//   apps/agent/requirements-dev.lock  + ferramentas  -> usado pelo install.ps1 e pelo CI
// Os dois arquivos valem para Windows e Linux (--universal) com Python 3.12.
// Requer o uv: `pip install uv` (ou https://docs.astral.sh/uv/). Uso: npm run lock:agent [-- --upgrade]
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const agent = join(root, "apps", "agent");
const win = process.platform === "win32";
const local = join(root, "tools-venv", win ? "Scripts" : "bin", win ? "uv.exe" : "uv");
const uv = existsSync(local) ? local : "uv";
const extra = process.argv.slice(2); // ex.: --upgrade, --upgrade-package fastapi

const common = ["pip", "compile", "pyproject.toml", "--universal", "--python-version", "3.12", "--generate-hashes",
  "--custom-compile-command", "npm run lock:agent", "--quiet", ...extra];

function run(args) {
  const r = spawnSync(uv, args, { cwd: agent, stdio: "inherit" });
  if (r.error) {
    console.error(`Não encontrei o uv (${r.error.code}). Instale com: pip install uv`);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run([...common, "--extra", "ai", "-o", "requirements.lock"]);
// o lock de desenvolvimento é restrito às mesmas versões do lock de execução
run([...common, "--extra", "ai", "--extra", "dev", "-c", "requirements.lock", "-o", "requirements-dev.lock"]);
console.log("apps/agent/requirements.lock e requirements-dev.lock atualizados. Rode npm run test:agent antes de commitar.");
