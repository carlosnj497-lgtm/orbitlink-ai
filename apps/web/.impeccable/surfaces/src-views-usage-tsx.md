---
version: 1
slug: "src-views-usage-tsx"
primary_target: "src/views/usage.tsx"
related_targets: ["src/views/usage-parts/plan-meter.tsx","src/views/usage-parts/usage-verdict.tsx"]
---

# Consumo de Internet

Scope: tela Consumo (src/views/usage.tsx). Mode: Operate. Visitante: o dono da Starlink Mini, no PC e no celular. Grupo Conexão (Dashboard, Ao vivo, Qualidade, Consumo, Eventos) compartilha o painel de veredito em `src/views/overview-parts/verdict.tsx`.

## Direction contract

THESIS: Consumo responde 'quanto usei e vou estourar a franquia?' com o medidor da franquia e a projeção dentro do veredito. Recusa a grade de cards iguais de métrica no topo e o número solto sem frase que diga o que ele significa.

OWN-WORLD: identidade do DESIGN.md: preto, grafite, fio 1px, cantos 6px; números em JetBrains Mono tabular dentro das frases; verde/amarelo/vermelho só na luz de estado e em valores fora do normal; azul para seleção e dado vivo; hachura prata para demonstração e lacunas. Um único painel em foco (ol-card ol-glow ol-hud) por tela: o veredito, com régua técnica no rodapé.

STORY: O dono lê quanto usou (pelo menos X quando há lacunas) e se deve estourar, vê o medidor com consumo, trecho tracejado da projeção e réguas de 80%/100%, e os números hoje, quanto cabe por dia até a virada, mês e projeção; abaixo, consumo por período (hora/dia/mês), quando mais usa, tabela de janelas e importação de CSV.

FIRST VIEWPORT: Veredito com medidor da franquia (ou convite a configurar) e faixa de quatro números; gráfico por período com agrupamento ao lado do perfil por hora.

FORM: seed: none (pinned) — "Veredito + evidências — Cada página abre respondendo a sua pergunta numa frase com os números ('Sua conexão nas últimas 24 h: boa, 99,4% no ar, latência 31 ms') num painel em destaque; os gráficos vêm abaixo como prova. Menos cards iguais, hierarquia clara." Assinatura: o painel de veredito (frase em Space Grotesk com números mono, luz de estado com palavra, faixa de 3–5 números-chave separados por fio de 1px, régua técnica e origem do dado no rodapé). O método de cálculo e o aviso de estimativa ficam no rodapé do veredito.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
