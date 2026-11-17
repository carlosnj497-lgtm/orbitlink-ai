"use client";

import { useMutation } from "@tanstack/react-query";
import { PlayCircle, Wrench } from "lucide-react";
import { type ReactNode } from "react";
import { CAP_META, PageHeader } from "@/components/domain";
import { Badge, Button, Callout, Skeleton } from "@/components/ui/primitives";
import { api, ApiError, useAgent } from "@/lib/api";
import { useDemo } from "@/lib/demo-context";
import { fmtFull } from "@/lib/format";
import type { AgentInfo, CapStatus } from "@astryon/shared";
import { CheckDetails, Checklist, ChecklistItem, type CheckState, StateCounts, VerdictPanel } from "./diagnostics-parts/checklist";

interface Probe { target: string; reachable: boolean; latency_ms: number | null; error: string | null }
interface Report {
  generated_at: string;
  mode: string;
  network: { platform: string; default_gateways: string[]; routes: { destination: string; interface: string | null; next_hop: string | null }[]; probes: Probe[]; guidance: string[] } | null;
  dish: { reachable: boolean; capabilities: { key: string; label: string; status: CapStatus; detail: string | null }[]; status?: { state: string; device: { hardware_version: string | null; software_version: string | null }; fields_missing: string[] } };
  router: { reachable: boolean | null; capabilities?: { key: string; label: string; status: CapStatus }[] };
  summary: { verdict: string; verified: string[] };
}

interface Check {
  key: string;
  title: string;
  optional?: boolean;
  state: CheckState;
  stateLabel?: string;
  summary: ReactNode;
  what: string;
  evidence?: ReactNode;
  todo?: ReactNode;
}

const Code = ({ children }: { children: ReactNode }) => <code className="rounded-[3px] bg-bg-elev px-1 py-px font-mono text-[12px] text-fg">{children}</code>;

const HOW_TO = (
  <>
    Conecte este computador à rede da Starlink Mini (Wi-Fi dela ou roteador em bypass com rota para 192.168.100.1) e clique em Executar diagnóstico. Pelo terminal: <Code>scripts\diagnose.ps1</Code>.
  </>
);

/** Frase do veredito: "5 de 7 verificações passaram; o roteador não foi consultado." */
function verdictOf(checks: Check[]) {
  const n = (s: CheckState) => checks.filter((c) => c.state === s).length;
  const ok = n("ok");
  const failed = checks.filter((c) => c.state === "crit");
  const pending = n("pending");
  const skipped = checks.filter((c) => c.state === "off");
  const parts: string[] = [];
  if (failed.length === 1) parts.push(`falhou: ${failed[0].title.toLowerCase()}`);
  else if (failed.length > 1) parts.push(`${failed.length} falharam`);
  if (pending) parts.push(pending === 1 ? "1 aguarda o diagnóstico" : `${pending} aguardam o diagnóstico`);
  if (skipped.length === 1) parts.push(`${skipped[0].key === "router" ? "o roteador não foi encontrado" : `${skipped[0].title.toLowerCase()} está desligada`}`);
  else if (skipped.length > 1) parts.push(`${skipped.length} opcionais estão desligadas`);
  const head = `${ok} de ${checks.length} verificações passaram`;
  return parts.length ? `${head}; ${parts.slice(0, 2).join(" e ")}.` : `${head}.`;
}

export default function SetupView() {
  const demo = useDemo();
  const agent = useAgent<AgentInfo>("agent");
  const run = useMutation({ mutationFn: () => api<Report>("diagnose", { method: "POST" }) });
  const r = run.data;
  const a = agent.data;
  const dishTarget = a?.dish_target ?? "192.168.100.1:9200";
  const probe = (t: string) => r?.network?.probes.find((p) => p.target === t);
  const dishProbe = r && probe(dishTarget);
  const routerProbe = r && probe(a?.router_target ?? "192.168.1.1:9000");
  const dishCap = (key: string) => r?.dish.capabilities.find((c) => c.key === key);
  const verified = (key: string) => !!r?.summary.verified.includes(key);
  const capLine = (key: string) => {
    const c = dishCap(key);
    return c ? (
      <>
        <Badge tone={CAP_META[c.status]?.tone}>{CAP_META[c.status]?.label ?? c.status}</Badge>
        {c.detail && <span className="ml-2">{c.detail}</span>}
      </>
    ) : null;
  };

  const checks: Check[] = [
    {
      key: "agent",
      title: "Agente local em execução",
      state: agent.isLoading ? "pending" : a ? "ok" : "crit",
      stateLabel: agent.isLoading ? "lendo" : undefined,
      summary: a ? <>Versão <span className="tabular">{a.version}</span> · modo {a.mode}</> : agent.isLoading ? "Consultando o agente…" : "O painel não conseguiu falar com o agente.",
      what: "O programa que conversa com a antena e guarda as medições. Sem ele, nada mais funciona.",
      evidence: a ? <>Iniciado há {Math.round((a.now - a.started_at) / 60)} min · última leitura da antena há <span className="tabular">{a.status_age_s ?? "—"}</span> s</> : agent.error ? (agent.error as Error).message : null,
      todo: a ? "Nada a fazer." : <>Inicie o agente (serviço <Code>astryon-agent</Code>; no Windows, <Code>scripts\start.ps1</Code>).</>,
    },
    {
      key: "dish",
      title: "Antena alcançável na rede",
      state: !r ? "pending" : dishProbe?.reachable ? "ok" : "crit",
      summary: !r ? <>Endereço <span className="tabular">{dishTarget}</span>. Execute o diagnóstico para testar.</> : dishProbe?.reachable ? <>Respondeu em <span className="tabular">{dishProbe.latency_ms} ms</span> ({dishTarget}).</> : (dishProbe?.error ?? "Sem resposta da antena."),
      what: "Se este computador alcança a antena pela rede local (porta gRPC 9200).",
      evidence: dishProbe ? `Sonda em ${dishProbe.target}: ${dishProbe.reachable ? "respondeu" : (dishProbe.error ?? "sem resposta")}` : null,
      todo: !r || dishProbe?.reachable ? null : HOW_TO,
    },
    {
      key: "status",
      title: "Leitura do estado da antena",
      state: !r ? "pending" : verified("dish.status") ? "ok" : "crit",
      summary: !r ? "Pedido get_status por gRPC." : verified("dish.status") ? <>A antena respondeu ao get_status{r.dish.status ? ` (estado: ${r.dish.status.state})` : ""}.</> : "A antena não respondeu ao get_status.",
      what: "A leitura principal: estado, sinal, obstrução e tráfego atuais.",
      evidence: capLine("dish.status"),
      todo: !r || verified("dish.status") ? null : "Se a antena responde na rede mas não a esta leitura, o firmware pode ter mudado. Confira a matriz de capacidades abaixo.",
    },
    {
      key: "history",
      title: "Leitura do histórico da antena",
      state: !r ? "pending" : verified("dish.history") ? "ok" : "crit",
      summary: !r ? "Pedido get_history por gRPC." : verified("dish.history") ? "A antena entregou o histórico recente (latência e perda segundo a segundo)." : "A antena não entregou o histórico.",
      what: "O histórico recente que a antena guarda; é dele que saem latência e perda por segundo.",
      evidence: capLine("dish.history"),
      todo: !r || verified("dish.history") ? null : "Sem o histórico, latência e perda ficam indisponíveis. Confira a matriz de capacidades abaixo.",
    },
    {
      key: "router",
      title: "Roteador Starlink",
      optional: true,
      state: !r ? "pending" : routerProbe?.reachable ? "ok" : "off",
      stateLabel: r && !routerProbe?.reachable ? "não encontrado" : undefined,
      summary: !r ? "Execute o diagnóstico para procurar o roteador." : routerProbe?.reachable ? <>Respondeu em <span className="tabular">{routerProbe.latency_ms} ms</span>.</> : "Não encontrado — normal se usar roteador próprio ou bypass.",
      what: "O roteador original da Starlink, que informa dispositivos e Wi-Fi. É opcional.",
      evidence: routerProbe ? `Sonda em ${routerProbe.target}: ${routerProbe.reachable ? "respondeu" : (routerProbe.error ?? "sem resposta")}` : null,
      todo: r && !routerProbe?.reachable ? "Nada, se você usa outro roteador. A tela de Dispositivos fica sem dados do roteador." : null,
    },
    {
      key: "supabase",
      title: "Sincronização com Supabase",
      optional: true,
      state: !a ? "pending" : a.supabase_configured ? "ok" : "off",
      stateLabel: a && !a.supabase_configured ? "desligada" : undefined,
      summary: !a ? "—" : a.supabase_configured ? "Configurado: as medições também vão para a nuvem." : "Não configurado — o agente funciona só localmente.",
      what: "Cópia opcional das medições na nuvem, para ver o painel fora de casa.",
      todo: a && !a.supabase_configured ? "Nada é obrigatório. Para ligar, veja Configurações → Nuvem." : null,
    },
    {
      key: "ai",
      title: "Assistente de IA via Groq",
      optional: true,
      state: !a ? "pending" : a.ai_configured ? "ok" : "off",
      stateLabel: a && !a.ai_configured ? "desligada" : undefined,
      summary: !a ? "—" : a.ai_configured ? "Chave configurada: a Central de IA responde com a Groq." : "Sem chave — diagnóstico por regras.",
      what: "Respostas em texto livre na Central de IA. Sem a chave, as respostas vêm das regras do agente.",
      todo: a && !a.ai_configured ? "Opcional. Para ligar, cadastre a chave da Groq em Configurações → IA." : null,
    },
  ];

  const count = (s: CheckState) => checks.filter((c) => c.state === s).length;
  const verdictState: CheckState = count("crit") ? "crit" : count("pending") ? "pending" : "ok";
  const allCaps = r ? [...r.dish.capabilities, ...(r.router.capabilities ?? [])] : [];

  return (
    <>
      <PageHeader title="Teste de conexão" icon={<Wrench />} description="Verifica o ambiente, a rede e a antena real, e mostra a matriz de suporte detectada. Somente leitura: nada na sua rede é alterado." />

      <VerdictPanel
        state={agent.isLoading ? "loading" : verdictState}
        sentence={agent.isLoading ? <Skeleton className="h-6 w-72 max-w-full" /> : verdictOf(checks)}
        actions={
          <Button variant="primary" onClick={() => run.mutate()} loading={run.isPending} disabled={demo}>
            {!run.isPending && <PlayCircle />} {r ? "Executar de novo" : "Executar diagnóstico"}
          </Button>
        }
        counts={
          <StateCounts
            items={[
              { state: "ok", n: count("ok"), word: count("ok") === 1 ? "passou" : "passaram", always: true },
              { state: "crit", n: count("crit"), word: count("crit") === 1 ? "falhou" : "falharam" },
              { state: "pending", n: count("pending"), word: "aguardando" },
              { state: "off", n: count("off"), word: count("off") === 1 ? "opcional desligada" : "opcionais desligadas" },
            ]}
          />
        }
        meta={
          r ? (
            <span>
              Diagnóstico em <span className="tabular">{fmtFull(Date.parse(r.generated_at) / 1000)}</span> · resultado: {r.summary.verdict}
              {r.dish.status && <> · hardware {r.dish.status.device.hardware_version ?? "?"} · firmware {r.dish.status.device.software_version ?? "?"}</>}
            </span>
          ) : demo ? (
            <span>O diagnóstico não roda na demonstração.</span>
          ) : null
        }
      >
        {r ? (r.summary.verdict === "antena acessível" ? "A antena respondeu às leituras essenciais." : "Algo entre este computador e a antena não respondeu. Abra os itens com falha para ver o que fazer.") : "Os itens da antena e do roteador só são testados quando você executa o diagnóstico."}
      </VerdictPanel>

      {run.error && (
        <Callout tone="crit" className="mb-4">
          {(run.error as ApiError).message}
        </Callout>
      )}

      <div className="grid grid-cols-1 gap-x-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0">
          <Checklist title="Verificações" description="Abra um item para ver o que ele testa, a evidência e o que fazer.">
            {checks.map((c) => (
              <ChecklistItem key={c.key} state={c.state} stateLabel={c.stateLabel} title={c.title} summary={c.summary} tags={c.optional && <Badge>opcional</Badge>}>
                <CheckDetails
                  rows={[
                    { label: "O que testa", value: c.what },
                    { label: "Evidência", value: c.evidence },
                    { label: "O que fazer", value: c.todo },
                  ]}
                />
              </ChecklistItem>
            ))}
          </Checklist>

          {r && allCaps.length > 0 && (
            <Checklist title="Matriz de capacidades detectada" description="O que este firmware oferece, leitura por leitura.">
              {allCaps.map((c) => (
                <li key={c.key} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <span className="min-w-0 truncate text-fg-muted">{c.label}</span>
                  <Badge tone={CAP_META[c.status]?.tone}>{CAP_META[c.status]?.label ?? c.status}</Badge>
                </li>
              ))}
              {r.dish.status && r.dish.status.fields_missing.length > 0 && <li className="px-4 py-2.5 text-xs text-fg-subtle">Campos ausentes neste firmware: {r.dish.status.fields_missing.join(", ")}</li>}
            </Checklist>
          )}
        </div>

        <aside className="space-y-4">
          <Callout tone="info" title="Como validar na sua rede">
            {HOW_TO}
          </Callout>
          {r?.network && r.network.guidance.length > 0 && (
            <div className="ol-card px-4 py-3.5">
              <h2 className="font-display text-sm font-semibold text-fg">Orientação</h2>
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-fg-muted">
                {r.network.guidance.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </div>
          )}
          {r?.network && (
            <div className="ol-card px-4 py-3.5 text-sm text-fg-muted">
              <h2 className="font-display text-sm font-semibold text-fg">Rede local</h2>
              <p className="mt-2">
                Plataforma: {r.network.platform} · Gateway: <span className="tabular">{r.network.default_gateways.join(", ") || "—"}</span>
              </p>
              {r.network.routes.map((rt) => (
                <p key={rt.destination} className="mt-1 break-all font-mono text-xs">
                  {rt.destination} → {rt.interface ?? "?"} via {rt.next_hop ?? "?"}
                </p>
              ))}
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
