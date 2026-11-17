"use client";

import type { AgentInfo, DigestStatus, NotificationStatus, UsagePlan, WeatherStatus } from "@astryon/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BellRing, Cable, CloudSun, Database, Gauge, Info, KeyRound, Save, Settings, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { PageHeader, QueryError } from "@/components/domain";
import { WeatherLocationForm } from "@/components/weather";
import { Badge, Button, Callout, Input, Label, Skeleton, Switch } from "@/components/ui/primitives";
import { api, ApiError, useAgent } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useDemo } from "@/lib/demo-context";
import { fmtAgo, fmtBytesStr, fmtDateTime, fmtDay, fmtNumber, fmtPct } from "@/lib/format";
import { AccountSection } from "./settings-parts/account-section";
import { AiSection } from "./settings-parts/ai-section";
import { CloudSection } from "./settings-parts/cloud-section";
import { ServerSection } from "./settings-parts/server-section";
import { Annunciator, envName, fmtValue, ManageLink, type ModuleState, Num, RackGroup, RackProvider, Row, SECRET_LABELS, Section, type SettingsData, type SyncState, WEEKDAYS } from "./settings-parts/shared";

/* ----------------------------------------------------------------- Tela */
export default function SettingsView() {
  const q = useAgent<SettingsData>("settings");
  return (
    <>
      <PageHeader title="Configurações" icon={<Settings />} description="Cada parte do sistema com a sua luz de estado. Abra um módulo para ver os detalhes e ajustar. Segredos nunca são exibidos nem enviados ao navegador." />
      {q.error && <QueryError error={q.error} />}
      {q.isLoading && <Skeleton className="h-64 w-full" />}
      {q.data && <SettingsBody d={q.data} />}
    </>
  );
}

function SettingsBody({ d }: { d: SettingsData }) {
  return (
    <RackProvider>
      <Annunciator />
      <RackGroup title="Uso do dia a dia" description="O que você ajusta pelo painel. Vale na hora, sem reiniciar.">
        <GeneralModule d={d} />
        <PlanModule d={d} />
        <NotificationsModule />
        <AiSection d={d} />
        <WeatherModule />
        <AccountSection />
      </RackGroup>
      <RackGroup title="Sistema" description="Como o agente coleta, guarda e se conecta. Valores do arquivo de ambiente do agente.">
        <ConnectionsModule d={d} />
        <CollectionModule d={d} />
        <ServerSection d={d} />
        <CloudSection />
        <CredentialsModule d={d} />
        <AboutModule d={d} />
      </RackGroup>
    </RackProvider>
  );
}

/* ----------------------------------------------------------------- Salvar ajustes de um módulo */
function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, Record<string, unknown>>({
    mutationFn: (body) => api("settings", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent"] }),
  });
}

function SaveRow({ dirty, valid, pending, onSave, onDiscard, error, saved, label = "Salvar" }: { dirty: boolean; valid: boolean; pending: boolean; onSave: () => void; onDiscard: () => void; error: ApiError | null; saved: boolean; label?: string }) {
  const demo = useDemo();
  return (
    <>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        {dirty && <span className="mr-auto text-xs text-fg-muted">Alterações não salvas</span>}
        {dirty && (
          <Button size="sm" variant="ghost" onClick={onDiscard} disabled={pending}>
            Descartar
          </Button>
        )}
        <Button size="sm" variant="primary" onClick={onSave} loading={pending} disabled={demo || !dirty || !valid}>
          <Save /> {label}
        </Button>
      </div>
      {error && (
        <Callout tone="crit" className="mt-3">
          {error.message}
        </Callout>
      )}
      {saved && !dirty && (
        <Callout tone="ok" className="mt-3">
          Salvo. Já está valendo.
        </Callout>
      )}
    </>
  );
}

/* ----------------------------------------------------------------- Antena e preferências */
function GeneralModule({ d }: { d: SettingsData }) {
  const demo = useDemo();
  const initial = { name: d.terminal_name, showMac: d.show_mac_addresses };
  const [name, setName] = useState(initial.name);
  const [showMac, setShowMac] = useState(initial.showMac);
  const save = useSaveSettings();
  const dirty = name !== initial.name || showMac !== initial.showMac;
  return (
    <Section
      id="geral"
      title="Antena e preferências"
      icon={SlidersHorizontal}
      state="ok"
      value={d.terminal_name}
      detail={`Fuso ${String(d.timezone ?? "—")} · MAC ${d.show_mac_addresses ? "completos" : "ocultos"}`}
      description="Como o painel identifica a sua antena e o que ele mostra. Vale na hora, sem reiniciar."
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="tn">Nome da antena</Label>
          <Input id="tn" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-invalid={!name.trim()} disabled={demo} />
          <p className="text-[11px] text-fg-subtle">Aparece na barra lateral, nos relatórios e no Telegram.</p>
        </div>
        <div className="space-y-1">
          <span className="text-xs font-medium text-fg-muted">Fuso de exibição</span>
          <p className="tabular flex h-9 items-center rounded-md border border-border bg-bg-elev px-3 text-sm text-fg-muted">{fmtValue(d.timezone)}</p>
          <p className="text-[11px] text-fg-subtle" title="Variável: ASTRYON_TIMEZONE">
            Definido no arquivo de ambiente do agente.
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
      <SaveRow
        dirty={dirty}
        valid={!!name.trim()}
        pending={save.isPending}
        onSave={() => save.mutate({ terminal_name: name, show_mac_addresses: showMac })}
        onDiscard={() => {
          setName(initial.name);
          setShowMac(initial.showMac);
          save.reset();
        }}
        error={save.error}
        saved={save.isSuccess}
      />
    </Section>
  );
}

/* ----------------------------------------------------------------- Plano de internet */
function PlanModule({ d }: { d: SettingsData }) {
  const demo = useDemo();
  const plan = useAgent<UsagePlan>("usage/plan");
  const initial = { limit: d.usage_monthly_limit_gb ? String(d.usage_monthly_limit_gb) : "", cycleDay: String(d.usage_cycle_start_day ?? 1) };
  const [limit, setLimit] = useState(initial.limit);
  const [cycleDay, setCycleDay] = useState(initial.cycleDay);
  const save = useSaveSettings();
  const dayOk = /^\d+$/.test(cycleDay) && Number(cycleDay) >= 1 && Number(cycleDay) <= 28;
  const limitOk = limit === "" || (Number(limit) >= 0 && Number(limit) <= 100000);
  const dirty = limit !== initial.limit || cycleDay !== initial.cycleDay;
  const p = plan.data;

  let state: ModuleState = "loading";
  let stateLabel: string | undefined;
  let value: React.ReactNode = "—";
  let detail: string | undefined;
  if (p && !p.configured) {
    state = "off";
    stateLabel = "sem franquia";
    value = "Sem franquia";
    detail = `Consumo acompanhado · ciclo vira no dia ${d.usage_cycle_start_day ?? 1}`;
  } else if (p) {
    const pct = p.pct_used ?? 0;
    state = pct >= 100 ? "crit" : pct >= 80 ? "warn" : "ok";
    stateLabel = p.pct_used !== null ? `${p.lower_bound ? "≥ " : ""}${fmtPct(p.pct_used, 0)} usado` : undefined;
    value = (
      <>
        <Num>{fmtBytesStr(p.used.bytes_total)}</Num> de <Num>{fmtBytesStr(p.cap_bytes)}</Num>
      </>
    );
    detail = `Faltam ${fmtNumber(p.days_remaining, 0)} dias · vira no dia ${d.usage_cycle_start_day ?? 1}`;
  }

  return (
    <Section
      id="plano"
      title="Plano de internet"
      icon={Gauge}
      state={state}
      stateLabel={stateLabel}
      value={value}
      detail={detail}
      description="A franquia é comparada ao consumo estimado localmente, que não substitui o valor oficial da fatura. Com ela definida, os alertas avisam em 80% e 100% do ciclo."
      actions={<ManageLink slug="consumo">Ver consumo</ManageLink>}
    >
      {p && p.configured && (
        <div className="mb-5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm text-fg">
              Ciclo <span className="whitespace-nowrap">{fmtDay(p.cycle_start)} – {fmtDay(p.cycle_end - 1)}</span>
            </p>
            <p className="tabular shrink-0 whitespace-nowrap text-sm text-fg">
              {fmtBytesStr(p.used.bytes_total)} <span className="text-fg-muted">/ {fmtBytesStr(p.cap_bytes)}</span>
            </p>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-label="Consumo do ciclo" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(100, p.pct_used ?? 0))}>
            <div className={cn("h-full rounded-full", state === "crit" ? "bg-crit" : state === "warn" ? "bg-warn" : "bg-ok")} style={{ width: `${Math.min(100, p.pct_used ?? 0)}%` }} />
          </div>
          <p className="mt-1.5 text-[11px] text-fg-subtle">Faltam {fmtNumber(p.days_remaining, 0)} dias. Valores conforme salvos; alterações abaixo passam a valer ao salvar.</p>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="lim">Franquia mensal do plano (GB)</Label>
          <Input id="lim" className="block sm:max-w-48" type="number" min={0} step="any" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="sem franquia" aria-invalid={!limitOk} disabled={demo} />
          <p className="text-[11px] text-fg-subtle">Deixe vazio para planos sem limite.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="cday">Dia de virada do ciclo (1–28)</Label>
          <Input id="cday" className="block sm:max-w-48" type="number" min={1} max={28} value={cycleDay} onChange={(e) => setCycleDay(e.target.value)} aria-invalid={!dayOk} aria-describedby="cday-help" disabled={demo} />
          <p id="cday-help" className={cn("text-[11px]", dayOk ? "text-fg-subtle" : "text-crit")}>
            {dayOk ? "Dia do mês em que a operadora zera o consumo." : "Use um número de 1 a 28."}
          </p>
        </div>
      </div>
      <SaveRow
        dirty={dirty}
        valid={dayOk && limitOk}
        pending={save.isPending}
        // franquia vazia envia 0, que remove a franquia (e desliga os alertas de 80%/100%)
        onSave={() => save.mutate({ usage_monthly_limit_gb: limit ? Number(limit) : 0, usage_cycle_start_day: Number(cycleDay) })}
        onDiscard={() => {
          setLimit(initial.limit);
          setCycleDay(initial.cycleDay);
          save.reset();
        }}
        error={save.error}
        saved={save.isSuccess}
      />
    </Section>
  );
}

/* ----------------------------------------------------------------- Clima */
function WeatherModule() {
  const w = useAgent<WeatherStatus>("weather");
  const s = w.data;
  const state: ModuleState = !s ? (w.error ? "warn" : "loading") : !s.configured ? "off" : s.last_error ? "warn" : "ok";
  return (
    <Section
      id="clima"
      title="Clima"
      icon={CloudSun}
      state={state}
      stateLabel={s && !s.configured ? "sem cidade" : undefined}
      value={s?.location?.name ?? "Cidade não definida"}
      detail={!s ? undefined : !s.configured ? "Escolha a cidade para cruzar chuva com quedas" : s.last_ok_at ? `Atualizado ${fmtAgo(s.last_ok_at)}` : "Aguardando a primeira leitura"}
      description="Escolha a cidade da antena para ver o clima no Dashboard e marcar nos gráficos e eventos quando a conexão oscilou com chuva. Vale na hora."
    >
      <WeatherLocationForm />
    </Section>
  );
}

/* ----------------------------------------------------------------- Notificações */
function NotificationsModule() {
  const notif = useAgent<NotificationStatus>("alerts/notifications", { refetchInterval: 60_000 });
  const digest = useAgent<DigestStatus>("alerts/digest", { refetchInterval: 60_000 });
  const n = notif.data;
  const dg = digest.data;
  const channels = n ? [n.channels.telegram && "Telegram", n.channels.webhook && "Webhook"].filter(Boolean).join(" + ") : "";
  const state: ModuleState = !n ? (notif.error ? "warn" : "loading") : !channels ? "off" : n.failed_24h > 0 || n.last_error ? "warn" : "ok";
  return (
    <Section
      id="notificacoes"
      title="Notificações e resumo"
      icon={BellRing}
      state={state}
      stateLabel={n && !channels ? "sem canal" : n && n.failed_24h > 0 ? `${n.failed_24h} falha(s) em 24 h` : undefined}
      value={channels || "Nenhum canal"}
      detail={n ? `Último envio: ${n.last_sent_at ? fmtAgo(n.last_sent_at) : "nunca"}` : undefined}
      description="Para onde os alertas vão e quando sai o resumo da semana. Regras, testes e horários são ajustados em Alertas."
      actions={<ManageLink slug="alertas">Gerenciar em Alertas</ManageLink>}
    >
      {notif.error && <QueryError error={notif.error} />}
      {!n && !notif.error ? (
        <Skeleton className="h-24 w-full" />
      ) : n ? (
        <dl className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
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
  );
}

/* ----------------------------------------------------------------- Coleta e armazenamento */
function CollectionModule({ d }: { d: SettingsData }) {
  const agent = useAgent<AgentInfo>("agent", { refetchInterval: 30_000 });
  const a = agent.data;
  const lost = a?.history_lost_total ?? 0;
  return (
    <Section
      id="coleta"
      title="Coleta e armazenamento"
      icon={Database}
      state={lost > 0 ? "warn" : "ok"}
      stateLabel={lost > 0 ? `${fmtNumber(lost, 0)} perdidas` : undefined}
      value={
        <>
          Leitura a cada <Num>{fmtValue(d.status_interval_s, "s")}</Num>
        </>
      }
      detail={a ? `${fmtNumber(a.history_inserted_total, 0)} amostras · guarda ${fmtNumber(Number(d.retention_raw_days ?? 0), 0)} dias em 1 s` : undefined}
      description="Com que frequência o agente lê a antena e por quanto tempo guarda os dados. Para mudar, edite o arquivo de ambiente do agente e reinicie."
    >
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
      {a && (
        <p className="tabular mt-3 text-[11px] text-fg-subtle">
          Coletadas até agora: {fmtNumber(a.history_inserted_total, 0)} amostras · perdidas: {fmtNumber(a.history_lost_total, 0)}
        </p>
      )}
    </Section>
  );
}

/* ----------------------------------------------------------------- Conexões e integrações */
function ConnectionsModule({ d }: { d: SettingsData }) {
  const demo = useDemo();
  const agent = useAgent<AgentInfo>("agent", { refetchInterval: 30_000 });
  const sync = useAgent<SyncState>(demo ? null : "sync", { refetchInterval: 60_000 });
  const mqtt = useAgent<{ configured: boolean; host: string | null; port: number; connected: boolean; last_publish: number | null; last_error: string | null }>("integrations/mqtt", { refetchInterval: 60_000 });
  const reach = agent.data?.dish_reachable;
  const mqttDown = mqtt.data?.configured && !mqtt.data.connected;
  const state: ModuleState = !agent.data ? "loading" : reach === false ? "crit" : mqttDown ? "warn" : "ok";
  return (
    <Section
      id="conexoes"
      title="Conexões e integrações"
      icon={Cable}
      state={state}
      stateLabel={reach === false ? "antena fora" : mqttDown ? "MQTT caiu" : undefined}
      value={/\d/.test(String(d.dish_target ?? "")) ? <Num>{String(d.dish_target)}</Num> : String(d.dish_target ?? "—")}
      detail={`Roteador ${d.router_enabled ? "ligado" : "desligado"} · MQTT ${!mqtt.data ? "—" : !mqtt.data.configured ? "não configurado" : mqtt.data.connected ? "conectado" : "desconectado"}`}
      description="Onde o agente encontra a antena e o roteador, quem pode acessar a API e as integrações opcionais."
    >
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
  );
}

/* ----------------------------------------------------------------- Credenciais */
function CredentialsModule({ d }: { d: SettingsData }) {
  const entries = Object.entries(d.secrets_configured);
  const defined = entries.filter(([, v]) => v).length;
  return (
    <Section
      id="credenciais"
      title="Credenciais"
      icon={KeyRound}
      state="ok"
      value={
        <>
          <Num>{defined}</Num> de <Num>{entries.length}</Num> definidas
        </>
      }
      detail="O valor de cada segredo nunca sai do agente"
      description="Só mostramos se cada segredo está definido. O valor nunca sai do agente."
    >
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {entries.map(([k, v]) => (
          <li key={k} className="flex items-center justify-between gap-3 rounded-md border border-border bg-bg-elev/60 px-3 py-2.5">
            <span className="min-w-0 truncate text-sm text-fg" title={`Variável: ${envName(k)}`}>
              {SECRET_LABELS[k] ?? k}
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
  );
}

/* ----------------------------------------------------------------- Sobre */
function AboutModule({ d }: { d: SettingsData }) {
  const agent = useAgent<AgentInfo>("agent", { refetchInterval: 30_000 });
  const a = agent.data;
  const fixture = a?.mode === "fixture";
  return (
    <Section
      id="sobre"
      title="Sobre este painel"
      icon={Info}
      state={!a ? "loading" : fixture || a.mode !== "real" ? "warn" : "ok"}
      stateLabel={fixture ? "arquivo de teste" : a && a.mode !== "real" ? "sem coletor" : undefined}
      value={
        <>
          Versão <Num>{String(d.version ?? a?.version ?? "—")}</Num>
        </>
      }
      detail={a ? `No ar ${fmtAgo(a.started_at)} · firmware ${a.firmware ?? "—"}` : undefined}
      description="Projeto independente, sem afiliação com a Starlink/SpaceX. Usa só a API local da antena."
    >
      <dl className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
        <Row label="Versão do agente" value={fmtValue(d.version ?? a?.version)} />
        <Row label="Modo do agente" value={a ? (a.mode === "real" ? "antena real" : a.mode === "fixture" ? "arquivo de teste (fixture)" : "sem coletor") : "—"} />
        <Row label="Agente no ar desde" value={a ? `${fmtDateTime(a.started_at)} (${fmtAgo(a.started_at)})` : "—"} />
        <Row label="Firmware da antena" value={fmtValue(a?.firmware)} />
        <Row label="Hardware" value={fmtValue(a?.hardware)} />
        <Row label="Capacidades verificadas" value={a?.capabilities_checked ? fmtAgo(a.capabilities_checked) : "—"} />
      </dl>
    </Section>
  );
}
