# Migrate an older Program Files (admin) ShelvesHub install to the current
# per-user layout, without data loss. Shared by install.ps1 (script/zip) and the
# NSIS setup.exe, so BOTH Windows paths migrate the same way. Idempotent and
# fail-soft: a removal that needs admin only warns; your Deck Shelves settings
# live in %APPDATA%\deck-shelves (separate), so this never loses data.
param([Parameter(Mandatory = $true)][string]$InstallPath)
$ErrorActionPreference = "SilentlyContinue"

$oldInstall   = Join-Path $env:ProgramFiles "ShelvesHub"
$userSettings = Join-Path $env:APPDATA "deck-shelves"
if (-not (Test-Path $oldInstall)) { return }

Write-Output "[i] Migrating an old Program Files (admin) install to per-user..."
New-Item -Path $InstallPath -ItemType Directory -Force | Out-Null

# Carry over the old config only when the new install doesn't have one yet.
$oldCfg = Join-Path $oldInstall "shelveshub.config.json"
if ((Test-Path $oldCfg) -and -not (Test-Path (Join-Path $InstallPath "shelveshub.config.json"))) {
  Copy-Item $oldCfg $InstallPath -Force
}

# Rescue settings the old system task wrote under the service profile, only when
# your per-user settings don't exist yet (never overwrite what you have).
$sysSettings = "C:\Windows\System32\config\systemprofile\AppData\Roaming\deck-shelves"
if ((Test-Path $sysSettings) -and -not (Test-Path $userSettings)) {
  Copy-Item $sysSettings $userSettings -Recurse -Force
  if (Test-Path $userSettings) { Write-Output "[i] Rescued your Deck Shelves settings from the old system install." }
}

Remove-Item -Recurse -Force $oldInstall
Remove-Item "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ShelvesHub" -Recurse -Force
if (Test-Path $oldInstall) {
  Write-Warning "[!] Could not remove $oldInstall (needs admin). Delete it manually or run this installer once elevated; your data and the new per-user install are unaffected."
}
