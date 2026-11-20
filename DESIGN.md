---
name: ASTRYON Mobile Gateway — Pareamento
description: Fluxo de pareamento Android guiado por uma rota de integração de três paradas.
colors:
  signal-blue: "#2F80ED"
  navy-shell: "#102A43"
  guide-amber: "#F2C94C"
  mist-surface: "#F5F7FA"
  slate-muted: "#CBD5E1"
  on-brand: "#FFFFFF"
typography:
  headline:
    fontFamily: "Roboto, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.5px"
  title:
    fontFamily: "Roboto, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Roboto, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.45
  body-small:
    fontFamily: "Roboto, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Roboto, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.3
rounded:
  control: "14px"
  surface: "16px"
  notice: "12px"
  frame: "28px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "24px"
  xxl: "32px"
components:
  app-bar:
    backgroundColor: "{colors.navy-shell}"
    textColor: "{colors.on-brand}"
    height: "56px"
  button-primary:
    backgroundColor: "{colors.signal-blue}"
    textColor: "{colors.on-brand}"
    rounded: "{rounded.control}"
    height: "56px"
    padding: "0px 24px"
  button-secondary:
    textColor: "{colors.signal-blue}"
    rounded: "{rounded.control}"
    height: "52px"
    padding: "0px 24px"
  input:
    backgroundColor: "#FFFFFF"
    textColor: "{colors.navy-shell}"
    rounded: "{rounded.control}"
    padding: "18px 16px"
  route-stop-current:
    backgroundColor: "{colors.guide-amber}"
    textColor: "{colors.navy-shell}"
    size: "32px"
  route-stop-done:
    backgroundColor: "{colors.signal-blue}"
    textColor: "{colors.on-brand}"
    size: "32px"
  notice-panel:
    backgroundColor: "{colors.mist-surface}"
    textColor: "{colors.navy-shell}"
    rounded: "{rounded.surface}"
    padding: "16px"
---

# Design System: ASTRYON Mobile Gateway — Pareamento

## Overview

**Creative North Star: "A Linha de Integração"**

O fluxo de pareamento se apresenta como uma linha de integração de transporte público: três paradas — Código, Aparelho, Revisão — ligadas por uma faixa, com a parada atual destacada em amarelo e as concluídas em azul. A gramática vem da sinalização de integração: progresso sempre visível, instrução específica por parada, e uma única ação primária ao final de cada trecho, alcançável mesmo com o teclado aberto. Nada de tela de boas-vindas promocional nem formulário genérico centrado; a tela é a própria rota.

O mundo visual vive dentro do Android. Ele não desenha um sistema novo: apoia-se no Material 3 e numa `ColorScheme.fromSeed` azul, sobrepondo apenas três âncoras de marca — o azul `#2F80ED` das ações e da rota, o navy `#102A43` do shell e da tinta, e o amarelo `#F2C94C` da parada atual. Superfícies são claras e calmas, o cromo é navy, o azul é o único sinal de ação, e o amarelo aparece só uma vez por tela. A tipografia é a nativa do Android, ajustada em peso e altura de linha, sem face própria.

A densidade é de ferramenta operacional, não de marketing: uma coluna direta, 24 de respiro lateral, espaçamento vertical em degraus de 8–32, e revisão explícita antes de registrar. Os componentes são Material canônicos (AppBar, FilledButton, OutlinedButton, TextField, ListTile, SnackBar) com um raio de canto consistente de 14 e um painel de rota como única assinatura. A direção recusa prometer sucesso adiantado: o sucesso é o registro concluído, e a conexão com a antena continua sendo assunto do dashboard.

**Key Characteristics:**
- Rota de três paradas (Código → Aparelho → Revisão) como assinatura única e persistente da orientação.
- Cromo navy (`#102A43`) emoldurando uma superfície clara; azul (`#2F80ED`) como único sinal de ação e de progresso.
- Amarelo (`#F2C94C`) reservado à parada atual — ocorre uma vez por tela.
- Componentes Material 3 com raio de 14 nas formas de controle; sistema chapado, sem sombras.
- Tipografia nativa Android (Roboto), ajustada apenas em peso, altura de linha e entreletra.
- Uma ação primária no rodapé, fixa acima dos insets, disponível com o teclado aberto.

## Colors

Uma paleta de sinalização: um navy estrutural, um azul de ação e rota, um amarelo de parada atual e neutros claros que vêm da própria `ColorScheme` Material.

### Primary
- **Signal Blue** (#2F80ED): é a semente da `ColorScheme.fromSeed` e a cor de ação. Pinta a ação primária, a linha da rota, as paradas concluídas, o foco dos campos e a borda dos botões secundários (a 55% de alfa). Ação e progresso falam a mesma língua; por isso o azul não é decorativo.

### Secondary
- **Guide Amber** (#F2C94C): override de `secondary` (com `onSecondary` navy). Marca exclusivamente a parada atual da rota. É o único uso previsto: um realce de posição, não de estado nem de ênfase genérica.

### Neutral
- **Navy Shell** (#102A43): a tinta e o cromo. Preenche a AppBar, o fundo da tela de leitura de QR Code, e serve de cor de texto dos títulos em tema claro. É também o texto sobre o amarelo.
- **Mist Surface** (#F5F7FA): fundo do scaffold no tema claro. A calma de onde a rota se destaca.
- **Slate Muted** (#CBD5E1): texto secundário sobre o campo navy (corpo dos erros do leitor de QR Code). Um neutro frio que mantém legibilidade sobre `#102A43` sem competir com o branco.
- **On-Brand White** (#FFFFFF): texto e ícones sobre navy e sobre o azul, e o check das paradas concluídas.

### Named Rules
**The Navy Shell Rule.** O cromo é navy. AppBar e telas de câmera usam `#102A43`; a superfície clara `#F5F7FA` é o conteúdo, nunca o contorno.

**The One Accent Rule.** O azul `#2F80ED` é o único sinal de ação e de progresso. Se um elemento não é acionável nem indica avanço, ele não é azul.

**The One Stop Highlight Rule.** O amarelo `#F2C94C` aparece uma única vez por tela: na parada atual da rota. Rebaixá-lo a cor de destaque genérico quebra a leitura da linha.

## Typography

**Body Font:** Roboto (nativo Android; fallback sans-serif do sistema)

**Character:** Tipografia nativa e invisível, como sinalização pública: nada de face própria. O sistema herda a escala Material 3 e ajusta apenas peso, altura de linha e entreletra. Os tamanhos abaixo são a base Material 3 (`headlineMedium` 28, `headlineSmall` 24, `bodyLarge` 16, `bodyMedium` 14, `bodySmall` 12, `labelMedium` 12); o código só reescreve peso, `height` e `letterSpacing`.

### Hierarchy
- **Headline** (700, 28, altura 1.15, entreletra -0.5): título da etapa. Em tema claro usa navy `#102A43`; em tema escuro, `onSurface`.
- **Title** (600, 24): título do estado de erro do leitor de QR Code, sobre o campo navy.
- **Body** (400, 16, altura 1.45): descrição da etapa, dica de nome e aviso de revisão. É o corpo de leitura do fluxo.
- **Body Small** (400, 12, altura 1.4): divisor "ou digite", nota de validade do código e rodapé informativo.
- **Label** (12; 700 na parada atual, 500 nas demais): rótulos das paradas da rota (`Código`, `Aparelho`, `Revisão`).

### Named Rules
**The Native Type Rule.** Não introduza face própria. Herde Roboto/Material 3 e ajuste só peso, altura de linha e entreletra. A tipografia é infraestrutura, não identidade.

## Layout

Coluna única, sem grade e sem breakpoints: um layout compacto de Android. A margem lateral é constante em 24; a rota ocupa toda a largura logo abaixo da AppBar. O conteúdo rola (`SingleChildScrollView`) com preenchimento `24/32/24/24` (esquerda/topo/direita/base) e dispensa o teclado ao arrastar. A faixa de rota tem preenchimento `24/20/24/18`.

O ritmo vertical é uma escala fixa de 8, 12, 16, 20, 24 e 28. A ação primária não rola: ela vive no `bottomNavigationBar` dentro de um `SafeArea` com mínimo `24/12/24/16`, sempre acima dos insets do sistema e alcançável com o teclado aberto. A mensagem de erro aparece imediatamente acima da linha de ações. Na etapa 0, a ação primária "Continuar" fica no rodapé, enquanto "Ler QR Code" é uma ação secundária de largura total acima do campo manual.

## Elevation & Depth

**O sistema é chapado; não usa sombras.** A profundidade vem de bordas e de preenchimentos tonais, não de elevação. A AppBar tem `elevation: 0` e se separa do conteúdo pela cor navy. Cartões são delimitados por borda `outlineVariant` e raio 16, não por drop shadow. O leitor de QR Code substitui a profundidade por um campo navy de tela cheia. O único relevo é o `SnackBar`, em modo flutuante (`behavior: floating`). Não há vocabulário de sombra a documentar.

### Named Rules
**The Flat Route Rule.** Sem sombras. Separe planos com borda, cor de superfície e cromo navy. Se algo precisa de sombra para se destacar, o problema é hierarquia, não elevação.

## Shapes

Linguagem de formas arredondadas e consistentes, herdada do Material 3 mas fixada em degraus próprios: controles (campos, botões, painéis de dica) em raio **14**; superfícies e cartões de revisão em **16**; avisos e mensagens de erro em **12**; e o visor do leitor de QR Code em **28** (moldura de 248×248, borda amarela de 3). As paradas da rota são círculos de 32 com borda de 2; a parada atual e as concluídas ganham preenchimento sólido. Conectores da rota e bordas de foco têm 2 de espessura. Ícones são Material, nunca glifos decorativos.

## Components

### App Bar
- **Shape:** sem raio; faixa navy de 56 de altura, borda zero.
- **Color:** fundo `#102A43`, texto e ícones brancos, título alinhado à esquerda (`centerTitle: false`).
- **Behavior:** nas etapas internas, um `IconButton` de voltar (`Icons.arrow_back`) aparece à esquerda com tooltip "Voltar" e fica oculto enquanto registra. O título da AppBar é "ASTRYON".

### Route Progress (componente de assinatura)
- **Shape:** três círculos de 32 (borda de 2) ligados por conectores de 2, dentro de uma faixa com fundo de superfície e preenchimento `24/20/24/18`.
- **States:** *concluída* = preenchimento azul, check branco; *atual* = preenchimento amarelo, número navy, borda azul; *futura* = preenchimento de superfície, borda `outline`, rótulo `onSurfaceVariant`. O rótulo atual é 700; os demais, 500.
- **Motion:** cada parada anima em 200ms; sob "reduzir animações" do sistema, a duração é zero.
- **Accessibility:** agrupado em `Semantics` com rótulo falado "Etapa N de 3: Rótulo".

### Buttons
- **Shape:** raio 14 em todas as variantes.
- **Primary (`FilledButton`):** fundo azul (`primary`), texto branco, peso 600, altura mínima 56. Rótulo "Continuar" e, na última parada, "Parear dispositivo".
- **Loading:** com `_loading`, o botão fica desabilitado e troca o rótulo por um indicador circular de 20 (stroke 2) + "Registrando...".
- **Secondary (`OutlinedButton`):** altura mínima 52, contorno azul a 55% de alfa, texto azul, peso 600. Usado como "Voltar" ao lado da ação primária.
- **Scan (`OutlinedButton.icon`):** "Ler QR Code" em largura total, ícone `qr_code_scanner`, acima do campo manual.

### Inputs / Fields
- **Style:** preenchido — branco no tema claro, `surfaceContainerHighest` no escuro — raio 14, borda habilitada `outlineVariant`, preenchimento interno `16/18`, com `prefixIcon`.
- **Focus:** borda azul de 2 de espessura. Sem glow nem elevação.
- **Content:** campo de código com `textCapitalization: characters`, `maxLength: 9`, dica `A3B7-X9K2`, ícone `key_outlined`; campo de nome com `autofocus`, `maxLength: 60`, dica "Ex.: Celular do Carlos", ícone `smartphone_outlined`.

### Notice Panel
- **Style:** painel de dica com fundo `primaryContainer` a 55%, raio 14, preenchimento 16, ícone `badge_outlined` à esquerda.
- **Use:** orientar o nome do aparelho ("Use algo como 'Celular da sala'...").

### Review Card
- **Style:** superfície com borda `outlineVariant`, raio 16. Dentro, dois `ListTile` (preenchimento `16/8`) separados por `Divider` de 1.
- **Content:** "Código de pareamento" e "Nome do aparelho", cada valor em peso 600. Abaixo, uma linha `info_outline` + corpo de aviso sobre o que o registro faz.

### Error Message
- **Style:** faixa de largura total, raio 12, preenchimento 12, fundo `errorContainer`, texto e ícone `error_outline` (20) em `onErrorContainer`.
- **Accessibility:** `Semantics(liveRegion: true)`.
- **Behavior:** erros de código (400/404) devolvem o usuário à parada 0; demais erros permanecem na etapa atual com mensagem de recuperação específica (timeout, código inválido, inalcançável).

### Scanner Field
- **Scanner screen:** fundo navy de tela cheia, título "Ler QR Code", ação de lanterna na AppBar (tooltip alterna ligar/desligar). Visor central de 248×248 com moldura amarela de 3 e raio 28; cartão de instrução em Material navy (raio 16) ao pé. Placeholder escuro com indicador branco.
- **Error state:** ícone branco de 48, título branco (600, 24), corpo `#CBD5E1` e botão `FilledButton.icon` "Tentar novamente" (`Icons.refresh`), desabilitado quando o aparelho não oferece câmera.
- **Behavior:** o QR preenche o código e mostra "Código lido. Confira os dados para continuar.", mas nunca registra sozinho.

### SnackBar
- **Style:** flutuante; usado para confirmação de leitura e avisos do scanner.

## Do's and Don'ts

### Do:
- **Do** manter a rota de três paradas visível em todas as etapas; ela é a assinatura e a orientação.
- **Do** reservar o azul `#2F80ED` para ação e progresso e o amarelo `#F2C94C` para a parada atual, uma vez por tela.
- **Do** manter a ação primária no rodapé, dentro de `SafeArea`, acima dos insets e alcançável com o teclado aberto.
- **Do** usar raio 14 em controles, 16 em superfícies, 12 em avisos, círculos de 32 na rota.
- **Do** herdar Roboto/Material 3 e ajustar só peso, altura de linha e entreletra.
- **Do** descrever o registro como concluído e deixar claro que a conexão com a antena é assunto do dashboard.
- **Do** respeitar `MediaQuery.disableAnimations` (durações zero) e agrupar estado em `Semantics`.

### Don't:
- **Don't** usar sombras nem elevação; separe planos com borda, cor de superfície e cromo navy.
- **Don't** introduzir face tipográfica própria nem tamanhos fora da escala Material 3 herdada.
- **Don't** usar o amarelo como cor de destaque genérica ou os neutros como fundo do cromo — o cromo é navy.
- **Don't** prometer conexão com a antena como resultado do pareamento; sucesso é registro concluído.
- **Don't** registrar o dispositivo automaticamente após a leitura do QR; a revisão é obrigatória.
- **Don't** criar telas de boas-vindas promocionais nem formulário genérico centrado; a tela é a rota.
