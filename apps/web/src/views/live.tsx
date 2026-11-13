"use client";

import type { StatusResponse, Telemetry } from "@orbitlink/shared";
import { Activity, Download, Pause, Play } from "lucide-react";
import { useState } from "react";
import { TelemetryChart } from "@/components/charts";
import { CoverageBar, PageHeader, QueryError, SourceBadge } from "@/components/domain";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Skeleton } from "@/components/ui/primitives";
import { useAgent, useAgentStream } from "@/lib/api";
import { fmtDateTime, fmtMbps, fmtNumber } from "@/lib/format";
import { GapNote, RangeTabs } from "./shared";

export function downloadCsv(filename: string, header: string[], rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => (v === null ? "" : /[",;\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const csv = [header.join(";"), ...rows.map((r) => r.map(esc).join(";"))].join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function LiveView() {
  const [range, setRange] = useState("15m");
  const [paused, setPaused] = useState(false);
  const stream = useAgentStream(!paused);
  const status = useAgent<StatusResponse>("status", { refetchInterval: paused ? false : 10_000 });
  const tel = useAgent<Telemetry>(`telemetry?range=${range}`, { refetchInterval: paused ? false : 15_000 });
  const st = status.data?.available ? status.data.status : null;
  const m = st?.metrics;

  function exportCsv() {
    if (!tel.data) return;
    downloadCsv(
      `orbitlink-telemetria-${range}.csv`,
      ["timestamp_utc", "horario_local", "download_mbps", "upload_mbps", "latencia_pop_ms", "perda_pct", "potencia_w", "amostras", "fonte"],
      tel.data.points.map((p) => [new Date(p.t * 1000).toISOString(), fmtDateTime(p.t), p.down_mbps, p.up_mbps, p.latency_ms, p.drop_pct, p.power_w, p.n, tel.data!.source]),
    );
  }

  const stat = (label: string, v: string, unit: string) => (
    <div className="rounded-lg border border-border bg-bg-elev/60 px-3 py-2">
      <p className="text-[11px] text-fg-subtle">{label}</p>
      <p className="tabular text-lg font-semibold">
        {v} <span className="text-xs font-normal text-fg-muted">{unit}</span>
      </p>
    </div>
  );

  return (
    <>
      <PageHeader
        title="Monitoramento ao Vivo"
        icon={<Activity />}
        description="Status a cada ~10 s via SSE e histórico de 1 s lido incrementalmente da antena (~30 s de atraso)."
        actions={
          <>
            <RangeTabs value={range} onChange={setRange} options={[{ value: "15m", label: "15 min" }, { value: "1h", label: "1 h" }, { value: "6h", label: "6 h" }]} />
            <Button size="sm" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
              {paused ? <Play /> : <Pause />} {paused ? "Retomar" : "Pausar"}
            </Button>
            <Button size="sm" onClick={exportCsv} disabled={!tel.data?.points.length}>
              <Download /> Exportar CSV
            </Button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <Badge tone={paused ? "warn" : stream === "open" || stream === "demo" ? "ok" : "neutral"}>
          {paused ? "pausado" : stream === "open" || stream === "demo" ? "stream ativo" : stream}
        </Badge>
        {st && <span className="text-fg-subtle">Última amostra de status: {fmtDateTime(Date.parse(st.observed_at) / 1000)}</span>}
        {st && <SourceBadge source={m?.downlink_mbps?.source} />}
      </div>

      {status.error && <QueryError error={status.error} />}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {stat("Download (corrente)", fmtMbps(typeof m?.downlink_mbps?.value === "number" ? m.downlink_mbps.value : null), "Mbps")}
        {stat("Upload (corrente)", fmtMbps(typeof m?.uplink_mbps?.value === "number" ? m.uplink_mbps.value : null), "Mbps")}
        {stat("Latência PoP", fmtNumber(typeof m?.pop_latency_ms?.value === "number" ? m.pop_latency_ms.value : null, 1), "ms")}
        {stat("Perda PoP", fmtNumber(typeof m?.pop_drop_pct?.value === "number" ? m.pop_drop_pct.value : null, 2), "%")}
      </div>

      <div className="grid gap-4">
        {(["traffic", "latency", "loss"] as const).map((mode) => (
          <Card key={mode}>
            <CardHeader title={mode === "traffic" ? "Tráfego corrente (Mbps)" : mode === "latency" ? "Latência até o PoP (ms)" : "Perda de ping ao PoP (%)"} actions={tel.data && <SourceBadge source={tel.data.source} />} />
            <CardBody>
              {tel.isLoading && <Skeleton className="h-52 w-full" />}
              {tel.error && <QueryError error={tel.error} />}
              {tel.data && !tel.data.points.length && <EmptyState title="Aguardando amostras reais da antena" />}
              {tel.data && tel.data.points.length > 0 && (
                <TelemetryChart points={tel.data.points} mode={mode} start={tel.data.start} end={tel.data.end} gaps={tel.data.gaps} height={210} />
              )}
            </CardBody>
          </Card>
        ))}
      </div>
      {tel.data && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <GapNote gaps={tel.data.gaps} />
          <CoverageBar coverage={tel.data.coverage} />
        </div>
      )}
    </>
  );
}
