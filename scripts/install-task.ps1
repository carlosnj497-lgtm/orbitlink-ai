<#
.SYNOPSIS
  (Opcional) Registra uma Tarefa Agendada do Windows para iniciar o OrbitLink ao fazer logon.
.DESCRIPTION
  Roda como o usuário atual, sem privilégios elevados. Remova com:  scripts\install-task.ps1 -Remove
#>
[CmdletBinding()]
param([switch]$Remove)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$TaskName = "OrbitLink AI"
if ($Remove) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Tarefa removida."
  exit 0
}
$answer = Read-Host "Registrar inicialização automática do OrbitLink ao fazer logon deste usuário? (s/N)"
if ($answer -notin @("s", "S", "sim")) { Write-Host "Cancelado."; exit 0 }
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Root\scripts\start.ps1`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 0)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "Tarefa '$TaskName' registrada (nível Limitado, usuário $env:USERNAME)."
