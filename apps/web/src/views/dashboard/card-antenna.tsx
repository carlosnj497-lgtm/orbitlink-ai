"use client";

import type { AgentInfo, Capability, StatusResponse } from "@astryon/shared";
import { RadioTower } from "lucide-react";
import { SourceBadge } from "@/components/domain";
import { Card, CardBody, CardHeader, Skeleton } from "@/components/ui/primitives";
import { useAgent } from "@/lib/api";
import { fmtAgo, fmtPct } from "@/lib/format";
import { num, type RowState, StatusRow } from "./parts";

/* ================================================================= Status da antena */
export function AntennaCard({ status, agent, className }: { status: StatusResponse | undefined; agent: AgentInfo | undefined; className?: string }) {
  const caps = useAgent<{ capabilities: Capability[] }>("capabilities", { refetchInterval: 60_000 });
  const st = status?.available ? status.status : null;
  const m = st?.metrics;
  const obstructed = m?.currently_obstructed?.value;
  const obstPct = num(m?.obstruction_pct?.value);
  const gps = m?.gps_valid?.value;
  const router = (caps.data?.capabilities ?? []).filter((c) => c.device === "router");
  const routerState: [RowState, string] = !caps.data
    ? ["unknown", "Verificando"]
    : !router.length
      ? ["unknown", "Não consultado"]
      : router.some((c) => c.available)
        ? ["ok", "API acessível"]
        : router.every((c) => c.status === "inalcancavel" || c.status === "timeout")
          ? ["fail", "Inacessível"]
          : ["unknown", "Sem suporte"];
  const link: [RowState, string] = !status
    ? ["unknown", "Carregando"]
    : !st
      ? [status.dish_reachable === false ? "fail" : "unknown", status.dish_reachable === false ? "Sem comunicação" : "Sem dados"]
      : st.state === "conectada"
        ? ["ok", "Normal"]
        : st.state === "offline"
          ? ["fail", "Offline"]
          : st.state === "desconhecida"
            ? ["unknown", "Desconhecido"]
            : ["warn", st.state === "degradada" ? "Degradada" : st.state === "buscando" ? "Buscando" : "Inicializando"];
  return (
    <Card className={className}>
      <CardHeader title="Status da Antena" icon={<RadioTower />} actions={status && <SourceBadge source={st ? (st.origin === "grpc" ? "real" : "demonstracao") : "indisponivel"} />} />
      <CardBody>
        {!status ? (
          <Skeleton className="h-52 w-full" />
        ) : (
          <>
            <ul className="divide-y divide-border">
              <StatusRow state={link[0]} label="Conexão via satélite" value={link[1]} />
              <StatusRow
                state={!st || obstructed === undefined ? "unknown" : obstructed ? "warn" : "ok"}
                label="Obstruções"
                value={
                  !st || obstructed === undefined ? (
                    "Não informado"
                  ) : (
                    <span className="flex flex-col items-end leading-tight">
                      <span>{obstructed ? "Obstruída agora" : "Livre agora"}</span>
                      {obstPct !== null && <span className="tabular text-[11px] font-normal text-fg-muted">{fmtPct(obstPct, 1)} do tempo obstruído</span>}
                    </span>
                  )
                }
              />
              <StatusRow state={!st ? "unknown" : st.alerts.length ? "warn" : "ok"} label="Alertas da antena" value={!st ? "Não informado" : st.alerts.length ? st.alerts.join(", ") : "Nenhum"} />
              {gps !== undefined && <StatusRow state={gps ? "ok" : "warn"} label="GPS" value={gps ? "Válido" : "Sem posição"} />}
              <StatusRow state={st?.device.software_version ? "ok" : "unknown"} label="Firmware" value={st?.device.software_version ?? agent?.firmware ?? "Não identificado"} plain />
              <StatusRow state={routerState[0]} label="Roteador Starlink" value={routerState[1]} />
              <StatusRow
                state={!st ? (status.dish_reachable === false ? "fail" : "unknown") : status.available && status.stale ? "warn" : "ok"}
                label="Última comunicação"
                value={agent?.last_status_ts ? fmtAgo(agent.last_status_ts) : "nunca"}
                plain
              />
            </ul>
            <p className="mt-2 text-[11px] leading-snug text-fg-subtle">Temperatura e modo de energia não são informados pela API local; superaquecimento aparece em “Alertas da antena”.</p>
          </>
        )}
      </CardBody>
    </Card>
  );
}
