import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// O .env fica na raiz do monorepo (compartilhado com o agente Python). forceReload=true porque o Next já
// carregou (e armazenou em cache) o env do diretório apps/web antes de avaliar este arquivo.
loadEnvConfig(path.resolve(__dirname, "../.."), process.env.NODE_ENV !== "production", undefined, true);

const isDev = process.env.NODE_ENV !== "production";

// CSP: tudo do próprio painel. O Next injeta scripts inline de hidratação ('unsafe-inline'); em desenvolvimento
// o HMR também precisa de 'unsafe-eval' e de websocket. Nada externo é carregado (fontes e imagens são locais).
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
  distDir: process.env.ORBITLINK_WEB_DIST_DIR || ".next",
  // Instalador do Windows: servidor autossuficiente (server.js + node_modules mínimos) para rodar com node.exe
  // portátil. O servidor Linux continua usando "next start".
  ...(process.env.ORBITLINK_WEB_STANDALONE === "1" ? { output: "standalone" as const, outputFileTracingRoot: path.resolve(__dirname, "../..") } : {}),
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  transpilePackages: ["@orbitlink/shared"],
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
