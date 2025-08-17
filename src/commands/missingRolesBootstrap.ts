import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import JSON5 from 'json5';
import { generateExampleRoleList, generateMarkdownRoleTemplate } from '../templates/templateGenerators';
import { projectInitPromptScheduled } from '../wizard/workspaceInitCheck';

/**
 * 在激活阶段注册：检测默认 rolesFile 是否存在；
 * 若不存在且当前不会弹出项目初始化向导，则提示用户创建示例角色库。
 * 逻辑变化：不再因为存在“其他任意描述文件”而跳过——因为诸如从选择创建角色等功能依赖默认角色库。
 */
export function registerMissingRolesBootstrap(context: vscode.ExtensionContext) {
  try {
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    const rolesFile = cfg.get<string>('rolesFile');
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!rolesFile || !wsRoot) { return; }
    const absPath = path.isAbsolute(rolesFile) ? rolesFile : path.join(wsRoot, rolesFile);

  if (fs.existsSync(absPath)) { return; } // 已存在，无需提示

    // 如果项目初始化向导即将弹出，交由向导处理，不重复提示
    if (projectInitPromptScheduled) {
      return;
    }

    const showPrompt = async () => {
      const choice = await vscode.window.showInformationMessage(
        `角色库文件 "${rolesFile}" 不存在，是否创建示例角色库？`,
        { modal: true },
        '创建',
        '跳过'
      );
      if (choice === '创建') {
  const example = generateExampleRoleList();
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        fs.writeFileSync(absPath, JSON5.stringify(example, null, 2), 'utf8');
        // 同时创建一个 markdown 示例角色文件（若不存在）
        try {
          const dir = path.dirname(absPath);
          const mdExample = path.join(dir, 'example-role.md');
          if (!fs.existsSync(mdExample)) {
            fs.writeFileSync(mdExample, generateMarkdownRoleTemplate(), 'utf8');
          }
        } catch { /* ignore */ }
  vscode.window.showInformationMessage(`已创建示例角色库：${rolesFile} （含 example-role.md）`, { modal: true }, '关闭');
        // 触发重新加载角色（延迟稍许避免与激活阶段竞争）
        setTimeout(() => {
          vscode.commands.executeCommand('AndreaNovelHelper.refreshRoles');
        }, 200);
      }
    };

    // 延迟少许，避免与其它初始化提示抢焦点
    setTimeout(showPrompt, 800);
  } catch { /* ignore */ }
}
