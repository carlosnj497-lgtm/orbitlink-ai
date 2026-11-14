"use client";

import type { UsagePlan, UsageSeries, UsageSummary, UsageWindow } from "@orbitlink/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BarChart3, FileUp, Gauge, Info } from "lucide-react";
import Link from "next/link";
import { type ChangeEvent, useCallback, useState } from "react";
import { UsageBarChart } from "@/components/charts";
import { CoverageBar, PageHeader, QueryError, SourceBadge } from "@/components/domain";
import { Badge, Button, Callout, Card, CardBody, CardHeader, EmptyState, Label, Select, Skeleton, Tabs } from "@/components/ui/primitives";
import { api, useAgent } from "@/lib/api";
import { useBasePath, useDemo } from "@/lib/demo-context";
import { fmtBytes, fmtBytesStr, fmtDateTime, fmtDay, fmtHM, fmtNumber } from "@/lib/format";

export function PlanCard({ p }: { p: UsagePlan | undefined }) {
  const base = useBasePath();
  if (!p) return <Skeleton className="h-28 w-full" />;
  const settingsHref = `${base}/configuracoes`;
  if (!p.configured) {
    return (
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Gauge className="size-5 text-fg-muted" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Franquia do plano não configurada</p>
            <p className="text-xs text-fg-subtle">Informe a franquia mensal e o dia de virada do ciclo para acompanhar o consumo e receber alertas em 80% e 100%.</p>
          </div>
          <Link href={settingsHref} className="text-sm font-medium text-accent hover:underline">Configurar</Link>
        </div>
      </Card>
    );
  }
  const pct = p.pct_used;
  const projOver = p.projected_pct !== null && p.projected_pct >= 100;
  // A cor diz o estado do ciclo, não o quanto encheu: estourou = vermelho; vai estourar ou passou de 80% = amarelo;
  // dentro do previsto = azul (preenchimento neutro). Verde fica reservado a "está tudo bem" de verdade.
  const tone = pct === null ? "neutral" : pct >= 100 ? "crit" : pct >= 80 || projOver ? "warn" : "fill";
  const bar = { neutral: "bg-fg-subtle", fill: "bg-accent-2", warn: "bg-warn", crit: "bg-crit" }[tone];
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[12px] font-medium text-fg-muted"><Gauge className="size-4" aria-hidden /> Franquia do ciclo</span>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-fg-subtle tabular">{fmtDay(p.cycle_start)} – {fmtDay(p.cycle_end - 1)} · faltam {fmtNumber(p.days_remaining, 1)} dias</span>
          <SourceBadge source={p.source} />
        </div>
      </div>
      <p className="mt-2 tabular text-2xl font-semibold">
        {pct === null ? "—" : `${p.lower_bound ? "≥ " : ""}${fmtNumber(pct, 1)}%`}
        <span className="ml-2 text-sm font-medium text-fg-muted">{fmtBytesStr(p.used.bytes_total)} de {fmtBytesStr(p.cap_bytes)}</span>
      </p>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label="Franquia consumida" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(pct ?? 0))}>
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-subtle tabular">
        {p.remaining_bytes !== null && <span>Restante estimado: {fmtBytesStr(p.remaining_bytes)}</span>}
        {p.projection?.available ? (
          <span>
            Projeção no fim do ciclo: {fmtBytesStr(p.projection.bytes_total)} ({fmtNumber(p.projected_pct, 0)}%)
            {projOver && <Badge tone="warn" className="ml-1">deve ultrapassar</Badge>}
          </span>
        ) : (
          <span>{p.projection?.reason ?? "Projeção indisponível."}</span>
        )}
      </div>
      {p.lower_bound && pct !== null && (
        <p className="mt-2 text-xs text-fg-subtle">Houve períodos sem observação neste ciclo ({fmtNumber(p.used.coverage * 100, 0)}% de cobertura), então o consumo real pode ser maior.</p>
      )}
    </Card>
  );
}

function WindowCard({ title, w }: { title: string; w: UsageWindow | undefined }) {
  const b = fmtBytes(w?.bytes_total);
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-fg-muted">{title}</span>
        {w && <SourceBadge source={w.source} />}
      </div>
      {!w ? (
        <Skeleton className="mt-3 h-8 w-28" />
      ) : (
        <>
          <p className="mt-2 tabular text-2xl font-semibold">
            {b.value} <span className="text-sm font-medium text-fg-muted">{b.unit}</span>
          </p>
          <p className="mt-1 text-xs text-fg-subtle tabular">
            ↓ {fmtBytesStr(w.bytes_download)} · ↑ {fmtBytesStr(w.bytes_upload)}
          </p>
          <CoverageBar coverage={w.coverage} className="mt-2" />
        </>
      )}
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
  const proj = s?.projection_month;
  const maxProfile = Math.max(1, ...(profile.data?.map((p) => p.bytes_total) ?? [1]));
  const tick = useCallback((t: number) => (bucket === "hour" ? fmtHM(t) : fmtDay(t)), [bucket]);
  const delta = s && s.previous_month.bytes_total ? ((s.month.bytes_total - s.previous_month.bytes_total) / s.previous_month.bytes_total) * 100 : null;

  return (
    <>
      <PageHeader
        title="Consumo de Internet"
        icon={<BarChart3 />}
        description="Consumo estimado localmente a partir do tráfego reportado pela antena. Não substitui o valor oficial do plano."
      />
      <Callout tone="info" icon={<Info />} title="Como este valor é calculado" className="mb-4">
        {s?.method ?? "Integração do tráfego instantâneo (bps) das amostras de 1 s do histórico da antena, dividido por 8. Períodos sem observação não são contados."}
      </Callout>
      {summary.error && <QueryError error={summary.error} onRetry={() => summary.refetch()} />}
      <div className="mb-3">{plan.error ? <QueryError error={plan.error} /> : <PlanCard p={plan.data} />}</div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <WindowCard title="Hoje" w={s?.today} />
        <WindowCard title="Ontem" w={s?.yesterday} />
        <WindowCard title="Esta semana" w={s?.week} />
        <WindowCard title="Este mês" w={s?.month} />
        <Card className="col-span-2 p-4 lg:col-span-1">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-fg-muted">Projeção do mês</span>
            <SourceBadge source={proj?.available ? "estimada" : "indisponivel"} />
          </div>
          {!s ? (
            <Skeleton className="mt-3 h-8 w-24" />
          ) : proj?.available ? (
            <>
              <p className="mt-2 tabular text-2xl font-semibold">{fmtBytesStr(proj.bytes_total)}</p>
              <p className="mt-1 text-xs text-fg-subtle tabular">
                IC ≈95%: {fmtBytesStr(proj.low)} – {fmtBytesStr(proj.high)} · {proj.days_used} dias
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-fg-muted">{proj?.reason ?? "Dados insuficientes."}</p>
          )}
        </Card>
      </div>
      {delta !== null && (
        <p className="mt-2 text-xs text-fg-subtle">
          Mês atual vs. mês anterior (até agora): <Badge tone={delta > 0 ? "warn" : "ok"}>{delta > 0 ? "+" : ""}{delta.toFixed(1)}%</Badge> — comparação de valores estimados com coberturas possivelmente diferentes.
        </p>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Consumo por período"
            actions={<Tabs label="Agrupamento" value={bucket} onValueChange={(v) => setBucket(v as typeof bucket)} items={[{ value: "hour", label: "Hora (24 h)" }, { value: "day", label: "Dia (30 d)" }, { value: "month", label: "Mês (90 d)" }]} />}
          />
          <CardBody>
            {series.isLoading && <Skeleton className="h-64 w-full" />}
            {series.error && <QueryError error={series.error} />}
            {series.data && !series.data.points.length && <EmptyState icon={<BarChart3 />} title="Nenhum consumo registrado neste período" />}
            {series.data && series.data.points.length > 0 && <UsageBarChart data={series.data.points} tickFormatter={tick} height={450} />}
            {series.data?.peak_hour && (
              <p className="mt-2 text-xs text-fg-subtle">
                Hora de maior consumo no período: {fmtDateTime(series.data.peak_hour.h)} ({fmtBytesStr(series.data.peak_hour.b)})
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
          <CardHeader title="Perfil por hora do dia (30 d)" subtitle="Horário de America/Fortaleza" />
          <CardBody>
            {profile.isLoading && <Skeleton className="h-64 w-full" />}
            {profile.data && (
              <ul className="space-y-[3px]" aria-label="Consumo por hora do dia">
                {profile.data.map((p) => (
                  <li key={p.hour} className="flex items-center gap-2 text-[11px]">
                    <span className="w-6 tabular text-fg-subtle">{String(p.hour).padStart(2, "0")}h</span>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-sm bg-surface-2">
                      <div className="h-full rounded-sm bg-accent/70" style={{ width: `${(p.bytes_total / maxProfile) * 100}%` }} />
                    </div>
                    <span className="w-16 text-right tabular text-fg-muted">{fmtBytesStr(p.bytes_total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
      <div className="mt-4">
        <CsvImport />
      </div>
    </>
  );
}
