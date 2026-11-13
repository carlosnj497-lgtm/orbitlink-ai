# Instalação no Windows 10/11

Sem Docker, sem PostgreSQL local e sem privilégios de administrador.

## 1. Pré-requisitos

- **Python 3.11+** (python.org, com "Add python.exe to PATH" marcado)
- **Node.js 20+ LTS** (nodejs.org)
- Opcional: **VS Code + PlatformIO** para o ESP32, ou use o `tools-venv` descrito em [ESP32_SETUP.md](ESP32_SETUP.md)

```powershell
python --version   # 3.11 ou superior
node --version     # v20 ou superior
```

## 2. Instalar

```powershell
cd C:\Users\<voce>\Desktop\projetos\starlink
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
# -SkipBuild  pula o build do painel
# -WithAI     (obsoleto: o SDK da Anthropic já vem em apps/agent/requirements-dev.lock)
```

O script cria `apps\agent\.venv`, instala as dependências npm, gera o `.env` com um `ORBITLINK_API_TOKEN` aleatório (com ACL apenas do seu usuário) e faz o build de produção.

## 3. Diagnosticar

```powershell
powershell -ExecutionPolicy Bypass -File scripts\diagnose.ps1
powershell -ExecutionPolicy Bypass -File scripts\diagnose.ps1 -Out reports-out\diag   # .json/.txt sanitizados
```

O diagnóstico é somente leitura: não altera rota, firewall nem adaptador.

## 4. Iniciar e parar

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start.ps1     # agente 127.0.0.1:8787 + painel 127.0.0.1:3000
powershell -ExecutionPolicy Bypass -File scripts\start.ps1 -Dev
powershell -ExecutionPolicy Bypass -File scripts\stop.ps1
```

Logs ficam em `data\run\agent.log` (JSON estruturado, segredos redigidos) e `data\run\web.log`.

## 5. Primeiro acesso

Abra <http://127.0.0.1:3000>, crie o administrador local (senha com no mínimo 10 caracteres) e vá ao **Assistente de Instalação**, em "Executar diagnóstico".

## 6. Inicialização automática (opcional)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-task.ps1          # pede confirmação
powershell -ExecutionPolicy Bypass -File scripts\install-task.ps1 -Remove
```

Cria uma Tarefa Agendada **no logon do seu usuário**, com nível Limitado (sem elevação).

## Portas e firewall

| Porta | Escuta em | Uso |
|---|---|---|
| 3000 | 127.0.0.1 | Painel |
| 8787 | 127.0.0.1 | API do agente (token + sessão) |
| 8788 | 0.0.0.0 (só se `ORBITLINK_ESP32_ENABLED=true`) | Ingestão HMAC do ESP32 |

Se usar o ESP32, libere **apenas** a porta 8788 e **apenas** para a rede privada:

```powershell
New-NetFirewallRule -DisplayName "OrbitLink ESP32 (LAN)" -Direction Inbound -Protocol TCP -LocalPort 8788 -Profile Private -Action Allow
```

Nunca encaminhe 8787, 8788 ou 9200 no roteador para a internet. Para acesso remoto, use uma VPN privada (ex.: Tailscale) e mantenha o painel atrás dela.
