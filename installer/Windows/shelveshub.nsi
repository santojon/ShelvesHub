; ShelvesHub Windows installer (NSIS / Modern UI 2). Built in CI on the windows
; runner (choco install nsis). Expects, in the build dir next to this script:
;   payload\  (shelveshub.exe, shelves-devtools.exe, runtime\, bundle\, register-task.ps1)
;   icon.ico
; Produces shelveshub-setup.exe — a clickable installer carrying the app icon.

Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"

!define APPNAME "ShelvesHub"

Name "${APPNAME}"
OutFile "shelveshub-setup.exe"
RequestExecutionLevel admin
InstallDir "$PROGRAMFILES64\${APPNAME}"
ShowInstDetails show
ShowUnInstDetails show

!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"
  File "payload\shelveshub.exe"
  File "payload\shelves-devtools.exe"
  File /r "payload\runtime"
  File /r "payload\bundle"
  File "payload\register-task.ps1"

  DetailPrint "Registering the ShelvesHub background service..."
  nsExec::ExecToLog 'powershell -ExecutionPolicy Bypass -NoProfile -File "$INSTDIR\register-task.ps1" -InstallPath "$INSTDIR"'
  Pop $0
  ${If} $0 != 0
    DetailPrint "Warning: service registration returned $0 (see log)."
  ${EndIf}

  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "DisplayName" "${APPNAME}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "DisplayIcon" "$INSTDIR\shelveshub.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "Publisher" "${APPNAME}"
SectionEnd

Section "Uninstall"
  nsExec::ExecToLog 'schtasks /end /tn "ShelvesHub"'
  nsExec::ExecToLog 'schtasks /delete /tn "ShelvesHub" /f'
  Delete "$INSTDIR\shelveshub.exe"
  Delete "$INSTDIR\shelves-devtools.exe"
  Delete "$INSTDIR\register-task.ps1"
  RMDir /r "$INSTDIR\runtime"
  RMDir /r "$INSTDIR\bundle"
  RMDir /r "$INSTDIR\backend"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}"
SectionEnd
