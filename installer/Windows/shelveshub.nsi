; ShelvesHub Windows installer (NSIS / Modern UI 2). Built in CI on the windows
; runner (choco install nsis). Expects, in the build dir next to this script:
;   payload\  (shelveshub.exe, shelves-devtools.exe, runtime\, bundle\, assets\,
;              shelveshub.config.json, register-task.ps1, apply-setup.ps1, migrate.ps1)
;   icon.ico
; Produces shelveshub-setup.exe — a clickable installer carrying the app icon.

Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"

!define APPNAME "ShelvesHub"

; ── Setup-options page state (checkbox handles + 0/1 results) ──────────────────
Var Dialog
Var CbForce
Var CbNqam
Var CbDesk
Var CbAuto
Var CbAhub
Var CbAplug
Var CbHpre
Var CbPpre
Var CbTray
Var SForce
Var SNqam
Var SDesk
Var SAuto
Var SAhub
Var SAplug
Var SHpre
Var SPpre
Var STray
Var ConfigWasFresh

Name "${APPNAME}"
OutFile "shelveshub-setup.exe"
; Per-user install (no admin): the daemon must run as the user to write its
; bundle/backend/config, self-update, and reach the user's Steam.
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\${APPNAME}"
ShowInstDetails show
ShowUnInstDetails show

!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"

!insertmacro MUI_PAGE_WELCOME
Page custom OptionsPageCreate OptionsPageLeave
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

; ── Setup options page ────────────────────────────────────────────────────────
; Checkboxes for the same choices the script/zip installer prompts for. All stay
; editable later in the ShelvesHub tab; defaults match install.ps1.
Function OptionsPageCreate
  !insertmacro MUI_HEADER_TEXT "Setup options" "Choose how ShelvesHub runs. You can change any of these later in the ShelvesHub tab."
  nsDialogs::Create 1018
  Pop $Dialog
  ${If} $Dialog == error
    Abort
  ${EndIf}

  ${NSD_CreateCheckbox} 0 0u 100% 11u "Host Deck Shelves even if a plugin loader is present (cooperative)"
  Pop $CbForce
  ${NSD_CreateCheckbox} 0 14u 100% 11u "Add ShelvesHub's own Quick Access tab"
  Pop $CbNqam
  ${NSD_Check} $CbNqam
  ${NSD_CreateCheckbox} 0 28u 100% 11u "Also inject into the plain desktop client (experimental)"
  Pop $CbDesk

  ${NSD_CreateCheckbox} 0 48u 100% 11u "Enable automatic updates"
  Pop $CbAuto
  ${NSD_Check} $CbAuto
  ${NSD_CreateCheckbox} 14u 62u 100% 11u "Auto-update ShelvesHub itself"
  Pop $CbAhub
  ${NSD_Check} $CbAhub
  ${NSD_CreateCheckbox} 14u 76u 100% 11u "Auto-update Deck Shelves"
  Pop $CbAplug
  ${NSD_Check} $CbAplug
  ${NSD_CreateCheckbox} 14u 90u 100% 11u "Include ShelvesHub pre-releases"
  Pop $CbHpre
  ${NSD_CreateCheckbox} 14u 104u 100% 11u "Include Deck Shelves pre-releases"
  Pop $CbPpre

  ${NSD_CreateCheckbox} 0 124u 100% 11u "Install the tray companion (system-tray icon) - optional"
  Pop $CbTray

  nsDialogs::Show
FunctionEnd

Function OptionsPageLeave
  ${NSD_GetState} $CbForce $SForce
  ${NSD_GetState} $CbNqam $SNqam
  ${NSD_GetState} $CbDesk $SDesk
  ${NSD_GetState} $CbAuto $SAuto
  ${NSD_GetState} $CbAhub $SAhub
  ${NSD_GetState} $CbAplug $SAplug
  ${NSD_GetState} $CbHpre $SHpre
  ${NSD_GetState} $CbPpre $SPpre
  ${NSD_GetState} $CbTray $STray
FunctionEnd

; ── Write the install-details list to a file ──────────────────────────────────
; Reads the on-screen details view (the same text ShowInstDetails prints) and
; writes it to a log file, so a failed/odd GUI install is diagnosable afterwards —
; parity with the shell/script installers' install.log. Unicode-safe (StrAlloc + &t).
!define SH_LVM_GETITEMCOUNT 0x1004
!define SH_LVM_GETITEMTEXTW 0x1073

Function DumpLog
  Exch $5 ; target file path
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $6
  FindWindow $0 "#32770" "" $HWNDPARENT
  GetDlgItem $0 $0 1016
  StrCmp $0 0 exit
  FileOpen $5 $5 "w"
  StrCmp $5 "" exit
    SendMessage $0 ${SH_LVM_GETITEMCOUNT} 0 0 $6
    System::StrAlloc ${NSIS_MAX_STRLEN}
    Pop $3
    StrCpy $2 0
    System::Call "*(i, i, i, i, i, i, i, i, i) i (0, 0, 0, 0, 0, r3, ${NSIS_MAX_STRLEN}) .r1"
    loop: StrCmp $2 $6 done
      System::Call "User32::SendMessage(i, i, i, i) i ($0, ${SH_LVM_GETITEMTEXTW}, $2, r1)"
      System::Call "*$3(&t${NSIS_MAX_STRLEN} .r4)"
      FileWrite $5 "$4$\r$\n"
      IntOp $2 $2 + 1
      Goto loop
    done:
      FileClose $5
      System::Free $1
      System::Free $3
  exit:
    Pop $6
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Pop $0
    Exch $5
FunctionEnd

; Capture the log even when the install aborts/fails.
Function .onInstFailed
  Push "$INSTDIR\install.log"
  Call DumpLog
FunctionEnd

Section "Install"
  SetOutPath "$INSTDIR"

  ; Migrate an old Program Files/admin install to per-user FIRST, so a carried-over
  ; config is in place before the config check below and an admin-era task of the
  ; same name is gone before register-task.ps1 registers the per-user one.
  File "payload\migrate.ps1"
  nsExec::ExecToLog 'powershell -ExecutionPolicy Bypass -NoProfile -File "$INSTDIR\migrate.ps1" -InstallPath "$INSTDIR"'
  Pop $0

  ; Upgrade over a running daemon: a running image can be renamed but not
  ; overwritten, so move it aside the way self-update does (the daemon deletes the
  ; .old copy on its next start); register-task.ps1 restarts onto the new file.
  ${If} ${FileExists} "$INSTDIR\shelveshub.exe"
    Delete "$INSTDIR\shelveshub.old"
    Rename "$INSTDIR\shelveshub.exe" "$INSTDIR\shelveshub.old"
  ${EndIf}
  File "payload\shelveshub.exe"
  File "payload\shelves-devtools.exe"
  File /r "payload\runtime"
  File /r "payload\bundle"
  ; Boot-animation source cuts, read from <install>\assets\boot by the boot_movie toggle.
  File /r "payload\assets"
  File "payload\register-task.ps1"
  ; Optional tray companion binary — /nonfatal so the setup still builds when a
  ; package doesn't ship it; register-task.ps1 only wires it when -Tray and present.
  ; An installed tray may be running: stop it and move its image aside first, then
  ; drop the old copy (a still-held copy goes on the next install or uninstall).
  ${If} ${FileExists} "$INSTDIR\shelveshub-tray.exe"
    nsExec::ExecToLog 'schtasks /end /tn "ShelvesHubTray"'
    Pop $0
    nsExec::ExecToLog 'taskkill /f /fi "IMAGENAME eq shelveshub-tray.exe"'
    Pop $0
    Delete "$INSTDIR\shelveshub-tray.old"
    Rename "$INSTDIR\shelveshub-tray.exe" "$INSTDIR\shelveshub-tray.old"
  ${EndIf}
  File /nonfatal "payload\shelveshub-tray.exe"
  Delete "$INSTDIR\shelveshub-tray.old"

  ; Config file — install only if absent, so a re-install never clobbers edits.
  StrCpy $ConfigWasFresh "0"
  IfFileExists "$INSTDIR\shelveshub.config.json" cfg_exists 0
    File "payload\shelveshub.config.json"
    StrCpy $ConfigWasFresh "1"
  cfg_exists:

  ; Apply the Setup-options page choices (config flips on a fresh config; prefs
  ; seeded once). Mirrors the script/zip installer; stays editable in the tab.
  File "payload\apply-setup.ps1"
  nsExec::ExecToLog 'powershell -ExecutionPolicy Bypass -NoProfile -File "$INSTDIR\apply-setup.ps1" -InstallPath "$INSTDIR" -ConfigWasFresh $ConfigWasFresh -Force $SForce -NativeQam $SNqam -DesktopUi $SDesk -AutoUpdate $SAuto -AutoUpdateHub $SAhub -AutoUpdatePlugin $SAplug -HubPrerelease $SHpre -PluginPrerelease $SPpre'
  Pop $0

  DetailPrint "Registering the ShelvesHub background service..."
  nsExec::ExecToLog 'powershell -ExecutionPolicy Bypass -NoProfile -File "$INSTDIR\register-task.ps1" -InstallPath "$INSTDIR" -Tray $STray'
  Pop $0
  ${If} $0 != 0
    DetailPrint "Warning: service registration returned $0 (see log)."
  ${EndIf}

  ; Steam opens its CEF debug port only when this flag file exists in its install
  ; dir (HKCU SteamPath); without it a fresh install logs "connection refused"
  ; forever. Best-effort: a missing Steam never fails the setup.
  ReadRegStr $0 HKCU "Software\Valve\Steam" "SteamPath"
  ${If} $0 != ""
  ${AndIf} ${FileExists} "$0\*.*"
    FileOpen $1 "$0\.cef-enable-remote-debugging" "a"
    ${If} $1 != ""
      FileClose $1
      DetailPrint "Enabled Steam's debug port ($0) - restart Steam once so it takes effect."
    ${EndIf}
  ${EndIf}

  ; Per-user uninstall entry (HKCU — no admin; shows under Add/Remove Programs
  ; for this user).
  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "DisplayIcon" "$INSTDIR\shelveshub.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "Publisher" "${APPNAME}"

  ; Write the on-screen install details to install.log too (parity with the other
  ; installers), so a GUI install is diagnosable afterwards.
  Push "$INSTDIR\install.log"
  Call DumpLog
SectionEnd

Section "Uninstall"
  nsExec::ExecToLog 'schtasks /end /tn "ShelvesHub"'
  nsExec::ExecToLog 'schtasks /delete /tn "ShelvesHub" /f'
  ; Opt-in tray companion task + binary (harmless no-ops if it was never installed).
  nsExec::ExecToLog 'schtasks /end /tn "ShelvesHubTray"'
  nsExec::ExecToLog 'schtasks /delete /tn "ShelvesHubTray" /f'
  ; A daemon relaunched outside the task (self-update) survives `schtasks /end`.
  nsExec::ExecToLog 'taskkill /f /fi "IMAGENAME eq shelveshub.exe"'
  nsExec::ExecToLog 'taskkill /f /fi "IMAGENAME eq shelveshub-tray.exe"'
  Delete "$INSTDIR\shelveshub-tray.exe"
  Delete "$INSTDIR\shelveshub-tray.old"
  Delete "$INSTDIR\shelveshub.exe"
  Delete "$INSTDIR\shelveshub.old"
  Delete "$INSTDIR\shelves-devtools.exe"
  Delete "$INSTDIR\register-task.ps1"
  Delete "$INSTDIR\apply-setup.ps1"
  Delete "$INSTDIR\migrate.ps1"
  Delete "$INSTDIR\shelveshub.config.json"
  RMDir /r "$INSTDIR\runtime"
  RMDir /r "$INSTDIR\bundle"
  RMDir /r "$INSTDIR\backend"
  RMDir /r "$INSTDIR\backend.new"
  RMDir /r "$INSTDIR\backend.old"
  RMDir /r "$INSTDIR\assets"
  ; Files the daemon and the installers write beside the payload: the config backup
  ; + the dot-prefixed write temps, the RPC token, a staged self-update, the rollback
  ; snapshot, the daemon's log and the install log. Without these the directory is
  ; left behind.
  Delete "$INSTDIR\shelveshub.config.json.bak"
  Delete "$INSTDIR\.*.tmp"
  Delete "$INSTDIR\.rpc-token"
  Delete "$INSTDIR\shelveshub.exe.new"
  Delete "$INSTDIR\install.log"
  RMDir /r "$INSTDIR\logs"
  RMDir /r "$INSTDIR\previous"
  RMDir /r "$INSTDIR\previous.tmp"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}"
SectionEnd
