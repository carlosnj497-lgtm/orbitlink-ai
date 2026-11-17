import { fmtDuration, fmtNumber } from "@/lib/format";

export interface Rule {
  id: number;
  name: string;
  kind: string;
  operator: "gt" | "lt";
  threshold: number;
  min_duration_s: number;
  window_s: number;
  severity: "info" | "warn" | "crit";
  cooldown_s: number;
  hysteresis: number;
  enabled: boolean;
  silenced_until: number | null;
  last_event: { status: string; started_at: number; resolved_at: number | null; occurrences: number } | null;
  /** Última avaliação do motor (a cada ~30 s). value null = sem dado recente; current null = regra não avaliada. */
  current?: { value: number | null; measured_at: number } | null;
  /** Desde quando o valor está além do limite, esperando a duração mínima para disparar. */
  breaching_since?: number | null;
}

export interface AlertEvent {
  id: number;
  rule_name: string;
  status: "active" | "resolved";
  severity: string;
  started_at: number;
  resolved_at: number | null;
  message: string;
  occurrences: number;
  acknowledged_at: number | null;
}

export type Kinds = Record<string, { label: string; unit: string; operator: string }>;

/**
 * Como cada condição vira frase: "Avise quando {subject} {verb} {limite} {unidade}".
 * binary: a condição é um acontecimento (sem limite). noDuration: o próprio limite já é um tempo ou um acumulado.
 * windowLabel: a janela faz parte da frase ("em 1 h", "nas próximas 3 h").
 */
export const KIND_TEXT: Record<string, { subject: string; verb?: string; unit?: string; binary?: boolean; noDuration?: boolean; windowLabel?: string }> = {
  dish_unreachable: { subject: "a antena ficar fora do ar", verb: "por mais de", noDuration: true },
  latency_high: { subject: "a latência média", verb: "passar de" },
  loss_high: { subject: "a perda de pacotes", verb: "passar de" },
  multiple_drops: { subject: "o número de quedas", verb: "passar de", unit: "quedas", noDuration: true, windowLabel: "em" },
  usage_month: { subject: "o consumo do mês", verb: "passar de", noDuration: true },
  usage_cap_pct: { subject: "a franquia usada no ciclo", verb: "passar de", noDuration: true },
  obstruction_high: { subject: "a obstrução", verb: "passar de" },
  esp32_offline: { subject: "o ESP32 ficar sem sinal", verb: "por mais de", noDuration: true },
  esp32_voltage_low: { subject: "a tensão medida pelo ESP32", verb: "cair abaixo de" },
  esp32_voltage_high: { subject: "a tensão medida pelo ESP32", verb: "passar de" },
  esp32_power_lost: { subject: "a alimentação for interrompida (ESP32)", binary: true },
  esp32_temp_high: { subject: "a temperatura do ESP32", verb: "passar de" },
  dish_rebooted: { subject: "a antena reiniciar", binary: true },
  dish_firmware_changed: { subject: "o firmware da antena for atualizado", binary: true },
  server_disk_low: { subject: "o espaço livre no disco do servidor", verb: "cair abaixo de" },
  server_temp_high: { subject: "a temperatura do servidor", verb: "passar de" },
  weather_rain_forecast: { subject: "a previsão de chuva", verb: "passar de", noDuration: true, windowLabel: "nas próximas" },
};

export const SEVERITY: Record<Rule["severity"], { word: string; tone: "info" | "warn" | "crit" }> = {
  info: { word: "aviso", tone: "info" },
  warn: { word: "atenção", tone: "warn" },
  crit: { word: "crítico", tone: "crit" },
};

/** Espaço fino inseparável entre número e unidade (o espaço da fonte mono é largo demais). */
const NB = "\u202F";

export const DURATIONS = [0, 60, 300, 900, 1800, 3600];
export const WINDOWS = [300, 900, 3600, 3 * 3600, 6 * 3600, 24 * 3600];

/** Tempo em português curto: "5 min", "1 h", "imediatamente". */
export function fmtSpan(s: number): string {
  if (s <= 0) return "imediatamente";
  if (s % 3600 === 0) return `${s / 3600}${NB}h`;
  if (s % 60 === 0) return `${s / 60}${NB}min`;
  return fmtDuration(s);
}

export function unitOf(kind: string, kinds?: Kinds): string {
  const t = KIND_TEXT[kind];
  if (t?.unit) return t.unit;
  const u = kinds?.[kind]?.unit ?? "";
  return u === "eventos" ? "" : u;
}

/** Valor medido no formato da unidade: segundos viram duração, porcentagem com 1 casa, tensão com 2. */
export function fmtReading(kind: string, v: number, kinds?: Kinds): string {
  const unit = unitOf(kind, kinds);
  if (unit === "s") return fmtDuration(v);
  const digits = unit === "V" ? 2 : unit === "%" || unit === "GB" || unit === "mm/h" ? 1 : 0;
  return `${fmtNumber(v, digits)}${unit ? `${NB}${unit}` : ""}`;
}

export function fmtThreshold(kind: string, v: number, kinds?: Kinds): string {
  const unit = unitOf(kind, kinds);
  if (unit === "s") return fmtSpan(v);
  return `${fmtNumber(v, v % 1 ? (unit === "V" ? 2 : 1) : 0)}${unit ? `${NB}${unit}` : ""}`;
}

/** Modelos prontos para uma regra nova. */
export const PRESETS: { label: string; kind: string; threshold: number; min_duration_s: number; window_s: number; severity: Rule["severity"]; name: string }[] = [
  { label: "Latência alta", name: "Latência alta", kind: "latency_high", threshold: 100, min_duration_s: 300, window_s: 300, severity: "warn" },
  { label: "Perda de pacotes", name: "Perda de pacotes alta", kind: "loss_high", threshold: 2, min_duration_s: 300, window_s: 300, severity: "warn" },
  { label: "Quedas repetidas", name: "Quedas repetidas", kind: "multiple_drops", threshold: 3, min_duration_s: 0, window_s: 3600, severity: "warn" },
  { label: "Antena fora do ar", name: "Antena fora do ar", kind: "dish_unreachable", threshold: 60, min_duration_s: 0, window_s: 300, severity: "crit" },
  { label: "Franquia no fim", name: "Franquia quase no fim", kind: "usage_cap_pct", threshold: 80, min_duration_s: 0, window_s: 3600, severity: "info" },
  { label: "Disco do servidor", name: "Pouco disco no servidor", kind: "server_disk_low", threshold: 10, min_duration_s: 0, window_s: 3600, severity: "crit" },
  { label: "Chuva forte", name: "Chuva forte prevista", kind: "weather_rain_forecast", threshold: 5, min_duration_s: 0, window_s: 3 * 3600, severity: "info" },
];
