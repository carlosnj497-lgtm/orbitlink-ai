# Servidor Linux: Ubuntu Server 24.04 LTS

Instalação do OrbitLink AI num PC servidor **sem interface gráfica e sem Docker**, com:

- serviços **systemd** separados para agente e painel, com reinício automático em falhas;
- logs no **journald**;
- **Nginx** com TLS como único ponto de entrada;
- **UFW** negando por padrão;
- **SSH** opcionalmente endurecido;
- **Tailscale** opcional.

> **Situação dos testes.** Os scripts foram verificados com `bash -n` e `shellcheck` (sem achados), e a parte Python nova (rotas via `ip -j`, Fernet, código de setup) tem testes automatizados. Eles **ainda não foram executados num Ubuntu 24.04 real** neste ambiente de desenvolvimento. Na primeira instalação, acompanhe a saída e rode `sudo orbitlinkctl doctor` no fim.

## 1. Como fica no servidor

```
Navegador (LAN ou Tailnet) ──HTTPS:443──▶ Nginx ──▶ Next.js 127.0.0.1:3000 ──▶ Agente 127.0.0.1:8787 ──gRPC──▶ Starlink 192.168.100.1:9200
ESP32 (LAN) ─────────────────HTTP:8788 (HMAC)──────────────────────────────────▶ Agente (opcional)
Agente ──HTTPS saída──▶ Supabase (opcional)   ·   SQLite em /var/lib/orbitlink = buffer offline
```

| Caminho | Conteúdo | Permissão |
|---|---|---|
| `/opt/orbitlink/releases/<data>/` | Código, `.venv` Python, `node_modules` e build do painel. Uma pasta por versão (guarda 3) | `orbitlink` |
| `/opt/orbitlink/current` | Link para a release ativa (troca atômica) | |
| `/var/lib/orbitlink/` | `orbitlink.sqlite3` (WAL) e `backups/` | `orbitlink` 0750 |
| `/etc/orbitlink/orbitlink.env` | Configuração e segredos | `root:orbitlink` 0640 |
| `/etc/orbitlink/secrets.key` | Chave Fernet dos segredos do ESP32, separada dos dados e backups | `root:orbitlink` 0640 |
| `/etc/orbitlink/setup-code` | Código para criar o 1º administrador | `root` 0600 |
| `/etc/orbitlink/tls/` | Certificado autoassinado (ECDSA P-256, 825 dias) | chave `root` 0600 |
| `/usr/local/bin/orbitlinkctl` | CLI de operação | |

| Porta | Escuta | Quem acessa |
|---|---|---|
| 22 (SSH) | todas | UFW: só LAN, Tailnet e sessões SSH ativas no momento da instalação, com `ufw limit` |
| 80 / 443 (Nginx) | todas | UFW + ACL do Nginx: só LAN e, se o Tailscale estiver instalado, a Tailnet (`100.64.0.0/10`). `Host` desconhecido recebe 444. A 80 apenas redireciona para HTTPS quem passa pela ACL |
| 3000 (painel) | **127.0.0.1** | só o Nginx |
| 8787 (agente) | **127.0.0.1** | só o painel. **Nunca** publicado (o Nginx devolve 404 em `/v1/`) |
| 8788 (ESP32) | 0.0.0.0, **só se habilitado** | UFW: só LAN. Toda mensagem exige HMAC |

Nenhuma porta precisa ser aberta no roteador. **Não** faça encaminhamento de portas para este servidor.

## 2. Pré-requisitos

- Ubuntu Server 24.04 LTS, 2 GB de RAM ou mais (o build do Next.js usa ~1,5 GB) e 4 GB livres em disco.
- Acesso SSH com um usuário que tenha `sudo`.
- O servidor na mesma rede que alcança a Starlink Mini (veja a seção 6).

## 3. Instalação passo a passo

```bash
# 1) Acesse o servidor
ssh voce@IP-DO-SERVIDOR

# 2) Obtenha o código (git ou cópia do diretório do projeto)
sudo apt-get update && sudo apt-get install -y git
git clone <URL-DO-SEU-REPOSITORIO> ~/orbitlink
cd ~/orbitlink

# 3) Instale (confira a rede local detectada na saída)
sudo bash deploy/linux/install.sh
#    Opções úteis:
#      --lan-cidr 192.168.1.0/24   informa a LAN, se a detecção errar
#      --with-tailscale            instala o Tailscale e libera o painel na interface tailscale0
#      --esp32                     habilita o listener do ESP32 (porta 8788 só para a LAN)
#      --harden-ssh                desativa senha e root no SSH (só se você já usa chave)
#      --yes                       não pergunta nada

# 4) Pegue o código de configuração inicial
sudo cat /etc/orbitlink/setup-code

# 5) No navegador de um PC da LAN: https://IP-DO-SERVIDOR/
#    Aceite o aviso do certificado autoassinado, crie o administrador e informe o código do passo 4.
```

O instalador faz, nesta ordem:

1. Confere se o sistema é Ubuntu 24.04 com systemd.
2. Instala `python3-venv`, `nginx`, `ufw`, `sqlite3`, `openssl` e `rsync`, além do Node.js 22 pelo repositório oficial NodeSource (chave GPG em `/etc/apt/keyrings`, sem `curl | bash`).
3. Cria o usuário de sistema `orbitlink` (sem shell de login) e os diretórios.
4. Gera `/etc/orbitlink/orbitlink.env` com:
   - token de serviço aleatório;
   - `ORBITLINK_COOKIE_SECURE=true`;
   - código de setup;
   - `ORBITLINK_HOST=127.0.0.1`.
5. Gera a chave Fernet e o certificado TLS (SAN com hostname, `.local` e IP da LAN).
6. Constrói a release: venv Python, `npm ci` e `next build`.
7. Ativa o link `current`.
8. Instala e habilita `orbitlink.target`, `orbitlink-agent`, `orbitlink-web` e `orbitlink-backup.timer`.
9. Configura o Nginx com ACL da LAN (e do Tailscale, se ele existir ou se você usar `--with-tailscale`), aceitando só os nomes deste servidor no `Host`, e desabilita o site `default` (o arquivo é mantido).
10. Configura o UFW. **Antes de ativá-lo**, libera o SSH para a LAN e para a sessão SSH atual.
11. Verifica a saúde e mostra as portas em escuta.

Rodar o instalador de novo é seguro: ele preserva `.env`, chaves, certificado e dados.

## 4. Operação diária

| Ação | Comando |
|---|---|
| Iniciar tudo | `sudo orbitlinkctl start` (ou `start agent` / `start web`) |
| Parar | `sudo orbitlinkctl stop` |
| Reiniciar (após editar o `.env`) | `sudo orbitlinkctl restart` |
| Estado + saúde | `sudo orbitlinkctl status` |
| Só a verificação de saúde (exit 0 = ok) | `sudo orbitlinkctl health` |
| Logs do agente / painel / Nginx | `sudo orbitlinkctl logs agent -f` · `logs web` · `logs nginx` · `logs all --since "1 hour ago"` |
| Diagnóstico da antena (somente leitura) | `sudo orbitlinkctl diagnose` (`--json`, `--share`, `--no-router`) |
| Diagnóstico completo de falhas | `sudo orbitlinkctl doctor` |
| Atualizar | `sudo orbitlinkctl update --git-pull` |
| Voltar para a versão anterior | `sudo orbitlinkctl rollback` |
| Backup agora / restaurar | `sudo orbitlinkctl backup` · `sudo orbitlinkctl restore /var/lib/orbitlink/backups/<arquivo>.sqlite3.gz` |
| Releases instaladas | `sudo orbitlinkctl releases` |
| Código de setup | `sudo orbitlinkctl setup-code` |
| Ligar/desligar ESP32 | `sudo orbitlinkctl esp32 enable` / `disable` |
| Token do agente para o Supabase | `sudo orbitlinkctl supabase-token --email voce@exemplo.com` |
| Descobrir o chat do Telegram | `sudo orbitlinkctl telegram-chat-id` |

Equivalentes diretos do systemd:

```bash
systemctl status orbitlink-agent orbitlink-web
sudo systemctl restart orbitlink.target
journalctl -u orbitlink-agent -f              # JSON estruturado; filtre com:  | grep '"level": "error"'
journalctl -u orbitlink-agent -p warning --since today
systemctl show -p NRestarts orbitlink-agent   # quantas vezes reiniciou sozinho
```

**Reinício automático:** `Restart=on-failure` com 5 s de espera, até 10 tentativas em 5 minutos. Depois disso o systemd para de tentar; corrija a causa e rode `sudo orbitlinkctl restart`. Os serviços sobem no boot via `orbitlink.target`.

**Atualização:** faz backup do SQLite, constrói a nova release **sem tocar na que está no ar**, troca o link, reinicia e verifica a saúde. Se a nova versão não responder em ~60 s, volta sozinha para a anterior.

## 5. Configuração

Edite `/etc/orbitlink/orbitlink.env` e depois rode `sudo orbitlinkctl restart`. As mesmas variáveis do `.env.example` valem aqui.

```bash
sudo nano /etc/orbitlink/orbitlink.env
sudo orbitlinkctl restart
```

- **Supabase:** preencha `ORBITLINK_SUPABASE_URL`, `ORBITLINK_SUPABASE_ANON_KEY` e `ORBITLINK_SUPABASE_AGENT_TOKEN` (gerado com `orbitlinkctl supabase-token`; veja [SUPABASE.md](SUPABASE.md)).
  - O agente continua coletando no SQLite mesmo sem internet e envia a fila quando a conexão volta.
  - Só tráfego **de saída** HTTPS é usado, e o UFW permite saída por padrão.
- **IA (Groq):** preencha `ORBITLINK_GROQ_API_KEY` (chave em console.groq.com). O agente precisa de saída HTTPS para api.groq.com.
- **Alertas no Telegram:**
  1. No Telegram, fale com o **@BotFather**, envie `/newbot` e guarde o token.
  2. Abra o bot criado e mande qualquer mensagem (ex.: `/start`).
  3. Ponha o token em `ORBITLINK_TELEGRAM_BOT_TOKEN` e rode `sudo orbitlinkctl telegram-chat-id`. Copie o número para `ORBITLINK_TELEGRAM_CHAT_ID`.
  4. `sudo orbitlinkctl restart` e, no painel, **Alertas → Enviar teste**.
  - Sem internet (caso típico da "antena inacessível"), a mensagem fica na fila do SQLite e sai quando a conexão volta, com o horário original. Depois de 24 h sem conseguir, é descartada (`ORBITLINK_NOTIFICATION_MAX_AGE_H`).
  - Se o servidor tiver outra saída para a internet além da Starlink (4G, outra operadora), o aviso de queda chega na hora.
- **Perguntas pelo Telegram:** com o bot configurado, mande perguntas para ele ("Como está a conexão?", "Vou passar da franquia?"). Ele responde com o mesmo assistente do painel (Groq, ou diagnóstico por regras sem chave). Comandos: `/status` (regras, sem IA), `/resumo` (últimos 7 dias, sem IA), `/nova` (conversa nova), `/ajuda`.
  - Só o chat de `ORBITLINK_TELEGRAM_CHAT_ID` é atendido; outros são ignorados em silêncio. Use um chat privado: num grupo, qualquer membro poderia perguntar.
  - Ações como reiniciar a antena só são **propostas**; a confirmação continua no painel.
  - Para só receber alertas, defina `ORBITLINK_TELEGRAM_CHAT_ENABLED=false`.
  - Um bot só pode ser lido por um agente: se o mesmo token estiver no Windows e no servidor, o Telegram recusa um deles (`HTTP 409`, visível em Alertas).
- **Resumo semanal no Telegram:** com o bot configurado, toda segunda às 8h (hora local) chega o resumo da semana anterior: consumo (e comparação com a semana anterior), dia de maior uso, franquia, disponibilidade, quedas, latência, perda, pior horário, vezes em que a antena ficou inacessível e alertas disparados.
  - Dia, hora e liga/desliga em **Alertas → Resumo semanal** (ou `ORBITLINK_WEEKLY_DIGEST_*` no `orbitlink.env`). **Enviar agora** manda os últimos 7 dias na hora.
  - Sem internet no horário, o resumo espera na fila e sai quando a conexão volta. Se o agente estava parado e só voltou mais de 24 h depois, aquela semana é pulada. Semana sem nenhum dado observado não gera resumo.
  - Cobertura abaixo de 99% aparece no texto: nesse caso o consumo real é igual ou maior que o mostrado.
- **Franquia do plano:** em **Configurações**, informe a franquia mensal (GB) e o dia de virada do ciclo. A tela de Consumo passa a mostrar o percentual e a projeção, e os alertas avisam em 80% e 100%. É uma **estimativa local**: períodos em que o agente não observou a antena não entram na conta, e a fatura oficial pode diferir.
- **Variáveis `NEXT_PUBLIC_*`:** são embutidas no build. Depois de alterá-las, rode `sudo orbitlinkctl update` em vez de só `restart`.

## 6. Conectar à Starlink Mini

O servidor precisa alcançar `192.168.100.1:9200`.

```bash
ip route get 192.168.100.1
sudo orbitlinkctl diagnose
```

| Topologia | O que fazer |
|---|---|
| Servidor ligado por cabo ao roteador da própria Starlink | Normalmente funciona direto |
| Starlink em **bypass** com **roteador próprio** como gateway do servidor | Crie no **roteador** a rota estática `192.168.100.1/32 → WAN` |
| Servidor com uma 2ª interface na rede da Starlink, ou próximo salto diferente do gateway | Rota no servidor: teste com `sudo ip route add 192.168.100.1/32 via <próximo-salto>` (temporária) e torne persistente com `deploy/linux/netplan/99-orbitlink-starlink-route.yaml.example` + `sudo netplan try` |

O OrbitLink **não altera rotas** sozinho. Enquanto a antena estiver inacessível, o painel mostra "Antena inacessível" e **nenhum número**. Os períodos sem observação aparecem como lacunas, nunca como zero.

## 7. Acesso remoto seguro (Tailscale, opcional)

```bash
sudo bash deploy/linux/install.sh --with-tailscale   # ou: rode de novo o instalador com a opção
sudo tailscale up                                     # autentique pelo link exibido
tailscale ip -4                                       # ex.: 100.101.102.103
```

- No celular ou notebook com Tailscale, acesse `https://100.x.y.z/` ou o nome MagicDNS (`servidor.sua-tailnet.ts.net`). Com `--with-tailscale`, a ACL do Nginx libera a faixa `100.64.0.0/10` e o UFW libera a interface `tailscale0`.
- Sem o Tailscale, essa faixa **não** é liberada no Nginx: ela é a mesma da CGNAT da Starlink.
- O SSH também fica acessível pela Tailnet.
- **Não** use `tailscale funnel`, que publicaria o painel na internet.
- Opcional: certificado válido via `tailscale cert` (requer HTTPS habilitado na Tailnet). Aponte `ssl_certificate` e `ssl_certificate_key` em `/etc/nginx/sites-available/orbitlink` para os arquivos gerados.

Se você instalou o Tailscale depois do OrbitLink, rode o instalador de novo. Ele detecta o Tailscale, libera a faixa na ACL do Nginx e a interface `tailscale0` no UFW:

```bash
sudo bash deploy/linux/install.sh
```

## 8. ESP32

```bash
sudo orbitlinkctl esp32 enable          # porta 8788 liberada só para a LAN + reinício do agente
```

Depois siga [ESP32_SETUP.md](ESP32_SETUP.md). No portal do ESP32, informe o **IP do servidor na LAN** e a porta **8788**.

No Linux, o segredo de cada ESP32 fica cifrado com Fernet no SQLite. A chave fica em `/etc/orbitlink/secrets.key`, fora dos backups. Para migrar ESP32s pareados para outra máquina, copie também essa chave; sem ela, refaça o pareamento.

## 9. Segurança: resumo

- Agente e painel só em loopback. `orbitlinkctl health` **falha** se 8787 ou 3000 aparecerem fora do loopback.
- O Nginx publica apenas o painel, com TLS. Há limite de taxa no login (10/min por IP) e na API, e `X-Forwarded-For` é sobrescrito (não concatenado) para impedir falsificação.
- O Nginx só responde a requisições cujo `Host` seja um nome deste servidor, um IP literal ou `*.ts.net`. Qualquer outro nome recebe 444 (conexão encerrada), o que bloqueia DNS rebinding contra a tela de login.
- A faixa `100.64.0.0/10` só entra na ACL quando o Tailscale existe, porque também é a CGNAT da Starlink.
- O primeiro administrador só pode ser criado com o **código de setup**, que só root lê. Isso impede que alguém da LAN "tome" o painel antes de você.
- Cookies `Secure`, `HttpOnly` e `SameSite=Strict`, com verificação de `Origin` nas requisições que alteram dados.
- Serviços endurecidos no systemd:
  - `ProtectSystem=strict`, `NoNewPrivileges`, sem capabilities, `PrivateDevices`, `ProtectHome`;
  - escrita só em `/var/lib/orbitlink` (o painel só no cache do Next);
  - limites de memória e tarefas.
- `--harden-ssh` só é aplicado se houver chave em `authorized_keys` do usuário que executou o `sudo`, e passa por `sshd -t` antes de recarregar. Mantenha a sessão aberta e teste outro login antes de sair.
- Atualizações de segurança automáticas do Ubuntu: `sudo apt-get install unattended-upgrades && sudo dpkg-reconfigure -plow unattended-upgrades`.

## 10. Solução de problemas

| Sintoma | Verifique |
|---|---|
| `orbitlinkctl health` falha no agente | `orbitlinkctl logs agent -n 100`. É comum faltar `ORBITLINK_API_TOKEN` ou haver erro de sintaxe no `.env` (use `CHAVE=valor`, sem espaços ao redor do `=`) |
| Painel 502 Bad Gateway | `systemctl status orbitlink-web` e `orbitlinkctl logs web` |
| Navegador não abre o painel | Seu PC está na LAN liberada? Veja `sudo ufw status` e `/etc/nginx/snippets/orbitlink-acl.conf`. Se a LAN mudou, rode o instalador de novo com `--lan-cidr` |
| Abre por IP, mas não por um nome (conexão encerrada, sem resposta) | O Nginx só aceita o hostname do servidor, `hostname.local`, IPs e `*.ts.net`. Para outro nome (ex.: `orbitlink.lan`), rode o instalador de novo com `--server-name orbitlink.lan` |
| "Código de configuração inválido" | `sudo orbitlinkctl setup-code` |
| "Antena inacessível" | Seção 6, `orbitlinkctl doctor` (mostra `ip route get` e o teste TCP 9200) |
| Serviço parou de reiniciar sozinho | Atingiu o limite de 10 reinícios em 5 min. Corrija a causa e rode `sudo systemctl reset-failed orbitlink-agent && sudo orbitlinkctl restart` |
| Build falha por memória | Crie swap: `sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile` |
| `update` reverteu sozinho | A release nova não respondeu. Veja `journalctl -u orbitlink-agent -u orbitlink-web --since '15 min ago'` |
| ESP32 sem conexão | `sudo orbitlinkctl esp32 enable`, `sudo ufw status \| grep 8788` e `orbitlinkctl logs agent \| grep esp32` |
| Sync Supabase parado | `orbitlinkctl logs agent \| grep sync`. A fila local é preservada |
| Alerta do Telegram não chega | Painel → Alertas → **Enviar teste** mostra o erro. `HTTP 401` = token errado. `HTTP 400: chat not found` = chat_id errado ou você não mandou mensagem ao bot. `orbitlinkctl logs agent \| grep notify` |
| Esqueci a senha do painel | Veja "Recuperação" em [SECURITY.md](SECURITY.md#recuperação) |

## 11. Desinstalar

```bash
sudo bash deploy/linux/uninstall.sh            # mantém dados e configuração
sudo bash deploy/linux/uninstall.sh --purge    # apaga tudo (pede confirmação)
```
