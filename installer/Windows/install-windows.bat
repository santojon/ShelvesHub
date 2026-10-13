@echo off
setlocal
echo === ShelvesHub - Windows Installer ===
echo.

REM Per-user install — do NOT elevate: the daemon must run as you (writes under
REM %%LOCALAPPDATA%%, self-updates, reaches your Steam).

set "URL=https://github.com/santojon/ShelvesHub/releases/latest/download/shelveshub-windows.zip"
set "SUMS=https://github.com/santojon/ShelvesHub/releases/latest/download/SHA256SUMS"
set "T=%TEMP%\shelveshub-install"

REM The installer inside the package skips its own download (and with it the
REM checksum step), so the download is verified here against SHA256SUMS.
powershell -ExecutionPolicy Bypass -NoProfile -Command ^
    "$ErrorActionPreference = 'Stop';" ^
    "$t = '%T%';" ^
    "if (Test-Path $t) { Remove-Item $t -Recurse -Force };" ^
    "New-Item -ItemType Directory $t | Out-Null;" ^
    "Write-Output '[i] Downloading ShelvesHub...';" ^
    "Invoke-WebRequest '%URL%' -OutFile \"$t\pkg.zip\";" ^
    "try { Invoke-WebRequest '%SUMS%' -OutFile \"$t\SHA256SUMS\" } catch { Write-Output '[i] No SHA256SUMS published - skipping the checksum.' };" ^
    "if (Test-Path \"$t\SHA256SUMS\") {" ^
    "  $expected = Get-Content \"$t\SHA256SUMS\" | Where-Object { $_ -like '* shelveshub-windows.zip' } | ForEach-Object { ($_ -split ' +')[0] };" ^
    "  $actual = (Get-FileHash \"$t\pkg.zip\" -Algorithm SHA256).Hash.ToLower();" ^
    "  if ($expected -and ($expected.ToLower() -ne $actual)) { throw \"Checksum mismatch for shelveshub-windows.zip - aborting (expected $expected, got $actual).\" };" ^
    "  if ($expected) { Write-Output '[i] Checksum verified.' }" ^
    "};" ^
    "Write-Output '[i] Extracting...';" ^
    "Expand-Archive \"$t\pkg.zip\" $t -Force;" ^
    "Write-Output '[i] Installing...';" ^
    "Set-Location $t;" ^
    "& powershell -ExecutionPolicy Bypass -File \"$t\installer\install.ps1\";" ^
    "Remove-Item $t -Recurse -Force;" ^
    "Write-Output '';" ^
    "Write-Output '[OK] Done.'"

echo.
pause
