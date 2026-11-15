<#
.SYNOPSIS
  Monta o instalador ASTRYON-Setup.exe (Windows 10/11, x64). Usado pelo GitHub Actions; também roda localmente.
.DESCRIPTION
  1. Agente Python -> astryon-agent.exe (PyInstaller, pasta única).
  2. Painel Next.js em modo standalone + node.exe portátil (versão e SHA-256 fixados aqui; o hash foi conferido
     contra o SHASUMS256.txt.asc assinado pela equipe do Node ao atualizar a versão).
  3. Iniciador da bandeja -> ASTRYON.exe.
  4. Inno Setup -> dist\ASTRYON-Setup-<versão>.exe.
  5. update.json (versão + endereço do latest.json + chave pública Ed25519 de release) para a atualização
     automática. Sem a chave pública, o ASTRYON instalado não se atualiza sozinho.
  6. Versão portátil (pendrive) -> dist\ASTRYON-Portatil-<versão>.zip (mesmos arquivos + portable.txt).
  Requisitos: Python 3.12, Node 22 (para o build), Inno Setup 6 (iscc no PATH).
#>
[CmdletBinding()]
param([string]$Version = "0.1.0",
      # Para atualizar o Node: troque os dois valores e confira o hash com
      #   gpg --verify SHASUMS256.txt.asc (chaves em https://github.com/nodejs/release-keys).
      [string]$NodeVersion = "22.23.5",
      [string]$NodeSha256 = "4a191082e9706866830379d577d2cc8a50c776fcd9436a8d061b063ed0d9a0e3",
      # Nuvem padrão do instalador (públicos: o endereço e a chave anon do Supabase). Vazios = sem nuvem pronta.
      [string]$SupabaseUrl = $env:ASTRYON_CLOUD_SUPABASE_URL, [string]$SupabaseAnonKey = $env:ASTRYON_CLOUD_SUPABASE_ANON_KEY,
      # Atualização automática: endereço do latest.json no repositório público de releases. Vazio = desligada.
      [string]$UpdateManifest = $env:ASTRYON_UPDATE_MANIFEST,
      # Chave PÚBLICA de release (base64, 32 bytes; scripts/release-signing.py keygen). Vazia = sem atualização.
      [string]$UpdatePubKey = $env:ASTRYON_UPDATE_PUBKEY)
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
& $Py -m pip install --quiet --require-hashes -r (Join-Path $Here "requirements-build.lock")

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
  --hidden-import cryptography.hazmat.primitives.asymmetric.ed25519 `
  --distpath $Stage --workpath (Join-Path $Here "build\launcher") --specpath (Join-Path $Here "build") `
  (Join-Path $Here "launcher.py")
Copy-Item (Join-Path $Here "astryon.ico") $Stage
if ($SupabaseUrl -and $SupabaseAnonKey) {
  @{ ASTRYON_SUPABASE_URL = $SupabaseUrl; ASTRYON_SUPABASE_ANON_KEY = $SupabaseAnonKey } | ConvertTo-Json |
    Out-File -Encoding utf8 (Join-Path $Stage "cloud.json")
  Write-Host "    nuvem padrão: $SupabaseUrl"
}

if ($UpdateManifest -and -not $UpdatePubKey) {
  Write-Host "::warning::ASTRYON_UPDATE_PUBKEY vazio: o instalador sai SEM atualização automática."
}
@{ version = $Version; manifest = $UpdateManifest; pubkey = $UpdatePubKey } | ConvertTo-Json |
  Out-File -Encoding utf8 (Join-Path $Stage "update.json")
if ($UpdateManifest -and $UpdatePubKey) { Write-Host "    atualização automática: $UpdateManifest" }

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

Write-Host "==> Node.js $NodeVersion portátil"
$zip = "node-v$NodeVersion-win-x64.zip"
$base = "https://nodejs.org/dist/v$NodeVersion"
Invoke-WebRequest "$base/$zip" -OutFile (Join-Path $Here $zip)
$expected = $NodeSha256.ToLower()
$actual = (Get-FileHash (Join-Path $Here $zip) -Algorithm SHA256).Hash.ToLower()
if (-not $expected -or $expected -ne $actual) { throw "SHA-256 do Node não confere (esperado $expected, obtido $actual)" }
Expand-Archive (Join-Path $Here $zip) (Join-Path $Here "node") -Force
Copy-Item (Join-Path $Here "node\node-v$NodeVersion-win-x64\node.exe") (Join-Path $Web "node.exe")

Write-Host "==> Teste rápido do agente empacotado"
& (Join-Path $Stage "agent\astryon-agent.exe") --help | Out-Null
if ($LASTEXITCODE -ne 0) { throw "astryon-agent.exe não iniciou" }

Write-Host "==> Instalador (Inno Setup)"
iscc /DAppVersion=$Version /DStageDir=$Stage /DOutDir=$Dist (Join-Path $Here "astryon.iss")

Write-Host "==> Versão portátil (pendrive)"
$PortDir = Join-Path $Here "portable\ASTRYON"
Remove-Item -Recurse -Force (Join-Path $Here "portable") -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $PortDir | Out-Null
Copy-Item -Recurse (Join-Path $Stage "*") $PortDir
# O marcador faz o ASTRYON.exe guardar tudo na pasta dados\ ao lado dele, em vez de %LOCALAPPDATA%.
Copy-Item (Join-Path $Here "portable.txt") (Join-Path $PortDir "portable.txt")
Compress-Archive -Path $PortDir -DestinationPath (Join-Path $Dist "ASTRYON-Portatil-$Version.zip") -CompressionLevel Optimal
Get-ChildItem $Dist
