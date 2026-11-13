"use client";

import { useMutation } from "@tanstack/react-query";
import { Bot, Send, ShieldCheck, User } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/domain";
import { Badge, Button, Callout, Card, CardBody, Input } from "@/components/ui/primitives";
import { api, ApiError, useAgent } from "@/lib/api";
import { useBasePath, useDemo } from "@/lib/demo-context";

interface AskResponse {
  conversation_id: number;
  answer: string;
  engine: "claude" | "regras";
  model?: string;
  tools_used: string[];
  proposal: { proposta: { acao: string; descricao: string; consequencias: string[] }; disponivel: boolean; status_capacidade: string } | null;
  usage?: { input_tokens: number; output_tokens: number; estimated_cost_usd: number | null };
}
interface Msg {
  role: "user" | "assistant";
  text: string;
  meta?: AskResponse;
}

const SUGGESTIONS = [
  "Como está minha Starlink agora?",
  "Quanto de internet usei hoje e como esse valor foi calculado?",
  "Minha internet ficou ruim ontem à noite?",
  "Quais horários apresentam mais perda de pacotes?",
  "O problema está no Wi-Fi ou na conexão satelital?",
  "Meu ESP32 detectou queda de alimentação?",
  "Quero reiniciar a antena.",
];

/** Renderização mínima e segura de markdown (negrito, itálico, listas) sem HTML bruto. */
function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-1.5 text-sm leading-relaxed">
      {text.split("\n").map((line, i) => {
        const parts = line.split(/(\*\*[^*]+\*\*|_[^_]+_)/g).map((p, j) =>
          p.startsWith("**") ? <strong key={j}>{p.slice(2, -2)}</strong> : p.startsWith("_") && p.endsWith("_") && p.length > 2 ? <em key={j} className="text-fg-muted">{p.slice(1, -1)}</em> : p,
        );
        if (/^\s*[-*] /.test(line)) return <p key={i} className="pl-4 -indent-3">• {parts.map((x) => (typeof x === "string" ? x.replace(/^\s*[-*] /, "") : x))}</p>;
        return line.trim() ? <p key={i}>{parts}</p> : <div key={i} className="h-1" />;
      })}
    </div>
  );
}

export default function AssistantView() {
  const demo = useDemo();
  const base = useBasePath();
  const status = useAgent<{ configured: boolean; model: string; daily_limit: number; usage: { day: string; requests: number }[] }>("ai/status");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [conv, setConv] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const ask = useMutation({
    mutationFn: (question: string) => api<AskResponse>("ai/ask", { method: "POST", body: JSON.stringify({ question, conversation_id: conv }) }),
    onSuccess: (r) => {
      setConv(r.conversation_id);
      setMsgs((m) => [...m, { role: "assistant", text: r.answer, meta: r }]);
    },
    onError: (e: ApiError) => setMsgs((m) => [...m, { role: "assistant", text: `⚠ ${e.message}` }]),
  });
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [msgs, ask.isPending]);

  function send(text: string) {
    const t = text.trim();
    if (!t || ask.isPending || demo) return;
    setMsgs((m) => [...m, { role: "user", text: t }]);
    setQ("");
    ask.mutate(t);
  }
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(q);
  };
  const today = status.data?.usage?.[0];

  return (
    <>
      <PageHeader
        title="Assistente Claude AI"
        icon={<Bot />}
        description="Perguntas em português sobre a sua conexão, respondidas apenas com dados registrados pelo agente — com período, fonte e incerteza."
        actions={
          status.data && (
            <>
              <Badge tone={status.data.configured ? "accent" : "neutral"}>{status.data.configured ? `Claude · ${status.data.model}` : "Somente regras (sem chave de API)"}</Badge>
              {status.data.configured && <Badge>{today?.requests ?? 0}/{status.data.daily_limit} hoje</Badge>}
            </>
          )
        }
      />
      <Callout tone="info" icon={<ShieldCheck />} className="mb-4">
        O assistente só lê dados. Pedidos de ação geram uma proposta; a execução exige sua confirmação na tela de Controle. Conversas ficam apenas neste computador e expiram automaticamente.
      </Callout>
      {demo && <Callout tone="demo" className="mb-4">O assistente não responde na demonstração.</Callout>}
      <Card className="flex min-h-[460px] flex-col">
        <CardBody className="flex-1 space-y-4 overflow-y-auto pt-4">
          {msgs.length === 0 && (
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => send(s)} disabled={demo} className="rounded-full border border-border-strong bg-surface-2 px-3 py-1.5 text-xs text-fg-muted hover:border-accent/40 hover:text-fg disabled:opacity-50">
                  {s}
                </button>
              ))}
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`flex gap-3 ${m.role === "user" ? "justify-end" : ""}`}>
              {m.role === "assistant" && <span className="mt-1 rounded-full bg-accent-soft p-1.5 text-accent"><Bot className="size-4" /></span>}
              <div className={`max-w-[85%] rounded-xl px-4 py-3 ${m.role === "user" ? "bg-accent/15 text-fg" : "border border-border bg-bg-elev/70"}`}>
                {m.role === "assistant" ? <Markdown text={m.text} /> : <p className="text-sm">{m.text}</p>}
                {m.meta?.proposal && (
                  <div className="mt-3 rounded-lg border border-warn/30 bg-warn-soft p-3 text-sm">
                    <p className="font-medium">Proposta: {m.meta.proposal.proposta.descricao}</p>
                    <p className="text-xs text-fg-muted">{m.meta.proposal.disponivel ? "Disponível para confirmação manual." : `Indisponível (${m.meta.proposal.status_capacidade}).`} Nada foi executado.</p>
                    <Link href={`${base}/controle`} className="mt-2 inline-block text-xs text-accent hover:underline">Abrir Controle da Starlink →</Link>
                  </div>
                )}
                {m.meta && (
                  <p className="mt-2 text-[11px] text-fg-subtle">
                    {m.meta.engine === "claude" ? `Claude (${m.meta.model})` : "Regras determinísticas"}
                    {m.meta.tools_used.length > 0 && ` · consultas: ${Array.from(new Set(m.meta.tools_used)).join(", ")}`}
                    {m.meta.usage?.estimated_cost_usd != null && ` · custo estimado US$ ${m.meta.usage.estimated_cost_usd.toFixed(4)}`}
                  </p>
                )}
              </div>
              {m.role === "user" && <span className="mt-1 rounded-full bg-surface-3 p-1.5 text-fg-muted"><User className="size-4" /></span>}
            </div>
          ))}
          {ask.isPending && <p className="animate-pulse text-sm text-fg-subtle">Consultando dados do agente…</p>}
          <div ref={end} />
        </CardBody>
        <form onSubmit={onSubmit} className="flex gap-2 border-t border-border p-3">
          <label htmlFor="ask" className="sr-only">Pergunta</label>
          <Input id="ask" placeholder="Pergunte sobre a sua conexão…" value={q} onChange={(e) => setQ(e.target.value)} maxLength={2000} disabled={demo} />
          <Button type="submit" variant="primary" loading={ask.isPending} disabled={!q.trim() || demo}>
            <Send /> Enviar
          </Button>
        </form>
      </Card>
    </>
  );
}
