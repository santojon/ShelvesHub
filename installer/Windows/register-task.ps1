# Register + start the ShelvesHub scheduled task for files already installed at
# -InstallPath. Used by the NSIS installer (which lays the files down itself);
# the download-based install.ps1 handles the copy + calls the same task settings.
param([Parameter(Mandatory = $true)][string]$InstallPath)
$ErrorActionPreference = "Stop"

$binary = Join-Path $InstallPath "shelveshub.exe"
if (-not (Test-Path $binary)) { Write-Error "shelveshub.exe not found at $InstallPath"; exit 1 }

$action   = New-ScheduledTaskAction -Execute $binary
$trigger  = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "ShelvesHub" -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName "ShelvesHub"

Write-Output "[OK] ShelvesHub scheduled task registered and started ($InstallPath)."
