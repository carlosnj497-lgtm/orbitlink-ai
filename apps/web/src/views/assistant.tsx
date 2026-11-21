"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowUp, CheckCircle2, History, MessageSquarePlus, Mic, MicOff, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/domain";
import { Markdown } from "@/components/markdown";
import { Button, Callout, Card, Dialog, EmptyState, Tip } from "@/components/ui/primitives";
import { api, ApiError, errorText, noteServerDate, useAgent } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useBasePath, useDemo } from "@/lib/demo-context";
import { fmtAgo, usageForToday } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { type AgentInfo } from "@astryon/shared";
import { type CheckState, StateDot, StateIcon } from "./diagnostics-parts/checklist";

interface AiStatus {
  configured: boolean;
  model: string;
  daily_limit: number;
  usage: { day: string; requests: number }[];
  audio?: {
    enabled: boolean;
    model: string;
    daily_limit: number;
    usage: { day: string; requests: number; audio_seconds: number; estimated_cost_usd: number }[];
    pricing_usd_per_hour: number | null;
    telegram: boolean;
  };
}

interface AskResponse {
  conversation_id: number;
  answer: string;
  engine: "groq" | "regras";
  model?: string;
  tools_used: string[];
  proposal: { proposta: { acao: string; descricao: string; consequencias: string[]; motivo?: string }; disponivel: boolean; status_capacidade: string } | null;
  usage?: { input_tokens: number; output_tokens: number; estimated_cost_usd: number | null };
}

interface Conversation {
  id: number;
  title: string;
  created_at: number;
  updated_at: number;
}

interface StoredMessage {
  role: string;
  content: string;
  tools_json?: string | null;
  created_at: number;
}

interface Msg {
  role: "user" | "assistant";
  text: string;
  meta?: AskResponse;
  /** Ferramentas lidas do histórico salvo (conversas antigas não têm o restante dos metadados). */
  tools?: string[];
  error?: boolean;
}

interface PrepareResponse {
  operation_id: string;
  nonce: string;
  expires_at: number;
  action: string;
  label: string;
  target: string;
  confirm_text: string;
  consequences: string[];
}

interface ConfirmResponse {
  operation_id: string;
  status: string;
  detail: string;
}

interface TranscribeResponse {
  text: string;
}

const SUGGESTIONS = [
  "Como está minha Starlink agora?",
  "Quanto de internet usei hoje e como esse valor foi calculado?",
  "Minha internet ficou ruim ontem à noite?",
  "Quais horários apresentam mais perda de pacotes?",
  "O problema está no Wi-Fi ou na conexão satelital?",
  "Meu ESP32 detectou queda de alimentação?",
  "Quero reiniciar a antena.",
];

/** Ferramentas somente leitura que o agente expõe à IA (mesma lista de `copilot.TOOLS` no agente). */
const TOOLS: { name: string; label: string }[] = [
  { name: "get_starlink_status", label: "Estado atual da antena" },
  { name: "get_telemetry_range", label: "Série de tráfego, latência e perda" },
  { name: "get_usage_summary", label: "Consumo e projeção do mês" },
  { name: "get_outages", label: "Interrupções e quedas" },
  { name: "get_obstruction_data", label: "Obstrução do céu" },
  { name: "get_diagnostic_summary", label: "Diagnóstico por regras" },
  { name: "get_active_alerts", label: "Alertas ativos" },
  { name: "get_network_devices", label: "Dispositivos da rede" },
  { name: "get_esp32_telemetry", label: "Telemetria ESP32" },
  { name: "get_capability_matrix", label: "Capacidades do firmware" },
  { name: "prepare_control_action", label: "Proposta de ação (não executa)" },
];
const TOOL_LABEL = Object.fromEntries(TOOLS.map((t) => [t.name, t.label]));

function parseTools(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.map((x) => (typeof x === "string" ? x : typeof x === "object" && x && "name" in x ? String((x as { name: unknown }).name) : "")).filter(Boolean);
  } catch {
    return [];
  }
}

/* ----------------------------------------------------------------- Histórico */
function HistoryList({
  items,
  loading,
  active,
  onOpen,
  onNew,
  onDelete,
  onDeleteAll,
  deletingAll,
  disabled,
  error,
}: {
  items: Conversation[];
  loading: boolean;
  active: number | null;
  onOpen: (id: number) => void;
  onNew: () => void;
  onDelete: (id: number) => void;
  /** Apaga todas as conversas listadas (uma a uma, pela mesma rota da exclusão individual). */
  onDeleteAll: () => Promise<void>;
  deletingAll: boolean;
  disabled: boolean;
  error?: string | null;
}) {
  const [confirm, setConfirm] = useState<number | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const n = items.length;
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-3">
<h2 className="font-display text-[17px] font-semibold text-fg">Histórico</h2>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onNew} disabled={disabled}>
          <MessageSquarePlus /> Nova
        </Button>
      </div>
      {error && (
        <p role="alert" className="mx-3 mb-2 rounded-md border border-crit/40 bg-crit-soft px-2.5 py-2 text-xs text-crit">
          {error}
        </p>
      )}
      {loading ? (
        <div className="space-y-1.5 px-3 pb-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-10 rounded-md" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<History />}
          title="Nenhuma conversa salva"
          className="px-4 py-6"
        >
          As conversas ficam só neste computador e expiram automaticamente. Comece uma nova pergunta ao lado.
        </EmptyState>
      ) : (
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
          {items.map((c) => {
            const on = c.id === active;
            return (
              <li key={c.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onOpen(c.id)}
                  aria-current={on ? "true" : undefined}
                  className={cn(
                    "relative block w-full rounded-md py-2 pl-3 pr-9 text-left transition-colors",
                    on ? "bg-accent-soft text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                  )}
                >
                  <span aria-hidden className={cn("absolute inset-y-2 left-0 w-[2px] rounded-full bg-accent transition-opacity", on ? "opacity-100" : "opacity-0")} />
                  <span className="line-clamp-1 text-sm">{c.title || "Conversa sem título"}</span>
                  <span className="tabular mt-0.5 block text-[10.5px] text-fg-subtle">{fmtAgo(c.updated_at)}</span>
                </button>
                {confirm === c.id ? (
                  <button
                    type="button"
                    onClick={() => {
                      setConfirm(null);
                      onDelete(c.id);
                    }}
                    onBlur={() => setConfirm(null)}
                    autoFocus
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-[3px] border border-crit/60 bg-crit/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-crit"
                  >
                    Apagar
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label={`Apagar conversa "${c.title}"`}
                    onClick={() => setConfirm(c.id)}
                    className="absolute right-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-fg-subtle opacity-0 transition-opacity hover:bg-surface-3 hover:text-crit focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!loading && n > 0 && (
        <div className="mt-auto border-t border-border px-3 py-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-full justify-start px-2 text-xs text-fg-muted hover:bg-crit-soft hover:text-crit"
            onClick={() => setConfirmAll(true)}
            disabled={disabled || deletingAll}
            loading={deletingAll}
          >
            {!deletingAll && <Trash2 />} Apagar todas as conversas ({n})
          </Button>
        </div>
      )}
      <Dialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title="Apagar todas as conversas?"
        description={`As ${n} conversa${n === 1 ? "" : "s"} do histórico serão apagadas deste computador. Não dá para desfazer.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmAll(false)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmAll(false);
                void onDeleteAll();
              }}
            >
              <Trash2 /> Apagar {n === 1 ? "1 conversa" : `${n} conversas`}
            </Button>
          </>
        }
      />
    </div>
  );
}

/* ----------------------------------------------------------------- Mensagens */
function ToolChips({ tools }: { tools: string[] }) {
  const uniq = Array.from(new Set(tools));
  if (!uniq.length) return null;
  return (
    <div className="mt-3 rounded-md border border-border bg-bg-elev/60 px-3 py-2">
      <p className="text-[11px] text-fg-subtle">
        Dados consultados <span className="tabular">({uniq.length})</span>
      </p>
      <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1" aria-label="Consultas feitas pela IA">
        {uniq.map((t) => (
          <li key={t} className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
            <StateDot state="ok" />
            {TOOL_LABEL[t] ?? t}
            <span className="sr-only">(consultado)</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface MessageProps {
  m: Msg;
  base: string;
  onRetry?: () => void;
  onRunAction?: (proposal: NonNullable<AskResponse["proposal"]>) => void;
  runningAction?: boolean;
}

function Message({ m, base, onRetry, onRunAction, runningAction }: MessageProps) {
  if (m.role === "user") {
    return (
      <div className="animate-rise flex justify-end">
        <div className="max-w-[min(85%,42rem)] rounded-md rounded-br-[2px] border border-accent-2/40 bg-accent-deep/35 px-4 py-2.5 text-sm text-fg">
          <p className="whitespace-pre-wrap">{m.text}</p>
        </div>
      </div>
    );
  }
  const tools = m.meta?.tools_used ?? m.tools ?? [];
  const tooltip = m.meta
    ? `${m.meta.engine === "groq" ? `Groq · ${m.meta.model}` : "Regras determinísticas"}${m.meta.usage ? ` · ${m.meta.usage.input_tokens + m.meta.usage.output_tokens} tokens` : ""}${m.meta.usage?.estimated_cost_usd != null ? ` · US$ ${m.meta.usage.estimated_cost_usd.toFixed(4)}` : ""}`
    : undefined;
  return (
    <div className="animate-rise flex gap-3">
      <span aria-hidden className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-md border", m.error ? "border-crit/40 text-crit" : "border-accent-2/50 bg-bg-elev text-accent")}>
        {m.error ? <StateIcon state="crit" className="size-4" /> : <Sparkles className="size-3.5 stroke-[1.75]" />}
      </span>
      <div className="min-w-0 max-w-[48rem] flex-1">
        {m.error ? (
          <div className="rounded-md border border-crit/30 bg-crit/10 px-3 py-2">
            <p className="text-sm text-crit">{m.text}</p>
            {onRetry && (
              <Button size="sm" variant="ghost" className="mt-1 h-7 px-2 text-xs text-crit hover:bg-crit/10" onClick={onRetry}>
                <RefreshCw className="size-3.5" /> Tentar de novo
              </Button>
            )}
          </div>
        ) : (
          <Markdown text={m.text} />
        )}
        {m.meta?.proposal && (
          <div className="mt-3 rounded-md border border-warn/35 bg-warn-soft p-3 text-sm">
            <p className="flex items-start gap-2 font-medium text-fg">
              <StateIcon state="warn" className="mt-px size-4" />
              <span>Proposta: {m.meta.proposal.proposta.descricao}</span>
            </p>
            <p className="mt-0.5 pl-6 text-xs text-fg-muted">
              {m.meta.proposal.disponivel ? "Disponível para confirmação manual." : `Indisponível (${m.meta.proposal.status_capacidade}).`} Nada foi executado.
            </p>
            {m.meta.proposal.disponivel && onRunAction ? (
              <Button
                size="sm"
                variant="primary"
                className="mt-2 ml-6 h-8"
                onClick={() => onRunAction(m.meta!.proposal!)}
                loading={runningAction}
              >
                <CheckCircle2 className="size-3.5" /> Confirmar e executar
              </Button>
            ) : (
              <Link href={`${base}/controle`} className="mt-2 ml-6 inline-block text-xs font-medium text-accent hover:underline">
                Abrir Controle da Starlink →
              </Link>
            )}
          </div>
        )}
        <ToolChips tools={tools} />
        {m.meta && tooltip && (
          <Tip content={tooltip} side="right">
            <p className="tabular mt-2 inline-flex cursor-help items-center gap-1.5 text-[10.5px] text-fg-subtle">
              <StateDot state={m.meta.engine === "groq" ? "ok" : "off"} className="size-1.5" />
              {m.meta.engine === "groq" ? "Groq" : "Regras"}
            </p>
          </Tip>
        )}
      </div>
    </div>
  );
}

function Thinking() {
  return (
    <div className="flex gap-3" role="status" aria-live="polite">
      <span aria-hidden className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md border border-accent-2/60 bg-bg-elev text-accent">
        <Sparkles className="size-3.5 animate-pulse-dot stroke-[1.75]" />
      </span>
      <div className="min-w-0 flex-1 pt-1">
        <p className="text-sm text-fg-muted">Consultando dados do agente…</p>
        <div className="ol-scan mt-2 h-px w-48 max-w-full bg-border" aria-hidden />
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Estado do motor */
/** Linha de estado do motor: Groq ligado (verde) ou só regras (desligado), e o uso de hoje contra o limite.
 *  Mesmo sem ai/status (demo/offline) mostra uma linha explicativa para não deixar o topo vazio. */
function EngineLine({
  status,
  loading,
  today,
  audioToday,
  agent,
  demo,
}: {
  status: AiStatus | undefined;
  loading: boolean;
  today: number;
  audioToday: number;
  agent: AgentInfo | undefined;
  demo: boolean;
}) {
  if (loading) return <div className="skeleton mb-4 h-11 w-full rounded-md" aria-hidden />;
  const on = status?.configured ?? agent?.ai_configured ?? false;
  const limit = status?.daily_limit ?? 0;
  const ratio = limit > 0 ? today / limit : 0;
  const use: CheckState = ratio >= 1 ? "crit" : ratio >= 0.8 ? "warn" : "ok";
  const audio = status?.audio;
  const showMeter = status && (on || status.daily_limit > 0);
  return (
    <section aria-label="Estado do motor de IA" className="ol-card mb-4 flex flex-wrap items-center gap-x-6 gap-y-2.5 px-4 py-2.5">
      <p className="flex min-w-0 items-center gap-2 text-sm text-fg">
        <StateDot state={on ? "ok" : demo ? "off" : "warn"} />
        {demo ? (
          <>
            Modo demonstração <span className="text-xs text-fg-subtle">(IA inativa)</span>
          </>
        ) : on ? (
          <>
            Groq ligado <span className="tabular truncate text-xs text-fg-subtle">{status?.model}</span>
          </>
        ) : status ? (
          <>
            Somente regras <span className="text-xs text-fg-subtle">(sem chave de API)</span>
          </>
        ) : (
          <>
            Estado da IA indisponível <span className="text-xs text-fg-subtle">(agente offline?)</span>
          </>
        )}
      </p>
      {showMeter && (
        <div className="flex items-center gap-2.5 text-xs text-fg-muted">
          <span>Perguntas</span>
          <span
            role="meter"
            aria-label="Perguntas de hoje"
            aria-valuemin={0}
            aria-valuemax={limit}
            aria-valuenow={today}
            className="relative h-1.5 w-24 overflow-hidden rounded-full bg-bg-elev ring-1 ring-border"
          >
            <span className={cn("absolute inset-y-0 left-0 rounded-full", use === "crit" ? "bg-crit" : use === "warn" ? "bg-warn" : "bg-accent")} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
          </span>
          <span className={cn("tabular", use === "crit" ? "text-crit" : use === "warn" ? "text-warn" : "text-fg")}>{`${today}/${limit} hoje`}</span>
        </div>
      )}
      {audio?.enabled && (
        <p className="flex items-center gap-1.5 text-xs text-fg-muted">
          <Mic className="size-3.5 text-fg-subtle" aria-hidden />
          <span className="tabular text-fg">{`${audioToday}/${audio.daily_limit}`}</span> áudios hoje
        </p>
      )}
      <p className="text-xs text-fg-subtle sm:ml-auto">
        {demo
          ? "Conecte um agente real para fazer perguntas."
          : on
            ? "A IA escolhe quais dados consultar; as consultas aparecem marcadas em cada resposta."
            : "As respostas vêm do diagnóstico por regras do agente."}
      </p>
    </section>
  );
}

/* ----------------------------------------------------------------- Tela */
export default function AssistantView() {
  const demo = useDemo();
  const clock = useNow(60_000);
  const base = useBasePath();
  const qc = useQueryClient();
  const agent = useAgent<AgentInfo>("agent", { refetchInterval: 30_000 });
  const status = useAgent<AiStatus>("ai/status");
  const history = useAgent<{ conversations?: Conversation[] }>(demo ? null : "ai/conversations");
  const conversations = Array.isArray(history.data?.conversations) ? history.data.conversations : [];
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [conv, setConv] = useState<number | null>(null);
  const [loadingConv, setLoadingConv] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [q, setQ] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const ask = useMutation({
    mutationKey: ["ai", "ask"],
    mutationFn: (question: string) => api<AskResponse>("ai/ask", { method: "POST", body: JSON.stringify({ question, conversation_id: conv }) }),
    onSuccess: (r) => {
      setConv(r.conversation_id);
      setMsgs((m) => [...m, { role: "assistant", text: r.answer, meta: r }]);
      void qc.invalidateQueries({ queryKey: ["agent", "ai/conversations"] });
      void qc.invalidateQueries({ queryKey: ["agent", "ai/status"] });
    },
    onError: (e: ApiError) => setMsgs((m) => [...m, { role: "assistant", text: e.message, error: true }]),
  });

  // Retry da última pergunta feita (usado em mensagens de erro).
  const [lastQuestion, setLastQuestion] = useState<string>("");

  // ----------------------------------------------------------------- Ação inline (prepare → confirm)
  const [runActionMsg, setRunActionMsg] = useState<{ action: string; text: string } | null>(null);
  const prepareAction = useMutation({
    mutationKey: ["control", "prepare"],
    mutationFn: ({ action, reason }: { action: string; reason?: string }) =>
      api<PrepareResponse>("control/prepare", { method: "POST", body: JSON.stringify({ action, reason }) }),
  });
  const confirmAction = useMutation({
    mutationKey: ["control", "confirm"],
    mutationFn: ({ operation_id, nonce, confirm_text }: { operation_id: string; nonce: string; confirm_text: string }) =>
      api<ConfirmResponse>("control/confirm", { method: "POST", body: JSON.stringify({ operation_id, nonce, confirm_text }) }),
    onSuccess: (r) => {
      setMsgs((m) => [
        ...m,
        { role: "assistant", text: `✓ Ação executada: ${runActionMsg?.text ?? r.status}\n\n${r.detail}` },
      ]);
      setRunActionMsg(null);
    },
    onError: (e: ApiError) => {
      setMsgs((m) => [
        ...m,
        { role: "assistant", text: `Não foi possível executar a ação: ${e.message}`, error: true },
      ]);
      setRunActionMsg(null);
    },
  });

  async function runProposal(proposal: NonNullable<AskResponse["proposal"]>) {
    if (prepareAction.isPending || confirmAction.isPending) return;
    setRunActionMsg({ action: proposal.proposta.acao, text: proposal.proposta.descricao });
    try {
      const p = await prepareAction.mutateAsync({ action: proposal.proposta.acao, reason: proposal.proposta.motivo });
      await confirmAction.mutateAsync({
        operation_id: p.operation_id,
        nonce: p.nonce,
        confirm_text: p.confirm_text,
      });
    } catch {
      // Erros já vão para onError das mutações.
    }
  }

  // ----------------------------------------------------------------- Áudio (gravar e transcrever no navegador)
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const transcribe = useMutation({
    mutationKey: ["ai", "transcribe"],
    mutationFn: async (blob: Blob) => {
      const form = new FormData();
      form.append("file", blob, "recording.webm");
      const res = await fetch("/api/agent/ai/transcribe", { method: "POST", body: form });
      noteServerDate(res);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { detail?: unknown; code?: string };
        throw new ApiError(res.status, errorText(body, res.status), body.code);
      }
      return (await res.json()) as TranscribeResponse;
    },
    onSuccess: (r) => {
      if (r.text) {
        setQ(r.text);
        input.current?.focus();
      }
    },
    onError: (e: ApiError) => setMsgs((m) => [...m, { role: "assistant", text: e.message, error: true }]),
  });

  async function toggleRecording() {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    if (demo) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      recorderRef.current = recorder;
      audioChunks.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size) audioChunks.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunks.current, { type: mime });
        if (blob.size > 0) transcribe.mutate(blob);
        setRecording(false);
      };
      recorder.onerror = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
      };
      recorder.start(200);
      setRecording(true);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", text: "Não foi possível acessar o microfone. Verifique a permissão do navegador.", error: true }]);
    }
  }

  // Rola a área de chat só se o usuário já estiver perto do final. Isso evita puxar o scroll
  // quando ele está relendo uma resposta longa, mas mantém o auto-scroll natural durante a conversa.
  useEffect(() => {
    const el = scroller.current;
    if (!el || (msgs.length === 0 && !ask.isPending)) return;
    const nearBottom = el.scrollHeight - (el.scrollTop + el.clientHeight) < 120;
    if (nearBottom) {
      el.scrollTo?.({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [msgs, ask.isPending]);

  function send(text: string) {
    const t = text.trim();
    if (!t || ask.isPending || demo) return;
    setLastQuestion(t);
    setMsgs((m) => [...m, { role: "user", text: t }]);
    setQ("");
    ask.mutate(t);
  }
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(q);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(q);
    }
  };

  // Cada abertura recebe um número; só a última aplica o resultado (cliques rápidos não misturam conversas).
  const openSeq = useRef(0);
  async function openConversation(id: number) {
    if (ask.isPending || id === conv) return;
    const seq = ++openSeq.current;
    setShowHistory(false);
    setLoadingConv(true);
    try {
      const r = await api<{ messages: StoredMessage[] }>(`ai/conversations/${id}`);
      if (seq !== openSeq.current) return;
      setConv(id);
      setMsgs(
        r.messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ role: m.role as Msg["role"], text: m.content, tools: parseTools(m.tools_json) })),
      );
    } catch (e) {
      if (seq !== openSeq.current) return;
      setMsgs([{ role: "assistant", text: (e as Error).message, error: true }]);
    } finally {
      if (seq === openSeq.current) setLoadingConv(false);
    }
  }

  function newConversation() {
    if (ask.isPending) return;
    openSeq.current++; // descarta uma abertura de conversa ainda em andamento
    setLoadingConv(false);
    setConv(null);
    setMsgs([]);
    setShowHistory(false);
    input.current?.focus();
  }

  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  async function deleteAllConversations() {
    setDeleteError(null);
    setDeletingAll(true);
    let failed = 0;
    try {
      // Uma de cada vez: não sobrecarrega o agente no servidor doméstico e permite contar as que falharam.
      for (const c of conversations) {
        try {
          await api(`ai/conversations/${c.id}`, { method: "DELETE" });
        } catch {
          failed++;
        }
      }
      newConversation();
      if (failed) setDeleteError(`${failed} conversa${failed === 1 ? "" : "s"} não ${failed === 1 ? "pôde" : "puderam"} ser apagada${failed === 1 ? "" : "s"}. Tente de novo.`);
    } finally {
      setDeletingAll(false);
      void qc.invalidateQueries({ queryKey: ["agent", "ai/conversations"] });
    }
  }
  async function deleteConversation(id: number) {
    setDeleteError(null);
    try {
      await api(`ai/conversations/${id}`, { method: "DELETE" });
      if (id === conv) newConversation();
    } catch (e) {
      // A conversa continua salva: não some da tela e o motivo aparece no histórico.
      setDeleteError(`Não foi possível apagar a conversa: ${(e as Error).message}`);
    } finally {
      void qc.invalidateQueries({ queryKey: ["agent", "ai/conversations"] });
    }
  }

  const today = usageForToday(status.data?.usage, clock);
  const audio = status.data?.audio;
  const audioToday = usageForToday(audio?.usage, clock);
  const configured = status.data?.configured ?? false;

  const historyList = (
    <HistoryList
      items={conversations}
      loading={!demo && history.isLoading}
      active={conv}
      onOpen={(id) => void openConversation(id)}
      onNew={newConversation}
      onDelete={(id) => void deleteConversation(id)}
      onDeleteAll={deleteAllConversations}
      deletingAll={deletingAll}
      disabled={demo || ask.isPending}
      error={deleteError}
    />
  );

  return (
    <>
      <PageHeader
        title="Central de IA"
        icon={<Sparkles />}
        description="Pergunte sobre estado, consumo, quedas e alertas. Respostas só leem dados; ações só com sua confirmação."
      />
      <EngineLine status={status.data} loading={status.isLoading} today={today?.requests ?? 0} audioToday={audioToday?.requests ?? 0} agent={agent.data} demo={demo} />
      {demo && (
        <Callout tone="demo" icon={<AlertTriangle />} className="mb-4">
          No modo demonstração as perguntas não são enviadas. Conecte um agente para usar a IA.
        </Callout>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_17rem] 2xl:grid-cols-[16rem_minmax(0,1fr)_18rem]">
        {/* Histórico: coluna fixa no desktop, painel recolhível no celular */}
        <Card className="hidden min-h-0 flex-col lg:flex lg:max-h-[min(72dvh,46rem)]">{historyList}</Card>

        <Card className="ol-glow flex min-h-[28rem] flex-col lg:h-[min(72dvh,46rem)]">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <p className="flex min-w-0 items-center gap-2 text-sm">
              <span className={cn("size-1.5 shrink-0 rounded-full", ask.isPending ? "animate-pulse-dot bg-accent" : configured ? "bg-accent" : "bg-fg-subtle")} aria-hidden />
              <span className="truncate font-medium text-fg">{conv ? (conversations.find((c) => c.id === conv)?.title ?? "Conversa") : "Nova conversa"}</span>
            </p>
            <div className="flex items-center gap-1 lg:hidden">
              <Button size="sm" variant="ghost" className="h-8 px-2.5 text-xs" onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory} disabled={demo}>
                <History /> Histórico
              </Button>
              <Button size="sm" variant="ghost" className="h-8 px-2.5 text-xs" onClick={newConversation} disabled={demo || ask.isPending} aria-label="Nova conversa">
                <MessageSquarePlus />
              </Button>
            </div>
          </div>
          {showHistory && <div className="animate-pop-in max-h-72 overflow-y-auto border-b border-border bg-bg-elev lg:hidden">{historyList}</div>}

          <div ref={scroller} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5" aria-live="polite">
            {loadingConv ? (
              <div className="space-y-3">
                <div className="skeleton ml-auto h-10 w-2/3 rounded-md" />
                <div className="skeleton h-24 w-5/6 rounded-md" />
              </div>
            ) : msgs.length === 0 ? (
              <div className="flex h-full flex-col justify-center">
                <div className="ol-hud mb-5 grid size-11 place-items-center rounded-md border border-border bg-bg-elev text-accent">
                  <Sparkles className="size-5 stroke-[1.5]" aria-hidden />
                </div>
                <p className="font-display text-lg font-semibold text-fg">Como posso ajudar com a sua Starlink?</p>
                <p className="mt-1 max-w-xl text-sm text-fg-muted">
                  Pergunte sobre o estado da antena, consumo, quedas, perda por horário, obstrução, alertas, dispositivos da rede e o ESP32. As respostas usam só os dados registrados pelo agente, lidos sem alterar nada.
                </p>
                <div className="mt-5">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-fg-subtle">Sugestões de perguntas</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => send(s)}
                        disabled={demo}
                        className="rounded-full border border-border bg-bg-elev px-3 py-1.5 text-left text-xs text-fg-muted transition-colors hover:border-accent-2/60 hover:bg-surface-2 hover:text-fg disabled:opacity-50"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              msgs.map((m, i) => (
                <Message
                  key={i}
                  m={m}
                  base={base}
                  onRetry={m.error && lastQuestion ? () => send(lastQuestion) : undefined}
                  onRunAction={m.meta?.proposal?.disponivel ? runProposal : undefined}
                  runningAction={prepareAction.isPending || confirmAction.isPending}
                />
              ))
            )}
            {ask.isPending && <Thinking />}
          </div>

          <form onSubmit={onSubmit} className="border-t border-border p-3">
            <div className="flex items-end gap-2 rounded-md border border-border-strong bg-bg-elev p-1.5 transition-[border-color,box-shadow] focus-within:border-accent-2 focus-within:shadow-[0_0_0_3px_rgb(0_140_255/0.18)]">
              <label htmlFor="ask" className="sr-only">
                Pergunta
              </label>
              <textarea
                id="ask"
                ref={input}
                rows={1}
                placeholder="Pergunte sobre a sua conexão…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKey}
                maxLength={2000}
                disabled={demo || recording}
                className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-fg [field-sizing:content] placeholder:text-fg-subtle focus:outline-none disabled:opacity-50"
              />
              {audio?.enabled && (
                <Tip content={recording ? "Parar gravação" : "Gravar pergunta de voz"} side="top">
                  <button
                    type="button"
                    onClick={() => void toggleRecording()}
                    disabled={demo}
                    aria-label={recording ? "Parar gravação" : "Gravar pergunta de voz"}
                    className={cn(
                      "grid size-10 shrink-0 place-items-center rounded-md transition-colors disabled:opacity-50",
                      recording
                        ? "animate-pulse bg-crit text-white"
                        : "text-fg-muted hover:bg-surface-3 hover:text-fg",
                      transcribe.isPending && "animate-pulse text-accent",
                    )}
                  >
                    {transcribe.isPending ? <Mic className="size-4" /> : recording ? <MicOff className="size-4" /> : <Mic className="size-4" />}
                  </button>
                </Tip>
              )}
              <Button type="submit" variant="primary" size="icon" loading={ask.isPending} disabled={!q.trim() || demo} aria-label="Enviar pergunta">
                {!ask.isPending && <ArrowUp />}
              </Button>
            </div>
            <p className="mt-1.5 hidden px-1 text-[10.5px] text-fg-subtle sm:block">
              {recording ? "Gravando… clique no microfone para parar" : "Enter envia · Shift+Enter quebra a linha"}
            </p>
          </form>
        </Card>

        {/* Ferramentas e regras: coluna à direita em telas largas, abaixo do chat nas demais */}
        <div className="grid gap-4 lg:col-span-2 lg:grid-cols-2 xl:col-span-1 xl:grid-cols-1 xl:max-h-[min(72dvh,46rem)] xl:overflow-y-auto">
          <Card className="p-4">
            <h2 className="font-display text-[17px] font-semibold text-fg">Ferramentas disponíveis</h2>
            <p className="mt-2 text-xs leading-relaxed text-fg-muted">
              {configured ? "A IA escolhe quais consultar para cada pergunta. As usadas aparecem marcadas na resposta." : "Desligadas sem a chave da Groq."}
            </p>
            <ul className="mt-3 grid gap-1 sm:grid-cols-2 lg:grid-cols-1">
              {TOOLS.map((t) => (
                <li key={t.name} className="flex items-center gap-2 rounded-[4px] px-1.5 py-1 text-xs text-fg-muted">
                  <StateDot state={configured ? "ok" : "off"} className="size-1.5" />
                  {t.label}
                </li>
              ))}
            </ul>
          </Card>
          <Card className="p-4">
            <h2 className="font-display text-[17px] font-semibold text-fg">Segurança</h2>
            <p className="mt-2 text-xs leading-relaxed text-fg-muted">
              A IA só lê dados. Pedidos de ação geram uma proposta; a execução exige sua confirmação na tela de Controle. Conversas ficam apenas neste computador e expiram automaticamente.
            </p>
          </Card>
          {audio?.enabled && (
            <Card className="p-4">
              <h2 className="font-display text-[17px] font-semibold text-fg">Áudio no Telegram</h2>
              <p className="mt-2 text-xs leading-relaxed text-fg-muted">
                Notas de voz são transcritas pelo Whisper ({audio.model}) e seguem o mesmo caminho de uma pergunta escrita. O áudio não é salvo em disco.
                {audioToday && audioToday.requests > 0 && (
                  <>
                    {" "}
                    Hoje: <span className="tabular text-fg">{audioToday.requests}</span> áudio(s), <span className="tabular text-fg">{Math.round(audioToday.audio_seconds / 60)}</span> min.
                  </>
                )}
              </p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
