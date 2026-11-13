/** Formatação pt-BR com fuso America/Fortaleza (UTC-3, sem horário de verão). */
export const TZ = "America/Fortaleza";
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

const dtf = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TZ,
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const tf = new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit" });
const hm = new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const df = new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, day: "2-digit", month: "short" });
const full = new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, dateStyle: "medium", timeStyle: "medium" });

export const fmtDateTime = (epoch: number) => dtf.format(epoch * 1000);
export const fmtTime = (epoch: number) => tf.format(epoch * 1000);
export const fmtHM = (epoch: number) => hm.format(epoch * 1000);
export const fmtDay = (epoch: number) => df.format(epoch * 1000);
export const fmtFull = (epoch: number) => full.format(epoch * 1000);

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
