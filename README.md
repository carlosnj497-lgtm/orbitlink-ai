<div align="center">

<img src="docs/screenshots/banner.webp" alt="ASTRYON — monitoramento local de antenas Starlink" width="100%">

# ASTRYON

### 📡 Monitoramento local da sua antena Starlink, com histórico completo.

**Painel em tempo real · Alertas no Telegram · Assistente de IA · Controle auditado da antena**

<sub>100% na sua rede — sem Docker, sem nuvem obrigatória, sem dado inventado.</sub>

<!-- Ações principais -->
[![Baixar para Windows](https://img.shields.io/badge/Baixar_para_Windows-0078D4?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/carlosnj497-lgtm/orbitlink-ai/releases/latest)
[![Ver telas](https://img.shields.io/badge/Ver_telas-374151?style=for-the-badge)](#-telas)
[![Documentação](https://img.shields.io/badge/Documenta%C3%A7%C3%A3o-374151?style=for-the-badge)](#-documentação)
[![English](https://img.shields.io/badge/English-374151?style=for-the-badge)](#-english)

<!-- Status do projeto -->
[![CI](https://img.shields.io/github/actions/workflow/status/carlosnj497-lgtm/orbitlink-ai/ci.yml?style=flat-square&label=CI&labelColor=0f172a)](https://github.com/carlosnj497-lgtm/orbitlink-ai/actions/workflows/ci.yml)
[![Versão](https://img.shields.io/github/v/release/carlosnj497-lgtm/orbitlink-ai?style=flat-square&label=vers%C3%A3o&labelColor=0f172a&color=22c55e)](https://github.com/carlosnj497-lgtm/orbitlink-ai/releases/latest)
[![Licença](https://img.shields.io/badge/licen%C3%A7a-MIT-22c55e?style=flat-square&labelColor=0f172a)](LICENSE)
[![Estrelas](https://img.shields.io/github/stars/carlosnj497-lgtm/orbitlink-ai?style=flat-square&label=estrelas&labelColor=0f172a&logo=github&logoColor=white)](https://github.com/carlosnj497-lgtm/orbitlink-ai/stargazers)

<!-- Stack -->
![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB?style=flat-square&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-WAL-003B57?style=flat-square&logo=sqlite&logoColor=white)
![Ubuntu](https://img.shields.io/badge/Ubuntu-24.04-E95420?style=flat-square&logo=ubuntu&logoColor=white)
![Windows](https://img.shields.io/badge/Windows-10%2F11-0078D4?style=flat-square&logo=windows&logoColor=white)

<sub>🐛 Encontrou um problema? [Abra uma issue](https://github.com/carlosnj497-lgtm/orbitlink-ai/issues)</sub>

</div>

<p align="center">
  <img src="docs/screenshots/ao-vivo.webp" alt="Tela Ao Vivo do ASTRYON em funcionamento" width="900"><br>
  <sub>Tela Ao Vivo na demonstração (dados fictícios, acelerada 4×) / Live screen in demo mode (fictitious data, 4× speed).</sub>
</p>

---

<p align="center">🇧🇷 <b>Português</b> · 🇺🇸 <a href="#-english">English</a></p>

## 🚀 Início rápido (Linux)

**Pré-requisitos (Linux):** Ubuntu Server 24.04 LTS e um computador na mesma rede da antena. O instalador cuida de Python, Node.js, Nginx e das demais dependências.

🐧 **Linux (recomendado)** · 🪟 [Windows 10/11](#-instalação)

1. **Clone o repositório e entre na pasta**

   ```bash
   git clone https://github.com/carlosnj497-lgtm/orbitlink-ai.git ~/astryon
   cd ~/astryon
   ```

2. **Instale e suba os serviços**

   ```bash
   sudo bash deploy/linux/install.sh
   ```

3. **Copie o código de configuração**

   ```bash
   sudo cat /etc/astryon/setup-code
   ```

4. Abra `https://SEU-IP/` e crie o administrador com esse código.

Pronto — o agente está no ar e vai começar a ler a sua antena assim que ela estiver acessível na rede. 📡

O projeto usa o mesmo prefixo em tudo: variáveis `ASTRYON_*`, serviços `astryon-*` e o comando `astryonctl`.

🎮 **Sem antena por perto?** Abra `https://SEU-IP/demo` · 🔄 **Vindo do nome antigo?** Veja [Migração para ASTRYON](docs/MIGRATION_ASTRYON.md)

> [!IMPORTANT]
> **Projeto independente, sem afiliação com a Starlink ou a SpaceX.** Usa apenas a API local gRPC que a própria antena expõe na sua rede.
>
> **Modelos:** Mini · Standard (e gerações anteriores) · Standard Actuated · High Performance · Flat High Performance. A compatibilidade depende do firmware de cada antena — a validação em hardware real ainda está pendente. Veja a [compatibilidade por modelo](docs/STARLINK_COMPATIBILITY.md).

---

## 📑 Sumário

**🚀 Começando**
- [Início rápido](#-início-rápido-linux)
- [Instalação](#-instalação)

**🛰️ O projeto**
- [Por que ASTRYON?](#-por-que-o-astryon)
- [O que ele faz](#-o-que-ele-faz)
- [Telas](#-telas)
- [Princípios](#-princípios)
- [Compatibilidade](#-compatibilidade)
- [Privacidade e segurança](#-privacidade-e-segurança)
- [Arquitetura](#-arquitetura)
- [Estado do projeto](#-estado-do-projeto)
- [Roteiro](#-roteiro)

**🔌 Uso e integrações**
- [Telegram e IA](#-telegram-e-ia)
- [Perguntas frequentes](#-perguntas-frequentes)
- [Documentação](#-documentação)

**🤝 Comunidade**
- [Desenvolvimento](#-desenvolvimento)
- [Contribuição](#-contribuição)
- [Créditos](#-créditos--credits)

🌐 [English version](#-english)

## 💡 Por que o ASTRYON?

O app oficial da Starlink mostra o estado atual e um histórico recente. O ASTRYON guarda o que a antena expõe — amostras de 1 s, agregados por minuto e eventos — e transforma esses dados em painel, alertas e respostas:

| 📱 App oficial | 🛰️ Com o ASTRYON |
|---|---|
| Status atual + histórico curto | 🗂️ **Seu histórico** — amostras de 1 s por 7 dias e agregados por minuto por 400 dias (padrão), no seu computador |
| Quedas recentes no histórico do app | 🌙 **Quedas registradas** — horário, duração e causa (quando a antena informa), inclusive de madrugada |
| Franquia na conta/app | 📦 **Franquia estimada** — consumo do ciclo, projeção do mês e avisos em 80% e 100% (estimativa local) |
| Alertas no app oficial | 📲 **Telegram** — alertas, resumo semanal e consultas, sem abrir o painel |
| Dados da antena | 🌧️ **Chuva ou antena?** — clima e conexão lado a lado, para comparar (sem afirmar causalidade) |
| Gráficos e estatísticas prontos | 🗣️ **Pergunte em português** — respostas com fonte e incerteza (IA Groq ou regras) |
| Dados na nuvem da Starlink | 🔒 **Dados com você** — tudo na sua rede; nuvem e serviços opcionais só se você configurar |

## ✨ O que ele faz

| Recurso | Detalhes |
|---|---|
| 📡 **Ao vivo** | Download, upload, latência e perda de pacotes com histórico de 1 s, pausa e exportação CSV. |
| 📊 **Consumo e franquia** | Consumo do ciclo, projeção mensal e alertas em 80% e 100% do plano (estimativa local pelo tráfego da antena), com importação do CSV oficial para comparar. |
| ✅ **Qualidade** | Disponibilidade, perda, jitter e percentis de latência por hora, comparação com o período anterior (com e sem chuva) e os melhores horários do dia. Segundos sem medição ficam fora da conta. |
| 🛰️ **Antena e obstruções** | Estado, firmware, mapa de céu visto pela antena e porcentagem de obstrução. |
| 📄 **Eventos e relatórios** | Linha do tempo de quedas com duração, causa (quando informada), confiança e clima; relatórios em PDF e exportação CSV/JSON. |
| 🔔 **Alertas** | Regras com debounce, histerese e cooldown, entregues pelo Telegram ou por webhook, com fila que sobrevive à queda da internet. |
| 🤖 **Central de IA** | Perguntas em português respondidas com os dados do agente (Groq). Sem chave, responde por regras. |
| 💬 **Bot do Telegram** | `/menu`, consultas por comando sem gastar IA, perguntas em texto ou nota de voz e resumo semanal. |
| 🔁 **Controle seguro e auditado** | Reiniciar a antena exige administrador, código de uso único e fica auditado. A IA só sugere. |
| 🌦️ **Clima (opcional)** | Clima da sua cidade pela Open-Meteo (gratuita): cartão no Dashboard, faixas de chuva nos gráficos e o tempo de cada queda em Eventos. |
| 🔌 **ESP32 (opcional)** | Sensores de tensão, falta de energia e temperatura, autenticados por HMAC. |
| 🏠 **Home Assistant (opcional)** | Sensores da Starlink no Home Assistant via MQTT, com descoberta automática. Veja [HOME_ASSISTANT.md](docs/HOME_ASSISTANT.md). |
| ☁️ **Supabase (opcional)** | Sincronização com RLS. O painel continua lendo só o agente local. |

## 📺 Telas

<p align="center">
  <img src="docs/screenshots/consumo.webp" alt="Tela de Consumo do ASTRYON com ciclo, projeção e evolução diária" width="720"><br>
  <sub><b>Consumo</b>: ciclo, projeção e evolução diária.</sub>
</p>

<p align="center">
  <img src="docs/screenshots/antena.webp" alt="Tela de Antena e Sinal do ASTRYON com estado, firmware e obstruções" width="720"><br>
  <sub><b>Antena e Sinal</b>: estado, firmware e obstruções.</sub>
</p>

<details>
<summary><b>Qualidade, Eventos e Relatórios</b></summary>
<br>
<p align="center">
  <img src="docs/screenshots/qualidade.webp" alt="Tela de Qualidade da Conexão do ASTRYON com disponibilidade, perda, latência e melhores horários" width="720"><br>
  <sub><b>Qualidade</b>: disponibilidade, perda, latência e horários.</sub>
</p>
<p align="center">
  <img src="docs/screenshots/eventos.webp" alt="Tela de Eventos do ASTRYON com quedas, duração, causa e clima" width="720"><br>
  <sub><b>Eventos</b>: quedas com duração, causa e clima.</sub>
</p>
<p align="center">
  <img src="docs/screenshots/relatorios.webp" alt="Tela de Relatórios do ASTRYON com PDF, CSV e backup JSON" width="720"><br>
  <sub><b>Relatórios</b>: PDF, CSV e backup JSON.</sub>
</p>
</details>

<details>
<summary><b>Central de IA e Login</b></summary>
<br>
<p align="center">
  <img src="docs/screenshots/central-ia.webp" alt="Tela da Central de IA do ASTRYON com perguntas e histórico de conversas" width="720"><br>
  <sub><b>Central de IA</b>: perguntas sobre a conexão com histórico de conversas.</sub>
</p>
<p align="center">
  <img src="docs/screenshots/login.webp" alt="Tela de login do ASTRYON para o administrador local" width="720"><br>
  <sub><b>Login</b>: administrador local criado na instalação.</sub>
</p>
</details>

<details>
<summary><b>Dashboard completo e versão para celular</b></summary>
<br>
<p align="center">
  <img src="docs/screenshots/dashboard.webp" alt="Dashboard completo do ASTRYON" width="720">
  &nbsp;
  <img src="docs/screenshots/celular.webp" alt="Dashboard do ASTRYON no celular" width="260">
</p>
</details>

Todas as capturas vêm da rota `/demo`, com dados fictícios e a faixa de demonstração sempre visível.

## 💎 Princípios

- **Funciona 100% local.** Sem Docker e sem serviço pago. Supabase, IA e ESP32 são opcionais.
- **Toda métrica mostra a origem**: `real`, `calculada`, `estimada`, `importada`, `sensor_esp32`, `indisponível` ou `demonstração`.
- **Nada é inventado.** Campo que o firmware não informa aparece como indisponível. Lacuna de observação nunca vira zero, e tráfego corrente nunca é chamado de teste de velocidade.
- **Ações só com confirmação humana.** A IA tem ferramentas somente de leitura.
- **Demonstração isolada.** Dados fictícios existem só em `/demo`, sempre sinalizados.

## 📡 Compatibilidade

- **Modelos alvo:** Mini · Standard (e gerações anteriores) · Standard Actuated · High Performance · Flat High Performance.
- **Validação em hardware real:** ainda não realizada (nov/2026); o conector foi testado contra servidor gRPC sintético com reflection.
- **Descoberta de capacidades:** o agente consulta o firmware por reflection em runtime; o que não for exposto aparece como indisponível.
- **Detalhes por modelo e firmware:** [docs/STARLINK_COMPATIBILITY.md](docs/STARLINK_COMPATIBILITY.md).

## 🔒 Privacidade e segurança

Por padrão, tudo fica no SQLite local. Estes são os únicos caminhos que podem sair da sua rede — todos opcionais:

- **Telegram** — alertas, resumo semanal, comandos e perguntas; só com o bot configurado.
- **Groq (IA e Whisper)** — a pergunta e os dados necessários para respondê-la; o áudio da nota de voz; só com a chave configurada.
- **Voz do bot (Microsoft)** — o texto da resposta; só se as respostas em voz estiverem ativadas.
- **Open-Meteo** — coordenadas da cidade (~1 km); só com o clima ativado.
- **Webhook** — o conteúdo do alerta; só com a URL configurada.
- **Supabase / painel na nuvem** — agregados por minuto (consumo, latência, perda, quedas), não as amostras de 1 s nem a lista de dispositivos; só se a nuvem for configurada.
- **ESP32** — os dados dos sensores ficam na rede local; o listener é local.

**Segurança:** segredos ficam no agente/servidor; o navegador nunca recebe tokens; ações de controle exigem administrador, código de uso único e auditoria. Modelo completo: [docs/SECURITY.md](docs/SECURITY.md). Para reportar uma vulnerabilidade, use a aba **Security** (relato privado).

## 🔧 Instalação

### Requisitos

- **Linux (recomendado):** Ubuntu Server 24.04 LTS, 2 GB+ de RAM, 4 GB livres em disco e acesso à rede da antena. O instalador cuida de Python, Node.js, Nginx e das demais dependências. x86_64 testado no CI; ARM64 ainda não validado.
- **Raspberry Pi (aparelho):** Pi 4 ou 5, 2 GB+ de RAM, cartão de 16 GB+ e Raspberry Pi OS Lite 64-bit. Script pronto; falta validar no hardware. Veja [docs/APARELHO.md](docs/APARELHO.md).
- **Windows 10/11:** Python 3.11+ e Node.js 20+; monitoramento enquanto o computador estiver ligado.

### Servidor Linux (Ubuntu Server 24.04 LTS), recomendado

Siga os passos do [Início rápido](#-início-rápido-linux). O instalador configura systemd + Nginx (TLS) + UFW, e o código em `/etc/astryon/setup-code` cria o primeiro administrador. Opções do instalador: `--with-tailscale`, `--esp32` e `--harden-ssh`.

```bash
sudo astryonctl status          # estado dos serviços
sudo astryonctl logs agent -f   # logs ao vivo
sudo astryonctl diagnose        # rede + antena (somente leitura)
sudo astryonctl doctor          # saúde + segurança
sudo astryonctl restart         # reinicia os serviços
sudo astryonctl update --git-pull
sudo astryonctl rollback
sudo astryonctl backup
```

**Atualização e backup:** `update --git-pull` usa troca atômica com rollback automático; `rollback` volta à versão anterior; `backup` gera um backup agora (o diário fica em `/var/lib/astryon/backups`, com 14 cópias). Guia: [docs/LINUX_SERVER.md](docs/LINUX_SERVER.md).

Os serviços `astryon-agent` e `astryon-web` reiniciam sozinhos em falhas e registram no journald. Agente e painel escutam só em loopback; o Nginx publica o painel apenas para a LAN e a Tailnet. Guia completo: [docs/LINUX_SERVER.md](docs/LINUX_SERVER.md).

<details>
<summary><b>🪟 Windows 10/11 (PowerShell)</b></summary>

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install.ps1    # venv, npm, .env com token, build
powershell -ExecutionPolicy Bypass -File scripts\diagnose.ps1   # rede + antena (somente leitura)
powershell -ExecutionPolicy Bypass -File scripts\start.ps1      # agente :8787 + painel :3000
```

Abra `http://localhost:3000` no próprio PC e crie o administrador. Para parar: `scripts\stop.ps1`. Guia: [docs/WINDOWS_SETUP.md](docs/WINDOWS_SETUP.md).

Prefere o instalador com ícone na bandeja? Baixe o `.exe` nas [releases do ASTRYON](https://github.com/carlosnj497-lgtm/orbitlink-ai/releases/latest) (em validação num Windows real).

</details>

> [!TIP]
> Sem antena por perto? Abra `https://SEU-IP/demo` (Linux) ou `http://localhost:3000/demo` (Windows) para ver o painel com dados fictícios.

## 🤖 Telegram e IA

1. Crie um bot no [@BotFather](https://t.me/BotFather) e coloque o token em `ASTRYON_TELEGRAM_BOT_TOKEN`.
2. Descubra o chat autorizado com `sudo astryonctl telegram-chat-id` (ou `python -m astryon_agent telegram-chat-id`) e preencha `ASTRYON_TELEGRAM_CHAT_ID`.
3. Opcional: coloque uma chave da [Groq](https://console.groq.com/keys) em `ASTRYON_GROQ_API_KEY` para respostas com IA e transcrição de notas de voz (Whisper).

| Comando | O que mostra |
|---|---|
| `/menu` | Central com botões |
| `/status` | Diagnóstico das últimas 24 h |
| `/consumo 7d` | Download, upload e cobertura no período |
| `/franquia` | Limite, saldo estimado e projeção do ciclo |
| `/relatorio` | PDF dos últimos 30 dias, com comparação e clima |

<details>
<summary><b>Ver todos os comandos</b></summary>

| Comando | O que mostra |
|---|---|
| `/qualidade` · `/quedas` · `/alertas` | Qualidade, interrupções (com o clima de cada uma) e alertas ativos |
| `/clima` | Clima agora, próximas horas e aviso de chuva forte |
| `/horario` | Melhores horários para downloads e chamadas |
| `/resumo` | Resumo dos últimos 7 dias |

</details>

Consultas por comando não gastam IA. Perguntas em texto ou voz usam a cota diária, compartilhada com o painel. Todos os comandos: [docs/TELEGRAM.md](docs/TELEGRAM.md).

## 🧩 Arquitetura

```mermaid
flowchart LR
    Browser(["🌐 Navegador"]) -->|"HTTPS"| Nginx["Nginx (TLS)"]
    Nginx --> Web["Painel Next.js<br/>local :3000"]
    Web -->|"proxy autenticado + SSE"| Agent["Agente FastAPI<br/>local :8787"]
    Agent -->|"gRPC :9200"| Dish[("🛰️ Antena Starlink")]
    Agent --> DB[("💾 SQLite WAL")]
    Agent --> TG["📲 Bot do Telegram"]
    Agent --> AI["🤖 Groq + Whisper<br/>somente leitura"]
    Agent -.->|"HTTPS opcional"| Meteo["🌦️ Open-Meteo"]
    Agent -.->|"HTTPS opcional"| Supa[("☁️ Supabase RLS")]
    Supa -.->|"leitura RLS"| Cloud["☁️ Painel na nuvem<br/>Vercel"]
    ESP["🔌 Sensores ESP32"] -.->|"HMAC"| Agent
```

- **Coleta:** status a cada 10 s, histórico a cada 30 s e obstruções a cada 5 min, gravando no SQLite (WAL, migrações e retenção automática).
- **Login e proxy:** cookie httpOnly (`SameSite=Strict`); o painel fala com o agente por um proxy autenticado, e o token nunca chega ao navegador.
- **No agente:** alertas, diagnóstico por regras, relatórios e o controle auditado da antena.
- **Integrações opcionais:** clima (só as coordenadas da cidade), Supabase (RLS) e sensores ESP32 (HMAC).

| Pasta | Conteúdo |
|---|---|
| `apps/agent/` | Agente Python: FastAPI, gRPC por reflection, SQLite, SSE, alertas, IA, Telegram e sync |
| `apps/web/` | Painel ASTRYON: Next.js 16 (App Router), Tailwind 4, TanStack Query, Recharts |
| `apps/esp32-firmware/` | Firmware PlatformIO/Arduino do nó ESP32 |
| `packages/shared/` | Contratos TS e tipos gerados do OpenAPI do agente |
| `supabase/` | Migrações SQL com RLS e testes de isolamento (PGlite) |
| `deploy/linux/` | Instalador, systemd, Nginx, UFW e `astryonctl` |
| `scripts/` | Scripts do Windows e emulador do ESP32 |

Decisões de projeto e fluxo de dados: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## 🚦 Estado do projeto

**Releases:** [notas e instaladores](https://github.com/carlosnj497-lgtm/orbitlink-ai/releases) — o badge no topo mostra a versão atual.

> [!NOTE]
> **Resumo:** a validação em antenas reais, a publicação da nuvem e o instalador Windows ainda estão pendentes; o restante está coberto pelos testes listados abaixo.

- **Conector gRPC** — testado contra servidor gRPC sintético com reflection. **Ainda não validado em antenas reais**; a compatibilidade por modelo e firmware precisa ser confirmada.
- **Agente** — pytest, ruff e mypy strict; dependências travadas com hash.
- **Painel** — Vitest e E2E Playwright, incluindo acessibilidade com axe.
- **Telegram e notificações** — comandos, fila de reenvio e resumo semanal testados com servidor simulado.
- **IA (Groq) e Whisper** — testados com o endpoint real da Groq; áudio validado com voz sintética.
- **Supabase** — testes de isolamento RLS em Postgres (PGlite); ainda não aplicado a um projeto real.
- **Firmware ESP32** — versão 0.2.0 com pareamento v2 ainda precisa de compilação nos dois ambientes e validação em placa.
- **Implantação Linux** — testes dos scripts e instalação real num Ubuntu 24.04 limpo no CI.
- **Instalador Windows** — gerado no GitHub Actions e publicado nas releases (`.exe` e `.zip`); falta validar num Windows real.
- **Painel na nuvem (Vercel + Supabase)** — login por e-mail, pareamento por código, Dashboard, Consumo, Qualidade, Eventos e Conta. Código testado com Supabase simulado; falta publicar e aplicar o SQL no projeto Supabase de destino.

## 🧭 Roteiro

- [x] Coleta gRPC por reflection, histórico de 1 s e agregados por minuto
- [x] Painel ASTRYON com Ao Vivo, Consumo, Qualidade, Antena, Obstruções, Eventos e Relatórios
- [x] Alertas com fila de reenvio, bot do Telegram e resumo semanal
- [x] Central de IA (Groq) e notas de voz transcritas pelo Whisper
- [x] Instalação no Ubuntu com systemd, Nginx e UFW, testada no CI
- [x] Clima da cidade (Open-Meteo) cruzado com a qualidade e as quedas
- [x] Aviso de chuva forte prevista no Telegram e comando `/clima`
- [ ] Validação em antenas Starlink reais dos diferentes modelos e gerações
- [ ] Nó ESP32 gravado e testado numa placa
- [x] Código do serviço na nuvem: conta por e-mail, código de pareamento e painel lendo o Supabase ([NUVEM.md](docs/NUVEM.md))
- [ ] Publicar o painel na nuvem e aplicar o SQL no Supabase
- [ ] Aparelho pronto (Raspberry Pi) com página de configuração: script pronto, falta testar no hardware ([APARELHO.md](docs/APARELHO.md))
- [ ] Instalador `.exe` para Windows com ícone na bandeja: gerado no GitHub Actions e publicado nas [releases do ASTRYON](https://github.com/carlosnj497-lgtm/orbitlink-ai/releases), falta validar num Windows real

## ❓ Perguntas frequentes

<details>
<summary><b>Quais modelos de antena Starlink posso usar?</b></summary>
<br>
O projeto é voltado aos modelos Starlink em geral, incluindo <b>Mini, Standard (e gerações anteriores),
Standard Actuated, High Performance e Flat High Performance</b>, desde que exponham a API local gRPC
acessível ao agente (IP da antena, porta 9200). O agente descobre em tempo de execução quais chamadas
o firmware oferece; o que não for informado aparece como indisponível. A validação em hardware real
ainda está pendente, portanto não há garantia de compatibilidade completa com todos os modelos e firmwares.
Detalhes em <a href="docs/STARLINK_COMPATIBILITY.md">STARLINK_COMPATIBILITY.md</a>.
</details>

<details>
<summary><b>Preciso de um servidor ligado o tempo todo?</b></summary>
<br>
Para monitorar 24 horas, sim: qualquer mini PC ou computador antigo com Ubuntu serve. No Windows, o monitoramento
acontece enquanto o computador estiver ligado.
</details>

<details>
<summary><b>Meus dados vão para algum lugar?</b></summary>
<br>
Não por padrão. Tudo fica no SQLite local. A lista completa do que pode sair — e quando — está em
[Privacidade e segurança](#-privacidade-e-segurança).
</details>

<details>
<summary><b>O clima diz que a chuva derrubou a minha internet?</b></summary>
<br>
Não. Ele mostra que as duas coisas aconteceram ao mesmo tempo, o que ajuda a investigar, mas não prova a causa. O clima
vem de um modelo meteorológico para a sua região, não de um sensor no seu telhado, por isso aparece como dado
<b>estimado</b>. Para ativar, escolha a cidade em Configurações → Clima; sem cidade, nada é buscado.
</details>

<details>
<summary><b>Quanto custa?</b></summary>
<br>
O projeto não tem custo. Telegram e o clima (Open-Meteo) são gratuitos. A IA usa a sua própria chave da Groq, que tem plano gratuito; sem chave,
o assistente responde por regras. Há cotas diárias configuráveis para texto e áudio.
</details>

<details>
<summary><b>O consumo mostrado é o mesmo da fatura?</b></summary>
<br>
Não necessariamente. O consumo é estimado pelo tráfego que a antena reporta a cada segundo, e o painel deixa isso claro.
Períodos sem observação ficam fora da conta. Para comparar, importe o CSV da sua conta Starlink.
</details>

<details>
<summary><b>A IA pode reiniciar a minha antena?</b></summary>
<br>
Não. As ferramentas da IA são somente de leitura. Reiniciar exige um administrador, um código de uso único e fica
registrado na auditoria.
</details>

<details>
<summary><b>O ASTRYON funciona sem internet?</b></summary>
<br>
Sim, para o painel local e a leitura da antena. Telegram, clima e IA precisam de internet; se a conexão cair, os alertas
ficam na fila e são enviados quando ela volta.
</details>

<details>
<summary><b>Como atualizo o ASTRYON?</b></summary>
<br>
Linux: `sudo astryonctl update --git-pull` (com rollback automático). Windows: baixe o instalador novo nas releases ou
rode os scripts de instalação novamente. Guias: [Linux](docs/LINUX_SERVER.md) e [Windows](docs/WINDOWS_SETUP.md).
</details>

<details>
<summary><b>Como faço backup?</b></summary>
<br>
Linux: `sudo astryonctl backup`. O agente também mantém uma cópia diária do banco; o envio de uma cópia semanal pelo
Telegram é opcional. Detalhes em [docs/LINUX_SERVER.md](docs/LINUX_SERVER.md).
</details>

<details>
<summary><b>Funciona no celular?</b></summary>
<br>
Sim. O painel é responsivo e não precisa de app: abra o endereço do ASTRYON no navegador do celular. O Telegram também
funciona como interface móvel para alertas e consultas.
</details>

## 💻 Desenvolvimento

| Comando (na raiz) | O que faz |
|---|---|
| `npm run dev` | Painel em modo desenvolvimento |
| `npm run test` | pytest + Vitest + testes de RLS |
| `npm run test:e2e` | Playwright: agente em modo fixture + painel em produção |
| `npm run lint` · `npm run typecheck` | ESLint + ruff · tsc + mypy strict |
| `npm run build` | Build de produção do painel |
| `npm run diagnose` | Diagnóstico da rede e da antena |
| `npm run gen:types` | Regenera os tipos TS a partir do OpenAPI do agente |
| `npm run lock:agent` | Regenera os `.lock` do Python (requer `uv`) |
| `npm run audit` | Vulnerabilidades conhecidas (`npm audit` + `pip-audit`) |
| `npm run test:deploy` | Testes dos scripts do servidor Linux |
| `npm run check:links` | Verifica arquivos e âncoras do README |
| `npm run screenshots` | Regenera as capturas de `/demo` (com o painel rodando) |

Ao mudar dependências em `apps/agent/pyproject.toml`, rode `npm run lock:agent` e faça commit dos dois `.lock`: o CI falha se estiverem desatualizados.

O CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) roda agente, painel, Supabase, E2E, scripts, links do README, auditoria de vulnerabilidades e uma instalação real no Ubuntu a cada push e pull request. A checagem externa de links roda no agendamento semanal; para rodar agora: `npm run check:links:external`.

## 🤝 Contribuição

- Achou um problema ou tem uma sugestão? Abra uma [issue](https://github.com/carlosnj497-lgtm/orbitlink-ai/issues).
- Antes de contribuir, veja [CONTRIBUTING.md](CONTRIBUTING.md) para ambiente, testes e estilo de commit.
- Pull requests são bem-vindos: antes de enviar, rode `npm run test` e `npm run lint` (o CI reprova se algo falhar).
- Se o projeto te ajudou, deixe uma ⭐ no repositório — isso ajuda outras pessoas a encontrá-lo.

## 📚 Documentação

### 🚀 Começando

- [🐧 Servidor Ubuntu](docs/LINUX_SERVER.md) — instalação, atualização, backup e rollback.
- [🪟 Windows 10/11](docs/WINDOWS_SETUP.md) — instalação e scripts no Windows.
- [🔄 Migração para ASTRYON](docs/MIGRATION_ASTRYON.md) — atualização de instalações com o nome anterior.
- [🔍 Solução de problemas](docs/TROUBLESHOOTING.md) — diagnóstico da rede, da antena e dos serviços.

### 🔌 Integrações

- [📲 Telegram](docs/TELEGRAM.md) — bot, comandos, voz e resumo semanal.
- [📡 ESP32](docs/ESP32_SETUP.md) — montagem e pareamento do nó de sensores.
- [🏠 Home Assistant](docs/HOME_ASSISTANT.md) — sensores via MQTT com descoberta automática.
- [☁️ Nuvem (Vercel + Supabase)](docs/NUVEM.md) — contas por e-mail, pareamento e painel na nuvem.
- [🔄 Supabase](docs/SUPABASE.md) — sincronização opcional com RLS.
- [🍓 Aparelho pronto](docs/APARELHO.md) — Raspberry Pi com página de configuração.

### 🧠 Referência técnica

- [🧩 Arquitetura](docs/ARCHITECTURE.md) — decisões de projeto e fluxo de dados.
- [🛰️ Compatibilidade Starlink](docs/STARLINK_COMPATIBILITY.md) — o que a API local informa e o que não informa.
- [🛡️ Segurança](docs/SECURITY.md) — modelo de segurança.
- [✅ Testes de aceitação](docs/ACCEPTANCE_TESTS.md) — roteiro de validação ponta a ponta.

---

## 🇺🇸 English

### 🚀 Quick start (Linux)

**Prerequisites (Linux):** Ubuntu Server 24.04 LTS and a computer on the same network as the dish. The installer takes care of Python, Node.js, Nginx, and other dependencies.

🐧 **Linux (recommended)** · 🪟 [Windows 10/11](#-installation)

1. **Clone the repository and enter the folder**

   ```bash
   git clone https://github.com/carlosnj497-lgtm/orbitlink-ai.git ~/astryon
   cd ~/astryon
   ```

2. **Install and start the services**

   ```bash
   sudo bash deploy/linux/install.sh
   ```

3. **Copy the setup code**

   ```bash
   sudo cat /etc/astryon/setup-code
   ```

4. Open `https://YOUR-IP/` and create the administrator with that code.

Done — the agent is running and will start reading your dish once it is reachable on the network. 📡

The project uses the same prefix everywhere: `ASTRYON_*` variables, `astryon-*` services, and the `astryonctl` command.

🎮 **No dish nearby?** Open `https://YOUR-IP/demo` · 🔄 **Coming from the old name?** See [Migration to ASTRYON](docs/MIGRATION_ASTRYON.md)

> [!IMPORTANT]
> **Independent project, not affiliated with Starlink or SpaceX.** It only uses the local gRPC API that the dish exposes on your network.
>
> **Models:** Mini · Standard (and previous generations) · Standard Actuated · High Performance · Flat High Performance. Compatibility depends on each dish's firmware — validation on real hardware is still pending. See [compatibility by model](docs/STARLINK_COMPATIBILITY.md).

---

### 📑 Table of contents

**🚀 Getting started**
- [Quick start](#-quick-start-linux)
- [Installation](#-installation)

**🛰️ The project**
- [Why ASTRYON?](#-why-astryon)
- [What it does](#-what-it-does)
- [Screenshots](#-screenshots)
- [Principles](#-principles)
- [Compatibility](#-compatibility)
- [Privacy and security](#-privacy-and-security)
- [Architecture](#-architecture)
- [Project status](#-project-status)
- [Roadmap](#-roadmap)

**🔌 Usage and integrations**
- [Telegram and AI](#-telegram-and-ai)
- [FAQ](#-faq)
- [Documentation](#-documentation)

**🤝 Community**
- [Development](#-development)
- [Contributing](#-contributing)
- [Credits](#-créditos--credits)

🌐 [Versão em português](#astryon)

### 💡 Why ASTRYON?

The official Starlink app shows current status and a short history. ASTRYON stores what the dish exposes — 1-second samples, per-minute aggregates, and events — and turns that data into a dashboard, alerts, and answers:

| 📱 Official app | 🛰️ With ASTRYON |
|---|---|
| Current status + short history | 🗂️ **Your history** — 1-second samples for 7 days and per-minute aggregates for 400 days (default), on your computer |
| Recent outages in the Event Log | 🌙 **Outages logged** — time, duration, and cause (when the dish reports it), including overnight |
| Data cap in the account/app | 📦 **Estimated data cap** — cycle usage, monthly projection, and 80%/100% alerts (local estimate) |
| Alerts in the official app | 📲 **Telegram** — alerts, weekly summary, and queries without opening the dashboard |
| Dish data | 🌧️ **Rain or dish?** — weather and connection side by side, for comparison (not causation) |
| Ready-made charts and stats | 🗣️ **Ask in Portuguese** — e.g. "minha internet ficou ruim ontem à noite?", with source and uncertainty (Groq AI or rules) |
| Data in Starlink's cloud | 🔒 **Data stays with you** — everything on your network; cloud and optional services are opt-in |

### ✨ What it does

| Feature | Details |
|---|---|
| 📡 **Live** | Download, upload, latency, and packet loss with 1-second history, pause, and CSV export. |
| 📊 **Usage and data cap** | Cycle usage, monthly projection, and alerts at 80% and 100% of the plan (local estimate from dish traffic), with official CSV import for comparison. |
| ✅ **Quality** | Availability, loss, jitter, and latency percentiles per hour, comparison with the previous period (with and without rain), and the best times of day. Seconds without measurement are excluded. |
| 🛰️ **Dish and obstructions** | Status, firmware, sky map as seen by the dish, and obstruction percentage. |
| 📄 **Events and reports** | Outage timeline with duration, cause (when reported), confidence, and weather; PDF reports and CSV/JSON export. |
| 🔔 **Alerts** | Rules with debounce, hysteresis, and cooldown, delivered via Telegram or webhook, with a queue that survives internet outages. |
| 🤖 **AI hub** | Questions in Portuguese answered with data from the agent (Groq). Without a key, it answers by rules. |
| 💬 **Telegram bot** | `/menu`, command queries without spending AI, text or voice questions, and weekly summary. |
| 🔁 **Safe, audited control** | Rebooting the dish requires an administrator, a single-use code, and is audited. AI only suggests. |
| 🌦️ **Weather (optional)** | City weather from Open-Meteo (free): card on the Dashboard, rain bands in charts, and weather at each outage in Events. |
| 🔌 **ESP32 (optional)** | Voltage, power outage, and temperature sensors, authenticated by HMAC. |
| 🏠 **Home Assistant (optional)** | Starlink sensors in Home Assistant via MQTT, with auto-discovery. See [HOME_ASSISTANT.md](docs/HOME_ASSISTANT.md). |
| ☁️ **Supabase (optional)** | Sync with RLS. The dashboard keeps reading only the local agent. |

### 📺 Screenshots

<p align="center">
  <img src="docs/screenshots/consumo.webp" alt="ASTRYON Usage screen with cycle, projection, and daily evolution" width="720"><br>
  <sub><b>Usage</b>: cycle, projection, and daily evolution.</sub>
</p>

<p align="center">
  <img src="docs/screenshots/antena.webp" alt="ASTRYON Dish and Signal screen with status, firmware, and obstructions" width="720"><br>
  <sub><b>Dish and Signal</b>: status, firmware, and obstructions.</sub>
</p>

<details>
<summary><b>Quality, Events, and Reports</b></summary>
<br>
<p align="center">
  <img src="docs/screenshots/qualidade.webp" alt="ASTRYON Quality screen with availability, loss, latency, and best times" width="720"><br>
  <sub><b>Quality</b>: availability, loss, latency, and best times.</sub>
</p>
<p align="center">
  <img src="docs/screenshots/eventos.webp" alt="ASTRYON Events screen with outages, duration, cause, and weather" width="720"><br>
  <sub><b>Events</b>: outages with duration, cause, and weather.</sub>
</p>
<p align="center">
  <img src="docs/screenshots/relatorios.webp" alt="ASTRYON Reports screen with PDF, CSV, and JSON backup" width="720"><br>
  <sub><b>Reports</b>: PDF, CSV, and JSON backup.</sub>
</p>
</details>

<details>
<summary><b>AI Hub and Login</b></summary>
<br>
<p align="center">
  <img src="docs/screenshots/central-ia.webp" alt="ASTRYON AI Hub with questions and conversation history" width="720"><br>
  <sub><b>AI Hub</b>: questions about the connection with conversation history.</sub>
</p>
<p align="center">
  <img src="docs/screenshots/login.webp" alt="ASTRYON login screen for the local administrator" width="720"><br>
  <sub><b>Login</b>: local administrator created during installation.</sub>
</p>
</details>

<details>
<summary><b>Full dashboard and mobile version</b></summary>
<br>
<p align="center">
  <img src="docs/screenshots/dashboard.webp" alt="Full ASTRYON dashboard" width="720">
  &nbsp;
  <img src="docs/screenshots/celular.webp" alt="ASTRYON dashboard on mobile" width="260">
</p>
</details>

All screenshots come from the `/demo` route, with fictitious data and the demo banner always visible.

### 💎 Principles

- **Works 100% locally.** No Docker and no paid service. Supabase, AI, and ESP32 are optional.
- **Every metric shows its origin**: `real`, `calculated`, `estimated`, `imported`, `sensor_esp32`, `unavailable`, or `demo`.
- **Nothing is made up.** Any field the firmware does not report appears as unavailable. Observation gaps never become zero, and current traffic is never called a speed test.
- **Actions require human confirmation.** AI tools are read-only.
- **Demo isolated.** Fictitious data exists only in `/demo`, always labeled.

### 📡 Compatibility

- **Target models:** Mini · Standard (and previous generations) · Standard Actuated · High Performance · Flat High Performance.
- **Real-hardware validation:** not yet performed (Nov 2026); the connector was tested against a synthetic gRPC server with reflection.
- **Capability discovery:** the agent queries the firmware via reflection at runtime; anything not exposed appears as unavailable.
- **Details per model and firmware:** [docs/STARLINK_COMPATIBILITY.md](docs/STARLINK_COMPATIBILITY.md).

### 🔒 Privacy and security

By default, everything stays in the local SQLite. These are the only paths that can leave your network — all optional:

- **Telegram** — alerts, weekly summary, commands, and questions; only with the bot configured.
- **Groq (AI and Whisper)** — the question and the data needed to answer it; the voice-note audio; only with the key configured.
- **Bot voice (Microsoft)** — the response text; only if voice replies are enabled.
- **Open-Meteo** — city coordinates (~1 km); only with weather enabled.
- **Webhook** — the alert content; only with the URL configured.
- **Supabase / cloud dashboard** — per-minute aggregates (usage, latency, loss, outages), not the 1-second samples or the device list; only if cloud is configured.
- **ESP32** — sensor data stays on the local network; the listener is local.

**Security:** secrets stay in the agent/server; the browser never receives tokens; control actions require an administrator, a single-use code, and auditing. Full model: [docs/SECURITY.md](docs/SECURITY.md). To report a vulnerability, use the **Security** tab (private report).

### 🔧 Installation

#### Requirements

- **Linux (recommended):** Ubuntu Server 24.04 LTS, 2 GB+ RAM, 4 GB free disk, and network access to the dish. The installer handles Python, Node.js, Nginx, and other dependencies. x86_64 tested in CI; ARM64 not yet validated.
- **Raspberry Pi (appliance):** Pi 4 or 5, 2 GB+ RAM, 16 GB+ card, and Raspberry Pi OS Lite 64-bit. Script ready; hardware validation pending. See [docs/APARELHO.md](docs/APARELHO.md).
- **Windows 10/11:** Python 3.11+ and Node.js 20+; monitoring runs while the computer is on.

#### Linux server (Ubuntu Server 24.04 LTS), recommended

Follow the steps in [Quick start](#-quick-start-linux). The installer configures systemd + Nginx (TLS) + UFW, and the code in `/etc/astryon/setup-code` creates the first administrator. Installer options: `--with-tailscale`, `--esp32`, and `--harden-ssh`.

```bash
sudo astryonctl status          # service status
sudo astryonctl logs agent -f   # live logs
sudo astryonctl diagnose        # network + dish (read-only)
sudo astryonctl doctor          # health + security checks
sudo astryonctl restart         # restart services
sudo astryonctl update --git-pull
sudo astryonctl rollback
sudo astryonctl backup
```

**Update and backup:** `update --git-pull` uses an atomic switch with automatic rollback; `rollback` returns to the previous release; `backup` creates a backup now (daily copies live in `/var/lib/astryon/backups`, 14 kept). Guide: [docs/LINUX_SERVER.md](docs/LINUX_SERVER.md).

The `astryon-agent` and `astryon-web` services self-restart on failures and log to journald. Agent and dashboard listen only on loopback; Nginx exposes the dashboard only to the LAN and Tailnet. Full guide: [docs/LINUX_SERVER.md](docs/LINUX_SERVER.md).

<details>
<summary><b>🪟 Windows 10/11 (PowerShell)</b></summary>

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install.ps1    # venv, npm, .env with token, build
powershell -ExecutionPolicy Bypass -File scripts\diagnose.ps1   # network + dish (read-only)
powershell -ExecutionPolicy Bypass -File scripts\start.ps1      # agent :8787 + dashboard :3000
```

Open `http://localhost:3000` on the same PC and create the administrator. To stop: `scripts\stop.ps1`. Guide: [docs/WINDOWS_SETUP.md](docs/WINDOWS_SETUP.md).

Prefer the installer with a tray icon? Download the `.exe` from the [ASTRYON releases](https://github.com/carlosnj497-lgtm/orbitlink-ai/releases/latest) (being validated on real Windows).

</details>

> [!TIP]
> No dish nearby? Open `https://YOUR-IP/demo` (Linux) or `http://localhost:3000/demo` (Windows) to see the dashboard with fictitious data.

### 🤖 Telegram and AI

1. Create a bot with [@BotFather](https://t.me/BotFather) and put the token in `ASTRYON_TELEGRAM_BOT_TOKEN`.
2. Discover the authorized chat with `sudo astryonctl telegram-chat-id` (or `python -m astryon_agent telegram-chat-id`) and fill in `ASTRYON_TELEGRAM_CHAT_ID`.
3. Optional: add a [Groq](https://console.groq.com/keys) key in `ASTRYON_GROQ_API_KEY` for AI answers and voice-note transcription (Whisper).

The bot and its commands are in Portuguese.

| Command | What it shows |
|---|---|
| `/menu` | Hub with buttons |
| `/status` | Diagnosis of the last 24 h |
| `/consumo 7d` | Download, upload, and coverage for the period |
| `/franquia` | Limit, estimated balance, and cycle projection |
| `/relatorio` | PDF of the last 30 days, with comparison and weather |

<details>
<summary><b>See all commands</b></summary>

| Command | What it shows |
|---|---|
| `/qualidade` · `/quedas` · `/alertas` | Quality, interruptions (with weather for each), and active alerts |
| `/clima` | Weather now, next hours, and heavy-rain warning |
| `/horario` | Best times for downloads and calls |
| `/resumo` | Summary of the last 7 days |

</details>

Command queries do not consume AI. Text or voice questions use the daily quota, shared with the dashboard. All commands: [docs/TELEGRAM.md](docs/TELEGRAM.md).

### 🧩 Architecture

```mermaid
flowchart LR
    Browser(["🌐 Browser"]) -->|"HTTPS"| Nginx["Nginx (TLS)"]
    Nginx --> Web["ASTRYON Dashboard Next.js<br/>local :3000"]
    Web -->|"authenticated proxy + SSE"| Agent["FastAPI agent<br/>local :8787"]
    Agent -->|"gRPC :9200"| Dish[("🛰️ Starlink dish")]
    Agent --> DB[("💾 SQLite WAL")]
    Agent --> TG["📲 Telegram bot"]
    Agent --> AI["🤖 Groq + Whisper<br/>read-only"]
    Agent -.->|"optional HTTPS"| Meteo["🌦️ Open-Meteo"]
    Agent -.->|"optional HTTPS"| Supa[("☁️ Supabase RLS")]
    Supa -.->|"RLS reads"| Cloud["☁️ Cloud dashboard<br/>Vercel"]
    ESP["🔌 ESP32 sensors"] -.->|"HMAC"| Agent
```

- **Collection:** status every 10 s, history every 30 s, and obstructions every 5 min, writing to SQLite (WAL, migrations, and automatic retention).
- **Login and proxy:** httpOnly cookie (`SameSite=Strict`); the dashboard talks to the agent through an authenticated proxy, and the token never reaches the browser.
- **Inside the agent:** alerts, rule-based diagnosis, reports, and audited dish control.
- **Optional integrations:** weather (city coordinates only), Supabase (RLS), and ESP32 sensors (HMAC).

| Folder | Content |
|---|---|
| `apps/agent/` | Python agent: FastAPI, gRPC via reflection, SQLite, SSE, alerts, AI, Telegram, and sync |
| `apps/web/` | ASTRYON dashboard: Next.js 16 (App Router), Tailwind 4, TanStack Query, Recharts |
| `apps/esp32-firmware/` | PlatformIO/Arduino firmware for the ESP32 node |
| `packages/shared/` | TS contracts and types generated from the agent's OpenAPI |
| `supabase/` | SQL migrations with RLS and isolation tests (PGlite) |
| `deploy/linux/` | Installer, systemd, Nginx, UFW, and `astryonctl` |
| `scripts/` | Windows scripts and ESP32 emulator |

Project decisions and data flow: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### 🚦 Project status

**Releases:** [notes and installers](https://github.com/carlosnj497-lgtm/orbitlink-ai/releases) — the badge at the top shows the current version.

> [!NOTE]
> **Summary:** real-dish validation, cloud publishing, and the Windows installer are still pending; everything else is covered by the tests listed below.

- **gRPC connector** — tested against a synthetic gRPC server with reflection. **Not yet validated on real dishes**; compatibility per model and firmware needs confirmation.
- **Agent** — pytest, ruff, and mypy strict tests; dependencies locked with hashes.
- **Dashboard** — Vitest and Playwright E2E tests, including accessibility with axe.
- **Telegram and notifications** — commands, retry queue, and weekly summary tested with a simulated server.
- **AI (Groq) and Whisper** — tested with the real Groq endpoint; audio validated with synthetic voice.
- **Supabase** — RLS isolation tests in Postgres (PGlite); not yet applied to a real project.
- **ESP32 firmware** — version 0.2.0 with v2 pairing still needs compilation in both environments and validation on a board.
- **Linux deployment** — script tests and real installation on a clean Ubuntu 24.04 in CI.
- **Windows installer** — built in GitHub Actions and published in the releases (`.exe` and `.zip`); pending validation on real Windows.
- **Cloud dashboard (Vercel + Supabase)** — email login, pairing code, Dashboard, Usage, Quality, Events, and Account. Code tested with simulated Supabase; needs publishing and SQL applied to the target Supabase project.

### 🧭 Roadmap

- [x] gRPC reflection collection, 1-second history, and per-minute aggregates
- [x] ASTRYON dashboard with Live, Usage, Quality, Dish, Obstructions, Events, and Reports
- [x] Alerts with retry queue, Telegram bot, and weekly summary
- [x] AI hub (Groq) and voice notes transcribed by Whisper
- [x] Ubuntu installation with systemd, Nginx, and UFW, tested in CI
- [x] City weather (Open-Meteo) correlated with quality and outages
- [x] Heavy-rain warning on Telegram and `/clima` command
- [ ] Validation on real Starlink dishes across different models and generations
- [ ] ESP32 node flashed and tested on a board
- [x] Cloud service code: email accounts, pairing code, and dashboard reading Supabase ([NUVEM.md](docs/NUVEM.md))
- [ ] Publish the cloud dashboard and apply the SQL to Supabase
- [ ] Ready device (Raspberry Pi) with config page: script ready, hardware test pending ([APARELHO.md](docs/APARELHO.md))
- [ ] `.exe` installer for Windows with tray icon: built in GitHub Actions and published in the [ASTRYON releases](https://github.com/carlosnj497-lgtm/orbitlink-ai/releases), pending validation on real Windows

### ❓ FAQ

<details>
<summary><b>Which Starlink dish models are supported?</b></summary>
<br>
The project targets Starlink models in general, including <b>Mini, Standard (and previous generations),
Standard Actuated, High Performance, and Flat High Performance</b>, as long as they expose the local gRPC API
accessible to the agent (dish IP, port 9200). The agent discovers at runtime which calls the firmware offers;
anything not reported appears as unavailable. Real-hardware validation is still pending, so there is no guarantee
of full compatibility with every model and firmware.
Details in <a href="docs/STARLINK_COMPATIBILITY.md">STARLINK_COMPATIBILITY.md</a>.
</details>

<details>
<summary><b>Do I need a server running 24/7?</b></summary>
<br>
To monitor 24/7, yes: any mini PC or old computer with Ubuntu works. On Windows, monitoring runs while the computer is on.
</details>

<details>
<summary><b>Does my data go anywhere?</b></summary>
<br>
Not by default. Everything stays in the local SQLite. The full list of what can leave — and when — is in
[Privacy and security](#-privacy-and-security).
</details>

<details>
<summary><b>Does the weather say rain caused my internet outage?</b></summary>
<br>
No. It shows that both events happened at the same time, which helps investigate, but does not prove causation. The weather
comes from a meteorological model for your region, not a sensor on your roof, so it appears as <b>estimated</b> data.
To enable, choose the city in Settings → Weather; without a city, nothing is fetched.
</details>

<details>
<summary><b>How much does it cost?</b></summary>
<br>
The project has no cost. Telegram and weather (Open-Meteo) are free. AI uses your own Groq key, which has a free plan; without a key,
the assistant answers by rules. There are configurable daily quotas for text and audio.
</details>

<details>
<summary><b>Is the shown usage the same as my bill?</b></summary>
<br>
Not necessarily. Usage is estimated from the traffic the dish reports every second, and the dashboard makes this clear.
Periods without observation are excluded. To compare, import the CSV from your Starlink account.
</details>

<details>
<summary><b>Can the AI reboot my dish?</b></summary>
<br>
No. AI tools are read-only. Rebooting requires an administrator, a single-use code, and is recorded in the audit log.
</details>

<details>
<summary><b>Does ASTRYON work without internet?</b></summary>
<br>
Yes, for the local dashboard and dish readings. Telegram, weather, and AI need internet; if the connection drops, alerts
wait in the queue and are sent when it returns.
</details>

<details>
<summary><b>How do I update ASTRYON?</b></summary>
<br>
Linux: `sudo astryonctl update --git-pull` (with automatic rollback). Windows: download the new installer from the
releases or run the install scripts again. Guides: [Linux](docs/LINUX_SERVER.md) and [Windows](docs/WINDOWS_SETUP.md).
</details>

<details>
<summary><b>How do I back up?</b></summary>
<br>
Linux: `sudo astryonctl backup`. The agent also keeps a daily database copy; sending a weekly copy via Telegram is
optional. Details in [docs/LINUX_SERVER.md](docs/LINUX_SERVER.md).
</details>

<details>
<summary><b>Does it work on mobile?</b></summary>
<br>
Yes. The dashboard is responsive and needs no app: open the ASTRYON address in your phone's browser. Telegram also works
as a mobile interface for alerts and queries.
</details>

### 💻 Development

| Command (from root) | What it does |
|---|---|
| `npm run dev` | Dashboard in development mode |
| `npm run test` | pytest + Vitest + RLS tests |
| `npm run test:e2e` | Playwright: agent in fixture mode + dashboard in production |
| `npm run lint` · `npm run typecheck` | ESLint + ruff · tsc + mypy strict |
| `npm run build` | Production build of the dashboard |
| `npm run diagnose` | Network and dish diagnosis |
| `npm run gen:types` | Regenerates TS types from the agent's OpenAPI |
| `npm run lock:agent` | Regenerates Python `.lock` files (requires `uv`) |
| `npm run audit` | Known vulnerabilities (`npm audit` + `pip-audit`) |
| `npm run test:deploy` | Tests for the Linux server scripts |
| `npm run check:links` | Checks README files and anchors |
| `npm run screenshots` | Regenerates the `/demo` screenshots (dashboard running) |

When changing dependencies in `apps/agent/pyproject.toml`, run `npm run lock:agent` and commit both `.lock` files: CI fails if they are out of date.

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs agent, dashboard, Supabase, E2E, scripts, README links, vulnerability audit, and a real Ubuntu installation on every push and pull request. The external link check runs on the weekly schedule; to run it now: `npm run check:links:external`.

### 🤝 Contributing

- Found a problem or have a suggestion? Open an [issue](https://github.com/carlosnj497-lgtm/orbitlink-ai/issues).
- Before contributing, see [CONTRIBUTING.md](CONTRIBUTING.md) for setup, tests, and commit style.
- Pull requests are welcome: before submitting, run `npm run test` and `npm run lint` (CI will reject if anything fails).
- If the project helped you, leave a ⭐ on the repository — it helps others find it.

### 📚 Documentation

The detailed guides are currently in Portuguese.

#### 🚀 Getting started

- [🐧 Ubuntu Server](docs/LINUX_SERVER.md) — installation, update, backup, and rollback.
- [🪟 Windows 10/11](docs/WINDOWS_SETUP.md) — installation and scripts on Windows.
- [🔄 Migration to ASTRYON](docs/MIGRATION_ASTRYON.md) — updating installations with the previous name.
- [🔍 Troubleshooting](docs/TROUBLESHOOTING.md) — network, dish, and service diagnosis.

#### 🔌 Integrations

- [📲 Telegram](docs/TELEGRAM.md) — bot, commands, voice, and weekly summary.
- [📡 ESP32](docs/ESP32_SETUP.md) — assembly and pairing of the sensor node.
- [🏠 Home Assistant](docs/HOME_ASSISTANT.md) — sensors via MQTT with auto-discovery.
- [☁️ Cloud (Vercel + Supabase)](docs/NUVEM.md) — email accounts, pairing, and cloud dashboard.
- [🔄 Supabase](docs/SUPABASE.md) — optional sync with RLS.
- [🍓 Ready device](docs/APARELHO.md) — Raspberry Pi with configuration page.

#### 🧠 Technical reference

- [🧩 Architecture](docs/ARCHITECTURE.md) — project decisions and data flow.
- [🛰️ Starlink compatibility](docs/STARLINK_COMPATIBILITY.md) — what the local API reports and what it doesn't.
- [🛡️ Security](docs/SECURITY.md) — security model.
- [✅ Acceptance tests](docs/ACCEPTANCE_TESTS.md) — end-to-end validation checklist.

---

## 🙏 Créditos / Credits

Desenvolvido por / Developed by [@carlosnj497-lgtm](https://github.com/carlosnj497-lgtm). Distribuído sob a licença / Distributed under the [MIT License](LICENSE).

A leitura do histórico circular da antena segue o modelo documentado pela / The circular history reading follows the model documented by [starlink-grpc-tools](https://github.com/sparky8512/starlink-grpc-tools) (Unlicense). O código foi reescrito, não copiado. / The code was rewritten, not copied.
