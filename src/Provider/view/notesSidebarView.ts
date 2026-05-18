/* eslint-disable curly */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

type NotesTreeKind = 'outline' | 'dailyPlan' | 'note';

interface NotesTreeConfig {
    viewId: string;
    label: string;
    kind: NotesTreeKind;
    resolveRootPath: () => string | undefined;
    ensureRoot: boolean;
}

class NotesItem extends vscode.TreeItem {
    constructor(
        public readonly viewId: string,
        public readonly fullPath: string,
        public readonly isDirectory: boolean,
        public readonly isVirtualInfo = false,
    ) {
        super(
            isVirtualInfo ? fullPath : path.basename(fullPath),
            isVirtualInfo
                ? vscode.TreeItemCollapsibleState.None
                : (isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None),
        );

        if (isVirtualInfo) {
            this.contextValue = 'andreaNotesInfo';
            this.iconPath = new vscode.ThemeIcon('info');
            return;
        }

        this.resourceUri = vscode.Uri.file(fullPath);
        this.contextValue = isDirectory ? 'andreaNotesFolder' : 'andreaNotesFile';
        this.iconPath = isDirectory ? vscode.ThemeIcon.Folder : vscode.ThemeIcon.File;
        this.tooltip = fullPath;

        if (!isDirectory) {
            this.command = {
                command: 'andrea.notes.open',
                title: '打开笔记文件',
                arguments: [this],
            };
        }
    }
}

class NotesTreeProvider implements vscode.TreeDataProvider<NotesItem> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<NotesItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private readonly config: NotesTreeConfig) {}

    refresh() {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: NotesItem): vscode.TreeItem {
        return element;
    }

    getRootPath(): string | undefined {
        const rootPath = this.config.resolveRootPath();
        if (!rootPath) return undefined;

        if (!this.config.ensureRoot) return rootPath;
        try {
            if (!fs.existsSync(rootPath)) fs.mkdirSync(rootPath, { recursive: true });
            return rootPath;
        } catch {
            return rootPath;
        }
    }

    async getChildren(element?: NotesItem): Promise<NotesItem[]> {
        const rootPath = this.getRootPath();
        if (!rootPath) {
            return [new NotesItem(this.config.viewId, '未打开工作区', false, true)];
        }

        const targetDir = element ? element.fullPath : rootPath;
        if (!fs.existsSync(targetDir)) {
            return [new NotesItem(this.config.viewId, '目录不存在', false, true)];
        }

        let entries: fs.Dirent[] = [];
        try {
            entries = fs.readdirSync(targetDir, { withFileTypes: true });
        } catch {
            return [];
        }

        const sorted = entries.sort((a, b) => {
            if (a.isDirectory() && !b.isDirectory()) return -1;
            if (!a.isDirectory() && b.isDirectory()) return 1;
            return a.name.localeCompare(b.name, 'zh-CN');
        });

        const items: NotesItem[] = [];
        for (const entry of sorted) {
            const fullPath = path.join(targetDir, entry.name);
            if (entry.isDirectory()) {
                items.push(new NotesItem(this.config.viewId, fullPath, true));
                continue;
            }
            if (!entry.isFile()) continue;
            if (path.extname(entry.name).toLowerCase() !== '.md') continue;
            items.push(new NotesItem(this.config.viewId, fullPath, false));
        }

        return items;
    }
}

function getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function ensureMdName(name: string): string {
    const trimmed = name.trim();
    const safe = path.basename(trimmed).replace(/[<>:"/\\|?*\x00-\x1F]/g, '-');
    if (!safe) return '未命名.md';
    return safe.toLowerCase().endsWith('.md') ? safe : `${safe}.md`;
}

async function askNewFileName(placeHolder: string): Promise<string | undefined> {
    const fileName = await vscode.window.showInputBox({
        prompt: '输入 Markdown 文件名',
        placeHolder,
        validateInput: value => value.trim() ? null : '文件名不能为空',
    });
    if (!fileName) return undefined;
    return ensureMdName(fileName);
}

async function askNewFolderName(placeHolder: string): Promise<string | undefined> {
    const folderName = await vscode.window.showInputBox({
        prompt: '输入文件夹名称',
        placeHolder,
        validateInput: value => value.trim() ? null : '文件夹名不能为空',
    });
    if (!folderName) return undefined;
    return path.basename(folderName.trim()).replace(/[<>:"/\\|?*\x00-\x1F]/g, '-');
}

function getPathForCreate(provider: NotesTreeProvider, item?: NotesItem): string | undefined {
    const root = provider.getRootPath();
    if (!root) return undefined;
    if (!item) return root;
    return item.isDirectory ? item.fullPath : path.dirname(item.fullPath);
}

async function createMarkdownInProvider(provider: NotesTreeProvider, defaultName: string, item?: NotesItem): Promise<void> {
    const targetDir = getPathForCreate(provider, item);
    if (!targetDir) {
        vscode.window.showErrorMessage('当前没有可用工作区目录。');
        return;
    }

    const fileName = await askNewFileName(defaultName);
    if (!fileName) return;

    const filePath = path.join(targetDir, fileName);
    if (fs.existsSync(filePath)) {
        vscode.window.showWarningMessage(`文件已存在：${fileName}`);
        return;
    }

    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(filePath, `# ${path.basename(fileName, '.md')}\n\n`, 'utf8');
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Active);
    provider.refresh();
}

async function createFolderInProvider(provider: NotesTreeProvider, defaultName: string, item?: NotesItem): Promise<void> {
    const targetDir = getPathForCreate(provider, item);
    if (!targetDir) {
        vscode.window.showErrorMessage('当前没有可用工作区目录。');
        return;
    }

    const folderName = await askNewFolderName(defaultName);
    if (!folderName) return;

    const dirPath = path.join(targetDir, folderName);
    if (fs.existsSync(dirPath)) {
        vscode.window.showWarningMessage(`文件夹已存在：${folderName}`);
        return;
    }

    fs.mkdirSync(dirPath, { recursive: true });
    provider.refresh();
}

export function registerNotesSidebarViews(context: vscode.ExtensionContext): void {
    const outlineProvider = new NotesTreeProvider({
        viewId: 'andrea.notesOutlineTree',
        label: '大纲',
        kind: 'outline',
        resolveRootPath: () => {
            const ws = getWorkspaceRoot();
            if (!ws) return undefined;
            const rel = vscode.workspace.getConfiguration('AndreaNovelHelper').get<string>('outlinePath', 'novel-helper/outline') || 'novel-helper/outline';
            return path.join(ws, rel);
        },
        ensureRoot: true,
    });

    const dailyPlanProvider = new NotesTreeProvider({
        viewId: 'andrea.notesDailyPlanTree',
        label: '每日计划',
        kind: 'dailyPlan',
        resolveRootPath: () => {
            const ws = getWorkspaceRoot();
            if (!ws) return undefined;
            return path.join(ws, 'novel-helper', 'dashboard', 'plan');
        },
        ensureRoot: true,
    });

    const customNotesProvider = new NotesTreeProvider({
        viewId: 'andrea.notesCustomTree',
        label: '笔记',
        kind: 'note',
        resolveRootPath: () => {
            const ws = getWorkspaceRoot();
            if (!ws) return undefined;
            return path.join(ws, 'novel-helper', 'notes');
        },
        ensureRoot: true,
    });

    const providers = new Map<string, NotesTreeProvider>([
        ['andrea.notesOutlineTree', outlineProvider],
        ['andrea.notesDailyPlanTree', dailyPlanProvider],
        ['andrea.notesCustomTree', customNotesProvider],
    ]);

    const buildWatcher = (provider: NotesTreeProvider): vscode.FileSystemWatcher | undefined => {
        const rootPath = provider.getRootPath();
        if (!rootPath || !fs.existsSync(rootPath)) return undefined;

        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(rootPath, '**/*'));
        const refresh = () => provider.refresh();
        watcher.onDidCreate(refresh);
        watcher.onDidChange(refresh);
        watcher.onDidDelete(refresh);
        return watcher;
    };

    let outlineWatcher = buildWatcher(outlineProvider);
    const dailyPlanWatcher = buildWatcher(dailyPlanProvider);
    const customNotesWatcher = buildWatcher(customNotesProvider);

    const views = [
        vscode.window.createTreeView('andrea.notesOutlineTree', { treeDataProvider: outlineProvider, showCollapseAll: true }),
        vscode.window.createTreeView('andrea.notesDailyPlanTree', { treeDataProvider: dailyPlanProvider, showCollapseAll: true }),
        vscode.window.createTreeView('andrea.notesCustomTree', { treeDataProvider: customNotesProvider, showCollapseAll: true }),
    ];

    const getProviderByViewId = (viewId: string): NotesTreeProvider | undefined => providers.get(viewId);

    context.subscriptions.push(
        ...views,
        ...(outlineWatcher ? [outlineWatcher] : []),
        ...(dailyPlanWatcher ? [dailyPlanWatcher] : []),
        ...(customNotesWatcher ? [customNotesWatcher] : []),
        vscode.commands.registerCommand('andrea.notes.refreshOutlineTree', () => outlineProvider.refresh()),
        vscode.commands.registerCommand('andrea.notes.refreshDailyPlanTree', () => dailyPlanProvider.refresh()),
        vscode.commands.registerCommand('andrea.notes.refreshCustomTree', () => customNotesProvider.refresh()),

        vscode.commands.registerCommand('andrea.notes.createOutlineNote', async (item?: NotesItem) => {
            await createMarkdownInProvider(outlineProvider, '新大纲.md', item);
        }),
        vscode.commands.registerCommand('andrea.notes.createDailyPlan', async (item?: NotesItem) => {
            await createMarkdownInProvider(dailyPlanProvider, '每日计划.md', item);
        }),
        vscode.commands.registerCommand('andrea.notes.createCustomNote', async (item?: NotesItem) => {
            await createMarkdownInProvider(customNotesProvider, '笔记.md', item);
        }),

        vscode.commands.registerCommand('andrea.notes.createOutlineFolder', async (item?: NotesItem) => {
            await createFolderInProvider(outlineProvider, '新文件夹', item);
        }),
        vscode.commands.registerCommand('andrea.notes.createDailyPlanFolder', async (item?: NotesItem) => {
            await createFolderInProvider(dailyPlanProvider, '新文件夹', item);
        }),
        vscode.commands.registerCommand('andrea.notes.createCustomFolder', async (item?: NotesItem) => {
            await createFolderInProvider(customNotesProvider, '新文件夹', item);
        }),

        vscode.commands.registerCommand('andrea.notes.createInFolder', async (item?: NotesItem) => {
            if (!item) return;
            const provider = getProviderByViewId(item.viewId);
            if (!provider) return;
            await createMarkdownInProvider(provider, '新建文件.md', item);
        }),
        vscode.commands.registerCommand('andrea.notes.createFolderInFolder', async (item?: NotesItem) => {
            if (!item) return;
            const provider = getProviderByViewId(item.viewId);
            if (!provider) return;
            await createFolderInProvider(provider, '新文件夹', item);
        }),

        vscode.commands.registerCommand('andrea.notes.open', async (item?: NotesItem) => {
            if (!item || item.isVirtualInfo || item.isDirectory) return;
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(item.fullPath));
            await vscode.window.showTextDocument(doc, vscode.ViewColumn.Active);
        }),
        vscode.commands.registerCommand('andrea.notes.revealInExplorer', async (item?: NotesItem) => {
            if (!item || item.isVirtualInfo) return;
            await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(item.fullPath));
        }),
        vscode.commands.registerCommand('andrea.notes.rename', async (item?: NotesItem) => {
            if (!item || item.isVirtualInfo) return;
            const oldName = path.basename(item.fullPath);
            const input = await vscode.window.showInputBox({
                prompt: '输入新名称',
                value: oldName,
                validateInput: value => value.trim() ? null : '名称不能为空',
            });
            if (!input || input === oldName) return;

            const parent = path.dirname(item.fullPath);
            const targetName = item.isDirectory ? path.basename(input.trim()) : ensureMdName(input);
            const nextPath = path.join(parent, targetName);
            if (fs.existsSync(nextPath)) {
                vscode.window.showWarningMessage(`目标已存在：${targetName}`);
                return;
            }
            fs.renameSync(item.fullPath, nextPath);
            getProviderByViewId(item.viewId)?.refresh();
        }),
        vscode.commands.registerCommand('andrea.notes.delete', async (item?: NotesItem) => {
            if (!item || item.isVirtualInfo) return;
            const pick = await vscode.window.showWarningMessage(
                `确认删除：${path.basename(item.fullPath)}？`,
                { modal: true },
                '删除'
            );
            if (pick !== '删除') return;

            if (!fs.existsSync(item.fullPath)) return;
            if (item.isDirectory) {
                fs.rmSync(item.fullPath, { recursive: true, force: true });
            } else {
                fs.unlinkSync(item.fullPath);
            }
            getProviderByViewId(item.viewId)?.refresh();
        }),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('AndreaNovelHelper.outlinePath')) {
                outlineProvider.refresh();
                if (outlineWatcher) outlineWatcher.dispose();
                outlineWatcher = buildWatcher(outlineProvider);
                if (outlineWatcher) context.subscriptions.push(outlineWatcher);
            }
        }),
    );
}
