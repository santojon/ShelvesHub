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

$action   = New-ScheduledTaskAction -Execute "$installPath\$binary"
$trigger  = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "ShelvesHub" -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName "ShelvesHub"

if (Test-Path $tmpDir -ErrorAction SilentlyContinue) { Remove-Item -Recurse -Force $tmpDir }

Write-Output ""
Write-Output "[OK] ShelvesHub installed and running."
Write-Output "     Install path : $installPath"
Write-Output "     Service      : Get-ScheduledTask -TaskName ShelvesHub"
