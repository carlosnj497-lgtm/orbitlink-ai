import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const USER = "admin";
const PASS = "senha-e2e-segura-123";

async function login(page: Page) {
  await page.goto("/login");
  const setup = page.getByRole("heading", { name: "Criar administrador local" });
  await expect(page.getByRole("button", { name: /Entrar|Criar e entrar/ })).toBeEnabled();
  await page.getByLabel("Usuário").fill(USER);
  await page.getByLabel("Senha", { exact: true }).fill(PASS);
  if (await setup.isVisible()) await page.getByLabel("Confirmar senha").fill(PASS);
  await page.getByRole("button", { name: /Entrar|Criar e entrar/ }).click();
  await page.waitForURL("**/");
}

test.describe.serial("fluxos essenciais", () => {
  test("sem sessão redireciona para o login", async ({ page }) => {
    await page.goto("/consumo");
    await expect(page).toHaveURL(/\/login\?next=%2Fconsumo/);
  });

  test("primeiro acesso, dashboard com origem identificada", async ({ page }) => {
    await login(page);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("Agente em modo FIXTURE")).toBeVisible();
    await expect(page.getByText("Download agora")).toBeVisible();
    // modo fixture: todo número é marcado como demonstração
    await expect(page.getByText("demonstração").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Tráfego corrente, não capacidade|Ocioso/).first()).toBeVisible();
  });

  test("gráficos e consumo carregam", async ({ page }) => {
    await login(page);
    await page.goto("/consumo");
    await expect(page.getByRole("heading", { name: "Consumo de Internet" })).toBeVisible();
    await expect(page.getByText("Como este valor é calculado")).toBeVisible();
    await page.goto("/qualidade");
    await expect(page.getByText("Disponibilidade observada")).toBeVisible();
  });

  test("relatório PDF é baixado", async ({ page }) => {
    await login(page);
    await page.goto("/relatorios");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /Baixar/ }).first().click();
    expect((await download).suggestedFilename()).toMatch(/astryon-relatorio-.*\.pdf/);
  });

  test("solicitação de comando exige confirmação e reporta resultado real", async ({ page }) => {
    await login(page);
    await page.goto("/controle");
    await page.getByRole("button", { name: "Reiniciar a antena…" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Confirmar: Reiniciar a antena");
    const exec = dialog.getByRole("button", { name: "Executar agora" });
    await expect(exec).toBeDisabled();
    await dialog.getByLabel(/para confirmar/).fill("REINICIAR");
    await exec.click();
    // a fixture responde PERMISSION_DENIED: a UI não pode mostrar sucesso
    await expect(dialog).toContainText("Resultado: failed");
    await expect(dialog).toContainText("PERMISSION_DENIED");
  });

  test("demonstração é separada e sinalizada", async ({ page }) => {
    await page.goto("/demo");
    await expect(page.getByRole("note")).toContainText(/Demonstração/i);
  });

  test("franquia: configurar em Configurações e acompanhar em Consumo", async ({ page }) => {
    await login(page);
    // o banco do E2E persiste entre execuções: começa removendo a franquia (campo vazio = sem franquia)
    await page.goto("/configuracoes");
    await page.getByLabel("Franquia mensal do plano (GB)").fill("");
    await page.getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByText("Preferências salvas.")).toBeVisible();
    await page.goto("/consumo");
    await expect(page.getByText("Franquia do plano não configurada")).toBeVisible();
    await page.getByRole("link", { name: "Configurar" }).click();
    await expect(page.getByRole("heading", { name: "Configurações" })).toBeVisible();
    await page.getByLabel("Franquia mensal do plano (GB)").fill("100");
    await page.getByLabel("Dia de virada do ciclo (1–28)").fill("5");
    await page.getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByText("Preferências salvas.")).toBeVisible();
    await page.goto("/consumo");
    await expect(page.getByText("Franquia do ciclo")).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "Franquia consumida" })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations.filter((v) => v.impact === "critical" || v.impact === "serious").map((v) => v.id)).toEqual([]);
  });

  test("alertas: regras de franquia e canais de notificação", async ({ page }) => {
    await login(page);
    await page.goto("/alertas");
    await expect(page.getByText("Franquia: 80% consumida")).toBeVisible();
    await expect(page.getByText("Franquia: 100% consumida")).toBeVisible();
    // sem Telegram/webhook configurado: o teste fica desabilitado e a tela explica como configurar
    await expect(page.getByRole("button", { name: "Enviar teste" })).toBeDisabled();
    await expect(page.getByText(/@BotFather/)).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations.filter((v) => v.impact === "critical" || v.impact === "serious").map((v) => v.id)).toEqual([]);
  });

  test("acessibilidade da visão geral (axe, sem violações críticas)", async ({ page }) => {
    await login(page);
    await page.waitForTimeout(1500);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const critical = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
    expect(critical.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
});
