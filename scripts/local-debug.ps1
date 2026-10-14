# Local end-to-end debug harness (Windows / PowerShell).
#
# Launches a Chromium-family browser with remote debugging, runs the loader
# against it, injects the example Deck Shelves bundle, and verifies the result —
# without a Steam Deck. Mirror of scripts/local-debug.sh.
#
# Usage:
#   pwsh scripts/local-debug.ps1                 # headless
#   $env:HEADLESS=0; pwsh scripts/local-debug.ps1  # show the browser window
#
# The daemon gets its own RPC port ($env:SHELVES_RPC_PORT, default 60124; an installed
# service keeps 60123) and runs on a copy of the bundle with its own settings, hub store
# (updates and settings sync off), token file and an empty backend directory in a temp dir,
# with the boot movie and auto-recovery off, so it leaves this machine's Steam alone.

$ErrorActionPreference = "Stop"

$Root    = Split-Path -Parent $PSScriptRoot
$Port    = if ($env:SHELVES_CEF_PORT) { $env:SHELVES_CEF_PORT } else { "9222" }
$RpcPort = if ($env:SHELVES_RPC_PORT) { $env:SHELVES_RPC_PORT } else { "60124" }
$Harness = Join-Path $Root "examples\harness\index.html"
$Bundle  = if ($env:SHELVES_BUNDLE_PATH) { $env:SHELVES_BUNDLE_PATH } else { Join-Path $Root "examples\bundle\shelves-example.js" }
$Headless = if ($env:HEADLESS) { $env:HEADLESS } else { "1" }
$TargetFilter = if ($env:SHELVES_TARGET) { $env:SHELVES_TARGET } else { "harness" }

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) { throw "cargo (Rust) is required" }

function Find-Browser {
  if ($env:BROWSER) { return $env:BROWSER }
  $candidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe"
  )
  foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
  throw "No Chromium-family browser found. Set `$env:BROWSER to a browser path."
}

$BrowserBin = Find-Browser
Write-Host "[i] Browser : $BrowserBin"
Write-Host "[i] Port    : $Port"
Write-Host "[i] RPC port: $RpcPort"
Write-Host "[i] Bundle  : $Bundle"

Write-Host "[i] Building loader + shelves-devtools..."
cargo build --quiet
$Devtools = Join-Path $Root "target\debug\shelves-devtools.exe"
$Loader   = Join-Path $Root "target\debug\shelveshub.exe"

$Profile = Join-Path ([System.IO.Path]::GetTempPath()) ("shelves-" + [guid]::NewGuid())
$Work    = Join-Path ([System.IO.Path]::GetTempPath()) ("shelves-work-" + [guid]::NewGuid())
$BrowserArgs = @(
  "--remote-debugging-port=$Port",
  "--user-data-dir=$Profile",
  "--no-first-run", "--no-default-browser-check",
  "file:///$($Harness -replace '\\','/')"
)
if ($Headless -eq "1") { $BrowserArgs = @("--headless=new") + $BrowserArgs }

$BrowserProc = $null
$LoaderProc  = $null
try {
  Write-Host "[i] Launching browser..."
  $BrowserProc = Start-Process -FilePath $BrowserBin -ArgumentList $BrowserArgs -PassThru

  Write-Host -NoNewline "[i] Waiting for DevTools endpoint"
  $up = $false
  for ($i = 0; $i -lt 40; $i++) {
    try { Invoke-WebRequest "http://127.0.0.1:$Port/json/version" -UseBasicParsing -TimeoutSec 2 | Out-Null; $up = $true; break } catch { }
    Write-Host -NoNewline "."; Start-Sleep -Milliseconds 250
  }
  Write-Host ""
  if (-not $up) { throw "DevTools never came up" }

  New-Item -ItemType Directory -Force -Path (Join-Path $Work "settings"), (Join-Path $Work "backend") | Out-Null
  Copy-Item -LiteralPath $Bundle -Destination (Join-Path $Work "bundle.js") -Force
  # ASCII, not utf8: Windows PowerShell 5.1 writes a BOM the daemon would not parse.
  Set-Content -LiteralPath (Join-Path $Work "hub.json") -Value '{ "auto_update": false, "config_sync": false }' -Encoding ascii

  Write-Host "[i] Starting loader (CEF=127.0.0.1:$Port)..."
  $env:SHELVES_CEF_PORT = $Port
  $env:SHELVES_RPC_HOST = "127.0.0.1"
  $env:SHELVES_RPC_PORT = $RpcPort
  $env:SHELVES_RPC_TOKEN_FILE = Join-Path $Work "rpc-token"
  $env:SHELVES_BUNDLE_PATH = Join-Path $Work "bundle.js"
  $env:SHELVES_HUB_CONFIG = Join-Path $Work "hub.json"
  $env:SHELVES_SETTINGS_DIR = Join-Path $Work "settings"
  $env:SHELVES_BACKEND_DIR = Join-Path $Work "backend"
  $env:SHELVES_CONFIG_FILE = Join-Path $Work "shelveshub.config.json"
  $env:SHELVES_BOOT_MOVIE = "0"
  $env:SHELVES_BOOT_MOVIE_FILE = Join-Path $Work "no-movie.webm"
  $env:SHELVES_RECOVER_CMD = "off"
  $env:SHELVES_TARGET = $TargetFilter
  $env:SHELVES_INTERVAL_SECS = "5"
  $env:SHELVES_DESKTOP_UI = "1"
  $LoaderProc = Start-Process -FilePath $Loader -PassThru

  Write-Host -NoNewline "[i] Waiting for injection"
  for ($i = 0; $i -lt 20; $i++) {
    $p = & $Devtools --port $Port --target $TargetFilter probe 2>$null
    if ($p -eq "injected: true") { break }
    Write-Host -NoNewline "."; Start-Sleep -Milliseconds 500
  }
  Write-Host ""
  # Without Steam's UI the runtime's scan never signals ready, so the bundle boots when
  # its gate gives up (about 12 s).
  Write-Host -NoNewline "[i] Waiting for the bundle to boot"
  for ($i = 0; $i -lt 40; $i++) {
    $d = & $Devtools --port $Port --target $TargetFilter eval "!!window.__SHELVES_DEMO__" 2>$null
    if ($d -eq "true") { break }
    Write-Host -NoNewline "."; Start-Sleep -Milliseconds 500
  }
  Write-Host ""

  Write-Host "`n===== verification ====="
  Write-Host "--- probe ---";                       & $Devtools --port $Port --target $TargetFilter probe
  Write-Host "--- window.__SHELVES_DEMO__ ---";      & $Devtools --port $Port --target $TargetFilter eval "window.__SHELVES_DEMO__"
  Write-Host "--- QAM panel registered? ---";        & $Devtools --port $Port --target $TargetFilter eval "!!(window.__SHELVES_HOST__ && window.__SHELVES_HOST__.qam && window.__SHELVES_HOST__.qam._specs['deck-shelves'])"
  Write-Host "--- rpc via host ---";                 & $Devtools --port $Port --target $TargetFilter eval "Promise.all([__SHELVES_HOST__.rpc.call('ping'),__SHELVES_HOST__.rpc.call('getVersion'),__SHELVES_HOST__.rpc.call('isInjected')])"
  Write-Host "--- console (3s) ---";                 & $Devtools --port $Port --target $TargetFilter console --duration 3
  Write-Host "========================"
  Write-Host "[OK] Done. (set `$env:HEADLESS=0 to watch the rendered shelves)"
}
finally {
  if ($LoaderProc)  { Stop-Process -Id $LoaderProc.Id  -ErrorAction SilentlyContinue }
  if ($BrowserProc) { Stop-Process -Id $BrowserProc.Id -ErrorAction SilentlyContinue }
  if (Test-Path $Profile) { Remove-Item -Recurse -Force $Profile -ErrorAction SilentlyContinue }
  if (Test-Path $Work) { Remove-Item -Recurse -Force $Work -ErrorAction SilentlyContinue }
}
