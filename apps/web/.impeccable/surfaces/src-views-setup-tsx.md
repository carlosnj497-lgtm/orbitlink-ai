---
version: 1
slug: "src-views-setup-tsx"
primary_target: "src/views/setup.tsx"
related_targets: ["src/views/diagnostics-parts/checklist.tsx"]
---

# Teste de Conexão

Scope: tela de Teste de Conexão (Operate). Visitante: o dono instalando ou depurando a ligação entre o servidor e a antena. Restrições: somente leitura; POST /diagnose inalterado; não roda na demonstração.

## Direction contract

THESIS: o teste abre com o resultado numa frase ("5 de 7 verificações passaram; o roteador não foi encontrado") e a ação de executar; cada verificação vira item do checklist com o que testa, a evidência e o que fazer. Recusa o X vermelho para opcional desligado e a coluna estreita de passos sem explicação.

OWN-WORLD: identidade do DESIGN.md; passou/falhou em verde/vermelho, opcional desligado como "pulado" em cinza com selo "opcional", não testado em círculo tracejado; veredito como painel em foco com o botão primário.

STORY: o dono executa o diagnóstico no painel em foco, lê a frase, abre o item que falhou e segue a orientação; a matriz de capacidades, a orientação do agente e a rede local ficam ao lado/abaixo; "Como validar na sua rede" sempre visível.

FIRST VIEWPORT: veredito com contagem (passaram/falharam/aguardando/opcionais desligados) e "Executar diagnóstico"; checklist de 7 verificações; à direita, "Como validar na sua rede".

FORM: seed: none (pinned) — "Checklist com veredito — Cada ferramenta abre com o resultado numa frase e segue como checklist (passou / atenção / falhou / pulado), cada item expansível. A Central de IA fica como conversa, com as mesmas cores de estado.". Assinatura: o checklist expansível compartilhado (diagnostics-parts/checklist.tsx).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
