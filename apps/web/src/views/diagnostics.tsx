"use client";

import type { Quality, Source, StatusResponse } from "@astryon/shared";
import { Activity, ArrowRight, MessagesSquare, Wrench } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { PageHeader, QueryError, SourceBadge } from "@/components/domain";
import { hrefOf } from "@/components/shell/nav";
import { Badge, Skeleton } from "@/components/ui/primitives";
import { useAgent, useStatusInterval } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useBasePath } from "@/lib/demo-context";
import { fmtDateTime, fmtDuration, fmtNumber, fmtPct } from "@/lib/format";
import { num } from "./dashboard/parts";
import { CheckDetails, Checklist, ChecklistItem, type CheckState, StateCounts, VerdictPanel } from "./diagnostics-parts/checklist";
import { HIGH_LOSS, HourlyLossStrip } from "./diagnostics-parts/hourly-strip";
import { RangeTabs } from "./shared";

interface Finding {
  severity: "info" | "warn" | "crit";
  kind: "evento_observado" | "hipotese" | "causa_confirmada";
  text: string;
  evidence: string;
}
interface DiagnosticSummary {
  generated_at: number;
  source: Source;
  engine: "regras" | "groq";
  headline: string;
  findings: Finding[];
}

/** Natureza do achado. A hipótese é só uma pista: nunca aparece como falha, mesmo que o agente a marque como crítica. */
const KIND = {
  causa_confirmada: {
    label: "causa confirmada",
    tone: "accent",
    help: "Reportada explicitamente pela antena.",
    todo: "A própria antena informou a causa. Veja em Eventos quando aconteceu e quanto durou.",
    link: "interrupcoes",
  },
  hipotese: {
    label: "hipótese",
    tone: "neutral",
    help: "Explicação possível; correlação não comprova causa.",
    todo: "Trate como pista, não como diagnóstico: confira os horários em Qualidade e o céu em Obstruções antes de mudar algo.",
    link: "obstrucoes",
  },
  evento_observado: {
    label: "evento observado",
    tone: "neutral",
    help: "Fato registrado, sem causa determinada.",
    todo: "Acompanhe em Qualidade por horário para ver se o padrão se repete.",
    link: "qualidade",
  },
} as const;

const LINK_LABEL: Record<string, string> = { interrupcoes: "Abrir Eventos", obstrucoes: "Abrir Obstruções", qualidade: "Abrir Qualidade" };

const PERIOD: Record<string, string> = { "24h": "nas últimas 24 h", "7d": "nos últimos 7 dias", "30d": "nos últimos 30 dias" };

function findingState(f: Finding): CheckState {
  if (f.severity === "info") return "info";
  if (f.kind === "hipotese") return "warn";
  return f.severity === "crit" ? "crit" : "warn";
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Veredito em uma frase a partir dos achados (ex.: "2 achados de atenção nas últimas 24 h, nenhuma falha."). */
function sentenceOf(c: Record<CheckState, number>, period: string, total: number) {
  if (c.crit > 0) return `${plural(c.crit, "falha", "falhas")}${c.warn ? ` e ${plural(c.warn, "achado de atenção", "achados de atenção")}` : ""} ${period}.`;
  if (c.warn > 0) return `${plural(c.warn, "achado de atenção", "achados de atenção")} ${period}, nenhuma falha.`;
  if (total > 0) return `Nenhum problema ${period}; ${plural(c.info, "observação informativa", "observações informativas")}.`;
  return `Nenhum achado ${period}.`;
}

/* ----------------------------------------------------------------- Medições */

function median(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Horas em faixas legíveis: [19, 20, 21, 22, 3] → "3h e 19h–22h". */
function fmtHours(hours: number[]) {
  const hs = [...new Set(hours)].sort((a, b) => a - b);
  const runs: string[] = [];
  for (let i = 0; i < hs.length; i++) {
    let j = i;
    while (j + 1 < hs.length && hs[j + 1] === hs[j] + 1) j++;
    runs.push(j > i ? `${hs[i]}h–${hs[j]}h` : `${hs[i]}h`);
    i = j;
  }
  return runs.length > 1 ? `${runs.slice(0, -1).join(", ")} e ${runs[runs.length - 1]}` : (runs[0] ?? "");
}

/** Horas citadas no texto do achado ("entre 19h e 22h" → [19, 22]). */
function hoursIn(text: string) {
  return [...text.matchAll(/\b(\d{1,2})\s?h\b/g)].map((m) => Number(m[1])).filter((h) => h >= 0 && h <= 23);
}

/** Critério do painel para cada medição: verde até `ok`, amarelo até `warn`, vermelho além. */
function grade(v: number | null, ok: number, warn: number, higherIsBetter = false): CheckState {
  if (v === null) return "off";
  if (higherIsBetter) return v >= ok ? "ok" : v >= warn ? "warn" : "crit";
  return v <= ok ? "ok" : v <= warn ? "warn" : "crit";
}
const OK_WORD: Partial<Record<CheckState, string>> = { ok: "dentro do normal", warn: "atenção", crit: "fora do normal", off: "sem medição" };

function V({ children }: { children: ReactNode }) {
  return <span className="tabular text-fg">{children}</span>;
}

function Measurements({ quality, obst, period }: { quality: Quality; obst: number | null; period: string }) {
  const cov = quality.coverage ?? 0;
  const covState: CheckState = cov >= 0.9 ? "ok" : cov > 0 ? "warn" : "off";
  const avail = num(quality.availability_pct);
  const loss = num(quality.loss_pct);
  const lat = num(quality.latency_p50_ms);
  const seen = quality.by_hour.filter((h) => h.observed_seconds > 0 && h.loss_pct !== null);
  const highHours = seen.filter((h) => (h.loss_pct ?? 0) >= HIGH_LOSS).map((h) => h.hour);
  // Horas relativamente altas: perda de pelo menos 2× a mediana das horas observadas (mesmo abaixo de 2%).
  const med = median(seen.map((h) => h.loss_pct ?? 0));
  const relHours = med > 0 ? seen.filter((h) => (h.loss_pct ?? 0) >= 2 * med && (h.loss_pct ?? 0) < HIGH_LOSS).map((h) => h.hour) : [];
  const sAvail = grade(avail, 99, 97, true);
  const sLoss = grade(loss, 1.5, 3);
  const sLat = grade(lat, 70, 110);
  const sObst = grade(obst, 3, 6);
  return (
    <Checklist title="Medições do período" description={`Critérios do painel sobre o que o agente mediu ${period}. Valores calculados.`} aside={<SourceBadge source={quality.source === "demonstracao" ? "demonstracao" : "calculada"} />}>
      <ChecklistItem
        state={covState}
        stateLabel={cov >= 0.9 ? "completa" : cov > 0 ? "parcial" : "sem dados"}
        title="Cobertura da observação"
        summary={
          <>
            O agente observou <V>{fmtPct(cov * 100, 0)}</V> do período ({fmtDuration(quality.observed_seconds)}).
          </>
        }
      >
        <CheckDetails
          rows={[
            { label: "O que é", value: "Quanto do período tem amostras registradas. Trechos sem coleta não são avaliados e nunca contam como zero." },
            { label: "Evidência", value: <>{plural(quality.gaps.length, "lacuna registrada", "lacunas registradas")} · de {fmtDateTime(quality.start)} a {fmtDateTime(quality.end)}</> },
            { label: "O que fazer", value: covState === "ok" ? "Nada: a cobertura é suficiente para confiar nas medições abaixo." : "Mantenha o agente ligado e com acesso à antena. Com cobertura parcial, leia os demais itens como amostra, não como o período inteiro." },
          ]}
        />
      </ChecklistItem>

      <ChecklistItem
        state={sAvail}
        stateLabel={OK_WORD[sAvail]}
        title="Estabilidade"
        summary={avail !== null ? <><V>{fmtPct(avail, 2)}</V> do tempo observado com conexão disponível.</> : "Disponibilidade não medida no período."}
      >
        <CheckDetails
          rows={[
            { label: "Critério", value: "Verde a partir de 99%, amarelo de 97% a 99%, vermelho abaixo de 97%." },
            { label: "Evidência", value: <>{quality.availability_note || "—"}{quality.full_drop_seconds > 0 && <> · <V>{fmtDuration(quality.full_drop_seconds)}</V> sem nenhum pacote</>}</> },
            { label: "O que fazer", value: sAvail === "ok" ? "Nada a fazer." : "Veja em Eventos quando a conexão caiu e qual causa a antena informou." },
          ]}
        />
      </ChecklistItem>

      <ChecklistItem
        state={sLoss}
        stateLabel={OK_WORD[sLoss]}
        title="Perda de pacotes"
        summary={
          loss !== null ? (
            <>
              Perda média de <V>{fmtPct(loss, 2)}</V>
              {highHours.length > 0 ? (
                <>; 2% ou mais às {fmtHours(highHours)}{relHours.length > 0 ? <>, e acima da média do dia às {fmtHours(relHours)}</> : null}.</>
              ) : relHours.length > 0 ? (
                <>; nenhuma hora chega a 2%, mas a perda fica acima da média do dia às {fmtHours(relHours)}.</>
              ) : (
                ", sem hora acima de 2%."
              )}
            </>
          ) : (
            "Perda não medida no período."
          )
        }
      >
        <CheckDetails
          rows={[
            { label: "Evidência", value: quality.by_hour.length > 0 ? <HourlyLossStrip hours={quality.by_hour} mark={relHours} /> : "Sem dados por hora no período." },
            { label: "Critério", value: "Verde até 1,5%, amarelo até 3%, vermelho acima. Hora marcada: perda de pelo menos 2× a mediana das horas observadas." },
            { label: "O que fazer", value: sLoss === "ok" && !highHours.length && !relHours.length ? "Nada a fazer." : "Compare os horários com chuva e obstrução. Se a perda só aparece no Wi-Fi da casa, o problema pode estar na rede local, não no satélite." },
          ]}
        />
      </ChecklistItem>

      <ChecklistItem
        state={sLat}
        stateLabel={OK_WORD[sLat]}
        title="Latência"
        summary={lat !== null ? <>Mediana de <V>{fmtNumber(lat, 0)} ms</V>; 95% das medições até <V>{fmtNumber(num(quality.latency_p95_ms), 0)} ms</V>.</> : "Latência não medida no período."}
      >
        <CheckDetails
          rows={[
            { label: "Critério", value: "Mediana: verde até 70 ms, amarelo até 110 ms, vermelho acima." },
            {
              label: "Evidência",
              value: (
                <>
                  Pico de <V>{fmtNumber(num(quality.latency_max_ms), 0)} ms</V> · variação (jitter) de <V>{fmtNumber(num(quality.jitter_ms), 1)} ms</V> · {quality.latency_note}
                </>
              ),
            },
            { label: "O que fazer", value: sLat === "ok" ? "Nada a fazer." : "Latência alta e contínua costuma vir de obstrução ou congestionamento da célula. Veja os horários em Qualidade." },
          ]}
        />
      </ChecklistItem>

      <ChecklistItem
        state={sObst}
        stateLabel={obst === null ? "não informado" : OK_WORD[sObst]}
        title="Obstrução do céu"
        summary={obst !== null ? <>A antena informa <V>{fmtPct(obst, 1)}</V> do tempo com o céu obstruído (leitura atual).</> : "O firmware não informa obstrução, ou a antena não respondeu."}
      >
        <CheckDetails
          rows={[
            { label: "Critério", value: "Verde até 3%, amarelo até 6%, vermelho acima." },
            { label: "Evidência", value: "Leitura atual da antena (não é média do período)." },
            { label: "O que fazer", value: sObst === "ok" || sObst === "off" ? "Nada a fazer." : "Abra Obstruções para ver em que direção o céu está bloqueado e considere mudar a antena de lugar." },
          ]}
        />
      </ChecklistItem>
    </Checklist>
  );
}

/* ----------------------------------------------------------------- Tela */

function Shortcut({ href, icon, children }: { href: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Link href={href} className="group inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg-muted transition-colors hover:border-accent-2/50 hover:text-fg [&>svg:first-child]:size-4 [&>svg:first-child]:text-accent">
      {icon}
      {children}
      <ArrowRight className="size-3.5 text-fg-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-accent" aria-hidden />
    </Link>
  );
}

export default function DiagnosticsView() {
  const base = useBasePath();
  const [range, setRange] = useState("24h");
  const q = useAgent<DiagnosticSummary>(`diagnostics/summary?range=${range}`, { refetchInterval: 60_000 });
  const quality = useAgent<Quality>(`quality?range=${range}`, { refetchInterval: 60_000 });
  const status = useAgent<StatusResponse>("status", { refetchInterval: useStatusInterval(30_000) });
  const obst = status.data?.available ? num(status.data.status.metrics.obstruction_pct?.value) : null;
  const d = q.data;
  const period = PERIOD[range] ?? "no período";

  const counts: Record<CheckState, number> = { ok: 0, warn: 0, crit: 0, off: 0, info: 0, pending: 0 };
  for (const f of d?.findings ?? []) counts[findingState(f)]++;
  const hypotheses = d?.findings.filter((f) => f.kind === "hipotese").length ?? 0;
  const verdictState: CheckState | "loading" = !d ? "loading" : counts.crit ? "crit" : counts.warn ? "warn" : "ok";

  return (
    <>
      <PageHeader
        title="Diagnósticos"
        icon={<Activity />}
        description="Análise por regras determinísticas sobre os dados que o agente registrou. Cada achado informa se é um evento observado, uma hipótese ou uma causa confirmada pela antena."
        actions={<RangeTabs value={range} onChange={setRange} options={[{ value: "24h", label: "24h" }, { value: "7d", label: "7d" }, { value: "30d", label: "30d" }]} />}
      />

      {q.error ? (
        <div className="mb-6">
          <QueryError error={q.error} onRetry={() => q.refetch()} />
        </div>
      ) : (
        <VerdictPanel
          state={verdictState}
          sentence={d ? sentenceOf(counts, period, d.findings.length) : <Skeleton className="h-6 w-72 max-w-full" />}
          counts={
            d && (
              <StateCounts
                items={[
                  { state: "crit", n: counts.crit, word: counts.crit === 1 ? "falha" : "falhas", always: true },
                  { state: "warn", n: counts.warn, word: "de atenção", always: true },
                  { state: "info", n: counts.info, word: counts.info === 1 ? "informativo" : "informativos" },
                ]}
              />
            )
          }
          meta={
            d && (
              <>
                <span>
                  Motor: {d.engine === "regras" ? "regras determinísticas" : "Groq"} · gerado em <span className="tabular">{fmtDateTime(d.generated_at)}</span>
                </span>
                <SourceBadge source={d.source} />
              </>
            )
          }
        >
          {d ? (
            <>
              <p className="text-fg">{d.headline}</p>
              {hypotheses > 0 && (
                <p className="mt-1 text-xs text-fg-subtle">
                  {hypotheses === 1 ? "Inclui 1 hipótese" : `Inclui ${hypotheses} hipóteses`}: explicação possível, nunca contada como falha. Correlação não comprova causa.
                </p>
              )}
            </>
          ) : (
            <Skeleton className="mt-1 h-4 w-96 max-w-full" />
          )}
        </VerdictPanel>
      )}

      {d && (
        <Checklist title="Achados" description="Abra um item para ver a evidência e o que fazer.">
          {d.findings.length === 0 ? (
            <ChecklistItem state="ok" stateLabel="nada encontrado" title="Nenhuma anomalia detectada" summary="As regras não encontraram problemas no período observado. Períodos sem coleta não são avaliados." />
          ) : (
            d.findings.map((f, i) => {
              const k = KIND[f.kind] ?? KIND.evento_observado;
              const st = findingState(f);
              return (
                <ChecklistItem
                  key={i}
                  state={st}
                  title={f.text}
                  summary={k.help}
                  tags={
                    <Badge tone={k.tone} title={k.help} className={cn(f.kind === "hipotese" && "border-dashed")}>
                      {k.label}
                    </Badge>
                  }
                >
                  <CheckDetails
                    rows={[
                      {
                        label: "Base",
                        value: (() => {
                          const hs = hoursIn(f.text);
                          return (
                            <>
                              {d.engine === "regras" ? "Regras determinísticas do agente" : "Análise da Groq sobre os dados do agente"} · período {period.replace(/^n[oa]s /, "")}
                              {hs.length === 2 && hs[1] > hs[0] ? <> · horas envolvidas: <span className="tabular">{hs[0]}h–{hs[1]}h</span></> : hs.length > 0 ? <> · horas envolvidas: <span className="tabular">{fmtHours(hs)}</span></> : null}
                            </>
                          );
                        })(),
                      },
                      { label: "Evidência", value: f.evidence },
                      {
                        label: "O que fazer",
                        value: (
                          <>
                            {k.todo}{" "}
                            <Link href={hrefOf(base, k.link)} className="whitespace-nowrap font-medium text-accent hover:underline">
                              {LINK_LABEL[k.link]} →
                            </Link>
                          </>
                        ),
                      },
                    ]}
                  />
                </ChecklistItem>
              );
            })
          )}
        </Checklist>
      )}
      {q.isLoading && <Skeleton className="mb-6 h-40 w-full" />}

      {quality.error && (
        <div className="mb-6">
          <QueryError error={quality.error} onRetry={() => quality.refetch()} />
        </div>
      )}
      {quality.data ? <Measurements quality={quality.data} obst={obst} period={period} /> : !quality.error && <Skeleton className="mb-6 h-56 w-full" />}

      <nav aria-label="Outras verificações" className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs text-fg-subtle">Outras verificações</span>
        <Shortcut href={hrefOf(base, "instalacao")} icon={<Wrench />}>
          Teste de conexão
        </Shortcut>
        <Shortcut href={hrefOf(base, "qualidade")} icon={<Activity />}>
          Qualidade por horário
        </Shortcut>
        <Shortcut href={hrefOf(base, "assistente")} icon={<MessagesSquare />}>
          Central de IA
        </Shortcut>
      </nav>
    </>
  );
}
