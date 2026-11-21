"use client";

import type { AgentInfo, Capability, CapStatus, Source, StatusResponse, Telemetry } from "@astryon/shared";
import Link from "next/link";
import type { ReactNode } from "react";
import { SourceBadge, STATE_META } from "@/components/domain";
import { hrefOf } from "@/components/shell/nav";
import { useAgent, useStatusInterval } from "@/lib/api";
import { CLOUD } from "@/lib/cloud-flag";
import { cn } from "@/lib/cn";
import { useBasePath, useDemo } from "@/lib/demo-context";
import { fmtAgo, fmtNumber, fmtPct } from "@/lib/format";
import { useNow } from "@/lib/use-now";

/*
 * Diagrama do equipamento: céu → antena → roteador → aparelhos, com o ESP32 ligado à antena como sensor
 * e o controle (servidor ASTRYON) embaixo. Cada peça mostra a leitura que o painel já consulta e leva à
 * tela dela. Abre as telas Antena, Obstruções, Controle, ESP32 e Dispositivos, com a peça da tela destacada.
 * Dado ausente aparece como "sem leitura" ou "não consultado", nunca como zero.
 */

export type PartId = "ceu" | "antena" | "roteador" | "aparelhos" | "esp32" | "controle";
/** "info": informativo, sem juízo de estado (ponto azul); "off": desligado/sem leitura (ponto oco). */
export type PartState = "ok" | "warn" | "crit" | "info" | "off" | "loading";

/** Mesmo formato de `devices` usado em Dispositivos (só o que o diagrama lê). */
export interface DevicesSnapshot {
  source: Source;
  reason: string | null;
  devices: unknown[];
  capability: { status: CapStatus; detail: string | null } | null;
}
interface Esp32Snapshot {
  enabled?: boolean;
  nodes: { online: boolean; enabled: number; name: string }[];
}

const STATE_WORD: Record<PartState, string> = { ok: "ok", warn: "atenção", crit: "falha", info: "informativo", off: "desligado", loading: "lendo" };
const DOT: Record<PartState, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  crit: "bg-crit",
  info: "bg-accent",
  off: "border border-fg-subtle bg-transparent",
  loading: "bg-fg-subtle animate-pulse-dot",
};

/** Número ou medida dentro de um valor: mono tabular, com espaço fino antes da unidade. */
export function Num({ children }: { children: string }) {
  return <span className="tabular tracking-[-0.03em]">{children.replace(/ /g, " ")}</span>;
}

export function StateLight({ state, label, className }: { state: PartState; label?: string; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-xs", state === "warn" ? "text-warn" : state === "crit" ? "text-crit" : state === "ok" || state === "info" ? "text-fg-muted" : "text-fg-subtle", className)}>
      <span className={cn("size-2 shrink-0 rounded-full", DOT[state])} aria-hidden />
      <span>{label ?? STATE_WORD[state]}</span>
    </span>
  );
}

/* ----------------------------------------------------------------- Pictogramas (traço 1.5, cor do texto) */
const Svg = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="size-7 shrink-0" aria-hidden>
    {children}
  </svg>
);
const PICTO: Record<PartId, ReactNode> = {
  ceu: (
    <Svg>
      <path d="M3 26a13 13 0 0 1 26 0" strokeDasharray="2 2.5" />
      <path d="M3 26h26" />
      <rect x="13.5" y="6.5" width="5" height="4" rx="0.5" />
      <path d="M13.5 8.5h-4M18.5 8.5h4M8 6.5v4M24 6.5v4M16 10.5v2.5" />
    </Svg>
  ),
  antena: (
    <Svg>
      <rect x="5" y="5" width="20" height="13" rx="1.5" transform="rotate(-14 15 11.5)" />
      <path d="M16 18v6M11 27h10M16 24v3" />
    </Svg>
  ),
  roteador: (
    <Svg>
      <rect x="4" y="16" width="24" height="9" rx="1.5" />
      <path d="M9 16 7.5 7M23 16l1.5-9" />
      <path d="M8 20.5h.01M11.5 20.5h.01M15 20.5h.01" strokeWidth={2.2} />
      <path d="M19 20.5h5" />
    </Svg>
  ),
  aparelhos: (
    <Svg>
      <rect x="3" y="8" width="18" height="12" rx="1" />
      <path d="M1.5 23h21" />
      <rect x="22" y="11" width="8" height="14" rx="1.5" />
      <path d="M25 22.5h2" />
    </Svg>
  ),
  esp32: (
    <Svg>
      <rect x="9" y="9" width="14" height="14" rx="1" />
      <rect x="13" y="13" width="6" height="6" rx="0.5" />
      <path d="M12 9V5M16 9V5M20 9V5M12 27v-4M16 27v-4M20 27v-4M9 12H5M9 16H5M9 20H5M27 12h-4M27 16h-4M27 20h-4" />
    </Svg>
  ),
  controle: (
    <Svg>
      <rect x="4" y="5" width="24" height="22" rx="1.5" />
      <path d="M9 11h14M9 16h14M9 21h14" />
      <circle cx="13" cy="11" r="1.6" />
      <circle cx="20" cy="16" r="1.6" />
      <circle cx="11" cy="21" r="1.6" />
    </Svg>
  ),
};

/* ----------------------------------------------------------------- Peça */
interface Part {
  id: PartId;
  name: string;
  slug: string;
  hash?: string;
  state: PartState;
  stateLabel?: string;
  value: ReactNode;
  detail: ReactNode;
}

/**
 * Peça do diagrama. Aberta: nome e luz na primeira linha, leitura e detalhe embaixo.
 * No celular (abaixo de md) as peças que não são a da tela viram uma linha só de ~44px
 * (pictograma, nome, leitura, luz), para o conteúdo da tela começar logo abaixo do desenho.
 */
function PartNode({ part, current, className }: { part: Part; current: boolean; className?: string }) {
  const base = useBasePath();
  const href = hrefOf(base, part.slug) + (part.hash ? `#${part.hash}` : "");
  const tint = part.state === "warn" ? "border-warn/40 bg-warn-soft" : part.state === "crit" ? "border-crit/40 bg-crit-soft" : "border-border bg-bg-elev";
  const compact = !current;
  const dim = part.state === "off" || part.state === "loading";
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "group relative z-[2] grid min-w-0 grid-cols-[minmax(0,1fr)_auto] content-start items-center gap-x-2 gap-y-2 rounded-md border px-3 py-3 transition-colors duration-200",
        compact && "max-md:min-h-11 max-md:grid-cols-[auto_minmax(0,1fr)_auto] max-md:gap-x-3 max-md:gap-y-0 max-md:py-1.5",
        current ? "border-accent-2/70 bg-accent-soft shadow-[inset_0_-2px_0_0_var(--accent)]" : cn(tint, "hover:border-border-strong hover:bg-surface-2"),
        className,
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className={cn(dim ? "text-fg-subtle" : "text-accent", compact && "max-md:[&>svg]:size-5")}>{PICTO[part.id]}</span>
        <span className="whitespace-nowrap font-display text-sm font-semibold text-fg">{part.name}</span>
      </span>
      <span
        className={cn(
          "col-span-2 block truncate font-display text-[17px] font-medium leading-tight",
          compact && "max-md:col-span-1 max-md:col-start-2 max-md:row-start-1 max-md:text-right max-md:text-sm",
          part.state === "warn" ? "text-warn" : part.state === "crit" ? "text-crit" : dim ? "text-fg-muted" : "text-fg",
        )}
      >
        {part.value}
      </span>
      <StateLight state={part.state} label={part.stateLabel} className={cn("col-start-2 row-start-1 justify-self-end", compact && "max-md:col-start-3 max-md:[&>span+*]:sr-only")} />
      <span className={cn("col-span-2 line-clamp-2 text-xs leading-snug text-fg-muted", compact && "max-md:hidden")}>{part.detail}</span>
    </Link>
  );
}

/* ----------------------------------------------------------------- Fio (enlace) */
/** "live": há comunicação (azul, contínuo); "degraded": há, mas com problema (amarelo); "none": sem comunicação (tracejado). */
type Link_ = "live" | "degraded" | "none" | "loading";
const LINE: Record<Link_, string> = {
  live: "border-solid border-accent/70",
  degraded: "border-solid border-warn/80",
  none: "border-dashed border-fg-subtle/60",
  loading: "border-dashed border-border-strong",
};
const LINK_WORD: Record<Link_, string> = { live: "com comunicação", degraded: "com problema", none: "sem comunicação", loading: "lendo" };

/** Fio entre duas peças da corrente principal: vertical à esquerda no celular, horizontal entre as peças a partir de md. */
function Wire({ link, label, branch, className }: { link: Link_; label: string; branch?: Link_; className?: string }) {
  return (
    <div className={cn("relative col-span-2 grid min-h-5 grid-cols-[2.5rem_1fr] items-center md:col-span-1 md:block md:min-h-0", className)} role="img" aria-label={`Enlace ${label}: ${LINK_WORD[link]}`}>
      {/* Derivação para baixo (a partir de md), junto da peça seguinte: é de onde sai o fio do Controle. */}
      {branch && <span aria-hidden className={cn("absolute bottom-0 right-3 top-1/2 hidden border-l-[1.5px] md:block", LINE[branch])} />}
      <span aria-hidden className={cn("mx-auto h-full w-0 border-l-[1.5px] md:absolute md:inset-x-0 md:top-1/2 md:h-0 md:w-auto md:border-l-0 md:border-t-[1.5px]", LINE[link])} />
      <span aria-hidden className="flex items-baseline gap-2 md:absolute md:inset-x-0 md:top-[calc(50%-1.5rem)] md:hidden md:justify-center xl:flex">
        <span className="ol-label whitespace-nowrap">{label}</span>
        {link !== "live" && <span className={cn("whitespace-nowrap text-[10.5px] md:hidden", link === "degraded" ? "text-warn" : "text-fg-subtle")}>{LINK_WORD[link]}</span>}
      </span>
    </div>
  );
}

/* ----------------------------------------------------------------- Leituras */
function useParts(devicesOverride?: DevicesSnapshot) {
  const status = useAgent<StatusResponse>("status", { refetchInterval: useStatusInterval(10_000) });
  const agent = useAgent<AgentInfo>("agent", { refetchInterval: 30_000 });
  const spark = useAgent<Telemetry>("telemetry?range=15m", { refetchInterval: 30_000 });
  const devicesQ = useAgent<DevicesSnapshot>(CLOUD ? null : "devices", { refetchInterval: 60_000 });
  const esp = useAgent<Esp32Snapshot>(CLOUD ? null : "esp32/nodes", { refetchInterval: 15_000 });
  const caps = useAgent<{ checked_at: number | null; capabilities: Capability[] }>(CLOUD ? null : "capabilities", { refetchInterval: 60_000 });
  const now = useNow(15_000);

  const s = status.data;
  const st = s?.available ? s.status : null;
  const m = st?.metrics;
  const power = [...(spark.data?.points ?? [])].reverse().find((p) => p.power_w !== null)?.power_w ?? null;

  /* Antena */
  const connState = !s ? null : !s.available ? (s.dish_reachable === false ? "inalcancavel" : "desconhecida") : s.stale ? "desconhecida" : s.status.state;
  const antenna: Part = { id: "antena", name: "Antena", slug: "antena", state: "loading", value: "Lendo…", detail: "Consultando a API local" };
  if (status.error && !s) Object.assign(antenna, { state: "crit", value: "Sem resposta", detail: "O agente não respondeu ao status" });
  else if (s && !s.available) Object.assign(antenna, { state: s.dish_reachable === false ? "crit" : "off", stateLabel: s.dish_reachable === false ? "falha" : "sem leitura", value: s.dish_reachable === false ? "Inacessível" : "Sem leitura", detail: s.reason });
  else if (s && st) {
    const stale = s.stale;
    const tone = STATE_META[st.state].tone;
    antenna.state = stale ? "warn" : tone === "ok" ? "ok" : tone === "warn" ? "warn" : tone === "crit" ? "crit" : "off";
    antenna.stateLabel = stale ? "atrasada" : undefined;
    antenna.value = stale ? "Leitura atrasada" : STATE_META[st.state].label;
    antenna.detail = (
      <>
        {power !== null ? (
          <>
            Potência <Num>{`${fmtNumber(power, 1)} W`}</Num>
          </>
        ) : (
          "Potência sem leitura"
        )}
        {num(m?.uptime_s?.value) !== null && (
          <>
            {" · "}ligada há <Num>{fmtDur(num(m?.uptime_s?.value)!)}</Num>
          </>
        )}
      </>
    );
  }

  /* Céu (obstrução) */
  const pct = num(m?.obstruction_pct?.value);
  const obstructedNow = m?.currently_obstructed?.value;
  const sky: Part = { id: "ceu", name: "Céu", slug: "obstrucoes", state: "loading", value: "Lendo…", detail: "Visibilidade dos satélites" };
  if (s && (pct === null || !st)) Object.assign(sky, { state: "off", stateLabel: "sem leitura", value: "Sem leitura", detail: "A antena não informou a obstrução" });
  else if (pct !== null) {
    sky.state = obstructedNow === true || pct > 5 ? "warn" : "ok";
    sky.value = (
      <>
        <Num>{fmtPct(pct, 1)}</Num> obstruído
      </>
    );
    sky.detail = obstructedNow === true ? "Obstruída neste momento" : obstructedNow === false ? "Céu livre neste momento" : "Condição atual não informada";
  }

  /* Roteador e aparelhos */
  const rawDv = devicesOverride ?? devicesQ.data;
  // Resposta incompleta (sem a lista) conta como "sem leitura", nunca como zero aparelhos.
  const dv = rawDv && Array.isArray(rawDv.devices) ? rawDv : rawDv ? { ...rawDv, source: "indisponivel" as const, devices: [] } : undefined;
  const router: Part = { id: "roteador", name: "Roteador", slug: "dispositivos", hash: "roteador", state: "loading", value: "Lendo…", detail: agent.data?.router_target && agent.data.router_target !== "—" ? agent.data.router_target : "Wi‑Fi da Starlink" };
  const devices: Part = { id: "aparelhos", name: "Aparelhos", slug: "dispositivos", hash: "aparelhos", state: "loading", value: "Lendo…", detail: "Informados pelo roteador" };
  const routerAnswered = !!dv && dv.source !== "indisponivel";
  if (devicesQ.error && !dv) {
    Object.assign(router, { state: "crit", value: "Sem resposta", detail: "A consulta ao roteador falhou" });
    Object.assign(devices, { state: "off", stateLabel: "sem leitura", value: "Sem leitura", detail: "Depende do roteador" });
  } else if (dv) {
    const cap = dv.capability?.status;
    if (!routerAnswered) {
      const failed = cap === "inalcancavel" || cap === "erro";
      Object.assign(router, { state: failed ? "crit" : cap === "timeout" || cap === "negada" ? "warn" : "off", stateLabel: failed ? "falha" : "sem leitura", value: failed ? "Inalcançável" : "Não consultado", detail: dv.reason ?? "O roteador não informou clientes" });
      Object.assign(devices, { state: "off", stateLabel: "sem leitura", value: "Sem leitura", detail: "O roteador não informou a lista" });
    } else {
      Object.assign(router, { state: "ok", value: "Respondeu" });
      const n = dv.devices.length;
      Object.assign(devices, {
        state: n > 0 ? "ok" : "off",
        stateLabel: n > 0 ? undefined : "nenhum",
        value: n > 0 ? (
          <>
            <Num>{String(n)}</Num> {n === 1 ? "conectado" : "conectados"}
          </>
        ) : (
          "Nenhum conectado"
        ),
      });
    }
  }

  /* ESP32 */
  const e = esp.data && Array.isArray(esp.data.nodes) ? esp.data : undefined;
  const esp32: Part = { id: "esp32", name: "ESP32", slug: "esp32", state: "loading", value: "Lendo…", detail: "Sensor opcional da antena" };
  if (esp.error && !e) Object.assign(esp32, { state: "warn", stateLabel: "sem leitura", value: "Sem resposta", detail: "A consulta ao módulo falhou" });
  else if (esp.data && !e) Object.assign(esp32, { state: "off", stateLabel: "sem leitura", value: "Sem leitura", detail: "Resposta do módulo incompleta" });
  else if (e) {
    const online = e.nodes.filter((n) => n.online).length;
    if (e.enabled === false && !e.nodes.length) Object.assign(esp32, { state: "off", value: "Módulo desligado", detail: "Opcional: o painel funciona sem ele" });
    else if (!e.nodes.length) Object.assign(esp32, { state: "off", stateLabel: "não pareado", value: "Não pareado", detail: "Opcional: mede energia e temperatura" });
    else if (online > 0 && online < e.nodes.length) {
      const silent = e.nodes.filter((n) => !n.online);
      Object.assign(esp32, {
        state: "warn",
        stateLabel: `${silent.length} sem sinal`,
        value: (
          <>
            <Num>{`${online} de ${e.nodes.length}`}</Num> online
          </>
        ),
        detail: `Sem heartbeat: ${silent.map((n) => n.name).join(", ")}`,
      });
    } else if (online > 0)
      Object.assign(esp32, {
        state: "ok",
        value: (
          <>
            <Num>{String(online)}</Num> online
          </>
        ),
        detail: `${e.nodes.length} ${e.nodes.length === 1 ? "pareado" : "pareados"}`,
      });
    else Object.assign(esp32, { state: "crit", stateLabel: "sem sinal", value: "Sem heartbeat", detail: `${e.nodes.length} ${e.nodes.length === 1 ? "pareado, calado" : "pareados, calados"}` });
  }

  /* Controle */
  const c = caps.data && Array.isArray(caps.data.capabilities) ? caps.data : undefined;
  const control: Part = { id: "controle", name: "Controle", slug: "controle", state: "loading", value: "Lendo…", detail: "Servidor ASTRYON" };
  if (caps.error && !c) Object.assign(control, { state: "warn", stateLabel: "sem leitura", value: "Sem resposta", detail: "A matriz de capacidades não respondeu" });
  else if (caps.data && !c) Object.assign(control, { state: "off", stateLabel: "sem leitura", value: "Sem leitura", detail: "Matriz de capacidades incompleta" });
  else if (c) {
    const actions = c.capabilities.filter((x) => x.kind === "controle" && x.available).length;
    if (!c.checked_at) Object.assign(control, { state: "off", stateLabel: "não verificada", value: "Não verificado", detail: "Matriz de capacidades ainda não verificada" });
    else
      Object.assign(control, {
        state: "ok",
        value: actions ? (
          <>
            <Num>{String(actions)}</Num> {actions === 1 ? "ação disponível" : "ações disponíveis"}
          </>
        ) : (
          "Só leitura"
        ),
        detail: now ? `Capacidades verificadas ${fmtAgo(c.checked_at, now)}` : "Capacidades verificadas",
      });
  }

  /* Enlaces */
  const satLink: Link_ = !s ? "loading" : connState === "conectada" ? "live" : connState === "degradada" ? "degraded" : "none";
  const lanLink: Link_ = !dv ? (devicesQ.error ? "none" : "loading") : routerAnswered ? "live" : "none";
  const clientLink: Link_ = !dv ? (devicesQ.error ? "none" : "loading") : routerAnswered && dv.devices.length > 0 ? "live" : "none";
  const espOnline = e?.nodes.filter((n) => n.online).length ?? 0;
  const sensorLink: Link_ = !e ? (esp.error || esp.data ? "none" : "loading") : espOnline === 0 ? "none" : espOnline < e.nodes.length ? "degraded" : "live";
  // Comando: o servidor só comanda com a matriz verificada e a antena respondendo.
  const cmdLink: Link_ = !c ? (caps.error || caps.data ? "none" : "loading") : c.checked_at && st && s?.available && !s.stale ? "live" : "none";

  return { parts: { sky, antenna, router, devices, esp32, control }, links: { satLink, lanLink, clientLink, sensorLink, cmdLink }, source: st ? (st.origin === "grpc" ? "real" : "demonstracao") : null };
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function fmtDur(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
}

/* ----------------------------------------------------------------- Diagrama */
export function SystemDiagram({ current, devices: devicesOverride }: { current: PartId | PartId[]; devices?: DevicesSnapshot }) {
  const demo = useDemo();
  const { parts, links, source } = useParts(devicesOverride);
  // O diagrama local oferece controle, roteador e ESP32; na nuvem só a Antena tem uma tela equivalente.
  if (CLOUD) return null;
  const isCurrent = (id: PartId) => (Array.isArray(current) ? current.includes(id) : current === id);
  const all = Object.values(parts);
  const attention = all.filter((p) => p.state === "warn" || p.state === "crit").length;
  const reading = all.some((p) => p.state === "loading");

  return (
    <section aria-labelledby="diagrama-t" className="ol-card ol-glow ol-hud mb-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 pt-4">
        <h2 id="diagrama-t" className="font-display text-[17px] font-semibold text-fg">
          {reading ? "Lendo o equipamento…" : attention === 0 ? "Seu equipamento" : attention === 1 ? "Seu equipamento · 1 peça pede atenção" : `Seu equipamento · ${attention} peças pedem atenção`}
        </h2>
        <div className="flex items-center gap-3">
          <p className="hidden text-xs text-fg-subtle sm:block">Toque numa peça para ver o detalhe</p>
          {(demo || source === "demonstracao") && <SourceBadge source="demonstracao" />}
        </div>
      </div>
      <div className="ol-ruler mx-4 mt-3 hidden opacity-60 md:block" aria-hidden />

      <div className="grid grid-cols-[2.5rem_1fr] px-4 pb-3 pt-3 md:pb-4 md:pt-4 md:grid-cols-[minmax(0,0.85fr)_2rem_minmax(0,1.15fr)_2rem_minmax(0,1fr)_2rem_minmax(0,1fr)] md:gap-y-0 xl:grid-cols-[minmax(0,0.85fr)_5.5rem_minmax(0,1.15fr)_5.5rem_minmax(0,1fr)_5.5rem_minmax(0,1fr)]">
        <PartNode part={parts.sky} current={isCurrent("ceu")} className="col-span-2 md:col-span-1 md:col-start-1 md:row-start-1" />
        <Wire link={links.satLink} label="satélite" className="md:col-start-2 md:row-start-1" />
        <PartNode part={parts.antenna} current={isCurrent("antena")} className="col-span-2 md:col-span-1 md:col-start-3 md:row-start-1" />

        {/* ESP32: no celular pende do tronco logo abaixo da antena; a partir de md fica embaixo dela, ligado por um fio vertical. */}
        <div className="col-span-2 grid grid-cols-[2.5rem_1fr] md:col-span-1 md:col-start-3 md:row-start-2 md:flex md:flex-col md:items-stretch">
          <span aria-hidden className={cn("mx-auto h-full w-0 border-l-[1.5px] md:hidden", LINE[links.lanLink])} />
          <div className="relative py-1.5 pl-5 md:p-0">
            <span aria-hidden className={cn("absolute left-[-1.25rem] top-1/2 w-[2.5rem] border-t-[1.5px] md:hidden", LINE[links.sensorLink])} />
            <div className="relative hidden h-9 md:block" role="img" aria-label={`Enlace sensor: ${LINK_WORD[links.sensorLink]}`}>
              <span aria-hidden className={cn("absolute inset-y-0 left-1/2 border-l-[1.5px]", LINE[links.sensorLink])} />
              <span aria-hidden className="ol-label absolute left-[calc(50%+0.5rem)] top-1/2 -translate-y-1/2 whitespace-nowrap">sensor</span>
            </div>
            <span className="sr-only md:hidden">{`Enlace sensor: ${LINK_WORD[links.sensorLink]}`}</span>
            <PartNode part={parts.esp32} current={isCurrent("esp32")} />
          </div>
        </div>

        <Wire link={links.lanLink} label="rede local" branch={links.cmdLink} className="md:col-start-4 md:row-start-1" />
        <PartNode part={parts.router} current={isCurrent("roteador")} className="col-span-2 md:col-span-1 md:col-start-5 md:row-start-1" />
        <Wire link={links.clientLink} label="wi‑fi e cabo" className="md:col-start-6 md:row-start-1" />
        <PartNode part={parts.devices} current={isCurrent("aparelhos")} className="col-span-2 md:col-span-1 md:col-start-7 md:row-start-1" />

        {/* Fio "comando": desce da junção rede local/Roteador e entra no Controle (a partir de md). */}
        <div className="relative hidden md:col-start-4 md:row-start-2 md:block" role="img" aria-label={`Enlace comando: ${LINK_WORD[links.cmdLink]}`}>
          <span aria-hidden className={cn("absolute right-3 top-0 h-[3.75rem] border-l-[1.5px]", LINE[links.cmdLink])} />
          <span aria-hidden className={cn("absolute right-0 top-[3.75rem] w-3 border-t-[1.5px]", LINE[links.cmdLink])} />
          <span aria-hidden className="ol-label absolute right-5 top-6 hidden whitespace-nowrap xl:block">comando</span>
        </div>
        <PartNode part={parts.control} current={isCurrent("controle")} className="col-span-2 mt-2 md:col-span-3 md:col-start-5 md:row-start-2 md:mt-9" />
      </div>

      <ul aria-label="Legenda dos fios" className="mx-4 flex flex-wrap gap-x-3 gap-y-1 border-t border-border/60 py-2.5 text-[10.5px] text-fg-subtle md:justify-end md:gap-x-5 md:text-[11px]">
        {(["live", "degraded", "none"] as const).map((k) => (
          <li key={k} className="flex items-center gap-1.5">
            <span aria-hidden className={cn("w-4 border-t-[1.5px] md:w-6", LINE[k])} />
            {k === "live" ? "comunicando" : k === "degraded" ? "com problema" : "sem comunicação"}
          </li>
        ))}
      </ul>
    </section>
  );
}
