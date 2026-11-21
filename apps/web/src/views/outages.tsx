"use client";

import type { ConnectionEvent, EventsResponse, Gap, WeatherHourly, WeatherStatus } from "@astryon/shared";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, CloudRain, Download, HelpCircle, Info, ListChecks, RadioTower, RefreshCw, ShieldAlert, Unplug, Wifi, Zap } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { PageHeader, QueryError } from "@/components/domain";
import { hrefOf } from "@/components/shell/nav";
import { Badge, Button, Callout, Card, CardBody, CardHeader, EmptyState, Select, Skeleton, Tip } from "@/components/ui/primitives";
import { useAgent } from "@/lib/api";
import { cn } from "@/lib/cn";
import { CLOUD } from "@/lib/cloud-flag";
import { useBasePath } from "@/lib/demo-context";
import { fmtAgo, fmtDateTime, fmtDay, fmtDuration, fmtHM, fmtNumber } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { weatherAt, weatherNote } from "@/lib/weather";
import { downloadCsv } from "./live";
import { DROP_KINDS, outageFacts, outagesVerdict } from "./outages-parts/outages-verdict";
import { type Figure, Verdict } from "./overview-parts/verdict";
import { causeText, CONFIDENCE_META, EVENT_META, RangeTabs } from "./shared";

const LANES = ["outage", "status_outage", "ping_drop", "power_loss", "unreachable", "boot"];
const LANE_COLOR: Record<string, string> = { outage: "bg-crit", status_outage: "bg-crit", ping_drop: "bg-warn", power_loss: "bg-crit", unreachable: "bg-fg-subtle", boot: "bg-info" };
const HATCH = "repeating-linear-gradient(135deg, rgb(212 214 217 / 0.16) 0 3px, transparent 3px 6px)";

/** Explicação curta para as causas informadas pela antena. */
const CAUSE_HELP: Record<string, string> = {
  OBSTRUCTED: "A visão do céu está bloqueada por obstáculos (árvores, telhados, construções).",
  NO_SCHEDULE: "A antena não tem satélite agendado para aquele momento/orbita.",
  NO_SATS: "Nenhum satélite da constelação está visível a partir da posição da antena.",
  NO_DOWNLINK: "A antena não recebeu sinal de descida do satélite.",
  NO_PINGS: "A antena não conseguiu completar pings de volta ao PoP.",
  BOOTING: "A antena estava inicializando e ainda não havia sincronizado.",
  SEARCHING: "A antena estava buscando satélites.",
  STOWED: "A antena estava no modo recolhido (stow).",
  THERMAL_SHUTDOWN: "A antena desligou por proteção térmica (superaquecimento).",
  SLEEPING: "A antena entrou em modo de repouso de baixo consumo.",
  CABLE_RESET: "O cabo/braço da antena foi reiniciado.",
  ACTUATOR_ACTIVITY: "Motor de posicionamento estava se movimentando.",
  MOVING_WHILE_NOT_PERMITTED: "A antena detectou movimento físico não autorizado.",
  UNKNOWN: "A antena não informou uma causa específica.",
  unknown: "A causa não foi identificada.",
  timeout: "O agente não obteve resposta da antena dentro do tempo esperado.",
  "too many redirects": "Houve falha interna de comunicação (redirecionamentos).",
};

function SummaryCard({ label, value, note, tone, loading }: { label: string; value: React.ReactNode; note?: string; tone?: "ok" | "warn" | "crit" | "neutral"; loading?: boolean }) {
  const cls = tone === "crit" ? "border-crit/30 bg-crit-soft" : tone === "warn" ? "border-warn/30 bg-warn-soft" : tone === "ok" ? "border-ok/30 bg-ok-soft" : "border-border bg-surface-2";
  return (
    <Card className={cn("min-w-0 p-3", cls)}>
      <p className="text-xs text-fg-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold tracking-[-0.02em] text-fg">{loading ? <Skeleton className="h-6 w-24" /> : value}</p>
      {note && <p className="mt-0.5 text-[11px] text-fg-subtle">{note}</p>}
    </Card>
  );
}

/** Cronologia por tipo, com as lacunas de observação hachuradas e interação de rolagem. */
function Timeline({ events, gaps, start, end, onEventClick }: { events: ConnectionEvent[]; gaps: Gap[]; start: number; end: number; onEventClick?: (id: number) => void }) {
  const span = Math.max(1, end - start);
  const pos = (t: number) => `${((Math.max(t, start) - start) / span) * 100}%`;
  const lanes = LANES.filter((l) => l !== "power_loss" || events.some((e) => e.kind === l));
  const multiDay = span > 2 * 86400;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => start + f * span);
  return (
    <div role="group" aria-label="Linha do tempo de eventos">
      <div className="space-y-3">
        {lanes.map((lane) => {
          const evs = events.filter((e) => e.kind === lane);
          return (
            <div key={lane} className={cn("flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3", !evs.length && "max-sm:hidden")}>
              <span className="flex w-full shrink-0 items-baseline gap-1.5 text-xs text-fg-muted sm:w-44" title={EVENT_META[lane]?.label ?? lane}>
                <span className="min-w-0 truncate">{EVENT_META[lane]?.label ?? lane}</span>
                <span className="tabular ml-auto shrink-0 text-fg-subtle">{evs.length}</span>
              </span>
              <div className="relative h-7 w-full overflow-hidden rounded-[4px] bg-surface-2 sm:w-auto sm:flex-1">
                {gaps.map((g, i) => (
                  <span key={`g${i}`} aria-hidden className="absolute inset-y-0" style={{ left: pos(g.start_ts), width: `${(((g.end_ts ?? end) - Math.max(g.start_ts, start)) / span) * 100}%`, background: HATCH }} />
                ))}
                {evs.map((e) => {
                  const w = Math.max(0.6, (((e.end_ts ?? end) - Math.max(e.start_ts, start)) / span) * 100);
                  return (
                    <button
                      key={e.id}
                      type="button"
                      title={`${fmtDateTime(e.start_ts)} · ${e.open ? "em andamento" : fmtDuration(e.duration_s)} · ${causeText(e.cause) ?? EVENT_META[e.kind]?.label ?? e.kind}`}
                      onClick={() => onEventClick?.(e.id)}
                      className={cn(
                        "absolute top-1 h-5 min-w-[4px] cursor-pointer rounded-[3px] transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-accent",
                        LANE_COLOR[lane] ?? "bg-warn",
                        e.open && "animate-pulse",
                      )}
                      style={{ left: pos(e.start_ts), width: `${w}%` }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-3" aria-hidden>
        <span className="hidden w-44 shrink-0 sm:block" />
        <div className="tabular flex flex-1 justify-between text-[10.5px] text-fg-subtle">
          {ticks.map((t, i) => (
            <span key={i} className={cn(i > 0 && i < ticks.length - 1 && "max-sm:hidden")}>
              {i === ticks.length - 1 ? "agora" : multiDay ? fmtDay(t) : fmtHM(t)}
            </span>
          ))}
        </div>
      </div>
      {gaps.length > 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-fg-subtle">
          <span className="inline-block h-2.5 w-4 rounded-[2px] border border-border-strong" style={{ background: HATCH }} aria-hidden />
          Hachurado: sem observação do agente (não conta como queda).
        </p>
      )}
    </div>
  );
}

/** Formata as evidências de forma legível; mantém o JSON bruto disponível. */
function EvidenceView({ ev }: { ev: ConnectionEvent }) {
  const known = [] as { label: string; value: React.ReactNode }[];
  if (ev.cause) known.push({ label: "Causa informada", value: <>{causeText(ev.cause) ?? ev.cause}</> });
  if (ev.evidence.snr !== undefined && ev.evidence.snr !== null) known.push({ label: "SNR no momento", value: <span className="tabular">{fmtNumber(Number(ev.evidence.snr), 2)} dB</span> });
  if (ev.evidence.latency_ms !== undefined && ev.evidence.latency_ms !== null) known.push({ label: "Latência no evento", value: <span className="tabular">{fmtNumber(Number(ev.evidence.latency_ms), 0)} ms</span> });
  if (ev.evidence.drop_pct !== undefined && ev.evidence.drop_pct !== null) known.push({ label: "Perda no evento", value: <span className="tabular">{fmtNumber(Number(ev.evidence.drop_pct), 1)}%</span> });
  if (ev.evidence.power_w !== undefined && ev.evidence.power_w !== null) known.push({ label: "Potência no evento", value: <span className="tabular">{fmtNumber(Number(ev.evidence.power_w), 1)} W</span> });
  if (ev.evidence.cable_state !== undefined && ev.evidence.cable_state !== null) known.push({ label: "Estado do cabo", value: String(ev.evidence.cable_state) });
  if (ev.evidence.thermal_state !== undefined && ev.evidence.thermal_state !== null) known.push({ label: "Estado térmico", value: String(ev.evidence.thermal_state) });
  if (ev.evidence.azimuth_deg !== undefined && ev.evidence.elevation_deg !== undefined) {
    known.push({ label: "Direção apontada", value: <span className="tabular">az {fmtNumber(Number(ev.evidence.azimuth_deg), 0)}° / el {fmtNumber(Number(ev.evidence.elevation_deg), 0)}°</span> });
  }
  if (ev.evidence.obstruction_pct !== undefined && ev.evidence.obstruction_pct !== null) {
    known.push({ label: "Obstrução no momento", value: <span className="tabular">{fmtNumber(Number(ev.evidence.obstruction_pct), 1)}%</span> });
  }
  return (
    <div className="space-y-2">
      {known.length > 0 && (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
          {known.map((k) => (
            <div key={k.label} className="flex items-start justify-between gap-3 text-xs sm:block sm:gap-0">
              <dt className="text-fg-subtle">{k.label}</dt>
              <dd className="tabular font-medium text-fg">{k.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {Object.keys(ev.evidence).length === 0 && <p className="text-xs text-fg-subtle">Nenhuma evidência extra registrada para este evento.</p>}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-accent">JSON bruto</summary>
        <pre className="mt-1 whitespace-pre-wrap text-[11px] text-fg-muted">{JSON.stringify({ causa: ev.cause, ...ev.evidence }, null, 2)}</pre>
      </details>
    </div>
  );
}

/** Por quê: causas das quedas, separadas por confiança. */
function Causes({ events }: { events: ConnectionEvent[] }) {
  const f = outageFacts(events);
  const others = events.filter((e) => !DROP_KINDS.has(e.kind));
  const confirmed = f.causes.filter((c) => c.confirmed);
  const inferred = f.causes.filter((c) => !c.confirmed);
  const max = Math.max(1, ...f.causes.map((c) => c.s));
  return (
    <Card className="flex flex-col">
      <CardHeader title="Por que caiu" icon={<HelpCircle />} subtitle="Causa informada pela antena ou inferida das amostras" />
      <CardBody className="flex-1">
        {f.causes.length === 0 ? (
          <EmptyState icon={<CheckCircle2 />} title="Nenhuma queda no período" className="py-4">
            Não há eventos classificados como queda para analisar a causa.
          </EmptyState>
        ) : (
          <div className="space-y-4">
            {confirmed.length > 0 && (
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-fg">
                  <CheckCircle2 className="size-3.5 text-ok" /> Confirmadas pela antena
                </p>
                <ul className="space-y-2.5">
                  {confirmed.map((c) => (
                    <li key={c.label}>
                      <CauseBar c={c} max={max} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {inferred.length > 0 && (
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-fg">
                  <Info className="size-3.5 text-info" /> Inferidas
                </p>
                <ul className="space-y-2.5">
                  {inferred.map((c) => (
                    <li key={c.label}>
                      <CauseBar c={c} max={max} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {others.length > 0 && (
          <div className="mt-auto pt-4">
            <p className="mb-1.5 text-xs text-fg-muted">Outros eventos no período</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(
                others.reduce<Record<string, { n: number; s: number }>>((acc, e) => {
                  acc[e.kind] ??= { n: 0, s: 0 };
                  acc[e.kind].n += 1;
                  acc[e.kind].s += e.duration_s ?? 0;
                  return acc;
                }, {}),
              ).map(([k, v]) => (
                <Badge key={k} tone={EVENT_META[k]?.tone ?? "neutral"}>
                  {EVENT_META[k]?.label ?? k}: {v.n} · {fmtDuration(v.s)}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function CauseBar({ c, max }: { c: { label: string; n: number; s: number; confirmed: boolean }; max: number }) {
  const help = CAUSE_HELP[c.label] ?? CAUSE_HELP[c.label.trim()] ?? CAUSE_HELP.unknown;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-fg">{c.label}</span>
          <Tip content={help}>
            <HelpCircle className="size-3.5 shrink-0 text-fg-subtle hover:text-accent" />
          </Tip>
        </span>
        <span className="tabular shrink-0 text-xs text-fg-muted">
          {c.n}× · {fmtDuration(c.s)}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-[2px] bg-surface-2" aria-hidden>
        <div className={cn("h-full rounded-[2px]", c.confirmed ? "bg-ok" : "bg-fg-muted")} style={{ width: `${Math.max(2, (c.s / max) * 100)}%` }} />
      </div>
      <p className="mt-0.5 text-[11px] text-fg-subtle">{c.confirmed ? "reportada pela antena" : "inferida das amostras; a origem pode ser antena, rede local ou roteador"}</p>
    </div>
  );
}

export default function OutagesView() {
  const base = useBasePath();
  const [range, setRange] = useState("7d");
  const [kind, setKind] = useState("");
  const q = useAgent<EventsResponse>(`events?range=${range}${kind ? `&kind=${kind}` : ""}&limit=1000`, { refetchInterval: 60_000 });
  const wxStatus = useAgent<WeatherStatus>("weather");
  const wxOn = wxStatus.data?.configured ?? false;
  const wx = useAgent<WeatherHourly>(wxOn ? `weather/hourly?range=${range}` : null, { refetchInterval: 15 * 60_000 });
  const now = useNow(30_000);
  const d = q.data;
  const wxNote = (e: ConnectionEvent) => (wx.data ? weatherNote(weatherAt(wx.data.hours, e.start_ts)) : null);
  const v = d ? outagesVerdict(d, range, kind, now) : null;
  const f = useMemo(() => (d ? outageFacts(d.events) : null), [d]);
  const rainDrops = f && wx.data ? f.drops.filter((e) => wxNote(e)).length : null;
  const rowRefs = useRef<Record<number, HTMLLIElement | HTMLTableRowElement | null>>({});

  const refresh = () => {
    void q.refetch();
    void wx.refetch();
  };

  const scrollToEvent = (id: number) => {
    const el = rowRefs.current[id];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ol-highlight");
      window.setTimeout(() => el.classList.remove("ol-highlight"), 2000);
    }
  };

  const figures: Figure[] | undefined =
    f && !kind
      ? [
          { key: "n", label: "Quedas", value: f.drops.length, note: f.open ? "Uma em andamento" : "Interrupções e perdas de ping" },
          { key: "total", label: "Tempo fora do ar", value: fmtDuration(f.total), note: "Soma das quedas observadas" },
          { key: "longest", label: "Maior queda", value: f.longest ? fmtDuration(f.longest.duration_s) : "—", note: f.longest ? fmtDateTime(f.longest.start_ts) : "Nenhuma no período" },
          { key: "latest", label: "Última queda", value: f.latest ? (now ? fmtAgo(f.latest.start_ts, now) : fmtDateTime(f.latest.start_ts)) : "—", note: f.latest ? `${fmtDateTime(f.latest.start_ts)} · ${f.latest.open ? "em andamento" : fmtDuration(f.latest.duration_s)}` : "Nenhuma no período" },
          {
            key: "contact",
            label: wxOn ? "Quedas com chuva" : "Perdas de contato",
            value: wxOn ? (rainDrops ?? "—") : f.unreachable.length,
            note: wxOn ? "Coincidência com chuva estimada, não causa" : "Antena inacessível pelo agente (falha local)",
          },
        ]
      : undefined;

  const todayDrops = useMemo(() => (f ? f.drops.filter((e) => now !== null && e.start_ts > now - 86400).length : null), [f, now]);

  return (
    <>
      <PageHeader
        title="Eventos e Quedas"
        icon={<Unplug />}
        description="Eventos observados, com tipo e grau de confirmação. 'Antena inacessível' indica falha de comunicação local, não necessariamente queda do satélite."
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={refresh} disabled={q.isFetching || wx.isFetching || wxStatus.isFetching}>
              <RefreshCw className="size-4" /> Atualizar
            </Button>
            <Select aria-label="Filtrar por tipo" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">Todos os tipos</option>
              {Object.entries(EVENT_META).map(([k, m]) => (
                <option key={k} value={k}>
                  {m.label}
                </option>
              ))}
            </Select>
            <RangeTabs value={range} onChange={setRange} options={[{ value: "24h", label: "24h" }, { value: "7d", label: "7d" }, { value: "30d", label: "30d" }]} />
            <Tip content={!d?.events.length ? "Exportação disponível após carregar eventos" : `Exportar ${d.events.length} evento(s) visíveis`}>
              <span>
                <Button size="sm" disabled={!d?.events.length} onClick={() => downloadCsv(`astryon-eventos-${range}.csv`, ["inicio_utc", "inicio_local", "fim_utc", "duracao_s", "tipo", "causa", "confianca", "clima_na_hora_estimado"], d!.events.map((e) => [new Date(e.start_ts * 1000).toISOString(), fmtDateTime(e.start_ts), e.end_ts ? new Date(e.end_ts * 1000).toISOString() : "", e.duration_s, e.kind, e.cause, e.confidence, wxNote(e) ?? ""]))}>
                  <Download /> Exportar CSV
                </Button>
              </span>
            </Tip>
          </>
        }
      />
      {q.error && (
        <div className="mb-4">
          <QueryError error={q.error} onRetry={() => q.refetch()} />
        </div>
      )}

      {/* Alerta de evento em andamento */}
      {f?.open && (
        <Callout tone="crit" icon={<AlertTriangle className="size-5" />} title="Interrupção em andamento" className="mb-4">
          <p>
            A última queda começou em <span className="tabular font-medium">{fmtDateTime(f.open.start_ts)}</span> e está em aberto há <span className="tabular font-medium">{fmtDuration((now ?? f.open.start_ts) - f.open.start_ts)}</span>.
          </p>
          {!CLOUD && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href={hrefOf(base, "ao-vivo")} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-crit px-3 text-sm font-medium text-white hover:bg-crit/90">
                Ver em Ao Vivo <ArrowRight className="size-4" />
              </Link>
              <Link href={hrefOf(base, "diagnosticos")} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-crit/50 px-3 text-sm font-medium text-crit hover:bg-crit-soft">
                Testar comunicação
              </Link>
            </div>
          )}
        </Callout>
      )}

      <Verdict
        label="Quando caiu, quanto tempo e por quê?"
        tone={v?.tone ?? "unknown"}
        word={v?.word}
        loading={!d && !q.error}
        headline={v?.headline ?? "Não foi possível consultar os eventos agora."}
        detail={v?.detail}
        figures={figures}
        meta={
          d && (
            <span>
              Janela: <span className="tabular text-fg-muted">{fmtDateTime(d.start)} → {fmtDateTime(d.end)}</span> · eventos derivados e indeterminados não têm a causa comprovada.
            </span>
          )
        }
      />

      {/* Estatísticas rápidas acima da timeline */}
      {f && !kind && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard label="Total de quedas" value={f.drops.length} note={f.drops.length === 1 ? "no período" : "no período"} tone={f.drops.length ? (f.open ? "crit" : "warn") : "ok"} loading={q.isLoading} />
          <SummaryCard label="Tempo total fora do ar" value={fmtDuration(f.total)} note="Soma das durações" tone={f.total > 600 ? "warn" : "ok"} loading={q.isLoading} />
          <SummaryCard label="Média de duração" value={f.drops.length ? fmtDuration(f.total / f.drops.length) : "—"} note="Média por queda" tone="neutral" loading={q.isLoading} />
          <SummaryCard label="Quedas nas últimas 24 h" value={todayDrops ?? "—"} note={todayDrops === 0 ? "nenhuma hoje" : todayDrops === 1 ? "uma recente" : " recentes"} tone={todayDrops && todayDrops > 0 ? "warn" : "ok"} loading={q.isLoading} />
        </div>
      )}

      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Quando caiu" icon={<Clock />} subtitle="Clique numa faixa para rolar até o evento na tabela. Cada cor é um tipo de evento; a largura é a duração." />
          <CardBody>{d ? <Timeline events={d.events} gaps={d.gaps} start={d.start} end={d.end} onEventClick={scrollToEvent} /> : <Skeleton className="h-28 w-full" />}</CardBody>
        </Card>
        {d ? <Causes events={d.events} /> : <Skeleton className="h-48 w-full" />}
      </div>

      <Card>
        <CardHeader title="Registro de eventos" icon={<ListChecks />} subtitle="Abra “ver” para conferir as evidências de cada evento." />
        <CardBody>
          {q.isLoading && <Skeleton className="h-48 w-full" />}
          {d && !d.events.length && <EmptyEventState range={range} kind={kind} hasGaps={d.gaps.length > 0} />}
          {d && d.events.length > 0 && (
            <>
              {/* Celular: cada evento vira um bloco empilhado. */}
              <ul className="divide-y divide-border/60 sm:hidden">
                {d.events.map((e) => {
                  const recent = now !== null && e.start_ts > now - 86400;
                  return (
                    <li key={e.id} ref={(el) => { rowRefs.current[e.id] = el; }} className={cn("py-3 transition-colors", e.open ? "bg-crit-soft/40" : recent ? "bg-surface-2/40" : undefined)}>
                      <EventRowMobile e={e} wxOn={wxOn} wxNote={wxNote} base={base} />
                    </li>
                  );
                })}
              </ul>
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="text-left text-xs text-fg-subtle">
                    <tr className="border-b border-border">
                      <th className="py-2 pr-3 font-medium">Início</th>
                      <th className="py-2 pr-3 font-medium">Duração</th>
                      <th className="py-2 pr-3 font-medium">Tipo</th>
                      <th className="py-2 pr-3 font-medium">Causa informada</th>
                      <th className="py-2 pr-3 font-medium">Confiança</th>
                      {wxOn && <th className="py-2 pr-3 font-medium">Clima na hora</th>}
                      <th className="py-2 font-medium">Evidência</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.events.map((e) => {
                      const recent = now !== null && e.start_ts > now - 86400;
                      return (
                        <tr
                          key={e.id}
                          ref={(el) => { rowRefs.current[e.id] = el; }}
                          className={cn("border-b border-border/60 align-top transition-colors last:border-0", e.open ? "bg-crit-soft/40" : recent ? "bg-surface-2/30" : undefined)}
                        >
                          <td className="tabular py-2 pr-3">{fmtDateTime(e.start_ts)}</td>
                          <td className="tabular py-2 pr-3">{e.open ? <Badge tone="warn">em andamento</Badge> : fmtDuration(e.duration_s)}</td>
                          <td className="py-2 pr-3">
                            <span className="flex items-center gap-2">
                              <span className={cn("size-2 shrink-0 rounded-full", LANE_COLOR[e.kind] ?? "bg-fg-subtle")} aria-hidden />
                              {EVENT_META[e.kind]?.label ?? e.kind}
                            </span>
                          </td>
                          <td className="py-2 pr-3 text-fg-muted">
                            <CauseWithHelp cause={e.cause} />
                          </td>
                          <td className="py-2 pr-3">
                            <Badge tone={CONFIDENCE_META[e.confidence]?.tone} title={CONFIDENCE_META[e.confidence]?.help}>
                              {CONFIDENCE_META[e.confidence]?.label ?? e.confidence}
                            </Badge>
                          </td>
                          {wxOn && (
                            <td className="py-2 pr-3 text-xs">
                              {wxNote(e) ? (
                                <span className="inline-flex items-start gap-1 text-fg-muted" title="Estimativa regional do clima naquela hora. Coincidência, não causa.">
                                  <CloudRain className="mt-px size-3.5 shrink-0 text-accent" aria-hidden />
                                  {wxNote(e)}
                                </span>
                              ) : (
                                <span className="text-fg-subtle">{wx.data && weatherAt(wx.data.hours, e.start_ts) ? "sem chuva relevante" : "—"}</span>
                              )}
                            </td>
                          )}
                          <td className="py-2">
                            <details>
                              <summary className="cursor-pointer text-xs text-accent">ver</summary>
                              <EvidenceView ev={e} />
                            </details>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardBody>
      </Card>

      <p className="mt-4 text-xs text-fg-subtle">Eventos derivados e indeterminados não têm causa comprovada. Correlação com clima não implica causalidade.</p>
    </>
  );
}

function CauseWithHelp({ cause }: { cause: string | null }) {
  if (!cause) return <span>—</span>;
  const label = causeText(cause) ?? cause;
  const help = CAUSE_HELP[cause] ?? CAUSE_HELP[cause.trim()];
  return (
    <span className="flex items-center gap-1.5">
      <span>{label}</span>
      {help && (
        <Tip content={help}>
          <HelpCircle className="size-3.5 shrink-0 text-fg-subtle hover:text-accent" />
        </Tip>
      )}
    </span>
  );
}

function EventActions({ e, base }: { e: ConnectionEvent; base: string }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {!CLOUD && (
        <Link href={hrefOf(base, "ao-vivo")} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
          <Wifi className="size-3.5" /> Ao Vivo
        </Link>
      )}
      {e.kind === "outage" && !CLOUD && (
        <Link href={hrefOf(base, "obstrucoes")} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
          <RadioTower className="size-3.5" /> Mapa do céu
        </Link>
      )}
      {e.kind === "ping_drop" && (
        <Link href={hrefOf(base, "qualidade")} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
          <Zap className="size-3.5" /> Qualidade
        </Link>
      )}
    </div>
  );
}

function EventRowMobile({ e, wxOn, wxNote, base }: { e: ConnectionEvent; wxOn: boolean; wxNote: (e: ConnectionEvent) => string | null; base: string }) {
  return (
    <>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="tabular text-fg">{fmtDateTime(e.start_ts)}</span>
        <span className="text-fg-subtle">·</span>
        {e.open ? <Badge tone="warn">em andamento</Badge> : <span className="tabular text-fg">{fmtDuration(e.duration_s)}</span>}
      </p>
      <p className="mt-0.5 flex items-center gap-2 text-sm text-fg">
        <span className={cn("size-2 shrink-0 rounded-full", LANE_COLOR[e.kind] ?? "bg-fg-subtle")} aria-hidden />
        {EVENT_META[e.kind]?.label ?? e.kind}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-fg-muted">
        {e.cause && <CauseWithHelp cause={e.cause} />}
        <Badge tone={CONFIDENCE_META[e.confidence]?.tone} title={CONFIDENCE_META[e.confidence]?.help}>
          {CONFIDENCE_META[e.confidence]?.label ?? e.confidence}
        </Badge>
        {wxOn && wxNote(e) && (
          <span className="inline-flex items-center gap-1">
            <CloudRain className="size-3.5 text-accent" aria-hidden />
            {wxNote(e)}
          </span>
        )}
      </div>
      <details className="mt-1">
        <summary className="cursor-pointer text-xs text-accent">ver evidências</summary>
        <div className="mt-2 rounded-md bg-surface-2/50 p-2">
          <EvidenceView ev={e} />
          <EventActions e={e} base={base} />
        </div>
      </details>
      <EventActions e={e} base={base} />
    </>
  );
}

function EmptyEventState({ range, kind, hasGaps }: { range: string; kind: string; hasGaps: boolean }) {
  const rangePhrase = range === "24h" ? "nas últimas 24 horas" : range === "7d" ? "nos últimos 7 dias" : range === "30d" ? "nos últimos 30 dias" : `no período ${range}`;
  if (kind) {
    return (
      <EmptyState icon={<ListChecks />} title="Nenhum evento deste tipo" className="min-h-48">
        Nenhum evento do tipo selecionado {rangePhrase}. Tente remover o filtro para ver todos os eventos.
      </EmptyState>
    );
  }
  if (hasGaps) {
    return (
      <EmptyState icon={<ShieldAlert />} title="Nenhum evento observado" className="min-h-48">
        Nenhum evento registrado {rangePhrase}, mas houve lacunas de observação. Quedas nesses trechos não teriam sido detectadas.
      </EmptyState>
    );
  }
  return (
    <EmptyState icon={<CheckCircle2 />} title="Nenhum evento registrado no período" className="min-h-48">
      Nenhuma queda, perda de contato ou reinício foi observado {rangePhrase}. Você pode ampliar o período para ver o histórico completo.
    </EmptyState>
  );
}
