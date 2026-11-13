import { defineConfig } from "@playwright/test";

/**
 * E2E: sobe o agente em MODO FIXTURE (dados sintéticos identificados) com banco temporário e o painel em produção.
 * Pré-requisitos: venv do agente (scripts\install.ps1 no Windows; no Linux veja .github/workflows/ci.yml)
 * e `npx playwright install chromium`.
 */
const agentPython = process.platform === "win32" ? "..\\agent\\.venv\\Scripts\\python.exe" : "../agent/.venv/bin/python";
const token = "e2e-token-somente-para-testes";
const env = {
  ORBITLINK_API_TOKEN: token,
  ORBITLINK_ENV_FILE: "nao-existe.env",
};

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  webServer: [
    {
      command: `${agentPython} -m orbitlink_agent serve --port 8790`,
      cwd: "../agent",
      url: "http://127.0.0.1:8790/v1/health",
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...env,
        ORBITLINK_DATA_DIR: "../../data/e2e",
        ORBITLINK_FIXTURE_FILE: "tests/fixtures/dish_synthetic_v1.json",
        ORBITLINK_STATUS_INTERVAL_S: "2",
        ORBITLINK_HISTORY_INTERVAL_S: "3",
      },
    },
    {
      command: "npx next start -H 127.0.0.1 -p 3100",
      url: "http://127.0.0.1:3100/login",
      reuseExistingServer: false,
      timeout: 120_000,
      env: { ...env, ORBITLINK_AGENT_URL: "http://127.0.0.1:8790" },
    },
  ],
});
