"use client";

import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, CircleDashed, PlayCircle, Wrench, XCircle } from "lucide-react";
import { CAP_META, PageHeader } from "@/components/domain";
import { Badge, Button, Callout, Card, CardBody, CardHeader } from "@/components/ui/primitives";
import { api, ApiError, useAgent } from "@/lib/api";
import { useDemo } from "@/lib/demo-context";
import type { AgentInfo, CapStatus } from "@astryon/shared";

interface Probe { target: string; reachable: boolean; latency_ms: number | null; error: string | null }
interface Report {
  generated_at: string;
  mode: string;
  network: { platform: string; default_gateways: string[]; routes: { destination: string; interface: string | null; next_hop: string | null }[]; probes: Probe[]; guidance: string[] } | null;
  dish: { reachable: boolean; capabilities: { key: string; label: string; status: CapStatus; detail: string | null }[]; status?: { state: string; device: { hardware_version: string | null; software_version: string | null }; fields_missing: string[] } };
  router: { reachable: boolean | null; capabilities?: { key: string; label: string; status: CapStatus }[] };
  summary: { verdict: string; verified: string[] };
}

function Step({ ok, title, children }: { ok: boolean | null; title: string; children?: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      {ok === null ? <CircleDashed className="mt-0.5 size-5 shrink-0 text-fg-subtle" /> : ok ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-ok" /> : <XCircle className="mt-0.5 size-5 shrink-0 text-crit" />}
      <div className="min-w-0 text-sm"><p className="font-medium">{title}</p>{children && <div className="mt-0.5 text-fg-muted">{children}</div>}</div>
    </li>
  );
}

export default function SetupView() {
  const demo = useDemo();
  const agent = useAgent<AgentInfo>("agent");
  const run = useMutation({ mutationFn: () => api<Report>("diagnose", { method: "POST" }) });
  const r = run.data;
  const probe = (t: string) => r?.network?.probes.find((p) => p.target === t);
  const dishProbe = r && probe(agent.data?.dish_target ?? "192.168.100.1:9200");
  const routerProbe = r && probe(agent.data?.router_target ?? "192.168.1.1:9000");

  return (
    <>
      <PageHeader title="Teste de Conexão" icon={<Wrench />} description="Verifica o ambiente, a rede e a antena real, e mostra a matriz de suporte detectada. Somente leitura: nada na sua rede é alterado." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Checklist" />
          <CardBody>
            <ol className="space-y-3">
              <Step ok={!!agent.data} title="Agente local em execução">{agent.data ? `v${agent.data.version} · modo ${agent.data.mode}` : "Execute scripts\\start.ps1"}</Step>
              <Step ok={r ? !!dishProbe?.reachable : null} title="Antena alcançável (192.168.100.1:9200)">{dishProbe ? (dishProbe.reachable ? `${dishProbe.latency_ms} ms` : dishProbe.error) : "Execute o diagnóstico"}</Step>
              <Step ok={r ? r.summary.verified.includes("dish.status") : null} title="Leitura gRPC (get_status)" />
              <Step ok={r ? r.summary.verified.includes("dish.history") : null} title="Histórico (get_history)" />
              <Step ok={r ? (routerProbe?.reachable ?? false) : null} title="Roteador Starlink (opcional)">{routerProbe && !routerProbe.reachable ? "Não encontrado — normal se usar roteador próprio ou bypass." : null}</Step>
              <Step ok={agent.data ? agent.data.supabase_configured : null} title="Supabase (opcional)">{agent.data && !agent.data.supabase_configured ? "Não configurado — o agente funciona só localmente." : null}</Step>
              <Step ok={agent.data ? agent.data.ai_configured : null} title="Assistente IA via Groq (opcional)">{agent.data && !agent.data.ai_configured ? "Sem chave — diagnóstico por regras." : null}</Step>
            </ol>
            <Button className="mt-5" variant="primary" onClick={() => run.mutate()} loading={run.isPending} disabled={demo}>
              <PlayCircle /> Executar diagnóstico
            </Button>
            {run.error && <Callout tone="crit" className="mt-3">{(run.error as ApiError).message}</Callout>}
          </CardBody>
        </Card>
        <div className="space-y-4 lg:col-span-2">
          {!r && (
            <Callout tone="info" title="Como validar na sua rede">
              Conecte este computador à rede da Starlink Mini (Wi-Fi dela ou roteador em bypass com rota para 192.168.100.1) e clique em Executar diagnóstico. Pelo terminal: <code className="font-mono">scripts\diagnose.ps1</code>.
            </Callout>
          )}
          {r && (
            <>
              <Callout tone={r.summary.verdict === "antena acessível" ? "ok" : "warn"} title={`Resultado: ${r.summary.verdict}`}>
                Diagnóstico em {new Date(r.generated_at).toLocaleString("pt-BR", { timeZone: "America/Fortaleza" })}
                {r.dish.status && ` · hardware ${r.dish.status.device.hardware_version ?? "?"} · firmware ${r.dish.status.device.software_version ?? "?"}`}
              </Callout>
              {r.network && r.network.guidance.length > 0 && (
                <Card>
                  <CardHeader title="Orientação" />
                  <CardBody><ul className="list-disc space-y-1.5 pl-5 text-sm text-fg-muted">{r.network.guidance.map((g) => <li key={g}>{g}</li>)}</ul></CardBody>
                </Card>
              )}
              <Card>
                <CardHeader title="Matriz de capacidades detectada" />
                <CardBody>
                  <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {[...r.dish.capabilities, ...(r.router.capabilities ?? [])].map((c) => (
                      <li key={c.key} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-1.5 text-sm">
                        <span className="truncate">{c.label}</span>
                        <Badge tone={CAP_META[c.status]?.tone}>{CAP_META[c.status]?.label ?? c.status}</Badge>
                      </li>
                    ))}
                  </ul>
                  {r.dish.status && r.dish.status.fields_missing.length > 0 && <p className="mt-3 text-xs text-fg-subtle">Campos ausentes neste firmware: {r.dish.status.fields_missing.join(", ")}</p>}
                </CardBody>
              </Card>
              {r.network && (
                <Card>
                  <CardHeader title="Rede local" />
                  <CardBody className="text-sm text-fg-muted">
                    <p>Plataforma: {r.network.platform} · Gateway: {r.network.default_gateways.join(", ") || "—"}</p>
                    {r.network.routes.map((rt) => <p key={rt.destination} className="font-mono text-xs">{rt.destination} → {rt.interface ?? "?"} via {rt.next_hop ?? "?"}</p>)}
                  </CardBody>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
