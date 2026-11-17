---
version: 1
slug: "src-views-live-tsx"
primary_target: "src/views/live.tsx"
related_targets: ["src/views/live-parts/live-verdict.tsx"]
---

# Monitoramento ao Vivo

Scope: tela Ao vivo (src/views/live.tsx). Mode: Operate. Visitante: o dono da Starlink Mini, no PC e no celular. Grupo Conexão (Dashboard, Ao vivo, Qualidade, Consumo, Eventos) compartilha o painel de veredito em `src/views/overview-parts/verdict.tsx`.

## Direction contract

THESIS: Ao vivo responde 'o que está acontecendo neste momento?' com a leitura mais recente; canal SSE aberto nunca vira antena conectada. Recusa a grade de cards iguais de métrica no topo e o número solto sem frase que diga o que ele significa.

OWN-WORLD: identidade do DESIGN.md: preto, grafite, fio 1px, cantos 6px; números em JetBrains Mono tabular dentro das frases; verde/amarelo/vermelho só na luz de estado e em valores fora do normal; azul para seleção e dado vivo; hachura prata para demonstração e lacunas. Um único painel em foco (ol-card ol-glow ol-hud) por tela: o veredito, com régua técnica no rodapé.

STORY: O dono vê a frase do momento (conectada recebendo X Mbps, perda alta, dados atrasados, antena inacessível, pausado), as quatro leituras com traço da sessão e variação, e o resumo da janela escolhida; desce aos gráficos sincronizados de tráfego, latência e perda e aos eventos da janela.

FIRST VIEWPORT: Barra de controle sem cartão (canal, última leitura, janela 15 min/1 h/6 h, Pausar/Retomar, Exportar CSV); veredito com as quatro leituras ao vivo na faixa; gráfico de tráfego ao lado de Enlace e coleta.

FORM: seed: none (pinned) — "Veredito + evidências — Cada página abre respondendo a sua pergunta numa frase com os números ('Sua conexão nas últimas 24 h: boa, 99,4% no ar, latência 31 ms') num painel em destaque; os gráficos vêm abaixo como prova. Menos cards iguais, hierarquia clara." Assinatura: o painel de veredito (frase em Space Grotesk com números mono, luz de estado com palavra, faixa de 3–5 números-chave separados por fio de 1px, régua técnica e origem do dado no rodapé). Pausar congela veredito, leituras, gráficos e CSV.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
