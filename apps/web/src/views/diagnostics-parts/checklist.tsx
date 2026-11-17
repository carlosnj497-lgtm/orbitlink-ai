"use client";

import { ChevronDown, CircleCheck, CircleDashed, CircleMinus, CircleX, Info, type LucideIcon, TriangleAlert } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * Idioma "checklist com veredito" das ferramentas (Diagnósticos, Teste de conexão, Relatórios, Central de IA).
 * Verde, amarelo e vermelho só carregam estado; "pulado" e "não verificado" ficam em cinza, com forma diferente.
 */
export type CheckState = "ok" | "warn" | "crit" | "off" | "info" | "pending";

export const CHECK_WORD: Record<CheckState, string> = {
  ok: "passou",
  warn: "atenção",
  crit: "falhou",
  off: "pulado",
  info: "informativo",
  pending: "não verificado",
};

const ICON: Record<CheckState, LucideIcon> = {
  ok: CircleCheck,
  warn: TriangleAlert,
  crit: CircleX,
  off: CircleMinus,
  info: Info,
  pending: CircleDashed,
};

export const STATE_TEXT: Record<CheckState, string> = {
  ok: "text-ok",
  warn: "text-warn",
  crit: "text-crit",
  off: "text-fg-subtle",
  info: "text-fg-muted",
  pending: "text-fg-subtle",
};

const DOT: Record<CheckState, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  crit: "bg-crit",
  off: "border border-fg-subtle",
  info: "bg-fg-muted",
  pending: "border border-dashed border-fg-subtle",
};

/** Ícone de estado (a forma muda junto com a cor, para quem não distingue as cores). */
export function StateIcon({ state, className }: { state: CheckState; className?: string }) {
  const Icon = ICON[state];
  return <Icon className={cn("size-[18px] shrink-0 stroke-[1.75]", STATE_TEXT[state], className)} aria-hidden />;
}

/** Luz pequena de estado, para contagens e listas compactas. */
export function StateDot({ state, className }: { state: CheckState; className?: string }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", DOT[state], className)} aria-hidden />;
}

/** Contagem por estado: "● 3 passaram  ● 1 atenção". Estados zerados somem, exceto os marcados em `always`. */
export function StateCounts({ items, className }: { items: { state: CheckState; n: number; word: string; always?: boolean }[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-fg-muted", className)} aria-label="Contagem por estado">
      {items
        .filter((i) => i.n > 0 || i.always)
        .map((i) => (
          <li key={i.word} className="inline-flex items-center gap-1.5">
            <StateDot state={i.n > 0 ? i.state : "off"} />
            <span className="tabular text-sm text-fg">{i.n}</span> {i.word}
          </li>
        ))}
    </ul>
  );
}

/**
 * Painel em foco do topo: o veredito numa frase, a contagem por estado e, opcionalmente, a ação principal.
 * Só um por tela (ol-glow + retícula).
 */
export function VerdictPanel({
  state,
  sentence,
  children,
  counts,
  meta,
  actions,
  className,
}: {
  state: CheckState | "loading";
  sentence: ReactNode;
  children?: ReactNode;
  counts?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section aria-label="Veredito" className={cn("ol-card ol-glow ol-hud mb-6 px-4 py-4 sm:px-5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-[min(100%,18rem)] max-w-3xl flex-1 items-start gap-3">
          {state === "loading" ? <span className="skeleton mt-1 size-[22px] shrink-0 rounded-full" aria-hidden /> : <StateIcon state={state} className="mt-[3px] size-[22px]" />}
          <div className="min-w-0">
            <h2 className="text-balance font-display text-[19px] font-semibold leading-snug text-fg">{sentence}</h2>
            {children && <div className="mt-1.5 text-sm leading-relaxed text-fg-muted">{children}</div>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {(counts || meta) && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-border pt-3 pl-[34px]">
          {counts}
          {meta && <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg-subtle">{meta}</div>}
        </div>
      )}
    </section>
  );
}

/** Grupo de itens com título; a lista fica num único painel com fio entre os itens. */
export function Checklist({ title, description, aside, children, className }: { title: string; description?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn("mb-6", className)}>
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h2 id={id} className="font-display text-[17px] font-semibold text-fg">
            {title}
          </h2>
          {description && <p className="text-xs text-fg-subtle">{description}</p>}
        </div>
        {aside}
      </div>
      <ul className="ol-card divide-y divide-border overflow-hidden">{children}</ul>
    </section>
  );
}

/**
 * Item do checklist: luz de estado, título simples, uma linha de resumo e, ao expandir no lugar,
 * detalhes, evidência e o que fazer. As ações (baixar, enviar) ficam fora do botão de expandir.
 */
export function ChecklistItem({
  state,
  stateLabel,
  title,
  summary,
  tags,
  actions,
  actionsClassName,
  children,
  defaultOpen = false,
}: {
  state: CheckState;
  stateLabel?: string;
  title: ReactNode;
  summary?: ReactNode;
  tags?: ReactNode;
  actions?: ReactNode;
  /** Largura fixa da coluna de ações, para alinhar o estado entre itens com ações diferentes. */
  actionsClassName?: string;
  children?: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const expandable = !!children;
  const word = stateLabel ?? CHECK_WORD[state];
  const tint = state === "crit" ? "bg-crit-soft" : state === "warn" ? "bg-warn-soft" : "";

  const head = (
    <>
      <StateIcon state={state} className="mt-px" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn("text-sm font-medium", state === "off" || state === "pending" ? "text-fg-muted" : "text-fg")}>{title}</span>
          {tags}
          <span className={cn("text-xs sm:hidden", STATE_TEXT[state])} aria-hidden>
            {word}
          </span>
        </span>
        {summary && <span className="mt-0.5 block text-xs leading-relaxed text-fg-muted">{summary}</span>}
      </span>
      <span className={cn("mt-px flex shrink-0 items-center gap-2 text-xs", STATE_TEXT[state])}>
        <span className="max-sm:sr-only">
          <span className="sr-only">Estado: </span>
          {word}
        </span>
        {expandable && <ChevronDown className={cn("size-4 text-fg-subtle transition-transform duration-200 group-hover:text-fg", open && "rotate-180 text-accent")} aria-hidden />}
      </span>
    </>
  );

  return (
    <li className={cn("transition-colors", tint, open && !tint && "bg-bg-elev/50")}>
      <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-3">
        {expandable ? (
          <h3 className="m-0 min-w-0 flex-1">
            <button type="button" aria-expanded={open} aria-controls={`${id}-d`} onClick={() => setOpen((v) => !v)} className="group -m-1 flex w-[calc(100%+0.5rem)] items-start gap-3 rounded-md p-1 text-left font-sans tracking-normal">
              {head}
            </button>
          </h3>
        ) : (
          <div className="flex min-w-0 flex-1 items-start gap-3">{head}</div>
        )}
        {actions && <div className={cn("flex shrink-0 flex-wrap items-center gap-2 pl-[30px] sm:justify-end sm:pl-0", actionsClassName)}>{actions}</div>}
      </div>
      {expandable && open && (
        <div id={`${id}-d`} className="animate-rise px-4 pb-4 pl-[46px]">
          {children}
        </div>
      )}
    </li>
  );
}

/** Corpo expandido: pares rótulo/valor ("O que é", "Evidência", "O que fazer"). */
export function CheckDetails({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-5 gap-y-2.5 border-t border-border/70 pt-3 text-sm sm:grid-cols-[9rem_minmax(0,1fr)]">
      {rows
        .filter((r) => r.value !== null && r.value !== undefined && r.value !== false && r.value !== "")
        .map((r) => (
          <div key={r.label} className="contents">
            <dt className="text-xs text-fg-subtle sm:pt-px">{r.label}</dt>
            <dd className="min-w-0 max-w-[68ch] leading-relaxed text-fg-muted">{r.value}</dd>
          </div>
        ))}
    </dl>
  );
}
