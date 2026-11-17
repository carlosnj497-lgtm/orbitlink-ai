---
version: 1
slug: "src-views-reports-tsx"
primary_target: "src/views/reports.tsx"
related_targets: ["src/views/diagnostics-parts/checklist.tsx"]
---

# Relatórios

Scope: tela de Relatórios (Operate). Visitante: o dono exportando dados do período. Restrições: rotas reports/export e reports/telegram inalteradas; desabilitado na demonstração.

## Direction contract

THESIS: antes de baixar, o dono sabe se o período tem dados: o veredito diz o que está pronto e de quando são os dados (cobertura, início e fim, última leitura); cada exportação é um item com estado de disponibilidade (dados suficientes / parciais / sem dados) e a ação de baixar na mesma linha. Recusa três cards iguais de ícone + texto + botão.

OWN-WORLD: identidade do DESIGN.md; disponibilidade em verde/amarelo/cinza; botão primário azul de missão; datas em mono tabular; veredito como painel em foco.

STORY: escolhe o período, lê o veredito, baixa o PDF/CSV/JSON ou envia ao Telegram; abre o item para ver conteúdo, lacunas e observações; o envio automático do ciclo aparece como item com estado do Telegram.

FIRST VIEWPORT: período (24h/7d/30d/90d); veredito com contagem prontas/parciais/sem medições e intervalo dos dados; checklist "Exportações" com quatro itens.

FORM: seed: none (pinned) — "Checklist com veredito — Cada ferramenta abre com o resultado numa frase e segue como checklist (passou / atenção / falhou / pulado), cada item expansível. A Central de IA fica como conversa, com as mesmas cores de estado.". Assinatura: coluna de ações alinhada e estado de disponibilidade calculado da cobertura real (quality?range).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
