"use client";

import type { AgentInfo, NotificationStatus, Quality } from "@astryon/shared";
import { Download, FileJson, FileSpreadsheet, FileText, Send } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PageHeader, QueryError } from "@/components/domain";
import { hrefOf } from "@/components/shell/nav";
import { Button, Callout, Skeleton } from "@/components/ui/primitives";
import { api, downloadFrom, useAgent } from "@/lib/api";
import { useBasePath, useDemo } from "@/lib/demo-context";
import { fmtAgo, fmtBytesStr, fmtDateTime, fmtDuration, fmtNumber, fmtPct } from "@/lib/format";
import { CheckDetails, Checklist, ChecklistItem, type CheckState, StateCounts, VerdictPanel } from "./diagnostics-parts/checklist";
import { RangeTabs } from "./shared";

const FORMATS = [
  {
    fmt: "pdf",
    icon: FileText,
    title: "Relatório PDF",
    desc: "Resumo executivo, estatísticas, consumo diário, achados do diagnóstico, eventos e lacunas.",
    format: "PDF para ler ou imprimir (astryon-relatorio-….pdf).",
    parts: "Seções: resumo executivo, estatísticas do período, consumo por dia, achados do diagnóstico, eventos e lacunas.",
  },
  {
    fmt: "csv",
    icon: FileSpreadsheet,
    title: "Planilha CSV",
    desc: "Agregados por minuto: consumo estimado, latência, jitter, perda, potência e fonte.",
    format: "Texto separado por ponto e vírgula (;), UTF-8, abre no Excel e no LibreOffice.",
    parts: "12 colunas: minuto UTC e local, download e upload estimados, cobertura, latência média e máxima, jitter, perda, segundos de perda total, potência e fonte.",
  },
  {
    fmt: "json",
    icon: FileJson,
    title: "Backup técnico JSON",
    desc: "Resumo, eventos, lacunas, capacidades, regras de alerta e configuração sem segredos.",
    format: "JSON (astryon-backup-….json), para guardar ou importar em outra ferramenta.",
    parts: "Blocos: resumo, eventos, lacunas, capacidades do firmware, regras de alerta e configuração sem segredos.",
  },
] as const;

const PERIOD: Record<string, string> = { "24h": "das últimas 24 h", "7d": "dos últimos 7 dias", "30d": "dos últimos 30 dias", "90d": "dos últimos 90 dias" };

type Avail = { state: CheckState; label: string };

/** Tamanho aproximado. O CSV tem uma linha por minuto observado (~150 bytes cada); os outros dependem dos eventos. */
function sizeOf(fmt: string, q: Quality | undefined) {
  if (fmt === "csv") {
    if (!q) return "—";
    const rows = Math.round(q.observed_seconds / 60);
    return `cerca de ${fmtNumber(rows, 0)} linhas, ~${fmtBytesStr(rows * 150)} (estimativa)`;
  }
  if (fmt === "pdf") return "Poucas páginas; cresce com o número de eventos e achados.";
  return "Pequeno; cresce com o número de eventos e lacunas.";
}

/** Disponibilidade pelos dados que o agente tem no período: suficientes (80% ou mais observado), parciais ou nenhum. */
function availability(q: Quality | undefined, loading: boolean): Avail {
  if (!q) return loading ? { state: "pending", label: "verificando" } : { state: "pending", label: "não verificado" };
  const c = q.coverage ?? 0;
  if (c >= 0.8) return { state: "ok", label: "dados suficientes" };
  if (c > 0) return { state: "warn", label: "dados parciais" };
  return { state: "off", label: "sem dados" };
}

export default function ReportsView() {
  const demo = useDemo();
  const base = useBasePath();
  const [range, setRange] = useState("30d");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sentTg, setSentTg] = useState(false);
  const quality = useAgent<Quality>(`quality?range=${range}`);
  const agent = useAgent<AgentInfo>("agent");
  const notif = useAgent<NotificationStatus>("alerts/notifications");
  const q = quality.data;
  const telegram = notif.data?.channels.telegram;

  async function toTelegram() {
    setErr(null);
    setSentTg(false);
    setBusy("telegram");
    try {
      await api(`reports/telegram?range=${range}`, { method: "POST" });
      setSentTg(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function download(fmt: string) {
    setErr(null);
    setBusy(fmt);
    try {
      await downloadFrom(`/api/agent/reports/export?fmt=${fmt}&range=${range}`, `astryon.${fmt}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const data = availability(q, quality.isLoading);
  // O backup técnico sempre tem a configuração e as regras; sem medições, ele sai só com isso.
  const itemAvail = (fmt: string): Avail => (fmt === "json" && data.state === "off" ? { state: "info", label: "só configuração" } : data);
  const avails = FORMATS.map((f) => itemAvail(f.fmt).state);
  const nOk = avails.filter((s) => s === "ok").length;
  const nPartial = avails.filter((s) => s === "warn").length;
  const nNone = avails.filter((s) => s === "off" || s === "info").length;
  const period = PERIOD[range] ?? "do período";
  const cov = q ? fmtPct((q.coverage ?? 0) * 100, 0) : "";

  const sentence = !q
    ? quality.isLoading
      ? <Skeleton className="h-6 w-80 max-w-full" />
      : "Não foi possível verificar os dados do período."
    : data.state === "ok"
      ? demo
        ? `Os dados ${period} (cobertura de ${cov}) bastam para as ${FORMATS.length} exportações; baixar está desligado na demonstração.`
        : `${FORMATS.length} exportações prontas com os dados ${period} (cobertura de ${cov}).`
      : data.state === "warn"
        ? `Dados parciais ${period}: o agente observou ${cov} do período.`
        : `Sem medições registradas ${period}; só o backup técnico tem conteúdo.`;

  return (
    <>
      <PageHeader title="Relatórios" icon={<FileText />} description="Exportações geradas no agente local a partir dos dados registrados. Toda exportação informa fonte, método e lacunas." actions={<RangeTabs value={range} onChange={setRange} options={[{ value: "24h", label: "24h" }, { value: "7d", label: "7d" }, { value: "30d", label: "30d" }, { value: "90d", label: "90d" }]} />} />

      <VerdictPanel
        state={quality.isLoading ? "loading" : data.state === "pending" ? "pending" : data.state}
        sentence={sentence}
        counts={
          q && (
            <StateCounts
              items={[
                { state: "ok", n: nOk, word: "com dados suficientes", always: true },
                { state: "warn", n: nPartial, word: nPartial === 1 ? "parcial" : "parciais" },
                { state: "off", n: nNone, word: "sem medições" },
              ]}
            />
          )
        }
        meta={
          q && (
            <span>
              Dados de <span className="tabular">{fmtDateTime(q.start)}</span> a <span className="tabular">{fmtDateTime(q.end)}</span>
              {agent.data?.last_status_ts ? <> · última leitura da antena {fmtAgo(agent.data.last_status_ts)}</> : null}
            </span>
          )
        }
      >
        {demo && data.state !== "ok" ? (
          "Exportações não estão disponíveis na demonstração."
        ) : q && data.state === "warn" ? (
          <>As exportações saem assim mesmo e marcam cada lacuna: {q.gaps.length === 1 ? "1 trecho" : `${q.gaps.length} trechos`} sem coleta, {fmtDuration(q.observed_seconds)} observados.</>
        ) : q ? (
          <>Cada arquivo informa fonte, método e lacunas. {q.gaps.length > 0 ? `${q.gaps.length === 1 ? "1 lacuna registrada" : `${q.gaps.length} lacunas registradas`} no período.` : "Nenhuma lacuna registrada no período."}</>
        ) : null}
      </VerdictPanel>

      {quality.error && (
        <div className="mb-4">
          <QueryError error={quality.error} onRetry={() => quality.refetch()} />
        </div>
      )}
      {err && <Callout tone="crit" className="mb-4">{err}</Callout>}
      {sentTg && <Callout tone="ok" className="mb-4">Relatório enviado ao seu chat do Telegram, com a comparação com o período anterior.</Callout>}

      <Checklist title="Exportações" description="Abra um item para ver o que vai no arquivo e de quando são os dados.">
        {FORMATS.map((f) => {
          const { fmt, icon: Icon, title, desc } = f;
          const av = itemAvail(fmt);
          return (
            <ChecklistItem
              key={fmt}
              state={av.state}
              stateLabel={av.label}
              title={
                <span className="inline-flex items-center gap-2">
                  <Icon className="size-4 text-fg-subtle" aria-hidden />
                  {title}
                </span>
              }
              summary={desc}
              actionsClassName="lg:w-[21.5rem]"
              actions={
                <>
                  <Button variant="primary" size="sm" loading={busy === fmt} disabled={demo || !!busy} onClick={() => download(fmt)}>
                    {busy !== fmt && <Download />} Baixar ({range})
                  </Button>
                  {fmt === "pdf" && (
                    <Button size="sm" loading={busy === "telegram"} disabled={demo || !!busy || telegram === false} onClick={toTelegram} title={telegram === false ? "Telegram não configurado" : undefined}>
                      {busy !== "telegram" && <Send />} Enviar ao Telegram
                    </Button>
                  )}
                </>
              }
            >
              <CheckDetails
                rows={[
                  { label: "Formato", value: f.format },
                  { label: fmt === "csv" ? "Colunas" : fmt === "pdf" ? "Seções" : "Blocos", value: f.parts.replace(/^[^:]+: /, "") },
                  { label: "Tamanho", value: sizeOf(fmt, q) },
                  {
                    label: "Dados e lacunas",
                    value: q ? (
                      <>
                        <span className="tabular">{cov}</span> do período observado ({fmtDuration(q.observed_seconds)}) · {q.gaps.length === 1 ? "1 lacuna" : `${q.gaps.length} lacunas`}
                      </>
                    ) : (
                      "Ainda não verificado."
                    ),
                  },
                  { label: "Observação", value: av.state === "warn" ? "Os trechos sem coleta aparecem marcados no arquivo; nunca viram zero." : av.state === "info" ? "Sem medições no período: o arquivo leva só configuração, capacidades e regras." : av.state === "off" ? "Sem medições no período: o arquivo sai vazio." : null },
                  { label: "Telegram", value: fmt === "pdf" && telegram === false ? "Envio indisponível: configure o bot do Telegram em Configurações → Avisos." : null },
                ]}
              />
            </ChecklistItem>
          );
        })}
        <ChecklistItem
          state={notif.isLoading ? "pending" : telegram ? "ok" : "off"}
          stateLabel={notif.isLoading ? "verificando" : telegram ? "ligado" : "Telegram não configurado"}
          title="Envio automático do ciclo"
          summary="No fim de cada ciclo da franquia, o relatório do ciclo em PDF é enviado sozinho ao Telegram."
          actionsClassName="lg:w-[21.5rem]"
          actions={
            <Link href={`${hrefOf(base, "configuracoes")}#${telegram ? "plano" : "notificacoes"}`} className="inline-flex h-8 items-center rounded-md border border-border-strong bg-surface-2 px-3 text-sm font-medium text-fg transition-colors hover:border-accent-2/50 hover:bg-surface-3">
              {telegram ? "Ajustar dia de virada" : "Configurar Telegram"}
            </Link>
          }
        >
          <CheckDetails
            rows={[
              {
                label: "Quando",
                value: (
                  <>
                    No dia de virada definido em{" "}
                    <Link href={`${hrefOf(base, "configuracoes")}#plano`} className="font-medium text-accent hover:underline">
                      Configurações → Plano
                    </Link>
                    .
                  </>
                ),
              },
              { label: "O que fazer", value: telegram ? "Nada: o envio está ativo." : "Configure o bot do Telegram para receber o relatório do ciclo sem precisar abrir o painel." },
            ]}
          />
        </ChecklistItem>
      </Checklist>
    </>
  );
}
