# Register + start the ShelvesHub scheduled task for files already installed at
# -InstallPath. Used by the NSIS installer (which lays the files down itself);
# the download-based install.ps1 handles the copy + calls the same task settings.
param(
  [Parameter(Mandatory = $true)][string]$InstallPath,
  # When "1"/"true", also register the opt-in tray companion's logon task (only
  # if its binary was laid down). Default off — the NSIS checkbox passes this.
  [string]$Tray = "0"
)
$ErrorActionPreference = "Stop"

$binary = Join-Path $InstallPath "shelveshub.exe"
if (-not (Test-Path $binary)) { Write-Error "shelveshub.exe not found at $InstallPath"; exit 1 }

# Task settings shared by the daemon and the tray: both are long-running, so lift
# the Task Scheduler defaults that refuse to start a task on battery, stop it when
# the machine unplugs, or end it after 72 hours (PT0S = no time limit).
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$settings.ExecutionTimeLimit = "PT0S"

# Per-user task: runs as YOU at logon (interactive, no elevation) so the daemon
# can write under the install dir, self-update, and reach your Steam.
$action    = New-ScheduledTaskAction -Execute $binary
$trigger   = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName "ShelvesHub" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
# Upgrade in place (mirrors install.ps1): stop the running instance and any
# lingering daemon so the freshly laid-down binary is the ONLY one running.
Stop-ScheduledTask -TaskName "ShelvesHub" -ErrorAction SilentlyContinue
Get-Process -Name "shelveshub" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500
Start-ScheduledTask -TaskName "ShelvesHub"
Write-Output "[OK] ShelvesHub scheduled task registered and started ($InstallPath)."

# Opt-in tray companion: a per-user logon task when requested AND bundled. A task
# an earlier install registered counts as requested: the setup stops the running
# tray before laying the files down, so an upgrade has to start it again.
if ($Tray -match '^(1|y|yes|true|on)$' -or (Get-ScheduledTask -TaskName "ShelvesHubTray" -ErrorAction SilentlyContinue)) {
  $trayExe = Join-Path $InstallPath "shelveshub-tray.exe"
  if (Test-Path $trayExe) {
    $ta = New-ScheduledTaskAction -Execute $trayExe
    $tt = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $tp = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName "ShelvesHubTray" -Action $ta -Trigger $tt -Settings $settings -Principal $tp -Force | Out-Null
    Stop-ScheduledTask -TaskName "ShelvesHubTray" -ErrorAction SilentlyContinue
    Get-Process -Name "shelveshub-tray" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 300
    Start-ScheduledTask -TaskName "ShelvesHubTray"
    Write-Output "[OK] ShelvesHub tray companion registered and started."
  } else {
    Write-Output "[i] Tray companion not bundled in this package - skipping."
  }
}
