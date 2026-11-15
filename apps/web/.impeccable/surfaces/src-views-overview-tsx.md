---
version: 1
slug: "src-views-overview-tsx"
primary_target: "src/views/overview.tsx"
related_targets: ["src/components/shell/AppShell.tsx"]
---

# Painel ASTRYON (todas as telas do app)

Scope: shell (cabeçalho, barra lateral, navegação móvel) e todas as telas em `src/views`, mais login. Mode: Operate.
Audience: o dono da Starlink Mini, sozinho, no PC e no celular, de dia e à noite em casa.
Task: saber em segundos se a conexão está saudável, investigar quedas, acompanhar consumo, conversar com a Central de IA.
Constraints: sem dados fictícios fora de /demo; preservar APIs e funções; leve para Celeron J1800; letreiro SPACEX mantido.

## Direction contract

THESIS: Um console de operações de missão sóbrio: preto absoluto, informação branca, azul só onde há ação ou dado vivo. Recusa o "dashboard SaaS" de degradês azul/roxo e cards brilhantes.

OWN-WORLD: Fundo #000000, painéis #10151D/#161D27 com fio de 1px #27313F e cantos de 6px. Branco para valores, prata #A7A9AC para rótulos, azul #008CFF/#38BDF8 para ação, seleção e séries ao vivo, #005288 para preenchimento de botão primário. Verde #00D68F e vermelho #FF4655 só para estado. Inter no texto, Space Grotesk nos títulos, JetBrains Mono em toda telemetria.

STORY: O dono abre o painel, lê o estado no cabeçalho (relógio de missão, enlace com o agente, IA) e nos números monoespaçados, e desce aos gráficos de linha fina quando algo mudou.

FIRST VIEWPORT: Barra lateral preta com trilho azul de 2px no item ativo; cabeçalho com título em Space Grotesk, relógio de missão (local + UTC) em mono, chips de enlace e IA, sino e usuário; abaixo, os indicadores e o gráfico de desempenho.

FORM: seed: none (pinned) — "SPACE X AESTHETIC + ADVANCED MISSION CONTROL + MINIMALIST FUTURISTIC DASHBOARD + PREMIUM AI INTERFACE"; paleta, fontes e elementos de cabeçalho e sidebar fixados pelo dono. Signature move: marcas de canto (retículas de HUD) e régua de coordenadas nos painéis em foco, mais o relógio de missão.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
