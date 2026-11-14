"use client";

import { type QueryClient, useQuery, type UseQueryOptions, useQueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import { useDemo } from "./demo-context";
import { demoFetch } from "./demo-data";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/agent/${path.replace(/^\//, "")}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (res.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { detail?: unknown; code?: string };
    const msg = typeof body.detail === "string" ? body.detail : `Erro ${res.status}`;
    throw new ApiError(res.status, msg, body.code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Hook de leitura: em /demo responde com fixtures identificadas; caso contrário consulta o agente. */
export function useAgent<T>(
  path: string | null,
  opts: Omit<UseQueryOptions<T, ApiError>, "queryKey" | "queryFn"> = {},
) {
  const demo = useDemo();
  return useQuery<T, ApiError>({
    queryKey: [demo ? "demo" : "agent", path],
    queryFn: () => (demo ? (demoFetch(path!) as Promise<T>) : api<T>(path!)),
    enabled: path !== null && (opts.enabled ?? true),
    retry: (count, err) => err.status >= 500 && count < 2,
    ...opts,
  });
}

export type StreamState = "connecting" | "open" | "reconnecting" | "closed" | "demo";

/*
 * Uma ÚNICA conexão SSE por aba, compartilhada por todos os componentes (contagem de referências).
 * Navegadores limitam ~6 conexões HTTP/1.1 por servidor (somando todas as abas): conexões SSE
 * duplicadas ou de abas em segundo plano deixavam as demais requisições do painel na fila.
 * Por isso a conexão também é fechada enquanto a aba está oculta e reaberta ao voltar.
 */
let es: EventSource | null = null;
let streamQc: QueryClient | null = null;
let subscribers = 0;
let streamState: Exclude<StreamState, "demo"> = "connecting";
const stateListeners = new Set<() => void>();

function setStreamState(s: Exclude<StreamState, "demo">) {
  if (s === streamState) return;
  streamState = s;
  stateListeners.forEach((l) => l());
}

function subscribeStreamState(l: () => void) {
  stateListeners.add(l);
  return () => {
    stateListeners.delete(l);
  };
}

const isHistoryKey = (k: unknown) => typeof k === "string" && /^(telemetry|usage|quality|events)/.test(k);
const isAlertKey = (k: unknown) => typeof k === "string" && k.startsWith("alerts");

function openStream() {
  const qc = streamQc;
  if (es || !qc || subscribers === 0 || document.visibilityState === "hidden") return;
  const src = new EventSource("/api/agent/stream");
  es = src;
  setStreamState("connecting");
  src.onopen = () => setStreamState("open");
  src.onerror = () => setStreamState(src.readyState === EventSource.CLOSED ? "closed" : "reconnecting");
  src.addEventListener("status", (e: MessageEvent) => {
    try {
      const st = JSON.parse(e.data);
      qc.setQueryData(["agent", "status"], { available: true, dish_reachable: true, age_s: 0, stale: false, status: st });
      window.dispatchEvent(new CustomEvent("orbitlink:status", { detail: st }));
    } catch {
      /* payload inválido é ignorado */
    }
  });
  src.addEventListener("agent", (e: MessageEvent) => {
    try {
      const a = JSON.parse(e.data);
      qc.setQueryData(["agent", "agent"], (old: Record<string, unknown> | undefined) => ({ ...(old ?? {}), ...a }));
      if (a.dish_reachable === false) qc.invalidateQueries({ queryKey: ["agent", "status"] });
    } catch {
      /* ignore */
    }
  });
  src.addEventListener("history", () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "agent" && isHistoryKey(q.queryKey[1]) }));
  src.addEventListener("alert", () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "agent" && isAlertKey(q.queryKey[1]) }));
}

function closeStream() {
  es?.close();
  es = null;
  setStreamState("connecting");
}

function onVisibilityChange() {
  if (document.visibilityState === "hidden") closeStream();
  else openStream();
}

function acquireStream(qc: QueryClient): () => void {
  streamQc = qc;
  subscribers += 1;
  if (subscribers === 1) document.addEventListener("visibilitychange", onVisibilityChange);
  openStream();
  return () => {
    subscribers -= 1;
    if (subscribers > 0) return;
    document.removeEventListener("visibilitychange", onVisibilityChange);
    closeStream();
  };
}

const getStreamState = () => streamState;
const getServerStreamState = () => "connecting" as const;

/** Assina o SSE do agente (via proxy, conexão compartilhada) e atualiza o cache do React Query. */
export function useAgentStream(enabled = true): StreamState {
  const demo = useDemo();
  const qc = useQueryClient();
  const state = useSyncExternalStore(subscribeStreamState, getStreamState, getServerStreamState);

  useEffect(() => {
    if (demo || !enabled) return;
    return acquireStream(qc);
  }, [demo, enabled, qc]);

  return demo ? "demo" : state;
}

/**
 * Intervalo de polling do /status: com o SSE aberto o status já chega por push (~10 s), então o
 * polling vira só uma rede de segurança lenta; sem SSE (ou na demo) usa o intervalo informado.
 */
export function useStatusInterval(fallbackMs: number): number {
  const state = useSyncExternalStore(subscribeStreamState, getStreamState, getServerStreamState);
  const demo = useDemo();
  return !demo && state === "open" ? Math.max(fallbackMs, 60_000) : fallbackMs;
}
