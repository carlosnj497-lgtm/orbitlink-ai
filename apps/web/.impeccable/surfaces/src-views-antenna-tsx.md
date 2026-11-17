---
version: 1
slug: "src-views-antenna-tsx"
primary_target: "src/views/antenna.tsx"
related_targets: ["src/views/antenna-parts/system-diagram.tsx","src/views/antenna-parts/section.tsx"]
---

# Antena e Sinal

Scope: tela Antena e Sinal (Operate). Visitante: o dono conferindo se a antena está bem.

## Direction contract

THESIS: a antena é uma peça do sistema: o desenho mostra onde ela está e como está o enlace, e abaixo vem o estado dela antes do histórico. Recusa o hero decorativo com ilustração e os cards de condição com ícones coloridos.

OWN-WORLD: identidade do DESIGN.md: preto, grafite, fio 1px, cantos 6px; números em JetBrains Mono tabular; verde/amarelo/vermelho só para estado (luzes das peças); azul para seleção (peça da tela atual) e enlace vivo (fio contínuo azul); fio tracejado = sem comunicação; o diagrama é o único painel em foco (ol-glow + retícula + régua). Pictogramas desenhados à mão em SVG de traço 1.5.

STORY: diagrama com a Antena destacada; Agora (identificação, KPIs, condições de recepção, saúde e atalhos); Energia ao longo do tempo; Detalhes técnicos.

FIRST VIEWPORT: cabeçalho com Atualizar e Controle da antena; diagrama; seção Agora com o terminal, estado e última leitura.

FORM: seed: none (pinned). Palavras do dono: "Diagrama do equipamento — No topo, um desenho esquemático do sistema (antena → roteador → aparelhos, com ESP32) em que cada peça mostra a leitura ao vivo e leva à seção dela. Mais visual e próprio do produto." Assinatura: o diagrama compartilhado (src/views/antenna-parts/system-diagram.tsx) com céu → antena → roteador → aparelhos, ESP32 pendurado na antena como sensor e Controle embaixo; vertical no celular (tronco à esquerda), horizontal a partir de md. Peça destacada: Antena.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
