import * as vscode from 'vscode';
import { exec } from 'child_process';
import { checkGitConfigAndGuide } from '../utils/gitConfigWizard';

function runGit(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    exec(`git ${args.join(' ')}`, { cwd }, (err, stdout, stderr) => {
      resolve({ code: err ? (err as any).code || 1 : 0, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

async function detectGitInstalled(ws: string | undefined): Promise<boolean> {
  const root = ws || process.cwd();
  const res = await runGit(['--version'], root);
  return res.code === 0;
}

async function detectGitUser(ws: string | undefined): Promise<{ name?: string; email?: string; scope: 'global' | 'local' | 'none' }> {
  const root = ws || process.cwd();
  const gName = (await runGit(['config', '--global', 'user.name'], root)).stdout;
  const gEmail = (await runGit(['config', '--global', 'user.email'], root)).stdout;
  const lName = (await runGit(['config', '--local', 'user.name'], root)).stdout;
  const lEmail = (await runGit(['config', '--local', 'user.email'], root)).stdout;
  if (lName && lEmail) { return { name: lName, email: lEmail, scope: 'local' }; }
  if (gName && gEmail) { return { name: gName, email: gEmail, scope: 'global' }; }
  return { scope: 'none' };
}

export function registerSetupWizardCommands(context: vscode.ExtensionContext) {
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  context.subscriptions.push(
    vscode.commands.registerCommand('AndreaNovelHelper.openSetupWizard', () => {
      vscode.commands.executeCommand('workbench.action.openWalkthrough', 'andreafrederica.andrea-novel-helper.andreaNovelHelper.setup', false);
    }),
    vscode.commands.registerCommand('AndreaNovelHelper.wizard.checkGit', async () => {
      const ok = await detectGitInstalled(ws);
      if (ok) {
        vscode.window.showInformationMessage('Git 已安装');
      } else {
        vscode.window.showWarningMessage('未检测到 Git，可执行“安装 Git”步骤。');
      }
    }),
    vscode.commands.registerCommand('AndreaNovelHelper.wizard.openGitDownload', () => {
      vscode.env.openExternal(vscode.Uri.parse('https://git-scm.com/downloads'));
      vscode.window.showInformationMessage('已在浏览器打开 Git 下载页面');
    }),
    vscode.commands.registerCommand('AndreaNovelHelper.wizard.checkGitUser', async () => {
      const installed = await detectGitInstalled(ws);
      if (!installed) { vscode.window.showWarningMessage('尚未安装 Git，先完成前置步骤。'); return; }
      const info = await detectGitUser(ws);
      if (info.scope === 'none') {
        vscode.window.showWarningMessage('尚未配置 Git 用户名/邮箱');
      } else {
        vscode.window.showInformationMessage(`已检测到 Git 用户信息: ${info.name} <${info.email}> (${info.scope === 'local' ? '本仓库' : '全局'})`);
      }
    }),
    vscode.commands.registerCommand('AndreaNovelHelper.wizard.configureGitUser', async () => {
      const installed = await detectGitInstalled(ws);
      if (!installed) { vscode.window.showWarningMessage('尚未安装 Git，无法配置'); return; }
  if (ws) { await checkGitConfigAndGuide(ws); }
  else { vscode.window.showErrorMessage('没有工作区，无法配置 Git'); }
    })
  );
}
