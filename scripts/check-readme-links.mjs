#!/usr/bin/env node
/**
 * Verifica os links do README:
 *   - arquivos locais (docs, imagens, LICENSE, workflows);
 *   - âncoras internas (#secao) contra os títulos do README;
 *   - opcionalmente, links externos com `--external`.
 *
 * Uso:
 *   node scripts/check-readme-links.mjs
 *   node scripts/check-readme-links.mjs --external
 *
 * Sem dependências: usa apenas Node.js 20+ (fetch nativo).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readmePath = resolve(root, "README.md");
const raw = readFileSync(readmePath, "utf8");

/** Remove blocos de código para não validar links de exemplos. */
const text = raw
  .replace(/```[\s\S]*?```/g, "")
  .replace(/~~~[\s\S]*?~~~/g, "");

/** Gera âncoras no estilo do GitHub (aproximado o suficiente para o README). */
function slugify(title) {
  return title
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

const seen = new Map();
const anchors = new Set();
for (const line of text.split("\n")) {
  const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
  if (!match) continue;
  const base = slugify(match[2]);
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  anchors.add(count === 0 ? base : `${base}-${count}`);
}

const links = [];
for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) links.push(match[1]);
for (const match of text.matchAll(/<(?:a|img)\b[^>]*\b(?:href|src)="([^"]+)"/gi)) links.push(match[1]);

const local = new Set();
const internal = new Set();
const external = new Set();

for (const link of links) {
  if (link.startsWith("#")) {
    internal.add(link.slice(1));
    continue;
  }
  if (/^(https?:)?\/\//i.test(link)) {
    external.add(link);
    continue;
  }
  if (/^(mailto:|tel:)/i.test(link)) continue;
  const clean = link.split("#")[0].split("?")[0];
  if (clean) local.add(clean);
}

let failures = 0;

for (const rel of local) {
  const path = resolve(root, decodeURIComponent(rel));
  if (!existsSync(path)) {
    console.error(`❌ arquivo não encontrado: ${rel}`);
    failures++;
  }
}

for (const rawAnchor of internal) {
  let anchor = rawAnchor;
  try {
    anchor = decodeURIComponent(rawAnchor);
  } catch {
    // mantém o valor original se não for percent-encoding válido
  }
  if (!anchors.has(anchor)) {
    console.error(`❌ âncora não encontrada: #${rawAnchor}`);
    failures++;
  }
}

console.log(
  `Arquivos locais: ${local.size} · âncoras: ${internal.size} · links externos: ${external.size}`,
);

if (failures) {
  console.error(`\n${failures} problema(s) encontrado(s).`);
  process.exit(1);
}
console.log("✅ README: arquivos e âncoras OK.");

if (!process.argv.includes("--external")) process.exit(0);

/** URLs que respondem 404 para robôs mas funcionam no navegador. */
const skip = [/github\.com\/[^/]+\/[^/]+\/stargazers/i];

/** Imagens externas não são links de navegação; o README já valida as locais. */
function isExternalImage(url) {
  return (
    /img\.shields\.io/i.test(url) ||
    /camo\.githubusercontent\.com/i.test(url) ||
    /\.(svg|png|jpe?g|webp|gif)(\?|#|$)/i.test(url)
  );
}

const urls = [...external].filter(
  (url) => !skip.some((re) => re.test(url)) && !isExternalImage(url),
);

const results = [];
const concurrency = 5;
let index = 0;

async function worker() {
  while (index < urls.length) {
    const url = urls[index++];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: { "user-agent": "ASTRYON-readme-link-checker" },
      });
      results.push({ url, status: response.status });
    } catch (error) {
      results.push({ url, status: 0, error: error?.name ?? "erro" });
    } finally {
      clearTimeout(timer);
    }
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));

for (const result of results.sort((a, b) => a.url.localeCompare(b.url))) {
  const ok = result.status >= 200 && result.status < 400;
  const warning = result.status === 403 || result.status === 429;
  console.log(`${ok ? "✅" : warning ? "⚠️" : "❌"} ${result.status || result.error} ${result.url}`);
  if (!ok && !warning) failures++;
}

if (failures) {
  console.error(`\n${failures} link(s) externo(s) com problema.`);
  process.exit(1);
}
console.log(`\n✅ ${results.length} link(s) externo(s) OK.`);
