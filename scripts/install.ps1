<#
.SYNOPSIS
  Instala o OrbitLink AI no Windows 10/11 (sem Docker, sem privilégios de administrador).
.DESCRIPTION
  1. Verifica Python 3.11+ e Node.js 20+.
  2. Cria o ambiente virtual do agente e instala dependências.
  3. Instala dependências do painel (npm workspaces) e gera o build de produção.
  4. Cria o .env a partir do .env.example com um token de serviço aleatório (se ainda não existir).
  Não altera rede, firewall nem serviços do Windows.
#>
[CmdletBinding()]
param(
  [switch]$SkipBuild,
  [switch]$WithAI
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "ERRO: $msg" -ForegroundColor Red; exit 1 }

Step "Verificando Python"
$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) { Fail "Python não encontrado. Instale Python 3.11+ (python.org) marcando 'Add to PATH'." }
$pyver = & python -c "import sys; print('%d.%d' % sys.version_info[:2])"
if ([version]$pyver -lt [version]"3.11") { Fail "Python $pyver encontrado; é necessário 3.11 ou superior." }
Write-Host "Python $pyver OK"

Step "Verificando Node.js"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail "Node.js não encontrado. Instale a versão LTS (nodejs.org)." }
$nodever = (& node -v).TrimStart("v")
if ([version]$nodever -lt [version]"20.0") { Fail "Node $nodever encontrado; é necessário 20 ou superior." }
Write-Host "Node $nodever OK"

Step "Criando ambiente virtual do agente"
$venv = Join-Path $Root "apps\agent\.venv"
if (-not (Test-Path $venv)) { & python -m venv $venv }
$vpy = Join-Path $venv "Scripts\python.exe"
& $vpy -m pip install --upgrade pip --quiet
# Versões travadas e verificadas por hash (inclui o SDK da Anthropic, usado só se houver chave configurada)
& $vpy -m pip install --quiet --require-hashes -r "apps\agent\requirements-dev.lock"
if ($LASTEXITCODE -ne 0) { Fail "Falha ao instalar dependências Python." }
& $vpy -m pip install --quiet --no-deps -e "apps\agent"
if ($LASTEXITCODE -ne 0) { Fail "Falha ao instalar o agente." }

Step "Instalando dependências do painel"
& npm install --no-fund --no-audit
if ($LASTEXITCODE -ne 0) { Fail "Falha no npm install." }

Step "Configurando .env"
$envFile = Join-Path $Root ".env"
if (-not (Test-Path $envFile)) {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $token = [Convert]::ToBase64String($bytes).Replace("+", "-").Replace("/", "_").TrimEnd("=")
  $lines = (Get-Content (Join-Path $Root ".env.example") -Encoding UTF8) -replace "^ORBITLINK_API_TOKEN=.*$", "ORBITLINK_API_TOKEN=$token"
  # UTF-8 sem BOM (dotenv do Node e do Python leem melhor)
  [System.IO.File]::WriteAllLines($envFile, $lines, (New-Object System.Text.UTF8Encoding($false)))
  # Restringe a leitura do .env ao usuário atual
  & icacls $envFile /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
  Write-Host ".env criado com token de serviço aleatório (acesso restrito ao seu usuário)."
} else {
  Write-Host ".env já existe — mantido."
}

if (-not $SkipBuild) {
  Step "Gerando build de produção do painel"
  & npm run build
  if ($LASTEXITCODE -ne 0) { Fail "Falha no build do painel." }
}

Step "Pronto"
Write-Host "Próximos passos:"
Write-Host "  1. scripts\diagnose.ps1   — testa rede e antena (somente leitura)"
Write-Host "  2. scripts\start.ps1      — inicia agente (127.0.0.1:8787) e painel (http://127.0.0.1:3000)"
Write-Host "  3. Abra http://127.0.0.1:3000 e crie o usuário administrador local."
