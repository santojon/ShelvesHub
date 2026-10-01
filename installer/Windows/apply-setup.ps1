# Applies the setup.exe's "Setup options" page choices, mirroring install.ps1.
# All switches arrive as "0"/"1" strings from NSIS. Config flips run only on a
# fresh config; prefs are seeded once. Everything stays editable in the tab.
param(
  [string]$InstallPath,
  [string]$ConfigWasFresh = "0",
  [string]$Force = "0",
  [string]$NativeQam = "1",
  [string]$DesktopUi = "0",
  [string]$AutoUpdate = "1",
  [string]$AutoUpdateHub = "1",
  [string]$AutoUpdatePlugin = "1",
  [string]$HubPrerelease = "0",
  [string]$PluginPrerelease = "0"
)
$ErrorActionPreference = "SilentlyContinue"
function B($v) { return ($v -match '^(1|y|yes|true|on)$') }

# Config flips — only when the installer wrote a fresh config (never clobber edits).
$cfgPath = Join-Path $InstallPath "shelveshub.config.json"
if ((B $ConfigWasFresh) -and (Test-Path $cfgPath)) {
  $c = Get-Content $cfgPath -Raw
  if (B $Force)            { $c = $c -replace '"force_owner": false', '"force_owner": true' }
  if (-not (B $NativeQam)) { $c = $c -replace '"native_qam": true',   '"native_qam": false' }
  if (B $DesktopUi)        { $c = $c -replace '"desktop_ui": false',  '"desktop_ui": true' }
  Set-Content -Path $cfgPath -Value $c -NoNewline
}

# Prefs — seed once (first install only). Match install.ps1: when auto-update is
# off, the per-target flags fall back to their defaults.
$userSettings = Join-Path $env:APPDATA "deck-shelves"
$prefsPath = Join-Path $userSettings "shelveshub.json"
if (-not (Test-Path $prefsPath)) {
  $auto = B $AutoUpdate
  if ($auto) {
    $ahub = B $AutoUpdateHub; $aplug = B $AutoUpdatePlugin
    $hpre = B $HubPrerelease; $ppre = B $PluginPrerelease
  } else { $ahub = $true; $aplug = $true; $hpre = $false; $ppre = $false }
  New-Item -ItemType Directory -Path $userSettings -Force | Out-Null
  $prefs = [ordered]@{
    auto_update        = $auto
    auto_update_hub    = $ahub
    auto_update_plugin = $aplug
    hub_prerelease     = $hpre
    plugin_prerelease  = $ppre
  }
  Set-Content -Path $prefsPath -Value ($prefs | ConvertTo-Json)
}
