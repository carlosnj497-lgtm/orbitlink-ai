"use client";

import type { ServerHealth } from "@astryon/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Database, HardDrive } from "lucide-react";
import { QueryError } from "@/components/domain";
import { Badge, Button, Callout, Skeleton } from "@/components/ui/primitives";
import { api, ApiError, useAgent } from "@/lib/api";
import { useDemo } from "@/lib/demo-context";
import { fmtAgo, fmtBytesStr, fmtDateTime, fmtNumber } from "@/lib/format";
import { envName, fmtValue, type ModuleState, Num, Row, Section, type SettingsData } from "./shared";

/* ----------------------------------------------------------------- Servidor e backup */
export function ServerSection({ d }: { d: SettingsData }) {
  const demo = useDemo();
  const qc = useQueryClient();
  const h = useAgent<ServerHealth>("ops/health", { refetchInterval: 60_000 });
  const run = useMutation({
    mutationFn: () => api<{ created: string | null; sent_telegram: boolean; backups: string[] }>("ops/backup", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[1] === "ops/health" }),
  });
  const s = h.data;
  const free = s?.disk.free_pct ?? null;
  const hot = s?.cpu_temp_c != null && s.cpu_temp_c >= 80;
  const state: ModuleState = !s ? (h.error ? "warn" : "loading") : free !== null && free < 10 ? "crit" : (free !== null && free < 20) || hot || !s.last_backup_at ? "warn" : "ok";
  const stateLabel = !s ? undefined : free !== null && free < 20 ? "pouco disco" : hot ? "quente" : !s.last_backup_at ? "sem backup" : undefined;
  return (
    <Section
      id="servidor"
      title="Servidor e backup"
      icon={HardDrive}
      state={state}
      stateLabel={stateLabel}
      value={
        !s ? (
          "—"
        ) : s.last_backup_at ? (
          <>
            Backup <Num>{fmtAgo(s.last_backup_at)}</Num>
          </>
        ) : (
          "Nenhum backup ainda"
        )
      }
      detail={!s ? undefined : `Disco ${free === null ? "—" : `${fmtNumber(free, 0)}% livre`} · ${s.cpu_temp_c === null ? "temperatura —" : `${fmtNumber(s.cpu_temp_c, 0)} °C`}`}
      description="A saúde do computador que roda o ASTRYON e as cópias de segurança do banco. Alertas avisam com pouco disco ou temperatura alta."
      actions={
        <Button size="sm" onClick={() => run.mutate()} loading={run.isPending} disabled={demo}>
          <Database /> Fazer backup agora
        </Button>
      }
    >
      {h.error && <QueryError error={h.error} />}
      {!s && !h.error ? (
        <Skeleton className="h-28 w-full" />
      ) : s ? (
        <dl className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
          <Row label="Temperatura do processador" value={s.cpu_temp_c === null ? "não informada" : `${fmtNumber(s.cpu_temp_c, 0)} °C`} />
          <Row label="Disco livre (pasta de dados)" value={s.disk.free_pct === null ? "—" : `${fmtNumber(s.disk.free_pct, 0)}% · ${fmtBytesStr(s.disk.free_bytes ?? 0)}`} />
          <Row label="Tamanho do banco" value={fmtBytesStr(s.db_size_bytes)} />
          <Row label="Memória disponível" value={s.mem_available_pct === null ? "não informada" : `${fmtNumber(s.mem_available_pct, 0)}%`} />
          <Row label="Último backup" env="pasta data/backups" value={s.last_backup_at ? `${fmtDateTime(s.last_backup_at)} (${fmtAgo(s.last_backup_at)})` : "ainda não feito"} />
          <Row label="Cópias guardadas / envio ao Telegram" env={`${envName("backup_keep")} · _TELEGRAM_EVERY_DAYS`} value={`${fmtValue(d.backup_keep)} · ${d.backup_telegram ? `a cada ${fmtValue(d.backup_telegram_every_days, "d")}` : "desligado"}`} />
          <Row label="Vigia externo (healthchecks.io)" env={envName("healthcheck_url")} value={<Badge tone={s.healthcheck_configured ? "accent" : "neutral"}>{s.healthcheck_configured ? "ativo" : "não configurado"}</Badge>} />
          <Row label="Aviso quando o agente volta" env={envName("downtime_notice_min")} value={`após ${fmtValue(d.downtime_notice_min)} min fora do ar`} />
        </dl>
      ) : null}
      {run.data && (
        <Callout tone="ok" className="mt-3">
          {run.data.created ? `Backup ${run.data.created} criado` : "Backup criado"}
          {run.data.sent_telegram ? " e enviado ao seu chat do Telegram." : ". Ficou só na pasta local (Telegram não configurado ou arquivo grande demais)."}
        </Callout>
      )}
      {run.error && <Callout tone="crit" className="mt-3">{(run.error as ApiError).message}</Callout>}
    </Section>
  );
}
