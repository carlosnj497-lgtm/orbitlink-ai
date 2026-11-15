"use client";

import type { AgentInfo, DigestStatus, NotificationStatus, ServerHealth, UsagePlan } from "@orbitlink/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  BellRing,
  Cable,
  CloudSun,
  Database,
  Gauge,
  HardDrive,
  Info,
  KeyRound,
  type LucideIcon,
  Save,
  Settings,
  SlidersHorizontal,
  Sparkles,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { type FormEvent, type ReactNode, useState } from "react";
import { PageHeader, QueryError } from "@/components/domain";
import { WeatherLocationForm } from "@/components/weather";
import { hrefOf } from "@/components/shell/nav";
import { Badge, Button, Callout, Card, Input, Label, Skeleton, Switch } from "@/components/ui/primitives";
import { api, ApiError, errorText, useAgent } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useBasePath, useDemo } from "@/lib/demo-context";
import { fmtAgo, fmtBytesStr, fmtDateTime, fmtDay, fmtNumber, fmtPct } from "@/lib/format";

type SettingsData = Record<string, unknown> & {
  secrets_configured: Record<string, boolean>;
  runtime_overrides: Record<string, string | null>;
  terminal_name: string;
  show_mac_addresses: boolean;
  usage_monthly_limit_gb?: number | null;
  usage_cycle_start_day?: number;
  version?: string;
};

interface AiStatus {
  configured: boolean;
  model: string;
  daily_limit: number;
  retention_days?: number;
  usage: { day: string; requests: number }[];
  audio?: { enabled: boolean; model: string; daily_limit: number; telegram: boolean };
}

interface SyncState {
  configured: boolean;
  pending: number;
  failed_attempts: number;
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
  { id: "integracoes", label: "Conexões", icon: Cable },
  { id: "credenciais", label: "Credenciais", icon: KeyRound },
  { id: "conta", label: "Conta", icon: UserRound },
  { id: "sobre", label: "Sobre", icon: Info },
];

const WEEKDAYS = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"];

const SECRET_LABELS: Record<string, string> = {
  api_token: "Token entre painel e agente",
  groq_api_key: "Chave da Groq (Central de IA)",
  setup_code: "Código do primeiro acesso",
  supabase_agent_token: "Supabase · token do agente",
  supabase_anon_key: "Supabase · chave pública",
  telegram_bot_token: "Bot do Telegram",
  telegram_chat_id: "Chat do Telegram",
};

const envName = (key: string) => `ORBITLINK_${key.toUpperCase()}`;

/** Valor de configuração legível: booleanos viram Sim/Não, segundos ganham unidade, ausente vira travessão. */
function fmtValue(v: unknown, unit?: "s" | "d"): ReactNode {
  if (v === null || v === undefined || v === "") return <span className="text-fg-subtle">—</span>;
  if (typeof v === "boolean") return <Badge tone={v ? "accent" : "neutral"}>{v ? "sim" : "não"}</Badge>;
  if (typeof v === "number" && unit === "s") return v >= 60 ? `${fmtNumber(v / 60, v % 60 ? 1 : 0)} min` : `${fmtNumber(v, v % 1 ? 1 : 0)} s`;
  if (typeof v === "number" && unit === "d") return `${fmtNumber(v, 0)} dias`;
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

function Section({ id, title, description, icon: Icon, actions, children }: { id: string; title: string; description?: ReactNode; icon: LucideIcon; actions?: ReactNode; children: ReactNode }) {
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
function Row({ label, env, value }: { label: string; env?: string; value: ReactNode }) {
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

function ManageLink({ slug, children }: { slug: string; children: ReactNode }) {
  const base = useBasePath();
  return (
    <Link href={hrefOf(base, slug)} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-accent-2/40 bg-accent-soft px-2.5 py-1.5 text-xs font-medium text-accent transition-colors hover:border-accent">
      {children} <ArrowRight className="size-3.5" aria-hidden />
    </Link>
  );
}

/* ----------------------------------------------------------------- Navegação entre seções */
function SectionNav() {
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

/* ----------------------------------------------------------------- Conta */
function AccountSection() {
  const demo = useDemo();
  const me = useQuery<{ username: string; role: string } | null>({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      const r = await fetch("/api/auth/me");
      return r.ok ? r.json() : null;
    },
    enabled: !demo,
    staleTime: 300_000,
  });
  const [old, setOld] = useState("");
  const [nw, setNw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const mismatch = confirm.length > 0 && confirm !== nw;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (mismatch) return;
    setBusy(true);
    try {
      const r = await fetch("/api/auth/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ old_password: old, new_password: nw }) });
      if (r.ok || r.status === 204) {
        setMsg({ ok: true, text: "Senha alterada. Todas as sessões foram encerradas; entre novamente." });
        setTimeout(() => (window.location.href = "/login"), 1500);
      } else {
        const body = await r.json().catch(() => ({}));
        setMsg({ ok: false, text: body && "detail" in body ? errorText(body, r.status) : "Falha ao alterar a senha." });
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section id="conta" title="Conta e segurança" icon={UserRound} description="Usuário local deste painel. Trocar a senha encerra todas as sessões abertas.">
      <dl className="mb-4">
        <Row label="Usuário" value={demo ? "Visitante (demonstração)" : (me.data?.username ?? "—")} />
        <Row label="Papel" value={demo ? "—" : me.data?.role === "admin" ? "Administrador local" : (me.data?.role ?? "—")} />
      </dl>
      <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="old">Senha atual</Label>
          <Input id="old" type="password" autoComplete="current-password" value={old} onChange={(e) => setOld(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="new">Nova senha (mín. 10)</Label>
          <Input id="new" type="password" autoComplete="new-password" minLength={10} value={nw} onChange={(e) => setNw(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="new2">Repita a nova senha</Label>
          <Input id="new2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={mismatch} aria-describedby={mismatch ? "new2-err" : undefined} />
          {mismatch && (
            <p id="new2-err" className="text-xs text-crit">
              As senhas não conferem.
            </p>
          )}
        </div>
        <div className="sm:col-span-3">
          <Button size="sm" type="submit" loading={busy} disabled={demo || !old || nw.length < 10 || confirm !== nw}>
            <KeyRound /> Alterar senha
          </Button>
        </div>
        {msg && (
          <Callout tone={msg.ok ? "ok" : "crit"} className="sm:col-span-3">
            {msg.text}
          </Callout>
        )}
      </form>
    </Section>
  );
}

/* ----------------------------------------------------------------- Tela */
export default function SettingsView() {
  const q = useAgent<SettingsData>("settings");
  return (
    <>
      <PageHeader title="Configurações" icon={<Settings />} description="Ajustes que valem na hora e a configuração efetiva do agente. Segredos nunca são exibidos nem enviados ao navegador." />
      {q.error && <QueryError error={q.error} />}
      {q.isLoading && <Skeleton className="h-64 w-full" />}
      {q.data && <SettingsBody d={q.data} />}
    </>
  );
}

function SettingsBody({ d }: { d: SettingsData }) {
  const demo = useDemo();
  const qc = useQueryClient();
  const plan = useAgent<UsagePlan>("usage/plan");
  const notif = useAgent<NotificationStatus>("alerts/notifications", { refetchInterval: 60_000 });
  const digest = useAgent<DigestStatus>("alerts/digest", { refetchInterval: 60_000 });
  const ai = useAgent<AiStatus>("ai/status");
  const agent = useAgent<AgentInfo>("agent", { refetchInterval: 30_000 });
  const sync = useAgent<SyncState>(demo ? null : "sync", { refetchInterval: 60_000 });

  const initial = {
    name: d.terminal_name,
    limit: d.usage_monthly_limit_gb ? String(d.usage_monthly_limit_gb) : "",
    cycleDay: String(d.usage_cycle_start_day ?? 1),
    showMac: d.show_mac_addresses,
  };
  const [name, setName] = useState(initial.name);
  const [limit, setLimit] = useState(initial.limit);
  const [cycleDay, setCycleDay] = useState(initial.cycleDay);
  const [showMac, setShowMac] = useState(initial.showMac);
  const dayOk = /^\d+$/.test(cycleDay) && Number(cycleDay) >= 1 && Number(cycleDay) <= 28;
  const limitOk = limit === "" || (Number(limit) >= 0 && Number(limit) <= 100000);
  const dirty = name !== initial.name || limit !== initial.limit || cycleDay !== initial.cycleDay || showMac !== initial.showMac;

  const save = useMutation({
    // franquia vazia envia 0, que remove a franquia (e desliga os alertas de 80%/100%)
    mutationFn: () =>
      api("settings", {
        method: "PUT",
        body: JSON.stringify({ terminal_name: name, show_mac_addresses: showMac, usage_monthly_limit_gb: limit ? Number(limit) : 0, usage_cycle_start_day: Number(cycleDay) }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent"] }),
  });
  function discard() {
    setName(initial.name);
    setLimit(initial.limit);
    setCycleDay(initial.cycleDay);
    setShowMac(initial.showMac);
    save.reset();
  }

  const today = ai.data?.usage?.[0];
  const p = plan.data;
  const n = notif.data;
  const dg = digest.data;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <SectionNav />

      <div className="min-w-0 space-y-4">
        {/* ---------------------------------------------------------- Geral */}
        <Section id="geral" title="Preferências" icon={SlidersHorizontal} description="Como o painel identifica a sua antena e o que ele mostra. Vale na hora, sem reiniciar.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="tn">Nome da antena</Label>
              <Input id="tn" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-invalid={!name.trim()} />
              <p className="text-[11px] text-fg-subtle">Aparece na barra lateral, nos relatórios e no Telegram.</p>
            </div>
            <div className="space-y-1">
              <span className="text-xs font-medium text-fg-muted">Fuso de exibição</span>
              <p className="flex h-9 items-center rounded-md border border-border bg-bg-elev px-3 font-mono text-sm text-fg-muted">{fmtValue(d.timezone)}</p>
              <p className="text-[11px] text-fg-subtle">
                Definido por <span className="font-mono">ORBITLINK_TIMEZONE</span> no agente.
              </p>
            </div>
          </div>
          <label className="mt-4 flex items-start gap-3 rounded-md border border-border bg-bg-elev/60 px-3 py-3 text-sm">
            <Switch label="Exibir endereços MAC completos" checked={showMac} onCheckedChange={setShowMac} disabled={demo} />
            <span>
              Exibir endereços MAC completos na tela de dispositivos
              <span className="mt-0.5 block text-xs text-fg-subtle">Desligado, o painel mostra só o final do endereço (mais privacidade em capturas de tela).</span>
            </span>
          </label>
        </Section>

        {/* ---------------------------------------------------------- Plano */}
        <Section
          id="plano"
          title="Plano de internet"
          icon={Gauge}
          description="A franquia é comparada ao consumo estimado localmente, que não substitui o valor oficial da fatura. Com ela definida, os alertas avisam em 80% e 100% do ciclo."
          actions={<ManageLink slug="consumo">Ver consumo</ManageLink>}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="lim">Franquia mensal do plano (GB)</Label>
              <Input id="lim" type="number" min={0} step="any" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="sem franquia" aria-invalid={!limitOk} />
              <p className="text-[11px] text-fg-subtle">Deixe vazio para planos sem limite.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="cday">Dia de virada do ciclo (1–28)</Label>
              <Input id="cday" type="number" min={1} max={28} value={cycleDay} onChange={(e) => setCycleDay(e.target.value)} aria-invalid={!dayOk} aria-describedby="cday-help" />
              <p id="cday-help" className={cn("text-[11px]", dayOk ? "text-fg-subtle" : "text-crit")}>
                {dayOk ? "Dia do mês em que a operadora zera o consumo." : "Use um número de 1 a 28."}
              </p>
            </div>
          </div>
          <div className="mt-4 rounded-md border border-border bg-bg-elev/60 px-3 py-3">
            <p className="ol-label">Ciclo atual (conforme salvo)</p>
            {!p ? (
              <Skeleton className="mt-2 h-5 w-64" />
            ) : !p.configured ? (
              <p className="mt-1.5 text-sm text-fg-muted">Sem franquia configurada: o consumo é acompanhado, mas sem limite nem alertas de 80%/100%.</p>
            ) : (
              <p className="tabular mt-1.5 text-sm text-fg">
                {fmtDay(p.cycle_start)} – {fmtDay(p.cycle_end - 1)} · {fmtBytesStr(p.used.bytes_total)} de {fmtBytesStr(p.cap_bytes)}
                {p.pct_used !== null && <span className="text-fg-muted"> ({p.lower_bound ? "≥ " : ""}{fmtPct(p.pct_used, 0)})</span>}
                <span className="text-fg-muted"> · faltam {fmtNumber(p.days_remaining, 0)} dias</span>
              </p>
            )}
          </div>
        </Section>

        {/* ---------------------------------------------------------- Barra de salvar (Geral + Plano) */}
        <div className="sticky bottom-20 z-10 lg:bottom-4">
          <div className={cn("flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-md border px-3 py-2 sm:px-4 sm:py-3 shadow-[0_14px_30px_-12px_rgb(0_0_0/0.95)] backdrop-blur-md transition-colors", dirty ? "border-accent-2/60 bg-bg-elev/95" : "border-border bg-bg-elev/90")}>
            <p className="flex items-center gap-2 text-sm">
              <span className={cn("size-1.5 rounded-full", dirty ? "animate-pulse-dot bg-accent" : "bg-fg-subtle")} aria-hidden />
              {dirty ? (
                <span className="text-fg">
                  Alterações não salvas<span className="hidden sm:inline"> em Preferências e Plano</span>
                </span>
              ) : (
                <span className="text-fg-muted">
                  Sem alterações<span className="hidden sm:inline"> pendentes em Preferências e Plano</span>
                </span>
              )}
            </p>
            <div className="flex items-center gap-2">
              {dirty && (
                <Button size="sm" variant="ghost" onClick={discard} disabled={save.isPending}>
                  Descartar
                </Button>
              )}
              <Button size="sm" variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={demo || !name.trim() || !dayOk || !limitOk}>
                <Save /> Salvar
              </Button>
            </div>
            {save.error && (
              <Callout tone="crit" className="w-full">
                {(save.error as ApiError).message}
              </Callout>
            )}
            {save.isSuccess && !dirty && (
              <Callout tone="ok" className="w-full">
                Preferências salvas.
              </Callout>
            )}
          </div>
        </div>

        {/* ---------------------------------------------------------- Clima */}
        <Section
          id="clima"
          title="Clima"
          icon={CloudSun}
          description="Escolha a cidade da antena para ver o clima no Dashboard e marcar nos gráficos e eventos quando a conexão oscilou com chuva. Vale na hora."
        >
          <WeatherLocationForm />
        </Section>

        {/* ---------------------------------------------------------- Notificações */}
        <Section id="notificacoes" title="Notificações e resumo semanal" icon={BellRing} description="Para onde os alertas vão e quando sai o resumo da semana. Regras, testes e horários são ajustados em Alertas." actions={<ManageLink slug="alertas">Gerenciar em Alertas</ManageLink>}>
          {notif.error && <QueryError error={notif.error} />}
          {!n && !notif.error ? (
            <Skeleton className="h-24 w-full" />
          ) : n ? (
            <dl>
              <Row label="Telegram" env="ORBITLINK_TELEGRAM_BOT_TOKEN + _CHAT_ID" value={<Badge tone={n.channels.telegram ? "accent" : "neutral"}>{n.channels.telegram ? "ativo" : "não configurado"}</Badge>} />
              <Row label="Webhook" env="ORBITLINK_ALERT_WEBHOOK_URL" value={<Badge tone={n.channels.webhook ? "accent" : "neutral"}>{n.channels.webhook ? "ativo" : "não configurado"}</Badge>} />
              <Row label="Último envio" value={n.last_sent_at ? `${fmtDateTime(n.last_sent_at)} (${fmtAgo(n.last_sent_at)})` : "nunca"} />
              <Row label="Na fila / falhas em 24 h" value={`${fmtNumber(n.pending, 0)} / ${fmtNumber(n.failed_24h, 0)}`} />
              {n.last_error && <Row label="Último erro" value={<span className="text-crit">{`${n.last_error.channel}: ${n.last_error.last_error}`}</span>} />}
              <Row
                label="Resumo semanal"
                value={
                  !dg ? (
                    "—"
                  ) : !dg.telegram ? (
                    "precisa do Telegram"
                  ) : !dg.enabled ? (
                    "desligado"
                  ) : (
                    <>
                      toda {WEEKDAYS[dg.weekday]} às {String(dg.hour).padStart(2, "0")}h{dg.next_at ? ` · próximo ${fmtDateTime(dg.next_at)}` : ""}
                    </>
                  )
                }
              />
            </dl>
          ) : null}
        </Section>

        {/* ---------------------------------------------------------- IA */}
        <Section id="ia" title="Central de IA" icon={Sparkles} description="Assistente com ferramentas somente leitura. Sem chave da Groq, responde com o diagnóstico por regras." actions={<ManageLink slug="assistente">Abrir Central de IA</ManageLink>}>
          {ai.error && <QueryError error={ai.error} />}
          {!ai.data && !ai.error ? (
            <Skeleton className="h-24 w-full" />
          ) : ai.data ? (
            <dl>
              <Row label="Motor" env="ORBITLINK_GROQ_API_KEY" value={<Badge tone={ai.data.configured ? "accent" : "neutral"}>{ai.data.configured ? "Groq" : "somente regras"}</Badge>} />
              <Row label="Modelo" env="ORBITLINK_AI_MODEL" value={fmtValue(ai.data.configured ? ai.data.model : d.ai_model)} />
              <Row label="Perguntas hoje / limite diário" env="ORBITLINK_AI_DAILY_REQUEST_LIMIT" value={`${fmtNumber(today?.requests ?? 0, 0)} / ${fmtNumber(ai.data.daily_limit, 0)}`} />
              <Row label="Guardar conversas por" env="ORBITLINK_AI_CONVERSATION_RETENTION_DAYS" value={fmtValue(ai.data.retention_days ?? d.ai_conversation_retention_days, "d")} />
              <Row label="Áudio no Telegram (Whisper)" env="ORBITLINK_AI_TRANSCRIBE_ENABLED" value={ai.data.audio ? <Badge tone={ai.data.audio.enabled ? "accent" : "neutral"}>{ai.data.audio.enabled ? `ativo · ${ai.data.audio.model}` : "desligado"}</Badge> : "—"} />
            </dl>
          ) : null}
        </Section>

        {/* ---------------------------------------------------------- Coleta */}
        <Section id="coleta" title="Coleta e armazenamento" icon={Database} description="Com que frequência o agente lê a antena e por quanto tempo guarda os dados. Para mudar, edite o arquivo de ambiente do agente e reinicie.">
          <dl className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
            <Row label="Leitura de status" env={envName("status_interval_s")} value={fmtValue(d.status_interval_s, "s")} />
            <Row label="Leitura de histórico" env={envName("history_interval_s")} value={fmtValue(d.history_interval_s, "s")} />
            <Row label="Mapa de obstrução" env={envName("obstruction_interval_s")} value={fmtValue(d.obstruction_interval_s, "s")} />
            <Row label="Verificação de capacidades" env={envName("capability_refresh_s")} value={fmtValue(d.capability_refresh_s, "s")} />
            <Row label="Tempo limite gRPC" env={envName("grpc_timeout_s")} value={fmtValue(d.grpc_timeout_s, "s")} />
            <Row label="Perda que marca 'degradada'" env={envName("degraded_drop_rate")} value={typeof d.degraded_drop_rate === "number" ? fmtPct(d.degraded_drop_rate * 100, 0) : fmtValue(d.degraded_drop_rate)} />
            <Row label="Amostras de 1 s" env={envName("retention_raw_days")} value={fmtValue(d.retention_raw_days, "d")} />
            <Row label="Agregados por minuto" env={envName("retention_minute_days")} value={fmtValue(d.retention_minute_days, "d")} />
          </dl>
          {agent.data && (
            <p className="tabular mt-3 text-[11px] text-fg-subtle">
              Coletadas até agora: {fmtNumber(agent.data.history_inserted_total, 0)} amostras · perdidas: {fmtNumber(agent.data.history_lost_total, 0)}
            </p>
          )}
        </Section>

        <ServerSection d={d} />

        {/* ---------------------------------------------------------- Integrações */}
        <Section id="integracoes" title="Conexões e integrações" icon={Cable} description="Onde o agente encontra a antena e o roteador, quem pode acessar a API e as integrações opcionais.">
          <dl className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
            <Row label="Antena (gRPC)" env={envName("dish_target")} value={fmtValue(d.dish_target)} />
            <Row label="Antena alcançável" value={agent.data ? fmtValue(agent.data.dish_reachable ?? undefined) : "—"} />
            <Row label="Roteador (gRPC)" env={envName("router_target")} value={fmtValue(d.router_target)} />
            <Row label="Integração com roteador" env={envName("router_enabled")} value={fmtValue(d.router_enabled)} />
            <Row label="Endereço da API do agente" env={`${envName("host")} · _PORT`} value={d.host !== undefined ? `${String(d.host)}:${String(d.port ?? "")}` : "—"} />
            <Row label="Acesso pela LAN" env={envName("allow_lan")} value={fmtValue(d.allow_lan)} />
            <Row label="Listener ESP32" env={envName("esp32_enabled")} value={fmtValue(d.esp32_enabled)} />
            <Row label="Supabase" env={envName("supabase_url")} value={fmtValue(d.supabase_url)} />
            <Row
              label="Sincronização"
              env={envName("sync_interval_s")}
              value={demo ? "—" : !sync.data ? "—" : !sync.data.configured ? "não configurada" : `a cada ${fmtValue(d.sync_interval_s, "s")} · ${fmtNumber(sync.data.pending, 0)} na fila`}
            />
          </dl>
        </Section>

        {/* ---------------------------------------------------------- Credenciais */}
        <Section id="credenciais" title="Credenciais" icon={KeyRound} description="Só mostramos se cada segredo está definido. O valor nunca sai do agente.">
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {Object.entries(d.secrets_configured).map(([k, v]) => (
              <li key={k} className="flex items-center justify-between gap-3 rounded-md border border-border bg-bg-elev/60 px-3 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-sm text-fg">{SECRET_LABELS[k] ?? k}</span>
                  <span className="block truncate font-mono text-[11px] text-fg-subtle">{envName(k)}</span>
                </span>
                <Badge tone={v ? "accent" : "neutral"}>{v ? "definida" : "ausente"}</Badge>
              </li>
            ))}
          </ul>
          <div className="mt-4 grid grid-cols-1 gap-2 text-xs text-fg-muted sm:grid-cols-2">
            <p className="rounded-md border border-border px-3 py-2.5">
              <span className="font-medium text-fg">Ubuntu:</span> edite <span className="font-mono">/etc/orbitlink/orbitlink.env</span> e rode <span className="font-mono">sudo orbitlinkctl restart</span>.
            </p>
            <p className="rounded-md border border-border px-3 py-2.5">
              <span className="font-medium text-fg">Windows:</span> edite o <span className="font-mono">.env</span> na raiz e rode <span className="font-mono">scripts\stop.ps1</span> e <span className="font-mono">start.ps1</span>.
            </p>
          </div>
        </Section>

        <AccountSection />

        {/* ---------------------------------------------------------- Sobre */}
        <Section id="sobre" title="Sobre este painel" icon={Info} description="Projeto independente, sem afiliação com a Starlink/SpaceX. Usa só a API local da antena.">
          <dl className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
            <Row label="Versão do agente" value={fmtValue(d.version ?? agent.data?.version)} />
            <Row label="Modo do agente" value={agent.data ? (agent.data.mode === "real" ? "antena real" : agent.data.mode === "fixture" ? "arquivo de teste (fixture)" : "sem coletor") : "—"} />
            <Row label="Agente no ar desde" value={agent.data ? `${fmtDateTime(agent.data.started_at)} (${fmtAgo(agent.data.started_at)})` : "—"} />
            <Row label="Firmware da antena" value={fmtValue(agent.data?.firmware)} />
            <Row label="Hardware" value={fmtValue(agent.data?.hardware)} />
            <Row label="Capacidades verificadas" value={agent.data?.capabilities_checked ? fmtAgo(agent.data.capabilities_checked) : "—"} />
          </dl>
        </Section>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Servidor e backup */
function ServerSection({ d }: { d: SettingsData }) {
  const demo = useDemo();
  const qc = useQueryClient();
  const h = useAgent<ServerHealth>("ops/health", { refetchInterval: 60_000 });
  const run = useMutation({
    mutationFn: () => api<{ created: string | null; sent_telegram: boolean; backups: string[] }>("ops/backup", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[1] === "ops/health" }),
  });
  const s = h.data;
  return (
    <Section
      id="servidor"
      title="Servidor e backup"
      icon={HardDrive}
      description="A saúde do computador que roda o ASTRYON e as cópias de segurança do banco. Alertas avisam com pouco disco ou temperatura alta."
      actions={
        <Button size="sm" onClick={() => run.mutate()} loading={run.isPending} disabled={demo}>
          <Database /> Fazer backup agora
        </Button>
      }
    >
      {h.error && <QueryError error={h.error} />}
      {!s && !h.error ? (
        <Skeleton className="h-28 w-full" />
      ) : s ? (
        <dl className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
          <Row label="Temperatura do processador" value={s.cpu_temp_c === null ? "não informada" : `${fmtNumber(s.cpu_temp_c, 0)} °C`} />
          <Row label="Disco livre (pasta de dados)" value={s.disk.free_pct === null ? "—" : `${fmtNumber(s.disk.free_pct, 0)}% · ${fmtBytesStr(s.disk.free_bytes ?? 0)}`} />
          <Row label="Tamanho do banco" value={fmtBytesStr(s.db_size_bytes)} />
          <Row label="Memória disponível" value={s.mem_available_pct === null ? "não informada" : `${fmtNumber(s.mem_available_pct, 0)}%`} />
          <Row label="Último backup" env="pasta data/backups" value={s.last_backup_at ? `${fmtDateTime(s.last_backup_at)} (${fmtAgo(s.last_backup_at)})` : "ainda não feito"} />
          <Row label="Cópias guardadas / envio ao Telegram" env={`${envName("backup_keep")} · _TELEGRAM_EVERY_DAYS`} value={`${fmtValue(d.backup_keep)} · ${d.backup_telegram ? `a cada ${fmtValue(d.backup_telegram_every_days, "d")}` : "desligado"}`} />
          <Row label="Vigia externo (healthchecks.io)" env={envName("healthcheck_url")} value={<Badge tone={s.healthcheck_configured ? "accent" : "neutral"}>{s.healthcheck_configured ? "ativo" : "não configurado"}</Badge>} />
          <Row label="Aviso quando o agente volta" env={envName("downtime_notice_min")} value={`após ${fmtValue(d.downtime_notice_min)} min fora do ar`} />
        </dl>
      ) : null}
      {run.data && (
        <Callout tone="ok" className="mt-3">
          {run.data.created ? `Backup ${run.data.created} criado` : "Backup criado"}
          {run.data.sent_telegram ? " e enviado ao seu chat do Telegram." : ". Ficou só na pasta local (Telegram não configurado ou arquivo grande demais)."}
        </Callout>
      )}
      {run.error && <Callout tone="crit" className="mt-3">{(run.error as ApiError).message}</Callout>}
    </Section>
  );
}
