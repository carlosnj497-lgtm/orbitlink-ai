/**
 * Clima (Open-Meteo): textos, ícones e cruzamento com a conexão.
 *
 * O clima é uma ESTIMATIVA REGIONAL do modelo meteorológico, não um sensor no telhado. Por isso o painel
 * sempre fala em coincidência ("coincidiu com chuva forte"), nunca em causa.
 */
import type { RainLevel, WeatherHour } from "@orbitlink/shared";

export type WeatherIcon = "sun" | "moon" | "cloud-sun" | "cloud" | "fog" | "drizzle" | "rain" | "snow" | "storm";

/** Códigos WMO usados pela Open-Meteo → descrição em português e ícone. */
export function describeWeather(code: number | null | undefined, isDay = true): { label: string; icon: WeatherIcon } {
  if (code === null || code === undefined) return { label: "Sem dado", icon: "cloud" };
  if (code === 0) return { label: "Céu limpo", icon: isDay ? "sun" : "moon" };
  if (code === 1) return { label: "Predomínio de sol", icon: isDay ? "sun" : "moon" };
  if (code === 2) return { label: "Parcialmente nublado", icon: "cloud-sun" };
  if (code === 3) return { label: "Nublado", icon: "cloud" };
  if (code === 45 || code === 48) return { label: "Neblina", icon: "fog" };
  if (code >= 51 && code <= 57) return { label: "Garoa", icon: "drizzle" };
  if (code === 61 || code === 80) return { label: "Chuva fraca", icon: "rain" };
  if (code === 63 || code === 81) return { label: "Chuva moderada", icon: "rain" };
  if (code === 65 || code === 82) return { label: "Chuva forte", icon: "rain" };
  if (code === 66 || code === 67) return { label: "Chuva congelante", icon: "rain" };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { label: "Neve", icon: "snow" };
  if (code === 95) return { label: "Trovoada", icon: "storm" };
  if (code === 96 || code === 99) return { label: "Trovoada com granizo", icon: "storm" };
  return { label: "Condição desconhecida", icon: "cloud" };
}

export const RAIN_META: Record<RainLevel, { label: string; opacity: number }> = {
  sem_chuva: { label: "sem chuva", opacity: 0 },
  fraca: { label: "chuva fraca", opacity: 0.1 },
  moderada: { label: "chuva moderada", opacity: 0.2 },
  forte: { label: "chuva forte", opacity: 0.32 },
  muito_forte: { label: "chuva muito forte", opacity: 0.45 },
};

/** Chuva relevante para a conexão: moderada ou mais. Garoa e chuva fraca raramente aparecem na telemetria. */
export const isNotableRain = (level: RainLevel | null | undefined) => level === "moderada" || level === "forte" || level === "muito_forte";

export interface RainBand {
  start: number;
  end: number;
  level: RainLevel;
  mm: number;
}

/**
 * Horas com chuva viram faixas para sobrepor aos gráficos. Horas seguidas do mesmo nível são unidas;
 * hora sem dado de chuva não vira faixa (nunca é tratada como "sem chuva").
 */
export function rainBands(hours: WeatherHour[], start: number, end: number): RainBand[] {
  const bands: RainBand[] = [];
  for (const h of hours) {
    if (!h.rain_level || h.rain_level === "sem_chuva" || h.precipitation_mm === null) continue;
    const s = Math.max(h.hour_ts, start);
    const e = Math.min(h.hour_ts + 3600, end);
    if (e <= s) continue;
    const last = bands[bands.length - 1];
    if (last && last.level === h.rain_level && last.end === h.hour_ts) {
      last.end = e;
      last.mm = Math.max(last.mm, h.precipitation_mm);
    } else {
      bands.push({ start: s, end: e, level: h.rain_level, mm: h.precipitation_mm });
    }
  }
  return bands;
}

/** Clima da hora que contém o instante `ts` (ou null, se não houver registro daquela hora). */
export function weatherAt(hours: WeatherHour[], ts: number): WeatherHour | null {
  const hour = Math.floor(ts / 3600) * 3600;
  return hours.find((h) => h.hour_ts === hour) ?? null;
}

/** Frase curta para um evento: só fala de clima quando há algo digno de nota naquela hora. */
export function weatherNote(h: WeatherHour | null): string | null {
  if (!h) return null;
  const parts: string[] = [];
  if (isNotableRain(h.rain_level) && h.precipitation_mm !== null) parts.push(`${RAIN_META[h.rain_level!].label} (${h.precipitation_mm.toFixed(1).replace(".", ",")} mm/h)`);
  if (h.weather_code !== null && h.weather_code >= 95) parts.push("trovoada");
  if (h.gust_kmh !== null && h.gust_kmh >= 60) parts.push(`rajadas de ${Math.round(h.gust_kmh)} km/h`);
  return parts.length ? parts.join(" · ") : null;
}
