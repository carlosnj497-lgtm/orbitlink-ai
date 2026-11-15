<#
.SYNOPSIS
  Diagnóstico somente leitura: rede local, alcance da antena/roteador, chamadas gRPC e matriz de capacidades.
.EXAMPLE
  scripts\diagnose.ps1
  scripts\diagnose.ps1 -Out reports-out\diag     # grava .json e .txt sanitizados (IPs da LAN mascarados)
  scripts\diagnose.ps1 -SaveFixture apps\agent\tests\fixtures\minha_antena.json   # respostas reais anonimizadas
#>
[CmdletBinding()]
param(
  [string]$Out,
  [string]$SaveFixture,
  [switch]$Json,
  [switch]$NoRouter
)
$Root = Split-Path -Parent $PSScriptRoot
$vpy = Join-Path $Root "apps\agent\.venv\Scripts\python.exe"
if (-not (Test-Path $vpy)) { Write-Host "Execute scripts\install.ps1 primeiro." -ForegroundColor Red; exit 1 }
$argsList = @("-m", "astryon_agent", "diagnose")
if ($Out) { $argsList += @("--out", $Out) }
if ($SaveFixture) { $argsList += @("--save-fixture", $SaveFixture) }
if ($Json) { $argsList += "--json" }
if ($NoRouter) { $argsList += "--no-router" }
Push-Location (Join-Path $Root "apps\agent")
try {
  & $vpy @argsList
  $code = $LASTEXITCODE
} finally { Pop-Location }
if ($code -eq 0) { Write-Host "`nAntena acessível." -ForegroundColor Green }
else { Write-Host "`nAntena não acessível ou com limitações — veja a orientação acima." -ForegroundColor Yellow }
exit $code
