import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { checkGitConfigAndGuide } from '../utils/Git/gitConfigWizard';

interface RunGitResult { code: number; stdout: string; stderr: string; enoent?: boolean }

function runGit(args: string[], cwd: string, log?: (msg: string)=>void): Promise<RunGitResult> {
  return new Promise(resolve => {
    try {
      const proc = spawn('git', args, { cwd, shell: false });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', d => { stdout += d.toString(); });
      proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('error', err => {
        // ENOENT => 未安装或不在 PATH
        resolve({ code: 127, stdout: stdout.trim(), stderr: (stderr + '\n' + (err.message||'')).trim(), enoent: (err as any).code === 'ENOENT' });
      });
      proc.on('close', code => {
        resolve({ code: code ?? 0, stdout: stdout.trim(), stderr: stderr.trim() });
      });
    } catch (e:any) {
      log?.('[runGit] 捕获同步异常: ' + (e?.message||e));
      resolve({ code: 127, stdout: '', stderr: String(e), enoent: true });
    }
  });
}

async function detectGitInstalled(ws: string | undefined, log?: (m:string)=>void): Promise<{ installed: boolean; enoent: boolean; raw: RunGitResult }> {
  const root = ws || process.cwd();
  const res = await runGit(['--version'], root, log);
  const installed = res.code === 0 && !res.enoent;
  return { installed, enoent: !!res.enoent, raw: res };
}

async function detectGitUser(ws: string | undefined, log?: (m:string)=>void): Promise<{ name?: string; email?: string; scope: 'global' | 'local' | 'none' }> {
  const root = ws || process.cwd();
  const gName = (await runGit(['config', '--global', 'user.name'], root, log)).stdout;
  const gEmail = (await runGit(['config', '--global', 'user.email'], root, log)).stdout;
  const lName = (await runGit(['config', '--local', 'user.name'], root, log)).stdout;
  const lEmail = (await runGit(['config', '--local', 'user.email'], root, log)).stdout;
  if (lName && lEmail) { return { name: lName, email: lEmail, scope: 'local' }; }
  if (gName && gEmail) { return { name: gName, email: gEmail, scope: 'global' }; }
  return { scope: 'none' };
}

export function registerSetupWizardCommands(context: vscode.ExtensionContext) {
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const out = vscode.window.createOutputChannel('Andrea Novel Helper - Git');
  context.subscriptions.push(out);
  const log = (m:string) => { const t=new Date().toISOString(); out.appendLine(`[${t}] ${m}`); };

  const safeExec = (fn: ()=>Promise<void>|void) => {
    try { const r = fn(); if (r && typeof (r as any).catch === 'function') { (r as Promise<void>).catch(err => { log('命令执行异常: '+ (err?.message||err)); vscode.window.showErrorMessage('命令执行异常: '+ (err?.message||err)); }); } } catch (e:any) { log('命令同步异常: '+ (e?.message||e)); vscode.window.showErrorMessage('命令同步异常: '+ (e?.message||e)); }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('AndreaNovelHelper.openSetupWizard', () => {
      log('打开设置向导 walkthrough');
      vscode.commands.executeCommand('workbench.action.openWalkthrough', 'andreafrederica.andrea-novel-helper.andreaNovelHelper.setup', false);
    }),
    vscode.commands.registerCommand('AndreaNovelHelper.wizard.checkGit', () => safeExec(async () => {
      vscode.window.setStatusBarMessage('$(sync~spin) 正在检测 Git 安装…', 2000);
      log('开始检测 Git 安装');
      const { installed, enoent, raw } = await detectGitInstalled(ws, log);
      log(`检测结果 installed=${installed} enoent=${enoent} code=${raw.code} stderr=${raw.stderr}`);
      if (installed) {
        vscode.window.showInformationMessage('Git 已安装');
      } else if (enoent) {
        vscode.window.showWarningMessage('未找到 git 命令（可能未安装或未加入 PATH）');
      } else {
        vscode.window.showWarningMessage('Git 检测失败 (返回码 '+ raw.code +')，请确认已正确安装');
      }
    })),
    vscode.commands.registerCommand('AndreaNovelHelper.wizard.openGitDownload', () => safeExec(() => {
      log('打开 Git 下载页面');
      vscode.env.openExternal(vscode.Uri.parse('https://git-scm.com/downloads'));
      vscode.window.showInformationMessage('已在浏览器打开 Git 下载页面');
    })),
    vscode.commands.registerCommand('AndreaNovelHelper.wizard.checkGitUser', () => safeExec( async () => {
      vscode.window.setStatusBarMessage('$(sync~spin) 正在读取 Git 用户信息…', 2000);
      log('开始检测 Git 用户信息');
      const inst = await detectGitInstalled(ws, log);
      if (!inst.installed) { vscode.window.showWarningMessage('尚未安装 Git，先完成前置步骤。'); return; }
      const info = await detectGitUser(ws, log);
      log(`用户信息 scope=${info.scope} name=${info.name||''} email=${info.email||''}`);
      if (info.scope === 'none') {
        vscode.window.showWarningMessage('尚未配置 Git 用户名/邮箱');
      } else {
        vscode.window.showInformationMessage(`已检测到 Git 用户信息: ${info.name} <${info.email}> (${info.scope === 'local' ? '本仓库' : '全局'})`);
      }
    })),
    vscode.commands.registerCommand('AndreaNovelHelper.wizard.configureGitUser', () => safeExec( async () => {
      log('进入 Git 用户配置流程');
      const inst = await detectGitInstalled(ws, log);
      if (!inst.installed) { vscode.window.showWarningMessage('尚未安装 Git，无法配置'); return; }
      if (ws) { await checkGitConfigAndGuide(ws); } else { vscode.window.showErrorMessage('没有工作区，无法配置 Git'); }
    }))
  );
}
