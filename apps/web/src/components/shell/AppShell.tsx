"use client";

import type { AgentInfo, StatusResponse } from "@orbitlink/shared";
import { Bell, LogOut, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { useAgent, useAgentStream } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useBasePath, useDemo } from "@/lib/demo-context";
import { fmtAgo } from "@/lib/format";
import { DemoBanner, StatePill } from "../domain";
import { Badge, Button, Tip } from "../ui/primitives";
import { NAV } from "./nav";

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <defs>
        <linearGradient id="ol-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#60a5fa" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="5.5" fill="url(#ol-g)" />
      <ellipse cx="16" cy="16" rx="13" ry="6" fill="none" stroke="url(#ol-g)" strokeWidth="1.6" transform="rotate(-28 16 16)" opacity="0.9" />
      <circle cx="26.2" cy="9.6" r="1.8" fill="#e8eef7" />
    </svg>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const base = useBasePath();
  const groups = Array.from(new Set(NAV.map((n) => n.group)));
  return (
    <nav aria-label="Navegação principal" className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-4 pb-5 pt-4">
        <Logo className="size-8" />
        <div className="leading-tight">
          <p className="text-[15px] font-semibold tracking-tight">OrbitLink AI</p>
          <p className="text-[10.5px] uppercase tracking-[0.16em] text-fg-subtle">Operation Center</p>
        </div>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto px-2.5 pb-4">
        {groups.map((g) => (
          <div key={g}>
            <p className="px-2 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">{g}</p>
            <ul className="space-y-0.5">
              {NAV.filter((n) => n.group === g).map((n) => {
                const href = `${base}${n.href === "/" ? "" : n.href}` || "/";
                const active = n.href === "/" ? pathname === (base || "/") : pathname.startsWith(href);
                const Icon = n.icon;
                return (
                  <li key={n.href}>
                    <Link
                      href={href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors",
                        active
                          ? "bg-accent-soft text-fg shadow-[inset_2px_0_0_0_var(--accent)]"
                          : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                      )}
                    >
                      <Icon className={cn("size-4 shrink-0", active ? "text-accent" : "text-fg-subtle group-hover:text-fg-muted")} />
                      <span className="truncate">{n.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <p className="border-t border-border px-4 py-3 text-[10.5px] leading-snug text-fg-subtle">
        Projeto independente. Sem afiliação com a Starlink/SpaceX.
      </p>
    </nav>
  );
}

function AgentIndicator() {
  const demo = useDemo();
  const { data: agent, error } = useAgent<AgentInfo>("agent", { refetchInterval: 30_000 });
  const stream = useAgentStream();
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 5000);
    return () => clearInterval(id);
  }, []);
  if (error) {
    return (
      <Badge tone="crit" className="gap-1.5">
        <span className="size-1.5 rounded-full bg-crit" /> Agente offline
      </Badge>
    );
  }
  const live = stream === "open" || demo;
  return (
    <Tip
      content={
        <div className="space-y-1">
          <p>Agente {agent?.version ?? "…"} · modo {agent?.mode ?? "…"}</p>
          <p>Última amostra: {fmtAgo(agent?.last_status_ts)}</p>
          <p>Stream: {stream}</p>
          {agent?.sync_pending ? <p>Sincronização pendente: {agent.sync_pending} registros</p> : null}
        </div>
      }
    >
      <span tabIndex={0} className="inline-flex">
        <Badge tone={live ? "ok" : stream === "reconnecting" ? "warn" : "neutral"} className="gap-1.5">
          <span className={cn("size-1.5 rounded-full", live ? "bg-ok animate-pulse-dot" : "bg-warn")} />
          {live ? "Agente ao vivo" : stream === "reconnecting" ? "Reconectando…" : "Conectando…"}
          <span className="hidden text-fg-subtle sm:inline">· {fmtAgo(agent?.last_status_ts)}</span>
        </Badge>
      </span>
    </Tip>
  );
}

function DishIndicator() {
  const { data } = useAgent<StatusResponse>("status", { refetchInterval: 15_000 });
  if (!data) return null;
  if (!data.available) return <StatePill state={data.dish_reachable === false ? "inalcancavel" : "desconhecida"} />;
  return <StatePill state={data.stale ? "desconhecida" : data.status.state} />;
}

function AlertBell() {
  const base = useBasePath();
  const { data } = useAgent<{ events: { status: string }[] }>("alerts/events?status=active", { refetchInterval: 30_000 });
  const n = data?.events?.length ?? 0;
  return (
    <Link href={`${base}/alertas`} aria-label={`Alertas ativos: ${n}`} className="relative rounded-lg p-2 text-fg-muted hover:bg-surface-2 hover:text-fg">
      <Bell className="size-4" />
      {n > 0 && (
        <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-crit px-1 text-[10px] font-bold text-[#1a0505]">
          {n}
        </span>
      )}
    </Link>
  );
}

async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/login";
}

export function AppShell({ children }: { children: ReactNode }) {
  const demo = useDemo();
  const [open, setOpen] = useState(false);
  const { data: agent } = useAgent<AgentInfo>("agent", { refetchInterval: 30_000 });
  return (
    <div className="min-h-dvh">
      {demo && <DemoBanner />}
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-black">
        Pular para o conteúdo
      </a>
      <div className="flex">
        <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r border-border bg-bg-elev/70 backdrop-blur lg:block">
          <Sidebar />
        </aside>
        {open && (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
            <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
            <aside className="absolute inset-y-0 left-0 w-72 border-r border-border bg-bg-elev">
              <button className="absolute right-3 top-4 rounded-md p-1.5 text-fg-muted hover:bg-surface-2" onClick={() => setOpen(false)} aria-label="Fechar menu">
                <X className="size-4" />
              </button>
              <Sidebar onNavigate={() => setOpen(false)} />
            </aside>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-bg/80 px-4 backdrop-blur-md lg:px-6">
            <button className="rounded-md p-1.5 text-fg-muted hover:bg-surface-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menu">
              <Menu className="size-5" />
            </button>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{agent?.terminal_name ?? "Starlink Mini"}</p>
              <p className="truncate text-[11px] text-fg-subtle">
                {agent?.firmware ? `Firmware ${agent.firmware}` : "Firmware não identificado"}
                {agent?.mode === "fixture" && !demo ? " · MODO FIXTURE" : ""}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className="hidden md:inline-flex">
                <DishIndicator />
              </span>
              <AgentIndicator />
              <AlertBell />
              {!demo ? (
                <Button variant="ghost" size="icon" onClick={logout} aria-label="Sair">
                  <LogOut />
                </Button>
              ) : (
                <Link href="/login" className="text-xs text-fg-muted underline-offset-4 hover:underline">
                  Sair da demonstração
                </Link>
              )}
            </div>
          </header>
          <main id="conteudo" className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-6 lg:px-6">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
