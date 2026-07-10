# Windows toolchain setup for ShelvesHub.
#
# Installs the Rust toolchain (rustup), the Steam Deck build target, pnpm (via
# Corepack), and the project's JS dev deps. Idempotent; pass -Update to upgrade.
#
# Focused on the native dev loop (build / test / lint / run + the local debug
# harness). Cross-building for the Deck from Windows additionally needs zig
# (`winget install zig.zig`) + `cargo install cargo-zigbuild`.
param([switch]$Update)
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "== Rust toolchain (rustup) =="
if (-not (Get-Command rustup -ErrorAction SilentlyContinue)) {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget install --id Rustlang.Rustup -e --accept-source-agreements --accept-package-agreements
  } else {
    $init = Join-Path $env:TEMP "rustup-init.exe"
    Invoke-WebRequest -Uri "https://win.rustup.rs/x86_64" -OutFile $init
    & $init -y --default-toolchain stable --no-modify-path
  }
  $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
}

rustup default stable
if ($Update) { rustup update }
# Steam Deck is x86_64 Linux — added for cross-builds (harmless on Windows).
rustup target add x86_64-unknown-linux-gnu 2>$null
rustup component add clippy rustfmt 2>$null

Write-Host "== Node / pnpm =="
if (Get-Command corepack -ErrorAction SilentlyContinue) {
  corepack enable
  corepack prepare pnpm@latest --activate
} elseif (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Host "[i] Corepack/pnpm not found. Install Node 20+ (bundles Corepack) or pnpm, then re-run."
}

Write-Host "== Project JS dev dependencies =="
if (Get-Command pnpm -ErrorAction SilentlyContinue) { pnpm install }
else { Write-Host "[i] skipped 'pnpm install' (pnpm unavailable)" }

Write-Host "== .env =="
if (-not (Test-Path .env)) {
  Copy-Item .env.example .env
  Write-Host "[+] created .env from .env.example - edit DECK_HOST / DECK_USER / DECK_SSH_KEY"
} else {
  Write-Host "[=] .env already present"
}

Write-Host ""
Write-Host "[OK] Windows toolchain ready. Next: pnpm build  |  pnpm test  |  pnpm run debug:local"
