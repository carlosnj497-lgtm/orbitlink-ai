"use client";

import { ArrowRight, ChevronDown, type LucideIcon, X } from "lucide-react";
import Link from "next/link";
import { Children, createContext, type ReactNode, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { hrefOf } from "@/components/shell/nav";
import { Badge, Button } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { useBasePath } from "@/lib/demo-context";
import { fmtNumber } from "@/lib/format";

export type SettingsData = Record<string, unknown> & {
  secrets_configured: Record<string, boolean>;
  runtime_overrides: Record<string, string | null>;
  terminal_name: string;
  show_mac_addresses: boolean;
  usage_monthly_limit_gb?: number | null;
  usage_cycle_start_day?: number;
  version?: string;
};

export interface AiStatus {
  configured: boolean;
  model: string;
  daily_limit: number;
  retention_days?: number;
  usage: { day: string; requests: number }[];
  audio?: { enabled: boolean; model: string; daily_limit: number; telegram: boolean; usage?: { day: string; requests: number }[] };
}

export interface SyncState {
  configured: boolean;
  pending: number;
  failed_attempts: number;
  pairing?: { cloud_configured: boolean; paired: boolean; via_env: boolean; workspace_name: string | null; agent_name: string | null; paired_at: number | null };
}


export const WEEKDAYS = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"];

export const SECRET_LABELS: Record<string, string> = {
  api_token: "Token entre painel e agente",
  groq_api_key: "Chave da Groq (Central de IA)",
  setup_code: "Código do primeiro acesso",
  supabase_agent_token: "Supabase · token do agente",
  supabase_anon_key: "Supabase · chave pública",
  telegram_bot_token: "Bot do Telegram",
  telegram_chat_id: "Chat do Telegram",
  smtp_host: "SMTP · servidor",
  smtp_port: "SMTP · porta",
  smtp_user: "SMTP · usuário",
  smtp_password: "SMTP · senha",
  smtp_from: "SMTP · remetente (From)",
  smtp_security: "SMTP · segurança (starttls/ssl/none)",
};

export const envName = (key: string) => `ASTRYON_${key.toUpperCase()}`;

/** Valor de configuração legível: booleanos viram Sim/Não, segundos ganham unidade, ausente vira travessão. */
export function fmtValue(v: unknown, unit?: "s" | "d"): ReactNode {
  if (v === null || v === undefined || v === "") return <span className="text-fg-subtle">—</span>;
  if (typeof v === "boolean") return <Badge tone={v ? "accent" : "neutral"}>{v ? "sim" : "não"}</Badge>;
  if (typeof v === "number" && unit === "s") return v >= 60 ? `${fmtNumber(v / 60, v % 60 ? 1 : 0)} min` : `${fmtNumber(v, v % 1 ? 1 : 0)} s`;
  if (typeof v === "number" && unit === "d") return `${fmtNumber(v, 0)} dias`;
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

/* ----------------------------------------------------------------- Rack de módulos */

/** Estado operacional de um módulo. Só estas cores carregam estado (verde, amarelo, vermelho); "off" é cinza. */
export type ModuleState = "ok" | "warn" | "crit" | "off" | "loading";

/** Ordem fixa dos módulos: o quadro de luzes e os grupos seguem esta lista. */
export const MODULES: { id: string; short: string }[] = [
  { id: "geral", short: "Antena" },
  { id: "plano", short: "Plano" },
  { id: "notificacoes", short: "Avisos" },
  { id: "ia", short: "IA" },
  { id: "clima", short: "Clima" },
  { id: "conta", short: "Conta" },
  { id: "conexoes", short: "Conexões" },
  { id: "coleta", short: "Coleta" },
  { id: "servidor", short: "Servidor" },
  { id: "nuvem", short: "Nuvem" },
  { id: "credenciais", short: "Credenciais" },
  { id: "sobre", short: "Sobre" },
];

const STATE_WORD: Record<ModuleState, string> = { ok: "ok", warn: "atenção", crit: "falha", off: "desligado", loading: "lendo" };
const DOT: Record<ModuleState, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  crit: "bg-crit",
  off: "border border-fg-subtle bg-transparent",
  loading: "bg-fg-subtle animate-pulse-dot",
};

type Report = { state: ModuleState; label?: string };
type RackCtx = {
  open: string | null;
  toggle: (id: string, focus?: boolean) => void;
  reports: Record<string, Report>;
  report: (id: string, r: Report) => void;
};
const Rack = createContext<RackCtx | null>(null);

function useRack() {
  const ctx = useContext(Rack);
  if (!ctx) throw new Error("Módulo de configurações fora do RackProvider");
  return ctx;
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Guarda qual módulo está aberto (um por vez, refletido no #hash da URL) e o estado que cada um reporta. */
export function RackProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<string | null>(null);
  const [reports, setReports] = useState<Record<string, Report>>({});

  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.slice(1);
      if (!MODULES.some((m) => m.id === h)) return;
      setOpen(h);
      // O módulo só existe depois que os dados chegam; rola até ele no quadro seguinte.
      requestAnimationFrame(() => document.getElementById(h)?.scrollIntoView({ block: "start" }));
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  const toggle = useCallback((id: string, focus = false) => {
    setOpen((cur) => {
      const next = cur === id && !focus ? null : id;
      const url = next ? `#${next}` : window.location.pathname + window.location.search;
      window.history.replaceState(null, "", url);
      return next;
    });
  }, []);

  const report = useCallback((id: string, r: Report) => {
    setReports((cur) => (cur[id]?.state === r.state && cur[id]?.label === r.label ? cur : { ...cur, [id]: r }));
  }, []);

  const value = useMemo(() => ({ open, toggle, reports, report }), [open, toggle, reports, report]);
  return <Rack.Provider value={value}>{children}</Rack.Provider>;
}

function StateTag({ state, label }: { state: ModuleState; label?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-xs", state === "warn" ? "text-warn" : state === "crit" ? "text-crit" : state === "ok" ? "text-fg-muted" : "text-fg-subtle")}>
      <span className={cn("size-2 rounded-full", DOT[state])} aria-hidden />
      {label ?? STATE_WORD[state]}
    </span>
  );
}

function Count({ state, n, word }: { state: ModuleState; n: number; word: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-2 rounded-full", DOT[state])} aria-hidden />
      <span className="tabular text-fg">{n}</span> {word}
    </span>
  );
}

/**
 * Quadro de luzes: uma célula por módulo, na ordem do rack. Cada célula abre o módulo correspondente.
 * Lê o estado que os próprios módulos reportam; enquanto um módulo não reporta, a célula fica "lendo".
 */
export function Annunciator() {
  const { open, toggle, reports } = useRack();
  const counts = { ok: 0, warn: 0, crit: 0, off: 0 };
  for (const m of MODULES) {
    const st = reports[m.id]?.state;
    if (st && st !== "loading") counts[st] += 1;
  }
  const attention = counts.warn + counts.crit;
  return (
    <div className="ol-card mb-6 overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 pt-4">
        <h2 className="font-display text-sm font-semibold text-fg">
          {attention === 0 ? "Tudo em ordem" : attention === 1 ? "1 módulo pede atenção" : `${attention} módulos pedem atenção`}
        </h2>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
          <Count state="ok" n={counts.ok} word="ok" />
          {counts.warn > 0 && <Count state="warn" n={counts.warn} word="atenção" />}
          {counts.crit > 0 && <Count state="crit" n={counts.crit} word="falha" />}
          <Count state="off" n={counts.off} word={counts.off === 1 ? "desligado" : "desligados"} />
        </p>
      </div>
      <ul className="grid grid-cols-3 gap-px border-t border-border bg-border mt-4 sm:grid-cols-4 lg:grid-cols-6">
        {MODULES.map((m) => {
          const r = reports[m.id] ?? { state: "loading" as const };
          const active = open === m.id;
          return (
            <li key={m.id} className="bg-surface">
              <a
                href={`#${m.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  toggle(m.id, true);
                  document.getElementById(m.id)?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
                }}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "flex h-full min-h-14 flex-col justify-center gap-1 px-3 py-2.5 transition-colors hover:bg-surface-2",
                  r.state === "warn" && "bg-warn-soft hover:bg-warn-soft",
                  r.state === "crit" && "bg-crit-soft hover:bg-crit-soft",
                  active && "bg-accent-soft shadow-[inset_0_-2px_0_0_var(--accent)] hover:bg-accent-soft",
                )}
              >
                <span className="flex items-center gap-2 text-sm font-medium text-fg">
                  <span className={cn("size-2 shrink-0 rounded-full", DOT[r.state])} aria-hidden />
                  {m.short}
                </span>
                <span className={cn("line-clamp-2 hyphens-auto break-normal pl-4 text-[11px] leading-snug", r.state === "warn" ? "text-warn" : r.state === "crit" ? "text-crit" : "text-fg-subtle")}>{r.label ?? STATE_WORD[r.state]}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Número, medida ou horário dentro de um valor: mono tabular. O resto do valor fica na fonte de títulos. */
export function Num({ children }: { children: ReactNode }) {
  // Espaço mono é largo demais entre número e unidade ("10  s"): troca por espaço fino inseparável.
  const text = typeof children === "string" ? children.replace(/ /g, "\u202F") : children;
  return <span className="tabular tracking-[-0.03em]">{text}</span>;
}

/** Vaga logo abaixo da linha do módulo: é onde o painel aberto aparece, sem tirar nenhum módulo do lugar. */
const RowSlot = createContext<string | null>(null);

/** Colunas da grade conforme a largura (1 / 2 a partir de md / 3 a partir de xl), iguais às classes da grade. */
function useColumns() {
  const [cols, setCols] = useState(1);
  useEffect(() => {
    const md = window.matchMedia("(min-width: 768px)");
    const xl = window.matchMedia("(min-width: 1280px)");
    const read = () => setCols(xl.matches ? 3 : md.matches ? 2 : 1);
    read();
    md.addEventListener("change", read);
    xl.addEventListener("change", read);
    return () => {
      md.removeEventListener("change", read);
      xl.removeEventListener("change", read);
    };
  }, []);
  return cols;
}

/**
 * Grupo de módulos com título. Depois de cada linha da grade fica uma vaga de largura total (escondida enquanto vazia):
 * o módulo aberto desenha o painel ali, logo abaixo da própria linha, e a ordem visual segue a ordem do DOM.
 */
export function RackGroup({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const gid = useId();
  const cols = useColumns();
  const items = Children.toArray(children);
  const cells: ReactNode[] = [];
  items.forEach((child, i) => {
    const slot = `${gid}-c${cols}-l${Math.floor(i / cols)}`;
    cells.push(
      <RowSlot.Provider key={`m-${i}`} value={slot}>
        {child}
      </RowSlot.Provider>,
    );
    if ((i + 1) % cols === 0 || i === items.length - 1) cells.push(<div key={slot} id={slot} className="col-span-full empty:hidden" />);
  });
  return (
    <section className="mb-8" aria-label={title}>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h2 className="font-display text-[17px] font-semibold text-fg">{title}</h2>
        <p className="text-xs text-fg-subtle">{description}</p>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{cells}</div>
    </section>
  );
}

/**
 * Módulo do rack: luz de estado, título, valor-chave e uma linha de detalhe; o cartão inteiro é o botão.
 * Aberto, o cartão fica marcado e o painel em foco (descrição, ações e conteúdo) aparece na vaga logo abaixo da linha.
 * Atenção e falha pintam o cartão com o par suave do estado; desligado apaga o valor e o ícone.
 */
export function Section({
  id,
  title,
  description,
  icon: Icon,
  actions,
  state,
  stateLabel,
  value,
  detail,
  children,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  icon: LucideIcon;
  actions?: ReactNode;
  state: ModuleState;
  stateLabel?: string;
  /** Na fonte de títulos; números e medidas dentro dele vão em <Num>. */
  value: ReactNode;
  detail?: ReactNode;
  children: ReactNode;
}) {
  const { open, toggle, report } = useRack();
  const isOpen = open === id;
  const ref = useRef<HTMLElement>(null);
  const wasOpen = useRef(isOpen);
  const slotId = useContext(RowSlot);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    // A vaga é renderizada pelo RackGroup no mesmo commit; procura no quadro seguinte (muda quando o nº de colunas muda).
    if (!isOpen || !slotId) return;
    const raf = requestAnimationFrame(() => setSlot(document.getElementById(slotId)));
    return () => cancelAnimationFrame(raf);
  }, [isOpen, slotId]);

  useEffect(() => report(id, { state, label: stateLabel }), [id, state, stateLabel, report]);
  useEffect(() => {
    // Ao fechar, devolve o foco ao cartão para o teclado não se perder.
    if (wasOpen.current && !isOpen) ref.current?.querySelector<HTMLButtonElement>("button[aria-expanded]")?.focus();
    wasOpen.current = isOpen;
  }, [isOpen]);

  const tone = state === "warn" ? "border-warn/40 bg-warn-soft" : state === "crit" ? "border-crit/40 bg-crit-soft" : "";
  const panel = (
    <div id={`${id}-body`} role="region" aria-labelledby={`${id}-t`} className="ol-card ol-glow ol-hud animate-rise">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-display text-[17px] font-semibold text-fg">
            <Icon className="size-4 shrink-0 stroke-[1.75] text-accent" aria-hidden />
            {title}
          </p>
          {description && <p className="mt-1 max-w-2xl text-xs leading-relaxed text-fg-muted">{description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          <Button size="sm" variant="ghost" onClick={() => toggle(id)} aria-label={`Fechar ${title}`}>
            <X /> Fechar
          </Button>
        </div>
      </div>
      <div className="ol-ruler mx-4 mt-3 opacity-60" aria-hidden />
      <div className="px-4 pb-5 pt-4">{children}</div>
    </div>
  );

  return (
    <section
      ref={ref}
      id={id}
      aria-labelledby={`${id}-t`}
      className={cn("ol-card scroll-mt-36 lg:scroll-mt-24", tone, isOpen ? "border-accent-2/70 shadow-[inset_0_-2px_0_0_var(--accent)]" : "hover:border-border-strong")}
    >
      <h3 id={`${id}-t`} className="m-0">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={`${id}-body`}
          onClick={() => toggle(id)}
          className="group flex h-full w-full flex-col gap-3 rounded-[inherit] px-4 py-4 text-left"
        >
          <span className="flex w-full items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2 font-display text-sm font-semibold text-fg">
              <Icon className={cn("size-4 shrink-0 stroke-[1.75]", state === "off" ? "text-fg-subtle" : "text-accent")} aria-hidden />
              <span className="truncate">{title}</span>
            </span>
            <span className="flex items-center gap-3">
              <StateTag state={state} label={stateLabel} />
              <ChevronDown className={cn("size-4 shrink-0 text-fg-subtle transition-transform duration-200 group-hover:text-fg", isOpen && "rotate-180 text-accent")} aria-hidden />
            </span>
          </span>
          {/* Aberto, o painel abaixo já mostra tudo: o cartão fica só com nome, luz e seta, sem repetir o valor. */}
          <span className={cn("block min-w-0", isOpen && "hidden")}>
            <span className={cn("block truncate font-display text-[19px] font-medium leading-tight", state === "warn" ? "text-warn" : state === "crit" ? "text-crit" : state === "off" ? "text-fg-muted" : "text-fg")}>{value}</span>
            {detail && <span className="mt-1.5 block truncate text-xs text-fg-muted">{detail}</span>}
          </span>
        </button>
      </h3>
      {/* Sem vaga (fora de um RackGroup), o painel abre dentro do próprio cartão. */}
      {isOpen && (!slotId ? panel : slot?.id === slotId && slot.isConnected ? createPortal(panel, slot) : null)}
    </section>
  );
}

/** Linha somente leitura: rótulo, variável de ambiente que a define e o valor efetivo. */
export function Row({ label, env, showEnv = false, value }: { label: string; env?: string; showEnv?: boolean; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/60 py-2.5 last:border-b-0">
      {/* A variável de ambiente fica escondida (só aparece ao passar o mouse), exceto nos blocos de detalhes técnicos. */}
      <dt className="min-w-0 text-sm text-fg-muted" title={env && !showEnv ? `Variável: ${env}` : undefined}>
        {label}
        {env && showEnv && <span className="mt-0.5 block break-all font-mono text-[11px] text-fg-subtle">{env}</span>}
      </dt>
      <dd className="tabular max-w-[55%] break-words text-right text-sm text-fg">{value}</dd>
    </div>
  );
}

export function ManageLink({ slug, children }: { slug: string; children: ReactNode }) {
  const base = useBasePath();
  return (
    <Link href={hrefOf(base, slug)} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-accent-2/40 bg-accent-soft px-2.5 py-1.5 text-xs font-medium text-accent transition-colors hover:border-accent">
      {children} <ArrowRight className="size-3.5" aria-hidden />
    </Link>
  );
}
