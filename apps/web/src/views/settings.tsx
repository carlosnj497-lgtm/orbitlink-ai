"use client";

import type { AgentInfo, DigestStatus, NotificationStatus, UsagePlan } from "@astryon/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BellRing, Cable, CloudSun, Database, Gauge, Info, KeyRound, Save, Settings, SlidersHorizontal, Sparkles } from "lucide-react";
import { useState } from "react";
import { PageHeader, QueryError } from "@/components/domain";
import { WeatherLocationForm } from "@/components/weather";
import { Badge, Button, Callout, Input, Label, Skeleton, Switch } from "@/components/ui/primitives";
import { api, ApiError, useAgent } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useDemo } from "@/lib/demo-context";
import { fmtAgo, fmtBytesStr, fmtDateTime, fmtDay, fmtNumber, fmtPct, usageForToday } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { AccountSection } from "./settings-parts/account-section";
import { CloudSection } from "./settings-parts/cloud-section";
import { ServerSection } from "./settings-parts/server-section";
import { type AiStatus, envName, fmtValue, ManageLink, Row, SECRET_LABELS, Section, SectionNav, type SettingsData, type SyncState, WEEKDAYS } from "./settings-parts/shared";

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
  const clock = useNow(60_000);
  const qc = useQueryClient();
  const plan = useAgent<UsagePlan>("usage/plan");
  const notif = useAgent<NotificationStatus>("alerts/notifications", { refetchInterval: 60_000 });
  const digest = useAgent<DigestStatus>("alerts/digest", { refetchInterval: 60_000 });
  const ai = useAgent<AiStatus>("ai/status");
  const agent = useAgent<AgentInfo>("agent", { refetchInterval: 30_000 });
  const sync = useAgent<SyncState>(demo ? null : "sync", { refetchInterval: 60_000 });
  const mqtt = useAgent<{ configured: boolean; host: string | null; port: number; connected: boolean; last_publish: number | null; last_error: string | null }>("integrations/mqtt", { refetchInterval: 60_000 });

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

  const today = usageForToday(ai.data?.usage, clock);
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
                Definido por <span className="font-mono">ASTRYON_TIMEZONE</span> no agente.
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
              <Row label="Telegram" env="ASTRYON_TELEGRAM_BOT_TOKEN + _CHAT_ID" value={<Badge tone={n.channels.telegram ? "accent" : "neutral"}>{n.channels.telegram ? "ativo" : "não configurado"}</Badge>} />
              <Row label="Webhook" env="ASTRYON_ALERT_WEBHOOK_URL" value={<Badge tone={n.channels.webhook ? "accent" : "neutral"}>{n.channels.webhook ? "ativo" : "não configurado"}</Badge>} />
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
              <Row label="Motor" env="ASTRYON_GROQ_API_KEY" value={<Badge tone={ai.data.configured ? "accent" : "neutral"}>{ai.data.configured ? "Groq" : "somente regras"}</Badge>} />
              <Row label="Modelo" env="ASTRYON_AI_MODEL" value={fmtValue(ai.data.configured ? ai.data.model : d.ai_model)} />
              <Row label="Perguntas hoje / limite diário" env="ASTRYON_AI_DAILY_REQUEST_LIMIT" value={`${fmtNumber(today?.requests ?? 0, 0)} / ${fmtNumber(ai.data.daily_limit, 0)}`} />
              <Row label="Guardar conversas por" env="ASTRYON_AI_CONVERSATION_RETENTION_DAYS" value={fmtValue(ai.data.retention_days ?? d.ai_conversation_retention_days, "d")} />
              <Row label="Áudio no Telegram (Whisper)" env="ASTRYON_AI_TRANSCRIBE_ENABLED" value={ai.data.audio ? <Badge tone={ai.data.audio.enabled ? "accent" : "neutral"}>{ai.data.audio.enabled ? `ativo · ${ai.data.audio.model}` : "desligado"}</Badge> : "—"} />
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

        <CloudSection />

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
              label="MQTT / Home Assistant"
              env={`${envName("mqtt_host")} · _PORT`}
              value={!mqtt.data ? "—" : !mqtt.data.configured ? "não configurado" : mqtt.data.connected ? <Badge tone="accent">{`conectado · ${mqtt.data.host}:${mqtt.data.port}`}</Badge> : <span className="text-warn">{`desconectado${mqtt.data.last_error ? ` (${mqtt.data.last_error})` : ""}`}</span>}
            />
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
              <span className="font-medium text-fg">Ubuntu:</span> edite <span className="font-mono">/etc/astryon/astryon.env</span> e rode <span className="font-mono">sudo astryonctl restart</span>.
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
