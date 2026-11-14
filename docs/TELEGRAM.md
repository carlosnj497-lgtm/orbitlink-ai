# Central Telegram do OrbitLink

Envie `/start` ou `/menu` no chat autorizado para abrir a central com botões.
O menu de comandos é registrado automaticamente quando o agente inicia.

| Comando | Consulta |
|---|---|
| `/status` | Diagnóstico por regras das últimas 24 horas |
| `/consumo` | Download, upload e cobertura observada |
| `/franquia` | Limite, saldo estimado e projeção do ciclo |
| `/qualidade` | Disponibilidade, latência, jitter e perda |
| `/quedas` | Até 10 interrupções recentes |
| `/alertas` | Até 10 alertas ativos mais recentes |
| `/resumo` | Resumo consolidado dos últimos 7 dias |
| `/bot` | Recursos habilitados, cota de IA e fila de notificações |
| `/nova` | Desvincula o contexto atual; não apaga o histórico do painel |
| `/audio ligar` ou `/audio desligar` | Ativa ou desativa respostas faladas do assistente |
| `/ajuda` | Comandos e exemplos |

Consumo, qualidade e quedas aceitam `1h`, `6h`, `24h`, `7d` e `30d`.
Exemplo: `/consumo 7d`. Sem argumento, usam as últimas 24 horas.
Os botões de período executam uma nova consulta e mostram seu intervalo e fuso.

Essas consultas funcionam sem IA. Para conversar, envie uma pergunta em texto
ou uma nota de voz (se a transcrição estiver habilitada). Texto e voz mantêm o
mesmo contexto; a cota diária de perguntas é compartilhada com o painel.

### Respostas em voz

As respostas do assistente são enviadas em texto e como nota de voz MP3.
Isso vale para perguntas escritas e ditadas; consultas diretas como `/status`
continuam em texto. A preferência de `/audio` sobrevive a reinícios.

A síntese usa o serviço online de leitura do Microsoft Edge via `edge-tts`,
sem chave adicional. O texto da resposta é enviado à Microsoft para gerar a voz;
o áudio permanece em memória e não é salvo em disco. O serviço requer internet
e pode ficar indisponível: nesse caso, a resposta escrita continua disponível.

- `ORBITLINK_TELEGRAM_VOICE_REPLIES=true`: preferência inicial para respostas faladas.
- `ORBITLINK_AI_TTS_VOICE=pt-BR-FranciscaNeural`: voz brasileira.
- `ORBITLINK_AI_TTS_TIMEOUT_S=45`: tempo máximo da síntese.
- `ORBITLINK_AI_TTS_MAX_CHARS=3000`: limite de texto falado por resposta.

Respostas longas têm áudio abreviado com aviso; o texto permanece completo.
Depois de atualizar, instale `requirements.lock` e reinicie o agente.

## Configuração

Use as variáveis existentes do agente:

- `ORBITLINK_TELEGRAM_BOT_TOKEN`: token fornecido pelo BotFather.
- `ORBITLINK_TELEGRAM_CHAT_ID`: chat autorizado.
- `ORBITLINK_TELEGRAM_CHAT_ENABLED`: habilita o bot de conversa.
- `ORBITLINK_GROQ_API_KEY`: habilita as perguntas livres com IA.

Reinicie o agente após mudar a configuração ou atualizar o código.
Execute somente um consumidor de `getUpdates` para o mesmo token.
O agente usa long polling e não precisa de porta pública para receber mensagens.

Para publicar nome, descrição, apresentação e os comandos diretamente na
Bot API (idioma padrão e português), execute:

```bash
cd apps/agent
.venv/bin/python -m orbitlink_agent.ai.telegram_setup
```

O comando usa o token do ambiente do projeto sem exibi-lo e confere a
configuração publicada. O nome de usuário `@...` é administrado pelo BotFather.

Somente o chat configurado pode consultar dados, inclusive pelos botões.
Em grupos autorizados, os participantes têm acesso às consultas do grupo.
O Telegram não executa ações de controle da antena: propostas continuam sendo
confirmadas pelo administrador no painel.

O consumo é uma estimativa local, não a fatura da Starlink. Ausência de coleta
não significa consumo zero ou disponibilidade de 100%. Qualidade apresenta a
origem e a cobertura; a latência é medida entre a antena e o PoP.

## Verificação

```bash
cd apps/agent
.venv/bin/python -m pytest tests/test_telegram_bot.py tests/test_audio.py tests/test_digest.py
```

Os testes usam a API do Telegram simulada. No bot real, confira `/menu`, um
botão de período, uma pergunta escrita e uma nota de voz.
