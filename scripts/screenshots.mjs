#!/usr/bin/env node
/**
 * Regenera as capturas do README a partir da rota /demo.
 *
 * Pré-requisito: painel rodando em http://127.0.0.1:3000
 *   npm run dev
 *
 * Uso:
 *   npm run screenshots
 *   ASTRYON_BASE_URL=http://127.0.0.1:3000 npm run screenshots
 *
 * As imagens são salvas em docs/screenshots/*.webp.
 */
import { chromium } from "playwright";
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, process.env.ASTRYON_SCREENSHOT_DIR || "docs/screenshots");
const base = (process.env.ASTRYON_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");

const desktop = [
  { path: "/demo/consumo", file: "consumo.webp" },
  { path: "/demo/antena", file: "antena.webp" },
  { path: "/demo/qualidade", file: "qualidade.webp" },
  { path: "/demo/interrupcoes", file: "eventos.webp" },
  { path: "/demo/relatorios", file: "relatorios.webp" },
  { path: "/demo/assistente", file: "central-ia.webp" },
  { path: "/demo", file: "dashboard.webp", fullPage: true, waitFor: "text=Download" },
  { path: "/login", file: "login.webp" },
];

const mobile = { path: "/demo", file: "celular.webp", waitFor: "text=Download" };

async function capture(page, { path, file, fullPage = false, waitFor }) {
  await page.goto(`${base}${path}`, { waitUntil: "networkidle", timeout: 30_000 });
  if (waitFor) {
    await page.waitForSelector(waitFor, { timeout: 20_000 }).catch(() => {});
  }
  // Dá tempo para os gráficos e o banner de demonstração renderizarem.
  await page.waitForTimeout(1_200);
  const buffer = await page.screenshot({ fullPage });
  await sharp(buffer).webp({ quality: 82, effort: 6 }).toFile(resolve(outDir, file));
  console.log(`✅ ${file}`);
}

async function main() {
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  try {
    const desktopContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    const desktopPage = await desktopContext.newPage();
    for (const shot of desktop) await capture(desktopPage, shot);
    await desktopContext.close();

    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      isMobile: true,
    });
    const mobilePage = await mobileContext.newPage();
    await capture(mobilePage, mobile);
    await mobileContext.close();
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("\nFalha ao gerar as capturas.");
  console.error(`Confirme que o painel está rodando em ${base} (npm run dev).`);
  console.error(error);
  process.exit(1);
});
