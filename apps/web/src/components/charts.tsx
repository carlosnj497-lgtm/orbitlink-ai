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
import { chartTick, fmtBytesStr, fmtDateTime, fmtNumber } from "@/lib/format";

export type SeriesMode = "traffic" | "latency" | "loss" | "power";

const AXIS = { stroke: "var(--fg-subtle)", fontSize: 11, tickLine: false, axisLine: false } as const;

function TooltipBox({ active, payload, label, unit }: { active?: boolean; payload?: { name: string; value: number | null; color: string }[]; label?: number; unit: string }) {
  if (!active || !payload?.length || label === undefined) return null;
  return (
    <div className="rounded-lg border border-border-strong bg-surface-2/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      <p className="mb-1 font-medium text-fg-muted">{fmtDateTime(label)}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2 tabular">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
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
export function TelemetryChart({
  points,
  mode,
  start,
  end,
  gaps = [],
  height = 260,
}: {
  points: TelemetryPoint[];
  mode: SeriesMode;
  start: number;
  end: number;
  gaps?: Gap[];
  height?: number;
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
  const common = {
    data: points,
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
  const grid = <CartesianGrid stroke="var(--chart-grid)" vertical={false} />;
  const defs = (
    <defs>
      <pattern id="gap-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" fill="rgb(148 163 184 / 0.04)" />
        <line x1="0" y1="0" x2="0" y2="6" stroke="rgb(148 163 184 / 0.22)" strokeWidth="2" />
      </pattern>
      <linearGradient id="g-down" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="var(--chart-down)" stopOpacity={0.35} />
        <stop offset="1" stopColor="var(--chart-down)" stopOpacity={0} />
      </linearGradient>
      <linearGradient id="g-up" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="var(--chart-up)" stopOpacity={0.3} />
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
            <Tooltip content={<TooltipBox unit="Mbps" />} cursor={{ stroke: "var(--border-strong)" }} />
            {gapAreas}
            <Area name="Download" type="monotone" dataKey="down_mbps" stroke="var(--chart-down)" strokeWidth={1.6} fill="url(#g-down)" connectNulls={false} isAnimationActive={false} />
            <Area name="Upload" type="monotone" dataKey="up_mbps" stroke="var(--chart-up)" strokeWidth={1.4} fill="url(#g-up)" connectNulls={false} isAnimationActive={false} />
          </AreaChart>
        ) : (
          <LineChart {...common}>
            {defs}
            {grid}
            {xAxis}
            <YAxis {...AXIS} width={44} tickFormatter={(v: number) => fmtNumber(v, 0)} />
            <Tooltip content={<TooltipBox unit={mode === "latency" ? "ms" : mode === "loss" ? "%" : "W"} />} cursor={{ stroke: "var(--border-strong)" }} />
            {gapAreas}
            <Line
              name={mode === "latency" ? "Latência PoP" : mode === "loss" ? "Perda de ping" : "Potência"}
              type="monotone"
              dataKey={mode === "latency" ? "latency_ms" : mode === "loss" ? "drop_pct" : "power_w"}
              stroke={mode === "latency" ? "var(--chart-lat)" : mode === "loss" ? "var(--chart-loss)" : "var(--ok)"}
              strokeWidth={1.6}
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

export function Sparkline({ data, dataKey, color, height = 36 }: { data: TelemetryPoint[]; dataKey: keyof TelemetryPoint; color: string; height?: number }) {
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

export function UsageBarChart({
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
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="t" tickFormatter={tickFormatter} minTickGap={24} {...AXIS} />
          <YAxis {...AXIS} width={64} tickFormatter={(v: number) => fmtBytesStr(v)} />
          <Tooltip
            cursor={{ fill: "rgb(148 163 184 / 0.06)" }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <div className="rounded-lg border border-border-strong bg-surface-2/95 px-3 py-2 text-xs shadow-xl">
                  <p className="mb-1 font-medium text-fg-muted">{tickFormatter(label as number)}</p>
                  <p className="tabular">Download: {fmtBytesStr(payload[0]?.payload.bytes_download)}</p>
                  <p className="tabular">Upload: {fmtBytesStr(payload[0]?.payload.bytes_upload)}</p>
                  <p className="tabular text-fg-subtle">Cobertura: {Math.round((payload[0]?.payload.coverage ?? 0) * 100)}%</p>
                </div>
              ) : null
            }
          />
          <Bar dataKey="bytes_download" stackId="a" fill="var(--chart-down)" radius={[0, 0, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="bytes_upload" stackId="a" fill="var(--chart-up)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Mapa de obstrução: grade SNR (−1 = sem dado). Só é renderizado com dados reais da API. */
export function ObstructionGrid({ rows, cols, snr }: { rows: number; cols: number; snr: number[] }) {
  const cell = 4;
  const rects = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const v = snr[y * cols + x];
      if (v === undefined || v < 0) continue;
      const fill = v >= 0.9 ? "rgb(34 211 238 / 0.55)" : v > 0 ? "rgb(251 191 36 / 0.7)" : "rgb(248 113 113 / 0.9)";
      rects.push(<rect key={`${x}-${y}`} x={x * cell} y={y * cell} width={cell} height={cell} fill={fill} />);
    }
  }
  return (
    <svg viewBox={`0 0 ${cols * cell} ${rows * cell}`} className="aspect-square w-full max-w-[420px]" role="img" aria-label="Mapa de obstrução do céu visto pela antena">
      <circle cx={(cols * cell) / 2} cy={(rows * cell) / 2} r={(cols * cell) / 2 - 1} fill="var(--bg-elev)" stroke="var(--border-strong)" />
      {rects}
      <circle cx={(cols * cell) / 2} cy={(rows * cell) / 2} r={(cols * cell) / 4} fill="none" stroke="var(--border)" strokeDasharray="3 3" />
    </svg>
  );
}
