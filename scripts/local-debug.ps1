# Local end-to-end debug harness (Windows / PowerShell).
#
# Launches a Chromium-family browser with remote debugging, runs the loader
# against it, injects the example Deck Shelves bundle, and verifies the result —
# without a Steam Deck. Mirror of scripts/local-debug.sh.
#
# Usage:
#   pwsh scripts/local-debug.ps1                 # headless
#   $env:HEADLESS=0; pwsh scripts/local-debug.ps1  # show the browser window

$ErrorActionPreference = "Stop"

$Root    = Split-Path -Parent $PSScriptRoot
$Port    = if ($env:SHELVES_CEF_PORT) { $env:SHELVES_CEF_PORT } else { "9222" }
$RpcAddr = if ($env:SHELVES_RPC_ADDR) { $env:SHELVES_RPC_ADDR } else { "127.0.0.1:60123" }
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
Write-Host "[i] Bundle  : $Bundle"

Write-Host "[i] Building loader + shelves-devtools..."
cargo build --quiet
$Devtools = Join-Path $Root "target\debug\shelves-devtools.exe"
$Loader   = Join-Path $Root "target\debug\shelveshub.exe"

$Profile = Join-Path ([System.IO.Path]::GetTempPath()) ("shelves-" + [guid]::NewGuid())
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

  Write-Host "[i] Starting loader (CEF=127.0.0.1:$Port)..."
  $env:SHELVES_CEF_PORT = $Port
  $env:SHELVES_RPC_ADDR = $RpcAddr
  $env:SHELVES_BUNDLE_PATH = $Bundle
  $env:SHELVES_TARGET = $TargetFilter
  $env:SHELVES_INTERVAL_SECS = "5"
  $LoaderProc = Start-Process -FilePath $Loader -PassThru

  Write-Host -NoNewline "[i] Waiting for injection"
  for ($i = 0; $i -lt 20; $i++) {
    $p = & $Devtools --port $Port --target $TargetFilter probe 2>$null
    if ($p -eq "injected: true") { break }
    Write-Host -NoNewline "."; Start-Sleep -Milliseconds 500
  }
  Write-Host ""

  Write-Host "`n===== verification ====="
  Write-Host "--- probe ---";                       & $Devtools --port $Port --target $TargetFilter probe
  Write-Host "--- window.__SHELVES_DEMO__ ---";      & $Devtools --port $Port --target $TargetFilter eval "window.__SHELVES_DEMO__"
  Write-Host "--- QAM panel registered? ---";        & $Devtools --port $Port --target $TargetFilter eval "!!(window.__SHELVES_HOST__ && window.__SHELVES_HOST__.qam && window.__SHELVES_HOST__.qam._panels['deck-shelves'])"
  Write-Host "--- rpc via host ---";                 & $Devtools --port $Port --target $TargetFilter eval "Promise.all([__SHELVES_HOST__.rpc.call('ping'),__SHELVES_HOST__.rpc.call('getVersion'),__SHELVES_HOST__.rpc.call('isInjected')])"
  Write-Host "--- console (3s) ---";                 & $Devtools --port $Port --target $TargetFilter console --duration 3
  Write-Host "========================"
  Write-Host "[OK] Done. (set `$env:HEADLESS=0 to watch the rendered shelves)"
}
finally {
  if ($LoaderProc)  { Stop-Process -Id $LoaderProc.Id  -ErrorAction SilentlyContinue }
  if ($BrowserProc) { Stop-Process -Id $BrowserProc.Id -ErrorAction SilentlyContinue }
  if (Test-Path $Profile) { Remove-Item -Recurse -Force $Profile -ErrorAction SilentlyContinue }
}
