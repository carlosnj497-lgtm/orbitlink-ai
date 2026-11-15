<#
.SYNOPSIS
  Inicia o agente ASTRYON (127.0.0.1:8787) e o painel (127.0.0.1:3000) em segundo plano.
.PARAMETER Dev
  Usa `next dev` em vez do build de produção.
#>
[CmdletBinding()]
param([switch]$Dev)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Run = Join-Path $Root "data\run"
New-Item -ItemType Directory -Force $Run | Out-Null
$vpy = Join-Path $Root "apps\agent\.venv\Scripts\python.exe"
if (-not (Test-Path $vpy)) { Write-Host "Execute scripts\install.ps1 primeiro." -ForegroundColor Red; exit 1 }

function Running($name) {
  $pidFile = Join-Path $Run "$name.pid"
  if (Test-Path $pidFile) {
    $p = Get-Process -Id (Get-Content $pidFile) -ErrorAction SilentlyContinue
    if ($p) { return $true }
  }
  return $false
}

if (Running "agent") { Write-Host "Agente já está em execução." }
else {
  $agent = Start-Process -FilePath $vpy -ArgumentList "-m", "astryon_agent", "serve" -WorkingDirectory (Join-Path $Root "apps\agent") `
    -RedirectStandardOutput (Join-Path $Run "agent.out.log") -RedirectStandardError (Join-Path $Run "agent.log") -WindowStyle Hidden -PassThru
  $agent.Id | Set-Content (Join-Path $Run "agent.pid")
  Write-Host "Agente iniciado (PID $($agent.Id)). Log: data\run\agent.log"
}

if (Running "web") { Write-Host "Painel já está em execução." }
else {
  $cmd = if ($Dev) { "dev" } else { "start" }
  $web = Start-Process -FilePath "npm.cmd" -ArgumentList "run", $cmd, "-w", "apps/web" -WorkingDirectory $Root `
    -RedirectStandardOutput (Join-Path $Run "web.log") -RedirectStandardError (Join-Path $Run "web.err.log") -WindowStyle Hidden -PassThru
  $web.Id | Set-Content (Join-Path $Run "web.pid")
  Write-Host "Painel iniciado (PID $($web.Id)). Log: data\run\web.log"
}

Write-Host "Aguardando o agente responder..."
for ($i = 0; $i -lt 30; $i++) {
  try { $h = Invoke-RestMethod -Uri "http://127.0.0.1:8787/v1/health" -TimeoutSec 2; if ($h.status -eq "ok") { break } } catch { Start-Sleep -Milliseconds 700 }
}
Write-Host "Abra: http://127.0.0.1:3000" -ForegroundColor Green
