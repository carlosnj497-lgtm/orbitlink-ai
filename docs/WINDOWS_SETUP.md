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
# -WithAI     (obsoleto: a IA via Groq usa o httpx, que já vem nas dependências)
```

O script cria `apps\agent\.venv`, instala as dependências npm, gera o `.env` com um `ASTRYON_API_TOKEN` aleatório (com ACL apenas do seu usuário) e faz o build de produção.

## 3. Diagnosticar

```powershell
powershell -ExecutionPolicy Bypass -File scripts\diagnose.ps1
powershell -ExecutionPolicy Bypass -File scripts\diagnose.ps1 -Out reports-out\diag   # .json/.txt sanitizados
```

O diagnóstico é somente leitura: não altera rota, firewall nem adaptador.

## 4. Iniciar e parar

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start.ps1     # agente (porta 8787) + painel (porta 3000), só em localhost
powershell -ExecutionPolicy Bypass -File scripts\start.ps1 -Dev
powershell -ExecutionPolicy Bypass -File scripts\stop.ps1
```

Logs ficam em `data\run\agent.log` (JSON estruturado, segredos redigidos) e `data\run\web.log`.

## 5. Primeiro acesso

Abra `http://localhost:3000`, crie o administrador local (senha com no mínimo 10 caracteres) e vá ao **Assistente de Instalação**, em "Executar diagnóstico".

## 6. Inicialização automática (opcional)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-task.ps1          # pede confirmação
powershell -ExecutionPolicy Bypass -File scripts\install-task.ps1 -Remove
```

Cria uma Tarefa Agendada **no logon do seu usuário**, com nível Limitado (sem elevação).

## Portas e firewall

| Porta | Escuta em | Uso |
|---|---|---|
| 3000 | só localhost | Painel |
| 8787 | só localhost | API do agente (token + sessão) |
| 8788 | todas as interfaces (só se `ASTRYON_ESP32_ENABLED=true`) | Ingestão HMAC do ESP32 |

Se usar o ESP32, libere **apenas** a porta 8788 e **apenas** para a rede privada:

```powershell
New-NetFirewallRule -DisplayName "ASTRYON ESP32 (LAN)" -Direction Inbound -Protocol TCP -LocalPort 8788 -Profile Private -Action Allow
```

Nunca encaminhe 8787, 8788 ou 9200 no roteador para a internet. Para acesso remoto, use uma VPN privada (ex.: Tailscale) e mantenha o painel atrás dela.

## Instalador `.exe` (sem Python nem Node)

O GitHub Actions monta um instalador comum de Windows (`ASTRYON-Setup-<versão>.exe`) numa máquina Windows, e
também a [versão portátil para pendrive](#versão-portátil-pendrive):

- **Gerar:** no GitHub, abra **Actions → Instalador Windows → Run workflow** e baixe o arquivo em "Artifacts".
  Ao criar uma tag `v*` (ex.: `v0.2.0`), o instalador também é anexado à release.
- **Instalar:** dois cliques, "Avançar" até o fim. Não precisa de administrador nem de Python/Node instalados.
  Como o instalador não é assinado, o Windows pode mostrar "O Windows protegeu o computador": clique em
  **Mais informações → Executar assim mesmo**.
- **Usar:** o ícone do ASTRYON fica ao lado do relógio (verde = no ar, vermelho = serviço fora do ar). O menu tem
  Abrir painel, Reiniciar serviços, Ver logs, Editar configurações e Iniciar com o Windows. O painel abre em
  `http://localhost:3000`.
- **Configurar:** "Editar configurações" abre `%LOCALAPPDATA%\ASTRYON\astryon.env` (Telegram, IA, clima...). Depois,
  "Reiniciar serviços".
- **Dados:** ficam em `%LOCALAPPDATA%\ASTRYON` (banco, backups, logs), separados do programa. Atualizar é rodar o
  instalador novo por cima; desinstalar pergunta se os dados devem ser apagados.
- **Limite:** o monitoramento só acontece com o computador ligado. Para 24 horas, use o servidor Linux.

O build é feito por `packaging/windows/build.ps1` (PyInstaller para o agente, Next.js standalone + Node portátil
conferido pelo SHA-256 oficial, iniciador com `pystray` e Inno Setup).


## Versão portátil (pendrive)

O mesmo workflow gera também `ASTRYON-Portatil-<versão>.zip`: o ASTRYON inteiro numa pasta, sem instalar nada.

- **Preparar:** extraia o `.zip` e copie a pasta `ASTRYON` para o pendrive (ex.: `E:\ASTRYON`).
- **Usar:** no computador ligado à rede da Starlink, abra `E:\ASTRYON\ASTRYON.exe`. O painel abre em
  `http://127.0.0.1:3000` e o ícone fica ao lado do relógio, como na versão instalada.
- **Tirar o pendrive:** ícone da bandeja → **Sair**. Espere o ícone sumir antes de remover, para não corromper o
  banco de dados.
- **Como funciona:** o arquivo `portable.txt` ao lado do `ASTRYON.exe` liga o modo portátil. Com ele:
  - tudo fica em `ASTRYON\dados\` no próprio pendrive: configuração, banco, logs e ligação com a conta. Nada vai
    para o `%LOCALAPPDATA%` do PC;
  - o caminho é recalculado a cada início, então a letra da unidade pode mudar de um PC para outro (`E:`, `F:`…);
  - a ligação com a conta na nuvem é protegida por uma chave guardada no pendrive, e não pelo DPAPI do Windows
    (que só abre no mesmo PC e usuário). Por isso continua valendo em qualquer computador;
  - para poupar o pendrive, a coleta grava com menos frequência (status a cada 30 s, histórico a cada 60 s) e
    guarda 2 dias de amostras de 1 s. O resumo por minuto, os eventos e o consumo diário não mudam. Para ajustar,
    edite `dados\astryon.env` (ex.: `ASTRYON_RETENTION_RAW_DAYS=7`);
  - a opção "Iniciar com o Windows" não aparece no menu.
- **Segurança:** quem tiver o pendrive tem acesso aos dados e à ligação com a conta. Se perder o pendrive, remova o
  acesso em **Conta → Agentes conectados** no painel na nuvem.
- **Limites:** só monitora enquanto o ASTRYON está aberto. Não rode a versão instalada e a portátil ao mesmo tempo,
  porque as duas usam as portas 3000 e 8787.
