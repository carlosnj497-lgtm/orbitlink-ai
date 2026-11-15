<#
.SYNOPSIS
  Monta o instalador ASTRYON-Setup.exe (Windows 10/11, x64). Usado pelo GitHub Actions; também roda localmente.
.DESCRIPTION
  1. Agente Python -> astryon-agent.exe (PyInstaller, pasta única).
  2. Painel Next.js em modo standalone + node.exe portátil (versão fixa, conferida pelo SHA-256 oficial).
  3. Iniciador da bandeja -> ASTRYON.exe.
  4. Inno Setup -> dist\ASTRYON-Setup-<versão>.exe.
  Requisitos: Python 3.12, Node 22 (para o build), Inno Setup 6 (iscc no PATH).
#>
[CmdletBinding()]
param([string]$Version = "0.1.0", [string]$NodeVersion = "",
      # Nuvem padrão do instalador (públicos: o endereço e a chave anon do Supabase). Vazios = sem nuvem pronta.
      [string]$SupabaseUrl = $env:ASTRYON_CLOUD_SUPABASE_URL, [string]$SupabaseAnonKey = $env:ASTRYON_CLOUD_SUPABASE_ANON_KEY)
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$Here = $PSScriptRoot
$Stage = Join-Path $Here "stage"
$Dist = Join-Path $Here "dist"
Remove-Item -Recurse -Force $Stage, $Dist -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $Stage, $Dist | Out-Null

Write-Host "==> Ambiente de build (Python)"
python -m venv (Join-Path $Here ".venv-build")
$Py = Join-Path $Here ".venv-build\Scripts\python.exe"
& $Py -m pip install --quiet --upgrade pip
& $Py -m pip install --quiet --require-hashes -r (Join-Path $Root "apps\agent\requirements.lock")
& $Py -m pip install --quiet --no-deps (Join-Path $Root "apps\agent")   # instalação normal: o PyInstaller não enxerga o modo editável
& $Py -m pip install --quiet -r (Join-Path $Here "requirements-build.txt")

Write-Host "==> Ícone"
& $Py -c "from PIL import Image; Image.open(r'$Root\apps\web\public\icons\icon-512.png').save(r'$Here\astryon.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])"

Write-Host "==> Agente (PyInstaller)"
& $Py -m PyInstaller --noconfirm --clean --onedir --name astryon-agent `
  --collect-submodules astryon_agent --collect-data astryon_agent `
  --collect-submodules uvicorn --collect-all grpc --collect-all grpc_reflection --collect-submodules google.protobuf `
  --collect-data reportlab --collect-submodules reportlab.graphics.barcode --collect-all edge_tts --collect-data certifi `
  --distpath (Join-Path $Stage "_pyi") --workpath (Join-Path $Here "build\agent") --specpath (Join-Path $Here "build") `
  (Join-Path $Here "agent_entry.py")
Move-Item (Join-Path $Stage "_pyi\astryon-agent") (Join-Path $Stage "agent")

Write-Host "==> Iniciador da bandeja"
& $Py -m PyInstaller --noconfirm --clean --onefile --windowed --name ASTRYON --icon (Join-Path $Here "astryon.ico") `
  --distpath $Stage --workpath (Join-Path $Here "build\launcher") --specpath (Join-Path $Here "build") `
  (Join-Path $Here "launcher.py")
Copy-Item (Join-Path $Here "astryon.ico") $Stage
if ($SupabaseUrl -and $SupabaseAnonKey) {
  @{ ASTRYON_SUPABASE_URL = $SupabaseUrl; ASTRYON_SUPABASE_ANON_KEY = $SupabaseAnonKey } | ConvertTo-Json |
    Out-File -Encoding utf8 (Join-Path $Stage "cloud.json")
  Write-Host "    nuvem padrão: $SupabaseUrl"
}

Write-Host "==> Painel (Next.js standalone)"
Push-Location $Root
npm ci --no-audit --no-fund
$env:ASTRYON_WEB_STANDALONE = "1"
npm run build -w apps/web
Remove-Item Env:ASTRYON_WEB_STANDALONE
Pop-Location
$Web = Join-Path $Stage "web"
Copy-Item -Recurse (Join-Path $Root "apps\web\.next\standalone") $Web
Copy-Item -Recurse (Join-Path $Root "apps\web\.next\static") (Join-Path $Web "apps\web\.next\static")
Copy-Item -Recurse (Join-Path $Root "apps\web\public") (Join-Path $Web "apps\web\public")

if (-not $NodeVersion) {
  # Node 22 LTS mais recente do índice oficial (a integridade é conferida logo abaixo pelo SHASUMS256 oficial)
  $NodeVersion = ((Invoke-RestMethod "https://nodejs.org/dist/index.json") | Where-Object { $_.version -like "v22.*" } |
    Select-Object -First 1).version.TrimStart("v")
}
Write-Host "==> Node.js $NodeVersion portátil"
$zip = "node-v$NodeVersion-win-x64.zip"
$base = "https://nodejs.org/dist/v$NodeVersion"
Invoke-WebRequest "$base/$zip" -OutFile (Join-Path $Here $zip)
$sums = (Invoke-WebRequest "$base/SHASUMS256.txt").Content
$expected = ($sums -split "`n" | Where-Object { $_ -match " $([regex]::Escape($zip))$" }) -replace "\s.*", ""
$actual = (Get-FileHash (Join-Path $Here $zip) -Algorithm SHA256).Hash.ToLower()
if (-not $expected -or $expected -ne $actual) { throw "SHA-256 do Node não confere (esperado $expected, obtido $actual)" }
Expand-Archive (Join-Path $Here $zip) (Join-Path $Here "node") -Force
Copy-Item (Join-Path $Here "node\node-v$NodeVersion-win-x64\node.exe") (Join-Path $Web "node.exe")

Write-Host "==> Teste rápido do agente empacotado"
& (Join-Path $Stage "agent\astryon-agent.exe") --help | Out-Null
if ($LASTEXITCODE -ne 0) { throw "astryon-agent.exe não iniciou" }

Write-Host "==> Instalador (Inno Setup)"
iscc /DAppVersion=$Version /DStageDir=$Stage /DOutDir=$Dist (Join-Path $Here "astryon.iss")
Get-ChildItem $Dist
