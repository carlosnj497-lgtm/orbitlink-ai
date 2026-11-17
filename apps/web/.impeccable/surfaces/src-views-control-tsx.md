---
version: 1
slug: "src-views-control-tsx"
primary_target: "src/views/control.tsx"
related_targets: ["src/views/antenna-parts/system-diagram.tsx"]
---

# Controle da Starlink

Scope: tela Controle (Operate). Ações perigosas mantêm exatamente as mesmas confirmações, capacidades e código de uso único.

## Direction contract

THESIS: o controle é o servidor que observa e comanda o equipamento; o que o firmware permite aparece agrupado por peça (antena, roteador) com luzes de estado. Recusa a tabela larga de capacidades com rolagem horizontal.

OWN-WORLD: identidade do DESIGN.md: preto, grafite, fio 1px, cantos 6px; números em JetBrains Mono tabular; verde/amarelo/vermelho só para estado (luzes das peças); azul para seleção (peça da tela atual) e enlace vivo (fio contínuo azul); fio tracejado = sem comunicação; o diagrama é o único painel em foco (ol-glow + retícula + régua). Pictogramas desenhados à mão em SVG de traço 1.5.

STORY: diagrama com Controle destacado; Agora: política (IA nunca executa), ações com botão de perigo e diálogo de confirmação inalterado, matriz de capacidades por dispositivo; histórico com estados em português e auditoria recolhida.

FIRST VIEWPORT: diagrama, aviso de política e o início de Ações/Matriz.

FORM: seed: none (pinned). Palavras do dono: "Diagrama do equipamento — No topo, um desenho esquemático do sistema (antena → roteador → aparelhos, com ESP32) em que cada peça mostra a leitura ao vivo e leva à seção dela. Mais visual e próprio do produto." Assinatura: o diagrama compartilhado (src/views/antenna-parts/system-diagram.tsx) com céu → antena → roteador → aparelhos, ESP32 pendurado na antena como sensor e Controle embaixo; vertical no celular (tronco à esquerda), horizontal a partir de md. Peça destacada: Controle.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
