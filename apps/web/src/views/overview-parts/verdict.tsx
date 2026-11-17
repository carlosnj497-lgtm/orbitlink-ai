"use client";

import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

/**
 * Painel de veredito: o painel em foco de cada tela do grupo Conexão. Responde à pergunta da tela numa frase com
 * os números, acende a luz de estado e lista 3–5 números-chave. Os gráficos da tela vêm abaixo, como evidência.
 *
 * Honestidade: quem monta a frase decide o tom; "unknown" é o tom de "não há dado suficiente" e nunca vira verde.
 */
export type VerdictTone = "ok" | "warn" | "crit" | "unknown";

const LAMP: Record<VerdictTone, { dot: string; text: string; word: string }> = {
  ok: { dot: "bg-ok", text: "text-ok", word: "ok" },
  warn: { dot: "bg-warn", text: "text-warn", word: "atenção" },
  crit: { dot: "bg-crit", text: "text-crit", word: "falha" },
  unknown: { dot: "border border-fg-subtle bg-transparent", text: "text-fg-muted", word: "sem dados" },
};

/** Número dentro da frase: mono tabular, em branco. */
export function N({ children }: { children: ReactNode }) {
  return <span className="tabular font-medium text-fg">{children}</span>;
}

export interface Figure {
  key: string;
  label: ReactNode;
  value: ReactNode;
  unit?: string;
  note?: ReactNode;
  tone?: "warn" | "crit";
}

/** Luz de estado: ponto colorido e a palavra (o estado nunca depende só da cor). */
export function Lamp({ tone, word, live = false, className }: { tone: VerdictTone; word?: string; live?: boolean; className?: string }) {
  const l = LAMP[tone];
  return (
    <p className={cn("flex shrink-0 items-center gap-2 text-sm font-medium", l.text, className)}>
      <span className={cn("size-2.5 rounded-full", l.dot, live && tone === "ok" && "ol-live text-ok")} aria-hidden />
      <span>
        <span className="sr-only">Estado: </span>
        {word ?? l.word}
      </span>
    </p>
  );
}

export function Verdict({
  label,
  tone,
  word,
  live,
  headline,
  detail,
  figures,
  strip,
  meta,
  loading = false,
  art,
  className,
  bodyClassName,
  children,
}: {
  /** Nome acessível do painel (a pergunta da tela). */
  label: string;
  tone: VerdictTone;
  /** Palavra da luz de estado; padrão: ok / atenção / falha / sem dados. */
  word?: string;
  /** Eco de radar na luz quando o estado é ao vivo e ok. */
  live?: boolean;
  headline: ReactNode;
  detail?: ReactNode;
  figures?: Figure[];
  /** Faixa de números própria da tela, no lugar de `figures` (ex.: leituras ao vivo com traço). */
  strip?: ReactNode;
  /** Rodapé do painel: origem do dado, cobertura, janela. */
  meta?: ReactNode;
  loading?: boolean;
  /** Arte de fundo opcional (só o Dashboard usa). */
  art?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
}) {
  return (
    <section aria-label={label} className={cn("ol-card ol-glow ol-hud relative isolate mb-4 overflow-hidden", className)}>
      {art}
      <div className={cn("relative px-4 pb-4 pt-4 sm:px-5 sm:pt-5", bodyClassName)}>
        {loading ? (
          <div aria-busy="true">
            <Skeleton className="h-7 w-[min(36rem,100%)]" />
            <Skeleton className="mt-2 h-7 w-[min(24rem,80%)]" />
            <Skeleton className="mt-3 h-4 w-[min(30rem,90%)]" />
          </div>
        ) : (
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
            <div className="min-w-0">
              <h2 className="max-w-[44ch] text-balance font-display text-[21px] font-semibold leading-[1.3] text-fg sm:text-[24px]">{headline}</h2>
              {detail && <div className="mt-2 max-w-[72ch] text-sm leading-relaxed text-fg-muted">{detail}</div>}
            </div>
            <Lamp tone={tone} word={word} live={live} className="sm:pt-1.5" />
          </div>
        )}
        {children}
      </div>
      {figures && figures.length > 0 && (
        <dl
          className={cn(
            "relative grid grid-cols-2 gap-px border-y border-border bg-border",
            figures.length === 3 && "sm:grid-cols-3",
            figures.length === 4 && "sm:grid-cols-4",
            figures.length >= 5 && "sm:grid-cols-3 xl:grid-cols-5",
            // Número ímpar no celular: o último ocupa a linha inteira (sem meia linha vazia).
            figures.length % 2 === 1 && "[&>div:last-child]:max-sm:col-span-2",
          )}
        >
          {figures.map((f) => (
            <div key={f.key} className="min-w-0 bg-surface px-4 py-3 sm:px-5">
              <dt className="text-xs text-fg-muted max-sm:line-clamp-2 sm:truncate">{f.label}</dt>
              <dd className="mt-1">
                {loading ? (
                  <Skeleton className="h-6 w-20" />
                ) : (
                  <span className={cn("tabular flex items-baseline gap-1 text-[21px] font-medium leading-none tracking-[-0.03em]", f.tone === "crit" ? "text-crit" : f.tone === "warn" ? "text-warn" : "text-fg")}>
                    {f.value}
                    {f.unit && <span className="text-xs font-medium tracking-normal text-fg-muted">{f.unit}</span>}
                  </span>
                )}
                {f.note && <span className="mt-1.5 block text-[11px] leading-snug text-fg-subtle">{f.note}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {strip}
      {meta && (
        <div className="relative px-4 pb-3 pt-2.5 sm:px-5">
          <div aria-hidden className="ol-ruler mb-2.5 opacity-60" />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-fg-subtle">{meta}</div>
        </div>
      )}
    </section>
  );
}

/** Título de seção das evidências ("por quê"): Space Grotesk, sem rótulo de abertura. */
export function EvidenceHeading({ id, title, note }: { id: string; title: string; note?: ReactNode }) {
  return (
    <div className="mb-3 mt-8 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
      <h2 id={id} className="font-display text-[17px] font-semibold text-fg">
        {title}
      </h2>
      {note && <p className="text-xs text-fg-subtle">{note}</p>}
    </div>
  );
}
