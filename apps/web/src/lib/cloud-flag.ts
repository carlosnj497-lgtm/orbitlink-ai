/**
 * Painel na nuvem (hospedado, ex.: Vercel): definido no build por NEXT_PUBLIC_ASTRYON_CLOUD=1.
 * Mostra só as telas que funcionam com os dados sincronizados e a página Conta.
 */
export const CLOUD = process.env.NEXT_PUBLIC_ASTRYON_CLOUD === "1";

/** Telas disponíveis na nuvem (o resto depende do agente local: IA, controle, ESP32, alertas, clima...). */
export const CLOUD_SLUGS = ["", "consumo", "qualidade", "antena", "interrupcoes", "conta"] as const;
