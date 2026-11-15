/**
 * DADOS DE DEMONSTRAÇÃO — gerados deterministicamente no navegador, usados SOMENTE na rota /demo.
 * Toda resposta vem marcada com source="demonstracao". Nada aqui representa uma antena real.
 */
import type {
  AgentInfo,
  Capability,
  EventsResponse,
  ObstructionResponse,
  Quality,
  StatusResponse,
  Telemetry,
  UsagePlan,
  UsageSeries,
  UsageSummary,
  WeatherHour,
  WeatherHourly,
  WeatherStatus,
} from "@astryon/shared";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const now = () => Math.floor(Date.now() / 1000);
const RANGES: Record<string, number> = { "15m": 900, "1h": 3600, "6h": 21600, "24h": 86400, "7d": 604800, "30d": 2592000, "90d": 7776000 };

function rangeOf(q: URLSearchParams, def: string): [number, number] {
  const e = Number(q.get("end")) || now();
  const s = Number(q.get("start")) || e - (RANGES[q.get("range") ?? def] ?? 3600);
  return [s, e];
}

function diurnal(t: number) {
  const h = ((t / 3600 - 3) % 24 + 24) % 24; // hora local aproximada (UTC-3)
  return 0.25 + 0.75 * Math.max(0, Math.sin(((h - 7) / 16) * Math.PI)) ** 1.5;
}

function telemetry(q: URLSearchParams): Telemetry {
  const [s, e] = rangeOf(q, "1h");
  const span = e - s;
  const bucket = Math.max(1, Math.ceil(span / 600));
  const r = rng(Math.floor(s / bucket));
  const points = [];
  for (let t = s - (s % bucket); t < e; t += bucket) {
    const d = diurnal(t);
    const drop = r() < 0.01 ? 100 : r() < 0.05 ? r() * 8 : 0;
    points.push({
      t,
      n: bucket,
      down_mbps: drop === 100 ? 0 : +(d * (18 + r() * 40)).toFixed(2),
      up_mbps: drop === 100 ? 0 : +(d * (1.5 + r() * 5)).toFixed(2),
      down_max_mbps: +(d * 90).toFixed(1),
      up_max_mbps: +(d * 12).toFixed(1),
      latency_ms: drop === 100 ? null : +(24 + r() * 14 + (r() < 0.04 ? 40 : 0)).toFixed(1),
      drop_pct: +drop.toFixed(2),
      power_w: +(19 + d * 9 + r() * 2).toFixed(1),
    });
  }
  return {
    start: s, end: e, bucket_s: bucket, series_source: bucket < 60 ? "history_1s" : "minute_aggregates",
    source: "demonstracao", coverage: 0.97, points,
    gaps: [{ kind: "agent_offline", start_ts: e - Math.floor(span * 0.35), end_ts: e - Math.floor(span * 0.33), samples_lost: null, detail: "Lacuna fictícia de demonstração" }],
    note: "Tráfego = uso corrente reportado pela antena, não é teste de velocidade/capacidade.",
  };
}

function win(s: number, e: number, perDay: number) {
  const days = (e - s) / 86400;
  const total = Math.round(perDay * days);
  return { start: s, end: e, bytes_download: Math.round(total * 0.9), bytes_upload: Math.round(total * 0.1), bytes_total: total, observed_seconds: Math.round((e - s) * 0.96), coverage: 0.96, source: "demonstracao" as const };
}

function usageSummary(): UsageSummary {
  const e = now();
  const day = e - ((e - 3 * 3600) % 86400);
  const month = e - 11 * 86400;
  return {
    timezone: "America/Fortaleza",
    today: win(day, e, 6.2e9),
    yesterday: win(day - 86400, day, 6.8e9),
    week: win(day - 3 * 86400, e, 6.5e9),
    month: win(month, e, 6.4e9),
    previous_month: win(month - 30 * 86400, month, 5.9e9),
    projection_month: { available: true, bytes_total: 1.95e11, low: 1.78e11, high: 2.12e11, days_used: 11, source: "estimada", method: "Demonstração" },
    method: "DEMONSTRAÇÃO — valores fictícios.",
  };
}

function usagePlan(): UsagePlan {
  const e = now();
  const start = e - 11 * 86400;
  const used = win(start, e, 6.4e9);
  const cap = 100e9;
  return {
    configured: true,
    cap_bytes: cap,
    cycle_start_day: 1,
    cycle_start: start,
    cycle_end: start + 30 * 86400,
    days_remaining: 19,
    used,
    pct_used: (used.bytes_total / cap) * 100,
    remaining_bytes: Math.max(0, cap - used.bytes_total),
    lower_bound: true,
    projection: { available: true, bytes_total: 1.95e11, low: 1.78e11, high: 2.12e11, days_used: 11, source: "estimada", method: "Demonstração" },
    projected_pct: 195,
    source: "demonstracao",
    method: "DEMONSTRAÇÃO — franquia e valores fictícios.",
  };
}

function usageSeries(q: URLSearchParams): UsageSeries {
  const [s, e] = rangeOf(q, "30d");
  const bucket = (q.get("bucket") ?? "day") as "hour" | "day" | "month";
  const size = bucket === "hour" ? 3600 : bucket === "month" ? 2592000 : 86400;
  const r = rng(s);
  const points = [];
  for (let t = s - (s % size); t < e; t += size) {
    const total = size === 3600 ? diurnal(t) * 6e8 * (0.6 + r()) : 6.4e9 * (0.7 + r() * 0.6) * (size / 86400);
    points.push({ t, label: new Date(t * 1000).toISOString(), bytes_download: Math.round(total * 0.9), bytes_upload: Math.round(total * 0.1), bytes_total: Math.round(total), coverage: 0.9 + r() * 0.1, source: "demonstracao" as const });
  }
  return { bucket, timezone: "America/Fortaleza", points, imported: [], peak_hour: { h: e - 6 * 3600, b: 9.1e8 }, method: "DEMONSTRAÇÃO", gaps: [] };
}

function quality(q: URLSearchParams): Quality {
  const [s, e] = rangeOf(q, "24h");
  const r = rng(7);
  return {
    start: s, end: e, timezone: "America/Fortaleza", source: "demonstracao", observed_seconds: Math.round((e - s) * 0.96), coverage: 0.96,
    availability_pct: 99.42, availability_note: "Demonstração", loss_pct: 0.71, latency_p50_ms: 31.2, latency_p95_ms: 52.8, latency_max_ms: 118.4,
    latency_note: "Demonstração", jitter_ms: 4.3, jitter_note: "Demonstração", full_drop_seconds: 487,
    by_hour: Array.from({ length: 24 }, (_, hour) => ({ hour, observed_seconds: 3400, loss_pct: +(0.2 + (hour >= 19 && hour <= 22 ? 1.8 : 0) * r() + r() * 0.5).toFixed(2), latency_avg_ms: +(27 + (hour >= 19 && hour <= 22 ? 9 : 0) + r() * 6).toFixed(1), full_drop_s: Math.round(r() * 40) })),
    gaps: [],
  };
}

function events(q: URLSearchParams): EventsResponse {
  const [s, e] = rangeOf(q, "7d");
  const mk = (id: number, kind: string, ago: number, dur: number, confidence: "confirmado" | "derivado" | "indeterminado", cause: string) => ({ id, terminal_id: 1, kind, cause, start_ts: e - ago, end_ts: e - ago + dur, duration_s: dur, confidence, evidence: { fonte: "demonstração" }, open: false });
  return {
    start: s, end: e, gaps: [],
    events: [
      mk(1, "ping_drop", 3 * 3600, 14, "derivado", "Perda total de ping ao PoP"),
      mk(2, "outage", 20 * 3600, 42, "confirmado", "OBSTRUCTED"),
      mk(3, "unreachable", 30 * 3600, 600, "indeterminado", "timeout"),
      mk(4, "boot", 50 * 3600, 95, "confirmado", "Reinício da antena detectado"),
      mk(5, "ping_drop", 70 * 3600, 6, "derivado", "Perda total de ping ao PoP"),
    ].filter((x) => x.start_ts >= s),
  };
}

function obstruction(): ObstructionResponse {
  const rows = 61, cols = 61;
  const r = rng(3);
  const snr: number[] = [];
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const dx = x - 30, dy = y - 30, d = Math.hypot(dx, dy);
      if (d > 29) snr.push(-1);
      else if (Math.atan2(dy, dx) > 2.2 && Math.atan2(dy, dx) < 2.7 && d > 18) snr.push(0);
      else snr.push(r() < 0.55 ? 1 : -1);
    }
  return { map: { ts: now() - 120, num_rows: rows, num_cols: cols, snr, min_elevation_deg: 25, max_theta_deg: 65, source: "demonstracao" }, map_capability: { status: "verificada", detail: null }, trend: [] };
}

const status = (): StatusResponse => ({
  available: true, dish_reachable: true, age_s: 3, stale: false,
  status: {
    observed_at: new Date().toISOString(), origin: "fixture", state: "conectada", state_reason: null,
    device: { terminal_key: "ut-demonstracao", hardware_version: "mini (demo)", software_version: "demo.0.0", board_rev: null, bootcount: 12 },
    metrics: {
      downlink_mbps: { value: +(20 + Math.random() * 30).toFixed(2), unit: "Mbps", source: "demonstracao", note: "tráfego corrente, não capacidade" },
      uplink_mbps: { value: +(1 + Math.random() * 4).toFixed(2), unit: "Mbps", source: "demonstracao", note: "tráfego corrente, não capacidade" },
      pop_latency_ms: { value: +(26 + Math.random() * 10).toFixed(1), unit: "ms", source: "demonstracao" },
      pop_drop_pct: { value: 0, unit: "%", source: "demonstracao" },
      uptime_s: { value: 3 * 86400 + 4000, unit: "s", source: "demonstracao" },
      obstruction_pct: { value: 1.8, unit: "%", source: "demonstracao" },
      currently_obstructed: { value: false, source: "demonstracao" },
    },
    alerts: [], outage: null, fields_present: [], fields_missing: ["gps_stats"],
  },
});

const agent = (): AgentInfo => ({
  version: "demo", mode: "fixture", started_at: now() - 7200, now: now(), dish_target: "demonstração", dish_reachable: true,
  terminal_id: 1, boot_id: "demo", last_status_ts: now() - 3, status_age_s: 3, status_stale: false, firmware: "demo.0.0",
  hardware: "mini (demo)", capabilities_checked: now() - 600, history_inserted_total: 7200, history_lost_total: 0, loops: {},
  sse_subscribers: 1, db_bytes: 12_000_000, sync_pending: 0, supabase_configured: false, ai_configured: false,
  timezone: "America/Fortaleza", terminal_name: "Starlink Mini (demonstração)", router_target: "—", intervals: { status_s: 10, history_s: 30, obstruction_s: 300 },
});

const capabilities = (): { checked_at: number; capabilities: Capability[] } => {
  const c = (key: string, label: string, status: Capability["status"], kind: Capability["kind"] = "leitura"): Capability => ({ target: "demo", key, device: "dish", label, origin: "grpc_request", kind, status, available: status === "verificada" || status === "schema_presente", offered: true, detail: "Demonstração", checked_at: now() - 600 });
  return { checked_at: now() - 600, capabilities: [c("dish.status", "Status da antena", "verificada"), c("dish.history", "Histórico", "verificada"), c("dish.obstruction_map", "Mapa de obstrução", "verificada"), c("dish.diagnostics", "Diagnóstico oficial", "nao_implementada"), c("dish.reboot", "Reiniciar antena", "schema_presente", "controle"), c("history.power", "Potência (W)", "verificada")] };
};

/* Clima fictício: pancadas de chuva no fim da tarde em alguns dias, coerentes com as perdas das 19h–22h. */
function demoWeatherHour(t: number): WeatherHour {
  const day = Math.floor((t - 3 * 3600) / 86400);
  const h = ((t / 3600 - 3) % 24 + 24) % 24;
  const r = rng(day * 7919)();
  const rainy = r < 0.55 && h >= 18 && h <= 21;
  const mm = rainy ? Math.round((h === 19 || h === 20 ? 6 + r * 18 : 1 + r * 3) * 10) / 10 : 0;
  const level: WeatherHour["rain_level"] = mm < 0.1 ? "sem_chuva" : mm < 2.5 ? "fraca" : mm < 7.6 ? "moderada" : mm < 50 ? "forte" : "muito_forte";
  return {
    hour_ts: t,
    temperature_c: Math.round((24 + 6 * Math.sin(((h - 9) / 24) * 2 * Math.PI)) * 10) / 10,
    precipitation_mm: mm,
    rain_mm: mm,
    cloud_cover_pct: rainy ? 95 : h >= 15 ? 60 : 30,
    wind_kmh: rainy ? 28 : 12,
    gust_kmh: rainy ? 55 : 22,
    weather_code: mm >= 7.6 ? 95 : mm > 0 ? 61 : h >= 15 ? 2 : 1,
    rain_level: level,
    is_forecast: t > now(),
  };
}

function demoWeatherHourly(q: URLSearchParams): WeatherHourly {
  const [s, e] = rangeOf(q, "24h");
  const hours: WeatherHour[] = [];
  for (let t = Math.floor(s / 3600) * 3600; t < Math.max(e, now() + 7 * 3600); t += 3600) hours.push(demoWeatherHour(t));
  return { start: s, end: e, source: "demonstracao", provider: "Open-Meteo", hours };
}

function demoWeather(): WeatherStatus {
  const h = demoWeatherHour(Math.floor(now() / 3600) * 3600);
  return {
    enabled: true,
    configured: true,
    location: { name: "Cidade de demonstração", latitude: 0, longitude: 0 },
    current: { ...h, ts: now() - 300, fetched_at: now() - 300, is_day: ((now() / 3600 - 3) % 24 + 24) % 24 < 18, stale: false },
    last_ok_at: now() - 300,
    last_error: null,
    provider: "Open-Meteo",
    source: "demonstracao",
    note: "Demonstração: clima fictício.",
  };
}

export async function demoFetch(path: string): Promise<unknown> {
  const [base, qs] = path.split("?");
  const q = new URLSearchParams(qs ?? "");
  await new Promise((r) => setTimeout(r, 120));
  switch (base) {
    case "status": return status();
    case "agent": return agent();
    case "capabilities": return capabilities();
    case "telemetry": return telemetry(q);
    case "usage/summary": return usageSummary();
    case "usage/plan": return usagePlan();
    case "usage/series": return usageSeries(q);
    case "usage/hourly-profile": return Array.from({ length: 24 }, (_, hour) => ({ hour, bytes_total: Math.round(diurnal(hour * 3600 + 3 * 3600) * 4e9), observed_seconds: 3500 * 30 }));
    case "quality": return quality(q);
    case "events": return events(q);
    case "obstruction": return obstruction();
    case "alerts/events": return { events: [] };
    case "alerts/rules": return { rules: [] };
    case "alerts/kinds": return { kinds: {} };
    case "alerts/digest": return { enabled: true, telegram: false, weekday: 0, hour: 8, next_at: null, last_period_end: null };
    case "alerts/notifications": return { channels: { webhook: false, telegram: false }, pending: 0, failed_24h: 0, last_sent_at: null, last_error: null };
    case "diagnostics/summary":
      return {
        generated_at: now(), engine: "regras", source: "demonstracao",
        headline: "DEMONSTRAÇÃO — disponibilidade observada de 99,42%, com perdas concentradas entre 19h e 22h.",
        findings: [
          { severity: "warn", kind: "evento_observado", text: "Perda média acima do padrão entre 19h e 22h (fictício).", evidence: "Dados de demonstração" },
          { severity: "warn", kind: "causa_confirmada", text: "A antena reportou 1 interrupção com causa OBSTRUCTED (fictício).", evidence: "Dados de demonstração" },
          { severity: "info", kind: "hipotese", text: "Obstrução pode contribuir para as perdas noturnas (fictício).", evidence: "Correlação não comprova causa" },
        ],
      };
    case "ai/status":
      return { configured: false, model: "—", daily_limit: 0, usage: [],
               audio: { enabled: false, model: "—", daily_limit: 0, usage: [], pricing_usd_per_hour: null, telegram: false } };
    case "control/actions":
      return { policy: "Demonstração.", actions: [{ action: "reboot", label: "Reiniciar a antena", consequences: [], capability: capabilities().capabilities.find((c) => c.key === "dish.reboot"), enabled: true, reason: null }] };
    case "control/requests": return { requests: [], audit: [] };
    case "settings":
      // Valores padrão do agente (config.py), só para a tela de Configurações ter o que mostrar na demonstração.
      return {
        terminal_name: "Starlink Mini (demonstração)", show_mac_addresses: false, runtime_overrides: {}, version: "demo",
        secrets_configured: { api_token: true, groq_api_key: false, setup_code: false, supabase_agent_token: false, supabase_anon_key: false, telegram_bot_token: false, telegram_chat_id: false },
        usage_monthly_limit_gb: 100, usage_cycle_start_day: 3, timezone: "America/Fortaleza",
        dish_target: "demonstração", router_target: "192.168.1.1:9000", router_enabled: true, host: "127.0.0.1", port: 8787, allow_lan: false,
        esp32_enabled: false, supabase_url: null, sync_interval_s: 60,
        status_interval_s: 10, history_interval_s: 30, obstruction_interval_s: 300, capability_refresh_s: 3600, grpc_timeout_s: 5, degraded_drop_rate: 0.05,
        retention_raw_days: 7, retention_minute_days: 400,
        ai_model: "openai/gpt-oss-120b", ai_conversation_retention_days: 30,
      };
    case "insights/compare": {
      const [s, e] = rangeOf(q, "7d");
      const stats = (k: number) => ({ start: s, end: e, availability_pct: 99.4 - k * 0.5, loss_pct: 0.7 + k * 0.4, latency_p50_ms: 31 + k * 3, latency_p95_ms: 52 + k * 6, jitter_ms: 4.3, bytes_total: 18e9 - k * 2e9, drops: 3 + k * 2, coverage: 0.96, source: "demonstracao" });
      return { current: stats(0), previous: stats(1), rain: { chuva: { loss_pct: 2.1, observed_seconds: 30_000 }, sem_chuva: { loss_pct: 0.5, observed_seconds: 500_000 } }, weather_configured: true, note: "Demonstração: números fictícios." };
    }
    case "insights/best-hours": {
      const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, loss_pct: hour >= 19 && hour <= 21 ? 2.4 : hour >= 2 && hour <= 6 ? 0.1 : 0.6, latency_ms: 30 + (hour >= 19 && hour <= 21 ? 12 : 0), observed_seconds: 40_000 }));
      const ranked = [...hours].sort((a, b) => a.loss_pct - b.loss_pct || (a.latency_ms ?? 0) - (b.latency_ms ?? 0));
      const base = Math.floor(now() / 3600) * 3600;
      return { days: 14, hours, best: ranked.slice(0, 3), worst: ranked.slice(-3).reverse(), next_good: [1, 2, 3].map((i) => ({ ts: base + i * 3600 * 4, hour: 0 })), enough_data: true, note: "Demonstração: horários fictícios." };
    }
    case "integrations/mqtt": return { configured: false, host: null, port: 1883, connected: false, last_publish: null, last_error: null };
    case "ops/health":
      return { disk: { free_bytes: 92e9, total_bytes: 120e9, free_pct: 76.7 }, db_size_bytes: 48e6, cpu_temp_c: 52, mem_available_pct: 61, load_1m: 0.4, cpus: 2, last_backup_at: now() - 5 * 3600, healthcheck_configured: false, checked_at: now() };
    case "weather": return demoWeather();
    case "weather/hourly": return demoWeatherHourly(q);
    case "esp32/nodes": return { nodes: [] };
    case "devices": return { source: "indisponivel", reason: "Demonstração: nenhuma fonte de dispositivos.", devices: [] };
    default: return {};
  }
}
