"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Cpu, KeyRound, Trash2, Wifi } from "lucide-react";
import { useState } from "react";
import { PageHeader, QueryError, SourceBadge } from "@/components/domain";
import { Button, Callout, Card, CardBody, CardHeader, EmptyState, Input, Label, Skeleton, Switch } from "@/components/ui/primitives";
import { api, ApiError, useAgent } from "@/lib/api";
import { useDemo } from "@/lib/demo-context";
import { fmtAgo, fmtDateTime, fmtDuration, fmtNumber } from "@/lib/format";
import { SectionHead } from "./antenna-parts/section";
import { StateLight, SystemDiagram } from "./antenna-parts/system-diagram";

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
    <Card id="parear">
      <CardHeader title="Parear novo ESP32" icon={<KeyRound />} subtitle="Gera um código de uso único para o portal do módulo" />
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
          <div className="rounded-md border border-accent/30 bg-accent-soft p-3">
            <p className="text-xs text-fg-muted">Código (uso único, expira {fmtDateTime(gen.data.expires_at)}):</p>
            <p className="mt-1 break-all font-mono text-2xl tracking-[0.15em] text-accent">{gen.data.code}</p>
            <p className="mt-2 text-xs text-fg-muted">Digite este código no portal de configuração do ESP32 (Wi-Fi “ASTRYON-Setup-XXXX”; a senha aparece no monitor serial). Precisa do firmware 0.2.0 ou mais novo. Veja docs/ESP32_SETUP.md.</p>
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
  const online = d?.nodes.filter((n) => n.online).length ?? 0;
  return (
    <>
      <PageHeader title="Centro ESP32" icon={<Cpu />} description="Nó IoT opcional de telemetria física. Não substitui o cliente gRPC da antena; envia as próprias medições ao agente, autenticadas por HMAC." />
      {q.error && (
        <div className="mb-4">
          <QueryError error={q.error} onRetry={() => q.refetch()} />
        </div>
      )}
      {(patch.error ?? del.error) && (
        <Callout tone="crit" className="mb-4" title="A ação não foi concluída">
          {(patch.error ?? del.error)?.message}
        </Callout>
      )}

      <SystemDiagram current="esp32" />

      <div className="mb-6 space-y-3">
        <Callout tone="warn" title="Segurança elétrica">
          Nunca ligue sensores de baixa tensão diretamente à rede AC. Medições DC exigem sensor com faixa adequada, fusível e proteção. Sem sensor instalado, nenhum dado elétrico é exibido.
        </Callout>
        {d && !d.enabled && !demo && (
          <Callout tone="neutral" title="Módulo IoT não configurado">
            O ASTRYON funciona normalmente sem ESP32. Para usar, defina <code className="font-mono">ASTRYON_ESP32_ENABLED=true</code> no .env e reinicie o agente.
            O listener aceitará apenas mensagens assinadas na porta 8788.
          </Callout>
        )}
      </div>

      <div className="grid grid-cols-1 items-start gap-x-4 gap-y-8 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <section aria-labelledby="modulos-t">
          <SectionHead id="modulos-t" title="Módulos pareados">
            {d ? (d.nodes.length ? <><span className="tabular">{online}</span> de <span className="tabular">{d.nodes.length}</span> com sinal agora</> : "Nenhum ainda") : null}
          </SectionHead>
          <div className="space-y-3">
            {q.isLoading && <Skeleton className="h-40 w-full" />}
            {d && !d.nodes.length && (
              <Card>
                <EmptyState icon={<Cpu />} title="Nenhum ESP32 pareado">
                  Gere um código ao lado e siga docs/ESP32_SETUP.md para gravar o firmware via USB.
                </EmptyState>
              </Card>
            )}
            {d?.nodes.map((n) => (
              <Card key={n.id} className={n.online ? undefined : "border-crit/40"}>
                <CardHeader
                  title={n.name}
                  icon={<Cpu />}
                  subtitle={<span className="tabular">{`${n.device_id} · firmware ${n.firmware ?? "?"}`}</span>}
                  actions={
                    <>
                      <StateLight state={n.online ? "ok" : "crit"} label={n.online ? "online" : "sem heartbeat"} />
                      <Switch label={`Habilitar ${n.name}`} checked={!!n.enabled} onCheckedChange={(v) => patch.mutate({ id: n.id, enabled: v })} disabled={demo} />
                      <Button size="icon" variant="ghost" aria-label={`Remover ${n.name}`} onClick={() => confirm(`Remover ${n.name}? Será preciso parear de novo.`) && del.mutate(n.id)} disabled={demo}>
                        <Trash2 />
                      </Button>
                    </>
                  }
                />
                <CardBody>
                  <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
                    <span className="inline-flex items-center gap-1">
                      <Wifi className="size-3.5" aria-hidden /> <span className="tabular">{n.rssi != null ? `${n.rssi} dBm` : "—"}</span>
                    </span>
                    <span>
                      Uptime <span className="tabular">{fmtDuration(n.uptime_s)}</span>
                    </span>
                    <span>Último contato {fmtAgo(n.last_seen)}</span>
                  </div>
                  {n.latest.length === 0 ? (
                    <p className="text-sm text-fg-subtle">Nenhuma leitura de sensor (somente heartbeat). Sensores são habilitados no firmware.</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {n.latest.map((r) => {
                        const [label, unit] = SENSOR_LABEL[r.sensor] ?? [r.sensor, ""];
                        return (
                          <div key={r.sensor} className="rounded-md border border-border bg-bg-elev px-3 py-2">
                            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                              <p className="text-[11px] text-fg-subtle">{label}</p>
                              <SourceBadge source="sensor_esp32" />
                            </div>
                            <p className="tabular mt-1 text-lg font-medium text-fg">
                              {r.sensor === "power.present" ? (r.value ? "Sim" : "Não") : fmtNumber(r.value, 2)} <span className="text-xs text-fg-muted">{unit}</span>
                            </p>
                            <p className={r.quality !== "ok" ? "text-[11px] text-warn" : "text-[11px] text-fg-subtle"}>
                              {r.quality !== "ok" ? `qualidade: ${r.quality} · ` : ""}
                              {fmtAgo(r.ts)}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardBody>
              </Card>
            ))}
          </div>
        </section>
        <section aria-labelledby="parear-t">
          <SectionHead id="parear-t" title="Parear" />
          <PairingCard />
        </section>
      </div>
    </>
  );
}
