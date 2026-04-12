import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { exportBundledCopilotDocsToWorkspace, listBundledCopilotDocs } from '../copilot/assets';

async function pickWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return undefined;
  }
  if (folders.length === 1) {
    return folders[0];
  }

  const picked = await vscode.window.showQuickPick(
    folders.map(folder => ({
      label: folder.name,
      description: folder.uri.fsPath,
      folder,
    })),
    {
      placeHolder: '选择要释放 Copilot 文档的工作区',
      canPickMany: false,
    },
  );

  return picked?.folder;
}

export function registerCopilotDocsCommands(
  context: vscode.ExtensionContext,
  log?: (msg: string, err?: any) => void,
) {
  context.subscriptions.push(
    vscode.commands.registerCommand('andrea.copilot.exportPromptsToWorkspace', async () => {
      const folder = await pickWorkspaceFolder();
      if (!folder) {
        vscode.window.showErrorMessage('没有可用的工作区，无法释放内置 Copilot 文档。');
        return;
      }

      const workspaceRoot = folder.uri.fsPath;
      const docs = listBundledCopilotDocs();
      const existing = docs
        .map(doc => ({
          id: doc.id,
          targetPath: path.join(workspaceRoot, ...doc.workspaceRelativePath.split('/')),
        }))
        .filter(item => fs.existsSync(item.targetPath));

      let overwrite = false;
      if (existing.length > 0) {
        const choice = await vscode.window.showWarningMessage(
          `当前项目里已存在 ${existing.length} 个 Copilot 文档，是否覆盖？`,
          '覆盖现有文件',
          '跳过现有文件',
          '取消',
        );
        if (choice === '取消' || !choice) {
          return;
        }
        overwrite = choice === '覆盖现有文件';
      }

      const result = exportBundledCopilotDocsToWorkspace(context.extensionPath, workspaceRoot, overwrite);
      const summary = `已写入 ${result.written.length} 个，跳过 ${result.skipped.length} 个，缺失 ${result.missing.length} 个。`;
      log?.(`释放内置 Copilot 文档完成: ${summary}`);

      if (result.missing.length > 0) {
        vscode.window.showWarningMessage(`内置 Copilot 文档不完整。${summary}`);
      } else {
        const action = await vscode.window.showInformationMessage(
          `已将内置 Copilot 文档释放到当前项目。${summary}`,
          '打开指令文件',
        );
        if (action === '打开指令文件') {
          const targetPath = path.join(workspaceRoot, '.github', 'copilot-instructions.md');
          const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
          await vscode.window.showTextDocument(doc, { preview: false });
        }
      }
    }),
  );
}