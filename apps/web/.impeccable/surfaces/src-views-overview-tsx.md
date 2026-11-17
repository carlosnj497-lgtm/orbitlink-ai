---
version: 1
slug: "src-views-overview-tsx"
primary_target: "src/views/overview.tsx"
related_targets: ["src/views/overview-parts/verdict.tsx","src/views/overview-parts/dashboard-verdict.tsx","src/views/overview-parts/environment.tsx"]
---

# Dashboard

Scope: tela inicial (src/views/overview.tsx). Mode: Operate. Visitante: o dono da Starlink Mini, no PC e no celular. Grupo Conexão (Dashboard, Ao vivo, Qualidade, Consumo, Eventos) compartilha o painel de veredito em `src/views/overview-parts/verdict.tsx`.

## Direction contract

THESIS: O Dashboard responde 'minha internet está boa agora e hoje?' numa frase montada do estado real da antena e da nota de 24 h; os cartões abaixo são a prova. Recusa a grade de cards iguais de métrica no topo e o número solto sem frase que diga o que ele significa.

OWN-WORLD: identidade do DESIGN.md: preto, grafite, fio 1px, cantos 6px; números em JetBrains Mono tabular dentro das frases; verde/amarelo/vermelho só na luz de estado e em valores fora do normal; azul para seleção e dado vivo; hachura prata para demonstração e lacunas. Um único painel em foco (ol-card ol-glow ol-hud) por tela: o veredito, com régua técnica no rodapé.

STORY: O dono lê a frase e a luz (Online/Degradada/Offline/Antena inacessível/Atrasado), confere os cinco números (no ar 24 h, latência e perda agora, quedas 24 h, download agora) e desce ao gráfico de desempenho e às interrupções; qualidade, diagnóstico, alertas, mapa, consumo e antena seguem por importância; clima e serviços viram um item compacto no fim.

FIRST VIEWPORT: Veredito em foco com a foto da antena (DishArt) sobre o horizonte (HeroArt), frase, luz, faixa de números e régua com nota de qualidade, firmware, tempo ligado, potência, cobertura e origem; abaixo, gráfico de desempenho com abas de métrica e período ao lado das interrupções de 24 h.

FORM: seed: none (pinned) — "Veredito + evidências — Cada página abre respondendo a sua pergunta numa frase com os números ('Sua conexão nas últimas 24 h: boa, 99,4% no ar, latência 31 ms') num painel em destaque; os gráficos vêm abaixo como prova. Menos cards iguais, hierarquia clara." Assinatura: o painel de veredito (frase em Space Grotesk com números mono, luz de estado com palavra, faixa de 3–5 números-chave separados por fio de 1px, régua técnica e origem do dado no rodapé). Compromissos de marca preservados: arte da antena, régua técnica e retícula no painel em foco.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
