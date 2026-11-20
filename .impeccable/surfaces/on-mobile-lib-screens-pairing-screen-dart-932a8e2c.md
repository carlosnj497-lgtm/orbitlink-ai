---
version: 1
slug: "on-mobile-lib-screens-pairing-screen-dart-932a8e2c"
primary_target: "prototypes/mobile-gateway/app/astryon_mobile/lib/screens/pairing_screen.dart"
related_targets: ["prototypes/mobile-gateway/app/astryon_mobile/lib/screens/pairing_scanner_screen.dart","prototypes/mobile-gateway/app/astryon_mobile/lib/main.dart"]
---

# Escopo
Remodelar o fluxo Android de pareamento em `lib/screens/pairing_screen.dart`, incluindo leitura de QR Code, entrada manual, identificação do aparelho e revisão antes do registro. Modo: Operate.

## Direção escolhida
Linha de integração, selecionada pelo usuário. O teste da antena permanece no dashboard e não bloqueia o registro. QR preenche o código, mas nunca registra automaticamente.

## Direction contract

THESIS: Uma rota de integração torna a ligação entre código, aparelho e revisão tão legível quanto uma viagem com três paradas; recusa o formulário genérico centrado e a tela de boas-vindas promocional.

OWN-WORLD: Navy `#102A43` para o shell, azul `#2F80ED` para ações e a rota, amarelo `#F2C94C` para a parada atual e superfícies `#F5F7FA`; componentes Material 3, cantos consistentes, tipografia nativa Android e uma linha de três paradas como única assinatura.

STORY: O usuário entende onde obter o código, escolhe QR ou digitação, identifica o aparelho com um nome humano, revisa os dados e só então registra. Erros explicam a recuperação e sucesso significa registro concluído, não antena conectada.

FIRST VIEWPORT: App bar navy com ASTRYON e contexto; abaixo, uma faixa de três paradas ligadas em azul com a atual em amarelo. Título e instrução específicos da etapa conduzem ao conteúdo. Na primeira parada, Ler QR Code tem ação secundária clara e o campo do código aceita digitação; ação primaria Continuar fica ao final, acima dos insets. Nas demais paradas a mesma estrutura mantém nome, revisão e registro sem perder orientação, inclusive com teclado.

FORM: Primeira direção da lista ordenada de sete candidatos; selecionada como IMPECCABLE’S PICK pelo usuário; seed:276146c7cb77736f. A assinatura de movimento é a parada atual avançando pela rota com um fade e deslize horizontal direcional de 240 ms no avanço e no retorno, respeitando a remoção de animações do sistema.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
