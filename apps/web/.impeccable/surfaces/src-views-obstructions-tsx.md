---
version: 1
slug: "src-views-obstructions-tsx"
primary_target: "src/views/obstructions.tsx"
related_targets: ["src/views/antenna-parts/system-diagram.tsx"]
---

# Obstruções

Scope: tela Obstruções (Operate).

## Direction contract

THESIS: o céu é a primeira peça do enlace; o mapa do céu é o elemento principal logo abaixo do diagrama, com a estatística de agora ao lado. Recusa a fileira de cartões métricos acima do mapa e a lista de barras como tendência.

OWN-WORLD: identidade do DESIGN.md: preto, grafite, fio 1px, cantos 6px; números em JetBrains Mono tabular; verde/amarelo/vermelho só para estado (luzes das peças); azul para seleção (peça da tela atual) e enlace vivo (fio contínuo azul); fio tracejado = sem comunicação; o diagrama é o único painel em foco (ol-glow + retícula + régua). Pictogramas desenhados à mão em SVG de traço 1.5.

STORY: diagrama com o Céu destacado; mapa do céu grande + Agora (tempo obstruído, obstruída agora, capacidade do mapa); tendência por hora em colunas com limite de 5% e horas sem dado tracejadas, valores hora a hora num detalhe recolhido; aviso de correlação com link para Interrupções.

FIRST VIEWPORT: diagrama e o início do mapa do céu.

FORM: seed: none (pinned). Palavras do dono: "Diagrama do equipamento — No topo, um desenho esquemático do sistema (antena → roteador → aparelhos, com ESP32) em que cada peça mostra a leitura ao vivo e leva à seção dela. Mais visual e próprio do produto." Assinatura: o diagrama compartilhado (src/views/antenna-parts/system-diagram.tsx) com céu → antena → roteador → aparelhos, ESP32 pendurado na antena como sensor e Controle embaixo; vertical no celular (tronco à esquerda), horizontal a partir de md. Peça destacada: Céu.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
