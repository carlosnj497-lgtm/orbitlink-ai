/**
 * Contratos compartilhados entre o agente (FastAPI) e o painel (Next.js).
 * Espelham as respostas de `apps/agent/astryon_agent/api/*`. O OpenAPI completo pode ser
 * regenerado em `src/generated/agent-openapi.d.ts` com `npm run gen:types` (agente em execução).
 */
import { z } from "zod";

export const SOURCES = [
  "real",
  "calculada",
  "estimada",
  "importada",
  "sensor_esp32",
  "indisponivel",
  "demonstracao",
] as const;
export type Source = (typeof SOURCES)[number];

export type ConnState = "conectada" | "inicializando" | "buscando" | "degradada" | "offline" | "desconhecida";

export interface Metric {
  value: number | string | boolean | null;
  unit?: string | null;
  source: Source;
  note?: string | null;
}

export interface DeviceIdentity {
  terminal_key: string | null;
  hardware_version: string | null;
  software_version: string | null;
  board_rev: number | null;
  bootcount: number | null;
}

export interface Outage {
  cause: string;
  started_at: string | null;
  duration_s: number | null;
  timestamp_quality: string;
}

export interface DishStatus {
  observed_at: string;
  origin: "grpc" | "fixture";
  state: ConnState;
  state_reason: string | null;
  device: DeviceIdentity;
  metrics: Partial<Record<MetricKey, Metric>>;
  alerts: string[];
  outage: Outage | null;
  fields_present: string[];
  fields_missing: string[];
}

export type MetricKey =
  | "downlink_mbps"
  | "uplink_mbps"
  | "pop_latency_ms"
  | "pop_drop_pct"
  | "uptime_s"
  | "eth_speed_mbps"
  | "snr_above_noise_floor"
  | "obstruction_pct"
  | "currently_obstructed"
  | "obstruction_valid_s"
  | "gps_valid"
  | "gps_sats";

export type StatusResponse =
  | { available: false; dish_reachable: boolean | null; reason: string; error_kind: string | null }
  | { available: true; dish_reachable: boolean | null; age_s: number; stale: boolean; status: DishStatus };

export interface LoopStats {
  runs: number;
  failures: number;
  consecutive_failures: number;
  last_ok: number | null;
  last_error: string | null;
  last_error_kind: string | null;
  last_duration_ms: number | null;
}

export interface AgentInfo {
  version: string;
  mode: "real" | "fixture" | "sem_coletor";
  started_at: number;
  now: number;
  dish_target: string;
  dish_reachable: boolean | null;
  terminal_id: number | null;
  boot_id: string | null;
  last_status_ts: number | null;
  status_age_s: number | null;
  status_stale: boolean;
  firmware: string | null;
  hardware: string | null;
  capabilities_checked: number | null;
  history_inserted_total: number;
  history_lost_total: number;
  loops: Record<string, LoopStats>;
  sse_subscribers: number;
  db_bytes: number;
  sync_pending: number;
  supabase_configured: boolean;
  ai_configured: boolean;
  timezone: string;
  terminal_name: string;
  router_target: string;
  intervals: { status_s: number; history_s: number; obstruction_s: number };
}

export type CapStatus =
  | "verificada"
  | "schema_presente"
  | "ausente_no_schema"
  | "campo_ausente"
  | "nao_implementada"
  | "negada"
  | "timeout"
  | "inalcancavel"
  | "erro"
  | "nao_consultada";

export interface Capability {
  target: string;
  key: string;
  device: "dish" | "router";
  label: string;
  origin: string;
  kind: "leitura" | "controle";
  status: CapStatus;
  available: boolean;
  offered: boolean;
  detail: string | null;
  checked_at: number;
}

export interface Gap {
  kind: "history_lost" | "agent_offline" | "dish_unreachable" | string;
  start_ts: number;
  end_ts: number | null;
  samples_lost: number | null;
  detail: string | null;
}

export interface TelemetryPoint {
  t: number;
  n: number;
  down_mbps: number | null;
  up_mbps: number | null;
  down_max_mbps: number | null;
  up_max_mbps: number | null;
  latency_ms: number | null;
  drop_pct: number | null;
  power_w: number | null;
}

export interface Telemetry {
  start: number;
  end: number;
  bucket_s: number;
  series_source: "history_1s" | "minute_aggregates" | "status_10s" | "none";
  source: Source;
  coverage: number;
  points: TelemetryPoint[];
  gaps: Gap[];
  note?: string;
}

export interface UsageWindow {
  start: number;
  end: number;
  bytes_download: number;
  bytes_upload: number;
  bytes_total: number;
  observed_seconds: number;
  coverage: number;
  source: Source;
}

export interface UsageProjection {
  available: boolean;
  reason?: string;
  bytes_total?: number;
  low?: number;
  high?: number;
  days_used?: number;
  source?: Source;
  method?: string;
}

/** Consumo do ciclo de cobrança frente à franquia configurada (estimativa local, nunca o valor oficial). */
export interface UsagePlan {
  configured: boolean;
  cap_bytes: number | null;
  cycle_start_day: number;
  cycle_start: number;
  cycle_end: number;
  days_remaining: number;
  used: UsageWindow;
  pct_used: number | null;
  remaining_bytes: number | null;
  /** true quando houve períodos não observados: o consumo real é igual ou maior */
  lower_bound: boolean;
  projection: UsageProjection | null;
  projected_pct: number | null;
  source: Source;
  method: string;
}

export interface NotificationStatus {
  channels: { webhook: boolean; telegram: boolean };
  pending: number;
  failed_24h: number;
  last_sent_at: number | null;
  last_error: { channel: string; last_error: string; at: number } | null;
  /** Bot que responde perguntas (copiloto) no chat autorizado. */
  telegram_chat?: { enabled: boolean; last_poll_ok?: number | null; last_error?: string | null; answered?: number };
}

/** Resumo semanal pelo Telegram (GET /v1/alerts/digest). weekday: 0 = segunda ... 6 = domingo. */
export interface DigestStatus {
  enabled: boolean;
  telegram: boolean;
  weekday: number;
  hour: number;
  /** Próximo envio (epoch s); null quando desativado ou sem Telegram. */
  next_at: number | null;
  /** Fim (0h local) da última semana já processada. */
  last_period_end: number | null;
}

export interface UsageSummary {
  timezone: string;
  today: UsageWindow;
  yesterday: UsageWindow;
  week: UsageWindow;
  month: UsageWindow;
  previous_month: UsageWindow;
  /**
   * Mês anterior só até o mesmo ponto do mês atual (mesmo tempo decorrido). Opcional: agentes antigos não mandam,
   * e aí a comparação mês a mês não é mostrada.
   */
  previous_month_to_date?: UsageWindow | null;
  projection_month: UsageProjection | null;
  method: string;
}

export interface UsageSeriesPoint {
  t: number;
  label: string;
  bytes_download: number;
  bytes_upload: number;
  bytes_total: number;
  coverage: number;
  source: Source;
}

export interface UsageSeries {
  bucket: "hour" | "day" | "month";
  timezone: string;
  points: UsageSeriesPoint[];
  imported: { period_start: number; period_end: number; bytes_down: number | null; bytes_up: number | null; bytes_total: number }[];
  peak_hour: { h: number; b: number } | null;
  method: string;
  gaps: Gap[];
}

export interface QualityHour {
  hour: number;
  observed_seconds: number;
  loss_pct: number | null;
  latency_avg_ms: number | null;
  full_drop_s: number;
}

export interface Quality {
  start: number;
  end: number;
  timezone: string;
  source: Source;
  observed_seconds: number;
  coverage: number;
  availability_pct: number | null;
  availability_note: string;
  loss_pct: number | null;
  latency_p50_ms: number | null;
  latency_p95_ms: number | null;
  latency_max_ms: number | null;
  latency_note: string;
  jitter_ms: number | null;
  jitter_note: string;
  full_drop_seconds: number;
  by_hour: QualityHour[];
  gaps: Gap[];
}

export interface ConnectionEvent {
  id: number;
  terminal_id: number | null;
  kind: "outage" | "status_outage" | "ping_drop" | "unreachable" | "boot" | string;
  cause: string | null;
  start_ts: number;
  end_ts: number | null;
  duration_s: number | null;
  confidence: "confirmado" | "derivado" | "indeterminado";
  evidence: Record<string, unknown>;
  open: boolean;
}

export interface EventsResponse {
  start: number;
  end: number;
  events: ConnectionEvent[];
  gaps: Gap[];
}

export interface ObstructionResponse {
  map: {
    ts: number;
    num_rows: number;
    num_cols: number;
    snr: number[];
    min_elevation_deg: number | null;
    max_theta_deg: number | null;
    source: Source;
  } | null;
  map_capability: { status: CapStatus; detail: string | null } | null;
  trend: { t: number; obstruction_pct: number | null; obstructed_samples: number; n: number }[];
}

/** Clima (Open-Meteo): estimativa regional para correlacionar com a conexão, nunca causa. */
export type RainLevel = "sem_chuva" | "fraca" | "moderada" | "forte" | "muito_forte";

export interface WeatherReading {
  temperature_c: number | null;
  precipitation_mm: number | null;
  rain_mm: number | null;
  cloud_cover_pct: number | null;
  wind_kmh: number | null;
  gust_kmh: number | null;
  weather_code: number | null;
  rain_level: RainLevel | null;
}

export interface WeatherStatus {
  enabled: boolean;
  configured: boolean;
  location: { name: string; latitude: number; longitude: number } | null;
  current: (WeatherReading & { ts: number; fetched_at: number; is_day: boolean | null; stale: boolean }) | null;
  last_ok_at: number | null;
  last_error: string | null;
  provider: string;
  source: Source;
  note: string;
}

export interface WeatherHour extends WeatherReading {
  hour_ts: number;
  is_forecast: boolean;
}

export interface WeatherHourly {
  start: number;
  end: number;
  source: Source;
  provider: string;
  hours: WeatherHour[];
}

export interface GeocodeResult {
  name: string;
  latitude: number;
  longitude: number;
}

/** Saúde do próprio servidor (o que o sistema não informa vem null, nunca 0). */
export interface ServerHealth {
  disk: { free_bytes: number | null; total_bytes: number | null; free_pct: number | null };
  db_size_bytes: number;
  cpu_temp_c: number | null;
  mem_available_pct: number | null;
  load_1m: number | null;
  cpus: number | null;
  last_backup_at: number | null;
  healthcheck_configured: boolean;
  checked_at: number;
}

/** Comparação de períodos e melhores horários (tendência do passado observado). */
export interface PeriodStats {
  start: number;
  end: number;
  availability_pct: number | null;
  loss_pct: number | null;
  latency_p50_ms: number | null;
  latency_p95_ms: number | null;
  jitter_ms: number | null;
  bytes_total: number | null;
  drops: number;
  coverage: number;
  source: Source;
}

export interface InsightsCompare {
  current: PeriodStats;
  previous: PeriodStats;
  rain: Record<"chuva" | "sem_chuva", { loss_pct: number | null; observed_seconds: number }> | null;
  weather_configured: boolean;
  note: string;
}

export interface HourStat {
  hour: number;
  loss_pct: number;
  latency_ms: number | null;
  observed_seconds: number;
}

export interface BestHours {
  days: number;
  hours: HourStat[];
  best: HourStat[];
  worst: HourStat[];
  next_good: { ts: number; hour: number }[];
  enough_data: boolean;
  note: string;
}

/** Payloads SSE validados no cliente. */
export const sseAgentSchema = z.object({ version: z.string(), mode: z.string() }).passthrough();
export const sseStatusSchema = z
  .object({ observed_at: z.string(), state: z.string(), metrics: z.record(z.string(), z.any()) })
  .passthrough();
