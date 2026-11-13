"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Save, Settings } from "lucide-react";
import { type FormEvent, useState } from "react";
import { PageHeader, QueryError } from "@/components/domain";
import { Badge, Button, Callout, Card, CardBody, CardHeader, Input, Label, Skeleton, Switch } from "@/components/ui/primitives";
import { api, ApiError, useAgent } from "@/lib/api";
import { useDemo } from "@/lib/demo-context";

type SettingsData = Record<string, unknown> & {
  secrets_configured: Record<string, boolean>;
  runtime_overrides: Record<string, string | null>;
  terminal_name: string;
  show_mac_addresses: boolean;
  usage_monthly_limit_gb?: number | null;
  usage_cycle_start_day?: number;
};

const READONLY: { key: string; label: string; env: string }[] = [
  { key: "dish_target", label: "Antena (gRPC)", env: "ORBITLINK_DISH_TARGET" },
  { key: "router_target", label: "Roteador (gRPC)", env: "ORBITLINK_ROUTER_TARGET" },
  { key: "router_enabled", label: "Integração com roteador", env: "ORBITLINK_ROUTER_ENABLED" },
  { key: "status_interval_s", label: "Intervalo de status (s)", env: "ORBITLINK_STATUS_INTERVAL_S" },
  { key: "history_interval_s", label: "Intervalo de histórico (s)", env: "ORBITLINK_HISTORY_INTERVAL_S" },
  { key: "obstruction_interval_s", label: "Intervalo do mapa de obstrução (s)", env: "ORBITLINK_OBSTRUCTION_INTERVAL_S" },
  { key: "retention_raw_days", label: "Retenção de amostras de 1 s (dias)", env: "ORBITLINK_RETENTION_RAW_DAYS" },
  { key: "retention_minute_days", label: "Retenção de agregados (dias)", env: "ORBITLINK_RETENTION_MINUTE_DAYS" },
  { key: "host", label: "Endereço da API do agente", env: "ORBITLINK_HOST" },
  { key: "allow_lan", label: "Acesso pela LAN", env: "ORBITLINK_ALLOW_LAN" },
  { key: "esp32_enabled", label: "Listener ESP32", env: "ORBITLINK_ESP32_ENABLED" },
  { key: "supabase_url", label: "Supabase URL", env: "ORBITLINK_SUPABASE_URL" },
  { key: "ai_model", label: "Modelo Claude", env: "ORBITLINK_AI_MODEL" },
  { key: "ai_daily_request_limit", label: "Limite diário do assistente", env: "ORBITLINK_AI_DAILY_REQUEST_LIMIT" },
  { key: "ai_conversation_retention_days", label: "Retenção de conversas (dias)", env: "ORBITLINK_AI_CONVERSATION_RETENTION_DAYS" },
  { key: "timezone", label: "Fuso de exibição", env: "ORBITLINK_TIMEZONE" },
];

function PasswordCard() {
  const demo = useDemo();
  const [old, setOld] = useState("");
  const [nw, setNw] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await fetch("/api/auth/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ old_password: old, new_password: nw }) });
    if (r.ok || r.status === 204) {
      setMsg({ ok: true, text: "Senha alterada. Todas as sessões foram encerradas; entre novamente." });
      setTimeout(() => (window.location.href = "/login"), 1500);
    } else setMsg({ ok: false, text: (await r.json().catch(() => ({}))).detail ?? "Falha ao alterar a senha." });
  }
  return (
    <Card>
      <CardHeader title="Segurança" icon={<KeyRound />} />
      <CardBody>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1"><Label htmlFor="old">Senha atual</Label><Input id="old" type="password" autoComplete="current-password" value={old} onChange={(e) => setOld(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="new">Nova senha (mín. 10)</Label><Input id="new" type="password" autoComplete="new-password" minLength={10} value={nw} onChange={(e) => setNw(e.target.value)} /></div>
          <Button size="sm" type="submit" disabled={demo || !old || nw.length < 10}>Alterar senha</Button>
          {msg && <Callout tone={msg.ok ? "ok" : "crit"}>{msg.text}</Callout>}
        </form>
      </CardBody>
    </Card>
  );
}

export default function SettingsView() {
  const q = useAgent<SettingsData>("settings");
  return (
    <>
      <PageHeader title="Configurações" icon={<Settings />} description="Ajustes em tempo de execução e visão da configuração efetiva. Segredos nunca são exibidos nem enviados ao navegador." />
      {q.error && <QueryError error={q.error} />}
      {q.isLoading && <Skeleton className="h-64 w-full" />}
      {q.data && <SettingsBody d={q.data} />}
    </>
  );
}

function SettingsBody({ d }: { d: SettingsData }) {
  const demo = useDemo();
  const qc = useQueryClient();
  const [name, setName] = useState(d.terminal_name);
  const [limit, setLimit] = useState(d.usage_monthly_limit_gb ? String(d.usage_monthly_limit_gb) : "");
  const [cycleDay, setCycleDay] = useState(String(d.usage_cycle_start_day ?? 1));
  const [showMac, setShowMac] = useState(d.show_mac_addresses);
  const dayOk = /^\d+$/.test(cycleDay) && Number(cycleDay) >= 1 && Number(cycleDay) <= 28;
  const save = useMutation({
    // franquia vazia envia 0, que remove a franquia (e desliga os alertas de 80%/100%)
    mutationFn: () =>
      api("settings", {
        method: "PUT",
        body: JSON.stringify({ terminal_name: name, show_mac_addresses: showMac, usage_monthly_limit_gb: limit ? Number(limit) : 0, usage_cycle_start_day: Number(cycleDay) }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent"] }),
  });
  return (
    <>
      {(
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="Preferências" />
            <CardBody className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1"><Label htmlFor="tn">Nome da antena</Label><Input id="tn" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></div>
                <div className="space-y-1"><Label htmlFor="lim">Franquia mensal do plano (GB)</Label><Input id="lim" type="number" min={0} step="any" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="sem franquia" /></div>
                <div className="space-y-1">
                  <Label htmlFor="cday">Dia de virada do ciclo (1–28)</Label>
                  <Input id="cday" type="number" min={1} max={28} value={cycleDay} onChange={(e) => setCycleDay(e.target.value)} aria-invalid={!dayOk} />
                </div>
              </div>
              <p className="text-xs text-fg-subtle">A franquia é comparada ao consumo estimado localmente, que não substitui o valor oficial da fatura. Com ela definida, os alertas avisam em 80% e 100% do ciclo.</p>
              <label className="flex items-center gap-3 text-sm">
                <Switch label="Exibir endereços MAC completos" checked={showMac} onCheckedChange={setShowMac} disabled={demo} />
                Exibir endereços MAC completos na tela de dispositivos
              </label>
              <Button size="sm" variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={demo || !name.trim() || !dayOk}><Save /> Salvar</Button>
              {save.error && <Callout tone="crit">{(save.error as ApiError).message}</Callout>}
              {save.isSuccess && <Callout tone="ok">Preferências salvas.</Callout>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Credenciais configuradas" />
            <CardBody>
              <ul className="space-y-2 text-sm">
                {Object.entries(d.secrets_configured).map(([k, v]) => (
                  <li key={k} className="flex items-center justify-between gap-2"><span className="font-mono text-xs text-fg-muted">{k}</span><Badge tone={v ? "ok" : "neutral"}>{v ? "configurada" : "ausente"}</Badge></li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-fg-subtle">Windows: edite o .env na raiz e reinicie (scripts\stop.ps1 + start.ps1). Ubuntu: edite /etc/orbitlink/orbitlink.env e rode sudo orbitlinkctl restart.</p>
            </CardBody>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader title="Configuração efetiva (somente leitura)" />
            <CardBody>
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                {READONLY.map((r) => (
                  <div key={r.key} className="flex items-baseline justify-between gap-3 border-b border-border/50 pb-1.5">
                    <dt className="text-fg-muted">{r.label}<span className="block font-mono text-[10px] text-fg-subtle">{r.env}</span></dt>
                    <dd className="text-right font-mono text-xs">{d[r.key] === null || d[r.key] === undefined ? "—" : String(d[r.key])}</dd>
                  </div>
                ))}
              </dl>
            </CardBody>
          </Card>
          <PasswordCard />
        </div>
      )}
    </>
  );
}
