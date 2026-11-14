"use client";

import type { ConnState, StatusResponse } from "@orbitlink/shared";
import { useEffect, useSyncExternalStore } from "react";

/**
 * Leituras de status recebidas NESTA aba (≈ uma a cada 10 s, via SSE ou polling), guardadas só em memória para
 * desenhar a tendência imediata na tela Ao Vivo. Não substitui o histórico do agente: é perdido ao recarregar.
 * Cada leitura é registrada uma única vez (pelo horário de observação da antena) e só leituras reais entram.
 */
export interface LiveReading {
  t: number;
  state: ConnState;
  down: number | null;
  up: number | null;
  lat: number | null;
  loss: number | null;
  obstructed: boolean | null;
}

export const LIVE_MAX = 90; // 15 min a 10 s por leitura

const buffers = new Map<string, LiveReading[]>();
const listeners = new Set<() => void>();
const EMPTY: LiveReading[] = [];

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function toReading(s: StatusResponse | undefined): LiveReading | null {
  if (!s?.available || s.stale) return null;
  const t = Date.parse(s.status.observed_at) / 1000;
  if (!Number.isFinite(t)) return null;
  const m = s.status.metrics;
  const ob = m.currently_obstructed?.value;
  return {
    t,
    state: s.status.state,
    down: n(m.downlink_mbps?.value),
    up: n(m.uplink_mbps?.value),
    lat: n(m.pop_latency_ms?.value),
    loss: n(m.pop_drop_pct?.value),
    obstructed: typeof ob === "boolean" ? ob : null,
  };
}

export function pushReading(key: string, s: StatusResponse | undefined): void {
  const r = toReading(s);
  if (!r) return;
  const buf = buffers.get(key) ?? EMPTY;
  if (buf.length && buf[buf.length - 1].t >= r.t) return; // repetida ou fora de ordem
  buffers.set(key, [...buf, r].slice(-LIVE_MAX));
  listeners.forEach((l) => l());
}

export function resetReadings(): void {
  buffers.clear();
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Registra cada novo status recebido (enquanto `record` for true) e devolve as leituras da sessão. */
export function useLiveReadings(key: string, status: StatusResponse | undefined, record: boolean): LiveReading[] {
  useEffect(() => {
    if (record) pushReading(key, status);
  }, [key, status, record]);
  return useSyncExternalStore(
    subscribe,
    () => buffers.get(key) ?? EMPTY,
    () => EMPTY,
  );
}
