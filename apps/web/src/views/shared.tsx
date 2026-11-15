"use client";

import type { ConnectionEvent, Gap } from "@astryon/shared";
import { ArrowUpCircle, CircleAlert, CircleDot, Power, RadioTower, Unplug } from "lucide-react";
import { Badge, Tabs, type Tone } from "@/components/ui/primitives";
import { fmtDateTime, fmtDuration } from "@/lib/format";
import { useNow } from "@/lib/use-now";

export const RANGE_OPTIONS = [
  { value: "1h", label: "1h" },
  { value: "6h", label: "6h" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
];

export function RangeTabs({ value, onChange, options = RANGE_OPTIONS }: { value: string; onChange: (v: string) => void; options?: { value: string; label: string }[] }) {
  return <Tabs label="Período" value={value} onValueChange={onChange} items={options} />;
}

export const EVENT_META: Record<string, { label: string; icon: typeof Unplug; tone: Tone }> = {
  outage: { label: "Interrupção reportada pela antena", icon: Unplug, tone: "crit" },
  status_outage: { label: "Antena reportou indisponibilidade", icon: Unplug, tone: "crit" },
  ping_drop: { label: "Perda total de ping ao PoP", icon: CircleAlert, tone: "warn" },
  unreachable: { label: "Antena inacessível pelo agente", icon: RadioTower, tone: "neutral" },
  boot: { label: "Reinício da antena", icon: Power, tone: "info" },
  firmware_update: { label: "Atualização de firmware", icon: ArrowUpCircle, tone: "info" },
  power_loss: { label: "Falta de energia (ESP32)", icon: Power, tone: "crit" },
};

export const CONFIDENCE_META: Record<string, { label: string; tone: Tone; help: string }> = {
  confirmado: { label: "confirmado", tone: "accent", help: "Reportado explicitamente pela antena." },
  derivado: { label: "derivado", tone: "info", help: "Inferido pelo ASTRYON a partir das amostras; a causa não é determinada." },
  indeterminado: { label: "indeterminado", tone: "neutral", help: "Observado, mas a origem pode ser antena, rede local, roteador ou este computador." },
};

export function EventRow({ ev }: { ev: ConnectionEvent }) {
  const m = EVENT_META[ev.kind] ?? { label: ev.kind, icon: CircleDot, tone: "neutral" as Tone };
  const c = CONFIDENCE_META[ev.confidence];
  const Icon = m.icon;
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span className={`mt-0.5 rounded-md border border-border bg-surface-2 p-1.5 ${m.tone === "crit" ? "text-crit" : m.tone === "warn" ? "text-warn" : m.tone === "info" ? "text-info" : "text-fg-subtle"}`}>
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-fg">
          {m.label}
          {ev.cause && ev.kind !== "ping_drop" && <span className="text-fg-muted"> · {ev.cause}</span>}
        </p>
        <p className="text-xs text-fg-subtle tabular">
          {fmtDateTime(ev.start_ts)} · {ev.open ? "em andamento" : fmtDuration(ev.duration_s)}
        </p>
      </div>
      {c && (
        <Badge tone={c.tone} title={c.help}>
          {c.label}
        </Badge>
      )}
    </li>
  );
}

export function GapNote({ gaps }: { gaps: Gap[] }) {
  const now = useNow(30_000);
  if (!gaps.length) return null;
  const total = gaps.reduce((acc, g) => acc + ((g.end_ts ?? now ?? g.start_ts) - g.start_ts), 0);
  return (
    <p className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
      <span className="inline-block h-2.5 w-4 rounded-sm border border-border-strong bg-[repeating-linear-gradient(45deg,rgb(148_163_184/0.25)_0_2px,transparent_2px_5px)]" aria-hidden />
      {gaps.length} lacuna(s) de observação · {fmtDuration(total)} sem dados (não contadas como queda)
    </p>
  );
}
