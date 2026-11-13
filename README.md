# OrbitLink AI

Plataforma local para **monitorar, diagnosticar e controlar com segurança** uma Starlink Mini, com nó IoT ESP32 opcional, sincronização opcional com Supabase e copiloto Claude opcional.

> Projeto **independente**, sem afiliação com a Starlink/SpaceX. Usa somente a API local gRPC que a própria antena expõe na sua rede.

## Princípios

- **Funciona 100% local**, sem Docker e sem serviço pago. Supabase, Claude e ESP32 são opcionais.
- **Toda métrica mostra a origem**: `real`, `calculada`, `estimada`, `importada`, `sensor_esp32`, `indisponível` ou `demonstração`.
- **Nada é inventado.** Campo ausente no firmware fica ausente, lacuna de observação nunca vira zero, e tráfego corrente nunca é rotulado como teste de velocidade.
- **Ações só com confirmação humana.** Reiniciar a antena exige a matriz de capacidades, um administrador, um código de uso único e fica auditado. A IA apenas propõe.
- **O modo demonstração vive só em `/demo`**, com faixa permanente. O modo fixture do agente é sinalizado em todas as telas.

## Estado atual (honesto)

| Componente | Situação |
|---|---|
| Conector gRPC (reflection) | Implementado e testado contra servidor gRPC **sintético** com reflection. **Não validado em antena real**, porque a Mini ainda não chegou. |
| Diagnóstico (`diagnose`) | Executado de verdade neste PC. Reporta corretamente "antena inacessível" e orienta sobre rota/bypass. |
| Agente (coleta, SQLite, API, SSE, alertas, relatórios) | Implementado. 84 testes pytest, ruff e mypy strict OK. Dependências travadas com hash (`requirements.lock`). |
| Painel Next.js (14 telas + `/demo`) | Implementado. 21 testes Vitest e 9 E2E Playwright (incluindo axe, sem violações sérias). |
| Franquia do plano e notificações | Percentual do ciclo, projeção e alertas em 80%/100% (estimativa local). Envio por Telegram e webhook com fila que sobrevive à queda da internet. Testado com servidor HTTP simulado; **ainda não testado com um bot real**. |
| Supabase (migrations + RLS + ingestão) | 11 testes de isolamento em Postgres real (PGlite). **Ainda não aplicado ao seu projeto**: requer sua confirmação. |
| Firmware ESP32 | Compila (`esp32dev` e `esp32dev_sensors`). **Não gravado em placa.** Emulador incluso. |
| Claude | Loop de ferramentas somente leitura, testado com cliente simulado. Sem chave, usa diagnóstico por regras. |
| Painel remoto via Supabase | **Não implementado nesta entrega.** A nuvem recebe dados sincronizados e protegidos por RLS, mas o painel lê apenas o agente local. |
| Implantação Ubuntu 24.04 (`deploy/linux`) | Scripts verificados com `bash -n` e `shellcheck`, 51 testes da `lib.sh` e dos modelos. O CI tem um job que instala de verdade num Ubuntu 24.04 limpo. **Passou em 13/11/2026** no repositório privado (instalação, saúde, superfície exposta, backup, update, rollback e reinício automático). |
| CI (GitHub Actions) | `.github/workflows/ci.yml`: agente, painel, Supabase, E2E, scripts, auditoria de vulnerabilidades e instalação real no Ubuntu. Validado com `actionlint`. Roda a cada push e PR; verde desde 13/11/2026. |

## Início rápido (Windows 10/11, PowerShell)

```powershell
# Pré-requisitos: Python 3.11+ e Node.js 20+ (LTS)
cd C:\caminho\para\starlink
powershell -ExecutionPolicy Bypass -File scripts\install.ps1      # venv, npm, .env com token, build
powershell -ExecutionPolicy Bypass -File scripts\diagnose.ps1     # rede + antena (somente leitura)
powershell -ExecutionPolicy Bypass -File scripts\start.ps1        # agente :8787 + painel :3000
# abra http://127.0.0.1:3000 e crie o administrador local
powershell -ExecutionPolicy Bypass -File scripts\stop.ps1
```

Demonstração sem antena: <http://127.0.0.1:3000/demo> (dados fictícios, sinalizados).

## Servidor Linux (Ubuntu Server 24.04 LTS, sem Docker)

```bash
git clone <seu-repo> ~/orbitlink && cd ~/orbitlink
sudo bash deploy/linux/install.sh            # systemd + Nginx (TLS) + UFW; opções: --with-tailscale --esp32 --harden-ssh
sudo cat /etc/orbitlink/setup-code           # código para criar o 1º administrador em https://IP-DO-SERVIDOR/
sudo orbitlinkctl status | logs agent -f | diagnose | doctor | restart | update --git-pull | rollback | backup
```

Os serviços `orbitlink-agent` e `orbitlink-web` reiniciam sozinhos em falhas e registram logs no journald. Agente e painel escutam só em loopback; o Nginx publica o painel apenas para a LAN e a Tailnet. Guia completo: [docs/LINUX_SERVER.md](docs/LINUX_SERVER.md).

## Estrutura

```
apps/agent/          Agente Python (FastAPI, gRPC reflection, SQLite WAL, SSE, alertas, IA, sync)
apps/web/            Painel Next.js 16 (App Router, Tailwind 4, TanStack Query, Recharts)
apps/esp32-firmware/ Firmware PlatformIO/Arduino do nó ESP32
packages/shared/     Contratos TS + tipos gerados do OpenAPI do agente
supabase/            Migrations SQL (RLS) e testes de isolamento (PGlite)
scripts/             install/start/stop/diagnose/install-task (.ps1) e emulador ESP32
docs/                Arquitetura, compatibilidade, segurança, ESP32, Windows, solução de problemas, aceitação
```

## Comandos

| Comando (raiz) | O que faz |
|---|---|
| `npm run diagnose` | Diagnóstico da rede/antena |
| `npm run test` | pytest (agente) + Vitest (painel) + RLS (Supabase/PGlite) |
| `npm run test:e2e` | Playwright: agente em modo fixture + painel em produção |
| `npm run lint` / `npm run typecheck` | ESLint + ruff / tsc + mypy strict |
| `npm run build` | Build de produção do painel |
| `npm run gen:types` | Regenera os tipos TS do OpenAPI do agente |
| `npm run lock:agent` | Regenera `apps/agent/requirements*.lock` (versões + hashes). Requer `pip install uv`. Para atualizar tudo: `npm run lock:agent -- --upgrade` |
| `npm run audit` | Vulnerabilidades conhecidas: `npm audit` + `pip-audit` |
| `npm run test:deploy` | Testes dos scripts do servidor Linux (rodam em qualquer bash) |

Ao mudar dependências Python em `apps/agent/pyproject.toml`, rode `npm run lock:agent` e commite os dois `.lock`: o CI falha se eles estiverem desatualizados.

Documentação: [docs/WINDOWS_SETUP.md](docs/WINDOWS_SETUP.md) · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/STARLINK_COMPATIBILITY.md](docs/STARLINK_COMPATIBILITY.md) · [docs/SECURITY.md](docs/SECURITY.md) · [docs/ESP32_SETUP.md](docs/ESP32_SETUP.md) · [docs/SUPABASE.md](docs/SUPABASE.md) · [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) · [docs/ACCEPTANCE_TESTS.md](docs/ACCEPTANCE_TESTS.md)

Créditos: a lógica de leitura do histórico circular segue o modelo documentado pela [starlink-grpc-tools](https://github.com/sparky8512/starlink-grpc-tools) (Unlicense). O código foi reescrito, não copiado.
