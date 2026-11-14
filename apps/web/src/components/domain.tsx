"use client";

import type { CapStatus, ConnState, Source } from "@orbitlink/shared";
import { AlertTriangle, CloudOff, Info, PlugZap, RefreshCw, ServerCrash } from "lucide-react";
import type { ReactNode } from "react";
import type { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fmtPct } from "@/lib/format";
import { Badge, Button, Callout, Card, Skeleton, Tip, type Tone } from "./ui/primitives";

/* ----------------------------------------------------------------- Origem do dado */
const SOURCE_META: Record<Source, { label: string; tone: Tone; help: string }> = {
  real: { label: "real", tone: "accent", help: "Valor reportado diretamente pela API local da antena." },
  calculada: { label: "calculada", tone: "info", help: "Calculado pelo ASTRYON a partir de amostras reais (método descrito na tela)." },
  estimada: { label: "estimada", tone: "neutral", help: "Estimativa estatística; possui incerteza." },
  importada: { label: "importada", tone: "neutral", help: "Importado de arquivo (ex.: CSV oficial)." },
  sensor_esp32: { label: "sensor ESP32", tone: "accent", help: "Medido por um sensor ligado ao ESP32 pareado." },
  indisponivel: { label: "indisponível", tone: "neutral", help: "Não há dados para este indicador." },
  demonstracao: { label: "demonstração", tone: "demo", help: "Dado fictício, exibido apenas no modo demonstração." },
};

export function SourceBadge({ source, className }: { source: Source | undefined | null; className?: string }) {
  const m = SOURCE_META[source ?? "indisponivel"] ?? SOURCE_META.indisponivel;
  return (
    <Tip content={m.help}>
      <span tabIndex={0} role="note" className={cn("inline-flex", className)} aria-label={`Origem do dado: ${m.label}. ${m.help}`}>
        <Badge tone={m.tone} className="px-1.5 py-0 text-[10px] uppercase tracking-wider">
          {m.label}
        </Badge>
      </span>
    </Tip>
  );
}

/* ----------------------------------------------------------------- Estado da conexão */
export const STATE_META: Record<ConnState | "inalcancavel", { label: string; tone: Tone; dot: string }> = {
  conectada: { label: "Conectada", tone: "ok", dot: "bg-ok" },
  inicializando: { label: "Inicializando", tone: "warn", dot: "bg-warn" },
  buscando: { label: "Buscando satélites", tone: "warn", dot: "bg-warn" },
  degradada: { label: "Degradada", tone: "warn", dot: "bg-warn" },
  offline: { label: "Offline", tone: "crit", dot: "bg-crit" },
  desconhecida: { label: "Desconhecido", tone: "neutral", dot: "bg-fg-subtle" },
  inalcancavel: { label: "Antena inacessível", tone: "crit", dot: "bg-crit" },
};

export function StatePill({ state, className }: { state: ConnState | "inalcancavel"; className?: string }) {
  const m = STATE_META[state];
  return (
    <Badge tone={m.tone} className={cn("gap-1.5 px-2 py-0.5", className)}>
      <span className={cn("size-1.5 rounded-full", m.dot, state === "conectada" && "ol-live text-ok")} aria-hidden />
      {m.label}
    </Badge>
  );
}

export const CAP_META: Record<CapStatus, { label: string; tone: Tone }> = {
  verificada: { label: "Verificada", tone: "ok" },
  schema_presente: { label: "No schema", tone: "info" },
  ausente_no_schema: { label: "Fora do schema", tone: "neutral" },
  campo_ausente: { label: "Campo ausente", tone: "neutral" },
  nao_implementada: { label: "Não implementada", tone: "neutral" },
  negada: { label: "Negada", tone: "warn" },
  timeout: { label: "Timeout", tone: "warn" },
  inalcancavel: { label: "Inalcançável", tone: "crit" },
  erro: { label: "Erro", tone: "crit" },
  nao_consultada: { label: "Não consultada", tone: "neutral" },
};

/* ----------------------------------------------------------------- Cabeçalho de página */
/**
 * Abertura da tela. No desktop o título (h1) fica no cabeçalho fixo da casca; aqui ele só aparece no celular,
 * onde o cabeçalho não tem espaço. A descrição e as ações aparecem sempre.
 */
export function PageHeader({
  title,
  description,
  actions,
  icon,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2.5 text-xl font-semibold tracking-tight text-fg lg:hidden">
          {icon && <span className="text-accent [&>svg]:size-5">{icon}</span>}
          {title}
        </h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-fg-muted lg:mt-0">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ----------------------------------------------------------------- Métrica */
export function MetricCard({
  label,
  value,
  unit,
  source,
  icon,
  hint,
  footer,
  tone,
  loading,
  className,
  children,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  source?: Source | null;
  icon?: ReactNode;
  hint?: ReactNode;
  footer?: ReactNode;
  tone?: "ok" | "warn" | "crit";
  loading?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const toneCls = tone === "crit" ? "text-crit" : tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "text-fg";
  return (
    <Card className={cn("flex min-w-0 flex-col p-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="ol-label flex min-w-0 items-center gap-1.5">
          {icon && <span className="text-accent [&>svg]:size-3.5 [&>svg]:stroke-[1.75]">{icon}</span>}
          {label}
          {hint && (
            <Tip content={hint}>
              <button type="button" aria-label={`Sobre ${label}`} className="text-fg-subtle hover:text-fg">
                <Info className="size-3" />
              </button>
            </Tip>
          )}
        </span>
        {source && <SourceBadge source={source} />}
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-8 w-24" />
      ) : (
        <div className={cn("mt-2 flex items-baseline gap-1.5 tabular", toneCls)}>
          <span className="text-[26px] font-medium leading-none tracking-[-0.03em]">{value}</span>
          {unit && <span className="text-xs font-medium text-fg-muted">{unit}</span>}
        </div>
      )}
      {children}
      {footer && <div className="mt-auto pt-2 text-xs text-fg-subtle">{footer}</div>}
    </Card>
  );
}

/* ----------------------------------------------------------------- Estados de consulta */
export function QueryError({ error, onRetry }: { error: ApiError | Error | null; onRetry?: () => void }) {
  const status = (error as ApiError | null)?.status;
  const code = (error as ApiError | null)?.code;
  let title = "Falha ao carregar";
  let icon = <AlertTriangle />;
  let body: ReactNode = error?.message;
  if (code === "agent_offline" || status === 502) {
    title = "Agente ASTRYON offline";
    icon = <ServerCrash />;
    body = "O painel não conseguiu falar com o agente local. Inicie com scripts\\start.ps1 e verifique a porta 8787.";
  } else if (status === 503) {
    title = "Configuração incompleta";
    icon = <PlugZap />;
  } else if (typeof navigator !== "undefined" && !navigator.onLine) {
    title = "Sem rede neste dispositivo";
    icon = <CloudOff />;
  }
  return (
    <Callout tone="crit" icon={icon} title={title}>
      <span>{body}</span>
      {onRetry && (
        <Button size="sm" variant="ghost" className="ml-2 h-6 px-2" onClick={onRetry}>
          <RefreshCw /> Tentar novamente
        </Button>
      )}
    </Callout>
  );
}

export function CoverageBar({ coverage, className }: { coverage: number | null | undefined; className?: string }) {
  const c = Math.max(0, Math.min(1, coverage ?? 0));
  const tone = c >= 0.9 ? "bg-ok" : c >= 0.5 ? "bg-warn" : "bg-crit";
  return (
    <Tip content="Cobertura: fração do período em que o ASTRYON efetivamente observou a antena. Períodos não observados não são preenchidos.">
      <div className={cn("flex items-center gap-2 text-[11px] text-fg-subtle", className)} tabIndex={0}>
        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-3" aria-hidden>
          <div className={cn("h-full rounded-full", tone)} style={{ width: `${c * 100}%` }} />
        </div>
        <span className="tabular">cobertura {fmtPct(c * 100, 0)}</span>
      </div>
    </Tip>
  );
}

export function DemoBanner() {
  return (
    <div
      role="note"
      className="ol-demo-hatch sticky top-0 z-30 flex h-7 items-center justify-center gap-2 overflow-hidden whitespace-nowrap border-b border-dashed border-demo/50 bg-bg-elev px-3 text-center font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-demo sm:text-[11px] sm:tracking-[0.2em]"
    >
      Demonstração — dados fictícios, não são da sua antena
    </div>
  );
}
