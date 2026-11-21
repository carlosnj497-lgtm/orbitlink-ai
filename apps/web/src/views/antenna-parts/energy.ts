import type { TelemetryPoint } from "@astryon/shared";

/** Estatísticas da série de potência; start/end são epoch em segundos. */
export function powerStatistics(points: Pick<TelemetryPoint, "power_w">[], start: number, end: number) {
  const values = points.map((p) => p.power_w).filter((v): v is number => v !== null && v !== undefined);
  if (!values.length) return null;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const hours = (end - start) / 3600;
  return {
    avg,
    max: Math.max(...values),
    min: Math.min(...values),
    kwh: hours > 0 ? (avg * hours) / 1000 : null,
  };
}
