"use client";

import type { ObstructionResponse, StatusResponse, WeatherHourly } from "@astryon/shared";
import { AlertOctagon, AlertTriangle, ArrowRight, CheckCircle2, CloudRain, CloudSun, Expand, Info, Map as MapIcon, Radar, RefreshCw, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { memo, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ObstructionGrid } from "@/components/charts";
import { CAP_META, PageHeader, QueryError, SourceBadge } from "@/components/domain";
import { hrefOf } from "@/components/shell/nav";
import { Button, Callout, Card, CardBody, CardHeader, Dialog, EmptyState, Skeleton, Tip } from "@/components/ui/primitives";
import { useAgent, useStatusInterval } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useBasePath } from "@/lib/demo-context";
import { fmtDateTime, fmtDuration, fmtPct } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { isNotableRain, rainBands, RAIN_META } from "@/lib/weather";
import { SectionHead } from "./antenna-parts/section";
import { type PartState, StateLight, SystemDiagram } from "./antenna-parts/system-diagram";
import { GapNote } from "./shared";

/** Acima disto a fração obstruída pede atenção (mesmo limite da tela Antena). */
const LIMIT = 5;

/** Cores iguais às do mapa (canvas): céu livre, sinal parcial, obstruído, sem dado. */
const MAP_KEY = [
  { label: "céu livre", swatch: "bg-[rgb(56_189_248/0.55)]" },
  { label: "sinal parcial", swatch: "bg-[rgb(232_185_49/0.75)]" },
  { label: "obstruído", swatch: "bg-[rgb(255_70_85/0.9)]" },
  { label: "sem dado", swatch: "border border-border-strong bg-bg-elev" },
];

/** Resumo em cards visuais, alinhado com o novo idioma da tela Antena. */
function SummaryCard({
  icon: Icon,
  label,
  value,
  state,
  note,
  loading,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  state: PartState;
  note?: string;
  loading?: boolean;
}) {
  return (
    <Card className="min-w-0 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="ol-hud grid size-8 place-items-center rounded-md border border-border bg-bg-elev text-fg-muted">
            <Icon className="size-4" />
          </span>
          <p className="text-sm font-medium text-fg">{label}</p>
        </div>
        {loading ? <Skeleton className="h-5 w-24" /> : <StateLight state={state} label="" className="gap-0" />}
      </div>
      <p className="mt-2.5 text-lg font-semibold tracking-[-0.02em] text-fg">{loading ? <Skeleton className="h-6 w-32" /> : value}</p>
      {note && <p className="mt-0.5 text-[11px] text-fg-subtle">{note}</p>}
    </Card>
  );
}

const ObstructionTrendChart = memo(function ObstructionTrendChart({
  trend,
  rain,
  rangeLabel,
}: {
  trend: ObstructionResponse["trend"];
  rain: ReturnType<typeof rainBands>;
  rangeLabel: string;
}) {
  const shown = trend.slice(-72);
  const data = shown.map((t) => ({ t: t.t, pct: t.obstruction_pct }));

  return (
    <div className="space-y-2">
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              domain={[data[0]?.t ?? 0, data[data.length - 1]?.t ?? 0]}
              scale="time"
              tickFormatter={(v: number) => {
                const d = new Date(v * 1000);
                return rangeLabel.includes("h") ? `${String(d.getHours()).padStart(2, "0")}h` : `${d.getDate()}/${String(d.getMonth() + 1)}`;
              }}
              minTickGap={48}
              stroke="var(--fg-subtle)"
              fontSize={10.5}
              tickLine={false}
              axisLine={false}
            />
            <YAxis stroke="var(--fg-subtle)" fontSize={10.5} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${Math.round(v)}%`} width={44} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0]?.payload as { t: number; pct: number | null };
                return (
                  <div className="ol-hud rounded-md border border-border-strong bg-bg-elev/95 px-3 py-2 text-xs shadow-[0_14px_30px_-12px_rgb(0_0_0/0.95)] backdrop-blur-sm">
                    <p className="tabular mb-1.5 text-[11px] text-fg-subtle">{fmtDateTime(p.t)}</p>
                    <p className="tabular font-medium text-fg">{p.pct === null ? "sem dado" : fmtPct(p.pct, 2)} obstruído</p>
                  </div>
                );
              }}
            />
            {rain.map((r, i) => (
              <ReferenceArea
                key={`rain-${i}`}
                x1={r.start}
                x2={r.end}
                fill="var(--chart-rain, rgb(56 189 248))"
                fillOpacity={RAIN_META[r.level].opacity}
                stroke="none"
                ifOverflow="hidden"
              />
            ))}
            <ReferenceLine y={LIMIT} stroke="var(--warn)" strokeDasharray="4 4" label={{ value: `limite ${LIMIT}%`, position: "right", fill: "var(--warn)", fontSize: 10 }} />
            <Bar
              dataKey="pct"
              name="Obstrução"
              fill="var(--fg-muted)"
              radius={[2, 2, 0, 0]}
              isAnimationActive={false}
              shape={(props: { x?: number; y?: number; width?: number; height?: number; payload?: { pct: number | null } }) => {
                const { x = 0, y = 0, width = 0, height = 0, payload } = props;
                if (payload?.pct === null || payload?.pct === undefined) {
                  return <rect x={x} y={y} width={width} height={height} fill="url(#obs-gap)" />;
                }
                const fill = payload.pct > LIMIT ? "var(--warn)" : "var(--fg-muted)";
                return <rect x={x} y={y} width={width} height={height} fill={fill} opacity={0.75} rx={2} />;
              }}
            />
            <defs>
              <pattern id="obs-gap" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" fill="rgb(167 169 172 / 0.03)" />
                <line x1="0" y1="0" x2="0" y2="6" stroke="rgb(167 169 172 / 0.2)" strokeWidth="1.5" />
              </pattern>
            </defs>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {shown.length > 0 && (
        <div className="flex justify-between text-[10.5px] text-fg-subtle">
          <span className="tabular">{fmtDateTime(shown[0].t)}</span>
          <span className="tabular">{fmtDateTime(shown[shown.length - 1].t)}</span>
        </div>
      )}
    </div>
  );
});

export default function ObstructionsView() {
  const base = useBasePath();
  const [range, setRange] = useState("7d");
  const [ enlarged, setEnlarged] = useState(false);
  const status = useAgent<StatusResponse>("status", { refetchInterval: useStatusInterval(30_000) });
  const q = useAgent<ObstructionResponse>(`obstruction?range=${range}`, { refetchInterval: 300_000 });
  const wx = useAgent<WeatherHourly>(`weather/hourly?range=${range}`, { refetchInterval: 15 * 60_000 });
  const clock = useNow(60_000);
  const m = status.data?.available ? status.data.status.metrics : undefined;
  const pct = typeof m?.obstruction_pct?.value === "number" ? m.obstruction_pct.value : null;
  const valid = typeof m?.obstruction_valid_s?.value === "number" ? m.obstruction_valid_s.value : null;
  const now = m?.currently_obstructed;
  const cap = q.data?.map_capability;
  const capTone = cap ? CAP_META[cap.status].tone : null;
  const rain = useMemo(
    () =>
      q.data && wx.data
        ? rainBands(wx.data.hours, q.data.trend[0]?.t ?? q.data.map?.ts ?? 0, q.data.trend[q.data.trend.length - 1]?.t ?? clock ?? 0)
        : [],
    [q.data, wx.data, clock],
  );
  const loading = status.isLoading || q.isLoading;

  const refresh = () => {
    void status.refetch();
    void q.refetch();
    void wx.refetch();
  };

  // Veredito geral.
  const verdict = useMemo(() => {
    if (!status.data) return { tone: "info" as const, title: "Analisando obstruções...", text: "Carregando dados da antena.", icon: Info };
    if (!status.data.available) {
      if (status.data.dish_reachable === false) return { tone: "crit" as const, title: "Antena inacessível", text: "Não é possível avaliar obstruções sem comunicação com a antena.", icon: AlertOctagon };
      return { tone: "info" as const, title: "Dados indisponíveis", text: status.data.reason, icon: Info };
    }
    if (pct === null) return { tone: "info" as const, title: "Estatística não informada", text: "O firmware não enviou a fração de tempo obstruído.", icon: Info };
    if (pct > LIMIT) return { tone: "warn" as const, title: "Atenção: obstrução acima do limite", text: `${fmtPct(pct, 2)} do tempo com céu obstruído. Quanto mais alto, maior o risco de quedas.`, icon: AlertTriangle };
    return { tone: "ok" as const, title: "Visão do céu está boa", text: `Apenas ${fmtPct(pct, 2)} do tempo obstruído, abaixo do limite de ${fmtPct(LIMIT, 0)}.`, icon: CheckCircle2 };
  }, [status.data, pct]);

  // Piores horas.
  const worstHours = useMemo(() => {
    const withData = (q.data?.trend ?? []).filter((t) => t.obstruction_pct !== null).slice(-72);
    if (withData.length === 0) return [];
    return [...withData].sort((a, b) => (b.obstruction_pct ?? 0) - (a.obstruction_pct ?? 0)).slice(0, 5);
  }, [q.data?.trend]);

  const mapAge = q.data?.map && clock !== null ? clock - q.data.map.ts : null;
  const needsAttention = pct !== null && pct > LIMIT;

  return (
    <>
      <PageHeader
        title="Mapa do Céu e Obstruções"
        icon={<Radar />}
        description="Estatística e mapa de obstrução exibidos somente quando o firmware os fornece."
        actions={
          <Button size="sm" variant="ghost" onClick={refresh} disabled={status.isFetching || q.isFetching || wx.isFetching}>
            <RefreshCw className="size-4" /> Atualizar
          </Button>
        }
      />
      {q.error && (
        <div className="mb-4">
          <QueryError error={q.error} onRetry={() => q.refetch()} />
        </div>
      )}

      <SystemDiagram current="ceu" />

      {/* Veredito geral */}
      <section className="mb-6">
        <Callout tone={verdict.tone} icon={<verdict.icon className="size-5" />} title={verdict.title}>
          {verdict.text}
          {verdict.tone === "crit" && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href={hrefOf(base, "diagnosticos")} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-crit px-3 text-sm font-medium text-white hover:bg-crit/90">
                Testar comunicação
              </Link>
              <Link href={hrefOf(base, "controle")} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-crit/50 px-3 text-sm font-medium text-crit hover:bg-crit-soft">
                Abrir Controle
              </Link>
            </div>
          )}
        </Callout>
      </section>

      {/* ---------------------------------------------------------- Mapa do céu + resumo */}
      <section aria-labelledby="ceu-t" className="mb-8">
        <SectionHead id="ceu-t" title="O céu visto pela antena">
          Mapa capturado pela antena e a estatística da última leitura
        </SectionHead>

        <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <Card className="min-w-0">
            <CardHeader
              title="Mapa do céu"
              icon={<Radar />}
              actions={
                <div className="flex items-center gap-2">
                  {q.data?.map && <SourceBadge source={q.data.map.source} />}
                  <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setEnlarged(true)} disabled={!q.data?.map} aria-label="Ampliar mapa">
                    <Expand className="size-4" />
                  </Button>
                </div>
              }
              subtitle={q.data?.map ? `Capturado em ${fmtDateTime(q.data.map.ts)} · ${mapAge !== null ? `${fmtDuration(mapAge)} atrás` : ""}` : undefined}
            />
            <CardBody className="flex flex-col items-center">
              {!q.data && !q.error && <Skeleton className="aspect-square w-full" />}
              {q.data && !q.data.map && (
                <EmptyState icon={<Radar />} title={cap?.status === "verificada" ? "Aguardando primeira captura" : "Mapa indisponível"} className="min-h-72">
                  {cap?.status === "verificada" ? (
                    "A antena captura um novo mapa a cada ~5 min. O primeiro pode demorar alguns minutos após a inicialização."
                  ) : (
                    <span>
                      Este firmware não forneceu o mapa via API local ou a antena não está acessível. Nenhum mapa ilustrativo é exibido no modo real.{" "}
                      <Link href={hrefOf(base, "diagnosticos")} className="text-accent hover:underline">
                        Verificar comunicação
                      </Link>
                    </span>
                  )}
                </EmptyState>
              )}
              {q.data?.map && (
                <>
                  <ObstructionGrid rows={q.data.map.num_rows} cols={q.data.map.num_cols} snr={q.data.map.snr} className="aspect-square w-full" />
                  <ul className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-xs text-fg-muted" aria-label="Legenda do mapa">
                    {MAP_KEY.map((k) => (
                      <li key={k.label} className="flex items-center gap-1.5">
                        <span className={cn("size-2.5 rounded-[2px]", k.swatch)} aria-hidden />
                        {k.label}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </CardBody>
          </Card>

          <div className="grid gap-3">
            <Card className="min-w-0">
              <CardHeader title="Resumo de obstrução" icon={<MapIcon />} subtitle={m?.obstruction_pct ? "Estatística informada no status da antena" : "Dados não informados"} actions={m?.obstruction_pct && <SourceBadge source={m.obstruction_pct.source} />} />
              <CardBody>
                {loading ? (
                  <Skeleton className="h-40 w-full" />
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                    <SummaryCard
                      icon={Radar}
                      label="Tempo obstruído"
                      value={pct === null ? "sem leitura" : fmtPct(pct, 2)}
                      state={pct === null ? "off" : pct > LIMIT ? "warn" : "ok"}
                      note={valid !== null ? `Janela: ${fmtDuration(valid)}` : "Janela não informada"}
                      loading={loading}
                    />
                    <SummaryCard
                      icon={CloudSun}
                      label="Obstruída agora"
                      value={!now ? "sem leitura" : now.value ? "Sim" : "Não"}
                      state={!now ? "off" : now.value ? "warn" : "ok"}
                      note="Condição na última leitura"
                      loading={loading}
                    />
                    <SummaryCard
                      icon={capTone === "crit" ? ShieldAlert : CloudSun}
                      label="Mapa de obstrução"
                      value={cap ? CAP_META[cap.status].label : q.data ? "—" : "lendo"}
                      state={!cap ? "off" : capTone === "ok" ? "ok" : capTone === "warn" ? "warn" : capTone === "crit" ? "crit" : "off"}
                      note={cap?.detail ?? "Matriz de capacidades ainda não verificada."}
                      loading={loading}
                    />
                  </div>
                )}
                <p className="mt-3 text-xs leading-relaxed text-fg-subtle">
                  Acima de{" "}
                  <Tip content="Quando mais de 5% do tempo está obstruído, a chance de interrupções notáveis aumenta.">
                    <span className="cursor-help underline decoration-dotted">{fmtPct(LIMIT, 0)}</span>
                  </Tip>{" "}
                  do tempo obstruído o valor fica amarelo, o mesmo limite usado em Antena e Sinal.
                </p>
              </CardBody>
            </Card>

            {needsAttention && (
              <Callout tone="warn" icon={<ShieldAlert className="size-5" />} title="Obstrução detectada">
                <ul className="list-inside list-disc space-y-1 text-sm">
                  <li>Verifique árvores, telhados, construções ou postos na linha de visão da antena.</li>
                  <li>Observe se a obstrução ocorre em horários específicos do dia (sol ou satélite mudam de posição).</li>
                  <li>Se persistir, considere realocar a antena para um ponto com visão mais limpa do céu.</li>
                </ul>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href={hrefOf(base, "interrupcoes")} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-warn px-3 text-sm font-medium text-black hover:bg-warn/90">
                    Ver Interrupções
                  </Link>
                  <Link href={hrefOf(base, "controle")} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-warn/50 px-3 text-sm font-medium text-warn hover:bg-warn-soft">
                    Abrir Controle
                  </Link>
                </div>
              </Callout>
            )}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- Tendência */}
      <section aria-labelledby="tendencia-t" className="mb-8">
        <SectionHead
          id="tendencia-t"
          title="Tendência de obstrução"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {["24h", "7d", "30d"].map((r) => (
                <Button key={r} size="sm" variant={range === r ? "secondary" : "ghost"} className="h-7 px-2.5 text-xs" onClick={() => setRange(r)} aria-pressed={range === r}>
                  {r}
                </Button>
              ))}
            </div>
          }
        >
          Média da fração obstruída informada no status
        </SectionHead>
        <Card>
          <CardBody className="pt-4">
            {!q.data && !q.error && <Skeleton className="h-48 w-full" />}
            {q.data && !q.data.trend.length && <EmptyState title="Sem histórico de obstrução">O histórico aparece depois das primeiras horas de coleta.</EmptyState>}
            {q.data && q.data.trend.length > 0 && (
              <>
                <ObstructionTrendChart trend={q.data.trend} rain={rain} rangeLabel={range} />
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-fg-subtle">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block size-2 rounded-sm bg-warn" /> Acima de {LIMIT}%
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <CloudRain className="size-3.5" /> Faixas azuis = coincidência com chuva (estimativa regional)
                  </span>
                  <GapNote gaps={q.data.trend.filter((t) => t.obstruction_pct === null).map((t) => ({ start_ts: t.t, end_ts: t.t + 3600, kind: "history_lost", samples_lost: null, detail: null }))} />
                </div>
                {worstHours.length > 0 && (
                  <div className="mt-4 rounded-md border border-border bg-surface-2/40 p-3">
                    <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-fg">
                      <AlertTriangle className="size-3.5 text-warn" /> Piores horários (últimas 72 h)
                    </p>
                    <ul className="space-y-1">
                      {worstHours.map((t) => (
                        <li key={t.t} className="flex items-center justify-between gap-3 text-xs">
                          <span className="tabular text-fg-subtle">{fmtDateTime(t.t)}</span>
                          <span className={cn("tabular font-medium", t.obstruction_pct! > LIMIT ? "text-warn" : "text-fg")}>{fmtPct(t.obstruction_pct, 2)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <details className="mt-4 rounded-md border border-border px-3 py-2">
                  <summary className="cursor-pointer text-xs text-fg-muted">Ver os valores hora a hora</summary>
                  <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto pr-1">
                    {q.data.trend
                      .slice(-72)
                      .reverse()
                      .map((t) => {
                        const w = wx.data?.hours.find((h) => h.hour_ts === Math.floor(t.t / 3600) * 3600);
                        const rainText = w && isNotableRain(w.rain_level) ? ` · ${RAIN_META[w.rain_level].label}` : "";
                        return (
                          <li key={t.t} className="flex items-center justify-between gap-3 text-xs">
                            <span className="tabular text-fg-subtle">{fmtDateTime(t.t)}</span>
                            <span className={cn("tabular", t.obstruction_pct === null ? "text-fg-subtle" : t.obstruction_pct > LIMIT ? "text-warn" : "text-fg")}>
                              {t.obstruction_pct === null ? "sem dado" : fmtPct(t.obstruction_pct, 2)}
                              {rainText && <span className="ml-1 text-accent">{rainText}</span>}
                            </span>
                          </li>
                        );
                      })}
                  </ul>
                </details>
              </>
            )}
            <p className="mt-3 flex flex-wrap items-center gap-x-2 text-[11px] text-fg-subtle">
              Correlação com quedas não implica causalidade; veja Interrupções para cruzar horários.
              <Link href={hrefOf(base, "interrupcoes")} className="inline-flex items-center gap-1 text-accent hover:underline">
                Abrir Interrupções <ArrowRight className="size-3" aria-hidden />
              </Link>
            </p>
          </CardBody>
        </Card>
      </section>

      {/* ---------------------------------------------------------- Dicas */}
      <section aria-labelledby="dicas-t" className="mb-4">
        <SectionHead id="dicas-t" title="Entenda o mapa">
          O que cada cor e valor representa
        </SectionHead>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { title: "Céu livre", text: "A antena enxerga o satélite sem bloqueios nesta direção.", tone: "ok" },
            { title: "Sinal parcial", text: "Há algum bloqueio parcial; a conexão pode oscilar.", tone: "warn" },
            { title: "Obstruído", text: "A visão está bloqueada; nesta direção a conexão tende a cair.", tone: "crit" },
            { title: "Sem dado", text: "A antena ainda não enviou informação para esta região do céu.", tone: "off" },
          ].map(({ title, text, tone }) => {
            const toneClass = tone === "ok" ? "border-ok/30 bg-ok-soft" : tone === "warn" ? "border-warn/30 bg-warn-soft" : tone === "crit" ? "border-crit/30 bg-crit-soft" : "border-border bg-surface-2";
            return (
              <Card key={title} className={`p-3 ${toneClass}`}>
                <p className="text-sm font-medium text-fg">{title}</p>
                <p className="mt-1 text-xs text-fg-subtle">{text}</p>
              </Card>
            );
          })}
        </div>
      </section>

      <p className="text-xs text-fg-subtle">Leituras da API local. Valores ausentes são indicados por &ldquo;—&rdquo;; a origem dos dados acompanha cada indicador.</p>

      {/* Modal do mapa ampliado */}
      <Dialog open={enlarged} onOpenChange={setEnlarged} title="Mapa do céu" description={`Capturado em ${q.data?.map ? fmtDateTime(q.data.map.ts) : ""}`}>
        <div className="flex flex-col items-center">
          {q.data?.map && <ObstructionGrid rows={q.data.map.num_rows} cols={q.data.map.num_cols} snr={q.data.map.snr} className="aspect-square w-full max-w-2xl" />}
          <ul className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-xs text-fg-muted">
            {MAP_KEY.map((k) => (
              <li key={k.label} className="flex items-center gap-1.5">
                <span className={cn("size-2.5 rounded-[2px]", k.swatch)} aria-hidden />
                {k.label}
              </li>
            ))}
          </ul>
        </div>
      </Dialog>
    </>
  );
}
