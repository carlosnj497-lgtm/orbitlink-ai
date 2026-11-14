"use client";

import { MonitorSmartphone, RefreshCw, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { CAP_META, PageHeader, QueryError, SourceBadge } from "@/components/domain";
import { Badge, Button, Callout, Card, CardBody, CardHeader, EmptyState, Skeleton } from "@/components/ui/primitives";
import { useAgent } from "@/lib/api";
import { fmtBytesStr, fmtDuration } from "@/lib/format";
import type { CapStatus, Source } from "@orbitlink/shared";

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
      {q.error && <QueryError error={q.error} />}
      <Callout tone="neutral" icon={<ShieldAlert />} title="Controles de rede" className="mb-4">
        Bloqueio, priorização, QoS e limites de banda ficam desabilitados: o ASTRYON só os habilitaria com uma API documentada e autenticada do roteador real.
        Adaptadores para OpenWrt/MikroTik estão previstos como integrações opcionais futuras.
      </Callout>
      <Card>
        <CardHeader
          title="Clientes conectados"
          actions={
            d && (
              <>
                {d.capability && <Badge tone={CAP_META[d.capability.status].tone}>{CAP_META[d.capability.status].label}</Badge>}
                <SourceBadge source={d.source} />
              </>
            )
          }
          subtitle={d?.note}
        />
        <CardBody>
          {q.isLoading && <Skeleton className="h-40 w-full" />}
          {d && !d.devices.length && (
            <EmptyState icon={<MonitorSmartphone />} title="Nenhum dispositivo disponível">
              {d.reason ?? "O roteador não retornou clientes."}
            </EmptyState>
          )}
          {d && d.devices.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead className="text-left text-xs text-fg-subtle">
                  <tr className="border-b border-border">
                    {["Nome", "IP", "MAC", "Interface", "Sinal", "Conectado há", "Recebido", "Enviado"].map((h) => (
                      <th key={h} className="py-2 pr-3 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.devices.map((dev, i) => (
                    <tr key={i} className="border-b border-border/60">
                      <td className="py-2 pr-3">{dev.name ?? <span className="text-fg-subtle">sem nome</span>}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{dev.ip ?? "—"}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{dev.mac ?? "—"}</td>
                      <td className="py-2 pr-3">{dev.interface ?? "—"}</td>
                      <td className="py-2 pr-3 tabular">{dev.signal_dbm != null ? `${dev.signal_dbm} dBm` : "—"}</td>
                      <td className="py-2 pr-3 tabular">{fmtDuration(dev.connected_s)}</td>
                      <td className="py-2 pr-3 tabular">{dev.rx_bytes != null ? fmtBytesStr(dev.rx_bytes) : "—"}</td>
                      <td className="py-2 tabular">{dev.tx_bytes != null ? fmtBytesStr(dev.tx_bytes) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </>
  );
}
