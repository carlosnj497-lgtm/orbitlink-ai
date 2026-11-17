---
version: 1
slug: "src-views-devices-tsx"
primary_target: "src/views/devices.tsx"
related_targets: ["src/views/antenna-parts/system-diagram.tsx"]
---

# Dispositivos da Rede

Scope: tela Dispositivos (Operate).

## Direction contract

THESIS: roteador e aparelhos são as duas últimas peças da corrente; a tela separa se o roteador respondeu da lista de clientes, sem nunca transformar falta de resposta em zero aparelhos.

OWN-WORLD: identidade do DESIGN.md: preto, grafite, fio 1px, cantos 6px; números em JetBrains Mono tabular; verde/amarelo/vermelho só para estado (luzes das peças); azul para seleção (peça da tela atual) e enlace vivo (fio contínuo azul); fio tracejado = sem comunicação; o diagrama é o único painel em foco (ol-glow + retícula + régua). Pictogramas desenhados à mão em SVG de traço 1.5.

STORY: diagrama com Roteador e Aparelhos destacados (recebe a resposta da consulta forçada); seção Roteador (#roteador: resposta, capacidade, última consulta); Clientes conectados (#aparelhos); aviso de controles de rede desabilitados.

FIRST VIEWPORT: botão Consultar roteador, diagrama e seção Roteador.

FORM: seed: none (pinned). Palavras do dono: "Diagrama do equipamento — No topo, um desenho esquemático do sistema (antena → roteador → aparelhos, com ESP32) em que cada peça mostra a leitura ao vivo e leva à seção dela. Mais visual e próprio do produto." Assinatura: o diagrama compartilhado (src/views/antenna-parts/system-diagram.tsx) com céu → antena → roteador → aparelhos, ESP32 pendurado na antena como sensor e Controle embaixo; vertical no celular (tronco à esquerda), horizontal a partir de md. Peças destacadas: Roteador e Aparelhos.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
