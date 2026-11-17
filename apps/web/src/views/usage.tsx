"use client";

import type { UsagePlan, UsageSeries, UsageSummary, UsageWindow } from "@astryon/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BarChart3, FileUp, Info } from "lucide-react";
import { type ChangeEvent, useCallback, useState } from "react";
import { UsageBarChart } from "@/components/charts";
import { CoverageBar, PageHeader, QueryError, SourceBadge } from "@/components/domain";
import { Button, Callout, Card, CardBody, CardHeader, EmptyState, Label, Select, Skeleton, Tabs } from "@/components/ui/primitives";
import { api, useAgent } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useDemo } from "@/lib/demo-context";
import { fmtBytes, fmtBytesStr, fmtDateTime, fmtDay, fmtHM, fmtMonth, fmtNumber } from "@/lib/format";
import { useDisplayTimezone } from "@/lib/timezone";
import { type Figure, Verdict } from "./overview-parts/verdict";
import { PlanCard } from "./usage-parts/plan-meter";
import { usageVerdict } from "./usage-parts/usage-verdict";

/**
 * Variação do mês atual contra o MESMO trecho do mês anterior (dia 1 até o mesmo tempo decorrido). Comparar com
 * o mês anterior inteiro dava "−85%" no dia 5. Sem esse dado (agente antigo) ou sem consumo base, não compara.
 */
export function monthComparison(s: Pick<UsageSummary, "month" | "previous_month_to_date"> | undefined): number | null {
  const base = s?.previous_month_to_date?.bytes_total;
  if (!s || !base) return null;
  return ((s.month.bytes_total - base) / base) * 100;
}

export { PlanCard } from "./usage-parts/plan-meter";

/** Janelas de consumo numa tabela só: total, download, upload e cobertura de cada período. */
function WindowsTable({ s }: { s: UsageSummary | undefined }) {
  const rows: [string, UsageWindow | undefined][] = [
    ["Hoje", s?.today],
    ["Ontem", s?.yesterday],
    ["Esta semana", s?.week],
    ["Este mês", s?.month],
    ["Mês anterior", s?.previous_month],
  ];
  return (
    <Card>
      <CardHeader title="Consumo por janela" subtitle="Download e upload somados; cobertura = quanto do período foi observado." actions={s && <SourceBadge source={s.month.source} />} />
      <CardBody>
        {!s ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-fg-subtle">
                <th className="py-2 pr-3 font-medium">Período</th>
                <th className="py-2 pr-3 text-right font-medium">Total</th>
                <th className="hidden py-2 pr-3 text-right font-medium sm:table-cell">Download</th>
                <th className="hidden py-2 pr-3 text-right font-medium sm:table-cell">Upload</th>
                <th className="py-2 text-right font-medium">Cobertura</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, w]) => (
                <tr key={label} className="border-b border-border/60 last:border-0">
                  <td className="py-2 pr-3 text-fg-muted">{label}</td>
                  <td className="tabular py-2 pr-3 text-right text-fg">{w ? fmtBytesStr(w.bytes_total) : "—"}</td>
                  <td className="tabular hidden py-2 pr-3 text-right text-fg-muted sm:table-cell">{w ? fmtBytesStr(w.bytes_download) : "—"}</td>
                  <td className="tabular hidden py-2 pr-3 text-right text-fg-muted sm:table-cell">{w ? fmtBytesStr(w.bytes_upload) : "—"}</td>
                  <td className="py-2 text-right">{w ? <CoverageBar coverage={w.coverage} className="justify-end" /> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardBody>
    </Card>
  );
}

interface ImportPreview {
  import_token: string;
  columns: string[];
  suggested: Record<string, string | null>;
  preview: Record<string, string>[];
  rows: number;
  duplicate_file: boolean;
}

function CsvImport() {
  const demo = useDemo();
  const qc = useQueryClient();
  const [csv, setCsv] = useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tone: "ok" | "crit"; text: string } | null>(null);

  const doPreview = useMutation({
    mutationFn: (body: { filename: string; content: string }) => api<ImportPreview>("usage/import/preview", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (p) => {
      setPreview(p);
      setMapping(Object.fromEntries(Object.entries(p.suggested).filter(([, v]) => v)) as Record<string, string>);
    },
    onError: (e: Error) => setMsg({ tone: "crit", text: e.message }),
  });
  const doCommit = useMutation({
    mutationFn: () => api<{ inserted: number; skipped: number }>("usage/import/commit", { method: "POST", body: JSON.stringify({ filename: csv?.name, content: csv?.text, mapping }) }),
    onSuccess: (r) => {
      setMsg({ tone: "ok", text: `${r.inserted} período(s) importado(s); ${r.skipped} ignorado(s) por duplicidade.` });
      setPreview(null);
      setCsv(null);
      qc.invalidateQueries({ predicate: (q) => String(q.queryKey[1]).startsWith("usage") });
    },
    onError: (e: Error) => setMsg({ tone: "crit", text: e.message }),
  });

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 2_000_000) {
      setMsg({ tone: "crit", text: "Arquivo maior que 2 MB." });
      return;
    }
    const text = await f.text();
    setCsv({ name: f.name, text });
    setMsg(null);
    doPreview.mutate({ filename: f.name, content: text });
  }

  const fields: { key: string; label: string; required?: boolean }[] = [
    { key: "period_start", label: "Início do período", required: true },
    { key: "period_end", label: "Fim do período" },
    { key: "bytes_total", label: "Total (GB/MB/bytes)", required: true },
    { key: "bytes_down", label: "Download" },
    { key: "bytes_up", label: "Upload" },
  ];

  return (
    <Card>
      <CardHeader title="Importar CSV oficial" icon={<FileUp />} subtitle="Dados importados são exibidos separadamente, com origem 'importada'." />
      <CardBody className="space-y-3">
        <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border-strong px-3 py-2 text-sm text-fg-muted hover:border-accent/50 hover:text-fg ${demo ? "pointer-events-none opacity-40" : ""}`}>
          <FileUp className="size-4" /> Selecionar arquivo .csv
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={onFile} disabled={demo} />
        </label>
        {demo && <p className="text-xs text-fg-subtle">Indisponível na demonstração.</p>}
        {msg && <Callout tone={msg.tone}>{msg.text}</Callout>}
        {preview && (
          <div className="space-y-3">
            {preview.duplicate_file && <Callout tone="warn">Este arquivo já foi importado antes. Linhas repetidas serão ignoradas.</Callout>}
            <p className="text-xs text-fg-subtle">{preview.rows} linhas detectadas. Confirme o mapeamento de colunas:</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {fields.map((f) => (
                <div key={f.key} className="space-y-1">
                  <Label htmlFor={`map-${f.key}`}>
                    {f.label} {f.required && <span className="text-crit">*</span>}
                  </Label>
                  <Select id={`map-${f.key}`} className="w-full" value={mapping[f.key] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}>
                    <option value="">— não usar —</option>
                    {preview.columns.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="bg-surface-2 text-fg-muted">
                  <tr>{preview.columns.map((c) => <th key={c} className="px-2 py-1.5 text-left font-medium">{c}</th>)}</tr>
                </thead>
                <tbody>
                  {preview.preview.map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      {preview.columns.map((c) => <td key={c} className="px-2 py-1 tabular">{r[c]}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button variant="primary" size="sm" loading={doCommit.isPending} disabled={!mapping.period_start || !mapping.bytes_total} onClick={() => doCommit.mutate()}>
              Importar
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export default function UsageView() {
  const [bucket, setBucket] = useState<"hour" | "day" | "month">("day");
  const range = bucket === "hour" ? "24h" : bucket === "day" ? "30d" : "90d";
  const summary = useAgent<UsageSummary>("usage/summary", { refetchInterval: 60_000 });
  const plan = useAgent<UsagePlan>("usage/plan", { refetchInterval: 60_000 });
  const series = useAgent<UsageSeries>(`usage/series?range=${range}&bucket=${bucket}`, { refetchInterval: 120_000 });
  const profile = useAgent<{ hour: number; bytes_total: number; observed_seconds: number }[]>("usage/hourly-profile?range=30d");
  const s = summary.data;
  const p = plan.data;
  const proj = s?.projection_month;
  const maxProfile = Math.max(1, ...(profile.data?.map((h) => h.bytes_total) ?? [1]));
  const tz = useDisplayTimezone();
  const tick = useCallback((t: number) => (bucket === "hour" ? fmtHM(t) : bucket === "month" ? fmtMonth(t) : fmtDay(t)), [bucket]);
  const delta = monthComparison(s);
  const v = usageVerdict(p, s);
  const peakHour = profile.data?.length ? profile.data.reduce((a, h) => (h.bytes_total > a.bytes_total ? h : a)) : null;

  const figures: Figure[] = [
    { key: "today", label: "Hoje", value: s ? fmtBytes(s.today.bytes_total).value : "—", unit: s ? fmtBytes(s.today.bytes_total).unit : undefined, note: s ? `Ontem ${fmtBytesStr(s.yesterday.bytes_total)}` : undefined },
    {
      key: "budget",
      label: "Cabe por dia até a virada",
      value: v?.dailyBudget != null ? fmtBytes(v.dailyBudget).value : "—",
      unit: v?.dailyBudget != null ? fmtBytes(v.dailyBudget).unit : undefined,
      note: !p ? undefined : !p.configured ? "Configure a franquia" : v?.dailyBudget != null ? `Restante ÷ ${fmtNumber(p.days_remaining, 1)} dias` : "Sem restante a dividir",
    },
    {
      key: "month",
      label: "Este mês",
      value: s ? fmtBytes(s.month.bytes_total).value : "—",
      unit: s ? fmtBytes(s.month.bytes_total).unit : undefined,
      note: delta !== null ? `${delta > 0 ? "+" : ""}${fmtNumber(delta, 1)}% vs. mesmo trecho do mês passado` : s ? "Sem comparação justa com o mês passado" : undefined,
    },
    {
      key: "proj",
      label: "Projeção do mês",
      value: proj?.available ? fmtBytes(proj.bytes_total).value : "—",
      unit: proj?.available ? fmtBytes(proj.bytes_total).unit : undefined,
      note: proj?.available ? `Entre ${fmtBytesStr(proj.low)} e ${fmtBytesStr(proj.high)} (IC ≈95%)` : (proj?.reason ?? (s ? "Dados insuficientes" : undefined)),
    },
  ];

  return (
    <>
      <PageHeader
        title="Consumo de Internet"
        icon={<BarChart3 />}
        description="Consumo estimado localmente a partir do tráfego reportado pela antena. Não substitui o valor oficial do plano."
      />
      {summary.error && (
        <div className="mb-4">
          <QueryError error={summary.error} onRetry={() => summary.refetch()} />
        </div>
      )}
      {plan.error && (
        <div className="mb-4">
          <QueryError error={plan.error} />
        </div>
      )}

      <Verdict
        label="Quanto usei e vou estourar a franquia?"
        tone={v?.tone ?? "unknown"}
        word={v?.word}
        loading={!v && !summary.error && !plan.error}
        headline={v?.headline ?? "Não foi possível consultar o consumo agora."}
        figures={figures}
        meta={
          <>
            <span className="flex min-w-0 items-start gap-1.5">
              <Info className="mt-px size-3 shrink-0" aria-hidden />
              <span>
                <span className="text-fg-muted">Como é calculado:</span> {s?.method ?? "integração do tráfego instantâneo (bps) das amostras de 1 s do histórico da antena, dividido por 8. Períodos sem observação não são contados."}
              </span>
            </span>
            {delta !== null && <span>Comparação entre valores estimados, com coberturas possivelmente diferentes.</span>}
          </>
        }
      >
        {!plan.error && <PlanCard p={p} className="mt-5" />}
      </Verdict>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Consumo por período"
            className="flex-wrap"
            actions={<Tabs label="Agrupamento" value={bucket} onValueChange={(x) => setBucket(x as typeof bucket)} items={[{ value: "hour", label: "Hora (24 h)" }, { value: "day", label: "Dia (30 d)" }, { value: "month", label: "Mês (90 d)" }]} />}
          />
          <CardBody>
            {series.isLoading && <Skeleton className="h-64 w-full" />}
            {series.error && <QueryError error={series.error} />}
            {series.data && !series.data.points.length && <EmptyState icon={<BarChart3 />} title="Nenhum consumo registrado neste período" />}
            {series.data && series.data.points.length > 0 && <UsageBarChart data={series.data.points} tickFormatter={tick} height={420} />}
            {series.data?.peak_hour && (
              <p className="mt-2 text-xs text-fg-subtle">
                Hora de maior consumo no período: <span className="tabular text-fg-muted">{fmtDateTime(series.data.peak_hour.h)}</span> (<span className="tabular">{fmtBytesStr(series.data.peak_hour.b)}</span>)
              </p>
            )}
            {series.data && series.data.imported.length > 0 && (
              <div className="mt-4">
                <p className="mb-1 text-xs font-medium text-fg-muted">Períodos importados (origem: importada)</p>
                <ul className="space-y-1 text-xs tabular text-fg-muted">
                  {series.data.imported.map((i) => (
                    <li key={i.period_start}>
                      {fmtDateTime(i.period_start)} – {fmtDateTime(i.period_end)}: {fmtBytesStr(i.bytes_total)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Quando você mais usa" subtitle={`Média por hora do dia, 30 d · horário de ${s?.timezone ?? tz}`} />
          <CardBody>
            {profile.isLoading && <Skeleton className="h-64 w-full" />}
            {profile.error && <QueryError error={profile.error} />}
            {profile.data && (
              <>
                {peakHour && peakHour.bytes_total > 0 && (
                  <p className="mb-3 text-sm text-fg-muted">
                    Pico às <span className="tabular text-fg">{String(peakHour.hour).padStart(2, "0")}h</span>, com <span className="tabular text-fg">{fmtBytesStr(peakHour.bytes_total)}</span>.
                  </p>
                )}
                <ul className="space-y-[3px]" aria-label="Consumo por hora do dia">
                  {profile.data.map((h) => (
                    <li key={h.hour} className="flex items-center gap-2 text-[11px]">
                      <span className="w-6 tabular text-fg-subtle">{String(h.hour).padStart(2, "0")}h</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-[2px] bg-surface-2">
                        <div className={cn("h-full rounded-[2px]", peakHour?.hour === h.hour ? "bg-accent" : "bg-accent/55")} style={{ width: `${(h.bytes_total / maxProfile) * 100}%` }} />
                      </div>
                      <span className="w-16 text-right tabular text-fg-muted">{h.observed_seconds ? fmtBytesStr(h.bytes_total) : "sem dados"}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardBody>
        </Card>
        <div className="lg:col-span-2">
          <WindowsTable s={s} />
        </div>
        <CsvImport />
      </div>
    </>
  );
}
