"use client";

import type { Gap, TelemetryPoint } from "@orbitlink/shared";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { memo, useEffect, useRef } from "react";
import { chartTick, fmtBytesStr, fmtDateTime, fmtNumber } from "@/lib/format";
import { RAIN_META, type RainBand } from "@/lib/weather";

export type SeriesMode = "traffic" | "latency" | "loss" | "power";

const AXIS = { stroke: "var(--fg-subtle)", fontSize: 10.5, fontFamily: "var(--font-mono)", tickLine: false, axisLine: false } as const;
const TIP_BOX = "ol-hud rounded-md border border-border-strong bg-bg-elev/95 px-3 py-2 text-xs shadow-[0_14px_30px_-12px_rgb(0_0_0/0.95)] backdrop-blur-sm";

function TooltipBox({ active, payload, label, unit }: { active?: boolean; payload?: { name: string; value: number | null; color: string }[]; label?: number; unit: string }) {
  if (!active || !payload?.length || label === undefined) return null;
  return (
    <div className={TIP_BOX}>
      <p className="tabular mb-1.5 text-[11px] text-fg-subtle">{fmtDateTime(label)}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2 tabular">
          <span className="h-0.5 w-3 rounded-full" style={{ background: p.color }} />
          <span className="text-fg-muted">{p.name}</span>
          <span className="ml-auto font-medium text-fg">{p.value === null || p.value === undefined ? "sem dado" : `${fmtNumber(p.value, 2)} ${unit}`}</span>
        </p>
      ))}
    </div>
  );
}

/**
 * Série temporal. Pontos ausentes NÃO são ligados (connectNulls=false) e lacunas de observação
 * aparecem como faixas hachuradas — nunca como zero.
 */
function TelemetryChartImpl({
  points,
  mode,
  start,
  end,
  gaps = [],
  rain = [],
  height = 260,
  hideDown = false,
  hideUp = false,
  syncId,
}: {
  points: TelemetryPoint[];
  mode: SeriesMode;
  start: number;
  end: number;
  gaps?: Gap[];
  /** Faixas de chuva (clima estimado) atrás das séries: mostram coincidência, não causa. */
  rain?: RainBand[];
  height?: number;
  /** Legenda interativa do modo tráfego: oculta a série sem recriar o gráfico. */
  hideDown?: boolean;
  hideUp?: boolean;
  /** Gráficos com o mesmo syncId mostram o cursor e a dica no mesmo instante. */
  syncId?: string;
}) {
  const span = end - start;
  const gapAreas = gaps.map((g, i) => (
    <ReferenceArea
      key={`gap-${i}`}
      x1={Math.max(g.start_ts, start)}
      x2={Math.min(g.end_ts ?? end, end)}
      fill="url(#gap-hatch)"
      fillOpacity={1}
      stroke="none"
      ifOverflow="hidden"
    />
  ));
  const rainAreas = rain.map((r, i) => (
    <ReferenceArea key={`rain-${i}`} x1={r.start} x2={r.end} fill="var(--chart-rain, rgb(56 189 248))" fillOpacity={RAIN_META[r.level].opacity} stroke="none" ifOverflow="hidden" />
  ));
  const common = {
    data: points,
    syncId,
    margin: { top: 8, right: 8, bottom: 0, left: -8 },
  };
  const xAxis = (
    <XAxis
      dataKey="t"
      type="number"
      domain={[start, end]}
      scale="time"
      tickFormatter={(v: number) => chartTick(v, span)}
      minTickGap={48}
      {...AXIS}
    />
  );
  const grid = <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="2 4" vertical={false} />;
  const defs = (
    <defs>
      <pattern id="gap-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" fill="rgb(167 169 172 / 0.03)" />
        <line x1="0" y1="0" x2="0" y2="6" stroke="rgb(167 169 172 / 0.2)" strokeWidth="1.5" />
      </pattern>
      <linearGradient id="g-down" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="var(--chart-down)" stopOpacity={0.22} />
        <stop offset="1" stopColor="var(--chart-down)" stopOpacity={0} />
      </linearGradient>
      <linearGradient id="g-up" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="var(--chart-up)" stopOpacity={0.1} />
        <stop offset="1" stopColor="var(--chart-up)" stopOpacity={0} />
      </linearGradient>
    </defs>
  );

  return (
    <div style={{ height }} className="w-full" role="img" aria-label={`Gráfico de ${mode === "traffic" ? "tráfego" : mode === "latency" ? "latência" : mode === "loss" ? "perda" : "potência"}`}>
      <ResponsiveContainer width="100%" height="100%">
        {mode === "traffic" ? (
          <AreaChart {...common}>
            {defs}
            {grid}
            {xAxis}
            <YAxis {...AXIS} width={44} tickFormatter={(v: number) => fmtNumber(v, 0)} />
            <Tooltip content={<TooltipBox unit="Mbps" />} cursor={{ stroke: "var(--accent-2)", strokeOpacity: 0.6, strokeDasharray: "3 3" }} />
            {rainAreas}
            {gapAreas}
            <Area hide={hideDown} name="Download" type="monotone" dataKey="down_mbps" stroke="var(--chart-down)" strokeWidth={1.4} fill="url(#g-down)" connectNulls={false} isAnimationActive={false} />
            <Area hide={hideUp} name="Upload" type="monotone" dataKey="up_mbps" stroke="var(--chart-up)" strokeOpacity={0.85} strokeWidth={1.1} fill="url(#g-up)" connectNulls={false} isAnimationActive={false} />
          </AreaChart>
        ) : (
          <LineChart {...common}>
            {defs}
            {grid}
            {xAxis}
            <YAxis {...AXIS} width={44} tickFormatter={(v: number) => fmtNumber(v, 0)} />
            <Tooltip content={<TooltipBox unit={mode === "latency" ? "ms" : mode === "loss" ? "%" : "W"} />} cursor={{ stroke: "var(--accent-2)", strokeOpacity: 0.6, strokeDasharray: "3 3" }} />
            {rainAreas}
            {gapAreas}
            <Line
              name={mode === "latency" ? "Latência PoP" : mode === "loss" ? "Perda de ping" : "Potência"}
              type="monotone"
              dataKey={mode === "latency" ? "latency_ms" : mode === "loss" ? "drop_pct" : "power_w"}
              stroke={mode === "latency" ? "var(--chart-lat)" : mode === "loss" ? "var(--chart-loss)" : "var(--chart-up)"}
              strokeWidth={1.4}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

function SparklineImpl({ data, dataKey, color, height = 36 }: { data: TelemetryPoint[]; dataKey: keyof TelemetryPoint; color: string; height?: number }) {
  return (
    <div style={{ height }} className="mt-2 w-full" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }} accessibilityLayer={false} tabIndex={-1}>
          <defs>
            <linearGradient id={`sp-${String(dataKey)}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity={0.35} />
              <stop offset="1" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey={dataKey as string} stroke={color} strokeWidth={1.4} fill={`url(#sp-${String(dataKey)})`} connectNulls={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function UsageBarChartImpl({
  data,
  height = 260,
  tickFormatter,
}: {
  data: { t: number; bytes_download: number; bytes_upload: number; coverage: number }[];
  height?: number;
  tickFormatter: (t: number) => string;
}) {
  return (
    <div style={{ height }} className="w-full" role="img" aria-label="Gráfico de consumo por período">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
          <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="t" tickFormatter={tickFormatter} minTickGap={24} {...AXIS} />
          <YAxis {...AXIS} width={64} tickFormatter={(v: number) => fmtBytesStr(v)} />
          <Tooltip
            cursor={{ fill: "rgb(0 140 255 / 0.07)" }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <div className={TIP_BOX}>
                  <p className="tabular mb-1.5 text-[11px] text-fg-subtle">{tickFormatter(label as number)}</p>
                  <p className="tabular">Download: {fmtBytesStr(payload[0]?.payload.bytes_download)}</p>
                  <p className="tabular">Upload: {fmtBytesStr(payload[0]?.payload.bytes_upload)}</p>
                  <p className="tabular text-fg-subtle">Cobertura: {Math.round((payload[0]?.payload.coverage ?? 0) * 100)}%</p>
                </div>
              ) : null
            }
          />
          <Bar dataKey="bytes_download" stackId="a" fill="var(--chart-down)" radius={[0, 0, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="bytes_upload" stackId="a" fill="var(--chart-up)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Mapa de obstrução: grade SNR (−1 = sem dado). Só é renderizado com dados reais da API.
 * Desenhado em <canvas>: o mapa real tem 123×123 células e 15 mil <rect> em SVG pesavam em PCs modestos.
 */
function ObstructionGridImpl({ rows, cols, snr, className }: { rows: number; cols: number; snr: number[]; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const cell = 4;
    const w = cols * cell;
    const h = rows * cell;
    canvas.width = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 1, 0, Math.PI * 2);
    ctx.fillStyle = "#080b10";
    ctx.fill();
    ctx.strokeStyle = "#364354";
    ctx.stroke();
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const v = snr[y * cols + x];
        if (v === undefined || v < 0) continue;
        ctx.fillStyle = v >= 0.9 ? "rgba(56,189,248,0.55)" : v > 0 ? "rgba(232,185,49,0.75)" : "rgba(255,70,85,0.9)";
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
    ctx.beginPath();
    ctx.setLineDash([3, 3]);
    ctx.arc(w / 2, h / 2, w / 4, 0, Math.PI * 2);
    ctx.strokeStyle = "#27313f";
    ctx.stroke();
  }, [rows, cols, snr]);
  return <canvas ref={ref} className={className ?? "aspect-square w-full max-w-[420px]"} role="img" aria-label="Mapa de obstrução do céu visto pela antena" />;
}

/*
 * Gráficos memorizados: com o status chegando a cada ~10 s (SSE) a tela inteira re-renderiza, mas os
 * pontos vêm do React Query com structural sharing — sem memo, o Recharts redesenhava centenas de
 * pontos SVG a cada atualização mesmo sem mudança nos dados.
 */
export const TelemetryChart = memo(TelemetryChartImpl);
export const Sparkline = memo(SparklineImpl);
export const UsageBarChart = memo(UsageBarChartImpl);
export const ObstructionGrid = memo(ObstructionGridImpl);
