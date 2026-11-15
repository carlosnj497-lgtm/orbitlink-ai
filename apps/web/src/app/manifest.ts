import type { MetadataRoute } from "next";

/** Painel instalável (PWA). O celular só oferece "instalar" quando o painel abre por HTTPS. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ASTRYON · Starlink Mini",
    short_name: "ASTRYON",
    description: "Monitoramento local da sua Starlink Mini.",
    lang: "pt-BR",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#05080f",
    theme_color: "#05080f",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Ao vivo", url: "/ao-vivo" },
      { name: "Central de IA", url: "/assistente" },
      { name: "Eventos", url: "/interrupcoes" },
    ],
  };
}
