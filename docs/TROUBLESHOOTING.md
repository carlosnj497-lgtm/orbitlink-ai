# Solução de problemas

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| "Antena inacessível" / `TCP 192.168.100.1:9200: timeout` | PC fora da rede da Starlink, roteador próprio sem rota ou antena desligada/inicializando | Conecte ao Wi-Fi da Mini, ou adicione no seu roteador a rota estática `192.168.100.1/32 → WAN`. Aguarde 2 a 5 min após ligar. Rode `scripts\diagnose.ps1` |
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
| `npm run build` falha por fonte/rede | — | O painel usa fontes do sistema, sem download. Rode `npm install` de novo |
| Acentos estranhos nos scripts | PowerShell 5.1 sem BOM | Os `.ps1` são salvos em UTF-8 com BOM. Não converta |

Logs: `data\run\agent.log` (JSON: `ts`, `level`, `cid` = correlation id), `data\run\web.log`. Cada resposta do agente tem `X-Request-ID`.
