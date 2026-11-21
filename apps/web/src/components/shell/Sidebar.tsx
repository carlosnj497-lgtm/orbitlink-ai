"use client";

import type { AgentInfo, StatusResponse } from "@astryon/shared";
import { PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAgent, useStatusInterval } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fmtAgo, fmtFull } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { CLOUD } from "@/lib/cloud-flag";
import { useBasePath } from "@/lib/demo-context";
import { STATE_META, StatePill } from "../domain";
import { Tip } from "../ui/primitives";
import { AstryonMark, Wordmark } from "./Wordmark";
import { hrefOf, type NavSection, SECTIONS, sectionOf, slugOf } from "./nav";

function useDishState() {
  const { data: status } = useAgent<StatusResponse>("status", { refetchInterval: useStatusInterval(15_000) });
  if (!status) return null;
  if (!status.available) return status.dish_reachable === false ? "inalcancavel" : "desconhecida";
  return status.stale ? "desconhecida" : status.status.state;
}

/** Resumo da Starlink no rodapé da barra: sempre o estado real informado pelo agente. */
function DishCard({ collapsed }: { collapsed: boolean }) {
  const { data: agent } = useAgent<AgentInfo>("agent", { refetchInterval: 30_000 });
  const state = useDishState();
  const name = agent?.terminal_name ?? "Starlink Mini";
  if (collapsed) {
    const m = state ? STATE_META[state] : null;
    return (
      <Tip side="right" content={`${name}: ${m ? m.label : "carregando…"}`}>
        <div tabIndex={0} role="img" className="mx-auto mb-2 grid size-10 place-items-center rounded-md border border-white/10 bg-black/45 backdrop-blur-md" aria-label={`${name}: ${m ? m.label : "carregando"}`}>
          <span className={cn("size-2.5 rounded-full", m ? m.dot : "bg-fg-subtle", state === "conectada" && "ol-live text-ok")} />
        </div>
      </Tip>
    );
  }
  return (
    <div className="mx-3 mb-3 rounded-md border border-white/10 bg-black/45 px-3 py-2.5 backdrop-blur-md">
      <div className="flex items-center gap-2.5">
        <Image
          src="/dish-mini.webp"
          alt=""
          width={154}
          height={192}
          unoptimized
          preload
          className={cn("h-16 w-auto shrink-0 drop-shadow-[0_4px_10px_rgba(0,0,0,0.6)] transition-[filter,opacity]", state !== null && state !== "conectada" && state !== "degradada" && "opacity-55 saturate-50")}
        />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[13px] font-semibold text-fg" title={name}>
            {name}
          </p>
          <p className="mt-0.5 text-[11px] text-fg-subtle">
            Firmware: <span className="tabular [overflow-wrap:anywhere]">{agent?.firmware ?? "não informado"}</span>
          </p>
        </div>
      </div>
      {/* estado em linha própria: rótulos longos ("Antena inacessível") cabem sem estourar o cartão */}
      <div className="mt-2">{state ? <StatePill state={state} className="max-w-full whitespace-normal" /> : <span className="block h-5 w-24 animate-pulse rounded-[3px] bg-surface-3" />}</div>
    </div>
  );
}

/**
 * Idade do último dado da antena. A conta usa só o relógio do navegador (hora em que a resposta
 * chegou menos o `age_s` informado pelo agente), então diferença de relógio com o servidor não interfere.
 */
function LastReading() {
  const { data: status, dataUpdatedAt } = useAgent<StatusResponse>("status", { refetchInterval: useStatusInterval(15_000) });
  const now = useNow(1000);
  if (!status || now === null) return <span className="h-3 w-24 animate-pulse rounded-[3px] bg-surface-3" aria-hidden />;
  if (!status.available) return <p className="text-[11px] text-warn">Sem leitura da antena</p>;
  const readAt = dataUpdatedAt / 1000 - status.age_s;
  const ago = fmtAgo(readAt, now);
  return (
    <p className={cn("tabular text-[11px]", status.stale ? "text-warn" : "text-fg-subtle")} title={`Último dado recebido da antena: ${fmtFull(readAt)}`}>
      {ago === "agora" ? "Atualizado agora" : `Atualizado ${ago}`}
    </p>
  );
}

function NavLink({ section, active, badge, collapsed, onNavigate }: { section: NavSection; active: boolean; badge: number; collapsed: boolean; onNavigate?: () => void }) {
  const base = useBasePath();
  const Icon = section.icon;
  const link = (
    <Link
      href={hrefOf(base, section.pages[0].slug)}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? section.label : undefined}
      className={cn(
        "group relative flex h-10 items-center gap-3 rounded-md text-[13.5px] font-medium outline-offset-2 transition-[background-color,color] duration-150",
        collapsed ? "justify-center px-0" : "px-3",
        active
          ? "bg-[linear-gradient(90deg,rgb(0_140_255/0.24),rgb(0_140_255/0.05)_75%)] text-white shadow-[inset_0_0_0_1px_rgb(0_140_255/0.35),0_0_22px_-6px_rgb(0_140_255/0.65)] backdrop-blur-[2px]"
          : "text-fg-muted hover:bg-white/[0.06] hover:text-fg",
      )}
    >
      {/* trilho luminoso do item ativo */}
      <span
        aria-hidden
        className={cn(
          "absolute -left-3 top-1/2 h-6 w-[2px] -translate-y-1/2 rounded-full bg-accent shadow-[0_0_10px_1px_rgb(56_189_248/0.7)] transition-[opacity,transform] duration-200",
          active ? "opacity-100" : "scale-y-0 opacity-0",
        )}
      />
      <Icon className={cn("size-[18px] shrink-0 stroke-[1.75]", active ? "text-accent" : "text-fg-subtle transition-colors group-hover:text-fg")} />
      {!collapsed && <span className="min-w-0 flex-1 truncate">{section.label}</span>}
      {badge > 0 &&
        (collapsed ? (
          <span aria-hidden className="absolute right-1.5 top-1.5 size-2 rounded-full bg-crit ring-2 ring-bg-elev" />
        ) : (
          <span className="tabular grid min-w-5 place-items-center rounded-[3px] bg-crit px-1.5 text-[10.5px] font-bold leading-5 text-black">
            {badge}
            <span className="sr-only"> alertas ativos</span>
          </span>
        ))}
    </Link>
  );
  return collapsed ? (
    <Tip side="right" content={section.label}>
      {link}
    </Tip>
  ) : (
    link
  );
}

export function Sidebar({
  collapsed = false,
  onToggleCollapsed,
  onNavigate,
  onClose,
}: {
  collapsed?: boolean;
  /** Presente só no desktop (a barra recolhe para um trilho de ícones). */
  onToggleCollapsed?: () => void;
  onNavigate?: () => void;
  /** Presente só no menu móvel. */
  onClose?: () => void;
}) {
  const base = useBasePath();
  const current = sectionOf(slugOf(usePathname(), base));
  // Mesma chave do sino do cabeçalho: compartilha o cache, sem requisição extra.
  const { data: alerts } = useAgent<{ events: unknown[] }>(CLOUD ? null : "alerts/events?status=active", { refetchInterval: 30_000 });
  const activeAlerts = alerts?.events?.length ?? 0;

  return (
    <nav aria-label="Navegação principal" className="relative isolate flex h-full flex-col overflow-hidden">
      {/*
       * Fundo da barra: foguete, satélite e a Terra à noite (imagem do dono). "cover" preenche sem distorcer;
       * o recorte puxa para a direita (foguete) e para baixo (Terra) porque a barra é estreita e alta.
       * O véu preto é mais denso em cima, onde ficam o letreiro e os menus, e abre embaixo para a Terra aparecer.
       */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-20 bg-black bg-cover" style={{ backgroundImage: "url(/sidebar-bg.webp)", backgroundPosition: "86% 100%" }} />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgb(0_0_0/0.9)_0%,rgb(0_0_0/0.78)_40%,rgb(0_0_0/0.62)_70%,rgb(0_0_0/0.4)_88%,rgb(0_0_0/0.72)_100%)]"
      />
      {/* fio de luz na borda direita, como o limbo da atmosfera */}
      <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 -z-10 w-px bg-[linear-gradient(180deg,transparent,rgb(56_189_248/0.35)_55%,rgb(56_189_248/0.6)_85%,transparent)]" />
      <div className={cn("flex items-center gap-3 pb-4 pt-[max(1rem,env(safe-area-inset-top))]", collapsed ? "justify-center px-0" : "px-4")}>
        {collapsed ? (
          <AstryonMark className="size-10" />
        ) : (
          <div className="min-w-0 flex-1 pt-2 leading-tight">
            <Wordmark />
            <p className="ol-label mt-2 truncate !text-[9.5px] !tracking-[0.26em]">Starlink Mini · Monitor</p>
          </div>
        )}
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Fechar menu" className="grid size-10 place-items-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg">
            <X className="size-5" />
          </button>
        )}
      </div>

      <ul className="flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-3 pb-3">
        {SECTIONS.map((s) => (
          <li key={s.id}>
            <NavLink section={s} active={current?.id === s.id} badge={s.alerts ? activeAlerts : 0} collapsed={collapsed} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>

      <DishCard collapsed={collapsed} />

      <div className={cn("flex items-center border-t border-white/10 bg-black/55 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2", collapsed ? "justify-center px-0" : "justify-between gap-2 px-4")}>
        {!collapsed && <LastReading />}
        {onToggleCollapsed && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expandir barra lateral" : "Recolher barra lateral"}
            aria-pressed={collapsed}
            className="shrink-0 rounded-md p-2 text-fg-subtle hover:bg-surface-2 hover:text-fg"
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </button>
        )}
      </div>
    </nav>
  );
}
