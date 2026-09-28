@echo off
setlocal
echo === ShelvesHub - Windows Installer ===
echo.

REM Per-user install — do NOT elevate: the daemon must run as you (writes under
REM %%LOCALAPPDATA%%, self-updates, reaches your Steam).

set "URL=https://github.com/santojon/ShelvesHub/releases/latest/download/shelveshub-windows.zip"
set "T=%TEMP%\shelveshub-install"

powershell -ExecutionPolicy Bypass -NoProfile -Command ^
    "$ErrorActionPreference = 'Stop';" ^
    "$t = '%T%';" ^
    "if (Test-Path $t) { Remove-Item $t -Recurse -Force };" ^
    "New-Item -ItemType Directory $t | Out-Null;" ^
    "Write-Output '[i] Downloading ShelvesHub...';" ^
    "Invoke-WebRequest '%URL%' -OutFile \"$t\pkg.zip\";" ^
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
