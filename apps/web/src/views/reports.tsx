"use client";

import { Download, FileJson, FileSpreadsheet, FileText, Send } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/domain";
import { Button, Callout, Card, CardBody, CardHeader } from "@/components/ui/primitives";
import { api, errorText } from "@/lib/api";
import { useDemo } from "@/lib/demo-context";
import { RangeTabs } from "./shared";

const FORMATS = [
  { fmt: "pdf", icon: FileText, title: "Relatório PDF", desc: "Resumo executivo, estatísticas, consumo diário, achados do diagnóstico, eventos e lacunas." },
  { fmt: "csv", icon: FileSpreadsheet, title: "Planilha CSV", desc: "Agregados por minuto: consumo estimado, latência, jitter, perda, potência e fonte." },
  { fmt: "json", icon: FileJson, title: "Backup técnico JSON", desc: "Resumo, eventos, lacunas, capacidades, regras de alerta e configuração sem segredos." },
] as const;

export default function ReportsView() {
  const demo = useDemo();
  const [range, setRange] = useState("30d");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sentTg, setSentTg] = useState(false);

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
      const r = await fetch(`/api/agent/reports/export?fmt=${fmt}&range=${range}`);
      if (!r.ok) throw new Error(errorText(await r.json().catch(() => ({})), r.status));
      const blob = await r.blob();
      const name = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") ?? "")?.[1] ?? `orbitlink.${fmt}`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader title="Relatórios" icon={<FileText />} description="Exportações geradas no agente local a partir dos dados registrados. Toda exportação informa fonte, método e lacunas." actions={<RangeTabs value={range} onChange={setRange} options={[{ value: "24h", label: "24h" }, { value: "7d", label: "7d" }, { value: "30d", label: "30d" }, { value: "90d", label: "90d" }]} />} />
      {demo && <Callout tone="demo" className="mb-4">Exportações não estão disponíveis na demonstração.</Callout>}
      {err && <Callout tone="crit" className="mb-4">{err}</Callout>}
      {sentTg && <Callout tone="ok" className="mb-4">Relatório enviado ao seu chat do Telegram, com a comparação com o período anterior.</Callout>}
      <Callout tone="info" className="mb-4">
        No fim de cada ciclo da franquia, o relatório do ciclo em PDF é enviado sozinho ao Telegram (dia de virada definido em Configurações → Plano).
      </Callout>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {FORMATS.map(({ fmt, icon: Icon, title, desc }) => (
          <Card key={fmt}>
            <CardHeader title={title} icon={<Icon />} />
            <CardBody className="space-y-3">
              <p className="text-sm text-fg-muted">{desc}</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" size="sm" loading={busy === fmt} disabled={demo} onClick={() => download(fmt)}>
                  <Download /> Baixar ({range})
                </Button>
                {fmt === "pdf" && (
                  <Button size="sm" loading={busy === "telegram"} disabled={demo} onClick={toTelegram}>
                    <Send /> Enviar ao Telegram
                  </Button>
                )}
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </>
  );
}
