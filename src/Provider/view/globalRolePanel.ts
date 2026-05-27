import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { buildHtml } from '../utils/html-builder';
import { setWebviewPanelIcon } from '../utils/webviewPanelIcon';
import { roles, onDidChangeRoles } from '../../activate';
import type { Role } from '../../extension';

// ========== 类型定义 ==========
type GlobalRolePanelMessage =
  | { command: 'globalRolePanel.ready' }
  | { command: 'globalRolePanel.openSource'; sourcePath: string }
  | { command: 'globalRolePanel.requestRaw'; sourcePath: string }
  | { command: 'globalRolePanel.closeRaw' }
  | { command: 'globalRolePanel.saveRaw'; sourcePath: string; content: string };

const ROLE_EDITOR_LOCALIZED_KEY_LABELS = 'roleEditor.localizedKeyLabels';

interface RoleSnapshot {
  name: string;
  type: string;
  uuid?: string;
  affiliation?: string;
  aliases?: string[];
  description?: string;
  color?: string;
  wordSegmentFilter?: boolean;
  packagePath?: string;
  sourcePath?: string;
  regex?: string;
  regexFlags?: string;
  priority?: number;
  fixes?: string[];
  avatar?: string;
  illustrations?: string[];
  [key: string]: unknown;
}

/**
 * 将路径转为 webview URI。
 * - 如果是 http(s):// 开头，原样返回
 * - 如果是相对路径，基于角色 sourcePath 所在目录解析为绝对路径后再转换
 * - 如果是绝对本地路径，直接转换
 * - 转换失败则返回 undefined
 */
function resolveImageUri(rawPath: string | undefined, webview: vscode.Webview, roleDir: string): string | undefined {
  if (!rawPath) { return undefined; }
  const normalizedPath = rawPath.trim().replace(/^<(.+)>$/, '$1');
  if (/^(https?:|data:|blob:|vscode-webview:|vscode-resource:)/i.test(normalizedPath)) { return normalizedPath; }

  try {
    let fileUri: vscode.Uri;
    if (/^file:/i.test(normalizedPath)) {
      fileUri = vscode.Uri.parse(normalizedPath);
    } else {
      let absPath = normalizedPath;
      if (!path.isAbsolute(normalizedPath)) {
        absPath = path.resolve(roleDir, normalizedPath);
      }
      fileUri = vscode.Uri.file(absPath);
    }
    if (fs.existsSync(fileUri.fsPath)) {
      return webview.asWebviewUri(fileUri).toString();
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function getRoleEditorSettings() {
  return {
    localizedKeyLabels: vscode.workspace
      .getConfiguration('AndreaNovelHelper')
      .get<boolean>(ROLE_EDITOR_LOCALIZED_KEY_LABELS, true),
    displayLanguage: vscode.env.language || 'en',
  };
}

function splitMarkdownImageDestination(raw: string): { target: string; suffix: string } {
  const value = raw.trim();
  if (value.startsWith('<')) {
    const end = value.indexOf('>');
    if (end > 0) {
      return {
        target: value.slice(1, end),
        suffix: value.slice(end + 1),
      };
    }
  }

  const titleMatch = value.match(/^(.+?)(\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))\s*$/);
  if (titleMatch) {
    return { target: titleMatch[1].trim(), suffix: titleMatch[2] };
  }
  return { target: value, suffix: '' };
}

/**
 * 扫描 Markdown 文本中的图片引用 ![alt](url)，将本地 url 转为 webview URI。
 * 使用更宽松的正则：URL 部分用 .+? 而非 [^)]+，以兼容各种字符。
 */
function resolveMdImageUrls(mdText: string, webview: vscode.Webview, roleDir: string): string {
  // 先检查是否有需要处理的文本
  if (!mdText || mdText.indexOf('![') === -1) { return mdText; }

  return mdText.replace(/!\[([^\]]*)\]\((.+?)\)/g, (_match, alt: string, url: string) => {
    const { target, suffix } = splitMarkdownImageDestination(url);
    const resolved = resolveImageUri(target, webview, roleDir);
    if (resolved) {
      return `![${alt}](${resolved}${suffix})`;
    }
    // 本地文件不存在时保留原样（可能是网络图片）
    return _match;
  });
}

function roleToSnapshot(role: Role, webview?: vscode.Webview): RoleSnapshot {
  const snapshot: RoleSnapshot = {
    name: role.name,
    type: role.type,
  };
  if (role.uuid) { snapshot.uuid = role.uuid; }
  if (role.affiliation) { snapshot.affiliation = role.affiliation; }
  if (role.aliases?.length) { snapshot.aliases = [...role.aliases]; }
  if (role.description) { snapshot.description = role.description; }
  if (role.color) { snapshot.color = role.color; }
  if (role.wordSegmentFilter) { snapshot.wordSegmentFilter = role.wordSegmentFilter; }
  if (role.packagePath) { snapshot.packagePath = role.packagePath; }
  if (role.sourcePath) { snapshot.sourcePath = role.sourcePath; }
  if (role.regex) { snapshot.regex = role.regex; }
  if (role.regexFlags) { snapshot.regexFlags = role.regexFlags; }
  if (role.priority !== undefined) { snapshot.priority = role.priority; }
  if (role.fixes?.length) { snapshot.fixes = [...role.fixes]; }

  // 头像 & 设定图：需要 webview 才能转换本地路径为 webview URI
  const roleDir = role.sourcePath ? path.dirname(role.sourcePath) : '';
  if (role.avatar && webview) {
    snapshot.avatar = resolveImageUri(role.avatar, webview, roleDir);
  } else if (role.avatar) {
    snapshot.avatar = role.avatar;
  }
  if (role.illustrations?.length && webview) {
    const resolved = role.illustrations
      .map((p) => resolveImageUri(p, webview, roleDir))
      .filter(Boolean) as string[];
    if (resolved.length) { snapshot.illustrations = resolved; }
  } else if (role.illustrations?.length) {
    snapshot.illustrations = [...role.illustrations];
  }

  // Markdown 文本字段：将本地图片路径转为 webview URI
  if (role.description && webview) {
    snapshot.description = resolveMdImageUrls(role.description, webview, roleDir);
  }

  // 复制自定义字段，对字符串值也做 MD 图片转换
  for (const [key, value] of Object.entries(role)) {
    if (!(key in snapshot) && typeof value !== 'function' && value !== undefined) {
      try {
        JSON.stringify(value);
        if (typeof value === 'string' && webview) {
          snapshot[key] = resolveMdImageUrls(value, webview, roleDir);
        } else {
          snapshot[key] = value;
        }
      } catch { /* skip non-serializable */ }
    }
  }
  return snapshot;
}

function computeRoleDiff(
  oldRoles: RoleSnapshot[],
  newRoles: Role[],
  webview?: vscode.Webview
): { added: RoleSnapshot[]; removed: { uuid?: string; name: string }[]; modified: RoleSnapshot[] } {
  const oldMap = new Map(oldRoles.map((r) => [r.name, r]));
  const newMap = new Map<string, RoleSnapshot>();

  const added: RoleSnapshot[] = [];
  const modified: RoleSnapshot[] = [];

  for (const role of newRoles) {
    const snap = roleToSnapshot(role, webview);
    newMap.set(role.name, snap);
    const old = oldMap.get(role.name);
    if (!old) {
      added.push(snap);
    } else if (JSON.stringify(old) !== JSON.stringify(snap)) {
      modified.push(snap);
    }
  }

  const removed: { uuid?: string; name: string }[] = [];
  for (const [name, old] of oldMap) {
    if (!newMap.has(name)) {
      removed.push({ uuid: old.uuid, name });
    }
  }

  return { added, removed, modified };
}

// ========== 提供器 ==========
export class GlobalRolePanelProvider {
  private static instance: GlobalRolePanelProvider | undefined;
  private panel: vscode.WebviewPanel | undefined;
  private previousSnapshots: RoleSnapshot[] = [];
  private disposables: vscode.Disposable[] = [];
  private rawSourceWatcher: vscode.FileSystemWatcher | undefined;
  private watchedRawSourcePath: string | undefined;
  private readonly rawSourceMuteUntil = new Map<string, number>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  public static getInstance(context: vscode.ExtensionContext): GlobalRolePanelProvider {
    if (!GlobalRolePanelProvider.instance) {
      GlobalRolePanelProvider.instance = new GlobalRolePanelProvider(context);
    }
    return GlobalRolePanelProvider.instance;
  }

  public show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      return;
    }
    this.panel = this.createPanel();
  }

  private createPanel(): vscode.WebviewPanel {
    // 收集所有工作区根目录作为 localResourceRoots，以便加载本地角色图片
    const workspaceRoots = (vscode.workspace.workspaceFolders || []).map(f => f.uri);
    const localResourceRoots = [
      vscode.Uri.joinPath(this.context.extensionUri, 'packages', 'webview', 'dist', 'spa'),
      vscode.Uri.joinPath(this.context.extensionUri, 'media'),
      ...workspaceRoots,
    ];

    const panel = vscode.window.createWebviewPanel(
      'andrea.globalRolePanel',
      '全局角色面板',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots,
      }
    );

    setWebviewPanelIcon(panel, this.context.extensionPath, 'heatmap');
    this.setupPanel(panel);
    return panel;
  }

  public setupPanel(panel: vscode.WebviewPanel): void {
    this.panel = panel;
    this.previousSnapshots = [];

    // 构建 resourceMapperScriptUri
    let resourceMapperScriptUri: string | undefined;
    try {
      const mapperFile = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'resource-mapper.js');
      resourceMapperScriptUri = panel.webview.asWebviewUri(mapperFile).toString();
    } catch { /* ignore */ }

    panel.webview.html = buildHtml(panel.webview, {
      spaRoot: vscode.Uri.joinPath(this.context.extensionUri, 'packages', 'webview', 'dist', 'spa'),
      connectSrc: ['https:', 'http:', 'ws:', 'wss:'],
      resourceMapperScriptUri,
      route: '/global-role-panel',
      editorTitle: '全局角色面板',
    });

    // 监听来自 webview 的消息
    panel.webview.onDidReceiveMessage(
      async (message: GlobalRolePanelMessage) => {
        switch (message.command) {
          case 'globalRolePanel.ready': {
            await this.sendAllRoles();
            break;
          }
          case 'globalRolePanel.openSource': {
            await this.openSourceFile(message.sourcePath);
            break;
          }
          case 'globalRolePanel.requestRaw': {
            await this.sendRawSource(message.sourcePath);
            break;
          }
          case 'globalRolePanel.closeRaw': {
            this.disposeRawSourceWatcher();
            break;
          }
          case 'globalRolePanel.saveRaw': {
            await this.saveRawSource(message.sourcePath, message.content);
            break;
          }
        }
      },
      undefined,
      this.disposables
    );

    panel.onDidDispose(() => {
      if (this.panel === panel) {
        this.panel = undefined;
        this.previousSnapshots = [];
      }
      this.disposeRawSourceWatcher();
    }, null, this.disposables);
  }

  private get webview(): vscode.Webview | undefined {
    return this.panel?.webview;
  }

  private async openSourceFile(sourcePath: string): Promise<void> {
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      vscode.window.showWarningMessage(`找不到源文件: ${sourcePath || '(空)'}`);
      return;
    }
    const uri = vscode.Uri.file(sourcePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Active);
  }

  private async sendRawSource(sourcePath: string): Promise<void> {
    if (!this.panel) { return; }
    try {
      const normalizedPath = this.normalizeSourcePath(sourcePath);
      this.ensureRawSourceWatcher(normalizedPath);
      const content = await this.readRawSource(normalizedPath);
      await this.panel.webview.postMessage({
        command: 'globalRolePanel.rawData',
        sourcePath: normalizedPath,
        content,
      });
    } catch (error) {
      await this.postRawError(sourcePath, error);
    }
  }

  private async saveRawSource(sourcePath: string, content: string): Promise<void> {
    if (!this.panel) { return; }
    try {
      const normalizedPath = this.normalizeSourcePath(sourcePath);
      if (!normalizedPath || !fs.existsSync(normalizedPath)) {
        throw new Error(`找不到源文件: ${sourcePath || '(空)'}`);
      }
      this.ensureRawSourceWatcher(normalizedPath);
      this.rawSourceMuteUntil.set(normalizedPath, Date.now() + 1500);
      const uri = vscode.Uri.file(normalizedPath);
      const document = await vscode.workspace.openTextDocument(uri);
      const currentText = document.getText();
      if (currentText !== content) {
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(currentText.length));
        edit.replace(uri, fullRange, content);
        const ok = await vscode.workspace.applyEdit(edit);
        if (!ok) {
          throw new Error('无法写入原始数据到源文件');
        }
      }
      const updatedDocument = await vscode.workspace.openTextDocument(uri);
      const saved = await updatedDocument.save();
      if (!saved) {
        throw new Error('源文件保存失败');
      }
      await this.panel.webview.postMessage({
        command: 'globalRolePanel.rawSaved',
        sourcePath: normalizedPath,
      });
    } catch (error) {
      await this.postRawError(sourcePath, error);
    }
  }

  private async readRawSource(sourcePath: string): Promise<string> {
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      throw new Error(`找不到源文件: ${sourcePath || '(空)'}`);
    }
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(sourcePath));
    return document.getText();
  }

  private normalizeSourcePath(sourcePath: string): string {
    return path.resolve(sourcePath);
  }

  private ensureRawSourceWatcher(sourcePath: string): void {
    if (!sourcePath) {
      this.disposeRawSourceWatcher();
      return;
    }
    if (this.watchedRawSourcePath === sourcePath && this.rawSourceWatcher) {
      return;
    }

    this.disposeRawSourceWatcher();
    this.watchedRawSourcePath = sourcePath;

    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(path.dirname(sourcePath), path.basename(sourcePath)),
      false,
      false,
      false,
    );
    const onSourceChanged = () => {
      void this.handleWatchedRawSourceChange(sourcePath);
    };

    watcher.onDidChange(onSourceChanged);
    watcher.onDidCreate(onSourceChanged);
    watcher.onDidDelete(() => {
      void this.postRawError(sourcePath, new Error(`找不到源文件: ${sourcePath}`));
    });

    this.rawSourceWatcher = watcher;
  }

  private disposeRawSourceWatcher(): void {
    this.rawSourceWatcher?.dispose();
    this.rawSourceWatcher = undefined;
    this.watchedRawSourcePath = undefined;
  }

  private async handleWatchedRawSourceChange(sourcePath: string): Promise<void> {
    if (!this.panel || this.watchedRawSourcePath !== sourcePath) {
      return;
    }
    const muteUntil = this.rawSourceMuteUntil.get(sourcePath) ?? 0;
    if (muteUntil > Date.now()) {
      return;
    }
    this.rawSourceMuteUntil.delete(sourcePath);

    try {
      const content = await this.readRawSource(sourcePath);
      await this.panel.webview.postMessage({
        command: 'globalRolePanel.rawExternalUpdate',
        sourcePath,
        content,
      });
    } catch (error) {
      await this.postRawError(sourcePath, error);
    }
  }

  private async postRawError(sourcePath: string, error: unknown): Promise<void> {
    if (!this.panel) { return; }
    const message = error instanceof Error ? error.message : String(error);
    await this.panel.webview.postMessage({
      command: 'globalRolePanel.rawError',
      sourcePath,
      error: message,
    });
  }

  private async sendAllRoles(): Promise<void> {
    if (!this.panel) { return; }
    try {
      const wv = this.panel.webview;
      const allRoles = roles.map((r) => roleToSnapshot(r, wv));
      this.previousSnapshots = allRoles.map((r) => ({ ...r }));
      await wv.postMessage({
        command: 'globalRolePanel.data',
        allRoles,
        roleEditorSettings: getRoleEditorSettings(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.panel.webview.postMessage({
        command: 'globalRolePanel.error',
        error: message,
      });
    }
  }

  public notifyRolesChanged(): void {
    if (!this.panel) { return; }
    const wv = this.panel.webview;
    const diff = computeRoleDiff(this.previousSnapshots, roles, wv);
    this.previousSnapshots = roles.map((r) => roleToSnapshot(r, wv));

    if (diff.added.length === 0 && diff.removed.length === 0 && diff.modified.length === 0) {
      return;
    }

    void wv.postMessage({
      command: 'globalRolePanel.sync',
      added: diff.added,
      removed: diff.removed,
      modified: diff.modified,
    });
  }

  public dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}

// ========== 注册函数 ==========
export function registerGlobalRolePanel(context: vscode.ExtensionContext): vscode.Disposable {
  const provider = GlobalRolePanelProvider.getInstance(context);

  const openCommand = vscode.commands.registerCommand('andrea.openGlobalRolePanel', () => {
    provider.show();
  });

  // 监听角色变更，发送 diff
  const rolesListener = onDidChangeRoles(() => {
    provider.notifyRolesChanged();
  });

  // 注册 WebviewPanelSerializer，使面板在 VS Code 重启后恢复
  let serializerDisposable: vscode.Disposable | undefined;
  if (vscode.window.registerWebviewPanelSerializer) {
    serializerDisposable = vscode.window.registerWebviewPanelSerializer('andrea.globalRolePanel', {
      async deserializeWebviewPanel(panel: vscode.WebviewPanel, _state: unknown) {
        provider.setupPanel(panel);
      },
    });
  }

  const combined = vscode.Disposable.from(
    openCommand,
    rolesListener,
    ...(serializerDisposable ? [serializerDisposable] : []),
  );
  context.subscriptions.push(combined);
  return combined;
}
