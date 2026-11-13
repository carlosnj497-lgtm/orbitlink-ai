# Segurança

## Superfície exposta

- **Painel** em `127.0.0.1:3000` e **agente** em `127.0.0.1:8787` por padrão. Escutar fora do loopback exige `ORBITLINK_ALLOW_LAN=true`, que é recusado caso contrário.
- **Listener ESP32** (opcional) em `:8788`, com apenas `pair`, `ingest`, `heartbeat` e `time`. Todas, menos `time`, exigem HMAC ou código de pareamento.
- A porta gRPC da antena (9200) **nunca** deve ser exposta à internet.

## Autenticação e autorização

| Camada | Mecanismo |
|---|---|
| Navegador → Next | Cookie `orbitlink_session` httpOnly, SameSite=Strict, `Secure` quando `ORBITLINK_COOKIE_SECURE=true`. Verificação de `Origin` em requisições mutantes |
| Next → agente | `Authorization: Bearer ORBITLINK_API_TOKEN` (só no servidor) + `X-OrbitLink-Session` |
| Usuário local | scrypt (N=2¹⁴, r=8, p=1), sessão de 12 h guardada como SHA-256, bloqueio após 5 senhas erradas em 5 min (login certo zera a contagem), setup inicial só via loopback |
| Ações de controle | Admin, capacidade presente na matriz, `operation_id` + nonce de uso único (hash), TTL de 120 s, mesmo usuário, texto de confirmação e auditoria de cada etapa |
| ESP32 | Código de 6 dígitos (TTL 10 min, uso único, 10 tentativas/min por IP), segredo por dispositivo protegido com **DPAPI**, HMAC-SHA256 sobre `device\nts\nnonce\nsha256(body)`, janela de ±300 s, nonce anti-replay e limite de 32 KB |
| Supabase | RLS deny-by-default (`force row level security`), isolamento por `workspace_members`, telemetria gravada só via `ingest_batch` (token do agente com hash), `anon` sem leitura de tabelas e **nenhuma** `service_role` no agente ou no navegador |

## Dados pessoais

- O ID do terminal vira hash (`ut-<sha256[:16]>`), e o ID bruto nunca é salvo nem sincronizado.
- A localização GPS não é consultada.
- MACs aparecem mascarados por padrão (`AA:BB:CC:XX:XX:XX`).
- Relatórios de diagnóstico compartilháveis mascaram IPs da LAN e removem chaves sensíveis.
- Logs JSON redigem tokens, senhas e chaves.

## IA

- A chave da Anthropic fica só no agente (`ORBITLINK_ANTHROPIC_API_KEY`).
- Todas as ferramentas são **somente leitura**, com schema `strict`. `prepare_control_action` só devolve uma proposta e não cria nenhuma operação.
- Saídas de ferramentas vão delimitadas como `<dados_nao_confiaveis>`, sem caracteres de controle, truncadas em 12 000 caracteres. O prompt de sistema manda ignorar instruções contidas nelas (proteção contra injeção via nome de dispositivo ou log).
- Há limite diário de perguntas, no máximo 6 iterações de ferramentas por pergunta, `max_tokens` configurável, custo estimado registrado e conversas expiradas automaticamente (30 dias por padrão).

## Servidor Linux

- O primeiro administrador exige `ORBITLINK_SETUP_CODE`. É gerado pelo instalador e só root lê, em `/etc/orbitlink/setup-code`. Isso impede que alguém da LAN crie o administrador antes de você.
- Unidades systemd endurecidas: `ProtectSystem=strict`, sem capabilities, `NoNewPrivileges`, escrita só em `/var/lib/orbitlink`.
- O Nginx é a única porta publicada (TLS, ACL só para LAN e Tailnet, limite de taxa). `/v1/` e `/esp32/` devolvem 404.
- A faixa `100.64.0.0/10` só é liberada na ACL quando o Tailscale existe no servidor, porque também é a CGNAT da Starlink.
- `Host` desconhecido recebe 444 (proteção contra DNS rebinding). São aceitos os nomes do servidor, IPs literais e `*.ts.net`.
- UFW nega entrada por padrão. `orbitlinkctl health` falha se 8787 ou 3000 escutarem fora do loopback.
- Detalhes em [LINUX_SERVER.md](LINUX_SERVER.md).

## Segredos em repouso

- `.env` com ACL apenas do usuário (feito pelo `install.ps1`) e listado no `.gitignore`. No Linux: `/etc/orbitlink/orbitlink.env` com `root:orbitlink 0640`.
- Segredos de ESP32 protegidos com DPAPI no Windows (escopo do usuário). No Linux, Fernet com chave em `/etc/orbitlink/secrets.key`, fora do diretório de dados e dos backups.
- A exportação JSON e a tela de Configurações nunca incluem segredos.

## Recuperação

**Windows**

- Backup: pare o agente e copie `data\orbitlink.sqlite3`. Para exportar configurações sem segredos, use Relatórios → JSON.
- Esqueceu a senha local: pare o agente, apague `data\orbitlink.sqlite3` (perde o histórico local) ou remova a linha em `local_users` com um cliente SQLite, e refaça o setup.

**Ubuntu Server**

- Backup: automático todo dia às 03:30 em `/var/lib/orbitlink/backups` (14 cópias). Na hora: `sudo orbitlinkctl backup`. Restaurar: `sudo orbitlinkctl restore /var/lib/orbitlink/backups/<arquivo>.sqlite3.gz`.
- Para guardar fora do servidor, copie também `/etc/orbitlink/` (contém o `secrets.key`, sem o qual os segredos de ESP32 do backup não abrem). Guarde em local seguro, nunca no repositório.
- Esqueceu a senha local (mantém o histórico; apaga só usuários e sessões):

  ```bash
  sudo systemctl stop orbitlink-agent
  sudo -u orbitlink sqlite3 /var/lib/orbitlink/orbitlink.sqlite3 "DELETE FROM sessions; DELETE FROM local_users;"
  sudo systemctl start orbitlink-agent
  sudo orbitlinkctl setup-code   # o painel volta a pedir a criação do administrador, com este código
  ```

## Notificações

- O token do bot do Telegram fica só no agente (`ORBITLINK_TELEGRAM_BOT_TOKEN`), nunca vai ao navegador, à fila de notificações nem aos logs (o `httpx` registra URLs e por isso fica em nível WARNING, e a redação de logs remove `/bot<token>`).
- As mensagens levam só o nome da antena, a regra, o valor medido e o horário. Nada de IPs, IDs do terminal ou localização.
- O webhook pode conter segredo na própria URL (Slack, Discord). Por isso erros de entrega registram apenas o tipo do erro ou o código HTTP.

## Cadeia de suprimentos

- As dependências Python do servidor são instaladas de `apps/agent/requirements.lock` com `--require-hashes`: só as versões testadas, e o pip recusa qualquer arquivo cujo hash não confira.
- O CI roda `npm audit` e `pip-audit` a cada push e toda segunda-feira, e o Dependabot abre PRs de atualização do npm e das GitHub Actions.

## Reportar problemas

Abra uma issue privada no repositório. Não inclua tokens, `.env` ou relatórios sem sanitizar.
