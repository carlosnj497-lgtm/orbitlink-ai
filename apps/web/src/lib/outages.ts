import type { ConnectionEvent } from "@astryon/shared";

export const DAY = 86400;

/** Fim efetivo de um evento: o registrado, ou "agora" (`end`) se ainda estiver em andamento. */
function eventEnd(e: ConnectionEvent, end: number): number {
  if (e.end_ts !== null && e.end_ts !== undefined) return e.end_ts;
  if (e.open) return end;
  return e.start_ts + (e.duration_s ?? 0);
}

export interface ClippedOutage {
  event: ConnectionEvent;
  /** Início dentro da janela (o início real pode ser anterior). */
  start: number;
  /** Duração contada só dentro da janela. */
  duration: number;
}

/**
 * Interrupções que tocam a janela `[end - span, end)`: inclui quedas que começaram antes e continuaram dentro dela
 * (inclusive as ainda abertas), com a duração cortada nos limites. Eventos de boot não contam.
 */
export function outagesInWindow(events: ConnectionEvent[], end: number, span = DAY): ClippedOutage[] {
  const from = end - span;
  return events
    .filter((e) => e.kind !== "boot")
    .flatMap((e) => {
      const stop = eventEnd(e, end);
      const touches = e.start_ts < end && (stop > from || (e.start_ts >= from && stop === e.start_ts));
      if (!touches) return [];
      const start = Math.max(e.start_ts, from);
      return [{ event: e, start, duration: Math.max(0, Math.min(stop, end) - start) }];
    });
}

export interface OutageSummary {
  from: number;
  last: ClippedOutage[];
  previousCount: number;
  total: number;
  longest: number;
  latest: number;
}

/** Resumo das últimas 24 h (e contagem das 24 h anteriores, para comparar). */
export function summarizeOutages(events: ConnectionEvent[], end: number): OutageSummary {
  const last = outagesInWindow(events, end, DAY);
  const previousCount = outagesInWindow(events, end - DAY, DAY).length;
  return {
    from: end - DAY,
    last,
    previousCount,
    total: last.reduce((a, o) => a + o.duration, 0),
    longest: last.reduce((a, o) => Math.max(a, o.duration), 0),
    latest: last.reduce((a, o) => Math.max(a, o.event.start_ts), 0),
  };
}
