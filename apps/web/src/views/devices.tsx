"use client";

import { MonitorSmartphone, RefreshCw, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { CAP_META, PageHeader, QueryError, SourceBadge } from "@/components/domain";
import { Button, Callout, Card, CardBody, EmptyState, Skeleton } from "@/components/ui/primitives";
import { useAgent } from "@/lib/api";
import { fmtBytesStr, fmtDuration } from "@/lib/format";
import { SectionHead } from "./antenna-parts/section";
import { type PartState, StateLight, SystemDiagram } from "./antenna-parts/system-diagram";
import type { CapStatus, Source } from "@astryon/shared";

interface Device {
  name: string | null;
  ip: string | null;
  mac: string | null;
  interface: string | null;
  signal_dbm: number | null;
  connected_s: number | null;
  rx_bytes: number | null;
  tx_bytes: number | null;
}
interface DevicesResponse {
  source: Source;
  reason: string | null;
  devices: Device[];
  capability: { status: CapStatus; detail: string | null } | null;
  note?: string;
  checked_age_s?: number;
}

export default function DevicesView() {
  const [refresh, setRefresh] = useState(0);
  const q = useAgent<DevicesResponse>(`devices${refresh ? `?refresh=true&n=${refresh}` : ""}`, { refetchInterval: 60_000 });
  const d = q.data;
  const answered = !!d && d.source !== "indisponivel";
  const capTone = d?.capability ? CAP_META[d.capability.status].tone : null;
  const routerState: PartState = !d ? "loading" : answered ? "ok" : capTone === "crit" ? "crit" : capTone === "warn" ? "warn" : "off";
  return (
    <>
      <PageHeader
        title="Dispositivos da Rede"
        icon={<MonitorSmartphone />}
        description="Clientes informados pela API local do roteador Starlink. A antena não é fonte de tráfego por dispositivo e nenhuma varredura de rede é feita."
        actions={
          <Button size="sm" onClick={() => setRefresh((n) => n + 1)} loading={q.isFetching}>
            <RefreshCw /> Consultar roteador
          </Button>
        }
      />
      {q.error && (
        <div className="mb-4">
          <QueryError error={q.error} onRetry={() => q.refetch()} />
        </div>
      )}

      {/* A consulta forçada ("Consultar roteador") tem chave própria: o diagrama recebe a resposta mais nova. */}
      <SystemDiagram current={["roteador", "aparelhos"]} devices={d} />

      <section id="roteador" aria-labelledby="roteador-t" className="mb-8 scroll-mt-36 lg:scroll-mt-24">
        <SectionHead id="roteador-t" title="Roteador">
          Se o roteador respondeu à consulta e de onde vem a lista
        </SectionHead>
        <Card>
          <CardBody className="pt-4">
            {!d && q.isLoading && <Skeleton className="h-16 w-full" />}
            {d && (
              <dl className="divide-y divide-border/60">
                <div className="flex items-start justify-between gap-4 py-2.5">
                  <dt className="text-sm text-fg-muted">
                    Resposta
                    {!answered && d.reason && <span className="mt-0.5 block text-[11px] text-fg-subtle">{d.reason}</span>}
                  </dt>
                  <dd className="flex items-center gap-3">
                    <StateLight state={routerState} label={answered ? "respondeu" : routerState === "crit" ? "falha" : "não consultado"} />
                    <SourceBadge source={d.source} />
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4 py-2.5">
                  <dt className="text-sm text-fg-muted">
                    Lista de clientes pela API local
                    {d.capability?.detail && <span className="mt-0.5 block text-[11px] text-fg-subtle">{d.capability.detail}</span>}
                  </dt>
                  <dd>{d.capability ? <StateLight state={capTone === "ok" ? "ok" : capTone === "warn" ? "warn" : capTone === "crit" ? "crit" : "off"} label={CAP_META[d.capability.status].label} /> : <span className="text-xs text-fg-subtle">não verificada</span>}</dd>
                </div>
                {typeof d.checked_age_s === "number" && (
                  <div className="flex items-start justify-between gap-4 py-2.5">
                    <dt className="text-sm text-fg-muted">Última consulta</dt>
                    <dd className="tabular text-sm text-fg">há {fmtDuration(d.checked_age_s)}</dd>
                  </div>
                )}
              </dl>
            )}
            {d?.note && <p className="mt-2 text-xs text-fg-subtle">{d.note}</p>}
          </CardBody>
        </Card>
      </section>

      <section id="aparelhos" aria-labelledby="aparelhos-t" className="mb-8 scroll-mt-36 lg:scroll-mt-24">
        <SectionHead id="aparelhos-t" title="Clientes conectados">
          {d && answered ? (
            <>
              <span className="tabular">{d.devices.length}</span> {d.devices.length === 1 ? "aparelho informado" : "aparelhos informados"} pelo roteador
            </>
          ) : (
            "Lista informada pelo roteador"
          )}
        </SectionHead>
        <Card>
          <CardBody className="pt-4">
            {q.isLoading && <Skeleton className="h-40 w-full" />}
            {d && !d.devices.length && (
              <EmptyState icon={<MonitorSmartphone />} title="Nenhum dispositivo disponível">
                {d.reason ?? "O roteador não retornou clientes."}
              </EmptyState>
            )}
            {d && d.devices.length > 0 && (
              <ul className="divide-y divide-border/60 sm:hidden" aria-label="Clientes conectados">
                {d.devices.map((dev, i) => (
                  <li key={i} className="space-y-1 py-2.5 text-xs text-fg-muted">
                    <p className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-sm text-fg">{dev.name ?? <span className="text-fg-subtle">sem nome</span>}</span>
                      <span className="shrink-0 font-mono">{dev.ip ?? "—"}</span>
                    </p>
                    <p>
                      {dev.interface ?? "interface —"} · <span className="tabular">{dev.signal_dbm != null ? `${dev.signal_dbm} dBm` : "sinal —"}</span>
                    </p>
                    <p>
                      conectado há <span className="tabular">{fmtDuration(dev.connected_s)}</span> · ↓ <span className="tabular">{dev.rx_bytes != null ? fmtBytesStr(dev.rx_bytes) : "—"}</span> / ↑{" "}
                      <span className="tabular">{dev.tx_bytes != null ? fmtBytesStr(dev.tx_bytes) : "—"}</span>
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {d && d.devices.length > 0 && (
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full min-w-[680px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      {["Nome", "IP", "MAC", "Interface", "Sinal", "Conectado há", "Recebido", "Enviado"].map((h) => (
                        <th key={h} className="ol-label py-2 pr-3 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {d.devices.map((dev, i) => (
                      <tr key={i} className="border-b border-border/60 last:border-b-0">
                        <td className="py-2.5 pr-3 text-fg">{dev.name ?? <span className="text-fg-subtle">sem nome</span>}</td>
                        <td className="py-2.5 pr-3 font-mono text-xs">{dev.ip ?? "—"}</td>
                        <td className="py-2.5 pr-3 font-mono text-xs">{dev.mac ?? "—"}</td>
                        <td className="py-2.5 pr-3">{dev.interface ?? "—"}</td>
                        <td className="tabular py-2.5 pr-3">{dev.signal_dbm != null ? `${dev.signal_dbm} dBm` : "—"}</td>
                        <td className="tabular py-2.5 pr-3">{fmtDuration(dev.connected_s)}</td>
                        <td className="tabular py-2.5 pr-3">{dev.rx_bytes != null ? fmtBytesStr(dev.rx_bytes) : "—"}</td>
                        <td className="tabular py-2.5">{dev.tx_bytes != null ? fmtBytesStr(dev.tx_bytes) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      </section>

      <Callout tone="neutral" icon={<ShieldAlert />} title="Controles de rede">
        Bloqueio, priorização, QoS e limites de banda ficam desabilitados: o ASTRYON só os habilitaria com uma API documentada e autenticada do roteador real.
        Adaptadores para OpenWrt/MikroTik estão previstos como integrações opcionais futuras.
      </Callout>
    </>
  );
}
