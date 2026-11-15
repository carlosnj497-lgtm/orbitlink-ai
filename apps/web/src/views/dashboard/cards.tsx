"use client";

import type { AgentInfo, Capability, EventsResponse, ObstructionResponse, Quality, ServerHealth, StatusResponse, UsagePlan, UsageSeries, UsageSummary } from "@astryon/shared";
import { ArrowRight, Bell, CircleCheck, CircleX, Cpu, Database, HardDrive, Info, LayoutDashboard, PieChart, RadioTower, Radar, SatelliteDish, Server, ShieldCheck, Sparkles, TriangleAlert, Unplug } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { ObstructionGrid } from "@/components/charts";
import { CoverageBar, QueryError, SourceBadge } from "@/components/domain";
import { hrefOf } from "@/components/shell/nav";
import { Badge, Card, CardBody, CardHeader, EmptyState, Skeleton, Tabs, Tip } from "@/components/ui/primitives";
import { type ApiError, useAgent } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useBasePath } from "@/lib/demo-context";
import { fmtAgo, fmtBytes, fmtBytesStr, fmtDateTime, fmtDay, fmtDuration, fmtHM, fmtNumber, fmtPct } from "@/lib/format";
import type { QualityPart, QualityScore } from "@/lib/quality-score";
import { EVENT_META } from "../shared";
import { num, Ring, type RowState, StateIcon, StatusRow } from "./parts";

/* ================================================================= Consumo de internet */
const DONUT_R = 40;
const DONUT_C = 2 * Math.PI * DONUT_R;

export function UsageCard({ usage, plan, series, className }: { usage: UsageSummary | undefined; plan: UsagePlan | undefined; series: UsageSeries | undefined; className?: string }) {
  const base = useBasePath();
  const m = usage?.month;
  const total = m?.bytes_total ?? 0;
  const downFrac = total > 0 && m ? m.bytes_download / total : 0;
  const upFrac = total > 0 && m ? m.bytes_upload / total : 0;
  const t = fmtBytes(m?.bytes_total);
  const proj = usage?.projection_month;
  const days = (series?.points ?? []).slice(-14);
  const dayMax = Math.max(1, ...days.map((d) => d.bytes_total));
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader
        title={
          <>
            Consumo de Internet <span className="font-normal text-fg-muted">(este mês)</span>
          </>
        }
        icon={<PieChart />}
        actions={usage && <SourceBadge source={usage.month.source} />}
      />
      <CardBody className="flex flex-1 flex-col gap-3">
        {!usage ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <div className="flex items-center gap-4">
              <div className="relative size-[100px] shrink-0">
                <svg viewBox="0 0 100 100" className="size-full -rotate-90" role="img" aria-label={total > 0 ? `Download ${fmtPct(downFrac * 100, 1)}, upload ${fmtPct(upFrac * 100, 1)} do consumo do mês` : "Sem consumo registrado neste mês"}>
                  <circle cx="50" cy="50" r={DONUT_R} fill="none" stroke="var(--surface-3)" strokeWidth="10" />
                  {total > 0 && (
                    <>
                      <circle cx="50" cy="50" r={DONUT_R} fill="none" stroke="var(--chart-down)" strokeWidth="10" strokeLinecap="butt" strokeDasharray={`${DONUT_C * downFrac} ${DONUT_C}`} />
                      <circle cx="50" cy="50" r={DONUT_R} fill="none" stroke="var(--chart-up)" strokeWidth="10" strokeLinecap="butt" strokeDasharray={`${DONUT_C * upFrac} ${DONUT_C}`} strokeDashoffset={-DONUT_C * downFrac} />
                    </>
                  )}
                </svg>
                <div className="absolute inset-0 grid place-items-center text-center leading-tight">
                  <p>
                    {total > 0 ? (
                      <>
                        <span className="tabular text-[15px] font-medium">{t.value}</span>
                        <span className="ml-0.5 text-[10px] font-medium text-fg-muted">{t.unit}</span>
                      </>
                    ) : (
                      <span className="text-base font-semibold text-fg-subtle">—</span>
                    )}
                    <br />
                    <span className="text-[10px] uppercase tracking-wide text-fg-subtle">Total</span>
                  </p>
                </div>
              </div>
              <dl className="min-w-0 flex-1 space-y-2 text-sm">
                {(
                  [
                    ["Download", "var(--chart-down)", m?.bytes_download, downFrac],
                    ["Upload", "var(--chart-up)", m?.bytes_upload, upFrac],
                  ] as const
                ).map(([label, color, bytes, frac]) => (
                  <div key={label} className="flex items-baseline justify-between gap-2">
                    <dt className="flex items-center gap-2 text-fg-muted">
                      <span className="size-2 rounded-full" style={{ background: color }} aria-hidden /> {label}
                    </dt>
                    <dd className="tabular text-right font-medium">
                      {total > 0 ? fmtBytesStr(bytes) : <span className="text-fg-subtle">—</span>}
                      {total > 0 && <span className="ml-1 text-xs font-normal text-fg-muted">{fmtPct(frac * 100, 0)}</span>}
                    </dd>
                  </div>
                ))}
                {total === 0 && <p className="text-xs leading-snug text-fg-subtle">Nenhum tráfego registrado ainda neste mês.</p>}
              </dl>
            </div>

            {days.length > 1 && (
              <div>
                <p className="mb-1 text-[11px] text-fg-subtle">Últimos {days.length} dias</p>
                <div className="flex h-9 items-end gap-[3px]" role="img" aria-label="Consumo por dia nos últimos dias">
                  {days.map((d) => (
                    <div key={d.t} title={`${fmtDay(d.t)}: ${fmtBytesStr(d.bytes_total)}`} className="flex-1 rounded-t-[2px] bg-accent-2/70 transition-colors hover:bg-accent" style={{ height: `${Math.max(4, (d.bytes_total / dayMax) * 100)}%` }} />
                  ))}
                </div>
              </div>
            )}

            <div className="mt-auto space-y-2 border-t border-border pt-3">
              {plan?.configured && plan.pct_used !== null ? (
                <div>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-fg-muted">
                      Franquia: <span className="tabular font-medium text-fg">{fmtBytesStr(plan.used.bytes_total)}</span> de {fmtBytesStr(plan.cap_bytes)}
                    </span>
                    <span className="tabular font-semibold">{fmtPct(plan.pct_used, 0)}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-label="Franquia consumida no ciclo" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(100, plan.pct_used))}>
                    <div className={cn("h-full rounded-full", plan.pct_used >= 100 ? "bg-crit" : plan.pct_used >= 80 || (plan.projected_pct ?? 0) >= 100 ? "bg-warn" : "bg-accent-2")} style={{ width: `${Math.min(100, plan.pct_used)}%` }} />
                  </div>
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="flex min-w-0 items-center gap-1.5 text-fg-muted">
                  {proj?.available ? (
                    <>
                      Projeção: <span className="tabular font-semibold text-fg">{fmtBytesStr(proj.bytes_total)}</span>
                    </>
                  ) : (
                    <>Projeção indisponível</>
                  )}
                  <Tip
                    content={
                      proj?.available
                        ? `Estimativa estatística, com incerteza${proj.low != null && proj.high != null ? ` (entre ${fmtBytesStr(proj.low)} e ${fmtBytesStr(proj.high)})` : ""}. ${proj.method ?? ""}`
                        : (proj?.reason ?? "Dados insuficientes para projetar o mês.")
                    }
                  >
                    <button type="button" aria-label="Sobre a projeção mensal" className="text-fg-subtle hover:text-fg">
                      <Info className="size-3.5" />
                    </button>
                  </Tip>
                </span>
                <CoverageBar coverage={usage.month.coverage} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] leading-snug text-fg-subtle">Estimativa local — não é o consumo oficial do plano.</p>
                <Link href={hrefOf(base, "consumo")} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-accent hover:underline">
                  Detalhes <ArrowRight className="size-3" />
                </Link>
              </div>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

/* ================================================================= Status da antena */
export function AntennaCard({ status, agent, className }: { status: StatusResponse | undefined; agent: AgentInfo | undefined; className?: string }) {
  const caps = useAgent<{ capabilities: Capability[] }>("capabilities", { refetchInterval: 60_000 });
  const st = status?.available ? status.status : null;
  const m = st?.metrics;
  const obstructed = m?.currently_obstructed?.value;
  const obstPct = num(m?.obstruction_pct?.value);
  const gps = m?.gps_valid?.value;
  const router = (caps.data?.capabilities ?? []).filter((c) => c.device === "router");
  const routerState: [RowState, string] = !caps.data
    ? ["unknown", "Verificando"]
    : !router.length
      ? ["unknown", "Não consultado"]
      : router.some((c) => c.available)
        ? ["ok", "API acessível"]
        : router.every((c) => c.status === "inalcancavel" || c.status === "timeout")
          ? ["fail", "Inacessível"]
          : ["unknown", "Sem suporte"];
  const link: [RowState, string] = !status
    ? ["unknown", "Carregando"]
    : !st
      ? [status.dish_reachable === false ? "fail" : "unknown", status.dish_reachable === false ? "Sem comunicação" : "Sem dados"]
      : st.state === "conectada"
        ? ["ok", "Normal"]
        : st.state === "offline"
          ? ["fail", "Offline"]
          : st.state === "desconhecida"
            ? ["unknown", "Desconhecido"]
            : ["warn", st.state === "degradada" ? "Degradada" : st.state === "buscando" ? "Buscando" : "Inicializando"];
  return (
    <Card className={className}>
      <CardHeader title="Status da Antena" icon={<RadioTower />} actions={status && <SourceBadge source={st ? (st.origin === "grpc" ? "real" : "demonstracao") : "indisponivel"} />} />
      <CardBody>
        {!status ? (
          <Skeleton className="h-52 w-full" />
        ) : (
          <>
            <ul className="divide-y divide-border">
              <StatusRow state={link[0]} label="Conexão via satélite" value={link[1]} />
              <StatusRow
                state={!st || obstructed === undefined ? "unknown" : obstructed ? "warn" : "ok"}
                label="Obstruções"
                value={
                  !st || obstructed === undefined ? (
                    "Não informado"
                  ) : (
                    <span className="flex flex-col items-end leading-tight">
                      <span>{obstructed ? "Obstruída agora" : "Livre agora"}</span>
                      {obstPct !== null && <span className="tabular text-[11px] font-normal text-fg-muted">{fmtPct(obstPct, 1)} do tempo obstruído</span>}
                    </span>
                  )
                }
              />
              <StatusRow state={!st ? "unknown" : st.alerts.length ? "warn" : "ok"} label="Alertas da antena" value={!st ? "Não informado" : st.alerts.length ? st.alerts.join(", ") : "Nenhum"} />
              {gps !== undefined && <StatusRow state={gps ? "ok" : "warn"} label="GPS" value={gps ? "Válido" : "Sem posição"} />}
              <StatusRow state={st?.device.software_version ? "ok" : "unknown"} label="Firmware" value={st?.device.software_version ?? agent?.firmware ?? "Não identificado"} plain />
              <StatusRow state={routerState[0]} label="Roteador Starlink" value={routerState[1]} />
              <StatusRow
                state={!st ? (status.dish_reachable === false ? "fail" : "unknown") : status.available && status.stale ? "warn" : "ok"}
                label="Última comunicação"
                value={agent?.last_status_ts ? fmtAgo(agent.last_status_ts) : "nunca"}
                plain
              />
            </ul>
            <p className="mt-2 text-[11px] leading-snug text-fg-subtle">Temperatura e modo de energia não são informados pela API local; superaquecimento aparece em “Alertas da antena”.</p>
          </>
        )}
      </CardBody>
    </Card>
  );
}

/* ================================================================= Interrupções (24 h) */
const DAY = 86400;
const OUTAGE_TONE: Record<string, string> = { outage: "bg-crit", status_outage: "bg-crit", ping_drop: "bg-warn", unreachable: "bg-fg-subtle" };

export function OutagesCard({ events, error, className }: { events: EventsResponse | undefined; error: ApiError | null; className?: string }) {
  const base = useBasePath();
  const end = events?.end ?? 0;
  const from = end - DAY;
  const dur = (e: EventsResponse["events"][number]) => e.duration_s ?? (e.open ? Math.max(0, end - e.start_ts) : 0);
  const all = (events?.events ?? []).filter((e) => e.kind !== "boot");
  const last = all.filter((e) => e.start_ts >= from);
  const prev = all.filter((e) => e.start_ts >= from - DAY && e.start_ts < from);
  const total = last.reduce((a, e) => a + dur(e), 0);
  const longest = last.reduce((a, e) => Math.max(a, dur(e)), 0);
  const latest = last.reduce((a, e) => Math.max(a, e.start_ts), 0);
  const delta = last.length - prev.length;
  const reasons = Object.entries(
    last.reduce<Record<string, number>>((acc, e) => {
      const label = e.cause && e.kind !== "ping_drop" ? `${EVENT_META[e.kind]?.label ?? e.kind} · ${e.cause}` : (EVENT_META[e.kind]?.label ?? e.kind);
      acc[label] = (acc[label] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  const hadGaps = (events?.gaps ?? []).some((g) => (g.end_ts ?? end) >= from);
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader
        title={
          <>
            Interrupções <span className="font-normal text-fg-muted">(24 h)</span>
          </>
        }
        icon={<Unplug />}
        actions={
          <Link href={hrefOf(base, "interrupcoes")} className="text-xs font-medium text-accent hover:underline">
            ver tudo
          </Link>
        }
      />
      <CardBody className="flex flex-1 flex-col">
        {error ? (
          <QueryError error={error} />
        ) : !events ? (
          <Skeleton className="h-44 w-full" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className={cn("tabular text-3xl font-semibold leading-none", last.length ? "text-fg" : "text-ok")}>{last.length}</p>
                <p className="mt-1 text-xs text-fg-muted">{last.length === 1 ? "interrupção" : "interrupções"}</p>
              </div>
              <div>
                <p className="text-xs text-fg-muted">Tempo total fora do ar</p>
                <p className="tabular mt-0.5 text-lg font-semibold">{fmtDuration(total)}</p>
              </div>
            </div>
            <div className="mt-4">
              <div className="relative h-7 rounded-md border border-border bg-bg-elev" role="img" aria-label={`Linha do tempo das últimas 24 horas: ${last.length} interrupções`}>
                {[0.25, 0.5, 0.75].map((f) => (
                  <span key={f} className="absolute inset-y-0 w-px bg-border" style={{ left: `${f * 100}%` }} aria-hidden />
                ))}
                {last.map((e) => (
                  <span
                    key={e.id}
                    title={`${EVENT_META[e.kind]?.label ?? e.kind} · ${fmtDateTime(e.start_ts)} · ${e.open ? "em andamento" : fmtDuration(e.duration_s)}`}
                    className={cn("absolute inset-y-1 min-w-[4px] rounded-sm", OUTAGE_TONE[e.kind] ?? "bg-warn")}
                    style={{ left: `${Math.max(0, Math.min(99, ((e.start_ts - from) / DAY) * 100))}%`, width: `${Math.min(100, (dur(e) / DAY) * 100)}%` }}
                  />
                ))}
              </div>
              <div className="tabular mt-1 flex justify-between text-[10.5px] text-fg-subtle" aria-hidden>
                {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                  <span key={f}>{f === 1 ? "agora" : fmtHM(from + f * DAY)}</span>
                ))}
              </div>
            </div>
            {reasons.length > 0 ? (
              <ul className="mt-3 space-y-1 text-xs text-fg-muted">
                {reasons.slice(0, 3).map(([label, n]) => (
                  <li key={label} className="flex items-center justify-between gap-2">
                    <span className="truncate">{label}</span>
                    <span className="tabular shrink-0 font-medium text-fg">{n}×</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-xs text-fg-muted">Nenhuma interrupção registrada no período observado.</p>
            )}
            {last.length > 0 && (
              <dl className="mt-auto grid grid-cols-2 gap-3 border-t border-border pt-3">
                <div>
                  <dt className="ol-label">Maior</dt>
                  <dd className="tabular mt-1 text-sm font-medium text-fg">{fmtDuration(longest)}</dd>
                </div>
                <div>
                  <dt className="ol-label">Última</dt>
                  <dd className="tabular mt-1 text-sm font-medium text-fg">{fmtAgo(latest)}</dd>
                </div>
              </dl>
            )}
            <p className={cn("pt-3 text-[11px] text-fg-subtle", last.length === 0 && "mt-auto")}>
              24 h anteriores: <span className="tabular font-medium text-fg-muted">{prev.length}</span>
              {delta !== 0 && <span className={delta > 0 ? "text-warn" : "text-ok"}> ({delta > 0 ? `+${delta}` : delta})</span>}
              {hadGaps && " · houve lacunas de observação: eventos nesses trechos não seriam vistos"}
            </p>
          </>
        )}
      </CardBody>
    </Card>
  );
}

/* ================================================================= Qualidade da conexão */
function partState(p: QualityPart): RowState {
  if (p.points === null) return "unknown";
  const f = p.points / p.max;
  return f >= 0.8 ? "ok" : f >= 0.5 ? "warn" : "fail";
}

function partValue(p: QualityPart): string {
  if (p.value === null) return "Não informado";
  if (p.key === "latency") return `${fmtNumber(p.value, 0)} ms`;
  if (p.key === "stability") return `${fmtPct(p.value, 2)} disponível`;
  return fmtPct(p.value, 2);
}

export function QualityCard({ quality, score, className }: { quality: Quality | undefined; score: QualityScore | null; className?: string }) {
  const base = useBasePath();
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader
        title={
          <>
            Qualidade da Conexão <span className="font-normal text-fg-muted">(24 h)</span>
          </>
        }
        icon={<ShieldCheck />}
        actions={
          <>
            <Tip content="Pontuação de 0 a 100 calculada pelo painel: estabilidade (40 pts, disponibilidade de 95% a 100%), perda de pacotes (25 pts, de 5% a 0%), latência mediana (20 pts, de 150 ms a 40 ms) e obstruções (15 pts, de 10% a 0%). Sem medições reais suficientes, nenhuma nota é exibida.">
              <button type="button" aria-label="Como a pontuação é calculada" className="text-fg-subtle hover:text-fg">
                <Info className="size-4" />
              </button>
            </Tip>
            {quality && <SourceBadge source={quality.source === "demonstracao" ? "demonstracao" : score ? "calculada" : "indisponivel"} />}
          </>
        }
      />
      <CardBody className="flex flex-1 flex-col">
        {!quality ? (
          <Skeleton className="h-44 w-full" />
        ) : (
          <>
            <div className="flex items-center gap-4">
              <Ring value={score?.score ?? null} tone={score?.tone ?? "neutral"} className="size-[116px]">
                <p className="leading-tight">
                  <span className="tabular text-[26px] font-semibold">{score ? score.score : "—"}</span>
                  <br />
                  <span className={cn("text-xs font-medium", score ? (score.tone === "ok" ? "text-ok" : score.tone === "warn" ? "text-warn" : "text-crit") : "text-fg-subtle")}>{score ? score.label : "sem nota"}</span>
                </p>
              </Ring>
              {score ? (
                <ul className="min-w-0 flex-1 space-y-2 text-sm">
                  {score.parts.map((p) => (
                    <li key={p.key} className="flex items-center gap-2">
                      <StateIcon state={partState(p)} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-fg">{p.label}</span>
                        <span className="tabular block truncate text-[11px] text-fg-subtle">{partValue(p)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="min-w-0 flex-1 text-sm text-fg-muted">Dados insuficientes nas últimas 24 h para calcular a pontuação. Ela aparece quando houver medições reais de disponibilidade, perda e latência.</p>
              )}
            </div>
            <div className="mt-auto flex items-center justify-between gap-2 pt-3">
              <CoverageBar coverage={quality.coverage} />
              <Link href={hrefOf(base, "qualidade")} className="text-xs font-medium text-accent hover:underline">
                Detalhes
              </Link>
            </div>
            {score?.partial && <p className="mt-1 text-[11px] text-fg-subtle">Obstrução não informada pelo firmware: nota calculada com os outros três critérios.</p>}
          </>
        )}
      </CardBody>
    </Card>
  );
}

/* ================================================================= Mapa de cobertura (céu visto pela antena) */
export function CoverageCard({ status, className }: { status: StatusResponse | undefined; className?: string }) {
  const base = useBasePath();
  const q = useAgent<ObstructionResponse>("obstruction?range=7d", { refetchInterval: 300_000 });
  const map = q.data?.map;
  const loading = !q.data && !q.error;
  const unreachable = status?.dish_reachable === false;
  const waiting = q.data?.map_capability?.status === "verificada";
  const needsConnection = !map && (unreachable || !!q.error);
  const emptyTitle = q.error ? "Falha ao consultar o mapa" : unreachable ? "Antena sem comunicação" : waiting ? "Aguardando primeira captura" : "Mapa ainda indisponível";
  const emptyDescription = q.error
    ? "Verifique a conexão com o agente para recuperar a leitura."
    : unreachable
      ? "Restabeleça a conexão para consultar a visibilidade do céu."
      : waiting
        ? "O mapa aparecerá após a próxima coleta da antena."
        : "O firmware ainda não disponibilizou o mapa de obstruções.";
  return (
    <Card aria-label="Mapa de cobertura" className={cn("flex min-w-0 flex-col overflow-hidden", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-accent/20 bg-accent/10 text-accent">
            <Radar className="size-[18px]" aria-hidden />
          </span>
          <div>
            <h3 className="text-sm font-semibold tracking-tight">Mapa de Cobertura</h3>
            <p className="mt-0.5 text-[11px] text-fg-muted">Visibilidade do céu</p>
          </div>
        </div>
        <Badge tone={map ? "accent" : "neutral"} className="gap-1.5 text-[10px]">
          <span className={cn("size-1.5 rounded-full", map ? "bg-accent" : "bg-fg-subtle")} aria-hidden />
          {map ? "Disponível" : loading ? "Consultando" : "Sem mapa"}
        </Badge>
      </div>
      <CardBody className="flex flex-1 flex-col gap-3">
        <div aria-busy={loading} className={cn("relative grid place-items-center overflow-hidden rounded-md border border-border bg-bg-elev/70", map ? "h-56" : "min-h-44")}>
          {loading ? (
            <Skeleton className="size-full rounded-none" />
          ) : map ? (
            <ObstructionGrid rows={map.num_rows} cols={map.num_cols} snr={map.snr} className="aspect-square h-[92%]" />
          ) : (
            <div className="flex flex-col items-center px-5 py-5 text-center">
              <span className="grid size-12 place-items-center rounded-full border border-border-strong bg-surface text-fg-muted ring-4 ring-surface/40">
                <SatelliteDish className="size-5" aria-hidden />
              </span>
              <p className="mt-3 text-sm font-medium text-fg">{emptyTitle}</p>
              <p className="mt-1 max-w-[32ch] text-xs leading-relaxed text-fg-muted">{emptyDescription}</p>
            </div>
          )}
        </div>
        {map && (
          <div className="space-y-2">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-muted">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm bg-accent" aria-hidden /> céu livre
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm bg-warn" aria-hidden /> parcial
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm bg-crit" aria-hidden /> obstruído
              </span>
            </p>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-fg-subtle">
              <span>Capturado {fmtAgo(map.ts)}</span>
              <SourceBadge source={map.source} />
            </div>
          </div>
        )}
        <div className="mt-auto space-y-2.5">
          <Link href={hrefOf(base, needsConnection ? "instalacao" : "obstrucoes")} className="group flex min-h-9 items-center justify-between gap-2 rounded-lg border border-accent/25 bg-accent/10 px-3 py-2 text-xs font-medium text-accent transition-colors hover:border-accent/50 hover:bg-accent/15">
            {needsConnection ? "Verificar conexão" : "Explorar obstruções"}
            <ArrowRight className="size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
          <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-fg-subtle">
            <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
            Visão do céu informada pela antena, sem localização geográfica.
          </p>
        </div>
      </CardBody>
    </Card>
  );
}

/* ================================================================= Alertas e eventos */
interface AlertEvent {
  id: number;
  rule_name: string;
  status: "active" | "resolved";
  severity: string;
  started_at: number;
  resolved_at: number | null;
  message: string;
}

interface FeedItem {
  key: string;
  type: "alert" | "conn";
  ts: number;
  state: RowState;
  title: string;
  detail: string;
  badge: { tone: "crit" | "warn" | "ok" | "neutral"; label: string };
  /** Evento de conexão já encerrado: histórico, sem cor de alerta. */
  past?: boolean;
}

const KIND_STATE: Record<string, RowState> = { outage: "fail", status_outage: "fail", ping_drop: "warn", unreachable: "unknown", boot: "unknown" };

export function EventsCard({ events, className }: { events: EventsResponse | undefined; className?: string }) {
  const base = useBasePath();
  const [filter, setFilter] = useState("all");
  const alerts = useAgent<{ events: AlertEvent[] }>("alerts/events?status=all&limit=100", { refetchInterval: 30_000 });
  const feed: FeedItem[] = [
    ...(alerts.data?.events ?? []).map<FeedItem>((a) => ({
      key: `a${a.id}`,
      type: "alert",
      ts: a.started_at,
      state: a.status === "resolved" ? "ok" : a.severity === "crit" ? "fail" : "warn",
      title: a.rule_name,
      detail: a.message,
      badge: a.status === "active" ? { tone: a.severity === "crit" ? "crit" : "warn", label: "ativo" } : { tone: "ok", label: "resolvido" },
    })),
    ...(events?.events ?? []).map<FeedItem>((e) => ({
      key: `c${e.id}`,
      type: "conn",
      ts: e.start_ts,
      state: e.open ? (KIND_STATE[e.kind] ?? "warn") : KIND_STATE[e.kind] === "unknown" ? "unknown" : "warn",
      title: EVENT_META[e.kind]?.label ?? e.kind,
      detail: e.cause && e.kind !== "ping_drop" ? e.cause : "",
      badge: e.open ? { tone: "crit", label: "em andamento" } : { tone: "neutral", label: fmtDuration(e.duration_s) },
      past: !e.open,
    })),
  ]
    .filter((i) => filter === "all" || i.type === filter)
    .sort((a, b) => b.ts - a.ts);
  const active = (alerts.data?.events ?? []).filter((a) => a.status === "active").length;
  const loading = !alerts.data && !events;
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader title="Alertas e Eventos" icon={<Bell />} actions={active > 0 ? <Badge tone="crit">{active} ativo{active > 1 ? "s" : ""}</Badge> : undefined} />
      <CardBody className="flex flex-1 flex-col">
        <Tabs
          label="Filtrar eventos"
          value={filter}
          onValueChange={setFilter}
          className="self-start"
          items={[
            { value: "all", label: "Todos" },
            { value: "alert", label: "Alertas" },
            { value: "conn", label: "Conexão" },
          ]}
        />
        {loading ? (
          <Skeleton className="mt-3 h-40 w-full" />
        ) : feed.length === 0 ? (
          <EmptyState className="py-7" icon={<CircleCheck />} title="Nada registrado">
            {filter === "alert" ? "Nenhum alerta disparado recentemente." : "Nenhum evento nos últimos 7 dias."}
          </EmptyState>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {feed.slice(0, 6).map((i) => (
              <li key={i.key} className="flex items-start gap-2.5 py-2.5">
                <span className="mt-0.5">
                  {/* evento já encerrado: mesmo ícone, sem a cor de alerta (é histórico, não um problema agora) */}
                  <StateIcon state={i.state} className={i.past ? "text-fg-subtle" : undefined} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-fg">
                    {i.title}
                    {i.detail && <span className="text-fg-muted"> · {i.detail}</span>}
                  </p>
                  <p className="tabular text-[11px] text-fg-subtle">{fmtDateTime(i.ts)}</p>
                </div>
                <Badge tone={i.badge.tone} className="shrink-0">
                  {i.badge.label}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        <Link
          href={hrefOf(base, filter === "alert" ? "alertas" : "interrupcoes")}
          className="mt-auto flex items-center justify-center gap-1.5 rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-xs font-medium text-accent transition-colors hover:bg-accent/15"
        >
          Ver histórico completo <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </CardBody>
    </Card>
  );
}

/* ================================================================= Serviços e integrações */
const SVC_DOT: Record<RowState, string> = { ok: "bg-ok", warn: "bg-warn", fail: "bg-crit", unknown: "bg-fg-subtle" };
const SVC_TEXT: Record<RowState, string> = { ok: "text-ok", warn: "text-warn", fail: "text-crit", unknown: "text-fg-muted" };

function Service({ icon, name, state, label, detail }: { icon: ReactNode; name: string; state: RowState; label: string; detail?: string }) {
  return (
    <li className="flex items-start gap-3 rounded-md border border-border bg-bg-elev/60 px-3 py-2.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-md border border-border-strong bg-surface text-accent [&>svg]:size-[18px] [&>svg]:stroke-[1.75]">{icon}</span>
      <div className="min-w-0 flex-1 leading-tight">
        <p className="line-clamp-2 text-[13px] font-medium text-fg">{name}</p>
        {detail && <p className="line-clamp-2 text-[11px] text-fg-subtle [overflow-wrap:anywhere]">{detail}</p>}
        <p className={cn("mt-1.5 flex items-center gap-1.5 text-xs font-medium", SVC_TEXT[state])}>
          <span className={cn("size-1.5 rounded-full", SVC_DOT[state], state === "ok" && "ol-live text-ok")} aria-hidden />
          {label}
        </p>
      </div>
    </li>
  );
}

export function ServicesCard({ agent, agentError, className }: { agent: AgentInfo | undefined; agentError: ApiError | null; className?: string }) {
  const esp = useAgent<{ enabled?: boolean; nodes?: { online: boolean }[] }>("esp32/nodes", { refetchInterval: 15_000 });
  const loops = Object.entries(agent?.loops ?? {});
  const failing = loops.filter(([, l]) => l.consecutive_failures > 0);
  const syncFail = failing.some(([k]) => k.includes("sync"));
  const nodes = esp.data?.nodes ?? [];
  const online = nodes.filter((n) => n.online).length;
  const off: [RowState, string] = ["unknown", "Sem dados"];
  const agentSvc: [RowState, string] = agentError ? ["fail", "Offline"] : agent ? ["ok", "Online"] : ["unknown", "Verificando"];
  const supa: [RowState, string] = !agent ? off : !agent.supabase_configured ? ["unknown", "Não configurado"] : syncFail ? ["fail", "Erro de sincronização"] : agent.sync_pending > 0 ? ["warn", `${fmtNumber(agent.sync_pending, 0)} pendentes`] : ["ok", "Sincronizado"];
  const dish: [RowState, string] = !agent ? off : agent.dish_reachable ? ["ok", "Acessível"] : agent.dish_reachable === false ? ["fail", "Inacessível"] : ["unknown", "Verificando"];
  const srv = useAgent<ServerHealth>("ops/health", { refetchInterval: 60_000 });
  const sh = srv.data;
  const srvSvc: [RowState, string] = !sh
    ? off
    : (sh.disk.free_pct !== null && sh.disk.free_pct < 10) || (sh.cpu_temp_c !== null && sh.cpu_temp_c >= 85)
      ? ["warn", sh.disk.free_pct !== null && sh.disk.free_pct < 10 ? "Pouco disco livre" : "Temperatura alta"]
      : ["ok", "Saudável"];
  const srvDetail = sh
    ? [sh.cpu_temp_c !== null ? `${fmtNumber(sh.cpu_temp_c, 0)} °C` : null, sh.disk.free_pct !== null ? `${fmtNumber(sh.disk.free_pct, 0)}% livre` : null, sh.last_backup_at ? `backup ${fmtAgo(sh.last_backup_at)}` : "sem backup ainda"].filter(Boolean).join(" · ")
    : "Temperatura, disco e backup";
  const espSvc: [RowState, string] = !esp.data ? off : !esp.data.enabled ? ["unknown", "Não configurado"] : !nodes.length ? ["unknown", "Nenhum nó pareado"] : online ? ["ok", `${online} de ${nodes.length} online`] : ["warn", "Nós offline"];
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader title="Serviços e Integrações" icon={<Server />} />
      <CardBody className="flex flex-1 flex-col">
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 min-[105rem]:grid-cols-6">
          <Service icon={<Server />} name="Agente local" detail={agent ? `Python/FastAPI · v${agent.version}${agent.mode === "fixture" ? " · fixture" : ""}` : "Python/FastAPI"} state={agentSvc[0]} label={agentSvc[1]} />
          <Service icon={<LayoutDashboard />} name="Dashboard" detail="Next.js · esta página" state="ok" label="Online" />
          <Service icon={<SatelliteDish />} name="Comunicação com a Starlink" detail={agent?.dish_target ? `API local · ${agent.dish_target}` : "API local (gRPC)"} state={dish[0]} label={dish[1]} />
          <Service icon={<Database />} name="Supabase" detail="Sincronização opcional" state={supa[0]} label={supa[1]} />
          <Service icon={<Cpu />} name="ESP32" detail="Sensores opcionais" state={espSvc[0]} label={espSvc[1]} />
          <Service icon={<HardDrive />} name="Servidor" detail={srvDetail} state={srvSvc[0]} label={srvSvc[1]} />
        </ul>
        {agent && (
          <p className="mt-auto pt-3 text-[11px] leading-snug text-fg-subtle">
            Coleta: {fmtNumber(agent.history_lost_total, 0)} amostra(s) perdida(s)
            {failing.length > 0 && <span className="text-warn"> · falhando: {failing.map(([k, l]) => `${k} (${l.last_error_kind ?? "erro"})`).join(", ")}</span>}
          </p>
        )}
      </CardBody>
    </Card>
  );
}

/* ================================================================= Diagnóstico por regras */
interface DiagnosticSummary {
  engine: "regras" | "groq";
  headline: string;
  findings: { severity: "info" | "warn" | "crit"; kind: "evento_observado" | "hipotese" | "causa_confirmada"; text: string; evidence: string }[];
}

export function DiagnosticsCard({ className }: { className?: string }) {
  const base = useBasePath();
  const { data, error, isLoading } = useAgent<DiagnosticSummary>("diagnostics/summary?range=24h", { refetchInterval: 60_000 });
  return (
    <Card className={className}>
      <CardHeader
        title={
          <>
            Diagnóstico <span className="font-normal text-fg-muted">(24 h)</span>
          </>
        }
        icon={<Sparkles />}
        subtitle={data ? `Motor: ${data.engine === "regras" ? "regras determinísticas" : "Groq"} · baseado somente em dados registrados` : undefined}
        actions={
          <Link href={hrefOf(base, "diagnosticos")} className="text-xs font-medium text-accent hover:underline">
            Abrir diagnósticos
          </Link>
        }
      />
      <CardBody>
        {isLoading && <Skeleton className="h-16 w-full" />}
        {error && <QueryError error={error} />}
        {data && (
          <>
            <p className="text-sm text-fg">{data.headline}</p>
            <ul className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2.5 md:grid-cols-2 xl:grid-cols-3">
              {data.findings.slice(0, 4).map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  {f.severity === "crit" ? <CircleX className="mt-0.5 size-4 shrink-0 text-crit" aria-hidden /> : <TriangleAlert className={cn("mt-0.5 size-4 shrink-0", f.severity === "warn" ? "text-warn" : "text-fg-subtle")} aria-hidden />}
                  <div className="min-w-0">
                    <p className="text-fg">{f.text}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-fg-subtle">
                      <Badge tone={f.kind === "causa_confirmada" ? "accent" : "neutral"}>{f.kind === "causa_confirmada" ? "causa confirmada" : f.kind === "hipotese" ? "hipótese" : "evento observado"}</Badge>
                      {f.evidence}
                    </p>
                  </div>
                </li>
              ))}
              {!data.findings.length && <li className="text-sm text-fg-muted">Nenhuma anomalia detectada no período observado.</li>}
            </ul>
          </>
        )}
      </CardBody>
    </Card>
  );
}
