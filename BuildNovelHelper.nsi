;---------------------------------------
; Andrea Novel Helper Installer
;---------------------------------------
Unicode true
RequestExecutionLevel admin
SetCompressor /SOLID lzma

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "nsDialogs.nsh"
!insertmacro GetRoot
!insertmacro GetParent

Name "Andrea Novel Helper"
OutFile "NovelHelperSetup.exe"
InstallDir "$PROGRAMFILES\NovelHelper"

; ===== 源目录（替换为实际路径） =====
!define SRC "D:\临时文件\NovelHelper"
!define CORE_DIR     "$INSTDIR\programs\coreutils"
!define CORE_EXE     "$INSTDIR\programs\coreutils\coreutils.exe"
!define GIT_EXE      "$INSTDIR\programs\git\bin\git.exe"

Var NeedsGitCfg
Var GitExe
Var GitUserName
Var GitUserEmail
Var hDlg
Var hUserEdit
Var hMailEdit
Var HL_RET
Var HL_ERR
Var ROOT_A
Var ROOT_B
Var PARENT_DIR
Var LINKNAME
Var LINKPATH

;---------------------------------------
; 创建硬链接（失败则回退复制）
;---------------------------------------
Function CreateHardLinkOrCopy
  IfFileExists "$1" +2 0
    Goto fail_target

  ${GetRoot} "$0" $ROOT_A
  ${GetRoot} "$1" $ROOT_B
  StrCmp "$ROOT_A" "$ROOT_B" +2 0
    Goto do_copy

  ${GetParent} "$0" $PARENT_DIR
  CreateDirectory "$PARENT_DIR"

  IfFileExists "$0" 0 +2
    Delete "$0"

  System::Call 'kernel32::CreateHardLinkW(w "$0", w "$1", p 0) i .r0'
  StrCmp $0 0 ok 0
  Goto do_copy

ok:
  StrCpy $HL_RET 1
  Return

do_copy:
  CopyFiles /SILENT /FILESONLY "$1" "$0"
  IfFileExists "$0" 0 fail_copy
  StrCpy $HL_RET 1
  Return

fail_target:
  StrCpy $HL_RET 0
  Return
fail_copy:
  StrCpy $HL_RET 0
  Return
FunctionEnd

;---------------------------------------
; Coreutils 别名
;---------------------------------------
!macro PUSH_COREUTILS_ALIASES
  Push "[."
  Push "arch"
  Push "b2sum"
  Push "b3sum"
  Push "base32"
  Push "base64"
  Push "basename"
  Push "basenc"
  Push "cat"
  Push "cksum"
  Push "comm"
  Push "cp"
  Push "csplit"
  Push "cut"
  Push "date"
  Push "dd"
  Push "df"
  Push "dir"
  Push "dircolors"
  Push "dirname"
  Push "du"
  Push "echo"
  Push "env"
  Push "expand"
  Push "expr"
  Push "factor"
  Push "false"
  Push "fmt"
  Push "fold"
  Push "hashsum"
  Push "head"
  Push "hostname"
  Push "join"
  Push "link"
  Push "ln"
  Push "ls"
  Push "md5sum"
  Push "mkdir"
  Push "mktemp"
  Push "more"
  Push "mv"
  Push "nl"
  Push "nproc"
  Push "numfmt"
  Push "od"
  Push "paste"
  Push "pr"
  Push "printenv"
  Push "printf"
  Push "ptx"
  Push "pwd"
  Push "readlink"
  Push "realpath"
  Push "rm"
  Push "rmdir"
  Push "seq"
  Push "sha1sum"
  Push "sha224sum"
  Push "sha256sum"
  Push "sha3-224sum"
  Push "sha3-256sum"
  Push "sha3-384sum"
  Push "sha3-512sum"
  Push "sha384sum"
  Push "sha3sum"
  Push "sha512sum"
  Push "shake128sum"
  Push "shake256sum"
  Push "shred"
  Push "shuf"
  Push "sleep"
  Push "sort"
  Push "split"
  Push "sum"
  Push "sync"
  Push "tac"
  Push "tail"
  Push "tee"
  Push "test"
  Push "touch"
  Push "tr"
  Push "true"
  Push "truncate"
  Push "tsort"
  Push "uname"
  Push "unexpand"
  Push "uniq"
  Push "unlink"
  Push "vdir"
  Push "wc"
  Push "whoami"
  Push "yes"
  Push ""
!macroend

;---------------------------------------
; Git 配置检测
;---------------------------------------
Function CheckGitConfig
  StrCpy $NeedsGitCfg 0
  IfFileExists "${GIT_EXE}" 0 sys_git
    StrCpy $GitExe "${GIT_EXE}"
    Goto check
  sys_git:
    StrCpy $GitExe "git.exe"

check:
  nsExec::ExecToStack '"$GitExe" config --global --get user.name'
  Pop $0
  Pop $1
  StrCmp $0 0 +2
    StrCpy $NeedsGitCfg 1

  nsExec::ExecToStack '"$GitExe" config --global --get user.email'
  Pop $2
  Pop $3
  StrCmp $2 0 +2
    StrCpy $NeedsGitCfg 1
FunctionEnd

;---------------------------------------
; Git 配置页面
;---------------------------------------
Function GitPageCreate
  Call CheckGitConfig
  StrCmp $NeedsGitCfg 1 0 done
  nsDialogs::Create 1018
  Pop $hDlg

  ${NSD_CreateLabel} 0u 0u 100% 30u "缺少 Git 全局配置 (用于数据云同步)。$\r\n\
请填写以下信息：$\r\n\
- 用户名建议纯英文$\r\n\
- 邮箱必须是真实可用地址"

  ${NSD_CreateLabel} 0u 40u 30% 12u "Git 用户名："
  ${NSD_CreateText} 0u 54u 100% 12u ""
  Pop $hUserEdit

  ${NSD_CreateLabel} 0u 76u 30% 12u "Git 邮箱："
  ${NSD_CreateText} 0u 90u 100% 12u ""
  Pop $hMailEdit

  nsDialogs::Show
done:
FunctionEnd

Function GitPageLeave
  StrCmp $NeedsGitCfg 1 0 done

  ${NSD_GetText} $hUserEdit $GitUserName
  ${NSD_GetText} $hMailEdit $GitUserEmail

  StrLen $0 $GitUserName
  StrCmp $0 0 0 +2
    MessageBox MB_ICONSTOP "请填写用户名 (建议英文)" /SD IDOK
    Abort

  StrLen $1 $GitUserEmail
  StrCmp $1 0 0 +2
    MessageBox MB_ICONSTOP "请填写邮箱 (必须真实可用)" /SD IDOK
    Abort

  nsExec::ExecToLog '"$GitExe" config --global user.name "$GitUserName"'
  nsExec::ExecToLog '"$GitExe" config --global user.email "$GitUserEmail"'

done:
FunctionEnd

;---------------------------------------
; 安装完成运行提示
;---------------------------------------
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "立即启动 Andrea Novel Helper"
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchApp

Function LaunchApp
  ExecShell "" "$INSTDIR\Code.exe"
  MessageBox MB_ICONINFORMATION "提示：关闭 VS Code 后，下次启动时界面语言会自动切换为中文。"
FunctionEnd

;---------------------------------------
; MUI 页面
;---------------------------------------
!insertmacro MUI_PAGE_WELCOME
Page custom GitPageCreate GitPageLeave
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH
!insertmacro MUI_LANGUAGE "SimpChinese"

;---------------------------------------
; 组件：快捷方式
;---------------------------------------
Section "开始菜单快捷方式" SEC_SM
  SectionIn 1
SectionEnd
Section "桌面快捷方式" SEC_DESK
  SectionIn 1
SectionEnd

;---------------------------------------
; 安装
;---------------------------------------
Section "Install"
  SetOutPath "$INSTDIR"
  File /r /x "programs\coreutils\*.exe" "${SRC}\*.*"
  SetOutPath "${CORE_DIR}"
  File "${SRC}\programs\coreutils\coreutils.exe"

  !insertmacro PUSH_COREUTILS_ALIASES
  loop_links:
    Pop $LINKNAME
    StrCmp $LINKNAME "" done_links
    StrCpy $LINKPATH "${CORE_DIR}\$LINKNAME.exe"
    StrCpy $0 "$LINKPATH"
    StrCpy $1 "${CORE_EXE}"
    Call CreateHardLinkOrCopy
    Goto loop_links
  done_links:

  ${If} ${SectionIsSelected} ${SEC_SM}
    CreateDirectory "$SMPROGRAMS\NovelHelper"
    CreateShortcut "$SMPROGRAMS\NovelHelper\NovelHelper.lnk" "$INSTDIR\Code.exe" "" "$INSTDIR\anh_logo.ico"
  ${EndIf}
  ${If} ${SectionIsSelected} ${SEC_DESK}
    CreateShortcut "$DESKTOP\NovelHelper.lnk" "$INSTDIR\Code.exe" "" "$INSTDIR\anh_logo.ico"
  ${EndIf}

  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

;---------------------------------------
; 卸载
;---------------------------------------
Section "Uninstall"
  Delete "$SMPROGRAMS\NovelHelper\NovelHelper.lnk"
  RMDir "$SMPROGRAMS\NovelHelper"
  Delete "$DESKTOP\NovelHelper.lnk"

  !insertmacro PUSH_COREUTILS_ALIASES
  uloop:
    Pop $LINKNAME
    StrCmp $LINKNAME "" udone
    Delete "${CORE_DIR}\$LINKNAME.exe"
    Goto uloop
  udone:
  Delete "${CORE_EXE}"

  RMDir /r "$INSTDIR"
SectionEnd
