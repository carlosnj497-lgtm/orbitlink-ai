"use client";

import { sseAgentSchema, sseStatusSchema } from "@astryon/shared";
import { type QueryClient, useQuery, type UseQueryOptions, useQueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import { CLOUD } from "./cloud-flag";
import { useDemo } from "./demo-context";
import { demoFetch } from "./demo-data";
import { reloadToLogin } from "./navigation";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

/**
 * Texto de erro legível a partir da resposta do agente. O FastAPI devolve `detail` como texto ou, em erros de
 * validação (422), como lista de objetos; renderizar o objeto direto derrubava a tela.
 */
export function errorText(body: unknown, status: number): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string" && detail) return detail;
  if (Array.isArray(detail) && detail.length) {
    const msgs = detail.map((d) => (d && typeof d === "object" && "msg" in d ? String((d as { msg: unknown }).msg) : "")).filter(Boolean);
    if (msgs.length) return `Dados inválidos: ${msgs.slice(0, 3).join("; ")}`;
  }
  return `Erro ${status}`;
}

/*
 * Relógio do servidor. Prazos curtos (confirmação de reboot, código de pareamento: ~2 min) vêm em epoch do
 * servidor; comparar com o relógio do celular/computador (que pode estar adiantado ou atrasado) travava ou
 * enganava a contagem. Cada resposta traz o cabeçalho `Date` (resolução de 1 s): a diferença vira o ajuste.
 */
let clockOffsetMs = 0;

/** Atualiza o ajuste de relógio a partir do cabeçalho `Date` de uma resposta do painel. */
export function noteServerDate(res: Response, receivedAt = Date.now()): void {
  const header = res.headers?.get?.("date");
  const server = header ? Date.parse(header) : NaN;
  if (Number.isFinite(server)) clockOffsetMs = server + 500 - receivedAt; // +500 ms: meio do segundo truncado
}

/** Agora (epoch s) no relógio do servidor. */
export function serverNow(): number {
  return (Date.now() + clockOffsetMs) / 1000;
}

/** Só para testes. */
export function __setClockOffsetMs(ms: number): void {
  clockOffsetMs = ms;
}

function handleUnauthorized(status: number): void {
  if (status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) reloadToLogin();
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/agent/${path.replace(/^\//, "")}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  noteServerDate(res);
  handleUnauthorized(res.status);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { detail?: unknown; code?: string };
    throw new ApiError(res.status, errorText(body, res.status), body.code);
  }
  if (res.status === 204 || res.status === 205) return undefined as T;
  return (await res.json()) as T;
}

export interface JsonResult<T> {
  ok: boolean;
  /** 0 = sem resposta (rede, servidor parado). */
  status: number;
  data: T | null;
  /** Mensagem pronta para mostrar quando `ok` é falso. */
  error: string | null;
}

/**
 * `fetch` + JSON para as rotas do próprio painel (login, senha, aparelho...). Nunca lança: falha de rede,
 * status de erro e corpo inválido viram `{ ok: false, error }` com uma mensagem legível.
 */
export async function requestJson<T = unknown>(url: string, init: RequestInit & { json?: unknown } = {}, offline = "Não foi possível falar com o servidor."): Promise<JsonResult<T>> {
  const { json, ...rest } = init;
  const req: RequestInit = json === undefined ? rest : { ...rest, method: rest.method ?? "POST", headers: { "Content-Type": "application/json", ...(rest.headers ?? {}) }, body: JSON.stringify(json) };
  let res: Response;
  try {
    res = await fetch(url, req);
  } catch {
    return { ok: false, status: 0, data: null, error: offline };
  }
  noteServerDate(res);
  const body: unknown = res.status === 204 || res.status === 205 ? null : await res.json().catch(() => null);
  if (!res.ok) return { ok: false, status: res.status, data: null, error: errorText(body, res.status) };
  return { ok: true, status: res.status, data: body as T, error: null };
}

/**
 * Baixa um arquivo do painel. Erro (401, 502, rede) vira ApiError em vez de salvar a mensagem de erro como se
 * fosse o arquivo. A URL temporária só é liberada depois que o navegador começou o download.
 */
export async function downloadFrom(url: string, fallbackName: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new ApiError(0, "Não foi possível falar com o servidor. Verifique a conexão e tente de novo.");
  }
  handleUnauthorized(res.status);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, errorText(body, res.status));
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? fallbackName;
  saveBlob(await res.blob(), name);
}

/** Salva um Blob como arquivo (o revoke imediato abortava o download no Firefox/Safari). */
export function saveBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 30_000);
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
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 2000;
const RETRY_MAX = 30_000;
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
  src.onopen = () => {
    retryDelay = 2000;
    setStreamState("open");
  };
  src.onerror = () => {
    if (src.readyState !== EventSource.CLOSED) {
      setStreamState("reconnecting"); // o próprio navegador tenta de novo
      return;
    }
    // Fechado de vez (ex.: agente reiniciando devolve 502, ou a sessão expirou): o navegador NÃO tenta mais.
    // Reabre com espera crescente; antes, uma consulta comum leva ao login se a sessão tiver expirado.
    if (es === src) es = null;
    setStreamState("reconnecting");
    scheduleReopen();
  };
  src.addEventListener("status", (e: MessageEvent) => {
    const st = parseSse(e.data, sseStatusSchema);
    if (!st) return; // payload inválido não entra no cache
    qc.setQueryData(["agent", "status"], { available: true, dish_reachable: true, age_s: 0, stale: false, status: st });
    window.dispatchEvent(new CustomEvent("astryon:status", { detail: st }));
  });
  src.addEventListener("agent", (e: MessageEvent) => {
    const a = parseSse(e.data, sseAgentSchema);
    if (!a) return;
    qc.setQueryData(["agent", "agent"], (old: Record<string, unknown> | undefined) => ({ ...(old ?? {}), ...a }));
    if (a.dish_reachable === false) qc.invalidateQueries({ queryKey: ["agent", "status"] });
  });
  src.addEventListener("history", () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "agent" && isHistoryKey(q.queryKey[1]) }));
  src.addEventListener("alert", () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "agent" && isAlertKey(q.queryKey[1]) }));
}

/** JSON do SSE validado pelo schema compartilhado; inválido → null (ignorado). */
export function parseSse<T>(raw: string, schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } }): T | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const r = schema.safeParse(value);
  return r.success ? r.data : null;
}

function scheduleReopen() {
  if (retryTimer || subscribers === 0) return;
  const wait = retryDelay;
  retryDelay = Math.min(RETRY_MAX, retryDelay * 2);
  retryTimer = setTimeout(async () => {
    retryTimer = null;
    if (subscribers === 0 || document.visibilityState === "hidden") return;
    try {
      await api("agent"); // 401 redireciona para o login; 502 (agente fora) cai no catch
      openStream();
    } catch {
      scheduleReopen();
    }
  }, wait);
}

function closeStream() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  retryDelay = 2000;
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
    if (demo || !enabled || CLOUD) return; // na nuvem não há tempo real: as telas consultam periodicamente
    return acquireStream(qc);
  }, [demo, enabled, qc]);

  return demo ? "demo" : CLOUD ? "closed" : state;
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
