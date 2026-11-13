"use client";

import { useQuery, type UseQueryOptions, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
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

/** Assina o SSE do agente (via proxy) e atualiza o cache do React Query. */
export function useAgentStream(enabled = true): StreamState {
  const demo = useDemo();
  const qc = useQueryClient();
  const [state, setState] = useState<StreamState>(demo ? "demo" : "connecting");
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (demo || !enabled) return;
    const es = new EventSource("/api/agent/stream");
    esRef.current = es;
    es.onopen = () => setState("open");
    es.onerror = () => setState(es.readyState === EventSource.CLOSED ? "closed" : "reconnecting");
    const onStatus = (e: MessageEvent) => {
      try {
        const st = JSON.parse(e.data);
        qc.setQueryData(["agent", "status"], { available: true, dish_reachable: true, age_s: 0, stale: false, status: st });
        window.dispatchEvent(new CustomEvent("orbitlink:status", { detail: st }));
      } catch {
        /* payload inválido é ignorado */
      }
    };
    const onAgent = (e: MessageEvent) => {
      try {
        const a = JSON.parse(e.data);
        qc.setQueryData(["agent", "agent"], (old: Record<string, unknown> | undefined) => ({ ...(old ?? {}), ...a }));
        if (a.dish_reachable === false) qc.invalidateQueries({ queryKey: ["agent", "status"] });
      } catch {
        /* ignore */
      }
    };
    const onHistory = () => {
      qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[1] === "string" && /^(telemetry|usage|quality|events)/.test(q.queryKey[1] as string) });
    };
    const onAlert = () => qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[1] === "string" && (q.queryKey[1] as string).startsWith("alerts") });
    es.addEventListener("status", onStatus);
    es.addEventListener("agent", onAgent);
    es.addEventListener("history", onHistory);
    es.addEventListener("alert", onAlert);
    return () => {
      es.close();
      esRef.current = null;
    };
  }, [demo, enabled, qc]);

  return demo ? "demo" : state;
}
