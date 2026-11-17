---
version: 1
slug: "src-views-assistant-tsx"
primary_target: "src/views/assistant.tsx"
related_targets: ["src/views/diagnostics-parts/checklist.tsx"]
---

# Central de IA

Scope: tela da Central de IA (Operate). Visitante: o dono perguntando sobre a conexão. Restrições: conversa preservada (histórico, nova, apagar com confirmação, apagar todas), IA só lê; propostas exigem confirmação no Controle.

## Direction contract

THESIS: continua conversa; o idioma de checklist entra como estado: linha do motor no topo (Groq ligado em verde ou só regras desligado, perguntas de hoje contra o limite com medidor) e, em cada resposta, os dados consultados como lista com luz verde, proposta de ação em atenção e erro em falha. Recusa selos soltos no cabeçalho e chips azuis para algo que não é ação.

OWN-WORLD: identidade do DESIGN.md; chat como painel em foco (ol-glow); estados com as mesmas luzes de diagnostics-parts/checklist.tsx.

STORY: o dono vê na linha do motor se a IA está ligada e quanto do limite usou, pergunta, lê a resposta e confere quais dados foram consultados; retoma conversas pelo histórico.

FIRST VIEWPORT: descrição; linha de estado do motor; histórico à esquerda; conversa com sugestões; ferramentas e segurança abaixo/à direita.

FORM: seed: none (pinned) — "Checklist com veredito — Cada ferramenta abre com o resultado numa frase e segue como checklist (passou / atenção / falhou / pulado), cada item expansível. A Central de IA fica como conversa, com as mesmas cores de estado.". Assinatura: bloco "Dados consultados" com luz verde por ferramenta em cada resposta.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
