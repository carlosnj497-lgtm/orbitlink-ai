<#
.SYNOPSIS
  Para o agente e o painel iniciados pelo start.ps1 (inclui processos filhos).
#>
$Root = Split-Path -Parent $PSScriptRoot
$Run = Join-Path $Root "data\run"
foreach ($name in "web", "agent") {
  $pidFile = Join-Path $Run "$name.pid"
  if (Test-Path $pidFile) {
    $procId = Get-Content $pidFile
    if (Get-Process -Id $procId -ErrorAction SilentlyContinue) {
      & taskkill /PID $procId /T /F | Out-Null
      Write-Host "$name parado (PID $procId)."
    } else {
      Write-Host "$name não estava em execução."
    }
    Remove-Item $pidFile -Force
  } else {
    Write-Host "${name}: sem PID registrado."
  }
}
