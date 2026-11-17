---
version: 1
slug: "src-views-outages-tsx"
primary_target: "src/views/outages.tsx"
related_targets: ["src/views/outages-parts/outages-verdict.tsx"]
---

# Eventos

Scope: tela Eventos (src/views/outages.tsx). Mode: Operate. Visitante: o dono da Starlink Mini, no PC e no celular. Grupo Conexão (Dashboard, Ao vivo, Qualidade, Consumo, Eventos) compartilha o painel de veredito em `src/views/overview-parts/verdict.tsx`.

## Direction contract

THESIS: Eventos responde 'quando caiu, quanto tempo e por quê?': quedas contadas sem misturar 'antena inacessível' (falha local), causa mais frequente com o grau de confirmação. Recusa a grade de cards iguais de métrica no topo e o número solto sem frase que diga o que ele significa.

OWN-WORLD: identidade do DESIGN.md: preto, grafite, fio 1px, cantos 6px; números em JetBrains Mono tabular dentro das frases; verde/amarelo/vermelho só na luz de estado e em valores fora do normal; azul para seleção e dado vivo; hachura prata para demonstração e lacunas. Um único painel em foco (ol-card ol-glow ol-hud) por tela: o veredito, com régua técnica no rodapé.

STORY: O dono lê quantas quedas, quanto tempo fora, quando foi a última e a causa; confere a cronologia por tipo com lacunas hachuradas, a lista 'Por que caiu' com tempo por causa e, por fim, o registro com evidências e clima na hora.

FIRST VIEWPORT: Filtro de tipo, período e CSV no cabeçalho; veredito com cinco números; cronologia ao lado das causas.

FORM: seed: none (pinned) — "Veredito + evidências — Cada página abre respondendo a sua pergunta numa frase com os números ('Sua conexão nas últimas 24 h: boa, 99,4% no ar, latência 31 ms') num painel em destaque; os gráficos vêm abaixo como prova. Menos cards iguais, hierarquia clara." Assinatura: o painel de veredito (frase em Space Grotesk com números mono, luz de estado com palavra, faixa de 3–5 números-chave separados por fio de 1px, régua técnica e origem do dado no rodapé). Lacunas de observação hachuradas na cronologia; correlação com chuva nunca vira causa.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
