import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { PROJECT_KEYWORD_CONFIG_JSON5_FILE_NAME } from '../projectConfig/projectKeywordConfig';
import {
  CHARACTER_FILE_KEYWORDS,
  REGEX_FILE_KEYWORDS,
  SENSITIVE_FILE_KEYWORDS,
  VOCABULARY_FILE_KEYWORDS,
} from '../projectConfig/resourceFileNaming';

const AUTO_OPEN_PROJECT_INIT_KEY = 'andrea.projectInit.autoOpenAfterCreate';

/** 检测当前工作区是否完全缺少任何描述文件，缺少则提示运行初始化向导 */
// 标记是否已经计划弹出项目初始化向导（用于避免与其他初始化提示冲突）
export let projectInitPromptScheduled = false;

export interface ProjectInitStatus {
  hasWorkspace: boolean;
  workspaceRoot?: string;
  configExists: boolean;
  keywordConfigExists: boolean;
  novelHelperExists: boolean;
  anyConfiguredExists: boolean;
  anyPackageResourceExists: boolean;
  initialized: boolean;
  missing: string[];
}

function hasAnyResourceFilesUnder(root: string): boolean {
  if (!fs.existsSync(root)) { return false; }
  const roleFileNameKeywords = Array.from(new Set([
    ...CHARACTER_FILE_KEYWORDS,
    ...SENSITIVE_FILE_KEYWORDS,
    ...VOCABULARY_FILE_KEYWORDS,
    ...REGEX_FILE_KEYWORDS,
  ])).map(item => item.toLowerCase());
  const validExts = ['.json5','.txt','.md', '.csv', '.toml'];
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

export function getProjectInitStatus(workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath): ProjectInitStatus {
  if (!workspaceRoot) {
    return {
      hasWorkspace: false,
      configExists: false,
      keywordConfigExists: false,
      novelHelperExists: false,
      anyConfiguredExists: false,
      anyPackageResourceExists: false,
      initialized: false,
      missing: ['workspace'],
    };
  }

  const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper', vscode.Uri.file(workspaceRoot));
  const nhDir = path.join(workspaceRoot, 'novel-helper');
  const configuredFiles = [
    cfg.get<string>('rolesFile'),
    cfg.get<string>('sensitiveWordsFile'),
    cfg.get<string>('vocabularyFile'),
    cfg.get<string>('regexPatternsFile')
  ].filter(Boolean).map(p => path.isAbsolute(p!) ? p! : path.join(workspaceRoot, p!));
  const configExists = fs.existsSync(path.join(workspaceRoot, 'anhproject.md'));
  const keywordConfigExists = fs.existsSync(path.join(workspaceRoot, PROJECT_KEYWORD_CONFIG_JSON5_FILE_NAME));
  const novelHelperExists = fs.existsSync(nhDir);
  const anyConfiguredExists = configuredFiles.some(p => fs.existsSync(p));
  const anyPackageResourceExists = hasAnyResourceFilesUnder(nhDir);
  const missing: string[] = [];
  if (!configExists) { missing.push('anhproject.md'); }
  if (!keywordConfigExists) { missing.push(PROJECT_KEYWORD_CONFIG_JSON5_FILE_NAME); }
  if (!anyConfiguredExists && !anyPackageResourceExists) { missing.push('resourceFiles'); }

  return {
    hasWorkspace: true,
    workspaceRoot,
    configExists,
    keywordConfigExists,
    novelHelperExists,
    anyConfiguredExists,
    anyPackageResourceExists,
    initialized: missing.length === 0,
    missing,
  };
}

export async function maybePromptProjectInit(context?: vscode.ExtensionContext) {
  try {
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!wsRoot) { return; }
    const status = getProjectInitStatus(wsRoot);
    if (!status.configExists && !status.keywordConfigExists && !status.anyConfiguredExists && !status.anyPackageResourceExists) {
      // 检查是否是从 hello 页面新建的工作区，需要自动打开初始化向导（不询问）
      if (context) {
        const autoOpenPath = context.globalState.get<string>(AUTO_OPEN_PROJECT_INIT_KEY);
        if (autoOpenPath && path.resolve(autoOpenPath) === path.resolve(wsRoot)) {
          await context.globalState.update(AUTO_OPEN_PROJECT_INIT_KEY, undefined);
          projectInitPromptScheduled = true; // 抑制其他初始化提示（如缺失角色库弹窗）
          setTimeout(() => {
            vscode.commands.executeCommand('AndreaNovelHelper.projectInitWizard.graphical');
          }, 600);
          return;
        }
      }
      projectInitPromptScheduled = true;
      setTimeout(() => {
        vscode.window.showInformationMessage('未检测到角色/词汇/敏感词等描述文件，是否运行项目初始化向导？', '运行向导', '忽略').then(sel => {
          projectInitPromptScheduled = false; // 用户已处理（无论选择哪个）
          if (sel === '运行向导') {
            vscode.commands.executeCommand('AndreaNovelHelper.projectInitWizard.graphical');
          }
        }, () => { projectInitPromptScheduled = false; });
      }, 600);
    }
  } catch { /* ignore */ }
}
