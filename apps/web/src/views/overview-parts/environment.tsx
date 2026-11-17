"use client";

import type { AgentInfo, ServerHealth, WeatherStatus } from "@astryon/shared";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { SourceBadge } from "@/components/domain";
import { hrefOf } from "@/components/shell/nav";
import { WeatherGlyph } from "@/components/weather";
import { Card, CardBody, CardHeader, Skeleton } from "@/components/ui/primitives";
import { type ApiError, useAgent } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useBasePath, useDemo } from "@/lib/demo-context";
import { fmtAgo, fmtNumber } from "@/lib/format";
import { describeWeather, RAIN_META } from "@/lib/weather";

/**
 * Itens secundários do Dashboard, em tamanho menor no fim da tela: clima regional e a saúde dos serviços
 * (mesmas regras de estado do antigo cartão "Serviços e Integrações").
 */
type SvcState = "ok" | "warn" | "fail" | "unknown";
const DOT: Record<SvcState, string> = { ok: "bg-ok", warn: "bg-warn", fail: "bg-crit", unknown: "border border-fg-subtle" };
const TEXT: Record<SvcState, string> = { ok: "text-fg-muted", warn: "text-warn", fail: "text-crit", unknown: "text-fg-subtle" };

function Row({ name, state, label, detail }: { name: string; state: SvcState; label: string; detail?: string }) {
  return (
    <li className="flex items-baseline gap-2.5 py-1.5 text-sm">
      <span className={cn("size-2 shrink-0 translate-y-[-1px] rounded-full", DOT[state])} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="text-fg">{name}</span>
        {detail && <span className="block truncate text-[11px] text-fg-subtle">{detail}</span>}
      </span>
      <span className={cn("shrink-0 text-xs", TEXT[state])}>{label}</span>
    </li>
  );
}

function WeatherLine() {
  const base = useBasePath();
  const demo = useDemo();
  const st = useAgent<WeatherStatus>("weather", { refetchInterval: 5 * 60_000 });
  const d = st.data;
  const c = d?.current;
  if (st.error) return <p className="text-xs text-fg-subtle">Clima indisponível agora.</p>;
  if (!d) return <Skeleton className="h-10 w-full" />;
  if (!d.configured)
    return (
      <p className="text-xs text-fg-muted">
        Clima não configurado.{" "}
        <Link href={`${hrefOf(base, "configuracoes")}#clima`} className="font-medium text-accent hover:underline">
          Escolher cidade
        </Link>
      </p>
    );
  if (!c) return <p className="text-xs text-fg-muted">{d.last_error ? `A última busca do clima falhou (${d.last_error}).` : "Aguardando a primeira busca do clima."}</p>;
  const desc = describeWeather(c.weather_code, c.is_day ?? true);
  return (
    <div className="flex items-start gap-3">
      <WeatherGlyph code={c.weather_code} isDay={c.is_day ?? true} className="mt-0.5 size-5 shrink-0 stroke-[1.5] text-fg-muted" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="text-fg">
          <span className="tabular">{c.temperature_c === null ? "—" : `${fmtNumber(c.temperature_c, 0)} °C`}</span> · {desc.label}
        </p>
        {d.location && <p className="truncate text-[11px] text-fg-subtle">{d.location.name}</p>}
        <p className="mt-0.5 text-[11px] text-fg-subtle">
          Chuva <span className="tabular">{c.precipitation_mm === null ? "—" : `${fmtNumber(c.precipitation_mm, 1)} mm/h`}</span>
          {c.rain_level && c.rain_level !== "sem_chuva" && <span className="text-fg-muted"> ({RAIN_META[c.rain_level].label}, pode coincidir com oscilação)</span>} · estimativa regional {fmtAgo(c.fetched_at)}
          {c.stale ? ", desatualizada" : ""}, não é sensor no local
        </p>
      </div>
      <SourceBadge source={demo ? "demonstracao" : "estimada"} />
    </div>
  );
}

export function EnvironmentCard({ agent, agentError, className }: { agent: AgentInfo | undefined; agentError: ApiError | null; className?: string }) {
  const base = useBasePath();
  const esp = useAgent<{ enabled?: boolean; nodes?: { online: boolean }[] }>("esp32/nodes", { refetchInterval: 15_000 });
  const srv = useAgent<ServerHealth>("ops/health", { refetchInterval: 60_000 });
  const loops = Object.entries(agent?.loops ?? {});
  const failing = loops.filter(([, l]) => l.consecutive_failures > 0);
  const syncFail = failing.some(([k]) => k.includes("sync"));
  const nodes = esp.data?.nodes ?? [];
  const online = nodes.filter((n) => n.online).length;
  const off: [SvcState, string] = ["unknown", "sem dados"];
  const agentSvc: [SvcState, string] = agentError ? ["fail", "offline"] : agent ? ["ok", "online"] : ["unknown", "verificando"];
  const dish: [SvcState, string] = !agent ? off : agent.dish_reachable ? ["ok", "acessível"] : agent.dish_reachable === false ? ["fail", "inacessível"] : ["unknown", "verificando"];
  const supa: [SvcState, string] = !agent ? off : !agent.supabase_configured ? ["unknown", "não configurado"] : syncFail ? ["fail", "erro de sincronização"] : agent.sync_pending > 0 ? ["warn", `${fmtNumber(agent.sync_pending, 0)} pendentes`] : ["ok", "sincronizado"];
  const espSvc: [SvcState, string] = !esp.data ? off : !esp.data.enabled ? ["unknown", "não configurado"] : !nodes.length ? ["unknown", "nenhum nó pareado"] : online ? ["ok", `${online} de ${nodes.length} online`] : ["warn", "nós offline"];
  const sh = srv.data;
  const srvSvc: [SvcState, string] = !sh
    ? off
    : sh.disk.free_pct !== null && sh.disk.free_pct < 10
      ? ["warn", "pouco disco livre"]
      : sh.cpu_temp_c !== null && sh.cpu_temp_c >= 85
        ? ["warn", "temperatura alta"]
        : ["ok", "saudável"];
  const srvDetail = sh
    ? [sh.cpu_temp_c !== null ? `${fmtNumber(sh.cpu_temp_c, 0)} °C` : null, sh.disk.free_pct !== null ? `${fmtNumber(sh.disk.free_pct, 0)}% livre` : null, sh.last_backup_at ? `backup ${fmtAgo(sh.last_backup_at)}` : "sem backup ainda"].filter(Boolean).join(" · ")
    : undefined;

  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader
        title="Clima e serviços"
        actions={
          <Link href={hrefOf(base, "diagnosticos")} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
            Diagnóstico <ArrowRight className="size-3" aria-hidden />
          </Link>
        }
      />
      <CardBody className="flex flex-1 flex-col gap-3">
        <WeatherLine />
        <ul className="divide-y divide-border/60 border-t border-border pt-1">
          <Row name="Agente local" detail={agent ? `v${agent.version}${agent.mode === "fixture" ? " · fixture" : ""}` : undefined} state={agentSvc[0]} label={agentSvc[1]} />
          <Row name="API da antena" detail={agent?.dish_target ?? undefined} state={dish[0]} label={dish[1]} />
          <Row name="Servidor" detail={srvDetail} state={srvSvc[0]} label={srvSvc[1]} />
          <Row name="Supabase" state={supa[0]} label={supa[1]} />
          <Row name="ESP32" state={espSvc[0]} label={espSvc[1]} />
        </ul>
        {agent && (
          <p className="mt-auto text-[11px] leading-snug text-fg-subtle">
            Coleta: <span className="tabular">{fmtNumber(agent.history_lost_total, 0)}</span> amostra(s) perdida(s)
            {failing.length > 0 && <span className="text-warn"> · falhando: {failing.map(([k, l]) => `${k} (${l.last_error_kind ?? "erro"})`).join(", ")}</span>}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
