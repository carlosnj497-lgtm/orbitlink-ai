"use client";

import { BellOff, BellRing, Pencil, Trash2 } from "lucide-react";
import { Badge, Button, Switch } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { fmtAgo, fmtDateTime } from "@/lib/format";
import { fmtReading, fmtSpan, fmtThreshold, KIND_TEXT, type Kinds, type Rule, SEVERITY, unitOf } from "./phrases";

/** A regra lida como frase: "Avise quando a latência média passar de 100 ms por 5 min". */
export function RuleSentence({ r, kinds }: { r: Pick<Rule, "kind" | "threshold" | "min_duration_s" | "window_s">; kinds?: Kinds }) {
  const t = KIND_TEXT[r.kind];
  if (!t) {
    return (
      <>
        {kinds?.[r.kind]?.label ?? r.kind} {r.threshold}
      </>
    );
  }
  return (
    <>
      Avise quando {t.subject}
      {!t.binary && (
        <>
          {" "}
          {t.verb} <strong className="tabular mr-[0.15em] font-medium text-fg">{fmtThreshold(r.kind, r.threshold, kinds)}</strong>
        </>
      )}
      {!t.binary && !t.noDuration && r.min_duration_s > 0 && (
        <>
          {" "}
          por <strong className="tabular mr-[0.15em] font-medium text-fg">{fmtSpan(r.min_duration_s)}</strong>
        </>
      )}
      {t.windowLabel && (
        <>
          {" "}
          {t.windowLabel} <strong className="tabular mr-[0.15em] font-medium text-fg">{fmtSpan(r.window_s)}</strong>
        </>
      )}
    </>
  );
}

/**
 * Medidor do valor atual até o limite. A faixa além do limite fica pintada com o tom da gravidade;
 * o ponto é a leitura atual (azul enquanto está dentro do normal, cor da gravidade quando passou).
 */
function Meter({ r, value, kinds, breach }: { r: Rule; value: number; kinds?: Kinds; breach: boolean }) {
  const thr = r.threshold;
  // escala até 1,5× o limite; porcentagem nunca passa de 100% (a menos que o próprio valor passe)
  const span = Math.max(thr * 1.5, value * 1.1, thr + 1);
  const max = unitOf(r.kind, kinds) === "%" ? Math.max(value, Math.min(100, span)) : span;
  const pos = (v: number) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`;
  const sev = SEVERITY[r.severity].tone;
  // azul é só a leitura viva; a zona de "aviso" fica em prata
  const zone = sev === "crit" ? "bg-crit/40" : sev === "warn" ? "bg-warn/35" : "bg-fg-muted/30";
  const dot = !breach ? "bg-accent" : sev === "crit" ? "bg-crit" : sev === "warn" ? "bg-warn" : "bg-fg";
  return (
    <div
      role="meter"
      aria-label={`Valor atual de ${r.name}`}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`${fmtReading(r.kind, value, kinds)}, limite ${fmtThreshold(r.kind, thr, kinds)}`}
      className="relative h-2 w-full rounded-full bg-bg-elev ring-1 ring-border"
    >
      {/* zona de disparo: acima do limite (gt) ou abaixo dele (lt) */}
      <div className={cn("absolute inset-y-0 rounded-full", zone)} style={r.operator === "gt" ? { left: pos(thr), right: 0 } : { left: 0, width: pos(thr) }} />
      <div className="absolute -inset-y-1 w-px bg-fg-muted" style={{ left: pos(thr) }} aria-hidden />
      <div className={cn("absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface", dot)} style={{ left: pos(value) }} aria-hidden />
    </div>
  );
}

export function RuleRow({
  r,
  kinds,
  now,
  demo,
  onToggle,
  onSilence,
  onEdit,
  onDelete,
}: {
  r: Rule;
  kinds?: Kinds;
  now: number;
  demo: boolean;
  onToggle: () => void;
  onSilence: (minutes: number) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = KIND_TEXT[r.kind];
  const silenced = !!r.silenced_until && r.silenced_until > now;
  const firing = r.enabled && r.last_event?.status === "active";
  const value = r.current?.value ?? null;
  const breach = value !== null && (r.operator === "gt" ? value > r.threshold : value < r.threshold);
  const sev = SEVERITY[r.severity];

  let status: React.ReactNode;
  if (!r.enabled) status = "Desligada: não é avaliada.";
  else if (silenced) status = `Silenciada até ${fmtDateTime(r.silenced_until!)}.`;
  else if (firing) status = <span className={sev.tone === "crit" ? "text-crit" : sev.tone === "warn" ? "text-warn" : "text-fg"}>Disparou {fmtAgo(r.last_event!.started_at)}{r.last_event!.occurrences > 1 ? ` · ${r.last_event!.occurrences} ocorrências` : ""}.</span>;
  else if (r.breaching_since && breach) {
    const left = r.min_duration_s - (now - r.breaching_since);
    status = <span className="text-warn">Além do limite {fmtAgo(r.breaching_since)}{left > 0 ? ` · dispara em ${Math.max(1, Math.ceil(left / 60))} min se continuar` : ""}.</span>;
  } else if (r.last_event) status = `Última vez: ${fmtDateTime(r.last_event.started_at)}.`;
  else status = "Nunca disparou.";

  return (
    <li className={cn("rounded-md border px-4 py-3.5 transition-colors", firing ? (sev.tone === "crit" ? "border-crit/40 bg-crit-soft" : sev.tone === "warn" ? "border-warn/40 bg-warn-soft" : "border-border-strong bg-surface-2") : "border-border bg-surface", !r.enabled && "opacity-70")}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 sm:flex-nowrap">
        <div className="pt-0.5">
          <Switch label={`Ativar ${r.name}`} checked={r.enabled} onCheckedChange={onToggle} disabled={demo} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-sm font-semibold text-fg">{r.name}</h3>
            <Badge tone={sev.tone}>{sev.word}</Badge>
            {silenced && (
              <Badge>
                <BellOff className="size-3" aria-hidden /> silenciada
              </Badge>
            )}
          </div>
          <p className="mt-1 text-[14px] leading-relaxed text-fg-muted">
            <RuleSentence r={r} kinds={kinds} />.
          </p>

          {r.enabled && !t?.binary && (
            <div className="mt-3 grid grid-cols-[minmax(0,1fr)_7.5rem] items-center gap-x-4 gap-y-1 sm:max-w-xl">
              {value !== null ? <Meter r={r} value={value} kinds={kinds} breach={breach} /> : <div className="h-2 w-full rounded-full border border-dashed border-border-strong" aria-hidden />}
              <p className="whitespace-nowrap text-xs">
                {value !== null ? (
                  <>
                    <span className="text-fg-subtle">agora </span>
                    <span className={cn("tabular font-medium", breach ? (sev.tone === "crit" ? "text-crit" : sev.tone === "warn" ? "text-warn" : "text-fg") : "text-fg")}>{fmtReading(r.kind, value, kinds)}</span>
                  </>
                ) : (
                  <span className="text-fg-subtle">sem leitura</span>
                )}
              </p>
            </div>
          )}
          <p className="mt-2 text-xs text-fg-subtle">{status}</p>
        </div>
        <div className="-mb-1 flex w-full shrink-0 items-center justify-end gap-1 border-t border-border/60 pt-1.5 sm:mb-0 sm:w-auto sm:border-0 sm:pt-0">
          <Button size="sm" variant="ghost" disabled={demo || !r.enabled} onClick={() => onSilence(silenced ? 0 : 60)} aria-label={silenced ? `Reativar avisos de ${r.name}` : `Silenciar ${r.name} por 1 hora`}>
            {silenced ? <BellRing /> : <BellOff />} <span className="sm:hidden lg:inline">{silenced ? "Reativar" : "Silenciar 1 h"}</span>
          </Button>
          <Button size="sm" variant="ghost" disabled={demo} onClick={onEdit} aria-label={`Editar ${r.name}`}>
            <Pencil /> <span className="sm:hidden lg:inline">Editar</span>
          </Button>
          <Button size="icon" variant="ghost" aria-label={`Excluir ${r.name}`} disabled={demo} onClick={onDelete}>
            <Trash2 />
          </Button>
        </div>
      </div>
    </li>
  );
}
