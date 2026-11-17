---
version: 1
slug: "src-views-settings-tsx"
primary_target: "src/views/settings.tsx"
related_targets: ["src/views/settings-parts/shared.tsx"]
---

# Configurações

Scope: tela de Configurações (Operate). Visitante: o dono, no PC e no celular, ajustando o painel ou conferindo se cada parte do sistema está ligada e saudável. Restrições: identidade do DESIGN.md intacta; textos em português; sem mudar contratos de API.

Decisão: grupos de 6 em vez de 5/4/3 (Operação/Sistema/Acesso) para fechar a grade de 3 e 2 colunas sem vagas, pela regra No Dead Gap do DESIGN.md.

## Direction contract

THESIS: Configurações como um rack de módulos com luz de estado: cada subsistema mostra se está ok, com aviso ou desligado antes de qualquer formulário. Recusa a pilha longa de cards cinza iguais com formulários sempre abertos.

OWN-WORLD: preto, grafite surface, fio de 1px, cantos 6px; luz de estado (ok/warn/crit/neutro) só para estado; valor-chave de cada módulo em JetBrains Mono tabular; módulo aberto vira o painel em foco (ol-glow + retícula HUD).

STORY: o dono bate o olho no quadro de luzes, vê o que precisa de atenção, abre só aquele módulo, ajusta e fecha.

FIRST VIEWPORT: título da tela; quadro de luzes (anunciador) com uma célula por módulo e contagem ok/aviso/desligado; abaixo, dois grupos de seis módulos, "Uso do dia a dia" e "Sistema", em grade de 3 colunas (2 no tablet, 1 no celular) com módulos fechados mostrando luz, título, valor-chave e uma linha de detalhe.

FORM: rack de módulos, posição 4 da lista; seed:fcb4e80ae58fc63f. Assinatura: o quadro anunciador clicável e o painel do módulo aberto aparece logo abaixo da linha dele, sem tirar nenhum módulo do lugar, com hash na URL (#ia).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
