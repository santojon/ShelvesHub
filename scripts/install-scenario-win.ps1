# Windows install / uninstall lifecycle validation, run natively on a windows
# runner (no Steam). Proves install.ps1 / uninstall.ps1 lay down and tear down the
# right files under a redirected per-user profile, apply the SHELVES_* options on a
# FIRST install, keep settings on a plain uninstall and remove them on -Purge,
# migrate an old Program Files install, and write install.log. The ScheduledTask
# cmdlets are STUBBED (a recording shim, like the Linux systemctl / macOS launchctl
# stubs) so no real task is registered and no daemon starts; LOCALAPPDATA / APPDATA
# / ProgramFiles are redirected to temp sandboxes.
$ErrorActionPreference = "Stop"
$ROOT = (Resolve-Path "$PSScriptRoot\..").Path
Set-Location $ROOT

$script:FAILS = 0
function Check($label, [bool]$ok) {
  if ($ok) { Write-Output "  [ok] $label" } else { Write-Output "  [X]  $label"; $script:FAILS++ }
}

# Run a packaged installer script in a child shell that FIRST defines no-op stubs
# for the ScheduledTask cmdlets (a simple function with no param block swallows any
# args), then cd's into the package dir (so install.ps1's `Test-Path shelveshub.exe`
# finds the local binary and skips the download) and runs the script. Register-
# ScheduledTask records to $env:SHTASK_LOG so we can assert it was attempted.
function Run-Pkg($scriptName, $argLine, $outFile) {
  # The child shell may write to stderr (benign). Under the script's Stop
  # preference PowerShell escalates native-command stderr to a terminating error,
  # so relax it to Continue for just this invocation (function-scoped).
  $ErrorActionPreference = 'Continue'
  $wrapper = Join-Path $env:TEMP ("wrap-" + [guid]::NewGuid() + ".ps1")
  @"
function New-ScheduledTaskAction {}
function New-ScheduledTaskTrigger {}
function New-ScheduledTaskSettingsSet {}
function New-ScheduledTaskPrincipal {}
function Register-ScheduledTask { 'Register-ScheduledTask' | Out-File -Append -LiteralPath `$env:SHTASK_LOG }
function Start-ScheduledTask {}
function Stop-ScheduledTask {}
function Unregister-ScheduledTask {}
Set-Location -LiteralPath '$PKG'
& '$PKG\installer\$scriptName' $argLine
"@ | Set-Content -LiteralPath $wrapper -Encoding utf8
  & powershell -NoProfile -ExecutionPolicy Bypass -File $wrapper *> $outFile
  Remove-Item -LiteralPath $wrapper -ErrorAction SilentlyContinue
}

Write-Output "== Windows install / uninstall lifecycle =="
cargo build --release --quiet
if ($LASTEXITCODE -ne 0) { Write-Error "build failed"; exit 1 }

# ── Assemble a release-style package (mirrors release.yml's dist layout) ──────
$PKG = Join-Path ([System.IO.Path]::GetTempPath()) ("shpkg-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force -Path "$PKG\installer","$PKG\bundle","$PKG\runtime" | Out-Null
Copy-Item target\release\shelveshub.exe "$PKG\" -Force
Copy-Item target\release\shelves-devtools.exe "$PKG\" -Force -ErrorAction SilentlyContinue
Copy-Item installer\Windows\* "$PKG\installer\" -Recurse -Force
Copy-Item shelveshub.config.json "$PKG\" -Force -ErrorAction SilentlyContinue
Copy-Item bundle\* "$PKG\bundle\" -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item runtime\* "$PKG\runtime\" -Recurse -Force -ErrorAction SilentlyContinue

# ── Redirect the per-user profile + Program Files to temp sandboxes ───────────
$SAND = Join-Path ([System.IO.Path]::GetTempPath()) ("shsand-" + [guid]::NewGuid())
$env:LOCALAPPDATA = Join-Path $SAND "Local"
$env:APPDATA      = Join-Path $SAND "Roaming"
$env:ProgramFiles = Join-Path $SAND "ProgramFiles"
$env:SHTASK_LOG   = Join-Path $SAND "schtask.log"
New-Item -ItemType Directory -Force -Path $env:LOCALAPPDATA,$env:APPDATA,$env:ProgramFiles | Out-Null
$installPath = Join-Path $env:LOCALAPPDATA "ShelvesHub"
$settingsDir = Join-Path $env:APPDATA "deck-shelves"
$prefsPath   = Join-Path $settingsDir "shelveshub.json"
$cfgPath     = Join-Path $installPath "shelveshub.config.json"

# ── [1] Install (fresh) with the SHELVES_* options exercised ──────────────────
Write-Output "[1] install.ps1 (fresh, with options)"
$env:SHELVES_FORCE_OWNER = "1"; $env:SHELVES_NATIVE_QAM = "0"; $env:SHELVES_DESKTOP_UI = "1"
$env:SHELVES_AUTO_UPDATE = "1"; $env:SHELVES_PLUGIN_PRERELEASE = "1"
Run-Pkg "install.ps1" "" "$env:TEMP\win-install.out"
Check "binary installed"            (Test-Path "$installPath\shelveshub.exe")
Check "config present"              (Test-Path $cfgPath)
Check "runtime copied"              (Test-Path "$installPath\runtime\shelves-host.js")
Check "install.log written"         (Test-Path "$installPath\install.log")
Check "task registration attempted" ((Test-Path $env:SHTASK_LOG) -and [bool](Select-String -Path $env:SHTASK_LOG -Pattern "Register-ScheduledTask" -Quiet))
$cfg = if (Test-Path $cfgPath) { Get-Content $cfgPath -Raw } else { "" }
Check "force_owner flipped on"      ($cfg -match '"force_owner":\s*true')
Check "native_qam flipped off"      ($cfg -match '"native_qam":\s*false')
Check "desktop_ui flipped on"       ($cfg -match '"desktop_ui":\s*true')
Check "prefs seeded"                (Test-Path $prefsPath)
Check "plugin_prerelease seeded"    ((Test-Path $prefsPath) -and ((Get-Content $prefsPath -Raw) -match '"plugin_prerelease":\s*true'))

# ── [2] Re-install says it kept the existing setup ────────────────────────────
Write-Output "[2] install.ps1 (re-install keeps setup)"
Run-Pkg "install.ps1" "" "$env:TEMP\win-reinstall.out"
Check "re-install reports kept setup" ([bool](Select-String -Path "$env:TEMP\win-reinstall.out" -Pattern "Existing setup kept" -Quiet))

# Seed shared settings to prove a plain uninstall preserves them.
"{}" | Out-File -FilePath (Join-Path $settingsDir "settings.json") -Encoding ascii

# ── [3] Uninstall (keep settings) ─────────────────────────────────────────────
Write-Output "[3] uninstall.ps1 (keep settings)"
Run-Pkg "uninstall.ps1" "" "$env:TEMP\win-uninstall.out"
Check "install dir removed"         (-not (Test-Path $installPath))
Check "shared settings PRESERVED"   (Test-Path (Join-Path $settingsDir "settings.json"))

# ── [3b] Reinstall, then uninstall -Purge → settings removed ──────────────────
Write-Output "[3b] uninstall.ps1 -Purge (remove settings)"
Run-Pkg "install.ps1" "" "$env:TEMP\win-reinstall2.out"
Run-Pkg "uninstall.ps1" "-Purge" "$env:TEMP\win-purge.out"
Check "install dir removed (purge)"     (-not (Test-Path $installPath))
Check "shared settings REMOVED (purge)" (-not (Test-Path $settingsDir))

# ── [4] Migration: an old Program Files install is removed + config carried ───
Write-Output "[4] migration from Program Files"
$oldInstall = Join-Path $env:ProgramFiles "ShelvesHub"
New-Item -ItemType Directory -Force -Path $oldInstall | Out-Null
'{"migrated":true}' | Out-File -FilePath (Join-Path $oldInstall "shelveshub.config.json") -Encoding ascii
Remove-Item -Recurse -Force $installPath -ErrorAction SilentlyContinue
Run-Pkg "install.ps1" "" "$env:TEMP\win-migrate.out"
Check "old Program Files install removed" (-not (Test-Path $oldInstall))
Check "old config carried over"           ((Test-Path $cfgPath) -and ((Get-Content $cfgPath -Raw) -match '"migrated":\s*true'))

Remove-Item -Recurse -Force $PKG,$SAND -ErrorAction SilentlyContinue
Write-Output ""
if ($script:FAILS -eq 0) { Write-Output "[OK] Windows install/uninstall lifecycle passed" }
else { Write-Output "[X] $($script:FAILS) check(s) failed"; exit $script:FAILS }
