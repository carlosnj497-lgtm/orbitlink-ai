"use client";

import type { ConnectionEvent, EventsResponse, Gap, WeatherHourly, WeatherStatus } from "@astryon/shared";
import { CloudRain, Download, Unplug } from "lucide-react";
import { useMemo, useState } from "react";
import { PageHeader, QueryError } from "@/components/domain";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Select, Skeleton } from "@/components/ui/primitives";
import { useAgent } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fmtAgo, fmtDateTime, fmtDay, fmtDuration, fmtHM } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { weatherAt, weatherNote } from "@/lib/weather";
import { downloadCsv } from "./live";
import { DROP_KINDS, outageFacts, outagesVerdict } from "./outages-parts/outages-verdict";
import { type Figure, Verdict } from "./overview-parts/verdict";
import { causeText, CONFIDENCE_META, EVENT_META, RangeTabs } from "./shared";

const LANES = ["outage", "status_outage", "ping_drop", "power_loss", "unreachable", "boot"];
const LANE_COLOR: Record<string, string> = { outage: "bg-crit", status_outage: "bg-crit", ping_drop: "bg-warn", power_loss: "bg-crit", unreachable: "bg-fg-subtle", boot: "bg-info" };
const HATCH = "repeating-linear-gradient(135deg, rgb(212 214 217 / 0.16) 0 3px, transparent 3px 6px)";

/** Cronologia por tipo, com as lacunas de observação hachuradas (nelas nenhuma queda seria vista). */
function Timeline({ events, gaps, start, end }: { events: ConnectionEvent[]; gaps: Gap[]; start: number; end: number }) {
  const span = Math.max(1, end - start);
  const pos = (t: number) => `${((Math.max(t, start) - start) / span) * 100}%`;
  const lanes = LANES.filter((l) => l !== "power_loss" || events.some((e) => e.kind === l));
  const multiDay = span > 2 * 86400;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => start + f * span);
  return (
    <div role="group" aria-label="Linha do tempo de eventos">
      <div className="space-y-2">
        {lanes.map((lane) => {
          const evs = events.filter((e) => e.kind === lane);
          return (
            <div key={lane} className={cn("flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3", !evs.length && "max-sm:hidden")}>
              <span className="flex w-full shrink-0 items-baseline gap-1.5 text-xs text-fg-muted sm:w-44" title={EVENT_META[lane]?.label ?? lane}>
                <span className="min-w-0 truncate">{EVENT_META[lane]?.label ?? lane}</span>
                <span className="tabular ml-auto shrink-0 text-fg-subtle">{evs.length}</span>
              </span>
              <div className="relative h-5 w-full overflow-hidden rounded-[3px] bg-surface-2 sm:w-auto sm:flex-1">
                {gaps.map((g, i) => (
                  <span key={`g${i}`} aria-hidden className="absolute inset-y-0" style={{ left: pos(g.start_ts), width: `${(((g.end_ts ?? end) - Math.max(g.start_ts, start)) / span) * 100}%`, background: HATCH }} />
                ))}
                {evs.map((e) => {
                  const w = Math.max(0.4, (((e.end_ts ?? end) - Math.max(e.start_ts, start)) / span) * 100);
                  return <span key={e.id} title={`${fmtDateTime(e.start_ts)} · ${e.open ? "em andamento" : fmtDuration(e.duration_s)}`} className={cn("absolute top-0.5 h-4 min-w-[3px] rounded-[2px]", LANE_COLOR[lane] ?? "bg-warn")} style={{ left: pos(e.start_ts), width: `${w}%` }} />;
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-3" aria-hidden>
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

/** Por quê: causas das quedas, com o tempo de cada uma medido contra o total. */
function Causes({ events }: { events: ConnectionEvent[] }) {
  const f = outageFacts(events);
  const others = events.filter((e) => !DROP_KINDS.has(e.kind));
  const max = Math.max(1, ...f.causes.map((c) => c.s));
  return (
    <Card className="flex flex-col">
      <CardHeader title="Por que caiu" subtitle="Causa informada pela antena; quando não há, o tipo do evento." />
      <CardBody className="flex flex-1 flex-col">
        {f.causes.length === 0 ? (
          <p className="text-sm text-fg-muted">Nenhuma queda no período.</p>
        ) : (
          <ul className="space-y-3">
            {f.causes.map((c) => (
              <li key={c.label}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-fg">{c.label}</span>
                  <span className="tabular shrink-0 text-xs text-fg-muted">
                    {c.n}× · {fmtDuration(c.s)}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-[2px] bg-surface-2" aria-hidden>
                  <div className="h-full rounded-[2px] bg-fg-muted" style={{ width: `${Math.max(2, (c.s / max) * 100)}%` }} />
                </div>
                <p className="mt-0.5 text-[11px] text-fg-subtle">{c.confirmed ? "confirmada pela antena" : "inferida das amostras; a origem pode ser antena, rede local ou roteador"}</p>
              </li>
            ))}
          </ul>
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

export default function OutagesView() {
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

  return (
    <>
      <PageHeader
        title="Eventos"
        icon={<Unplug />}
        description="Eventos observados, com tipo e grau de confirmação. 'Antena inacessível' indica falha de comunicação local, não necessariamente queda do satélite."
        actions={
          <>
            <Select aria-label="Filtrar por tipo" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">Todos os tipos</option>
              {Object.entries(EVENT_META).map(([k, m]) => (
                <option key={k} value={k}>
                  {m.label}
                </option>
              ))}
            </Select>
            <RangeTabs value={range} onChange={setRange} options={[{ value: "24h", label: "24h" }, { value: "7d", label: "7d" }, { value: "30d", label: "30d" }]} />
            <Button
              size="sm"
              disabled={!d?.events.length}
              onClick={() =>
                downloadCsv(`astryon-eventos-${range}.csv`, ["inicio_utc", "inicio_local", "fim_utc", "duracao_s", "tipo", "causa", "confianca", "clima_na_hora_estimado"], d!.events.map((e) => [new Date(e.start_ts * 1000).toISOString(), fmtDateTime(e.start_ts), e.end_ts ? new Date(e.end_ts * 1000).toISOString() : "", e.duration_s, e.kind, e.cause, e.confidence, wxNote(e) ?? ""]))
              }
            >
              <Download /> CSV
            </Button>
          </>
        }
      />
      {q.error && (
        <div className="mb-4">
          <QueryError error={q.error} onRetry={() => q.refetch()} />
        </div>
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

      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Quando caiu" subtitle="Cada faixa é um tipo de evento; a largura é a duração." />
          <CardBody>{d ? <Timeline events={d.events} gaps={d.gaps} start={d.start} end={d.end} /> : <Skeleton className="h-28 w-full" />}</CardBody>
        </Card>
        {d ? <Causes events={d.events} /> : <Skeleton className="h-48 w-full" />}
      </div>

      <Card>
        <CardHeader title="Registro de eventos" subtitle="Abra “ver” para conferir as evidências de cada evento." />
        <CardBody>
          {q.isLoading && <Skeleton className="h-48 w-full" />}
          {d && !d.events.length && (
            <EmptyState icon={<Unplug />} title="Nenhum evento registrado no período">
              Somente períodos observados pelo agente podem conter eventos.
            </EmptyState>
          )}
          {d && d.events.length > 0 && (
            <>
              {/* Celular: cada evento vira um bloco empilhado. */}
              <ul className="divide-y divide-border/60 sm:hidden">
                {d.events.map((e) => (
                  <li key={e.id} className="py-3">
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
                      {e.cause && <span>{causeText(e.cause)}</span>}
                      <Badge tone={CONFIDENCE_META[e.confidence]?.tone} title={CONFIDENCE_META[e.confidence]?.help}>
                        {e.confidence}
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
                      <pre className="mt-1 whitespace-pre-wrap text-[11px] text-fg-muted">{JSON.stringify({ causa: e.cause, ...e.evidence }, null, 2)}</pre>
                    </details>
                  </li>
                ))}
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
                  {d.events.map((e) => (
                    <tr key={e.id} className="border-b border-border/60 align-top last:border-0">
                      <td className="tabular py-2 pr-3">{fmtDateTime(e.start_ts)}</td>
                      <td className="tabular py-2 pr-3">{e.open ? <Badge tone="warn">em andamento</Badge> : fmtDuration(e.duration_s)}</td>
                      <td className="py-2 pr-3">
                        <span className="flex items-center gap-2">
                          <span className={cn("size-2 shrink-0 rounded-full", LANE_COLOR[e.kind] ?? "bg-fg-subtle")} aria-hidden />
                          {EVENT_META[e.kind]?.label ?? e.kind}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-fg-muted">{causeText(e.cause) ?? "—"}</td>
                      <td className="py-2 pr-3">
                        <Badge tone={CONFIDENCE_META[e.confidence]?.tone} title={CONFIDENCE_META[e.confidence]?.help}>
                          {e.confidence}
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
                          <pre className="mt-1 max-w-sm whitespace-pre-wrap text-[11px] text-fg-muted">{JSON.stringify({ causa: e.cause, ...e.evidence }, null, 2)}</pre>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </CardBody>
      </Card>
    </>
  );
}
