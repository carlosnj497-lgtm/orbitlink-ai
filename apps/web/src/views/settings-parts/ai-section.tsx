"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PlugZap, Save, Sparkles } from "lucide-react";
import { useState } from "react";
import { QueryError } from "@/components/domain";
import { Badge, Button, Callout, Input, Label, Skeleton, Switch } from "@/components/ui/primitives";
import { api, type ApiError, useAgent } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useDemo } from "@/lib/demo-context";
import { fmtDay, fmtNumber, localDayKey, usageForToday } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { type AiStatus, ManageLink, type ModuleState, Num, Row, Section, type SettingsData } from "./shared";

type DayUsage = { day: string; requests: number };
type TestResult = { ok: boolean; detail: string; latency_ms: number | null; model_available: boolean | null };

/* ----------------------------------------------------------------- Central de IA */
export function AiSection({ d }: { d: SettingsData }) {
  const ai = useAgent<AiStatus>("ai/status", { refetchInterval: 60_000 });
  const clock = useNow(60_000);
  const s = ai.data;
  const used = usageForToday(s?.usage, clock)?.requests ?? 0;
  const pct = s && s.daily_limit > 0 ? (used / s.daily_limit) * 100 : 0;
  const state: ModuleState = !s ? (ai.error ? "warn" : "loading") : !s.configured ? "off" : pct >= 100 ? "crit" : pct >= 80 ? "warn" : "ok";
  return (
    <Section
      id="ia"
      title="Central de IA"
      icon={Sparkles}
      state={state}
      stateLabel={s && !s.configured ? "só regras" : pct >= 100 ? "limite atingido" : undefined}
      value={
        !s ? (
          "—"
        ) : s.configured ? (
          <>
            <Num>{`${fmtNumber(used, 0)} / ${fmtNumber(s.daily_limit, 0)}`}</Num>{" "}
            hoje
          </>
        ) : (
          "Diagnóstico por regras"
        )
      }
      detail={!s ? undefined : s.configured ? `Groq · ${s.model}` : "Defina a chave da Groq para ativar o assistente"}
      description="O assistente consulta os dados da antena e do painel, mas nunca altera nada. Sem a chave da Groq, ele usa o diagnóstico automático por regras."
      actions={<ManageLink slug="assistente">Abrir Central de IA</ManageLink>}
    >
      {ai.error && <QueryError error={ai.error} />}
      {!ai.data && !ai.error ? <Skeleton className="h-48 w-full" /> : ai.data ? <AiBody s={ai.data} d={d} /> : null}
    </Section>
  );
}

function AiBody({ s, d }: { s: AiStatus; d: SettingsData }) {
  const clock = useNow(60_000);
  const audio = s.audio;
  const audioUsage = audio?.usage;
  const today = usageForToday(s.usage, clock)?.requests ?? 0;
  const audioToday = usageForToday(audioUsage, clock)?.requests ?? 0;

  return (
    <div className="space-y-5">
      <EngineBlock s={s} d={d} />

      {/* ---------------------------------------------------- Uso de hoje + últimos 7 dias */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <UsageCard title="Perguntas hoje" used={today} limit={s.daily_limit} unit="perguntas" history={s.usage} now={clock} />
        {audio?.enabled ? (
          <UsageCard title="Notas de voz hoje" used={audioToday} limit={audio.daily_limit} unit="áudios" history={audioUsage} now={clock} />
        ) : (
          <div className="rounded-md border border-dashed border-border px-3 py-3 text-sm text-fg-muted">
            <p className="ol-label">Notas de voz</p>
            <p className="mt-1.5">{s.configured ? "Transcrição desligada. Ligue em Ajustes abaixo para o bot do Telegram entender áudios." : "Precisa da chave da Groq para transcrever áudios."}</p>
          </div>
        )}
      </div>

      {audio?.enabled && !audio.telegram && (
        <Callout tone="warn">A transcrição está ligada, mas o bot do Telegram não está configurado. Por isso, as notas de voz ainda não são usadas.</Callout>
      )}

      <AiSettingsForm s={s} d={d} />

      {/* ---------------------------------------------------- Detalhes técnicos */}
      <details className="group rounded-md border border-border px-3 py-2 text-xs text-fg-muted">
        <summary className="cursor-pointer select-none py-1 text-fg-muted hover:text-fg">Detalhes técnicos (variáveis de ambiente)</summary>
        <dl className="mt-2">
          <Row showEnv label="Chave da Groq" env="ASTRYON_GROQ_API_KEY" value={s.configured ? "definida" : "ausente"} />
          <Row showEnv label="Modelo de texto" env="ASTRYON_AI_MODEL" value={s.model || "—"} />
          <Row showEnv label="Limite diário de perguntas" env="ASTRYON_AI_DAILY_REQUEST_LIMIT" value="valor inicial; o painel pode sobrescrever" />
          <Row showEnv label="Dias para guardar conversas" env="ASTRYON_AI_CONVERSATION_RETENTION_DAYS" value="valor inicial; o painel pode sobrescrever" />
          <Row showEnv label="Transcrição de áudio" env="ASTRYON_AI_TRANSCRIBE_ENABLED" value="valor inicial; o painel pode sobrescrever" />
          <Row showEnv label="Limite diário de áudios" env="ASTRYON_AI_AUDIO_DAILY_REQUEST_LIMIT" value="valor inicial; o painel pode sobrescrever" />
          <Row showEnv label="Modelo de transcrição" env="ASTRYON_AI_TRANSCRIBE_MODEL" value={audio?.model || "—"} />
        </dl>
        <p className="mt-2 text-[11px] text-fg-subtle">Ajustes feitos no painel ficam salvos no agente e prevalecem sobre o arquivo de ambiente, inclusive depois de reiniciar.</p>
      </details>
    </div>
  );
}

/* ----------------------------------------------------------------- Motor + teste de conexão */
function EngineBlock({ s, d }: { s: AiStatus; d: SettingsData }) {
  const demo = useDemo();
  const test = useMutation<TestResult, ApiError>({ mutationFn: () => api<TestResult>("ai/test", { method: "POST" }) });
  const r = test.data;
  return (
    <div className="rounded-md border border-border bg-bg-elev/60 px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="ol-label">Motor</p>
          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-fg">
            {s.configured ? (
              <>
                <Badge tone={r ? (r.ok ? "ok" : "crit") : "accent"}>{r ? (r.ok ? "Groq · conectado" : "Groq · com problema") : "Groq · chave definida"}</Badge>
                <span className="font-mono text-xs text-fg-muted">{s.model}</span>
              </>
            ) : (
              <>
                <Badge tone="neutral">Somente regras</Badge>
                <span className="text-fg-muted">sem IA generativa</span>
              </>
            )}
          </p>
        </div>
        {s.configured && (
          <Button size="sm" variant="ghost" onClick={() => test.mutate()} loading={test.isPending} disabled={demo}>
            <PlugZap /> Testar conexão
          </Button>
        )}
      </div>
      {!s.configured && (
        <p className="mt-2 text-xs text-fg-muted">
          Para ativar, crie uma chave gratuita em <span className="font-mono">console.groq.com</span>, defina <span className="font-mono">ASTRYON_GROQ_API_KEY</span> no arquivo de ambiente do agente e reinicie. Modelo que será usado: <span className="font-mono">{String(d.ai_model ?? s.model ?? "—")}</span>.
        </p>
      )}
      {r && (
        <Callout tone={r.ok ? "ok" : "crit"} className="mt-3">
          {r.detail}
          {r.latency_ms !== null && <span className="text-fg-muted"> Tempo de resposta: {fmtNumber(r.latency_ms, 0)} ms.</span>}
        </Callout>
      )}
      {test.error && (
        <Callout tone="crit" className="mt-3">
          {test.error.message}
        </Callout>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- Uso (barra + 7 dias) */
function UsageCard({ title, used, limit, unit, history, now }: { title: string; used: number; limit: number; unit: string; history?: DayUsage[]; now: number | null }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const tone = limit <= 0 ? "neutral" : pct >= 100 ? "crit" : pct >= 80 ? "warn" : "ok";
  const left = Math.max(0, limit - used);
  const bar = { neutral: "bg-fg-subtle", ok: "bg-ok", warn: "bg-warn", crit: "bg-crit" }[tone];
  const days = now === null ? [] : Array.from({ length: 7 }, (_, i) => {
    const t = now - (6 - i) * 86400;
    const key = localDayKey(t);
    return { t, key, n: history?.find((h) => h.day === key)?.requests ?? 0 };
  });
  const peak = Math.max(limit, ...days.map((x) => x.n), 1);

  return (
    <div className="rounded-md border border-border bg-bg-elev/60 px-3 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="ol-label">{title}</p>
        <p className="tabular text-sm text-fg">
          {fmtNumber(used, 0)} <span className="text-fg-muted">/ {limit > 0 ? fmtNumber(limit, 0) : "sem limite"}</span>
        </p>
      </div>
      <div
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
        role="progressbar"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={used}
      >
        <div className={cn("h-full rounded-full transition-[width]", bar)} style={{ width: `${pct}%` }} />
      </div>
      <p className={cn("mt-1.5 text-[11px]", tone === "crit" ? "text-crit" : tone === "warn" ? "text-warn" : "text-fg-subtle")}>
        {limit <= 0 ? "Sem limite diário configurado." : pct >= 100 ? `Limite atingido. Volta a responder à meia-noite.` : `${fmtNumber(left, 0)} ${unit} restantes · o contador zera à meia-noite.`}
      </p>

      {days.length > 0 && (
        <div className="mt-3">
          <div className="flex h-10 items-end gap-1" role="img" aria-label={`Últimos 7 dias: ${days.map((x) => `${fmtDay(x.t)} ${x.n}`).join(", ")}`}>
            {days.map((x, i) => (
              <div key={x.key} className="flex h-full flex-1 items-end" title={`${fmtDay(x.t)}: ${fmtNumber(x.n, 0)} ${unit}`}>
                <div
                  className={cn("w-full rounded-sm", i === 6 ? bar : "bg-accent/35", x.n === 0 && "bg-surface-3")}
                  style={{ height: `${Math.max(6, (x.n / peak) * 100)}%` }}
                />
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-fg-subtle">
            <span>7 dias atrás</span>
            <span>hoje</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- Ajustes que valem na hora */
function AiSettingsForm({ s, d }: { s: AiStatus; d: SettingsData }) {
  const demo = useDemo();
  const qc = useQueryClient();
  const initial = {
    limit: String(s.daily_limit ?? ""),
    retention: String(s.retention_days ?? d.ai_conversation_retention_days ?? ""),
    audioLimit: String(s.audio?.daily_limit ?? ""),
    audioOn: Boolean(d.ai_transcribe_enabled ?? s.audio?.enabled ?? false),
  };
  const [limit, setLimit] = useState(initial.limit);
  const [retention, setRetention] = useState(initial.retention);
  const [audioLimit, setAudioLimit] = useState(initial.audioLimit);
  const [audioOn, setAudioOn] = useState(initial.audioOn);

  const intIn = (v: string, lo: number, hi: number) => /^\d+$/.test(v) && Number(v) >= lo && Number(v) <= hi;
  const limitOk = intIn(limit, 1, 10000);
  const retentionOk = intIn(retention, 1, 3650);
  const audioOk = intIn(audioLimit, 0, 500);
  const dirty = limit !== initial.limit || retention !== initial.retention || audioLimit !== initial.audioLimit || audioOn !== initial.audioOn;

  const save = useMutation<unknown, ApiError>({
    mutationFn: () =>
      api("settings", {
        method: "PUT",
        body: JSON.stringify({
          ai_daily_request_limit: Number(limit),
          ai_conversation_retention_days: Number(retention),
          ai_audio_daily_request_limit: Number(audioLimit),
          ai_transcribe_enabled: audioOn,
        }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent"] }),
  });

  function discard() {
    setLimit(initial.limit);
    setRetention(initial.retention);
    setAudioLimit(initial.audioLimit);
    setAudioOn(initial.audioOn);
    save.reset();
  }

  return (
    <div>
      <p className="ol-label mb-2">Ajustes · valem na hora, sem reiniciar</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="ai-lim">Perguntas por dia</Label>
          <Input id="ai-lim" type="number" min={1} max={10000} value={limit} onChange={(e) => setLimit(e.target.value)} aria-invalid={!limitOk} disabled={demo} />
          <p className={cn("text-[11px]", limitOk ? "text-fg-subtle" : "text-crit")}>{limitOk ? "Somando painel e Telegram." : "Use um número de 1 a 10.000."}</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="ai-ret">Guardar conversas por (dias)</Label>
          <Input id="ai-ret" type="number" min={1} max={3650} value={retention} onChange={(e) => setRetention(e.target.value)} aria-invalid={!retentionOk} disabled={demo} />
          <p className={cn("text-[11px]", retentionOk ? "text-fg-subtle" : "text-crit")}>{retentionOk ? "Conversas mais antigas são apagadas." : "Use um número de 1 a 3.650."}</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="ai-alim">Notas de voz por dia</Label>
          <Input id="ai-alim" type="number" min={0} max={500} value={audioLimit} onChange={(e) => setAudioLimit(e.target.value)} aria-invalid={!audioOk} disabled={demo || !audioOn} />
          <p className={cn("text-[11px]", audioOk ? "text-fg-subtle" : "text-crit")}>{audioOk ? "0 bloqueia todas as transcrições." : "Use um número de 0 a 500."}</p>
        </div>
      </div>
      <label className="mt-4 flex items-start gap-3 rounded-md border border-border bg-bg-elev/60 px-3 py-3 text-sm">
        <Switch label="Transcrever notas de voz do Telegram" checked={audioOn} onCheckedChange={setAudioOn} disabled={demo} />
        <span>
          Transcrever notas de voz do Telegram
          <span className="mt-0.5 block text-xs text-fg-subtle">
            O bot converte o áudio em texto (modelo {s.audio?.model ?? "Whisper"}) e responde como se fosse uma pergunta escrita. Precisa da chave da Groq.
          </span>
        </span>
      </label>
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {dirty && (
          <Button size="sm" variant="ghost" onClick={discard} disabled={save.isPending}>
            Descartar
          </Button>
        )}
        <Button size="sm" variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={demo || !dirty || !limitOk || !retentionOk || !audioOk}>
          <Save /> Salvar ajustes da IA
        </Button>
      </div>
      {save.error && (
        <Callout tone="crit" className="mt-3">
          {save.error.message}
        </Callout>
      )}
      {save.isSuccess && !dirty && (
        <Callout tone="ok" className="mt-3">
          Ajustes da IA salvos.
        </Callout>
      )}
    </div>
  );
}
