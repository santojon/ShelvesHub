@echo off
setlocal
echo === ShelvesHub - Windows Uninstaller ===
echo.

REM Per-user — no elevation needed.

set "URL=https://github.com/santojon/ShelvesHub/releases/latest/download/shelveshub-windows.zip"
set "SUMS=https://github.com/santojon/ShelvesHub/releases/latest/download/SHA256SUMS"
set "T=%TEMP%\shelveshub-uninstall"

REM The uninstaller runs from the download, so it is verified against SHA256SUMS.
powershell -ExecutionPolicy Bypass -NoProfile -Command ^
    "$ErrorActionPreference = 'Stop';" ^
    "$t = '%T%';" ^
    "if (Test-Path $t) { Remove-Item $t -Recurse -Force };" ^
    "New-Item -ItemType Directory $t | Out-Null;" ^
    "Write-Output '[i] Fetching the uninstaller...';" ^
    "Invoke-WebRequest '%URL%' -OutFile \"$t\pkg.zip\";" ^
    "try { Invoke-WebRequest '%SUMS%' -OutFile \"$t\SHA256SUMS\" } catch { Write-Output '[i] No SHA256SUMS published - skipping the checksum.' };" ^
    "if (Test-Path \"$t\SHA256SUMS\") {" ^
    "  $expected = Get-Content \"$t\SHA256SUMS\" | Where-Object { $_ -like '* shelveshub-windows.zip' } | ForEach-Object { ($_ -split ' +')[0] };" ^
    "  $actual = (Get-FileHash \"$t\pkg.zip\" -Algorithm SHA256).Hash.ToLower();" ^
    "  if ($expected -and ($expected.ToLower() -ne $actual)) { throw \"Checksum mismatch for shelveshub-windows.zip - aborting (expected $expected, got $actual).\" };" ^
    "  if ($expected) { Write-Output '[i] Checksum verified.' }" ^
    "};" ^
    "Expand-Archive \"$t\pkg.zip\" $t -Force;" ^
    "Write-Output '[i] Uninstalling...';" ^
    "Set-Location $t;" ^
    "& powershell -ExecutionPolicy Bypass -File \"$t\installer\uninstall.ps1\";" ^
    "Remove-Item $t -Recurse -Force;" ^
    "Write-Output '';" ^
    "Write-Output '[OK] Done.'"

echo.
pause
