; ===================== 基本信息 =====================
#define MyAppName "NovelHelper"
#define MyAppVersion "0.3.6"
#define MyAppPublisher "AndreaFrederica"
#define MyAppURL "https://github.com/AndreaFrederica/andrea-novel-helper"

; ===== 文档路径 =====
#define LicenseFilePath "license.txt"
#define InfoBeforePath  "README.md"
#define InfoAfterPath   "readme.txt"

; ===== 自带的安装器/素材 =====
#define MyIcon        "anh_logo.ico"
#define VSCodeSetup   "VSCodeUserSetup-x64-1.103.2.exe"
#define GitSetup      "Git-2.51.0-64-bit.exe"

[Setup]
AppId={{F4D34F04-96CC-40B5-82A9-33E4956923E7}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
OutputBaseFilename=NovelHelperBootstrap
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
AlwaysShowDirOnReadyPage=yes
ChangesEnvironment=yes
SetupIconFile={#MyIcon}
ArchitecturesInstallIn64BitMode=x64

LicenseFile={#LicenseFilePath}
InfoBeforeFile={#InfoBeforePath}
InfoAfterFile={#InfoAfterPath}

SetupLogging=yes

[Languages]
Name: "chinese"; MessagesFile: "compiler:Languages\Chinese.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "在桌面创建快捷方式"; GroupDescription: "附加图标:"; Flags: checkedonce
Name: "startmenu";  Description: "在“开始”菜单创建程序组"; GroupDescription: "附加图标:"; Flags: checkedonce

[Files]
Source: "{#VSCodeSetup}"; DestDir: "{tmp}"; Flags: ignoreversion
Source: "{#GitSetup}";    DestDir: "{tmp}"; Flags: ignoreversion
Source: "extensions.txt"; DestDir: "{tmp}"; Flags: ignoreversion
#if DirExists(AddBackslash(SourcePath) + "vsix")
Source: "{#SourcePath}vsix\*"; DestDir: "{tmp}\vsix"; Flags: ignoreversion recursesubdirs createallsubdirs
#endif


Source: "settings.template.json"; DestDir: "{tmp}"; Flags: ignoreversion
Source: "{#MyIcon}"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
; 用环境变量 + --locale（点击时按当前用户解析）
Name: "{autodesktop}\Andrea Novel Helper"; \
  Filename: "{%LOCALAPPDATA}\Programs\Microsoft VS Code\Code.exe"; \
  Parameters: "--locale=zh-cn"; \
  IconFilename: "{app}\anh_logo.ico"; \
  Comment: "启动 Andrea Novel Helper"; \
  Tasks: desktopicon

Name: "{autoprograms}\Andrea Novel Helper\Andrea Novel Helper"; \
  Filename: "{%LOCALAPPDATA}\Programs\Microsoft VS Code\Code.exe"; \
  Parameters: "--locale=zh-cn"; \
  IconFilename: "{app}\anh_logo.ico"; \
  Comment: "启动 Andrea Novel Helper"; \
  Tasks: startmenu

[Code]
const
  MODE_MIXED  = 0;
  MODE_LOCAL  = 1;
  MODE_ONLINE = 2;

var
  InfoPage: TWizardPage;
  GitPage: TInputQueryWizardPage;
  ExtSourcePage: TWizardPage;
  rbMixed, rbLocal, rbOnline: TNewRadioButton;
  InstallExtMode: Integer;

  ExecPage: TOutputProgressWizardPage;
  LogMemo: TNewMemo;
  TotalSteps, DoneSteps: Integer;

  GitName, GitEmail: string;
  GitUserProvided: Boolean;
  
  VSCodeInstalled, GitInstalled: Boolean;

{ ---------------- 日志与进度 ---------------- }
procedure AppendLog(const S: string);
var ts: string;
begin
  Log(S);
  if Assigned(LogMemo) then
  begin
    ts := GetDateTimeString('hh:nn:ss', #0, #0);
    LogMemo.Lines.Add(ts + '  ' + S);
    LogMemo.SelStart := Length(LogMemo.Text);
  end;
end;

procedure ProgressInit(const Title, SubTitle: string; const Steps: Integer);
begin
  ExecPage := CreateOutputProgressPage(Title, SubTitle);
  ExecPage.Show;
  ExecPage.SetText(Title, SubTitle);
  TotalSteps := Steps;
  DoneSteps := 0;
  ExecPage.SetProgress(0, TotalSteps);

  LogMemo := TNewMemo.Create(ExecPage.Surface);
  LogMemo.Parent := ExecPage.Surface;
  LogMemo.ReadOnly := True;
  LogMemo.ScrollBars := ssVertical;
  LogMemo.Left := ScaleX(0);
  LogMemo.Top := ExecPage.ProgressBar.Top + ExecPage.ProgressBar.Height + ScaleY(8);
  LogMemo.Width := ExecPage.Surface.ClientWidth;
  LogMemo.Height := ExecPage.Surface.ClientHeight - LogMemo.Top - ScaleY(8);
end;

procedure ProgressStep(const Caption, Detail: string);
begin
  if Assigned(ExecPage) then
  begin
    ExecPage.SetText(Caption, Detail);
    if DoneSteps < TotalSteps then Inc(DoneSteps);
    ExecPage.SetProgress(DoneSteps, TotalSteps);
  end;
  if Detail <> '' then AppendLog(Detail);
end;

procedure ProgressDone;
begin
  if Assigned(ExecPage) then
  begin
    ExecPage.SetText('完成', '所有任务已完成');
    ExecPage.SetProgress(TotalSteps, TotalSteps);
    ExecPage.Hide;
    ExecPage := nil;
  end;
end;

{ ---------------- 通用工具 ---------------- }
function GetVSCodeCLI: string;
begin
  // 标准用户级安装位置
  Result := ExpandConstant('{localappdata}\Programs\Microsoft VS Code\bin\code.cmd');
end;

function GetVSCodeExeForUser: string;
begin
  Result := ExpandConstant('{localappdata}\Programs\Microsoft VS Code\Code.exe');
end;

function WaitVSCodeCLIReady(TimeoutMs: Integer): Boolean;
var RC, Attempts, Limit: Integer;
begin
  Result := False;
  Attempts := 0;
  if TimeoutMs <= 0 then TimeoutMs := 10000;
  Limit := TimeoutMs div 500;
  while Attempts < Limit do
  begin
    if ExecAsOriginalUser(GetVSCodeCLI, '--version', '', SW_HIDE, ewWaitUntilTerminated, RC) and (RC = 0) then
      begin Result := True; Exit; end;
    Sleep(500);
    Inc(Attempts);
  end;
end;


function InstallOneExtension(const Arg: string): Integer;
var RC, TryCnt: Integer; Params: string;
begin
  Result := 1;
  if not WaitVSCodeCLIReady(15000) then
  begin
    AppendLog('VS Code CLI 未就绪，跳过：' + Arg);
    Exit;
  end;

  Params := '--install-extension "' + Arg + '" --force';
  TryCnt := 0;
  while TryCnt < 2 do
  begin
    if ExecAsOriginalUser(GetVSCodeCLI, Params, '', SW_HIDE, ewWaitUntilTerminated, RC) and (RC = 0) then
      begin Result := 0; Exit; end;
    Inc(TryCnt);
    Sleep(700);
  end;

  AppendLog('安装扩展失败：' + Arg + '（返回码 ' + IntToStr(RC) + '）');
  Result := RC;
end;


function IsVSCodeInstalledForUser: Boolean;
var RC: Integer;
begin
  Result := FileExists(GetVSCodeExeForUser) and 
            ExecAsOriginalUser(GetVSCodeExeForUser, '--version', '', SW_HIDE, ewWaitUntilTerminated, RC) and 
            (RC = 0);
end;

function HasSystemGit: Boolean;
var ResultCode: Integer;
begin
  Result := Exec('cmd', '/c git --version', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0);
end;

function GetGitExe: string;
begin
  if FileExists(ExpandConstant('{pf}\Git\cmd\git.exe')) then
    Result := ExpandConstant('{pf}\Git\cmd\git.exe')
  else
    Result := 'git';
end;

function ExecGitAsUser(const Args: string; var RC: Integer): Boolean;
begin
  // 直接调用 git.exe，避免 cmd 的二次解析
  Result := ExecAsOriginalUser(GetGitExe, Args, '', SW_HIDE, ewWaitUntilTerminated, RC);
end;


{ --- 修复损坏的全局 .gitconfig（使用cmd替代powershell） --- }
procedure EnsureValidGlobalGitConfigAsUser;
var RC: Integer; ConfigFile: string;
begin
  ProgressStep('检查Git配置', '验证全局 .gitconfig 文件...');
  
  if not ExecGitAsUser('config --global --list', RC) then
  begin
    AppendLog('检测 .gitconfig 失败（无法执行 git），跳过修复。');
    Exit;
  end;

  if RC <> 0 then
  begin
    AppendLog('检测到全局 .gitconfig 可能损坏，尝试备份并重建...');
    ConfigFile := ExpandConstant('{%USERPROFILE}\.gitconfig');
    
    // 备份原文件
    if FileExists(ConfigFile) then
      FileCopy(ConfigFile, ConfigFile + '.bak', False);
    
    // 使用cmd创建新的配置文件
    if ExecAsOriginalUser('cmd', '/c echo [user] > "' + ConfigFile + '"', '', SW_HIDE, ewWaitUntilTerminated, RC) and
       ExecAsOriginalUser('cmd', '/c echo     name = Your Name >> "' + ConfigFile + '"', '', SW_HIDE, ewWaitUntilTerminated, RC) and
       ExecAsOriginalUser('cmd', '/c echo     email = you@example.com >> "' + ConfigFile + '"', '', SW_HIDE, ewWaitUntilTerminated, RC) then
      AppendLog('已重建 .gitconfig 文件。')
    else
      AppendLog('重建 .gitconfig 失败，后续可能继续失败。');
  end;
end;

{ ---------------- 检查已安装软件 ---------------- }
procedure CheckInstalledSoftware;
begin
  ProgressStep('检查已安装软件', '检查 VS Code 和 Git 安装状态...');
  
  VSCodeInstalled := IsVSCodeInstalledForUser;
  if VSCodeInstalled then
    AppendLog('检测到 VS Code 已安装（用户级）')
  else
    AppendLog('VS Code 未安装，将进行安装');
    
  GitInstalled := HasSystemGit;
  if GitInstalled then
    AppendLog('检测到 Git 已安装（系统级）')
  else
    AppendLog('Git 未安装，将进行安装');
end;

{ ---------------- VSIX & 列表扫描 ---------------- }
function CountVsixFiles: Integer;
var SR: TFindRec; Dir: string;
begin
  Result := 0;
  Dir := ExpandConstant('{tmp}\vsix');
  if DirExists(Dir) and FindFirst(Dir + '\*.vsix', SR) then
  try
    repeat Inc(Result) until not FindNext(SR);
  finally FindClose(SR); end;
end;

function LastDashIndex(const s: string): Integer;
var i: Integer;
begin
  Result := 0;
  for i := Length(s) downto 1 do
    if s[i] = '-' then begin Result := i; Exit; end;
end;

function IsDigitOrDot(ch: Char): Boolean;
begin
  Result := ((ch >= '0') and (ch <= '9')) or (ch = '.');
end;

function IsVersionString(const t: string): Boolean;
var i: Integer; hasDigit: Boolean;
begin
  hasDigit := False;
  for i := 1 to Length(t) do
  begin
    if IsDigitOrDot(t[i]) then
    begin if (t[i] >= '0') and (t[i] <= '9') then hasDigit := True; end
    else begin Result := False; Exit; end;
  end;
  Result := hasDigit;
end;

function GetExtensionIdFromVsix(const FileName: string): string;
var base: string; p: Integer;
begin
  base := ExtractFileName(FileName);
  if LowerCase(ExtractFileExt(base)) = '.vsix' then
    base := Copy(base, 1, Length(base)-5);
  p := LastDashIndex(base);
  if (p > 0) and IsVersionString(Copy(base, p+1, MaxInt)) then
    base := Copy(base, 1, p-1);
  Result := LowerCase(base);
end;

procedure CollectVsixExtensions(const Dir: string; ExtIds: TStringList);
var SR: TFindRec; id: string;
begin
  if not DirExists(Dir) then Exit;
  if FindFirst(Dir + '\*.vsix', SR) then
  try
    repeat
      id := GetExtensionIdFromVsix(SR.Name);
      if id <> '' then ExtIds.Add(id);
    until not FindNext(SR);
  finally
    FindClose(SR);
  end;
end;

function CountExtensionsInList(const FilterWithVsix: Boolean): Integer;
var listFile, line, id: string; SL, VsixIds: TStringList; i: Integer;
begin
  Result := 0;
  listFile := ExpandConstant('{tmp}\extensions.txt');
  if not FileExists(listFile) then Exit;

  VsixIds := nil;
  if FilterWithVsix then
  begin
    VsixIds := TStringList.Create;
    VsixIds.Sorted := True;
    VsixIds.Duplicates := dupIgnore;
    CollectVsixExtensions(ExpandConstant('{tmp}\vsix'), VsixIds);
  end;

  SL := TStringList.Create;
  try
    SL.LoadFromFile(listFile);
    for i := 0 to SL.Count - 1 do
    begin
      line := Trim(SL[i]);
      if (line = '') or (Copy(line, 1, 1) = '#') then Continue;
      id := LowerCase(line);
      if Pos('@', id) > 0 then id := Copy(id, 1, Pos('@', id) - 1);
      if (VsixIds <> nil) and (VsixIds.IndexOf(id) >= 0) then Continue;
      Inc(Result);
    end;
  finally
    SL.Free;
    if VsixIds <> nil then VsixIds.Free;
  end;
end;

{ ---------------- 安装动作 ---------------- }
procedure InstallVSCodeIfMissing;
var RC: Integer; SetupExe: string;
begin
  if VSCodeInstalled then Exit;

  SetupExe := ExpandConstant('{tmp}\{#VSCodeSetup}');
  if not FileExists(SetupExe) then
    RaiseException('缺少 VS Code 安装包：' + SetupExe);

  ProgressStep('安装 VS Code', '正在静默安装 VS Code（用户级）...');
  if not ExecAsOriginalUser(SetupExe,
       '/verysilent /suppressmsgboxes /norestart /mergetasks=!runcode',
       '', SW_HIDE, ewWaitUntilTerminated, RC) or (RC <> 0) then
    RaiseException('VS Code 静默安装失败，代码=' + IntToStr(RC));

  AppendLog('VS Code 安装完成。');
  VSCodeInstalled := True;
end;

procedure InstallGitIfMissing;
var RC: Integer; Cmd: string;
begin
  if GitInstalled then Exit;

  if not FileExists(ExpandConstant('{tmp}\{#GitSetup}')) then
    RaiseException('缺少 Git 安装包：' + ExpandConstant('{#GitSetup}'));

  ProgressStep('安装 Git', '正在静默安装 Git...');
  Cmd := '/VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS ' +
         '/COMPONENTS="icons,ext\reg\shellhere,assoc,assoc_sh"';
  if not Exec(ExpandConstant('{tmp}\{#GitSetup}'), Cmd, '', SW_HIDE, ewWaitUntilTerminated, RC) or (RC<>0) then
    RaiseException('Git 静默安装失败，代码=' + IntToStr(RC));
  AppendLog('Git 安装完成。');
  GitInstalled := True;
end;

procedure ConfigureGitUserIfProvided;
var RC: Integer;
begin
  if not GitUserProvided then Exit;

  ProgressStep('配置Git用户', '设置 Git 用户名和邮箱...');
  
  if not ExecGitAsUser('config --global user.name "' + GitName + '"', RC) then
    AppendLog('无法写入 git user.name（Exec 失败）')
  else if RC <> 0 then
    AppendLog('git config user.name 返回码 ' + IntToStr(RC))
  else
    AppendLog('Git 用户名设置成功：' + GitName);

  if not ExecGitAsUser('config --global user.email "' + GitEmail + '"', RC) then
    AppendLog('无法写入 git user.email（Exec 失败）')
  else if RC <> 0 then
    AppendLog('git config user.email 返回码 ' + IntToStr(RC))
  else
    AppendLog('Git 邮箱设置成功：' + GitEmail);
end;

procedure SetGitCoreEditorToVSCode;
var RC: Integer; EditorCmd: string;
begin
  ProgressStep('配置Git编辑器', '设置 VS Code 为 Git 默认编辑器...');
  EditorCmd := '"' + ExpandConstant('{localappdata}\Programs\Microsoft VS Code\bin\code.cmd') + '" --wait';
  if ExecAsOriginalUser(GetGitExe, 'config --global core.editor ' + EditorCmd, '', SW_HIDE, ewWaitUntilTerminated, RC) and (RC = 0) then
    AppendLog('Git 编辑器设置成功')
  else
    AppendLog('Git 编辑器设置失败，返回码：' + IntToStr(RC));
end;


procedure InstallExtensionsOfflineIfAny;
var vsixDir: string; SR: TFindRec;
begin
  vsixDir := ExpandConstant('{tmp}\vsix');
  if not DirExists(vsixDir) then Exit;

  if FindFirst(vsixDir + '\*.vsix', SR) then try
    repeat
      ProgressStep('安装扩展（离线）', '安装 ' + SR.Name + ' ...');
      InstallOneExtension(vsixDir + '\' + SR.Name);
    until not FindNext(SR);
  finally FindClose(SR); end;
end;

procedure InstallExtensionsOnline(const FilterWithVsix: Boolean);
var listFile, line, id: string; SL, VsixIds: TStringList; i: Integer;
begin
  listFile := ExpandConstant('{tmp}\extensions.txt');
  if not FileExists(listFile) then Exit;

  VsixIds := nil;
  if FilterWithVsix then
  begin
    VsixIds := TStringList.Create;
    VsixIds.Sorted := True;
    VsixIds.Duplicates := dupIgnore;
    CollectVsixExtensions(ExpandConstant('{tmp}\vsix'), VsixIds);
  end;

  SL := TStringList.Create;
  try
    SL.LoadFromFile(listFile);
    for i := 0 to SL.Count-1 do
    begin
      line := Trim(SL[i]);
      if (line = '') or (Copy(line, 1, 1) = '#') then Continue;

      id := LowerCase(line);
      if Pos('@', id) > 0 then id := Copy(id, 1, Pos('@', id) - 1);

      if (VsixIds <> nil) and (VsixIds.IndexOf(id) >= 0) then
      begin AppendLog('跳过在线安装（已有本地 vsix）：' + line); Continue; end;

      ProgressStep('安装扩展（在线）', '安装 ' + line + ' ...');
      InstallOneExtension(line);
    end;
  finally
    SL.Free;
    if VsixIds <> nil then VsixIds.Free;
  end;
end;

procedure InstallChineseLangPack;
begin
  ProgressStep('安装中文语言包', '安装 ms-ceintl.vscode-language-pack-zh-hans ...');
  InstallOneExtension('ms-ceintl.vscode-language-pack-zh-hans');
  AppendLog('语言包安装完成（也可通过快捷方式参数 --locale=zh-cn 生效）。');
end;

procedure ApplyVSCodeSettingsTemplate;
var
  RC: Integer;
  Src: string;
begin
  // 1) 模板在本次安装的临时目录
  Src := ExpandConstant('{tmp}\settings.template.json');

  // 2) 以“原始用户”身份创建 VS Code 用户配置目录
  //    注意：%APPDATA% 将在原始用户环境中解析为 C:\Users\<User>\AppData\Roaming
  ExecAsOriginalUser('cmd', '/c mkdir "%APPDATA%\Code\User" 2>nul', '', SW_HIDE, ewWaitUntilTerminated, RC);

  // 3) 备份已有 settings.json（若存在）
  ExecAsOriginalUser('cmd',
    '/c if exist "%APPDATA%\Code\User\settings.json" ' +
    'copy /Y "%APPDATA%\Code\User\settings.json" "%APPDATA%\Code\User\settings.json.bak" >nul',
    '', SW_HIDE, ewWaitUntilTerminated, RC);

  // 4) 将模板复制为 settings.json（覆盖）
  //    这里用管理员进程展开 {tmp} 为绝对路径，再传给原始用户的 cmd 去 copy
  ExecAsOriginalUser('cmd',
    '/c copy /Y "' + Src + '" "%APPDATA%\Code\User\settings.json" >nul',
    '', SW_HIDE, ewWaitUntilTerminated, RC);

  AppendLog('VS Code 用户设置模板已写入到 %APPDATA%\Code\User\settings.json（如有旧版已备份为 .bak）。');
end;

procedure WriteLocaleJsonAsUser;
var RC: Integer; LocaleDir, LocaleFile: string;
begin
  ProgressStep('配置语言', '写入 locale.json 文件...');
  
  LocaleDir := ExpandConstant('{%APPDATA%}\Code\User');
  LocaleFile := LocaleDir + '\locale.json';
  
  // 创建目录
  if not ExecAsOriginalUser('cmd', '/c mkdir "' + LocaleDir + '" 2>nul', '', SW_HIDE, ewWaitUntilTerminated, RC) then
    AppendLog('创建目录失败，可能已存在');
    
  // 写入配置文件
  if ExecAsOriginalUser('cmd', '/c echo { "locale": "zh-cn" } > "' + LocaleFile + '"', '', SW_HIDE, ewWaitUntilTerminated, RC) then
    AppendLog('locale.json 写入完成')
  else
    AppendLog('写入 locale.json 失败（已由快捷方式参数保证中文界面）');
end;

{ ---------------- 向导页面 ---------------- }
procedure InitializeWizard;
var
  InfoText: TNewStaticText;
  vscPath: string;
begin
  vscPath := ExpandConstant('{localappdata}\Programs\Microsoft VS Code');

  InfoPage := CreateCustomPage(wpSelectDir,
    '安装说明',
    '以下组件将被安装/配置（用户级 VS Code + 系统级 Git）：');

  InfoText := TNewStaticText.Create(InfoPage);
  InfoText.Parent := InfoPage.Surface;
  InfoText.Left := 0;
  InfoText.Top := 0;
  InfoText.Width := InfoPage.SurfaceWidth;
  InfoText.AutoSize := False;
  InfoText.WordWrap := True;
  InfoText.Height := ScaleY(70);
  InfoText.Caption :=
    '• Git：系统路径 (Program Files)'#13#10 +
    '• VS Code：用户路径 (' + vscPath + ')'#13#10 +
    '• 扩展：本地 vsix 优先，其余在线补齐（可选）';

  GitPage := CreateInputQueryPage(
    wpWelcome, '配置 Git 用户信息',
    '请输入 Git 用户信息',
    '用户名建议英文，邮箱需真实可用。如已配置可留空。');
  GitPage.Add('用户名：', False);
  GitPage.Add('邮箱：', False);

  ExtSourcePage := CreateCustomPage(
    wpSelectDir, '扩展安装源', '选择扩展来源：');

  rbMixed := TNewRadioButton.Create(ExtSourcePage);
  rbMixed.Parent := ExtSourcePage.Surface;
  rbMixed.Top := 30;
  rbMixed.Width := ScaleX(500);
  rbMixed.Caption := '混合（本地 vsix 优先，在线补齐）—推荐';
  rbMixed.Checked := True;

  rbLocal := TNewRadioButton.Create(ExtSourcePage);
  rbLocal.Parent := ExtSourcePage.Surface;
  rbLocal.Top := 60;
  rbLocal.Width := ScaleX(500);
  rbLocal.Caption := '仅本地 vsix';

  rbOnline := TNewRadioButton.Create(ExtSourcePage);
  rbOnline.Parent := ExtSourcePage.Surface;
  rbOnline.Top := 90;
  rbOnline.Width := ScaleX(500);
  rbOnline.Caption := '仅在线 extensions.txt';
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (GitPage <> nil) and (CurPageID = GitPage.ID) then
  begin
    GitName := Trim(GitPage.Values[0]);
    GitEmail := Trim(GitPage.Values[1]);
    
    if (GitName <> '') and (GitEmail <> '') then
    begin
      if Pos('@', GitEmail) = 0 then 
      begin 
        MsgBox('邮箱格式不正确。', mbError, MB_OK); 
        Result := False; 
        Exit; 
      end;
      GitUserProvided := True;
    end
    else
    begin
      GitUserProvided := False;
      AppendLog('Git 用户信息为空，将跳过配置');
    end;
  end;

  if (CurPageID = ExtSourcePage.ID) then
  begin
    if rbLocal.Checked then InstallExtMode := MODE_LOCAL
    else if rbOnline.Checked then InstallExtMode := MODE_ONLINE
    else InstallExtMode := MODE_MIXED;
  end;
end;

{ ---------------- Ready 页文本辅助 ---------------- }
function ExtModeCaption: string;
begin
  case InstallExtMode of
    MODE_LOCAL:  Result := '仅本地 vsix';
    MODE_ONLINE: Result := '仅在线 extensions.txt';
  else
    Result := '混合（vsix 优先，在线补齐）';
  end;
end;

function UpdateReadyMemo(Space, NewLine,
  MemoUserInfo, MemoDirInfo, MemoTypeInfo,
  MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
begin
  Result :=
    MemoUserInfo +
    MemoDirInfo +
    MemoTypeInfo +
    MemoComponentsInfo +
    MemoGroupInfo +
    MemoTasksInfo;

  Result := Result + NewLine +
    '安装附加说明:' + NewLine +
    Space + 'Git 安装路径: C:\Program Files\Git' + NewLine +
    Space + 'VS Code 安装路径: %LOCALAPPDATA%\Programs\Microsoft VS Code' + NewLine +
    Space + '扩展安装源: ' + ExtModeCaption;
end;

{ ---------------- 主执行序列（带进度与日志） ---------------- }
procedure DoSequence;
var
  steps, vsixCount, onlineCount: Integer;
  TempDir: string;
  begin
  TempDir := ExpandConstant('{tmp}\vsix');
  if DirExists(TempDir) then
    AppendLog('发现 vsix 临时目录，内容：');
  // 可用 FindFirst 列出几个文件测试

  // 计算总步数
  vsixCount := CountVsixFiles;
  case InstallExtMode of
    MODE_LOCAL:   onlineCount := 0;
    MODE_ONLINE:  onlineCount := CountExtensionsInList(False);
  else
    onlineCount := CountExtensionsInList(True);
  end;

  // 基础步骤：检查软件 + 安装VS Code（如需要） + 安装Git（如需要） + 检查Git配置 + 配置Git用户（如需要） + 配置Git编辑器 + 语言包
  steps := 1; // 检查软件
  if not VSCodeInstalled then Inc(steps); // 安装VS Code
  if not GitInstalled then Inc(steps);    // 安装Git
  Inc(steps); // 检查Git配置
  if GitUserProvided then Inc(steps);     // 配置Git用户
  Inc(steps); // 配置Git编辑器
  steps := steps + vsixCount + onlineCount + 1;


  ProgressInit('正在配置 NovelHelper 写作环境', '请稍候，正在执行自动化步骤……', steps);

  try
    // 1. 检查已安装软件
    CheckInstalledSoftware;
    
    // 2. 安装VS Code（如需要）
    InstallVSCodeIfMissing;
    
    // 3. 安装Git（如需要）
    InstallGitIfMissing;
    
    // 4. 确保Git配置文件正常（只有在Git可用时才执行）
    if GitInstalled or HasSystemGit then
    begin
      EnsureValidGlobalGitConfigAsUser;
      
      // 5. 配置Git用户（如果提供了且Git已安装）
      ConfigureGitUserIfProvided;
      
      // 6. 设置Git编辑器
      SetGitCoreEditorToVSCode;
    end;

    // 7. 安装扩展
    case InstallExtMode of
      MODE_LOCAL:
        begin
          if vsixCount > 0 then 
          begin
            AppendLog('使用本地 VSIX 安装扩展，共计 ' + IntToStr(vsixCount) + ' 个。');
            InstallExtensionsOfflineIfAny;
          end
          else 
            AppendLog('未发现本地 VSIX。');
        end;
      MODE_ONLINE:
        begin
          if onlineCount > 0 then
          begin
            AppendLog('仅在线安装扩展，共计约 ' + IntToStr(onlineCount) + ' 个。');
            InstallExtensionsOnline(False);
          end
          else
            AppendLog('未发现在线扩展列表或列表为空。');
        end;
    else
      begin
        if vsixCount > 0 then
          AppendLog('混合模式：先安装本地 VSIX（' + IntToStr(vsixCount) + '），再在线补齐（约 ' + IntToStr(onlineCount) + '）。')
        else
          AppendLog('混合模式：未发现本地 VSIX，将全部在线安装（约 ' + IntToStr(onlineCount) + '）。');
        InstallExtensionsOfflineIfAny;
        InstallExtensionsOnline(True);
      end;
    end;

    // 8. 安装中文语言包
    InstallChineseLangPack;
        
    // 9. 注入 VS Code 用户配置（模板）
    ApplyVSCodeSettingsTemplate;
    
    // 可选：写入locale.json文件
    // WriteLocaleJsonAsUser;

    ProgressStep('完成配置', '所有配置任务已完成。');
    AppendLog('NovelHelper 写作环境配置完成！');

  except
    AppendLog('配置过程中发生错误：' + GetExceptionMessage);
    MsgBox('配置过程中发生错误：' + GetExceptionMessage, mbError, MB_OK);
  end;

  ProgressDone;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then DoSequence();
end;