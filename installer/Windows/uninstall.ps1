# Uninstaller for the Windows .zip package path (the NSIS .exe has its own,
# reachable from Add/Remove Programs).
# Usage (from extracted package): .\installer\uninstall.ps1 [-Purge]
#Requires -RunAsAdministrator
param([switch]$Purge)
$ErrorActionPreference = "Stop"

$installPath  = "C:\Program Files\ShelvesHub"
$settingsPath = Join-Path $env:APPDATA "deck-shelves"   # shared Deck Shelves settings

Write-Output "=== ShelvesHub - Windows Uninstaller ==="

# Stop + remove the scheduled task, then any running daemon.
Stop-ScheduledTask -TaskName "ShelvesHub" -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName "ShelvesHub" -Confirm:$false -ErrorAction SilentlyContinue
Get-Process shelveshub -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

if (Test-Path $installPath) { Remove-Item -Recurse -Force $installPath }

if ($Purge) {
  if (Test-Path $settingsPath) { Remove-Item -Recurse -Force $settingsPath; Write-Output "[i] Removed shared Deck Shelves settings." }
} else {
  Write-Output "[i] Shared Deck Shelves settings kept (run with -Purge to remove them)."
}

Write-Output "[OK] ShelvesHub removed."
