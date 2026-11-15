/**
 * Formatação pt-BR no fuso do agente (ASTRYON_TIMEZONE, informado em /agent). Até a primeira resposta do agente
 * vale o último fuso visto neste navegador, ou America/Fortaleza. Os buckets de hora/dia são calculados no fuso do
 * servidor; formatar em outro fuso deslocava os rótulos.
 */
export const DEFAULT_TZ = "America/Fortaleza";
const LOCALE = "pt-BR";

const nf = (min: number, max: number) =>
  new Intl.NumberFormat(LOCALE, { minimumFractionDigits: min, maximumFractionDigits: max });

export function fmtNumber(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return nf(0, digits).format(v);
}

export function fmtMbps(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  if (v === 0) return "0";
  if (v < 0.1) return nf(0, 3).format(v);
  if (v < 10) return nf(1, 2).format(v);
  return nf(0, 1).format(v);
}

export function fmtBytes(v: number | null | undefined): { value: string; unit: string } {
  if (v === null || v === undefined || Number.isNaN(v)) return { value: "—", unit: "" };
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let n = Math.abs(v);
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000;
    i++;
  }
  return { value: nf(0, n < 10 ? 2 : n < 100 ? 1 : 0).format(Math.sign(v) * n), unit: units[i] };
}

export function fmtBytesStr(v: number | null | undefined): string {
  const b = fmtBytes(v);
  return b.unit ? `${b.value} ${b.unit}` : b.value;
}

export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${nf(0, digits).format(v)}%`;
}

export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const s = Math.max(0, Math.round(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}min`;
  if (m) return `${m}min ${sec}s`;
  return `${sec}s`;
}

function buildFormatters(tz: string) {
  return {
    dtf: new Intl.DateTimeFormat(LOCALE, { timeZone: tz, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }),
    tf: new Intl.DateTimeFormat(LOCALE, { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    hm: new Intl.DateTimeFormat(LOCALE, { timeZone: tz, hour: "2-digit", minute: "2-digit" }),
    df: new Intl.DateTimeFormat(LOCALE, { timeZone: tz, day: "2-digit", month: "short" }),
    full: new Intl.DateTimeFormat(LOCALE, { timeZone: tz, dateStyle: "medium", timeStyle: "medium" }),
    day: new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }),
    month: new Intl.DateTimeFormat(LOCALE, { timeZone: tz, month: "short", year: "2-digit" }),
  };
}

const TZ_KEY = "astryon:timezone";
let tz = DEFAULT_TZ;
let f = buildFormatters(tz);
const tzListeners = new Set<() => void>();

function isValidTz(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Fuso usado na formatação (o do agente, quando já conhecido). */
export function displayTimezone(): string {
  return tz;
}

/** Troca o fuso de exibição (fuso inválido é ignorado). Devolve true se mudou. */
export function setDisplayTimezone(value: string | null | undefined, persist = true): boolean {
  if (!value || value === tz || !isValidTz(value)) return false;
  tz = value;
  f = buildFormatters(tz);
  if (persist) {
    try {
      localStorage.setItem(TZ_KEY, tz);
    } catch {
      /* armazenamento indisponível: só vale nesta aba */
    }
  }
  tzListeners.forEach((l) => l());
  return true;
}

/** Recupera o último fuso visto neste navegador (chamar só no cliente). */
export function restoreDisplayTimezone(): void {
  try {
    setDisplayTimezone(localStorage.getItem(TZ_KEY), false);
  } catch {
    /* sem armazenamento */
  }
}

export function subscribeDisplayTimezone(l: () => void): () => void {
  tzListeners.add(l);
  return () => {
    tzListeners.delete(l);
  };
}

export const fmtDateTime = (epoch: number) => f.dtf.format(epoch * 1000);
export const fmtTime = (epoch: number) => f.tf.format(epoch * 1000);
export const fmtHM = (epoch: number) => f.hm.format(epoch * 1000);
export const fmtDay = (epoch: number) => f.df.format(epoch * 1000);
export const fmtFull = (epoch: number) => f.full.format(epoch * 1000);
export const fmtMonth = (epoch: number) => f.month.format(epoch * 1000);
/** Data local "AAAA-MM-DD" no fuso de exibição (a mesma chave de dia que o agente grava). */
export const localDayKey = (epoch: number) => f.day.format(epoch * 1000);

/**
 * Linha de uso diário (IA, áudio) de HOJE no fuso do agente. A lista vem ordenada por dia decrescente e só tem dias
 * com uso: o primeiro item pode ser de ontem. `now` = epoch s (ex.: de `useNow`); null enquanto não há relógio.
 */
export function usageForToday<T extends { day: string }>(rows: T[] | null | undefined, now: number | null): T | undefined {
  if (!rows || now === null) return undefined;
  const key = localDayKey(now);
  return rows.find((r) => r.day === key);
}

/** Tempo relativo. Só é chamado com dados já carregados no cliente (nunca durante o prerender). */
export function fmtAgo(epoch: number | null | undefined, now?: number): string {
  if (!epoch) return "nunca";
  const d = Math.max(0, (now ?? Date.now() / 1000) - epoch);
  if (d < 5) return "agora";
  if (d < 60) return `há ${Math.round(d)}s`;
  if (d < 3600) return `há ${Math.round(d / 60)} min`;
  if (d < 86400) return `há ${Math.round(d / 3600)} h`;
  return `há ${Math.round(d / 86400)} d`;
}

export function chartTick(epoch: number, spanS: number): string {
  if (spanS <= 2 * 3600) return fmtHM(epoch);
  if (spanS <= 2 * 86400) return fmtHM(epoch);
  return fmtDay(epoch);
}
