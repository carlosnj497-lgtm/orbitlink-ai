import "server-only";
import { CloudError, rest, rpc } from "./cloud";

/**
 * Adaptador do modo nuvem: responde às mesmas rotas que as telas usam com o agente local, a partir dos dados
 * que os agentes sincronizam (agregados por minuto). O que só existe no agente local (IA, controle da antena,
 * ESP32, alertas, clima) devolve 404 com uma explicação, e essas telas ficam escondidas no menu da nuvem.
 */
export const TZ = process.env.ASTRYON_CLOUD_TIMEZONE || "America/Sao_Paulo";
const RANGES: Record<string, number> = { "15m": 900, "1h": 3600, "6h": 21600, "24h": 86400, "7d": 604800, "30d": 2592000, "90d": 7776000 };
const LOCAL_ONLY = "Disponível só no painel local do ASTRYON (no computador ligado à antena).";

type Json = Record<string, unknown>;
const now = () => Math.floor(Date.now() / 1000);
const num = (v: unknown): number | null => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));

/** Maior janela aceita numa consulta (protege o Supabase de RPCs sobre anos de dados). */
export const MAX_SPAN_S = 400 * 86400;

/**
 * Período pedido (`start`/`end` em epoch s, ou `range`). Valores inválidos viram 422; janelas maiores que
 * MAX_SPAN_S são recusadas para não disparar consultas caras.
 */
export function range(q: URLSearchParams, def: string): [number, number] {
  const int = (k: string) => {
    const raw = q.get(k);
    if (raw === null || raw === "") return null;
    const v = Number(raw);
    if (!Number.isInteger(v) || v <= 0) throw new CloudError(422, `Parâmetro "${k}" inválido.`);
    return v;
  };
  const e = Math.min(int("end") ?? now(), now() + 86400);
  const r = q.get("range");
  if (r !== null && !(r in RANGES)) throw new CloudError(422, 'Parâmetro "range" inválido.');
  const s = int("start") ?? e - (RANGES[r ?? def] ?? RANGES[def]);
  if (s >= e) throw new CloudError(422, "O início do período precisa ser antes do fim.");
  if (e - s > MAX_SPAN_S) throw new CloudError(422, "Período longo demais (máximo de 400 dias).");
  return [s, e];
}

/** Limite de linhas entre 1 e `max` (padrão `def`). */
export function limitParam(q: URLSearchParams, def: number, max: number): number {
  const raw = q.get("limit");
  if (raw === null || raw === "") return def;
  const v = Number(raw);
  if (!Number.isInteger(v) || v < 1) throw new CloudError(422, 'Parâmetro "limit" inválido.');
  return Math.min(v, max);
}

function niceBucket(span: number, maxPoints = 720): number {
  const want = Math.max(60, Math.ceil(span / maxPoints));
  return [60, 120, 300, 600, 900, 1800, 3600, 7200, 21600, 86400].find((b) => b >= want) ?? 86400;
}

/** Epoch da 0h local (no fuso informado) do dia que contém `ts`, deslocado em `days`. */
export function localMidnight(ts: number, tz: string, days = 0): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(ts * 1000))
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) / 1000;
  const offset = asUtc - ts; // segundos que o fuso está à frente do UTC
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day + days) / 1000 - offset;
}

/** Epoch da 0h local do 1º dia do mês que contém `ts`, deslocado `monthsBack` meses para trás (negativo = à frente). */
export function localMonthStart(ts: number, tz: string, monthsBack = 0): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit" }).formatToParts(new Date(ts * 1000)).map((x) => [x.type, x.value]));
  const guess = Date.UTC(+p.year, +p.month - 1 - monthsBack, 1, 12) / 1000; // meio-dia evita ambiguidade de fuso
  return localMidnight(guess, tz);
}

/**
 * Limites do resumo de consumo, iguais aos do agente local: semana a partir de segunda-feira (0h local) e
 * "mês anterior até agora" com o mesmo tempo decorrido do mês atual (limitado ao fim do mês anterior).
 */
export function summaryBounds(t: number, tz: string) {
  const today = localMidnight(t, tz);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(new Date(t * 1000));
  const weekdayMon0 = Math.max(0, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekday));
  const month = localMonthStart(t, tz);
  const previousMonth = localMonthStart(t, tz, 1);
  return {
    today,
    yesterday: localMidnight(t, tz, -1),
    week: localMidnight(t, tz, -weekdayMon0),
    month,
    previousMonth,
    previousMonthToDate: Math.min(month, previousMonth + (t - month)),
  };
}

async function window(token: string, start: number, end: number) {
  return rpc<Json>(token, "cloud_usage_window", { p_start: start, p_end: end });
}

async function status(token: string) {
  return rpc<{
    workspace_id: string | null;
    workspace_name: string | null;
    agents: number;
    agent_last_seen: number | null;
    terminal: { name: string | null; hardware_version: string | null; software_version: string | null } | null;
    heartbeat: { ts: number; dish_reachable: boolean; version: string | null; sync_pending: number | null } | null;
    last_minute: { ts: number; latency_ms: number | null; drop_pct: number | null; power_w: number | null; down_mbps: number | null; up_mbps: number | null } | null;
  }>(token, "cloud_status");
}

const metric = (value: number | null, unit: string, note?: string) => ({ value, unit, source: value === null ? "indisponivel" : "calculada", note: note ?? null });

export async function cloudGet(token: string, path: string, q: URLSearchParams): Promise<unknown> {
  switch (path) {
    case "status": {
      const st = await status(token);
      const m = st.last_minute;
      if (!m) {
        return { available: false, dish_reachable: st.heartbeat?.dish_reachable ?? null, reason: st.agents ? "O agente ainda não enviou medições." : "Nenhum agente conectado. Conecte o computador ligado à antena em Conta.", error_kind: null };
      }
      const age = now() - m.ts;
      const reach = st.heartbeat?.dish_reachable ?? null;
      const drop = num(m.drop_pct);
      return {
        available: true,
        dish_reachable: reach,
        age_s: age,
        stale: age > 600,
        status: {
          observed_at: new Date(m.ts * 1000).toISOString(),
          origin: "grpc",
          state: reach === false ? "offline" : drop !== null && drop >= 5 ? "degradada" : "conectada",
          state_reason: null,
          device: { terminal_key: null, hardware_version: st.terminal?.hardware_version ?? null, software_version: st.terminal?.software_version ?? null, board_rev: null, bootcount: null },
          metrics: {
            downlink_mbps: metric(num(m.down_mbps), "Mbps", "média do último minuto sincronizado"),
            uplink_mbps: metric(num(m.up_mbps), "Mbps", "média do último minuto sincronizado"),
            pop_latency_ms: metric(num(m.latency_ms), "ms", "média do último minuto sincronizado"),
            pop_drop_pct: metric(drop, "%", "média do último minuto sincronizado"),
          },
          alerts: [],
          outage: null,
          fields_present: [],
          fields_missing: [],
        },
      };
    }
    case "agent": {
      const st = await status(token);
      const last = st.last_minute?.ts ?? null;
      return {
        version: st.heartbeat?.version ?? "nuvem", mode: "real", started_at: st.agent_last_seen ?? 0, now: now(),
        dish_target: "nuvem", dish_reachable: st.heartbeat?.dish_reachable ?? null, terminal_id: null, boot_id: null,
        last_status_ts: last, status_age_s: last ? now() - last : null, status_stale: !last || now() - last > 600,
        firmware: st.terminal?.software_version ?? null, hardware: st.terminal?.hardware_version ?? null,
        capabilities_checked: null, history_inserted_total: 0, history_lost_total: 0, loops: {}, sse_subscribers: 0, db_bytes: 0,
        sync_pending: st.heartbeat?.sync_pending ?? 0, supabase_configured: true, ai_configured: false, timezone: TZ,
        terminal_name: st.terminal?.name ?? st.workspace_name ?? "Starlink", router_target: "", intervals: { status_s: 60, history_s: 60, obstruction_s: 0 },
      };
    }
    case "telemetry": {
      const [s, e] = range(q, "1h");
      const bucket = Math.max(niceBucket(e - s), Number(q.get("bucket_s")) || 0);
      const rows = await rpc<Json[]>(token, "cloud_telemetry", { p_start: s, p_end: e, p_bucket: bucket });
      const observed = rows.reduce((a, r) => a + (num(r.n) ?? 0), 0);
      return {
        start: s, end: e, bucket_s: bucket, series_source: "minute_aggregates", source: rows.length ? "calculada" : "indisponivel",
        coverage: Math.min(1, observed / Math.max(1, Math.min(e, now()) - s)),
        points: rows.map((r) => ({ t: num(r.t), n: num(r.n) ?? 0, down_mbps: num(r.down_mbps), up_mbps: num(r.up_mbps), down_max_mbps: num(r.down_max_mbps), up_max_mbps: num(r.up_max_mbps), latency_ms: num(r.latency_ms), drop_pct: num(r.drop_pct), power_w: num(r.power_w) })),
        gaps: [],
        note: "Na nuvem, a menor resolução é 1 minuto (o agente sincroniza agregados por minuto).",
      };
    }
    case "quality": {
      const [s, e] = range(q, "24h");
      return rpc(token, "cloud_quality", { p_start: s, p_end: e, p_tz: TZ });
    }
    case "usage/summary": {
      const t = now();
      const b = summaryBounds(t, TZ);
      const [d, y, w, m, pm, pmtd] = await Promise.all([
        window(token, b.today, t),
        window(token, b.yesterday, b.today),
        window(token, b.week, t),
        window(token, b.month, t),
        window(token, b.previousMonth, b.month),
        window(token, b.previousMonth, b.previousMonthToDate),
      ]);
      return { timezone: TZ, today: d, yesterday: y, week: w, month: m, previous_month: pm, previous_month_to_date: pmtd, projection_month: { available: false, reason: "A projeção do mês fica no painel local." }, method: "Soma do consumo estimado pelos agentes (tráfego reportado pela antena a cada segundo, agregado por minuto). Não é o valor oficial da fatura." };
    }
    case "usage/plan": {
      const t = now();
      const cs = localMonthStart(t, TZ);
      const ce = localMonthStart(t, TZ, -1);
      return { configured: false, cap_bytes: null, cycle_start_day: 1, cycle_start: cs, cycle_end: ce, days_remaining: Math.max(0, Math.ceil((ce - t) / 86400)), used: await window(token, cs, t), pct_used: null, remaining_bytes: null, lower_bound: true, projection: null, projected_pct: null, source: "calculada", method: "A franquia é configurada no painel local do ASTRYON." };
    }
    case "usage/series": {
      const [s, e] = range(q, "30d");
      const want = q.get("bucket");
      const bucket = want === "hour" || want === "month" ? want : "day";
      // Mesma granularidade do agente local: "month" agrupa por mês do calendário no fuso (date_trunc no banco).
      const size = (t: number) => (bucket === "hour" ? 3600 : bucket === "day" ? 86400 : localMonthStart(t + 43200, TZ, -1) - t);
      const rows = await rpc<Json[]>(token, "cloud_usage_series", { p_start: s, p_end: e, p_tz: TZ, p_bucket: bucket });
      const fmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, ...(bucket === "hour" ? { hour: "2-digit" } : bucket === "day" ? { day: "2-digit", month: "2-digit" } : { month: "short", year: "2-digit" }) });
      return {
        bucket, timezone: TZ, imported: [], peak_hour: null, gaps: [], method: "Consumo estimado pelos agentes, agregado no fuso " + TZ + ".",
        points: rows.map((r) => {
          const d = num(r.bytes_download) ?? 0;
          const u = num(r.bytes_upload) ?? 0;
          const t = num(r.t) ?? 0;
          return { t, label: fmt.format(new Date(t * 1000)), bytes_download: d, bytes_upload: u, bytes_total: d + u, coverage: Math.min(1, (num(r.observed) ?? 0) / size(t)), source: "calculada" };
        }),
      };
    }
    case "usage/hourly-profile": {
      const t = now();
      const rows = await rpc<Json[]>(token, "cloud_usage_series", { p_start: t - 30 * 86400, p_end: t, p_tz: TZ, p_bucket: "hour" });
      const hourOf = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" });
      const acc = Array.from({ length: 24 }, (_, hour) => ({ hour, bytes_total: 0, observed_seconds: 0 }));
      for (const r of rows) {
        const h = Number(hourOf.format(new Date((num(r.t) ?? 0) * 1000)));
        acc[h].bytes_total += (num(r.bytes_download) ?? 0) + (num(r.bytes_upload) ?? 0);
        acc[h].observed_seconds += num(r.observed) ?? 0;
      }
      return acc;
    }
    case "events": {
      const [s, e] = range(q, "7d");
      const limit = limitParam(q, 200, 1000);
      const kind = q.get("kind");
      if (kind !== null && !/^[a-z_]{1,40}$/.test(kind)) throw new CloudError(422, 'Parâmetro "kind" inválido.');
      // Eventos que se sobrepõem à janela: começaram antes do fim e não tinham terminado antes do início
      // (uma queda longa ainda em andamento também conta).
      const iso = (v: number) => new Date(v * 1000).toISOString();
      const filter = `start_ts=lt.${iso(e)}&or=(end_ts.is.null,end_ts.gt.${iso(s)})${kind ? `&kind=eq.${kind}` : ""}`;
      const rows = await rest<Json[]>(token, `connection_events?select=id,kind,cause,start_ts,end_ts,duration_s,confidence,evidence&${filter}&order=start_ts.desc&limit=${limit}`);
      const ts = (v: unknown) => (v ? Math.floor(new Date(String(v)).getTime() / 1000) : null);
      return {
        start: s, end: e, gaps: [],
        events: rows.map((r, i) => ({ id: i + 1, terminal_id: null, kind: r.kind, cause: r.cause, start_ts: ts(r.start_ts), end_ts: ts(r.end_ts), duration_s: num(r.duration_s), confidence: r.confidence, evidence: r.evidence ?? {}, open: !r.end_ts })),
      };
    }
    case "capabilities": {
      const rows = await rest<Json[]>(token, "terminal_capabilities?select=key,label,status,detail,checked_at&order=key");
      return {
        checked_at: null,
        capabilities: rows.map((r) => ({ target: "nuvem", key: r.key, device: "dish", label: r.label ?? r.key, origin: "agente", kind: String(r.key).includes("reboot") ? "controle" : "leitura", status: r.status, available: r.status === "verificada" || r.status === "schema_presente", offered: true, detail: r.detail, checked_at: Math.floor(new Date(String(r.checked_at)).getTime() / 1000) })),
      };
    }
    case "alerts/events":
      return { events: [] }; // alertas são avaliados no agente local; na nuvem ainda não há regras
    case "obstruction":
      return { map: null, map_capability: null, trend: [] };
    case "weather":
      return { enabled: false, configured: false, location: null, current: null, last_ok_at: null, last_error: null, provider: "Open-Meteo", source: "indisponivel", note: LOCAL_ONLY };
    case "weather/hourly":
      return { start: 0, end: 0, source: "indisponivel", provider: "Open-Meteo", hours: [] };
    case "cloud/account": {
      const [st, agents] = await Promise.all([status(token), rest<Json[]>(token, "agents?select=id,name,created_at,last_seen,revoked_at&order=created_at.desc")]);
      return {
        workspace_id: st.workspace_id, workspace_name: st.workspace_name,
        agents: agents.map((a) => ({ id: a.id, name: a.name, created_at: a.created_at, last_seen: a.last_seen, revoked: Boolean(a.revoked_at) })),
      };
    }
    case "cloud/export":
      return rpc(token, "export_my_data");
    default:
      throw new CloudError(404, LOCAL_ONLY);
  }
}

export async function cloudMutate(token: string, method: string, path: string, body: Json): Promise<unknown> {
  if (method === "POST" && path === "cloud/pairing-code") {
    const st = await status(token);
    if (!st.workspace_id) throw new CloudError(409, "Sua conta ainda não tem um espaço de trabalho.");
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 60) : "Minha Starlink";
    return rpc(token, "create_pairing_code", { p_workspace: st.workspace_id, p_name: name });
  }
  const revoke = /^cloud\/agents\/([0-9a-f-]{36})$/.exec(path);
  if (method === "DELETE" && revoke) {
    await rpc(token, "revoke_agent", { p_agent: revoke[1] });
    return { ok: true };
  }
  if (method === "POST" && path === "cloud/delete-account") {
    if (body.confirm !== "EXCLUIR") throw new CloudError(422, 'Digite EXCLUIR para confirmar.');
    await rpc(token, "delete_my_account");
    return { ok: true };
  }
  throw new CloudError(404, LOCAL_ONLY);
}
