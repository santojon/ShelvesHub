@echo off
setlocal
echo === ShelvesHub - Windows Installer ===
echo.

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Requesting administrator access...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

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
