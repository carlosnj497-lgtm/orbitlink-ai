# Critérios de aceitação

Situação em 13/11/2026. ✅ = verificado por teste automatizado ou execução real. 🟡 = implementado, mas depende de hardware ou credencial do usuário.

| # | Critério | Situação | Evidência |
|---|---|---|---|
| 1 | Diagnóstico identifica se a Starlink é alcançável e quais chamadas funcionam | ✅ / 🟡 | `diagnose` executado neste PC ("inacessível", com orientação). Matriz testada contra servidor gRPC sintético com reflection (`test_connector.py`). **Falta rodar com a Mini real** |
| 2 | Interface distingue Starlink, roteador, agente e ESP32 | ✅ | Indicadores separados no cabeçalho, Saúde da coleta, Dispositivos, Centro ESP32 e matriz por dispositivo |
| 3 | Telemetria real quando conectada e indisponibilidade honesta quando não | ✅ / 🟡 | E2E em modo fixture e smoke real com a antena inacessível (`available:false`, gráficos vazios e lacuna `dish_unreachable`) |
| 4 | Tráfego atual não rotulado como teste de velocidade | ✅ | Notas "tráfego corrente, não capacidade" e "Ocioso" para 0 (E2E + `test_zero_throughput_is_idle_not_degraded`) |
| 5 | Consumo estimado com origem e método transparentes | ✅ | `source=calculada`, cobertura, texto de método em tela e nos relatórios |
| 6 | Coleta histórica idempotente e resistente a reinícios e lacunas | ✅ | `test_history.py` (wrap, reset, lacuna) e `test_collector.py` (idempotência, boot, overrun) |
| 7 | Autenticação e isolamento por usuário | ✅ / 🟡 | Local: `test_api.py` e E2E. Nuvem: `supabase/tests/rls.test.ts` (PGlite). **Falta aplicar no seu projeto** |
| 8 | Controles inexistentes desabilitados e críticos com confirmação | ✅ | `test_control_*`, E2E com resultado `failed` real e prepare recusado sem capacidade |
| 9 | Agente coleta sem internet/Supabase e sincroniza depois | ✅ | `test_sync.py` (offline → fila → online → drenado) |
| 10 | ESP32 envia dados autenticados, e sem ESP32 tudo funciona | ✅ / 🟡 | `test_esp32_pair_ingest_replay_and_power_event` e firmware compilado. **Falta gravar na placa** |
| 11 | Testes e instruções para Windows sem Docker | ✅ | `install.ps1` executado com sucesso, `start/stop.ps1` testados, docs |
| 12 | Botões e telas essenciais funcionam, com mensagens úteis em falhas | ✅ | 14 rotas + `/demo` + login. E2E e axe sem violações sérias |
| 13 | README, `.env.example`, migrations, scripts e documentação | ✅ | Este repositório |
| 14 | Implantação em Ubuntu Server 24.04 (systemd, Nginx, UFW, journald, Tailscale opcional) | ✅ / 🟡 | `deploy/linux`: `bash -n` + `shellcheck` limpos, `npm run test:deploy` (51 testes da `lib.sh` e dos modelos do Nginx e do systemd), testes Python de rotas `ip -j`, Fernet e código de setup. O job `install-ubuntu` do CI instala num Ubuntu 24.04 limpo e testa saúde, portas, update, rollback e reinício automático. **Verde no GitHub Actions em 13/11/2026**; o primeiro run achou e corrigiu um bug real (o build executava o `astryon.env`). 🟡: o Tailscale não é testado no CI |
| 15 | Franquia do plano: % do ciclo, projeção e alertas em 80%/100%, sem apresentar estimativa como valor oficial | ✅ | `test_notify.py` (ciclo de cobrança, cobertura parcial como "≥", regras semeadas em banco existente) e `usage.test.tsx` |
| 16 | Alertas fora do painel (Telegram/webhook), inclusive quando a internet cai | ✅ / 🟡 | `test_notify.py`: fila persistente, reenvio com atraso sinalizado, erro permanente, limite de taxa, expiração e token fora dos logs. **Falta testar com um bot real** |
| 17 | Dependências reproduzíveis e auditadas | ✅ | `requirements.lock` com hash instalado no Windows e baixado para Linux (`pip download --platform manylinux…`). `npm audit` e `pip-audit` sem vulnerabilidades em 13/11/2026 |

## Como reproduzir

```powershell
npm run test         # 84 pytest + 21 vitest + 11 RLS
npm run test:deploy  # 51 testes dos scripts do servidor Linux
npm run audit        # npm audit + pip-audit
npm run test:e2e     # 9 Playwright (requer: npx playwright install chromium)
npm run lint; npm run typecheck; npm run build
```

## Validação manual pendente (seu ambiente)

1. **Antena:** `scripts\diagnose.ps1` na rede da Mini. Confirmar a matriz e os selos **real** na Visão Geral.
2. **Reiniciar:** em Controle, só se a matriz mostrar "No schema". O resultado real (aceito ou negado) fica auditado.
3. **Roteador:** em Dispositivos, "Consultar roteador". Funciona só se `wifi_get_clients` estiver verificado.
4. **Supabase:** aplicar a migration, parear o agente e checar se `GET /v1/sync` zera a fila.
5. **ESP32:** gravar via USB, parear e ver o nó online.
6. **IA (Groq):** definir `ASTRYON_GROQ_API_KEY` e perguntar "Como está minha Starlink agora?".
7. **Telegram:** configurar o bot, clicar em Alertas → Enviar teste e conferir a mensagem no celular. Depois, em Alertas → Resumo semanal → **Enviar agora** e `/resumo` no bot: os números devem bater com as telas Consumo e Qualidade (últimos 7 dias).
8. **CI:** ✅ feito em 13/11/2026 (repositório privado, todos os jobs verdes). A cada mudança, conferir o run no GitHub Actions.
