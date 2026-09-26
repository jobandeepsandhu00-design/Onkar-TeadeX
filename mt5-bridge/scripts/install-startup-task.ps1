[CmdletBinding()]
param(
    [string]$TaskName = "OnkarTradeX MT5 Bridge"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$runScript = Join-Path $PSScriptRoot "run-bridge.ps1"
if (-not (Test-Path -LiteralPath $runScript -PathType Leaf)) {
    throw "Bridge launcher not found at $runScript."
}

$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$powerShellPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$escapedRunScript = $runScript.Replace('"', '""')
$actionArguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$escapedRunScript`""

$action = New-ScheduledTaskAction -Execute $powerShellPath -Argument $actionArguments
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
    -MultipleInstances IgnoreNew

$task = New-ScheduledTask `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description "Keeps the authenticated OnkarTradeX MetaTrader 5 Python bridge running in the MT5 user's Windows session."

Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
Write-Output "Installed scheduled task '$TaskName' for $identity. It will start at the next sign-in."
Write-Output "Keep the Windows VPS session signed in; disconnect RDP instead of signing out."
