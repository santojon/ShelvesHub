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

# Per-user task: runs as YOU at logon (interactive, no elevation) so the daemon
# can write under the install dir, self-update, and reach your Steam.
$action    = New-ScheduledTaskAction -Execute $binary
$trigger   = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings  = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName "ShelvesHub" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName "ShelvesHub"
Write-Output "[OK] ShelvesHub scheduled task registered and started ($InstallPath)."

# Opt-in tray companion: a per-user logon task, only when requested AND bundled.
if ($Tray -match '^(1|y|yes|true|on)$') {
  $trayExe = Join-Path $InstallPath "shelveshub-tray.exe"
  if (Test-Path $trayExe) {
    $ta = New-ScheduledTaskAction -Execute $trayExe
    $tt = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $tp = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName "ShelvesHubTray" -Action $ta -Trigger $tt -Principal $tp -Force | Out-Null
    Start-ScheduledTask -TaskName "ShelvesHubTray"
    Write-Output "[OK] ShelvesHub tray companion registered and started."
  } else {
    Write-Output "[i] Tray companion not bundled in this package - skipping."
  }
}
