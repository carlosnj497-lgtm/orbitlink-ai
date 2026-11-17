---
version: 1
slug: "src-views-diagnostics-tsx"
primary_target: "src/views/diagnostics.tsx"
related_targets: ["src/views/diagnostics-parts/checklist.tsx","src/views/diagnostics-parts/hourly-strip.tsx"]
---

# Diagnósticos

Scope: tela de Diagnósticos (Operate). Visitante: o dono, querendo saber se o período teve problema e por quê. Restrições: identidade do DESIGN.md; sem mudar contratos de API; distinção honesta entre evento observado, causa confirmada e hipótese.

## Direction contract

THESIS: o resultado do período numa frase ("2 achados de atenção nas últimas 24 h, nenhuma falha") seguido de um checklist de achados e de medições, cada item expansível com natureza, evidência e o que fazer. Recusa o card de resumo com lista solta e o anel de pontuação como protagonista.

OWN-WORLD: preto, grafite, fio 1px, cantos 6px; verde/amarelo/vermelho só para estado do item, com ícone de forma diferente por estado; números em JetBrains Mono tabular; veredito como único painel em foco (ol-glow + retícula); hipótese com selo tracejado neutro, nunca vermelho.

STORY: o dono lê o veredito e a contagem por estado, abre o achado de atenção, vê a evidência e o link para a tela certa; desce às medições do período (cobertura, estabilidade, perda com barras por hora, latência, obstrução) para confirmar.

FIRST VIEWPORT: descrição e período (24h/7d/30d); painel de veredito com frase, manchete do motor, aviso de hipótese, contagem falhas/atenção/informativo, motor e origem; início do checklist "Achados".

FORM: seed: none (pinned) — "Checklist com veredito — Cada ferramenta abre com o resultado numa frase e segue como checklist (passou / atenção / falhou / pulado), cada item expansível. A Central de IA fica como conversa, com as mesmas cores de estado.". Assinatura: item de checklist com luz/ícone de estado e expansão no lugar (aria-expanded), e barras de perda por hora como evidência dentro do item "Perda de pacotes".

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
