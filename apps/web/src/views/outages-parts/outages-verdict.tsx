import type { ConnectionEvent, EventsResponse } from "@astryon/shared";
import type { ReactNode } from "react";
import { fmtAgo, fmtDateTime, fmtDuration } from "@/lib/format";
import { N, type VerdictTone } from "../overview-parts/verdict";
import { causeText, EVENT_META } from "../shared";

/** Tipos que contam como queda da conexão. "Antena inacessível" é falha local de comunicação e fica à parte. */
export const DROP_KINDS = new Set(["outage", "status_outage", "ping_drop", "power_loss"]);

export const RANGE_PHRASE: Record<string, string> = { "24h": "nas últimas 24 h", "7d": "nos últimos 7 dias", "30d": "nos últimos 30 dias" };

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Rótulo de causa: a causa informada pela antena quando existe; senão, o tipo do evento. */
export function causeLabel(e: ConnectionEvent): string {
  return e.cause && e.kind !== "ping_drop" ? (causeText(e.cause) ?? e.cause) : (EVENT_META[e.kind]?.label ?? e.kind);
}

export interface OutageFacts {
  drops: ConnectionEvent[];
  unreachable: ConnectionEvent[];
  total: number;
  longest: ConnectionEvent | null;
  latest: ConnectionEvent | null;
  open: ConnectionEvent | null;
  causes: { label: string; n: number; s: number; confirmed: boolean }[];
}

export function outageFacts(events: ConnectionEvent[]): OutageFacts {
  const drops = events.filter((e) => DROP_KINDS.has(e.kind));
  const unreachable = events.filter((e) => e.kind === "unreachable");
  const by = new Map<string, { label: string; n: number; s: number; confirmed: boolean }>();
  for (const e of drops) {
    const label = causeLabel(e);
    const c = by.get(label) ?? { label, n: 0, s: 0, confirmed: false };
    c.n += 1;
    c.s += e.duration_s ?? 0;
    c.confirmed ||= e.confidence === "confirmado";
    by.set(label, c);
  }
  return {
    drops,
    unreachable,
    total: drops.reduce((a, e) => a + (e.duration_s ?? 0), 0),
    longest: drops.reduce<ConnectionEvent | null>((a, e) => ((e.duration_s ?? 0) > (a?.duration_s ?? -1) ? e : a), null),
    latest: drops.reduce<ConnectionEvent | null>((a, e) => (e.start_ts > (a?.start_ts ?? 0) ? e : a), null),
    open: drops.find((e) => e.open) ?? null,
    causes: [...by.values()].sort((a, b) => b.n - a.n || b.s - a.s),
  };
}

export interface OutagesVerdictText {
  tone: VerdictTone;
  word: string;
  headline: ReactNode;
  detail: ReactNode;
}

/** Responde "quando caiu, quanto tempo e por quê?" com os eventos do período e filtro escolhidos. */
export function outagesVerdict(d: EventsResponse, range: string, kind: string, now: number | null): OutagesVerdictText {
  const when = RANGE_PHRASE[range] ?? "no período";
  const gapNote =
    d.gaps.length > 0 ? (
      <>
        {" "}
        Houve <N>{d.gaps.length}</N> {plural(d.gaps.length, "lacuna", "lacunas")} de observação: quedas nesses trechos não seriam vistas.
      </>
    ) : null;

  if (kind) {
    const label = EVENT_META[kind]?.label ?? kind;
    const n = d.events.length;
    const s = d.events.reduce((a, e) => a + (e.duration_s ?? 0), 0);
    return {
      tone: n === 0 ? "ok" : DROP_KINDS.has(kind) ? "warn" : "unknown",
      word: n === 0 ? "Nenhum" : `${n} ${plural(n, "evento", "eventos")}`,
      headline: n === 0 ? `Nenhum evento do tipo “${label}” ${when}.` : <>{n === 1 ? "Um evento" : <><N>{n}</N> eventos</>} do tipo “{label}” {when}, somando <N>{fmtDuration(s)}</N>.</>,
      detail: <>Filtro ativo: escolha “Todos os tipos” para ver quedas, perdas de contato e reinícios juntos.{gapNote}</>,
    };
  }

  const f = outageFacts(d.events);
  const unreach =
    f.unreachable.length > 0 ? (
      <>
        {" "}
        O agente também perdeu contato com a antena <N>{f.unreachable.length}×</N> (<N>{fmtDuration(f.unreachable.reduce((a, e) => a + (e.duration_s ?? 0), 0))}</N>): falha de comunicação local, não necessariamente queda.
      </>
    ) : null;

  if (f.drops.length === 0) {
    return {
      tone: "ok",
      word: "Sem quedas",
      headline: `Nenhuma queda registrada ${when}.`,
      detail: <>Somente períodos observados pelo agente podem conter eventos.{unreach}{gapNote}</>,
    };
  }

  const top = f.causes[0];
  const why = top ? (
    <>
      Causa mais frequente: <span className="text-fg">{top.label}</span> (<N>{top.n}×</N>){top.confirmed ? ", reportada pela antena" : ", inferida das amostras (a origem exata não é determinada)"}.
    </>
  ) : null;

  if (f.open) {
    return {
      tone: "crit",
      word: "Em andamento",
      headline: (
        <>
          A conexão está caída agora, desde <N>{fmtDateTime(f.open.start_ts)}</N>
          {f.drops.length > 1 && (
            <>
              ; foram <N>{f.drops.length}</N> quedas {when}
            </>
          )}
          .
        </>
      ),
      detail: (
        <>
          {why}
          {unreach}
          {gapNote}
        </>
      ),
    };
  }

  const latest = f.latest!;
  return {
    tone: "warn",
    word: `${f.drops.length} ${plural(f.drops.length, "queda", "quedas")}`,
    headline: (
      <>
        {f.drops.length === 1 ? "Uma queda" : <><N>{f.drops.length}</N> quedas</>} {when}, somando <N>{fmtDuration(f.total)}</N> fora do ar; a última foi {now ? fmtAgo(latest.start_ts, now) : <>em <N>{fmtDateTime(latest.start_ts)}</N></>} e durou <N>{fmtDuration(latest.duration_s)}</N>.
      </>
    ),
    detail: (
      <>
        {why}
        {f.longest && f.drops.length > 1 && (
          <>
            {" "}
            A maior durou <N>{fmtDuration(f.longest.duration_s)}</N>, em <N>{fmtDateTime(f.longest.start_ts)}</N>.
          </>
        )}
        {unreach}
        {gapNote}
      </>
    ),
  };
}
