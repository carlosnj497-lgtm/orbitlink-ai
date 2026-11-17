---
version: 1
slug: "src-views-quality-tsx"
primary_target: "src/views/quality.tsx"
related_targets: ["src/views/quality-parts/quality-verdict.tsx"]
---

# Qualidade da Conexão

Scope: tela Qualidade (src/views/quality.tsx). Mode: Operate. Visitante: o dono da Starlink Mini, no PC e no celular. Grupo Conexão (Dashboard, Ao vivo, Qualidade, Consumo, Eventos) compartilha o painel de veredito em `src/views/overview-parts/verdict.tsx`.

## Direction contract

THESIS: Qualidade responde 'a conexão é estável e quando piora?' com a nota do período e as horas de perda alta agrupadas em faixas. Recusa a grade de cards iguais de métrica no topo e o número solto sem frase que diga o que ele significa.

OWN-WORLD: identidade do DESIGN.md: preto, grafite, fio 1px, cantos 6px; números em JetBrains Mono tabular dentro das frases; verde/amarelo/vermelho só na luz de estado e em valores fora do normal; azul para seleção e dado vivo; hachura prata para demonstração e lacunas. Um único painel em foco (ol-card ol-glow ol-hud) por tela: o veredito, com régua técnica no rodapé.

STORY: O dono lê se o período foi estável/instável/ruim e em que horário piora, confere disponibilidade, perda, latência p50/p95 e jitter, e vê a prova no mapa de perda por hora logo abaixo, depois as séries com faixas de chuva e a comparação com o período anterior.

FIRST VIEWPORT: Seletor de período no cabeçalho; veredito com cinco números; mapa 'Quando piora' de 24 horas em largura total.

FORM: seed: none (pinned) — "Veredito + evidências — Cada página abre respondendo a sua pergunta numa frase com os números ('Sua conexão nas últimas 24 h: boa, 99,4% no ar, latência 31 ms') num painel em destaque; os gráficos vêm abaixo como prova. Menos cards iguais, hierarquia clara." Assinatura: o painel de veredito (frase em Space Grotesk com números mono, luz de estado com palavra, faixa de 3–5 números-chave separados por fio de 1px, régua técnica e origem do dado no rodapé). Contorno vermelho só para hora com perda de 2% ou mais.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
