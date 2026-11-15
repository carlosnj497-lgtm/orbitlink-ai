"use client";

import type { AgentInfo, ServerHealth } from "@astryon/shared";
import { Cpu, Database, HardDrive, LayoutDashboard, SatelliteDish, Server } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/primitives";
import { type ApiError, useAgent } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fmtAgo, fmtNumber } from "@/lib/format";
import type { RowState } from "./parts";

/* ================================================================= Serviços e integrações */
const SVC_DOT: Record<RowState, string> = { ok: "bg-ok", warn: "bg-warn", fail: "bg-crit", unknown: "bg-fg-subtle" };
const SVC_TEXT: Record<RowState, string> = { ok: "text-ok", warn: "text-warn", fail: "text-crit", unknown: "text-fg-muted" };

function Service({ icon, name, state, label, detail }: { icon: ReactNode; name: string; state: RowState; label: string; detail?: string }) {
  return (
    <li className="flex items-start gap-3 rounded-md border border-border bg-bg-elev/60 px-3 py-2.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-md border border-border-strong bg-surface text-accent [&>svg]:size-[18px] [&>svg]:stroke-[1.75]">{icon}</span>
      <div className="min-w-0 flex-1 leading-tight">
        <p className="line-clamp-2 text-[13px] font-medium text-fg">{name}</p>
        {detail && <p className="line-clamp-2 text-[11px] text-fg-subtle [overflow-wrap:anywhere]">{detail}</p>}
        <p className={cn("mt-1.5 flex items-center gap-1.5 text-xs font-medium", SVC_TEXT[state])}>
          <span className={cn("size-1.5 rounded-full", SVC_DOT[state], state === "ok" && "ol-live text-ok")} aria-hidden />
          {label}
        </p>
      </div>
    </li>
  );
}

export function ServicesCard({ agent, agentError, className }: { agent: AgentInfo | undefined; agentError: ApiError | null; className?: string }) {
  const esp = useAgent<{ enabled?: boolean; nodes?: { online: boolean }[] }>("esp32/nodes", { refetchInterval: 15_000 });
  const loops = Object.entries(agent?.loops ?? {});
  const failing = loops.filter(([, l]) => l.consecutive_failures > 0);
  const syncFail = failing.some(([k]) => k.includes("sync"));
  const nodes = esp.data?.nodes ?? [];
  const online = nodes.filter((n) => n.online).length;
  const off: [RowState, string] = ["unknown", "Sem dados"];
  const agentSvc: [RowState, string] = agentError ? ["fail", "Offline"] : agent ? ["ok", "Online"] : ["unknown", "Verificando"];
  const supa: [RowState, string] = !agent ? off : !agent.supabase_configured ? ["unknown", "Não configurado"] : syncFail ? ["fail", "Erro de sincronização"] : agent.sync_pending > 0 ? ["warn", `${fmtNumber(agent.sync_pending, 0)} pendentes`] : ["ok", "Sincronizado"];
  const dish: [RowState, string] = !agent ? off : agent.dish_reachable ? ["ok", "Acessível"] : agent.dish_reachable === false ? ["fail", "Inacessível"] : ["unknown", "Verificando"];
  const srv = useAgent<ServerHealth>("ops/health", { refetchInterval: 60_000 });
  const sh = srv.data;
  const srvSvc: [RowState, string] = !sh
    ? off
    : (sh.disk.free_pct !== null && sh.disk.free_pct < 10) || (sh.cpu_temp_c !== null && sh.cpu_temp_c >= 85)
      ? ["warn", sh.disk.free_pct !== null && sh.disk.free_pct < 10 ? "Pouco disco livre" : "Temperatura alta"]
      : ["ok", "Saudável"];
  const srvDetail = sh
    ? [sh.cpu_temp_c !== null ? `${fmtNumber(sh.cpu_temp_c, 0)} °C` : null, sh.disk.free_pct !== null ? `${fmtNumber(sh.disk.free_pct, 0)}% livre` : null, sh.last_backup_at ? `backup ${fmtAgo(sh.last_backup_at)}` : "sem backup ainda"].filter(Boolean).join(" · ")
    : "Temperatura, disco e backup";
  const espSvc: [RowState, string] = !esp.data ? off : !esp.data.enabled ? ["unknown", "Não configurado"] : !nodes.length ? ["unknown", "Nenhum nó pareado"] : online ? ["ok", `${online} de ${nodes.length} online`] : ["warn", "Nós offline"];
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader title="Serviços e Integrações" icon={<Server />} />
      <CardBody className="flex flex-1 flex-col">
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 min-[105rem]:grid-cols-6">
          <Service icon={<Server />} name="Agente local" detail={agent ? `Python/FastAPI · v${agent.version}${agent.mode === "fixture" ? " · fixture" : ""}` : "Python/FastAPI"} state={agentSvc[0]} label={agentSvc[1]} />
          <Service icon={<LayoutDashboard />} name="Dashboard" detail="Next.js · esta página" state="ok" label="Online" />
          <Service icon={<SatelliteDish />} name="Comunicação com a Starlink" detail={agent?.dish_target ? `API local · ${agent.dish_target}` : "API local (gRPC)"} state={dish[0]} label={dish[1]} />
          <Service icon={<Database />} name="Supabase" detail="Sincronização opcional" state={supa[0]} label={supa[1]} />
          <Service icon={<Cpu />} name="ESP32" detail="Sensores opcionais" state={espSvc[0]} label={espSvc[1]} />
          <Service icon={<HardDrive />} name="Servidor" detail={srvDetail} state={srvSvc[0]} label={srvSvc[1]} />
        </ul>
        {agent && (
          <p className="mt-auto pt-3 text-[11px] leading-snug text-fg-subtle">
            Coleta: {fmtNumber(agent.history_lost_total, 0)} amostra(s) perdida(s)
            {failing.length > 0 && <span className="text-warn"> · falhando: {failing.map(([k, l]) => `${k} (${l.last_error_kind ?? "erro"})`).join(", ")}</span>}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
