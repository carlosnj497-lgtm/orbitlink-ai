# Segurança

## Superfície exposta

- **Painel** (porta 3000) e **agente** (porta 8787) escutam só em localhost (loopback) por padrão. Escutar fora do loopback exige `ASTRYON_ALLOW_LAN=true`, que é recusado caso contrário.
- **Listener ESP32** (opcional) em `:8788`, com apenas `pair`, `ingest`, `heartbeat` e `time`. Todas, menos `time`, exigem HMAC ou código de pareamento.
- A porta gRPC da antena (9200) **nunca** deve ser exposta à internet.

## Autenticação e autorização

| Camada | Mecanismo |
|---|---|
| Navegador → Next | Cookie `astryon_session` httpOnly, SameSite=Strict, `Secure` quando `ASTRYON_COOKIE_SECURE=true`. Verificação de `Origin` em requisições mutantes |
| Next → agente | `Authorization: Bearer ASTRYON_API_TOKEN` (só no servidor) + `X-ASTRYON-Session` |
| Usuário local | scrypt (N=2¹⁴, r=8, p=1), sessão de 12 h guardada como SHA-256, bloqueio após 5 senhas erradas em 5 min (login certo zera a contagem), setup inicial só via loopback |
| Ações de controle | Admin, capacidade presente na matriz, `operation_id` + nonce de uso único (hash), TTL de 120 s, mesmo usuário, texto de confirmação e auditoria de cada etapa |
| ESP32 | Portal de configuração com senha própria por aparelho; código de 12 caracteres (60 bits, TTL 10 min, uso único, 10 tentativas/min por IP) que **não trafega**: o ESP32 prova que o conhece (PBKDF2 + HMAC) e recebe o segredo cifrado (AES-256-GCM), segredo por dispositivo protegido com **DPAPI**, HMAC-SHA256 sobre `device\nts\nnonce\nsha256(body)`, janela de ±300 s, nonce anti-replay e limite de 32 KB |
| Supabase | RLS deny-by-default (`force row level security`), isolamento por `workspace_members`, telemetria gravada só via `ingest_batch` (token do agente com hash), `anon` sem leitura de tabelas e **nenhuma** `service_role` no agente ou no navegador |

## Dados pessoais

- O ID do terminal vira hash (`ut-<sha256[:16]>`), e o ID bruto nunca é salvo nem sincronizado.
- A localização GPS não é consultada.
- MACs aparecem mascarados por padrão (`AA:BB:CC:XX:XX:XX`).
- Relatórios de diagnóstico compartilháveis mascaram IPs da LAN e removem chaves sensíveis.
- Logs JSON redigem tokens, senhas e chaves.

## IA

- A chave do Groq fica só no agente (`ASTRYON_GROQ_API_KEY`); o navegador nunca a recebe.
- Todas as ferramentas são **somente leitura**, com schema `strict`. `prepare_control_action` só devolve uma proposta e não cria nenhuma operação.
- Saídas de ferramentas vão delimitadas como `<dados_nao_confiaveis>`, sem caracteres de controle, truncadas em 12 000 caracteres. O prompt de sistema manda ignorar instruções contidas nelas (proteção contra injeção via nome de dispositivo ou log).
- Há limite diário de perguntas, no máximo 6 iterações de ferramentas por pergunta, `max_tokens` configurável, custo estimado registrado e conversas expiradas automaticamente (30 dias por padrão).

## Áudio (nota de voz do Telegram)

- A transcrição usa a **mesma chave** da Groq (`ASTRYON_GROQ_API_KEY`), que nunca sai do agente.
- O arquivo é baixado do Telegram em memória e **não é salvo em disco**: só o texto transcrito entra no histórico, com a mesma retenção das conversas de texto (30 dias por padrão).
- O download só acontece **depois** da checagem de chat autorizado, cota do dia e limite por minuto. Um chat não autorizado nunca faz o agente baixar o áudio.
- Limites próprios: `ASTRYON_AI_AUDIO_DAILY_REQUEST_LIMIT` (áudios por dia) e `ASTRYON_AI_AUDIO_MAX_BYTES` (tamanho por arquivo). A cota de texto (tokens) e a de áudio (requisições) são independentes.
- O custo é estimado por segundo de áudio, já com o mínimo de 10 s cobrados pela Groq por requisição, e registrado em `ai_audio_usage_daily`.
- O áudio é enviado para a Groq (Whisper), ou seja, **sai do seu computador**. Isso vale para qualquer usuário que ligar o recurso.

## Servidor Linux

- O primeiro administrador exige `ASTRYON_SETUP_CODE`. É gerado pelo instalador e só root lê, em `/etc/astryon/setup-code`. Isso impede que alguém da LAN crie o administrador antes de você.
- Unidades systemd endurecidas: `ProtectSystem=strict`, sem capabilities, `NoNewPrivileges`, escrita só em `/var/lib/astryon`.
- O Nginx é a única porta publicada (TLS, ACL só para LAN e Tailnet, limite de taxa). `/v1/` e `/esp32/` devolvem 404.
- A faixa CGNAT usada pelo Tailscale só é liberada na ACL quando o Tailscale existe no servidor, porque também é a CGNAT da Starlink.
- `Host` desconhecido recebe 444 (proteção contra DNS rebinding). São aceitos os nomes do servidor, IPs literais e `*.ts.net`.
- UFW nega entrada por padrão. `astryonctl health` falha se 8787 ou 3000 escutarem fora do loopback.
- Detalhes em [LINUX_SERVER.md](LINUX_SERVER.md).

## Segredos em repouso

- `.env` com ACL apenas do usuário (feito pelo `install.ps1`) e listado no `.gitignore`. No Linux: `/etc/astryon/astryon.env` com `root:astryon 0640`.
- Segredos de ESP32 protegidos com DPAPI no Windows (escopo do usuário). No Linux, Fernet com chave em `/etc/astryon/secrets.key`, fora do diretório de dados e dos backups.
- A exportação JSON e a tela de Configurações nunca incluem segredos.

## Recuperação

**Windows**

- Backup: pare o agente e copie `data\astryon.sqlite3`. Para exportar configurações sem segredos, use Relatórios → JSON.
- Esqueceu a senha local: pare o agente, apague `data\astryon.sqlite3` (perde o histórico local) ou remova a linha em `local_users` com um cliente SQLite, e refaça o setup.

**Ubuntu Server**

- Backup: automático todo dia às 03:30 em `/var/lib/astryon/backups` (14 cópias). Na hora: `sudo astryonctl backup`. Restaurar: `sudo astryonctl restore /var/lib/astryon/backups/<arquivo>.sqlite3.gz`.
- Para guardar fora do servidor, copie também `/etc/astryon/` (contém o `secrets.key`, sem o qual os segredos de ESP32 do backup não abrem). Guarde em local seguro, nunca no repositório.
- Esqueceu a senha local (mantém o histórico; apaga só usuários e sessões):

  ```bash
  sudo systemctl stop astryon-agent
  sudo -u astryon sqlite3 /var/lib/astryon/astryon.sqlite3 "DELETE FROM sessions; DELETE FROM local_users;"
  sudo systemctl start astryon-agent
  sudo astryonctl setup-code   # o painel volta a pedir a criação do administrador, com este código
  ```

## Notificações

- O token do bot do Telegram fica só no agente (`ASTRYON_TELEGRAM_BOT_TOKEN`), nunca vai ao navegador, à fila de notificações nem aos logs (o `httpx` registra URLs e por isso fica em nível WARNING, e a redação de logs remove `/bot<token>`).
- As mensagens levam só o nome da antena, a regra, o valor medido e o horário. Nada de IPs, IDs do terminal ou localização.
- O bot que responde perguntas busca as mensagens no Telegram (long polling): nenhuma porta é aberta. Só o chat configurado é atendido, mensagens de outros chats são ignoradas sem resposta e sem registrar o conteúdo. A IA continua somente leitura: propostas de ação vão com o aviso "Nada foi executado" e só podem ser confirmadas no painel. Vale a cota diária do assistente e um limite por minuto (`ASTRYON_TELEGRAM_CHAT_PER_MINUTE`). Ao ligar pela primeira vez, mensagens antigas são descartadas sem resposta.
- O webhook pode conter segredo na própria URL (Slack, Discord). Por isso erros de entrega registram apenas o tipo do erro ou o código HTTP.

## Cadeia de suprimentos

- As dependências Python do servidor são instaladas de `apps/agent/requirements.lock` com `--require-hashes`: só as versões testadas, e o pip recusa qualquer arquivo cujo hash não confira.
- O CI roda `npm audit` e `pip-audit` a cada push e toda segunda-feira, e o Dependabot abre PRs de atualização do npm e das GitHub Actions.

## Reportar problemas

Abra uma issue privada no repositório. Não inclua tokens, `.env` ou relatórios sem sanitizar.
