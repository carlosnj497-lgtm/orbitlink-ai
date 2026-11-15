# Migração para ASTRYON

O painel, o agente, os pacotes e os instaladores agora usam o nome **ASTRYON**.

| Antes | Agora |
|---|---|
| `ORBITLINK_*` | `ASTRYON_*` |
| `orbitlink_agent` | `astryon_agent` |
| `orbitlink-agent` / `orbitlink-web` | `astryon-agent` / `astryon-web` |
| `orbitlinkctl` | `astryonctl` |
| `@orbitlink/*` | `@astryon/*` |
| `orbitlink.sqlite3` | `astryon.sqlite3` |
| `/etc/orbitlink`, `/var/lib/orbitlink`, `/opt/orbitlink` | `/etc/astryon`, `/var/lib/astryon`, `/opt/astryon` |

O endereço do repositório no GitHub continua válido com o nome anterior até a
renomeação pelo proprietário. Os comandos de clone já usam `~/astryon` como destino.

## Configuração e dados

1. Faça backup dos dados e da configuração. Guarde também a chave `secrets.key`:
   ela é necessária para recuperar os segredos criptografados.
2. Pare o painel, o agente e os timers antigos antes de copiar o SQLite.
3. No arquivo `.env`, troque o prefixo das **chaves** `ORBITLINK_` por `ASTRYON_`,
   preservando os valores dos tokens, senhas, código de configuração e integrações.
   Ajuste separadamente os caminhos de diretórios que tiverem sido movidos.
4. Copie o diretório de dados e a chave de criptografia para os novos caminhos.
   Com o agente parado, renomeie `orbitlink.sqlite3` para `astryon.sqlite3`.
   Se existirem, renomeie também `orbitlink.sqlite3-wal` e
   `orbitlink.sqlite3-shm`, mantendo os sufixos `-wal` e `-shm`.
5. Configure `ASTRYON_DATA_DIR` e, quando usado, `ASTRYON_SECRETS_KEY_FILE`
   para os caminhos preservados. Não inicie o agente apontando para um diretório
   vazio se quiser manter usuários, histórico e configurações.

O formato criptográfico dos segredos do Windows foi preservado. O navegador
passa a usar o cookie `astryon_session`: entre novamente após a atualização.
As preferências locais de interface serão recriadas com o novo prefixo.

## Linux com o instalador padrão

Pare e desabilite as unidades antigas:

```bash
sudo systemctl disable --now orbitlink-backup.timer orbitlink-agent.service orbitlink-web.service orbitlink.target
```

Prepare `/etc/astryon/astryon.env` a partir da configuração anterior e
`/var/lib/astryon` a partir dos dados anteriores, seguindo a seção acima.
Preserve `/etc/astryon/secrets.key` antes de executar o instalador.

Desabilite o site antigo do Nginx removendo seu link de
`/etc/nginx/sites-enabled/orbitlink`; mantenha uma cópia da configuração
para recuperar personalizações de HTTPS, domínio e Tailscale.

Execute no clone atualizado:

```bash
sudo bash deploy/linux/install.sh
sudo astryonctl health
sudo astryonctl status
```

O instalador configura o usuário de serviço, permissões, serviços e Nginx com
os novos nomes. Reaplique as personalizações de HTTPS e eventuais timers
adicionais de renovação de certificados. Verifique login, histórico, alertas e
backup antes de remover a instalação anterior.

## Instalação manual e desenvolvimento

Depois de parar os processos antigos e migrar o `.env` e os dados:

```bash
npm ci
apps/agent/.venv/bin/pip install --no-deps -e apps/agent
npm run build
```

Em unidades systemd personalizadas, atualize `ExecStart` para `astryon-agent`
(ou `python -m astryon_agent`), as variáveis `Environment=`, os arquivos
`EnvironmentFile=` e os caminhos efetivamente movidos. Renomeie as unidades e
atualize suas dependências; depois execute `sudo systemctl daemon-reload` e
habilite as novas unidades. O nome da pasta do clone pode permanecer o mesmo.

## Windows

Pare o aplicativo e a tarefa agendada antiga. Migre o `.env`, o diretório de
dados e o SQLite conforme descrito acima, inclusive instalações empacotadas
em `%LOCALAPPDATA%\ASTRYON`. Execute `scripts\install.ps1` e
`scripts\start.ps1`; recrie a tarefa com `scripts\install-task.ps1`, se usada.

## ESP32 e Home Assistant

Recompile e grave o firmware atualizado. O ponto de acesso de configuração
passa a se chamar `ASTRYON-Setup-XXXX`, e o armazenamento interno usa o novo
namespace `astryon`. Refaça a configuração do endereço do agente e o pareamento
no portal após atualizar o firmware.

No MQTT, os identificadores de descoberta e o tópico padrão passam a usar
`astryon`. Ajuste automações e remova as entradas antigas de descoberta
retidas no broker para evitar entidades duplicadas no Home Assistant.
