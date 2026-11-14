"use client";

import type { ConnectionEvent, EventsResponse, WeatherHourly, WeatherStatus } from "@orbitlink/shared";
import { CloudRain, Download, Unplug } from "lucide-react";
import { useMemo, useState } from "react";
import { PageHeader, QueryError } from "@/components/domain";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Select, Skeleton } from "@/components/ui/primitives";
import { useAgent } from "@/lib/api";
import { fmtDateTime, fmtDuration } from "@/lib/format";
import { weatherAt, weatherNote } from "@/lib/weather";
import { downloadCsv } from "./live";
import { CONFIDENCE_META, EVENT_META, RangeTabs } from "./shared";

function Timeline({ events, start, end }: { events: ConnectionEvent[]; start: number; end: number }) {
  const span = end - start;
  const lanes = ["outage", "status_outage", "ping_drop", "unreachable", "boot"];
  const color: Record<string, string> = { outage: "bg-crit", status_outage: "bg-crit", ping_drop: "bg-warn", unreachable: "bg-fg-subtle", boot: "bg-info" };
  return (
    <div className="space-y-2" role="group" aria-label="Linha do tempo de eventos">
      {lanes.map((lane) => {
        const evs = events.filter((e) => e.kind === lane);
        return (
          <div key={lane} className="flex items-center gap-3">
            <span className="w-40 shrink-0 truncate text-xs text-fg-muted">{EVENT_META[lane]?.label ?? lane}</span>
            <div className="relative h-5 flex-1 rounded bg-surface-2">
              {evs.map((e) => {
                const left = ((Math.max(e.start_ts, start) - start) / span) * 100;
                const w = Math.max(0.4, (((e.end_ts ?? end) - Math.max(e.start_ts, start)) / span) * 100);
                return <span key={e.id} title={`${fmtDateTime(e.start_ts)} · ${fmtDuration(e.duration_s)}`} className={`absolute top-0.5 h-4 rounded-sm ${color[lane]} opacity-80`} style={{ left: `${left}%`, width: `${w}%` }} />;
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function OutagesView() {
  const [range, setRange] = useState("7d");
  const [kind, setKind] = useState("");
  const q = useAgent<EventsResponse>(`events?range=${range}${kind ? `&kind=${kind}` : ""}&limit=1000`, { refetchInterval: 60_000 });
  const wxStatus = useAgent<WeatherStatus>("weather");
  const wxOn = wxStatus.data?.configured ?? false;
  const wx = useAgent<WeatherHourly>(wxOn ? `weather/hourly?range=${range}` : null, { refetchInterval: 15 * 60_000 });
  const d = q.data;
  const wxNote = (e: ConnectionEvent) => (wx.data ? weatherNote(weatherAt(wx.data.hours, e.start_ts)) : null);
  const totals = useMemo(() => {
    const t: Record<string, { n: number; s: number }> = {};
    for (const e of d?.events ?? []) {
      t[e.kind] ??= { n: 0, s: 0 };
      t[e.kind].n++;
      t[e.kind].s += e.duration_s ?? 0;
    }
    return t;
  }, [d]);

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
                downloadCsv(`orbitlink-eventos-${range}.csv`, ["inicio_utc", "inicio_local", "fim_utc", "duracao_s", "tipo", "causa", "confianca", "clima_na_hora_estimado"], d!.events.map((e) => [new Date(e.start_ts * 1000).toISOString(), fmtDateTime(e.start_ts), e.end_ts ? new Date(e.end_ts * 1000).toISOString() : "", e.duration_s, e.kind, e.cause, e.confidence, wxNote(e) ?? ""]))
              }
            >
              <Download /> CSV
            </Button>
          </>
        }
      />
      {q.error && <QueryError error={q.error} onRetry={() => q.refetch()} />}
      <div className="mb-4 flex flex-wrap gap-2">
        {Object.entries(totals).map(([k, v]) => (
          <Badge key={k} tone={EVENT_META[k]?.tone ?? "neutral"}>
            {EVENT_META[k]?.label ?? k}: {v.n} · {fmtDuration(v.s)}
          </Badge>
        ))}
        {d && d.gaps.length > 0 && <Badge>Lacunas de observação: {d.gaps.length}</Badge>}
      </div>
      <Card className="mb-4">
        <CardHeader title="Cronologia" />
        <CardBody>{d ? <Timeline events={d.events} start={d.start} end={d.end} /> : <Skeleton className="h-28 w-full" />}</CardBody>
      </Card>
      <Card>
        <CardHeader title="Registro de eventos" subtitle="Clique para ver as evidências" />
        <CardBody>
          {q.isLoading && <Skeleton className="h-48 w-full" />}
          {d && !d.events.length && <EmptyState icon={<Unplug />} title="Nenhum evento registrado no período">Somente períodos observados pelo agente podem conter eventos.</EmptyState>}
          {d && d.events.length > 0 && (
            <div className="overflow-x-auto">
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
                    <tr key={e.id} className="border-b border-border/60 align-top">
                      <td className="py-2 pr-3 tabular">{fmtDateTime(e.start_ts)}</td>
                      <td className="py-2 pr-3 tabular">{e.open ? <Badge tone="warn">em andamento</Badge> : fmtDuration(e.duration_s)}</td>
                      <td className="py-2 pr-3">{EVENT_META[e.kind]?.label ?? e.kind}</td>
                      <td className="py-2 pr-3 text-fg-muted">{e.cause ?? "—"}</td>
                      <td className="py-2 pr-3">
                        <Badge tone={CONFIDENCE_META[e.confidence]?.tone} title={CONFIDENCE_META[e.confidence]?.help}>
                          {e.confidence}
                        </Badge>
                      </td>
                      {wxOn && (
                        <td className="py-2 pr-3 text-xs">
                          {wxNote(e) ? (
                            <span className="inline-flex items-start gap-1 text-accent" title="Estimativa regional do clima naquela hora. Coincidência, não causa.">
                              <CloudRain className="mt-px size-3.5 shrink-0" aria-hidden />
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
                          <pre className="mt-1 max-w-sm whitespace-pre-wrap text-[11px] text-fg-muted">{JSON.stringify(e.evidence, null, 2)}</pre>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </>
  );
}
