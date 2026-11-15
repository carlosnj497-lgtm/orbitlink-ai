"use client";

import type { AgentInfo } from "@astryon/shared";
import { useIsMutating, useQuery } from "@tanstack/react-query";
import { Bell, CircleUserRound, LogOut, Menu, Settings, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DropdownMenu, Popover } from "radix-ui";
import { useAgent, useAgentStream } from "@/lib/api";
import { CLOUD } from "@/lib/cloud-flag";
import { cn } from "@/lib/cn";
import { useBasePath, useDemo } from "@/lib/demo-context";
import { fmtAgo, fmtTime } from "@/lib/format";
import { reloadTo } from "@/lib/navigation";
import { useNow } from "@/lib/use-now";
import { TAGLINES, TITLES } from "@/views/slugs";
import { Badge, Tip } from "../ui/primitives";
import { Wordmark } from "./Wordmark";
import { hrefOf, slugOf } from "./nav";

interface ActiveAlert {
  id: number;
  rule_name: string;
  severity: string;
  started_at: number;
  message: string;
}

/** Estado REAL do agente local: offline (consulta falhou), ao vivo (SSE aberto), reconectando ou conectando. */
function AgentChip() {
  const demo = useDemo();
  const { data: agent, error } = useAgent<AgentInfo>("agent", { refetchInterval: 30_000 });
  const stream = useAgentStream();
  const every = agent?.intervals?.status_s;
  const s = demo
    ? { tone: "demo" as const, dot: "bg-demo", label: "Demonstração", short: "Demo" }
    : CLOUD
      ? error
        ? { tone: "crit" as const, dot: "bg-crit", label: "Nuvem indisponível", short: "Erro" }
        : agent && !agent.status_stale
          ? { tone: "ok" as const, dot: "bg-ok", label: "Sincronizado", short: "Sinc." }
          : { tone: "warn" as const, dot: "bg-warn", label: "Sem dados recentes", short: "Atraso" }
    : error
      ? { tone: "crit" as const, dot: "bg-crit", label: "Agente offline", short: "Offline" }
      : stream === "open"
        ? { tone: "ok" as const, dot: "bg-ok ol-live text-ok", label: "Agente online", short: "Online" }
        : stream === "reconnecting" || stream === "closed"
          ? { tone: "warn" as const, dot: "bg-warn animate-pulse-dot", label: "Reconectando…", short: "Reconect." }
          : { tone: "neutral" as const, dot: "bg-fg-subtle", label: "Conectando…", short: "Conect." };
  return (
    <Tip
      content={
        <div className="space-y-1">
          <p>Agente {agent?.version ?? "…"} · modo {agent?.mode ?? "…"}</p>
          <p>
            Última coleta: <span className="tabular">{agent?.last_status_ts ? fmtTime(agent.last_status_ts) : "—"}</span> ({fmtAgo(agent?.last_status_ts)})
          </p>
          <p>Intervalo de coleta: {every ? `${every} s` : "—"}</p>
          <p>
            Canal em tempo real (SSE): {stream}
            {stream === "open" ? " — cada leitura nova chega sem recarregar." : " — o painel consulta o agente periodicamente."}
          </p>
          {agent?.sync_pending ? <p>Sincronização pendente: {agent.sync_pending} registros</p> : null}
        </div>
      }
    >
      <span tabIndex={0} className="inline-flex shrink-0 rounded-[3px]">
        <Badge tone={s.tone} className="h-7 gap-2 px-2.5">
          <span className={cn("size-1.5 rounded-full", s.dot)} aria-hidden />
          <span className="sr-only">{s.label}</span>
          <span className="hidden sm:inline" aria-hidden>
            {s.label}
          </span>
          <span className="max-[339px]:hidden sm:hidden" aria-hidden>
            {s.short}
          </span>
        </Badge>
      </span>
    </Tip>
  );
}

/**
 * Atividade da Central de IA. "Processando" só aparece enquanto uma pergunta está de fato em andamento
 * (mutação "ai/ask" do React Query); "pronta" só quando o agente informa a chave da Groq configurada.
 */
function AiChip() {
  const base = useBasePath();
  const demo = useDemo();
  const { data: agent, error } = useAgent<AgentInfo>("agent", { refetchInterval: 30_000 });
  const busy = useIsMutating({ mutationKey: ["ai", "ask"] }) > 0;
  const s = busy
    ? { label: "IA processando", cls: "border-accent-2/60 text-accent", dot: "bg-accent animate-pulse-dot", tip: "A Central de IA está consultando os dados do agente para responder." }
    : error || !agent
      ? { label: "IA", cls: "border-border-strong text-fg-subtle", dot: "bg-fg-subtle", tip: "Estado da IA indisponível enquanto o agente não responde." }
      : agent.ai_configured
        ? { label: "IA pronta", cls: "border-accent-2/40 text-fg-muted", dot: "bg-accent", tip: "Assistente via Groq configurado. Ferramentas somente leitura; ações só com sua confirmação." }
        : { label: "IA por regras", cls: "border-border-strong text-fg-muted", dot: "bg-fg-subtle", tip: "Sem chave da Groq: a Central de IA responde com o diagnóstico por regras." };
  return (
    <Tip content={demo ? "Na demonstração a Central de IA não envia perguntas." : s.tip}>
      <Link
        href={hrefOf(base, "assistente")}
        aria-label={s.label}
        className={cn(
          "relative inline-flex h-7 shrink-0 items-center gap-2 overflow-hidden rounded-[3px] border bg-surface px-2 font-mono max-sm:hidden text-[10px] font-medium uppercase tracking-[0.08em] transition-colors hover:border-accent-2 hover:text-fg sm:px-2.5",
          s.cls,
          busy && "ol-scan",
        )}
      >
        <Sparkles className="size-3.5 stroke-[1.75]" aria-hidden />
        <span className="hidden sm:inline" aria-hidden>
          {s.label}
        </span>
        <span className={cn("size-1.5 rounded-full", s.dot)} aria-hidden />
      </Link>
    </Tip>
  );
}

const DOW = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"];
const MON = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
const two = (n: number) => String(n).padStart(2, "0");

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

/**
 * Dígito em "rolo", como o placar das transmissões de lançamento: a coluna 0–9 desliza até o número atual.
 * Só transform (barato no Celeron); com prefers-reduced-motion a transição global vira instantânea.
 */
function RollingDigit({ ch }: { ch: string }) {
  const n = DIGITS.indexOf(ch);
  if (n < 0) return <span className="inline-block h-[1.15em] w-[0.42em] text-center align-bottom leading-[1.15em] text-fg-subtle">{ch}</span>;
  return (
    <span className="relative inline-block h-[1.15em] w-[0.62em] overflow-hidden align-bottom">
      <span className="absolute inset-x-0 top-0 flex flex-col transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]" style={{ transform: `translateY(-${n * 1.15}em)` }}>
        {DIGITS.map((d) => (
          <span key={d} className="block h-[1.15em] text-center leading-[1.15em]">
            {d}
          </span>
        ))}
      </span>
    </span>
  );
}

function RollingTime({ value, className }: { value: string; className?: string }) {
  return (
    <span className={cn("tabular inline-flex leading-[1.15em]", className)} aria-hidden>
      {value.split("").map((ch, i) => (
        <RollingDigit key={i} ch={ch} />
      ))}
    </span>
  );
}

/** Hora em 12 h (01–12) com AM/PM. */
function h12(h: number): { hh: string; ap: "AM" | "PM" } {
  return { hh: two(h % 12 === 0 ? 12 : h % 12), ap: h < 12 ? "AM" : "PM" };
}

/** Relógio de missão em 12 h: hora local com segundos em dígitos rolantes, AM/PM e UTC, atualizado a cada segundo (só no cliente). */
function MissionClock() {
  const now = useNow(1000);
  const d = now === null ? null : new Date(now * 1000);
  const loc = d ? h12(d.getHours()) : null;
  const u = d ? h12(d.getUTCHours()) : null;
  const local = d && loc ? `${loc.hh}:${two(d.getMinutes())}:${two(d.getSeconds())}` : "--:--:--";
  const utc = d && u ? `${u.hh}:${two(d.getUTCMinutes())} ${u.ap}` : "--:--";
  const date = d ? `${DOW[d.getDay()]} ${two(d.getDate())} ${MON[d.getMonth()]}` : "";
  const ap = loc?.ap ?? "--";
  return (
    <div className="flex shrink-0 items-center gap-3 md:border-r md:border-border md:pr-3" aria-label={d ? `Hora local ${local} ${ap}, UTC ${utc}` : "Relógio"} role="timer">
      {/* celular: só HH:MM e AM/PM, para caber ao lado do letreiro */}
      <span className="flex items-baseline gap-1 md:hidden" aria-hidden>
        <RollingTime value={local.slice(0, 5)} className="text-[13px] font-medium text-fg" />
        <span className="font-mono text-[9px] font-semibold text-accent">{ap}</span>
      </span>
      <div className="hidden text-right leading-none md:block">
        <p className="flex items-center justify-end gap-2">
          <RollingTime value={local} className="text-[17px] font-medium text-fg" />
          <span className="w-[2.1em] rounded-[3px] border border-accent-2/40 text-center font-mono text-[9px] font-semibold tracking-[0.08em] text-accent" aria-hidden>
            {ap}
          </span>
        </p>
        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-subtle" aria-hidden>
          {date} · UTC {utc}
        </p>
      </div>
    </div>
  );
}

const SEV_DOT: Record<string, string> = { crit: "bg-crit", warn: "bg-warn", info: "bg-accent" };

function Notifications() {
  const base = useBasePath();
  const { data } = useAgent<{ events: ActiveAlert[] }>("alerts/events?status=active", { refetchInterval: 30_000 });
  const events = data?.events ?? [];
  const n = events.length;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" aria-label={`Alertas ativos: ${n}`} className="relative grid size-9 shrink-0 place-items-center rounded-md border border-border bg-surface text-fg-muted transition-colors hover:border-accent-2/60 hover:text-fg">
          <Bell className="size-4 stroke-[1.75]" />
          {n > 0 && (
            <span className="tabular absolute -right-1.5 -top-1.5 grid min-w-[18px] place-items-center rounded-[3px] bg-crit px-1 text-[10px] font-bold leading-[18px] text-black ring-2 ring-bg">
              {n}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="ol-card animate-pop-in z-50 w-[min(22rem,calc(100vw-1.5rem))] p-0 shadow-2xl focus:outline-none">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="font-display text-sm font-semibold">Notificações</p>
            <Badge tone={n ? "crit" : "ok"}>{n ? `${n} ativo${n > 1 ? "s" : ""}` : "tudo em ordem"}</Badge>
          </div>
          {n === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-fg-muted">Nenhum alerta ativo no momento.</p>
          ) : (
            <ul className="max-h-72 divide-y divide-border overflow-y-auto">
              {events.slice(0, 8).map((e) => (
                <li key={e.id} className="flex items-start gap-2.5 px-4 py-2.5">
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", SEV_DOT[e.severity] ?? "bg-fg-subtle")} aria-hidden />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-fg">{e.rule_name}</p>
                    <p className="line-clamp-2 text-xs text-fg-muted">{e.message}</p>
                    <p className="tabular mt-0.5 text-[11px] text-fg-subtle">{fmtAgo(e.started_at)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Popover.Close asChild>
            <Link href={hrefOf(base, "alertas")} className="block border-t border-border px-4 py-2.5 text-center text-xs font-medium text-accent hover:bg-surface-2/60">
              Abrir alertas e automações
            </Link>
          </Popover.Close>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

async function logout() {
  // Mesmo sem resposta (rede, agente parado) a tela de login é aberta; a sessão expira sozinha no agente.
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
  reloadTo("/login");
}

const ITEM = "flex cursor-pointer items-center gap-2.5 rounded-[4px] px-2.5 py-2 text-sm text-fg-muted outline-none data-[highlighted]:bg-surface-2 data-[highlighted]:text-fg [&>svg]:size-4";

function UserMenu() {
  const demo = useDemo();
  const base = useBasePath();
  const { data: me } = useQuery<{ username: string; role: string } | null>({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      const r = await fetch("/api/auth/me");
      return r.ok ? r.json() : null;
    },
    enabled: !demo,
    staleTime: 300_000,
  });
  const name = demo ? "Visitante" : (me?.username ?? "Usuário");
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" aria-label="Menu do usuário" className="grid size-9 shrink-0 place-items-center rounded-md border border-accent-2/60 bg-accent-deep font-mono text-sm font-semibold uppercase text-white transition-[border-color,box-shadow] hover:border-accent hover:shadow-[0_0_16px_-4px_rgb(0_140_255/0.8)]">
          {me?.username ? me.username[0] : <CircleUserRound className="size-5" />}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={8} className="ol-card animate-pop-in z-50 w-56 p-1.5 shadow-2xl">
          <div className="px-2.5 pb-2 pt-1.5">
            <p className="truncate text-sm font-semibold text-fg">{name}</p>
            <p className="text-xs text-fg-subtle">{demo ? "Modo demonstração" : me?.role === "admin" ? "Administrador local" : (me?.role ?? "Sessão local")}</p>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item asChild className={ITEM}>
            <Link href={hrefOf(base, "configuracoes")}>
              <Settings /> Configurações
            </Link>
          </DropdownMenu.Item>
          {demo ? (
            <DropdownMenu.Item asChild className={ITEM}>
              <Link href="/login">
                <LogOut /> Sair da demonstração
              </Link>
            </DropdownMenu.Item>
          ) : (
            <DropdownMenu.Item className={ITEM} onSelect={() => void logout()}>
              <LogOut /> Sair
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function Header({ onOpenMenu, menuOpen }: { onOpenMenu: () => void; menuOpen: boolean }) {
  const base = useBasePath();
  const slug = slugOf(usePathname(), base);
  return (
    <header className="sticky top-[var(--banner-h)] z-20 flex h-16 items-center gap-2 border-b border-border bg-black/90 px-4 backdrop-blur-md sm:gap-3 lg:px-6">
      <button type="button" className="-ml-2 grid size-10 shrink-0 place-items-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg lg:hidden" onClick={onOpenMenu} aria-label="Abrir menu" aria-expanded={menuOpen}>
        <Menu className="size-5" />
      </button>
      <Link href={hrefOf(base, "")} aria-label="ASTRYON — ir para o Dashboard" className="flex shrink-0 items-center gap-2 lg:hidden">
        <Wordmark size="sm" />
      </Link>
      <div className="hidden min-w-0 lg:block">
        <h1 className="truncate text-[21px] font-semibold leading-tight text-fg">{TITLES[slug] ?? "ASTRYON"}</h1>
        <p className="truncate text-[13px] text-fg-muted">{TAGLINES[slug] ?? ""}</p>
      </div>
      <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2.5">
        <MissionClock />
        <AgentChip />
        {!CLOUD && <AiChip />}
        <span aria-hidden className="mx-0.5 hidden h-6 w-px bg-border sm:block" />
        <Notifications />
        <UserMenu />
      </div>
    </header>
  );
}
