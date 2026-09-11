@echo off
setlocal
echo === ShelvesHub - Windows Uninstaller ===
echo.

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Requesting administrator access...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

set "URL=https://github.com/santojon/ShelvesHub/releases/latest/download/shelveshub-windows.zip"
set "T=%TEMP%\shelveshub-uninstall"

powershell -ExecutionPolicy Bypass -NoProfile -Command ^
    "$ErrorActionPreference = 'Stop';" ^
    "$t = '%T%';" ^
    "if (Test-Path $t) { Remove-Item $t -Recurse -Force };" ^
    "New-Item -ItemType Directory $t | Out-Null;" ^
    "Write-Output '[i] Fetching the uninstaller...';" ^
    "Invoke-WebRequest '%URL%' -OutFile \"$t\pkg.zip\";" ^
    "Expand-Archive \"$t\pkg.zip\" $t -Force;" ^
    "Write-Output '[i] Uninstalling...';" ^
    "Set-Location $t;" ^
    "& powershell -ExecutionPolicy Bypass -File \"$t\installer\uninstall.ps1\";" ^
    "Remove-Item $t -Recurse -Force;" ^
    "Write-Output '';" ^
    "Write-Output '[OK] Done.'"

echo.
pause
