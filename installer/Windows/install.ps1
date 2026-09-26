# One-click installer for Windows
# Usage (online): irm https://github.com/santojon/ShelvesHub/releases/latest/download/install-windows.ps1 | iex
# Usage (from extracted package): .\installer\install.ps1
#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"
$repo        = "santojon/ShelvesHub"
$binary      = "shelveshub.exe"
$package     = "shelveshub-windows.zip"
$installPath = "C:\Program Files\ShelvesHub"

Write-Output "=== ShelvesHub — Windows Installer ==="

if (Test-Path $binary) {
  Write-Output "[i] Binary found locally, skipping download."
  $extractedDir = "."
} else {
  Write-Output "[i] Fetching latest release from GitHub..."
  $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest" -UseBasicParsing
  $asset   = $release.assets | Where-Object { $_.name -eq $package }

  if (-not $asset) {
    Write-Error "[!] Could not find $package in the latest release."
    exit 1
  }

  $tmpDir = Join-Path $env:TEMP ([System.Guid]::NewGuid().ToString())
  New-Item -ItemType Directory -Path $tmpDir | Out-Null

  Write-Output "[i] Downloading $package..."
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile "$tmpDir\$package" -UseBasicParsing
  Expand-Archive -Path "$tmpDir\$package" -DestinationPath $tmpDir -Force
  $extractedDir = $tmpDir
}

New-Item -Path $installPath -ItemType Directory -Force | Out-Null
Copy-Item -Path "$extractedDir\$binary" -Destination "$installPath\$binary" -Force

if (Test-Path "$extractedDir\bundle") {
  Copy-Item -Recurse -Path "$extractedDir\bundle" -Destination $installPath -Force
}
if (Test-Path "$extractedDir\runtime") {
  Copy-Item -Recurse -Path "$extractedDir\runtime" -Destination $installPath -Force
}
# Config file: install it, but never overwrite one the user has already edited.
if ((Test-Path "$extractedDir\shelveshub.config.json") -and -not (Test-Path "$installPath\shelveshub.config.json")) {
  Copy-Item "$extractedDir\shelveshub.config.json" $installPath
}
# Optional data-backend payload: auto-detected by the service at <install>\backend.
if (Test-Path "$extractedDir\backend") {
  Copy-Item -Recurse -Path "$extractedDir\backend" -Destination $installPath -Force
}
# Boot-animation source cuts — read from <install>\assets\boot by the boot_movie toggle.
if (Test-Path "$extractedDir\assets") {
  Copy-Item -Recurse -Path "$extractedDir\assets" -Destination $installPath -Force
}

$action   = New-ScheduledTaskAction -Execute "$installPath\$binary"
$trigger  = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "ShelvesHub" -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
# Reinstall-safe (upgrade in place): stop a running task instance and kill any
# lingering daemon so the freshly-copied binary is the ONLY one running — else two
# daemons fight over the RPC port after an upgrade and the new binary never takes.
Stop-ScheduledTask -TaskName "ShelvesHub" -ErrorAction SilentlyContinue
Get-Process -Name "shelveshub" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500
Start-ScheduledTask -TaskName "ShelvesHub"

if (Test-Path $tmpDir -ErrorAction SilentlyContinue) { Remove-Item -Recurse -Force $tmpDir }

# ShelvesHub reaches Steam over its CEF debug port, which Steam only opens when
# this flag file exists in its install dir — otherwise a fresh install just logs
# "connection refused" and nothing appears. Create it (needs a Steam restart).
$cefCreated = $false
try {
  $steamPath = (Get-ItemProperty -Path "HKCU:\Software\Valve\Steam" -Name SteamPath -ErrorAction SilentlyContinue).SteamPath
  if ($steamPath -and (Test-Path $steamPath)) {
    New-Item -ItemType File -Path (Join-Path $steamPath ".cef-enable-remote-debugging") -Force -ErrorAction SilentlyContinue | Out-Null
    $cefCreated = $true
  }
} catch {}

Write-Output ""
Write-Output "[OK] ShelvesHub installed and running."
Write-Output "     Install path : $installPath"
Write-Output "     Service      : Get-ScheduledTask -TaskName ShelvesHub"
Write-Output ""
Write-Output "-- What to do next ------------------------------------------"
if ($cefCreated) {
  Write-Output "  0. RESTART STEAM once so it opens the debug port ShelvesHub"
  Write-Output "     needs. Without this restart, nothing appears."
}
Write-Output "  Open Steam Big Picture, then the Quick Access Menu, and find"
Write-Output "  the ShelvesHub tab. If a plugin loader is already hosting Deck"
Write-Output "  Shelves, ShelvesHub coexists (adds only its tab) and won't"
Write-Output "  replace it."
