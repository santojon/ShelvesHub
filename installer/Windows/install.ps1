# One-click installer for Windows — installs PER USER (no admin needed): the
# daemon must run as you so it can write the bundle/backend/config and self-update,
# and reach your Steam. Everything lives under %LOCALAPPDATA%.
# Usage (online): irm https://github.com/santojon/ShelvesHub/releases/latest/download/install-windows.ps1 | iex
# Usage (from extracted package): .\installer\install.ps1

$ErrorActionPreference = "Stop"
$repo        = "santojon/ShelvesHub"
$binary      = "shelveshub.exe"
$package     = "shelveshub-windows.zip"
$installPath = Join-Path $env:LOCALAPPDATA "ShelvesHub"

# Capture the whole run to a log next to the install so a failure is diagnosable
# even if the window closes. Start-Transcript keeps writing on a terminating error,
# so the log survives; the trap adds a clear failure line. Fail-soft.
$logFile = Join-Path $installPath "install.log"
try {
  New-Item -ItemType Directory -Force -Path $installPath | Out-Null
  Start-Transcript -Path $logFile -Append -ErrorAction SilentlyContinue | Out-Null
  Write-Output "[i] Full log: $logFile"
} catch {}
trap {
  Write-Warning "[!] Install failed: $($_.Exception.Message)  Full log: $logFile"
  try { Stop-Transcript | Out-Null } catch {}
  break
}

Write-Output "=== ShelvesHub — Windows Installer ==="

# ── Migrate any older Program Files (admin) install to the current per-user one ──
# Shared with the setup.exe via migrate.ps1 (single source of truth). Settings live
# in %APPDATA%\deck-shelves (separate), so this never loses data.
$userSettings = Join-Path $env:APPDATA "deck-shelves"
$migrate = Join-Path $PSScriptRoot "migrate.ps1"
if (Test-Path $migrate) { & $migrate -InstallPath $installPath }

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

  # Integrity: verify the download against the release's SHA256SUMS when present.
  $sums = $release.assets | Where-Object { $_.name -eq "SHA256SUMS" }
  if ($sums) {
    Invoke-WebRequest -Uri $sums.browser_download_url -OutFile "$tmpDir\SHA256SUMS" -UseBasicParsing
    $expected = (Get-Content "$tmpDir\SHA256SUMS" | Where-Object { $_ -match "\s\*?$([regex]::Escape($package))$" } | ForEach-Object { ($_ -split '\s+')[0] })
    $actual = (Get-FileHash "$tmpDir\$package" -Algorithm SHA256).Hash.ToLower()
    if ($expected -and ($expected.ToLower() -ne $actual)) {
      Write-Error "[!] Checksum mismatch for $package - aborting (expected $expected, got $actual)."
      exit 1
    }
    if ($expected) { Write-Output "[i] Checksum verified." }
  }

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
$configWasFresh = $false
if ((Test-Path "$extractedDir\shelveshub.config.json") -and -not (Test-Path "$installPath\shelveshub.config.json")) {
  Copy-Item "$extractedDir\shelveshub.config.json" $installPath
  $configWasFresh = $true
}

# ── Optional setup choices ─────────────────────────────────────────────────────
# Read from the environment and, when run interactively, ask. Applied only on a
# FIRST install; everything stays editable later in the ShelvesHub tab.
function Ask($val, $q, $default) {
  if ($val -match '^(1|y|yes|true|on)$') { return $true }
  if ($val -match '^(0|n|no|false|off)$') { return $false }
  if ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
    $hint = if ($default) { "[Y/n]" } else { "[y/N]" }
    $r = Read-Host "  $q $hint"
    if ([string]::IsNullOrWhiteSpace($r)) { return $default }
    return ($r -match '^[Yy]')
  }
  return $default
}
$cfgPath = Join-Path $installPath "shelveshub.config.json"
if ($configWasFresh) {
  Write-Output "-- Optional setup (Enter for the default) --"
  $force = Ask $env:SHELVES_FORCE_OWNER "Host Deck Shelves even if a plugin loader is present (cooperative)?" $false
  $nqam  = Ask $env:SHELVES_NATIVE_QAM  "Add ShelvesHub's own Quick Access tab?" $true
  $desk  = Ask $env:SHELVES_DESKTOP_UI  "Also inject into the plain desktop client (experimental)?" $false
  $c = Get-Content $cfgPath -Raw
  if ($force)     { $c = $c -replace '"force_owner": false', '"force_owner": true' }
  if (-not $nqam) { $c = $c -replace '"native_qam": true',   '"native_qam": false' }
  if ($desk)      { $c = $c -replace '"desktop_ui": false',  '"desktop_ui": true' }
  Set-Content -Path $cfgPath -Value $c -NoNewline
}
$prefsPath = Join-Path $userSettings "shelveshub.json"
# Re-install: options are set on the FIRST install and never silently reconfigured
# (an upgrade must not clobber your choices). Say so, so a re-run doesn't look idle.
if (-not $configWasFresh -and (Test-Path $prefsPath)) {
  Write-Output "[i] Existing setup kept — ShelvesHub is already configured on this machine."
  Write-Output "    Change any option anytime in the ShelvesHub tab (Quick Access Menu)."
}
if (-not (Test-Path $prefsPath)) {
  $auto = Ask $env:SHELVES_AUTO_UPDATE "Enable automatic updates?" $true
  if ($auto) {
    $ahub  = Ask $env:SHELVES_AUTO_UPDATE_HUB    "  Auto-update ShelvesHub itself?" $true
    $aplug = Ask $env:SHELVES_AUTO_UPDATE_PLUGIN "  Auto-update Deck Shelves?" $true
    $hpre  = Ask $env:SHELVES_HUB_PRERELEASE     "  Include ShelvesHub pre-releases?" $false
    $ppre  = Ask $env:SHELVES_PLUGIN_PRERELEASE  "  Include Deck Shelves pre-releases?" $false
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
# Optional data-backend payload: auto-detected by the service at <install>\backend.
if (Test-Path "$extractedDir\backend") {
  Copy-Item -Recurse -Path "$extractedDir\backend" -Destination $installPath -Force
}
# Boot-animation source cuts — read from <install>\assets\boot by the boot_movie toggle.
if (Test-Path "$extractedDir\assets") {
  Copy-Item -Recurse -Path "$extractedDir\assets" -Destination $installPath -Force
}

# Per-user task: runs as YOU at logon (interactive, no elevation) so it can write
# under %LOCALAPPDATA%, self-update, and reach your Steam. Registering a task for
# the current user needs no admin rights.
$action    = New-ScheduledTaskAction -Execute "$installPath\$binary"
$trigger   = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings  = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName "ShelvesHub" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
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

try { Stop-Transcript | Out-Null } catch {}
