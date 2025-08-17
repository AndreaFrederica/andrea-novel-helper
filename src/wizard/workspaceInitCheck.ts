import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/** 检测当前工作区是否完全缺少任何描述文件，缺少则提示运行初始化向导 */
// 标记是否已经计划弹出项目初始化向导（用于避免与其他初始化提示冲突）
export let projectInitPromptScheduled = false;

export function maybePromptProjectInit() {
  try {
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!wsRoot) { return; }
    const nhDir = path.join(wsRoot, 'novel-helper');
    const configuredFiles = [
      cfg.get<string>('rolesFile'),
      cfg.get<string>('sensitiveWordsFile'),
      cfg.get<string>('vocabularyFile'),
      cfg.get<string>('regexPatternsFile')
    ].filter(Boolean).map(p => path.join(wsRoot, p!));
    const anyConfiguredExists = configuredFiles.some(p => fs.existsSync(p));
    const roleFileNameKeywords = [
      'character-gallery','character','role','roles',
      'sensitive-words','sensitive','vocabulary','vocab',
      'regex-patterns','regex'
    ];
    const validExts = ['.json5','.txt','.md'];
    function hasAnyRoleFilesUnder(root: string): boolean {
  if (!fs.existsSync(root)) { return false; }
      const stack: string[] = [root];
      while (stack.length) {
        const dir = stack.pop()!;
        let entries: fs.Dirent[] = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
        for (const e of entries) {
          if (e.isDirectory()) {
            if (e.name === 'outline' || e.name === '.anh-fsdb') { continue; }
            stack.push(path.join(dir, e.name));
          } else if (e.isFile()) {
            const ln = e.name.toLowerCase();
            if (validExts.some(ext => ln.endsWith(ext)) && roleFileNameKeywords.some(k => ln.includes(k))) {
              return true;
            }
          }
        }
      }
      return false;
    }
    const anyPkgFiles = hasAnyRoleFilesUnder(nhDir);
    if (!anyConfiguredExists && !anyPkgFiles) {
      projectInitPromptScheduled = true;
      setTimeout(() => {
        vscode.window.showInformationMessage('未检测到角色/词汇/敏感词等描述文件，是否运行项目初始化向导？', '运行向导', '忽略').then(sel => {
          projectInitPromptScheduled = false; // 用户已处理（无论选择哪个）
          if (sel === '运行向导') {
            vscode.commands.executeCommand('AndreaNovelHelper.projectInitWizard');
          }
        }, () => { projectInitPromptScheduled = false; });
      }, 600);
    }
  } catch { /* ignore */ }
}
