import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// O .env fica na raiz do monorepo (compartilhado com o agente Python). forceReload=true porque o Next já
// carregou (e armazenou em cache) o env do diretório apps/web antes de avaliar este arquivo.
loadEnvConfig(path.resolve(__dirname, "../.."), process.env.NODE_ENV !== "production", undefined, true);

const isDev = process.env.NODE_ENV !== "production";

// Modo nuvem: a interface decide o modo pela flag fixada no build (NEXT_PUBLIC_ASTRYON_CLOUD) e o servidor por
// ASTRYON_CLOUD. Se divergirem, ou faltar o Supabase, o build/start falha aqui em vez de o painel cair em silêncio
// no modo local (chamando 127.0.0.1 na Vercel) com a interface da nuvem. Em execução, cloudEnabled() repete a checagem.
{
  const server = process.env.ASTRYON_CLOUD === "1";
  const client = process.env.NEXT_PUBLIC_ASTRYON_CLOUD === "1";
  if (server || client) {
    const missing = ["ASTRYON_SUPABASE_URL", "ASTRYON_SUPABASE_ANON_KEY"].filter((k) => !process.env[k]);
    if (server !== client) throw new Error("Modo nuvem: defina ASTRYON_CLOUD=1 e NEXT_PUBLIC_ASTRYON_CLOUD=1 juntos (ou nenhum dos dois).");
    if (missing.length) throw new Error(`Modo nuvem ligado sem ${missing.join(" e ")}.`);
  }
}

// CSP: tudo do próprio painel. O Next injeta scripts inline de hidratação ('unsafe-inline'); em desenvolvimento
// o HMR também precisa de 'unsafe-eval' e de websocket. Nada externo é carregado (fontes e imagens são locais).
// Por que não nonce: com cacheComponents/partialPrefetching as páginas têm uma "casca" pré-renderizada no build,
// e os scripts inline dela não teriam o nonce de cada requisição (seriam bloqueados). Nonce exigiria renderizar
// tudo por requisição e abrir mão do cache. A defesa contra XSS continua sendo não injetar HTML (o Markdown da IA
// vira elementos React, sem dangerouslySetInnerHTML) e script-src restrito a 'self'.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // Só vale quando o painel é aberto por HTTPS (Nginx); em HTTP o navegador ignora.
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Opcional: build de verificação em outra pasta, sem sobrescrever o ".next" que o serviço em execução usa.
  distDir: process.env.ASTRYON_WEB_DIST_DIR || ".next",
  // Instalador do Windows: servidor autossuficiente (server.js + node_modules mínimos) para rodar com node.exe
  // portátil. O servidor Linux continua usando "next start".
  ...(process.env.ASTRYON_WEB_STANDALONE === "1" ? { output: "standalone" as const, outputFileTracingRoot: path.resolve(__dirname, "../..") } : {}),
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  transpilePackages: ["@astryon/shared"],
  turbopack: {
    root: path.resolve(__dirname, "../.."),
    rules: {
      // O Tailwind processa a entrada global; CSS Modules preservam o escopo nativo.
      "globals.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
