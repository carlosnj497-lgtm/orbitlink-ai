# Servidor Linux: Ubuntu Server 24.04 LTS

Instalação do ASTRYON num PC servidor **sem interface gráfica e sem Docker**, com:

- serviços **systemd** separados para agente e painel, com reinício automático em falhas;
- logs no **journald**;
- **Nginx** com TLS como único ponto de entrada;
- **UFW** negando por padrão;
- **SSH** opcionalmente endurecido;
- **Tailscale** opcional.

> **Situação dos testes.** Os scripts foram verificados com `bash -n` e `shellcheck` (sem achados), e a parte Python nova (rotas via `ip -j`, Fernet, código de setup) tem testes automatizados. Eles **ainda não foram executados num Ubuntu 24.04 real** neste ambiente de desenvolvimento. Na primeira instalação, acompanhe a saída e rode `sudo astryonctl doctor` no fim.

## 1. Como fica no servidor

```
Navegador (LAN ou Tailnet) ──HTTPS:443──▶ Nginx ──▶ Next.js (localhost:3000) ──▶ Agente (localhost:8787) ──gRPC──▶ Starlink (IP-DA-ANTENA:9200)
ESP32 (LAN) ─────────────────HTTP:8788 (HMAC)──────────────────────────────────▶ Agente (opcional)
Agente ──HTTPS saída──▶ Supabase (opcional)   ·   SQLite em /var/lib/astryon = buffer offline
```

| Caminho | Conteúdo | Permissão |
|---|---|---|
| `/opt/astryon/releases/<data>/` | Código, `.venv` Python, `node_modules` e build do painel. Uma pasta por versão (guarda 3) | `astryon` |
| `/opt/astryon/current` | Link para a release ativa (troca atômica) | |
| `/var/lib/astryon/` | `astryon.sqlite3` (WAL) e `backups/` | `astryon` 0750 |
| `/etc/astryon/astryon.env` | Configuração e segredos | `root:astryon` 0640 |
| `/etc/astryon/secrets.key` | Chave Fernet dos segredos do ESP32, separada dos dados e backups | `root:astryon` 0640 |
| `/etc/astryon/setup-code` | Código para criar o 1º administrador | `root` 0600 |
| `/etc/astryon/tls/` | Certificado autoassinado (ECDSA P-256, 825 dias) | chave `root` 0600 |
| `/usr/local/bin/astryonctl` | CLI de operação | |

| Porta | Escuta | Quem acessa |
|---|---|---|
| 22 (SSH) | todas | UFW: só LAN, Tailnet e sessões SSH ativas no momento da instalação, com `ufw limit` |
| 80 / 443 (Nginx) | todas | UFW + ACL do Nginx: só LAN e, se o Tailscale estiver instalado, a Tailnet (faixa CGNAT do Tailscale). `Host` desconhecido recebe 444. A 80 apenas redireciona para HTTPS quem passa pela ACL |
| 3000 (painel) | **só localhost** | só o Nginx |
| 8787 (agente) | **só localhost** | só o painel. **Nunca** publicado (o Nginx devolve 404 em `/v1/`) |
| 8788 (ESP32) | todas as interfaces, **só se habilitado** | UFW: só LAN. Toda mensagem exige HMAC |

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
git clone <URL-DO-SEU-REPOSITORIO> ~/astryon
cd ~/astryon

# 3) Instale (confira a rede local detectada na saída)
sudo bash deploy/linux/install.sh
#    Opções úteis:
#      --lan-cidr SUA-REDE/24      informa a LAN, se a detecção errar
#      --with-tailscale            instala o Tailscale e libera o painel na interface tailscale0
#      --esp32                     habilita o listener do ESP32 (porta 8788 só para a LAN)
#      --harden-ssh                desativa senha e root no SSH (só se você já usa chave)
#      --yes                       não pergunta nada

# 4) Pegue o código de configuração inicial
sudo cat /etc/astryon/setup-code

# 5) No navegador de um PC da LAN: https://IP-DO-SERVIDOR/
#    Aceite o aviso do certificado autoassinado, crie o administrador e informe o código do passo 4.
```

O instalador faz, nesta ordem:

1. Confere se o sistema é Ubuntu 24.04 com systemd.
2. Instala `python3-venv`, `nginx`, `ufw`, `sqlite3`, `openssl` e `rsync`, além do Node.js 22 pelo repositório oficial NodeSource (chave GPG em `/etc/apt/keyrings`, sem `curl | bash`).
3. Cria o usuário de sistema `astryon` (sem shell de login) e os diretórios.
4. Gera `/etc/astryon/astryon.env` com:
   - token de serviço aleatório;
   - `ASTRYON_COOKIE_SECURE=true`;
   - código de setup;
   - `ASTRYON_HOST` apontando para localhost (loopback).
5. Gera a chave Fernet e o certificado TLS (SAN com hostname, `.local` e IP da LAN).
6. Constrói a release: venv Python, `npm ci` e `next build`.
7. Ativa o link `current`.
8. Instala e habilita `astryon.target`, `astryon-agent`, `astryon-web` e `astryon-backup.timer`.
9. Configura o Nginx com ACL da LAN (e do Tailscale, se ele existir ou se você usar `--with-tailscale`), aceitando só os nomes deste servidor no `Host`, e desabilita o site `default` (o arquivo é mantido).
10. Configura o UFW. **Antes de ativá-lo**, libera o SSH para a LAN e para a sessão SSH atual.
11. Verifica a saúde e mostra as portas em escuta.

Rodar o instalador de novo é seguro: ele preserva `.env`, chaves, certificado e dados.

## 4. Operação diária

| Ação | Comando |
|---|---|
| Iniciar tudo | `sudo astryonctl start` (ou `start agent` / `start web`) |
| Parar | `sudo astryonctl stop` |
| Reiniciar (após editar o `.env`) | `sudo astryonctl restart` |
| Estado + saúde | `sudo astryonctl status` |
| Só a verificação de saúde (exit 0 = ok) | `sudo astryonctl health` |
| Logs do agente / painel / Nginx | `sudo astryonctl logs agent -f` · `logs web` · `logs nginx` · `logs all --since "1 hour ago"` |
| Diagnóstico da antena (somente leitura) | `sudo astryonctl diagnose` (`--json`, `--share`, `--no-router`) |
| Diagnóstico completo de falhas | `sudo astryonctl doctor` |
| Atualizar | `sudo astryonctl update --git-pull` |
| Voltar para a versão anterior | `sudo astryonctl rollback` |
| Backup agora / restaurar | `sudo astryonctl backup` · `sudo astryonctl restore /var/lib/astryon/backups/<arquivo>.sqlite3.gz` |
| Releases instaladas | `sudo astryonctl releases` |
| Código de setup | `sudo astryonctl setup-code` |
| Ligar/desligar ESP32 | `sudo astryonctl esp32 enable` / `disable` |
| Token do agente para o Supabase | `sudo astryonctl supabase-token --email voce@exemplo.com` |
| Descobrir o chat do Telegram | `sudo astryonctl telegram-chat-id` |

Equivalentes diretos do systemd:

```bash
systemctl status astryon-agent astryon-web
sudo systemctl restart astryon.target
journalctl -u astryon-agent -f              # JSON estruturado; filtre com:  | grep '"level": "error"'
journalctl -u astryon-agent -p warning --since today
systemctl show -p NRestarts astryon-agent   # quantas vezes reiniciou sozinho
```

**Reinício automático:** `Restart=on-failure` com 5 s de espera, até 10 tentativas em 5 minutos. Depois disso o systemd para de tentar; corrija a causa e rode `sudo astryonctl restart`. Os serviços sobem no boot via `astryon.target`.

**Atualização:** faz backup do SQLite, constrói a nova release **sem tocar na que está no ar**, troca o link, reinicia e verifica a saúde. Se a nova versão não responder em ~60 s, volta sozinha para a anterior.

### Backup automático e vigia do servidor

O próprio agente cuida disto, sem cron:

- **Backup diário** do banco em `<pasta de dados>/backups/astryon-AAAAMMDD-HHMMSS.sqlite3.gz`. Mantém as
  últimas `ASTRYON_BACKUP_KEEP` cópias (padrão 7). Com o Telegram configurado, uma cópia por semana
  (`ASTRYON_BACKUP_TELEGRAM_EVERY_DAYS`) vai para o seu chat do bot, para sobreviver se o disco falhar.
  O botão **Fazer backup agora** fica em Configurações → Servidor e backup.
- **Restaurar:** pare o agente, descompacte a cópia como `astryon.sqlite3` na pasta de dados e inicie de novo:
  `gunzip -c astryon-AAAAMMDD-HHMMSS.sqlite3.gz > astryon.sqlite3`.
- **Saúde do servidor:** temperatura, disco livre, memória e tamanho do banco aparecem no Dashboard e nas
  Configurações. As regras "pouco disco livre" (< 10%) e "temperatura alta" (> 85 °C) avisam pelo Telegram.
- **Aviso de volta:** se o agente ficar parado mais que `ASTRYON_DOWNTIME_NOTICE_MIN` minutos (padrão 10),
  ao voltar ele avisa no Telegram por quanto tempo nada foi monitorado.
- **Vigia externo (opcional):** o servidor não consegue avisar que ele mesmo desligou. Crie um check gratuito em
  [healthchecks.io](https://healthchecks.io) com período de 5 minutos, ligue a integração com o Telegram de lá e
  coloque a URL de ping em `ASTRYON_HEALTHCHECK_URL` (só `https://`). Se os pings pararem, o healthchecks.io
  avisa você.

## 5. Configuração

Edite `/etc/astryon/astryon.env` e depois rode `sudo astryonctl restart`. As mesmas variáveis do `.env.example` valem aqui.

```bash
sudo nano /etc/astryon/astryon.env
sudo astryonctl restart
```

- **Supabase:** preencha `ASTRYON_SUPABASE_URL`, `ASTRYON_SUPABASE_ANON_KEY` e `ASTRYON_SUPABASE_AGENT_TOKEN` (gerado com `astryonctl supabase-token`; veja [SUPABASE.md](SUPABASE.md)).
  - O agente continua coletando no SQLite mesmo sem internet e envia a fila quando a conexão volta.
  - Só tráfego **de saída** HTTPS é usado, e o UFW permite saída por padrão.
- **IA (Groq):** preencha `ASTRYON_GROQ_API_KEY` (chave em console.groq.com). O agente precisa de saída HTTPS para api.groq.com.
- **Alertas no Telegram:**
  1. No Telegram, fale com o **@BotFather**, envie `/newbot` e guarde o token.
  2. Abra o bot criado e mande qualquer mensagem (ex.: `/start`).
  3. Ponha o token em `ASTRYON_TELEGRAM_BOT_TOKEN` e rode `sudo astryonctl telegram-chat-id`. Copie o número para `ASTRYON_TELEGRAM_CHAT_ID`.
  4. `sudo astryonctl restart` e, no painel, **Alertas → Enviar teste**.
  - Sem internet (caso típico da "antena inacessível"), a mensagem fica na fila do SQLite e sai quando a conexão volta, com o horário original. Depois de 24 h sem conseguir, é descartada (`ASTRYON_NOTIFICATION_MAX_AGE_H`).
  - Se o servidor tiver outra saída para a internet além da Starlink (4G, outra operadora), o aviso de queda chega na hora.
- **Perguntas pelo Telegram:** com o bot configurado, mande perguntas para ele ("Como está a conexão?", "Vou passar da franquia?"). Ele responde com o mesmo assistente do painel (Groq, ou diagnóstico por regras sem chave). Comandos: `/status` (regras, sem IA), `/resumo` (últimos 7 dias, sem IA), `/nova` (conversa nova), `/ajuda`.
  - Só o chat de `ASTRYON_TELEGRAM_CHAT_ID` é atendido; outros são ignorados em silêncio. Use um chat privado: num grupo, qualquer membro poderia perguntar.
  - Ações como reiniciar a antena só são **propostas**; a confirmação continua no painel.
  - Para só receber alertas, defina `ASTRYON_TELEGRAM_CHAT_ENABLED=false`.
  - Um bot só pode ser lido por um agente: se o mesmo token estiver no Windows e no servidor, o Telegram recusa um deles (`HTTP 409`, visível em Alertas).
- **Resumo semanal no Telegram:** com o bot configurado, toda segunda às 8h (hora local) chega o resumo da semana anterior: consumo (e comparação com a semana anterior), dia de maior uso, franquia, disponibilidade, quedas, latência, perda, pior horário, vezes em que a antena ficou inacessível e alertas disparados.
  - Dia, hora e liga/desliga em **Alertas → Resumo semanal** (ou `ASTRYON_WEEKLY_DIGEST_*` no `astryon.env`). **Enviar agora** manda os últimos 7 dias na hora.
  - Sem internet no horário, o resumo espera na fila e sai quando a conexão volta. Se o agente estava parado e só voltou mais de 24 h depois, aquela semana é pulada. Semana sem nenhum dado observado não gera resumo.
  - Cobertura abaixo de 99% aparece no texto: nesse caso o consumo real é igual ou maior que o mostrado.
- **Franquia do plano:** em **Configurações**, informe a franquia mensal (GB) e o dia de virada do ciclo. A tela de Consumo passa a mostrar o percentual e a projeção, e os alertas avisam em 80% e 100%. É uma **estimativa local**: períodos em que o agente não observou a antena não entram na conta, e a fatura oficial pode diferir.
- **Variáveis `NEXT_PUBLIC_*`:** são embutidas no build. Depois de alterá-las, rode `sudo astryonctl update` em vez de só `restart`.

## 6. Conectar à Starlink Mini

O servidor precisa alcançar a antena em `IP-DA-ANTENA`, porta 9200. `IP-DA-ANTENA` é o endereço local da antena, definido em `ASTRYON_DISH_TARGET` no `.env`.

```bash
ip route get IP-DA-ANTENA
sudo astryonctl diagnose
```

| Topologia | O que fazer |
|---|---|
| Servidor ligado por cabo ao roteador da própria Starlink | Normalmente funciona direto |
| Starlink em **bypass** com **roteador próprio** como gateway do servidor | Crie no **roteador** a rota estática `IP-DA-ANTENA/32 → WAN` |
| Servidor com uma 2ª interface na rede da Starlink, ou próximo salto diferente do gateway | Rota no servidor: teste com `sudo ip route add IP-DA-ANTENA/32 via <próximo-salto>` (temporária) e torne persistente com `deploy/linux/netplan/99-astryon-starlink-route.yaml.example` + `sudo netplan try` |

O ASTRYON **não altera rotas** sozinho. Enquanto a antena estiver inacessível, o painel mostra "Antena inacessível" e **nenhum número**. Os períodos sem observação aparecem como lacunas, nunca como zero.

## 7. Acesso remoto seguro (Tailscale, opcional)

```bash
sudo bash deploy/linux/install.sh --with-tailscale   # ou: rode de novo o instalador com a opção
sudo tailscale up                                     # autentique pelo link exibido
tailscale ip -4                                       # mostra o IP do servidor na Tailnet
```

- No celular ou notebook com Tailscale, acesse `https://IP-TAILSCALE/` (o IP mostrado acima) ou o nome MagicDNS (`servidor.sua-tailnet.ts.net`). Com `--with-tailscale`, a ACL do Nginx libera a faixa CGNAT do Tailscale e o UFW libera a interface `tailscale0`.
- Sem o Tailscale, essa faixa **não** é liberada no Nginx: ela é a mesma da CGNAT da Starlink.
- O SSH também fica acessível pela Tailnet.
- **Não** use `tailscale funnel`, que publicaria o painel na internet.
- Opcional: certificado válido via `tailscale cert` (requer HTTPS habilitado na Tailnet). Aponte `ssl_certificate` e `ssl_certificate_key` em `/etc/nginx/sites-available/astryon` para os arquivos gerados.

Se você instalou o Tailscale depois do ASTRYON, rode o instalador de novo. Ele detecta o Tailscale, libera a faixa na ACL do Nginx e a interface `tailscale0` no UFW:

```bash
sudo bash deploy/linux/install.sh
```

### HTTPS para uma instalação feita a partir da pasta do projeto

Se os serviços `astryon-agent` e `astryon-web` rodam direto do checkout (sem o `/opt` do `install.sh`),
use o script menor, que não muda nada de lugar:

```bash
sudo bash deploy/linux/https-local.sh
```

Ele instala o Nginx com HTTPS para a rede de casa, usa o certificado válido do Tailscale para o endereço
`https://<servidor>.<sua-tailnet>.ts.net/` (renovado toda semana), deixa o painel só em `127.0.0.1:3000`,
ativa o cookie de sessão "Secure" e liga o UFW sem derrubar as sessões SSH abertas.

- Antes, ligue **HTTPS Certificates** em https://login.tailscale.com/admin/dns (uma vez).
- Depois, o endereço `http://<servidor>:3000` deixa de funcionar: use os endereços `https://` que o script mostra.
- Pelo endereço `*.ts.net`, o navegador do celular oferece **instalar o ASTRYON como app**.
- Para desfazer: `sudo bash deploy/linux/https-local.sh --undo`.

## 8. ESP32

```bash
sudo astryonctl esp32 enable          # porta 8788 liberada só para a LAN + reinício do agente
```

Depois siga [ESP32_SETUP.md](ESP32_SETUP.md). No portal do ESP32, informe o **IP do servidor na LAN** e a porta **8788**.

No Linux, o segredo de cada ESP32 fica cifrado com Fernet no SQLite. A chave fica em `/etc/astryon/secrets.key`, fora dos backups. Para migrar ESP32s pareados para outra máquina, copie também essa chave; sem ela, refaça o pareamento.

## 9. Segurança: resumo

- Agente e painel só em loopback. `astryonctl health` **falha** se 8787 ou 3000 aparecerem fora do loopback.
- O Nginx publica apenas o painel, com TLS. Há limite de taxa no login (10/min por IP) e na API, e `X-Forwarded-For` é sobrescrito (não concatenado) para impedir falsificação.
- O Nginx só responde a requisições cujo `Host` seja um nome deste servidor, um IP literal ou `*.ts.net`. Qualquer outro nome recebe 444 (conexão encerrada), o que bloqueia DNS rebinding contra a tela de login.
- A faixa CGNAT do Tailscale só entra na ACL quando o Tailscale existe, porque também é a CGNAT da Starlink.
- O primeiro administrador só pode ser criado com o **código de setup**, que só root lê. Isso impede que alguém da LAN "tome" o painel antes de você.
- Cookies `Secure`, `HttpOnly` e `SameSite=Strict`, com verificação de `Origin` nas requisições que alteram dados.
- Serviços endurecidos no systemd:
  - `ProtectSystem=strict`, `NoNewPrivileges`, sem capabilities, `PrivateDevices`, `ProtectHome`;
  - escrita só em `/var/lib/astryon` (o painel só no cache do Next);
  - limites de memória e tarefas.
- `--harden-ssh` só é aplicado se houver chave em `authorized_keys` do usuário que executou o `sudo`, e passa por `sshd -t` antes de recarregar. Mantenha a sessão aberta e teste outro login antes de sair.
- Atualizações de segurança automáticas do Ubuntu: `sudo apt-get install unattended-upgrades && sudo dpkg-reconfigure -plow unattended-upgrades`.

## 10. Solução de problemas

| Sintoma | Verifique |
|---|---|
| `astryonctl health` falha no agente | `astryonctl logs agent -n 100`. É comum faltar `ASTRYON_API_TOKEN` ou haver erro de sintaxe no `.env` (use `CHAVE=valor`, sem espaços ao redor do `=`) |
| Painel 502 Bad Gateway | `systemctl status astryon-web` e `astryonctl logs web` |
| Navegador não abre o painel | Seu PC está na LAN liberada? Veja `sudo ufw status` e `/etc/nginx/snippets/astryon-acl.conf`. Se a LAN mudou, rode o instalador de novo com `--lan-cidr` |
| Abre por IP, mas não por um nome (conexão encerrada, sem resposta) | O Nginx só aceita o hostname do servidor, `hostname.local`, IPs e `*.ts.net`. Para outro nome (ex.: `astryon.lan`), rode o instalador de novo com `--server-name astryon.lan` |
| "Código de configuração inválido" | `sudo astryonctl setup-code` |
| "Antena inacessível" | Seção 6, `astryonctl doctor` (mostra `ip route get` e o teste TCP 9200) |
| Serviço parou de reiniciar sozinho | Atingiu o limite de 10 reinícios em 5 min. Corrija a causa e rode `sudo systemctl reset-failed astryon-agent && sudo astryonctl restart` |
| Build falha por memória | Crie swap: `sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile` |
| `update` reverteu sozinho | A release nova não respondeu. Veja `journalctl -u astryon-agent -u astryon-web --since '15 min ago'` |
| ESP32 sem conexão | `sudo astryonctl esp32 enable`, `sudo ufw status \| grep 8788` e `astryonctl logs agent \| grep esp32` |
| Sync Supabase parado | `astryonctl logs agent \| grep sync`. A fila local é preservada |
| Alerta do Telegram não chega | Painel → Alertas → **Enviar teste** mostra o erro. `HTTP 401` = token errado. `HTTP 400: chat not found` = chat_id errado ou você não mandou mensagem ao bot. `astryonctl logs agent \| grep notify` |
| Esqueci a senha do painel | Veja "Recuperação" em [SECURITY.md](SECURITY.md#recuperação) |

## 11. Desinstalar

```bash
sudo bash deploy/linux/uninstall.sh            # mantém dados e configuração
sudo bash deploy/linux/uninstall.sh --purge    # apaga tudo (pede confirmação)
```
