"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { useState } from "react";
import { Button, Callout, Input, Label, Select } from "@/components/ui/primitives";
import { api, type ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { DURATIONS, fmtSpan, KIND_TEXT, type Kinds, PRESETS, type Rule, SEVERITY, unitOf, WINDOWS } from "./phrases";
import { RuleSentence } from "./rule-row";

type Form = Pick<Rule, "name" | "kind" | "threshold" | "min_duration_s" | "window_s" | "severity" | "cooldown_s" | "hysteresis" | "enabled">;

const BLANK: Form = { name: "", kind: "latency_high", threshold: 100, min_duration_s: 300, window_s: 300, severity: "warn", cooldown_s: 900, hysteresis: 0.1, enabled: true };

/** Opções de um select com o valor atual garantido (mesmo que não esteja na lista padrão). */
const withValue = (list: number[], v: number) => (list.includes(v) ? list : [...list, v].sort((a, b) => a - b));

/**
 * Editor da regra no próprio lugar da lista. A regra é montada como frase ("Avise quando … passar de … por …");
 * janela, agrupamento e histerese ficam em "Avançado", com explicação em português.
 */
export function RuleEditor({ initial, kinds, onDone }: { initial: Rule | null; kinds: Kinds; onDone: () => void }) {
  const qc = useQueryClient();
  const isNew = !initial;
  // nome inicial sugerido pela condição, para a regra nova não abrir já com erro
  const suggestName = (kind: string) => PRESETS.find((p) => p.kind === kind)?.name ?? kinds[kind]?.label ?? "";
  const [f, setF] = useState<Form>(initial ? { ...BLANK, ...initial } : { ...BLANK, name: suggestName(BLANK.kind) });
  const [nameTouched, setNameTouched] = useState(!isNew);
  const [preset, setPreset] = useState<string | null>(null);
  const t = KIND_TEXT[f.kind];
  const unit = unitOf(f.kind, kinds);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  const save = useMutation<unknown, ApiError>({
    mutationFn: () => {
      // condição sem limite (acontecimento): o motor compara a contagem/estado com 0 (ou presença < 0,5)
      const body = t?.binary ? { ...f, threshold: kinds[f.kind]?.operator === "lt" ? 0.5 : 0 } : f;
      return api(initial ? `alerts/rules/${initial.id}` : "alerts/rules", { method: initial ? "PUT" : "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ predicate: (q) => String(q.queryKey[1]).startsWith("alerts") });
      onDone();
    },
  });

  function pickKind(kind: string) {
    setPreset(null);
    setF((x) => ({ ...x, kind, name: nameTouched ? x.name : suggestName(kind) }));
  }
  function applyPreset(p: (typeof PRESETS)[number]) {
    setPreset(p.label);
    setF((x) => ({ ...x, kind: p.kind, threshold: p.threshold, min_duration_s: p.min_duration_s, window_s: p.window_s, severity: p.severity, name: nameTouched ? x.name : p.name }));
  }

  const nameOk = f.name.trim().length >= 3;
  const thrOk = t?.binary || Number.isFinite(f.threshold);

  return (
    <div className="ol-card animate-rise border-accent-2/40 px-4 py-4" role="region" aria-label={isNew ? "Nova regra" : `Editar ${initial.name}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-[17px] font-semibold text-fg">{isNew ? "Nova regra" : "Editar regra"}</h3>
        <p className="text-xs text-fg-subtle">O agente confere as regras a cada 30 s.</p>
      </div>

      {isNew && (
        <div className="mt-3">
          <p className="mb-1.5 text-xs text-fg-muted">Comece por um modelo</p>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.filter((p) => kinds[p.kind]).map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => applyPreset(p)}
                aria-pressed={preset === p.label}
                className={cn("rounded-md border px-2.5 py-1.5 text-xs transition-colors", preset === p.label ? "border-accent-2/60 bg-accent-soft text-accent" : "border-border-strong bg-surface-2 text-fg-muted hover:border-accent-2/50 hover:text-fg")}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* A frase: cada parte variável é um campo no meio do texto. */}
      <fieldset className="mt-4 rounded-md border border-border bg-bg-elev/60 px-3 py-3">
        <legend className="sr-only">Condição da regra</legend>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm leading-9 text-fg">
          <span>Avise quando</span>
          <Select aria-label="Condição" value={f.kind} onChange={(e) => pickKind(e.target.value)} className="max-w-full">
            {Object.keys(kinds).map((k) => (
              <option key={k} value={k}>
                {KIND_TEXT[k]?.subject ?? kinds[k].label}
              </option>
            ))}
          </Select>
          {!t?.binary && (
            <>
              <span>{t?.verb ?? (kinds[f.kind]?.operator === "lt" ? "ficar abaixo de" : "passar de")}</span>
              <span className="inline-flex items-center gap-1.5">
                <Input aria-label="Limite" type="number" step="any" value={Number.isFinite(f.threshold) ? f.threshold : ""} onChange={(e) => set("threshold", e.target.value === "" ? Number.NaN : Number(e.target.value))} className="tabular w-24" aria-invalid={!thrOk} />
                {unit && <span className="tabular text-fg-muted">{unit}</span>}
              </span>
            </>
          )}
          {!t?.binary && !t?.noDuration && (
            <>
              <span>por</span>
              <Select aria-label="Duração mínima" value={f.min_duration_s} onChange={(e) => set("min_duration_s", Number(e.target.value))}>
                {withValue(DURATIONS, f.min_duration_s).map((s) => (
                  <option key={s} value={s}>
                    {s === 0 ? "qualquer tempo" : `pelo menos ${fmtSpan(s)}`}
                  </option>
                ))}
              </Select>
            </>
          )}
          {t?.windowLabel && (
            <>
              <span>{t.windowLabel}</span>
              <Select aria-label="Janela" value={f.window_s} onChange={(e) => set("window_s", Number(e.target.value))}>
                {withValue(WINDOWS, f.window_s).map((s) => (
                  <option key={s} value={s}>
                    {fmtSpan(s)}
                  </option>
                ))}
              </Select>
            </>
          )}
        </div>
      </fieldset>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-1">
          <Label htmlFor="r-name">Nome da regra</Label>
          <Input
            id="r-name"
            value={f.name}
            maxLength={80}
            onChange={(e) => {
              setNameTouched(true);
              set("name", e.target.value);
            }}
            aria-invalid={!nameOk && nameTouched}
          />
          <p className={cn("text-[11px]", nameOk || !nameTouched ? "text-fg-subtle" : "text-crit")}>{nameOk || !nameTouched ? "Aparece no aviso do Telegram e no histórico." : "Use pelo menos 3 letras."}</p>
        </div>
        <div className="space-y-1">
          <span id="r-sev" className="text-xs font-medium text-fg-muted">
            Gravidade
          </span>
          <div role="radiogroup" aria-labelledby="r-sev" className="flex h-9 rounded-md border border-border-strong bg-bg-elev p-0.5">
            {(Object.keys(SEVERITY) as Rule["severity"][]).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={f.severity === s}
                onClick={() => set("severity", s)}
                className={cn("rounded px-3 text-xs font-medium transition-colors", f.severity === s ? "bg-accent-soft text-accent shadow-[inset_0_0_0_1px_rgb(0_140_255/0.45)]" : "text-fg-muted hover:text-fg")}
              >
                {SEVERITY[s].word}
              </button>
            ))}
          </div>
        </div>
      </div>

      <details className="mt-4 rounded-md border border-border px-3 py-2 text-sm">
        <summary className="cursor-pointer select-none py-1 text-xs text-fg-muted hover:text-fg">Avançado: janela, agrupamento e histerese</summary>
        <div className="mt-3 grid grid-cols-1 gap-4 pb-2 sm:grid-cols-3">
          {!t?.windowLabel && (
            <div className="space-y-1">
              <Label htmlFor="r-win">Janela da média</Label>
              <Select id="r-win" className="w-full" value={f.window_s} onChange={(e) => set("window_s", Number(e.target.value))}>
                {withValue(WINDOWS, f.window_s).map((s) => (
                  <option key={s} value={s}>
                    {fmtSpan(s)}
                  </option>
                ))}
              </Select>
              <p className="text-[11px] text-fg-subtle">Período usado para calcular o valor (ex.: média dos últimos 5 min).</p>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="r-cd">Agrupar repetições por</Label>
            <Select id="r-cd" className="w-full" value={f.cooldown_s} onChange={(e) => set("cooldown_s", Number(e.target.value))}>
              {withValue([0, 300, 900, 1800, 3600, 3 * 3600], f.cooldown_s).map((s) => (
                <option key={s} value={s}>
                  {s === 0 ? "não agrupar" : fmtSpan(s)}
                </option>
              ))}
            </Select>
            <p className="text-[11px] text-fg-subtle">Se voltar a disparar nesse tempo, vira a mesma ocorrência (evita spam).</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="r-hy">Margem para normalizar</Label>
            <Select id="r-hy" className="w-full" value={f.hysteresis} onChange={(e) => set("hysteresis", Number(e.target.value))}>
              {[0, 0.05, 0.1, 0.2, 0.3].concat([0, 0.05, 0.1, 0.2, 0.3].includes(f.hysteresis) ? [] : [f.hysteresis]).map((h) => (
                <option key={h} value={h}>
                  {h === 0 ? "nenhuma" : `${Math.round(h * 100)}% do limite`}
                </option>
              ))}
            </Select>
            <p className="text-[11px] text-fg-subtle">Só considera resolvido quando o valor volta esse tanto para dentro do limite.</p>
          </div>
        </div>
      </details>

      <p className="mt-4 text-sm text-fg-muted">
        <span className="text-fg-subtle">Resumo: </span>
        <RuleSentence r={f} kinds={kinds} />, com gravidade <span className="text-fg">{SEVERITY[f.severity].word}</span>.
      </p>
      {save.error && (
        <Callout tone="crit" className="mt-3">
          {save.error.message}
        </Callout>
      )}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone} disabled={save.isPending}>
          Cancelar
        </Button>
        <Button size="sm" variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={!nameOk || !thrOk}>
          <Save /> {isNew ? "Criar regra" : "Salvar regra"}
        </Button>
      </div>
    </div>
  );
}
