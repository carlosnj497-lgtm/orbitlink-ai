"use client";

import type { AgentInfo } from "@astryon/shared";
import { useIsMutating } from "@tanstack/react-query";
import { House, Menu, SatelliteDish, ScrollText, Sparkles, Wifi } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type CSSProperties, type ReactNode, useCallback, useEffect, useState } from "react";
import { useAgent } from "@/lib/api";
import { cn } from "@/lib/cn";
import { CLOUD } from "@/lib/cloud-flag";
import { useBasePath, useDemo } from "@/lib/demo-context";
import { TimezoneSync, useDisplayTimezone } from "@/lib/timezone";
import { usePersistentFlag } from "@/lib/use-persistent-flag";
import { DemoBanner } from "../domain";
import { Header } from "./Header";
import { hrefOf, type NavSection, sectionOf, slugOf } from "./nav";
import { Sidebar } from "./Sidebar";

export { Logo } from "./Logo";

/** Menu lateral no celular/tablet: desliza da esquerda, fecha com Esc/toque fora e trava a rolagem do fundo. */
function MobileDrawer({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.documentElement.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
      <div className="animate-fade-in absolute inset-0 bg-black/65" onClick={onClose} />
      <aside className="animate-drawer-in absolute inset-y-0 left-0 w-[min(18rem,86vw)] border-r border-border bg-bg-elev shadow-2xl shadow-black">
        <Sidebar onNavigate={onClose} onClose={onClose} />
      </aside>
    </div>
  );
}

/** Abas das telas de uma mesma seção (ex.: Conexão e Internet → Ao vivo · Consumo · Qualidade). */
function SectionTabs({ section, slug }: { section: NavSection; slug: string }) {
  const base = useBasePath();
  return (
    <nav aria-label={`Telas de ${section.label}`} className="-mx-4 mb-4 overflow-x-auto border-b border-border px-4 lg:mx-0 lg:px-0">
      <ul className="flex w-max gap-1">
        {section.pages.map((p) => {
          const active = p.slug === slug;
          return (
            <li key={p.slug}>
              <Link
                href={hrefOf(base, p.slug)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative block whitespace-nowrap px-3.5 pb-2.5 pt-1.5 text-[13px] font-medium transition-colors",
                  "after:absolute after:inset-x-2 after:-bottom-px after:h-[2px] after:rounded-full after:transition-[opacity,transform] after:duration-200",
                  active
                    ? "text-white after:bg-accent after:shadow-[0_0_10px_rgb(56_189_248/0.7)]"
                    : "text-fg-muted after:scale-x-50 after:bg-border-strong after:opacity-0 hover:text-fg hover:after:scale-x-100 hover:after:opacity-100",
                )}
              >
                {p.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Navegação de polegar no celular: as quatro telas mais usadas e o menu completo. */
const TAB_ITEMS = [
  { slug: "", label: "Início", icon: House },
  { slug: "ao-vivo", label: "Ao vivo", icon: Wifi },
  { slug: "assistente", label: "IA", icon: Sparkles },
  // "o que aconteceu" primeiro; as regras e notificações ficam no menu completo (Alertas)
  { slug: "interrupcoes", label: "Eventos", icon: ScrollText },
] as const;

const CLOUD_TAB_ITEMS = [
  { slug: "", label: "Início", icon: House },
  { slug: "consumo", label: "Consumo", icon: Wifi },
  { slug: "antena", label: "Antena", icon: SatelliteDish },
  { slug: "interrupcoes", label: "Eventos", icon: ScrollText },
] as const;

export function MobileTabBar({ slug, onOpenMenu, menuOpen }: { slug: string; onOpenMenu: () => void; menuOpen: boolean }) {
  const base = useBasePath();
  const current = sectionOf(slug);
  // Mesmas chaves do cabeçalho: o estado da IA aparece aqui em telas estreitas, onde o chip some.
  const { data: agent } = useAgent<AgentInfo>(CLOUD ? null : "agent", { refetchInterval: 30_000 });
  const aiBusy = useIsMutating({ mutationKey: ["ai", "ask"] }) > 0;
  const item = "relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[10.5px] font-medium transition-colors";
  return (
    <nav aria-label="Navegação rápida" className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-black/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
      <ul className="flex">
        {(CLOUD ? CLOUD_TAB_ITEMS : TAB_ITEMS).map((t) => {
          const active = current?.id === sectionOf(t.slug)?.id;
          const Icon = t.icon;
          return (
            <li key={t.slug} className="flex flex-1">
              <Link href={hrefOf(base, t.slug)} aria-current={active ? "page" : undefined} className={cn(item, active ? "text-white" : "text-fg-subtle hover:text-fg")}>
                <span aria-hidden className={cn("absolute inset-x-5 top-0 h-[2px] rounded-full bg-accent shadow-[0_0_10px_rgb(56_189_248/0.7)] transition-opacity", active ? "opacity-100" : "opacity-0")} />
                <span className="relative">
                  <Icon className={cn("size-5 stroke-[1.75]", active && "text-accent")} aria-hidden />
                  {t.slug === "assistente" && agent && (
                    <span
                      aria-hidden
                      className={cn("absolute -right-1 -top-0.5 size-1.5 rounded-full", aiBusy ? "animate-pulse-dot bg-accent" : agent.ai_configured ? "bg-accent" : "bg-fg-subtle")}
                    />
                  )}
                </span>
                {t.label}
              </Link>
            </li>
          );
        })}
        <li className="flex flex-1">
          <button type="button" onClick={onOpenMenu} aria-expanded={menuOpen} className={cn(item, "text-fg-subtle hover:text-fg")}>
            <Menu className="size-5 stroke-[1.75]" aria-hidden />
            Menu
          </button>
        </li>
      </ul>
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const demo = useDemo();
  const base = useBasePath();
  const slug = slugOf(usePathname(), base);
  const section = sectionOf(slug);
  const [open, setOpen] = useState(false);
  const closeMenu = useCallback(() => setOpen(false), []);
  const [collapsed, setCollapsed] = usePersistentFlag("astryon:sidebar-collapsed");
  // Datas formatadas no fuso do agente: se ele for diferente do padrão, o conteúdo é remontado uma vez.
  const tz = useDisplayTimezone();

  return (
    // --banner-h: altura da faixa de demonstração, para a barra lateral e o cabeçalho fixos ficarem abaixo dela.
    <div className="min-h-dvh" style={{ "--banner-h": demo ? "1.75rem" : "0px" } as CSSProperties}>
      <TimezoneSync />
      {demo && <DemoBanner />}
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-black">
        Pular para o conteúdo
      </a>
      <div className="flex">
        <aside
          className={cn(
            "sticky top-[var(--banner-h)] hidden h-[calc(100dvh-var(--banner-h))] shrink-0 border-r border-border bg-bg-elev transition-[width] duration-200 ease-out lg:block",
            collapsed ? "w-[4.5rem]" : "w-64",
          )}
        >
          <Sidebar collapsed={collapsed} onToggleCollapsed={() => setCollapsed(!collapsed)} />
        </aside>
        {open && <MobileDrawer onClose={closeMenu} />}
        <div className="flex min-w-0 flex-1 flex-col">
          <Header onOpenMenu={() => setOpen(true)} menuOpen={open} />
          <main id="conteudo" className="mx-auto w-full max-w-[1800px] flex-1 px-4 pb-24 pt-5 lg:px-6 lg:pb-6">
            {section && section.pages.length > 1 && <SectionTabs section={section} slug={slug} />}
            <div key={`${slug}|${tz}`} className="animate-rise">
              {children}
            </div>
          </main>
        </div>
      </div>
      <MobileTabBar slug={slug} onOpenMenu={() => setOpen(true)} menuOpen={open} />
    </div>
  );
}
