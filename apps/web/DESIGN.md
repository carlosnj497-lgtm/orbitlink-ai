---
name: ASTRYON
description: Console local de operações para uma Starlink Mini, no PC e no celular.
colors:
  void: "#000000"
  bg-elev: "#080B10"
  surface: "#10151D"
  surface-2: "#161D27"
  surface-3: "#1E2733"
  border: "#27313F"
  border-strong: "#364354"
  fg: "#FFFFFF"
  fg-muted: "#A7A9AC"
  fg-subtle: "#8B9096"
  accent: "#38BDF8"
  accent-strong: "#7DD3FC"
  accent-2: "#008CFF"
  accent-deep: "#005288"
  ok: "#00D68F"
  warn: "#E8B931"
  crit: "#FF4655"
  demo: "#D4D6D9"
  chart-up: "#E6E8EB"
  chart-grid: "#1B232E"
typography:
  display:
    fontFamily: "Space Grotesk, Inter, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.012em"
  headline:
    fontFamily: "Space Grotesk, Inter, system-ui, sans-serif"
    fontSize: "21px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.012em"
  title:
    fontFamily: "Space Grotesk, Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.012em"
  body:
    fontFamily: "Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.43
  body-sm:
    fontFamily: "Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "JetBrains Mono, Cascadia Mono, Consolas, monospace"
    fontSize: "10.5px"
    fontWeight: 500
    letterSpacing: "0.08em"
  telemetry:
    fontFamily: "JetBrains Mono, Cascadia Mono, Consolas, monospace"
    fontSize: "19px"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "-0.03em"
    fontFeature: "tnum"
  clock:
    fontFamily: "JetBrains Mono, Cascadia Mono, Consolas, monospace"
    fontSize: "17px"
    fontWeight: 500
    lineHeight: 1
    fontFeature: "tnum"
rounded:
  tag: "3px"
  segment: "4px"
  md: "6px"
  pill: "9999px"
spacing:
  tile: "10px"
  gap-sm: "12px"
  card: "16px"
  page-x-mobile: "16px"
  page-x-desktop: "24px"
components:
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "16px"
  button-primary:
    backgroundColor: "{colors.accent-deep}"
    textColor: "{colors.fg}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "#00609F"
    textColor: "{colors.fg}"
  button-secondary:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.fg}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "36px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-3}"
  button-ghost:
    textColor: "{colors.fg-muted}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "36px"
  button-danger:
    textColor: "{colors.crit}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "36px"
  button-danger-hover:
    backgroundColor: "{colors.crit}"
    textColor: "{colors.void}"
  input:
    backgroundColor: "{colors.bg-elev}"
    textColor: "{colors.fg}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "36px"
  badge-neutral:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.fg-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.tag}"
    padding: "2px 6px"
  badge-ok:
    textColor: "{colors.ok}"
    typography: "{typography.label}"
    rounded: "{rounded.tag}"
    padding: "2px 6px"
  badge-warn:
    textColor: "{colors.warn}"
    typography: "{typography.label}"
    rounded: "{rounded.tag}"
    padding: "2px 6px"
  badge-crit:
    textColor: "{colors.crit}"
    typography: "{typography.label}"
    rounded: "{rounded.tag}"
    padding: "2px 6px"
  badge-demo:
    textColor: "{colors.demo}"
    typography: "{typography.label}"
    rounded: "{rounded.tag}"
    padding: "2px 6px"
  segment-active:
    textColor: "{colors.accent}"
    rounded: "{rounded.segment}"
    padding: "4px 10px"
  nav-item:
    textColor: "{colors.fg-muted}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "40px"
  nav-item-active:
    textColor: "{colors.fg}"
  stat-tile:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "10px"
---

# Design System: ASTRYON

## Overview

**Creative North Star: "O Console de Missão"**

Um console de operações de missão sóbrio: preto absoluto, informação em branco, azul só onde há ação, seleção ou dado vivo. O dono abre o painel, lê o estado no cabeçalho (relógio de missão, enlace com o agente, IA) e nos números monoespaçados, e desce aos gráficos de linha fina quando algo mudou. A densidade é de instrumento: muitos valores por tela, cada um com rótulo técnico curto, unidade e origem do dado.

O mundo recusa o "dashboard SaaS" de degradês azul/roxo e cards brilhantes. A profundidade vem de camadas tonais de grafite sobre preto, fios de 1px e um único horizonte azul no topo do fundo. Os gestos de assinatura são de instrumentação: retículas de canto de HUD, a régua de escala, o relógio de missão e o trilho luminoso do item ativo. A paleta, as fontes e os elementos do cabeçalho e da barra lateral foram fixados pelo dono.

A marca SPACEX aparece como letreiro tipográfico (caixa alta larga, itálica, com um arco de órbita sobre o X), sempre acompanhado da declaração de projeto independente, sem afiliação com a Starlink/SpaceX.

**Key Characteristics:**
- Preto #000000 domina; painéis em grafite sólido com fio de 1px e cantos de 6px.
- Branco para valores, prata para rótulos, azul para ação, seleção e séries ao vivo.
- Verde, amarelo e vermelho só para estado operacional.
- Toda telemetria em JetBrains Mono com algarismos tabulares.
- Dado fictício sempre marcado por hachura prata, nunca confundível com dado real.
- Movimento curto, só opacity/transform, desligado com prefers-reduced-motion.

## Colors

Preto de espaço profundo com três degraus de grafite, um azul em três intensidades e três cores de estado reservadas.

### Primary
- **Azul Luminoso** (accent): texto ativo, links, ícones de cabeçalho de card, séries ao vivo nos gráficos (download, latência), trilho do item ativo, cursor de texto. Tom claro (accent-strong) para pontos de órbita e realces sobre azul.
- **Azul Tecnológico** (accent-2): fios e bordas de foco, anel de foco (`:focus-visible` 2px com 2px de afastamento), borda de controles ativos, preenchimento suave de seleção (`rgb(0 140 255 / 0.12)`), seleção de texto (`/ 0.35`).
- **Azul de Missão** (accent-deep): preenchimento do botão primário, do switch ligado e do avatar do usuário; também o horizonte radial do fundo (`/ 0.32`).

### Tertiary (estado operacional)
- **Verde Enlace** (ok): conectada, saudável, dentro do normal.
- **Amarelo Sinalização** (warn): degradado, reconectando, dado atrasado, buscando satélites. Adição deliberada à paleta do dono; amarelo de sinalização, sem puxar para o laranja.
- **Vermelho Falha** (crit): offline, inacessível, perda de pacotes nos gráficos, contador de alertas ativos (fundo vermelho com texto preto).
- Cada estado tem um par "soft" a 10-11% de opacidade para fundo de selo e callout, com borda a 30-40%.

### Neutral
- **Vácuo** (void): fundo da página, cabeçalho e barra de abas móvel (a 90-92% com desfoque).
- **Grafite Profundo** (bg-elev): barra lateral, campos de entrada, controles segmentados, caixa de tooltip de gráfico.
- **Grafite** (surface): todo painel padrão.
- **Grafite Claro** (surface-2): botão secundário, diálogo, tooltip, selo neutro.
- **Grafite Realce** (surface-3): hover do botão secundário, trilho do switch, brilho do skeleton. É a superfície mais clara; todo par de texto foi medido em AA (4,5:1) sobre ela.
- **Fio** (border) e **Fio Forte** (border-strong): bordas de painel e de controles; marcas menores da régua.
- **Branco** (fg): valores, títulos, item ativo. **Prata** (fg-muted): rótulos e texto secundário. **Prata Fosca** (fg-subtle): legendas, eixos, rótulos técnicos.
- **Prata Demonstração** (demo): selos, callouts e faixa do modo demonstração, sempre com hachura diagonal (135°, faixas de 6px a 10%) e borda tracejada. Adição deliberada à paleta do dono.
- Séries de gráfico: upload em branco gelo (chart-up), grade em chart-grid tracejada (2 4), só horizontal.

### Named Rules
**The State Is Sacred Rule.** Verde, amarelo e vermelho comunicam estado operacional e nada mais. Nunca servem de cor de categoria, decoração, ícone de tile ou destaque de marca.

**The Blue Means Live Rule.** O azul marca ação, seleção ou dado vivo. Um elemento azul é clicável, está selecionado ou mostra uma leitura atual da antena.

**The Hatched Fiction Rule.** Todo dado fictício leva a hachura prata e a palavra "demonstração". Nunca usar azul, verde ou superfície lisa para dado de demonstração.

## Typography

**Display Font:** Space Grotesk (com Inter e system-ui)
**Body Font:** Inter (com Segoe UI Variable Text, Segoe UI, system-ui)
**Label/Mono Font:** JetBrains Mono (com Cascadia Mono, Consolas)

**Character:** Space Grotesk dá aos títulos um traço técnico e geométrico; Inter carrega a leitura em português sem ruído; JetBrains Mono transforma cada número em leitura de instrumento. As três são servidas pelo próprio painel (next/font), sem requisição externa em tempo de execução.

### Hierarchy
- **Display** (600, 20-24px, 1.25): título de estado do hero ("Starlink Online").
- **Headline** (600, 21px): título da tela no cabeçalho, com tagline de 13px em prata abaixo.
- **Title** (600, 14px): título de card; ícone de 16px em azul à esquerda. Títulos h1-h3 usam Space Grotesk com -0.012em.
- **Body** (400, 14px) e **Body small** (400, 12px): texto corrido, descrições, callouts.
- **Label** (mono 500, 10.5px, 0.08em, caixa alta, prata fosca): unidades, cabeçalhos de tabela, rótulos de KPI, selos de origem. No celular o rótulo do tile largo vira Inter 11.5px sem caixa alta.
- **Telemetry** (mono 500, 19px, -0.03em, tabular): valor de KPI; unidade em 11px prata ao lado.
- **Clock** (mono 500, 17px, tabular): relógio de missão; data e UTC em mono 10px, 0.12em, caixa alta.

### Named Rules
**The Mono Is Measurement Rule.** JetBrains Mono é para números, IDs, horários, IPs e rótulos técnicos curtos. Palavras de estado ("Conectada", "Degradada", "Online") e frases são Inter.

## Layout

Shell de três peças: barra lateral fixa de 256px (recolhe para trilho de ícones de 72px, preferência persistida), cabeçalho fixo de 64px e conteúdo com largura máxima de 1800px, margens de 16px (celular) e 24px (desktop). Abaixo de `lg` (1024px) a barra lateral vira gaveta à esquerda (min(18rem, 86vw)) e entra a barra de abas inferior.

O Dashboard usa grade de 6 colunas em `md` com uma sétima coluna lateral a partir de 105rem. Os KPIs ficam em grade de 2 / 3 / 5 colunas (celular / sm / xl), espaçamento de 12px; os cards entre si, 16px. Card com 16px de respiro; tile de KPI com 10px. Seções com mais de uma tela ganham abas sublinhadas no topo do conteúdo, roláveis na horizontal.

**Responsivo:**
- **Barra de abas inferior** (abaixo de lg): Início, Ao vivo, IA, Alertas e Menu; alvos de 56px de altura, ícone 20px, rótulo 10.5px; item ativo em branco com fio azul luminoso de 2px no topo; contador de alertas vermelho sobre o ícone; respeita `safe-area-inset-bottom`. O conteúdo reserva 96px no rodapé.
- **Cabeçalho compacto** (abaixo de lg): botão de menu, letreiro SPACEX pequeno no lugar do título, relógio só HH:MM, chips de agente e IA reduzidos a forma curta ou ícone.
- **Tile largo de KPI** (abaixo de sm): o tile ocupa as duas colunas em linha: valor à esquerda, descrição e origem alinhadas à direita.

**The No Dead Gap Rule.** Em grades ímpares no celular, o último tile vira tile largo em vez de deixar meia linha vazia.

## Elevation & Depth

Sistema de camadas tonais, não de sombras. A profundidade vem do degrau entre preto, bg-elev, surface e surface-2, de fios de 1px e de um reflexo interno de 1px no topo de cada painel. Sombras externas são escuras e longas, só para separar do preto; brilho azul aparece apenas em elementos em foco ou ativos.

### Shadow Vocabulary
- **Reflexo de painel** (`inset 0 1px 0 0 rgb(255 255 255 / 0.03), 0 12px 28px -18px rgb(0 0 0 / 0.9)`): todo card.
- **Painel em foco** (`inset 0 1px 0 0 rgb(56 189 248 / 0.08), 0 0 0 1px rgb(0 140 255 / 0.05), 0 16px 40px -26px rgb(0 140 255 / 0.55)`, borda `rgb(0 140 255 / 0.35)`): hero, gráfico principal, chat da Central de IA.
- **Brilho do primário** (`0 6px 22px -8px rgb(0 140 255 / 0.75)`): hover do botão primário.
- **Trilho luminoso** (`0 0 10px 1px rgb(56 189 248 / 0.7)`): item ativo na barra lateral, abas e barra inferior.
- **Flutuante** (`0 12px 32px -12px rgb(0 0 0 / 0.9)`): tooltip, popover, menu.

### Named Rules
**The One Focused Panel Rule.** O brilho azul (painel em foco) marca o painel principal de cada tela, não todos. Uma tela tem um ou dois painéis em foco; o resto é grafite plano.

## Shapes

Cantos quase retos: 6px em painéis, botões, campos e diálogos; 4px nos itens de controle segmentado e menus; 3px em selos e chips do cabeçalho; pílula só em pontos de estado, trilhos e switches. Bordas de 1px sempre. O fundo da página carrega uma grade técnica de 48px a 2,8% de branco que some para baixo.

**HUD corner reticles:** marcas de canto azuis (10 × 1px, `rgb(56 189 248 / 0.7)`) a 5px de cada canto, desenhadas em pseudo-elemento. Vão no painel em foco, no diálogo, no ícone de estado vazio, na tooltip de gráfico e no hero de Antena.

**Tick ruler:** fio de 1px com marcas menores a cada 8px (border-strong, 4px de altura) e maiores a cada 64px (azul a 55%, 7px). Só escala visual, sem números. Vai na base do hero e no topo do gráfico principal, a 50-70% de opacidade.

## Components

### Buttons
Firmes e contidos; o primário é o único bloco azul saturado da tela.
- **Shape:** cantos de 6px; altura 36px (md), 32px (sm), quadrado de 36px (icon); ícone 16px; peso 500 (600 no primário e perigo).
- **Primary:** azul de missão com borda accent-2 a 70% e reflexo interno branco a 12%; hover clareia para #00609F, borda azul luminoso e brilho do primário.
- **Secondary (padrão):** surface-2 com fio forte; hover em surface-3 com borda azul a 50%.
- **Ghost:** texto prata, sem borda; hover em surface-2 e texto branco.
- **Danger:** vermelho a 15% com borda vermelha; hover preenche vermelho com texto preto.
- **Press / Disabled:** escala 0.98 ao pressionar; desabilitado a 45%; carregando troca por spinner.

### Chips (selos)
- **Style:** mono 10px, caixa alta, 0.08em, cantos de 3px, borda a 30% e fundo soft do tom. Tons: neutro, accent, ok, warn, crit, demo (hachurado e tracejado).
- **Selo de origem:** todo valor de telemetria leva um selo com sua origem (real, calculada, estimada, importada, sensor ESP32, indisponível, demonstração).
- **Pílula de estado:** selo com ponto de 6px; em "conectada" o ponto emite um eco de radar.

### Cards / Containers
- **Corner Style:** 6px.
- **Background:** surface sólido.
- **Shadow Strategy:** reflexo de painel; painel em foco só no principal (ver Elevation & Depth).
- **Border:** 1px border; transição de borda em 180ms.
- **Internal Padding:** cabeçalho 16px nas laterais e topo, corpo 16px com 12px no topo.

### Inputs / Fields
- **Style:** 36px de altura, bg-elev, fio forte, cantos 6px, placeholder em prata fosca, cursor azul.
- **Focus:** borda accent-2 e halo de 3px `rgb(0 140 255 / 0.18)`.
- **Controle segmentado:** trilho bg-elev com borda; item ativo com fundo azul soft, texto azul luminoso e fio interno azul a 45%.
- **Switch:** trilho surface-3; ligado em azul de missão com borda accent-2.

### Navigation
- **Barra lateral:** bg-elev; itens de 40px, Inter 13.5px 500, ícone 18px traço 1.75. Inativo em prata, hover em surface. Ativo em branco sobre degradê horizontal azul (16% → 2%), ícone azul e **trilho luminoso** de 2 × 24px na borda esquerda. Rodapé com card da antena (estado real) e aviso de independência.
- **Abas de seção:** texto 13px; ativa em branco com fio azul de 2px e brilho; hover revela um fio em border-strong.
- **Mobile:** barra de abas inferior e gaveta (ver Layout).

### Mission Clock
Hora local com segundos em mono 17px branco, abaixo data e UTC em mono 10px prata fosca, separado dos chips por fio vertical. Atualiza a cada segundo, só no cliente. No celular, só HH:MM.

### Stat Tile (KPI)
Card de 10px de respiro: ícone em caixa bg-elev com borda e ícone azul, rótulo técnico, valor telemetria (branco; amarelo ou vermelho só quando o tom de estado pede), unidade, minigráfico de linha fina, nota e selo de origem. Variante larga no celular (ver Layout).

### Charts
Linhas finas (1.1-1.4px) sem animação de entrada, área com degradê suave, grade horizontal tracejada, eixos em mono 10.5px prata fosca sem linha de eixo. Cursor azul tracejado. Lacunas de observação hachuradas em prata, nunca interpoladas. Tooltip em bg-elev a 95% com retícula de HUD.

### SPACEX Wordmark
Letreiro em caixa alta larga, itálico, peso black, inclinação de -6°, espaçamento 0.24em (0.2em no tamanho pequeno), com arco de órbita em SVG nascendo no A e cruzando sobre o X. Monocromático, na cor do texto. Abaixo, no desktop, "Starlink Mini · Monitor" em rótulo técnico de 9.5px e 0.26em. Desenhado com tipografia, nunca com o arquivo oficial do logo.

### Motion
Curva padrão `cubic-bezier(0.22, 1, 0.36, 1)`. Entrada de tela: subida de 6px com fade em 320ms, uma por navegação. Gaveta 220ms, fade 200ms, pop de menus e tooltips 140ms. Indicadores vivos: eco de radar de 2.2s no ponto de enlace, pulso de 2s em reconexão e processamento, varredura de 1.4s no chip "IA processando". Skeleton com brilho de 1.6s. Com `prefers-reduced-motion: reduce`, todas as animações e transições são anuladas (0.01ms, uma iteração) e os indicadores vivos ficam estáticos.

## Do's and Don'ts

### Do:
- **Do** manter o fundo #000000 e os painéis em surface sólido com fio de 1px e cantos de 6px.
- **Do** usar azul só em ação, seleção e dado vivo; o preenchimento do primário é sempre azul de missão.
- **Do** escrever números, horários, IDs e IPs em JetBrains Mono tabular, e palavras de estado em Inter.
- **Do** marcar todo valor com seu selo de origem e todo dado fictício com hachura prata e "demonstração".
- **Do** reservar retículas de HUD e régua para o painel em foco e para superfícies de instrumento.
- **Do** anular todo movimento com prefers-reduced-motion e animar só opacity e transform.
- **Do** manter o letreiro SPACEX acompanhado da declaração de projeto independente.

### Don't:
- **Don't** usar verde, amarelo ou vermelho para categoria, decoração ou ícone de tile.
- **Don't** usar degradês azul/roxo, cards brilhantes ou glassmorphism de "dashboard SaaS".
- **Don't** aplicar o brilho de painel em foco em todos os cards da tela.
- **Don't** interpolar lacunas de dados nos gráficos nem exibir dado fictício fora de /demo.
- **Don't** usar o arquivo oficial do logo SpaceX; o letreiro é tipográfico.
- **Don't** criar rótulos mono de abertura acima de títulos (kickers); o rótulo técnico é para unidade, coordenada e cabeçalho de dado.
