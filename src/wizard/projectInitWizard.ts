import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { checkGitConfigAndGuide } from '../utils/gitConfigWizard';
import { createCharacterGalleryFile, createSensitiveWordsFile, createVocabularyFile, createRegexPatternsFile, ensureDir } from './packageFileCreators';
import { exec } from 'child_process';

function runGit(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    exec(`git ${args.join(' ')}`, { cwd }, (err, stdout, stderr) => {
      resolve({ code: err ? (err as any).code || 1 : 0, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

async function isGitInstalled(cwd: string): Promise<boolean> {
  const r = await runGit(['--version'], cwd);
  return r.code === 0;
}

async function hasGitUserConfig(cwd: string): Promise<boolean> {
  const gName = (await runGit(['config','--global','user.name'], cwd)).stdout;
  const gEmail = (await runGit(['config','--global','user.email'], cwd)).stdout;
  const lName = (await runGit(['config','--local','user.name'], cwd)).stdout;
  const lEmail = (await runGit(['config','--local','user.email'], cwd)).stdout;
  return !!((lName && lEmail) || (gName && gEmail));
}

export function registerProjectInitWizard(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('AndreaNovelHelper.projectInitWizard', async () => {
      const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!ws) { vscode.window.showErrorMessage('未打开工作区'); return; }

      const steps: Array<() => Promise<boolean>> = [];

      // Step 1: Git 环境检测 &（按需）初始化仓库
      steps.push(async () => {
        const installed = await isGitInstalled(ws);
        if (!installed) {
          const act = await vscode.window.showInformationMessage('未检测到 Git，可稍后自行安装。跳过 Git 初始化步骤。', '继续');
          return !!act; // 继续
        }
        if (fs.existsSync(path.join(ws, '.git'))) {
          return true; // 已有仓库
        }
        const pick = await vscode.window.showQuickPick(['初始化 Git 仓库', '跳过'], { placeHolder: '当前目录未初始化 Git，是否创建？' });
        if (pick === '初始化 Git 仓库') {
          try {
            await vscode.tasks.executeTask(new vscode.Task({ type: 'shell' }, vscode.TaskScope.Workspace, 'git init', 'ANH', new vscode.ShellExecution('git init')));
            vscode.window.showInformationMessage('Git 仓库已初始化');
          } catch (e) {
            vscode.window.showErrorMessage('Git 初始化失败: ' + (e as any)?.message);
          }
        }
        return true;
      });

      // Step 2: Git 用户配置（仅当已安装 Git 且尚未配置）
      steps.push(async () => {
        const installed = await isGitInstalled(ws);
  if (!installed) { return true; }
        const hasUser = await hasGitUserConfig(ws);
        if (hasUser) { return true; }
        const pick = await vscode.window.showQuickPick(['配置 Git 用户信息', '跳过'], { placeHolder: '未检测到 Git 用户名/邮箱，是否现在配置？' });
        if (pick === '配置 Git 用户信息') {
          await checkGitConfigAndGuide(ws);
        }
        return true;
      });

      // Step 3: 创建 novel-helper 结构与示例文件（使用抽取的创建函数）
      steps.push(async () => {
        const root = path.join(ws, 'novel-helper');
        ensureDir(root);
        createCharacterGalleryFile(root);
        createSensitiveWordsFile(root);
        createVocabularyFile(root);
        createRegexPatternsFile(root);
        vscode.window.showInformationMessage('已创建 novel-helper 初始角色/词库文件');
        return true;
      });


      // Step 5: 初始提交（可选，需 Git 已安装且初始化）
      steps.push(async () => {
        const installed = await isGitInstalled(ws);
        if (!installed || !fs.existsSync(path.join(ws, '.git'))) { return true; }
        const pick = await vscode.window.showQuickPick(['创建初始提交', '跳过'], { placeHolder: '是否创建初始提交?' });
        if (pick === '创建初始提交') {
          const term = vscode.window.createTerminal({ name: 'ANH Init' });
          term.show();
          term.sendText('git add .');
          term.sendText('git commit -m "chore: initial novel-helper structure"');
        }
        return true;
      });

      for (const step of steps) {
        const ok = await step();
  if (!ok) { break; }
      }
    })
  );
}
