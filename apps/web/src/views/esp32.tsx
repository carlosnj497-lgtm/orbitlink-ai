"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Cpu, KeyRound, Trash2, Wifi } from "lucide-react";
import { useState } from "react";
import { PageHeader, QueryError, SourceBadge } from "@/components/domain";
import { Badge, Button, Callout, Card, CardBody, CardHeader, EmptyState, Input, Label, Skeleton, Switch } from "@/components/ui/primitives";
import { api, ApiError, useAgent } from "@/lib/api";
import { useDemo } from "@/lib/demo-context";
import { fmtAgo, fmtDateTime, fmtDuration, fmtNumber } from "@/lib/format";

interface Node {
  id: number;
  device_id: string;
  name: string;
  firmware: string | null;
  sensors: string[];
  last_seen: number | null;
  rssi: number | null;
  uptime_s: number | null;
  enabled: number;
  online: boolean;
  latest: { sensor: string; value: number | null; quality: string; ts: number }[];
}

const SENSOR_LABEL: Record<string, [string, string]> = {
  "power.voltage_v": ["Tensão", "V"],
  "power.current_a": ["Corrente", "A"],
  "power.power_w": ["Potência", "W"],
  "power.energy_wh": ["Energia", "Wh"],
  "power.present": ["Alimentação presente", ""],
  "env.temp_c": ["Temperatura", "°C"],
  "env.humidity_pct": ["Umidade", "%"],
};

function PairingCard() {
  const demo = useDemo();
  const [name, setName] = useState("Caixa da antena");
  const gen = useMutation({ mutationFn: () => api<{ code: string; expires_at: number }>("esp32/pairing-code", { method: "POST", body: JSON.stringify({ name }) }) });
  return (
    <Card>
      <CardHeader title="Parear novo ESP32" icon={<KeyRound />} />
      <CardBody className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="node-name">Nome do módulo</Label>
          <Input id="node-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </div>
        <Button size="sm" variant="primary" onClick={() => gen.mutate()} loading={gen.isPending} disabled={demo || name.trim().length < 2}>
          Gerar código de pareamento
        </Button>
        {gen.error && <Callout tone="crit">{(gen.error as ApiError).message}</Callout>}
        {gen.data && (
          <div className="rounded-lg border border-accent/30 bg-accent-soft p-3">
            <p className="text-xs text-fg-muted">Código (uso único, expira {fmtDateTime(gen.data.expires_at)}):</p>
            <p className="mt-1 font-mono text-3xl tracking-[0.3em] text-accent">{gen.data.code}</p>
            <p className="mt-2 text-xs text-fg-muted">Digite este código no portal de configuração do ESP32 (Wi-Fi “OrbitLink-Setup-XXXX”). Veja docs/ESP32_SETUP.md.</p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export default function Esp32View() {
  const demo = useDemo();
  const qc = useQueryClient();
  const q = useAgent<{ enabled: boolean; listen: string | null; nodes: Node[] }>("esp32/nodes", { refetchInterval: 15_000 });
  const patch = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => api(`esp32/nodes/${id}`, { method: "PATCH", body: JSON.stringify({ enabled }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent", "esp32/nodes"] }),
  });
  const del = useMutation({
    mutationFn: (id: number) => api(`esp32/nodes/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent", "esp32/nodes"] }),
  });
  const d = q.data;
  return (
    <>
      <PageHeader title="Centro ESP32" icon={<Cpu />} description="Nó IoT opcional de telemetria física. Não substitui o cliente gRPC da antena; envia as próprias medições ao agente, autenticadas por HMAC." />
      {q.error && <QueryError error={q.error} />}
      {d && !d.enabled && !demo && (
        <Callout tone="neutral" title="Módulo IoT não configurado" className="mb-4">
          O OrbitLink funciona normalmente sem ESP32. Para usar, defina <code className="font-mono">ORBITLINK_ESP32_ENABLED=true</code> no .env e reinicie o agente.
          O listener aceitará apenas mensagens assinadas na porta 8788.
        </Callout>
      )}
      <Callout tone="warn" title="Segurança elétrica" className="mb-4">
        Nunca ligue sensores de baixa tensão diretamente à rede AC. Medições DC exigem sensor com faixa adequada, fusível e proteção. Sem sensor instalado, nenhum dado elétrico é exibido.
      </Callout>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {q.isLoading && <Skeleton className="h-40 w-full" />}
          {d && !d.nodes.length && (
            <Card>
              <EmptyState icon={<Cpu />} title="Nenhum ESP32 pareado">Gere um código ao lado e siga docs/ESP32_SETUP.md para gravar o firmware via USB.</EmptyState>
            </Card>
          )}
          {d?.nodes.map((n) => (
            <Card key={n.id}>
              <CardHeader
                title={n.name}
                subtitle={`${n.device_id} · firmware ${n.firmware ?? "?"}`}
                actions={
                  <>
                    <Badge tone={n.online ? "ok" : "crit"}>{n.online ? "online" : "sem heartbeat"}</Badge>
                    <Switch label={`Habilitar ${n.name}`} checked={!!n.enabled} onCheckedChange={(v) => patch.mutate({ id: n.id, enabled: v })} disabled={demo} />
                    <Button size="icon" variant="ghost" aria-label={`Remover ${n.name}`} onClick={() => confirm(`Remover ${n.name}? Será preciso parear de novo.`) && del.mutate(n.id)} disabled={demo}>
                      <Trash2 />
                    </Button>
                  </>
                }
              />
              <CardBody>
                <div className="mb-3 flex flex-wrap gap-4 text-xs text-fg-muted">
                  <span className="inline-flex items-center gap-1"><Wifi className="size-3.5" /> {n.rssi != null ? `${n.rssi} dBm` : "—"}</span>
                  <span>Uptime {fmtDuration(n.uptime_s)}</span>
                  <span>Último contato {fmtAgo(n.last_seen)}</span>
                </div>
                {n.latest.length === 0 ? (
                  <p className="text-sm text-fg-subtle">Nenhuma leitura de sensor (somente heartbeat). Sensores são habilitados no firmware.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {n.latest.map((r) => {
                      const [label, unit] = SENSOR_LABEL[r.sensor] ?? [r.sensor, ""];
                      return (
                        <div key={r.sensor} className="rounded-lg border border-border bg-bg-elev/60 px-3 py-2">
                          <div className="flex items-center justify-between">
                            <p className="text-[11px] text-fg-subtle">{label}</p>
                            <SourceBadge source="sensor_esp32" />
                          </div>
                          <p className="tabular text-lg font-semibold">
                            {r.sensor === "power.present" ? (r.value ? "Sim" : "Não") : fmtNumber(r.value, 2)} <span className="text-xs text-fg-muted">{unit}</span>
                          </p>
                          <p className="text-[11px] text-fg-subtle">{r.quality !== "ok" ? `qualidade: ${r.quality} · ` : ""}{fmtAgo(r.ts)}</p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
        <PairingCard />
      </div>
    </>
  );
}
