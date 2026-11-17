---
version: 1
slug: "src-views-alerts-tsx"
primary_target: "src/views/alerts.tsx"
related_targets: ["src/views/alerts-parts/rule-row.tsx","src/views/alerts-parts/rule-editor.tsx"]
---

# Alertas e Automações

Scope: tela de Alertas (Operate). Visitante: o dono, conferindo se algo está disparando e ajustando regras. Respostas: equilíbrio entre "o que está disparando" e "regras"; editor em frases simples com avançado recolhido. Mudança no agente autorizada pela escolha: /v1/alerts/rules expõe current {value, measured_at} e breaching_since por regra.

## Direction contract

THESIS: cada regra é uma frase legível com o valor de agora medido contra o limite; você vê o quão perto cada uma está de disparar. Recusa a lista de regras com parâmetros técnicos soltos (janela, cooldown, histerese) e o formulário em modal.

OWN-WORLD: identidade do DESIGN.md: preto, grafite, fio 1px, cantos 6px; números em JetBrains Mono tabular; verde/amarelo/vermelho só para estado; azul para a leitura viva (ponto do medidor) e seleção; alerta ativo como painel em foco (ol-glow + retícula).

STORY: o dono vê no topo se há alerta ativo e reconhece; desce pelas regras lendo frases com medidor; cria ou edita no lugar a partir de modelos prontos; canais, resumo e histórico ficam embaixo.

FIRST VIEWPORT: cabeçalho com "Nova regra"; faixa "N alertas ativos agora" (painel em foco) ou linha calma "Nenhum alerta ativo"; lista "Regras · X de Y ligadas" com cada regra: switch, nome, gravidade, frase, medidor valor x limite, linha de estado (disparou, dispara em, sem leitura, desligada) e ações.

FORM: regras como frases vivas, posição 5 da lista; seed:ee9229082c9db8e6. Assinatura: o medidor por regra com a zona de disparo pintada na cor da gravidade e o ponto da leitura atual.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
