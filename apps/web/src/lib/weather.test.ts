import type { WeatherHour } from "@orbitlink/shared";
import { describe, expect, it } from "vitest";
import { describeWeather, rainBands, weatherAt, weatherNote } from "./weather";

const H = 3600;
const hour = (ts: number, mm: number | null, level: WeatherHour["rain_level"], extra: Partial<WeatherHour> = {}): WeatherHour => ({
  hour_ts: ts,
  temperature_c: 24,
  precipitation_mm: mm,
  rain_mm: mm,
  cloud_cover_pct: 80,
  wind_kmh: 10,
  gust_kmh: 20,
  weather_code: 61,
  rain_level: level,
  is_forecast: false,
  ...extra,
});

describe("describeWeather", () => {
  it("traduz códigos WMO", () => {
    expect(describeWeather(0).label).toBe("Céu limpo");
    expect(describeWeather(0, false).icon).toBe("moon");
    expect(describeWeather(65).label).toBe("Chuva forte");
    expect(describeWeather(95).icon).toBe("storm");
    expect(describeWeather(null).label).toBe("Sem dado");
  });
});

describe("rainBands", () => {
  it("une horas seguidas do mesmo nível e ignora horas sem dado", () => {
    const hours = [hour(0, 0, "sem_chuva"), hour(H, 12, "forte"), hour(2 * H, 20, "forte"), hour(3 * H, null, null), hour(4 * H, 3, "moderada")];
    expect(rainBands(hours, 0, 5 * H)).toEqual([
      { start: H, end: 3 * H, level: "forte", mm: 20 },
      { start: 4 * H, end: 5 * H, level: "moderada", mm: 3 },
    ]);
  });

  it("recorta as faixas ao período do gráfico", () => {
    expect(rainBands([hour(H, 12, "forte")], H + 1800, 10 * H)).toEqual([{ start: H + 1800, end: 2 * H, level: "forte", mm: 12 }]);
  });
});

describe("weatherAt / weatherNote", () => {
  it("encontra a hora do evento e só comenta o que é relevante", () => {
    const hours = [hour(0, 0.4, "fraca"), hour(H, 14.2, "forte", { weather_code: 95, gust_kmh: 70 })];
    expect(weatherNote(weatherAt(hours, 120))).toBeNull(); // chuva fraca não vira nota
    expect(weatherNote(weatherAt(hours, H + 900))).toBe("chuva forte (14,2 mm/h) · trovoada · rajadas de 70 km/h");
    expect(weatherAt(hours, 5 * H)).toBeNull();
  });
});
