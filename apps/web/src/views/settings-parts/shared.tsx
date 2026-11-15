"use client";

import { ArrowRight, BellRing, Cable, Cloud, CloudSun, Database, Gauge, HardDrive, Info, KeyRound, type LucideIcon, SlidersHorizontal, Sparkles, UserRound } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { hrefOf } from "@/components/shell/nav";
import { Badge, Card } from "@/components/ui/primitives";
import { useBasePath } from "@/lib/demo-context";
import { fmtNumber } from "@/lib/format";

export type SettingsData = Record<string, unknown> & {
  secrets_configured: Record<string, boolean>;
  runtime_overrides: Record<string, string | null>;
  terminal_name: string;
  show_mac_addresses: boolean;
  usage_monthly_limit_gb?: number | null;
  usage_cycle_start_day?: number;
  version?: string;
};

export interface AiStatus {
  configured: boolean;
  model: string;
  daily_limit: number;
  retention_days?: number;
  usage: { day: string; requests: number }[];
  audio?: { enabled: boolean; model: string; daily_limit: number; telegram: boolean };
}

export interface SyncState {
  configured: boolean;
  pending: number;
  failed_attempts: number;
  pairing?: { cloud_configured: boolean; paired: boolean; via_env: boolean; workspace_name: string | null; agent_name: string | null; paired_at: number | null };
}

/* ----------------------------------------------------------------- Seções */
const SECTIONS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "geral", label: "Geral", icon: SlidersHorizontal },
  { id: "plano", label: "Plano de internet", icon: Gauge },
  { id: "clima", label: "Clima", icon: CloudSun },
  { id: "notificacoes", label: "Notificações", icon: BellRing },
  { id: "ia", label: "Central de IA", icon: Sparkles },
  { id: "coleta", label: "Coleta e dados", icon: Database },
  { id: "servidor", label: "Servidor e backup", icon: HardDrive },
  { id: "nuvem", label: "Conta na nuvem", icon: Cloud },
  { id: "integracoes", label: "Conexões", icon: Cable },
  { id: "credenciais", label: "Credenciais", icon: KeyRound },
  { id: "conta", label: "Conta", icon: UserRound },
  { id: "sobre", label: "Sobre", icon: Info },
];

export const WEEKDAYS = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"];

export const SECRET_LABELS: Record<string, string> = {
  api_token: "Token entre painel e agente",
  groq_api_key: "Chave da Groq (Central de IA)",
  setup_code: "Código do primeiro acesso",
  supabase_agent_token: "Supabase · token do agente",
  supabase_anon_key: "Supabase · chave pública",
  telegram_bot_token: "Bot do Telegram",
  telegram_chat_id: "Chat do Telegram",
};

export const envName = (key: string) => `ASTRYON_${key.toUpperCase()}`;

/** Valor de configuração legível: booleanos viram Sim/Não, segundos ganham unidade, ausente vira travessão. */
export function fmtValue(v: unknown, unit?: "s" | "d"): ReactNode {
  if (v === null || v === undefined || v === "") return <span className="text-fg-subtle">—</span>;
  if (typeof v === "boolean") return <Badge tone={v ? "accent" : "neutral"}>{v ? "sim" : "não"}</Badge>;
  if (typeof v === "number" && unit === "s") return v >= 60 ? `${fmtNumber(v / 60, v % 60 ? 1 : 0)} min` : `${fmtNumber(v, v % 1 ? 1 : 0)} s`;
  if (typeof v === "number" && unit === "d") return `${fmtNumber(v, 0)} dias`;
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

export function Section({ id, title, description, icon: Icon, actions, children }: { id: string; title: string; description?: ReactNode; icon: LucideIcon; actions?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-t`} className="scroll-mt-36 lg:scroll-mt-24">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 id={`${id}-t`} className="flex items-center gap-2 text-[15px] font-semibold text-fg">
              <Icon className="size-4 shrink-0 stroke-[1.75] text-accent" aria-hidden />
              {title}
            </h2>
            {description && <p className="mt-1 max-w-2xl text-xs leading-relaxed text-fg-muted">{description}</p>}
          </div>
          {actions}
        </div>
        <div className="px-5 py-4">{children}</div>
      </Card>
    </section>
  );
}

/** Linha somente leitura: rótulo, variável de ambiente que a define e o valor efetivo. */
export function Row({ label, env, value }: { label: string; env?: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/60 py-2.5 last:border-b-0">
      <dt className="min-w-0 text-sm text-fg-muted">
        {label}
        {env && <span className="mt-0.5 block break-all font-mono text-[11px] text-fg-subtle">{env}</span>}
      </dt>
      <dd className="tabular max-w-[55%] break-words text-right text-[13px] text-fg">{value}</dd>
    </div>
  );
}

export function ManageLink({ slug, children }: { slug: string; children: ReactNode }) {
  const base = useBasePath();
  return (
    <Link href={hrefOf(base, slug)} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-accent-2/40 bg-accent-soft px-2.5 py-1.5 text-xs font-medium text-accent transition-colors hover:border-accent">
      {children} <ArrowRight className="size-3.5" aria-hidden />
    </Link>
  );
}

/* ----------------------------------------------------------------- Navegação entre seções */
export function SectionNav() {
  return (
    <nav aria-label="Seções das configurações" className="-mx-4 overflow-x-auto px-4 lg:sticky lg:top-24 lg:mx-0 lg:self-start lg:overflow-visible lg:px-0">
      <ul className="flex w-max gap-1 lg:w-auto lg:flex-col">
        {SECTIONS.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              className="flex items-center gap-2.5 whitespace-nowrap rounded-md border border-border bg-surface px-3 py-2 text-[13px] text-fg-muted transition-colors hover:border-accent-2/50 hover:text-fg lg:border-transparent lg:bg-transparent lg:hover:bg-surface"
            >
              <s.icon className="size-4 shrink-0 stroke-[1.75] text-fg-subtle" aria-hidden />
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
