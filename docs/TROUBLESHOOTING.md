# Solução de problemas

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| "Antena inacessível" / `TCP IP-DA-ANTENA:9200: timeout` | PC fora da rede da Starlink, roteador próprio sem rota ou antena desligada/inicializando | Conecte ao Wi-Fi da Mini, ou adicione no seu roteador a rota estática `IP-DA-ANTENA/32 → WAN` (`IP-DA-ANTENA` é o endereço local da antena, em `ORBITLINK_DISH_TARGET` no `.env`). Aguarde 2 a 5 min após ligar. Rode `scripts\diagnose.ps1` |
| `conexão recusada` em 9200 | Host responde mas a porta está fechada | Firmware muito antigo ou outro dispositivo nesse IP. Confira o IP da antena |
| `O dispositivo não oferece gRPC reflection` | Firmware sem reflection | Abra uma issue com o relatório `diagnose --share` |
| Capacidade `negada` no reboot | O firmware bloqueia controle local | Use o app oficial para reiniciar. O OrbitLink não contorna isso |
| Painel mostra "Agente OrbitLink offline" | Agente parado ou porta 8787 ocupada | Veja `data\run\agent.log` e rode `scripts\start.ps1` |
| "ORBITLINK_API_TOKEN não configurado" | `.env` ausente ou vazio | `scripts\install.ps1 -SkipBuild` cria o arquivo |
| Login sempre falha com 429 | Muitas tentativas | Aguarde 5 min |
| Gráficos vazios com a antena acessível | Histórico ainda sem amostras ou firmware sem `get_history` | Aguarde 30 s. Veja Controle → Matriz de capacidades |
| Consumo diferente da conta oficial | Estimativa local, períodos sem observação, outros dispositivos ou arredondamentos | Veja a cobertura. Importe o CSV oficial em Consumo |
| ESP32 "sem heartbeat" | Wi-Fi, IP do agente errado, firewall na 8788 ou relógio fora da janela | Monitor serial a 115200. Confira a regra de firewall (perfil Privado). Segure BOOT por 5 s para reconfigurar |
| ESP32 401 "Relógio fora da janela" | Sem NTP e sem sincronização com o agente | O firmware ressincroniza sozinho. Confira se o agente responde em `/esp32/v1/time` |
| Sync pendente cresce | Sem internet, chave anon errada ou token revogado | `GET /v1/sync` mostra `last_error`. Os dados não se perdem |
| Assistente: "Limite diário" | `ORBITLINK_AI_DAILY_REQUEST_LIMIT` | Ajuste no `.env` |
| Bot: "Não consegui transcrever o seu áudio" | Groq indisponível ou áudio sem fala reconhecível | Tente de novo; se persistir, escreva a pergunta. Confira `ORBITLINK_AI_TRANSCRIBE_MODEL` |
| Bot: "Limite diário de N áudios" | `ORBITLINK_AI_AUDIO_DAILY_REQUEST_LIMIT` | Ajuste no `.env` (a cota de áudio é separada da de texto) |
| Bot: "Não consegui baixar o seu áudio" | Arquivo grande demais ou download recusado | `ORBITLINK_AI_AUDIO_MAX_BYTES` (padrão 20 MB). O Telegram envia Opus em `.ogg` |
| Bot não responde nada (sem erro no log) | O `offset` salvo passou do último `update_id` real: o Telegram devolve vazio para sempre e o bot fica mudo | O código detecta e reinicia a leitura sozinho. Se persistir, zere o offset: `sqlite3 data/orbitlink.sqlite3 "UPDATE settings_kv SET value='0' WHERE key='telegram:offset'"` |
| Bot não responde nada, log mostra `HTTP 409: Conflict` | **Duas instâncias do agente rodando ao mesmo tempo.** Uma consome as mensagens da outra | `pgrep -af "orbitlink-agent serve"` — deve aparecer só uma. Pare a outra antes de subir a nova. O serviço systemd (`systemctl status orbitlink-agent`) e uma instância manual não podem coexistir |
| Bot não responde nada depois de mandar áudio | Faltam `ORBITLINK_GROQ_API_KEY` ou `ORBITLINK_TELEGRAM_CHAT_ID` | O bot responde texto mesmo sem chave; áudio exige a chave da Groq |
| `npm run build` falha por fonte/rede | — | O painel usa fontes do sistema, sem download. Rode `npm install` de novo |
| Acentos estranhos nos scripts | PowerShell 5.1 sem BOM | Os `.ps1` são salvos em UTF-8 com BOM. Não converta |

Logs: `data\run\agent.log` (JSON: `ts`, `level`, `cid` = correlation id), `data\run\web.log`. Cada resposta do agente tem `X-Request-ID`.
