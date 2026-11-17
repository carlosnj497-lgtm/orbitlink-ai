---
version: 1
slug: "src-views-esp32-tsx"
primary_target: "src/views/esp32.tsx"
related_targets: ["src/views/antenna-parts/system-diagram.tsx"]
---

# Centro ESP32

Scope: tela ESP32 (Operate). Mantém o aviso de segurança elétrica e o fluxo de pareamento.

## Direction contract

THESIS: o ESP32 é um sensor opcional pendurado na antena; o diagrama mostra se está pareado e com sinal, e a tela lista os módulos e o pareamento.

OWN-WORLD: identidade do DESIGN.md: preto, grafite, fio 1px, cantos 6px; números em JetBrains Mono tabular; verde/amarelo/vermelho só para estado (luzes das peças); azul para seleção (peça da tela atual) e enlace vivo (fio contínuo azul); fio tracejado = sem comunicação; o diagrama é o único painel em foco (ol-glow + retícula + régua). Pictogramas desenhados à mão em SVG de traço 1.5.

STORY: diagrama com ESP32 destacado; segurança elétrica logo abaixo; módulos pareados (luz online/sem heartbeat, switch, remover com confirmação, leituras com origem sensor ESP32) ao lado de Parear (código de uso único).

FIRST VIEWPORT: diagrama, aviso de segurança elétrica, módulos e pareamento.

FORM: seed: none (pinned). Palavras do dono: "Diagrama do equipamento — No topo, um desenho esquemático do sistema (antena → roteador → aparelhos, com ESP32) em que cada peça mostra a leitura ao vivo e leva à seção dela. Mais visual e próprio do produto." Assinatura: o diagrama compartilhado (src/views/antenna-parts/system-diagram.tsx) com céu → antena → roteador → aparelhos, ESP32 pendurado na antena como sensor e Controle embaixo; vertical no celular (tronco à esquerda), horizontal a partir de md. Peça destacada: ESP32.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
