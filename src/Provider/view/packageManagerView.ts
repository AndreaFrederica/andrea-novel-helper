/* eslint-disable curly */
// src/packageManagerView.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { generateCharacterGalleryJson5, generateSensitiveWordsJson5, generateVocabularyJson5, generateRegexPatternsTemplate, generateMarkdownRoleTemplate, generateMarkdownSensitiveTemplate, generateMarkdownVocabularyTemplate } from '../../templates/templateGenerators';
import { statSync } from 'fs';
import { loadRoles } from '../../utils/utils';
import { generateUUIDv7 } from '../../utils/uuidUtils';
import { updateDecorations } from '../../events/updateDecorations';
import { registerFileChangeCallback, unregisterFileChangeCallback, FileChangeEvent } from '../../utils/tracker/globalFileTracking';
import { generateCustomFileName, generateDefaultFileName } from '../../utils/Parser/markdownParser';
import { globalRelationshipManager } from '../../utils/globalRelationshipManager';

// 解析文件名冲突：如果同名存在，则追加 _YYYYMMDD_HHmmss 或递增索引
function resolveFileConflict(dir: string, baseName: string, ext: string): { path: string; conflicted: boolean; } {
    let target = path.join(dir, baseName + ext);
    if (!fs.existsSync(target)) return { path: target, conflicted: false };
    const timestamp = new Date();
    const pad = (n:number)=> n.toString().padStart(2,'0');
    const ts = `${timestamp.getFullYear()}${pad(timestamp.getMonth()+1)}${pad(timestamp.getDate())}_${pad(timestamp.getHours())}${pad(timestamp.getMinutes())}${pad(timestamp.getSeconds())}`;
    let withTs = path.join(dir, `${baseName}_${ts}${ext}`);
    if (!fs.existsSync(withTs)) return { path: withTs, conflicted: true };
    // 如果时间戳也冲突（极少），再加序号
    let idx = 1;
    while (true) {
        const candidate = path.join(dir, `${baseName}_${ts}_${idx}${ext}`);
        if (!fs.existsSync(candidate)) return { path: candidate, conflicted: true };
        idx++;
    }
}

// 引用维护节点
class ReferenceMaintenanceNode extends vscode.TreeItem {
    constructor(public readonly workspaceRoot: string) {
        super('引用维护和热力图', vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'referenceMaintenance';
        this.iconPath = new vscode.ThemeIcon('tools');
        this.command = {
            command: 'AndreaNovelHelper.showReferenceMaintenance',
            title: '打开引用维护和热力图面板',
            arguments: []
        };
    }
}

class NewFileNode extends vscode.TreeItem {
    public readonly resourceUri: vscode.Uri;
    
    /**
     * @param baseDir 完整的 novel-helper 根目录路径
     */
    constructor(public readonly baseDir: string) {
        // 让 TreeItem 也有 resourceUri，指向根目录
        super(vscode.Uri.file(baseDir), vscode.TreeItemCollapsibleState.None);

        this.resourceUri = vscode.Uri.file(baseDir);
        this.contextValue = 'newFile';
        // 把 resourceUri 传给命令，就能在命令里直接用 node.resourceUri.fsPath
        this.command = {
            command: 'AndreaNovelHelper.createNewFile',
            title: '创建新文件',
            arguments: [this],
        };
        // 覆盖一下 label
        this.label = '书籍根目录';
    }
}
/**
 * Represents a package (folder) or resource file under novel-helper
 */
export class PackageNode extends vscode.TreeItem {
    constructor(
        public readonly resourceUri: vscode.Uri,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(resourceUri, collapsibleState);
        this.id = resourceUri.fsPath;
        const isDir = fs.statSync(resourceUri.fsPath).isDirectory();
        this.contextValue = isDir ? 'package' : 'resourceFile';
        this.label = path.basename(resourceUri.fsPath);

        // click to open files if not a directory
        if (!isDir) {
            // 文件节点点击时使用决策命令（会根据全局或每文件偏好决定用角色卡管理器还是文本编辑器）
            this.command = {
                command: 'AndreaNovelHelper.openFile',
                title: 'Open File',
                arguments: [this.resourceUri]
            };
        }
    }
}

/**
 * TreeDataProvider for novel-helper packages
 */
export class PackageManagerProvider implements vscode.TreeDataProvider<PackageNode> {
    private _onDidChange = new vscode.EventEmitter<PackageNode | void>();
    readonly onDidChangeTreeData = this._onDidChange.event;
    
    // 保存展开状态的键值对
    private expandedNodes = new Set<string>();
    private memento: vscode.Memento;

    // 剪贴板（复制/剪切临时存放路径）
    private copyClipboard: string[] | null = null; // 复制
    private cutClipboard: string[] | null = null;  // 剪切

    constructor(private workspaceRoot: string, memento: vscode.Memento) { 
        this.memento = memento;
        // 从工作区状态恢复展开状态
        const savedState = this.memento.get<string[]>('packageManagerExpandedNodes', []);
        this.expandedNodes = new Set(savedState);
    }

    refresh(): void {
        this._onDidChange.fire();
    }

    /**
     * 扫描外部文件夹，查找包含 __init__.ojson5 的文件夹
     */
    private scanExternalRoleFolders(basePath: string, externalFolders: string[], workspaceRoot: string): void {
        try {
            if (!fs.existsSync(basePath)) return;

            // 排除novel-helper目录（因为它会被单独处理）
            if (path.relative(workspaceRoot, basePath).startsWith('novel-helper')) {
                return;
            }

            // 获取忽略目录配置
            const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
            const ignoredDirectories = cfg.get<string[]>('externalFolder.ignoredDirectories', [
                '.git', '.vscode', '.idea', 'node_modules', 'dist', 'build', 'out', '.DS_Store', 'Thumbs.db'
            ]);

            // 检查当前目录是否在忽略列表中
            const dirName = path.basename(basePath);
            if (ignoredDirectories.includes(dirName)) {
                console.log(`[PackageManager][scan] 跳过忽略的目录: ${basePath}`);
                return;
            }

            // 检查当前目录是否包含 __init__.ojson5
            const initFilePath = path.join(basePath, '__init__.ojson5');
            if (fs.existsSync(initFilePath)) {
                externalFolders.push(basePath);
                return; // 如果找到init文件，不再扫描子目录
            }

            // 递归扫描子目录
            const entries = fs.readdirSync(basePath, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const fullPath = path.join(basePath, entry.name);

                    // 跳过忽略的目录
                    if (ignoredDirectories.includes(entry.name)) {
                        console.log(`[PackageManager][scan] 跳过忽略的子目录: ${fullPath}`);
                        continue;
                    }

                    this.scanExternalRoleFolders(fullPath, externalFolders, workspaceRoot);
                }
            }
        } catch (error) {
            console.warn(`[PackageManager] 扫描外部文件夹时出错: ${basePath}`, error);
        }
    }

    // —— 剪贴板操作 ——
    public setCopy(paths: string[] | null) { this.copyClipboard = paths && paths.length? [...paths]: null; }
    public setCut(paths: string[] | null) { this.cutClipboard = paths && paths.length? [...paths]: null; }
    public hasClipboard() { return (this.copyClipboard && this.copyClipboard.length) || (this.cutClipboard && this.cutClipboard.length); }
    public async pasteInto(targetDir: string) {
        if (!this.hasClipboard()) return;
        const entries: {source: string; base: string; isDir: boolean;}[] = [];
        const pushEntry = (p:string) => {
            if (!fs.existsSync(p)) return; const st = fs.statSync(p);
            entries.push({source: p, base: path.basename(p), isDir: st.isDirectory()});
        };
        if (this.copyClipboard) this.copyClipboard.forEach(pushEntry);
        if (this.cutClipboard) this.cutClipboard.forEach(pushEntry);

        for (const e of entries) {
            let dest = path.join(targetDir, e.base);
            if (fs.existsSync(dest)) {
                // 防冲突：附加 (copy) 递增
                let idx=1; const baseName = path.basename(e.base, path.extname(e.base)); const ext = path.extname(e.base);
                while (fs.existsSync(dest)) {
                    dest = path.join(targetDir, `${baseName} (${idx++})${ext}`);
                }
            }
            if (this.copyClipboard && (!this.cutClipboard || !this.cutClipboard.includes(e.source))) {
                // 复制
                await this.copyRecursive(e.source, dest);
            } else {
                // 剪切或剪切优先
                fs.renameSync(e.source, dest);
            }
        }
        // 剪切后清空
        if (this.cutClipboard) this.cutClipboard = null;
        this.refresh();
    }
    private async copyRecursive(src: string, dest: string) {
        const st = fs.statSync(src);
        if (st.isDirectory()) {
            fs.mkdirSync(dest, {recursive: true});
            for (const name of fs.readdirSync(src)) {
                await this.copyRecursive(path.join(src,name), path.join(dest,name));
            }
        } else {
            fs.copyFileSync(src, dest);
        }
    }

    // 保存展开状态到工作区
    private saveExpandedState(): void {
        this.memento.update('packageManagerExpandedNodes', Array.from(this.expandedNodes));
    }

    // 处理节点展开
    onDidExpandElement(node: PackageNode): void {
        this.expandedNodes.add(node.id!);
        this.saveExpandedState();
    }

    // 处理节点折叠
    onDidCollapseElement(node: PackageNode): void {
        this.expandedNodes.delete(node.id!);
        this.saveExpandedState();
    }

    getTreeItem(node: PackageNode): vscode.TreeItem {
        return node;
    }

    async getChildren(node?: PackageNode): Promise<PackageNode[]> {
        // 根节点：先展示引用维护，然后外部文件夹，最后novel-helper
        if (!node) {
            // 1）算出 novel-helper 根目录
            const base = path.join(this.workspaceRoot, 'novel-helper');
            // 2）创建引用维护节点
            const refMaintenanceNode = new ReferenceMaintenanceNode(this.workspaceRoot);
            // 3）创建占位节点
            const newNode = new NewFileNode(base);

            // 4) 查找外部包含 __init__.ojson5 的文件夹
            const externalRoleFolders: string[] = [];
            const folders = vscode.workspace.workspaceFolders;
            if (folders && folders.length) {
                for (const folder of folders) {
                    const folderPath = folder.uri.fsPath;
                    this.scanExternalRoleFolders(folderPath, externalRoleFolders, folderPath);
                }
            }
            console.log(`[PackageManager] 找到 ${externalRoleFolders.length} 个外部角色文件夹:`, externalRoleFolders);

            const result: PackageNode[] = [refMaintenanceNode as any];

            // 添加外部文件夹节点
            for (const externalFolder of externalRoleFolders) {
                const isExpanded = this.expandedNodes.has(externalFolder);
                const externalNode = new PackageNode(
                    vscode.Uri.file(externalFolder),
                    isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
                );
                // 标记为外部文件夹，用于后续拖放处理
                externalNode.contextValue = 'externalRoleFolder';
                externalNode.tooltip = `外部角色文件夹: ${externalFolder}`;
                result.push(externalNode as any);
            }

            if (!fs.existsSync(base)) {
                result.push(newNode as any);
                return result;
            }

            // 扫描真实子项
            const children = fs.readdirSync(base).reduce<PackageNode[]>((nodes, name) => {
                if (name === 'outline' || name === '.anh-fsdb' || name === 'typo' || name === 'comments') {
                    return nodes;
                }
                const full = path.join(base, name);
                const stat = fs.statSync(full);

                if (stat.isDirectory()) {
                    // 根据保存的状态决定展开状态
                    const isExpanded = this.expandedNodes.has(full);
                    nodes.push(
                        new PackageNode(
                            vscode.Uri.file(full),
                            isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
                        )
                    );
                } else {
                    const ext = path.extname(name).toLowerCase();
                    const isRoleOrRelationshipFile = ext === '.ojson5' || ext === '.rjson5' || ext === '.ojson' || ext === '.rjson';
                    const isTimelineFile = ext === '.tjson5';
                    
                    if (isRoleOrRelationshipFile || isTimelineFile || /character-gallery|character|role|roles|sensitive-words|sensitive|vocabulary|vocab|regex-patterns|regex|-relationship/.test(name)) {
                        const allowed = ['.json5', '.txt', '.md', '.ojson', '.rjson', '.rjson5', '.ojson5', '.tjson5'];
                        const fileNode = new PackageNode(
                            vscode.Uri.file(full),
                            vscode.TreeItemCollapsibleState.None
                        );
                        if (!allowed.includes(ext)) {
                            fileNode.label += ' (格式错误)';
                            fileNode.iconPath = new vscode.ThemeIcon('error');
                            fileNode.contextValue = 'resourceFileError';
                         }
                         nodes.push(fileNode);
                    }
                }
                return nodes;
            }, []);

            // 添加novel-helper占位节点和子节点
            result.push(newNode as any);
            return result.concat(children);
        }

        // 子节点：扫描目录内容
        const dir = node.resourceUri.fsPath;
        if (!fs.existsSync(dir)) {
            return [];
        }
        return fs.readdirSync(dir).reduce<PackageNode[]>((nodes, name) => {
            const full = path.join(dir, name);
            const stat = fs.statSync(full);

            if (stat.isDirectory()) {
                if (name === '.anh-fsdb') { return nodes; }
                // 根据保存的状态决定子目录展开状态
                const isExpanded = this.expandedNodes.has(full);
                nodes.push(
                    new PackageNode(
                        vscode.Uri.file(full),
                        isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
                    )
                );
            } else {
                // 对于文件，分两类处理
                const ext = path.extname(name).toLowerCase();
                const isRoleOrRelationshipFile = ext === '.ojson5' || ext === '.rjson5' || ext === '.ojson' || ext === '.rjson';
                const isTimelineFile = ext === '.tjson5';
                
                if (isRoleOrRelationshipFile || isTimelineFile || /character-gallery|character|role|roles|sensitive-words|sensitive|vocabulary|vocab|regex-patterns|regex|-relationship|timeline/.test(name)) {
                    // 角色相关文件：检查格式并标记错误
                    const allowed = ['.json5', '.txt', '.md', '.ojson', '.rjson', '.rjson5', '.ojson5', '.tjson5'];
                    const fileNode = new PackageNode(
                        vscode.Uri.file(full),
                        vscode.TreeItemCollapsibleState.None
                    );
                    if (!allowed.includes(ext)) {
                        fileNode.label += ' (格式错误)';
                        fileNode.iconPath = new vscode.ThemeIcon('error');
                        fileNode.contextValue = 'resourceFileError';
                    }
                    nodes.push(fileNode);
                } else {
                    // 其他资源文件：全部显示，设置为普通资源文件
                    const fileNode = new PackageNode(
                        vscode.Uri.file(full),
                        vscode.TreeItemCollapsibleState.None
                    );
                    fileNode.contextValue = 'generalResourceFile'; // 普通资源文件，不被监视
                    
                    // 根据文件类型设置图标
                    const ext = path.extname(name).toLowerCase();
                    if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.webp'].includes(ext)) {
                        fileNode.iconPath = new vscode.ThemeIcon('file-media');
                    } else if (['.doc', '.docx', '.pdf', '.txt', '.rtf'].includes(ext)) {
                        fileNode.iconPath = new vscode.ThemeIcon('file-text');
                    } else if (['.html', '.htm', '.xml'].includes(ext)) {
                        fileNode.iconPath = new vscode.ThemeIcon('file-code');
                    } else if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(ext)) {
                        fileNode.iconPath = new vscode.ThemeIcon('file-zip');
                    } else {
                        fileNode.iconPath = new vscode.ThemeIcon('file');
                    }
                    
                    nodes.push(fileNode);
                }
            }
            return nodes;
        }, []);
    }
}

/**
 * Register view and commands in extension.ts
 */
export function registerPackageManagerView(context: vscode.ExtensionContext) {
    const ws = vscode.workspace.workspaceFolders;
    if (!ws) return;

    const rootFsPath = ws[0].uri.fsPath;
    const provider = new PackageManagerProvider(rootFsPath, context.workspaceState);

    // 注册 TreeDataProvider
    const treeView = vscode.window.createTreeView('packageManagerView', {
        treeDataProvider: provider,
        showCollapseAll: true,
        canSelectMany: true,
        dragAndDropController: new class implements vscode.TreeDragAndDropController<PackageNode> {
            dropMimeTypes = ['application/vnd.code.tree.packageManagerView','text/uri-list'];
            dragMimeTypes = ['text/uri-list'];
            async handleDrag(source: readonly PackageNode[], data: vscode.DataTransfer) {
                data.set('text/uri-list', new vscode.DataTransferItem(source.map(s=>s.resourceUri.toString()).join('\n')));
            }
            async handleDrop(target: PackageNode | undefined, data: vscode.DataTransfer, _token: vscode.CancellationToken) {
                try {
                    const urisRaw = data.get('text/uri-list')?.value as string | undefined;
                    if (!urisRaw) return;
                    const uris = urisRaw.split(/\r?\n/).filter(Boolean).map(u=>vscode.Uri.parse(u));

                    // 检查目标是否为外部文件夹
                    if (target && target.contextValue === 'externalRoleFolder') {
                        const result = await vscode.window.showWarningMessage(
                            `您即将文件/文件夹拖拽到外部角色文件夹 "${path.basename(target.resourceUri.fsPath)}" 中。`,
                            { modal: true },
                            '继续操作',
                            '取消'
                        );

                        if (result !== '继续操作') {
                            return;
                        }

                        // 外部文件夹允许拖拽，但使用特殊逻辑
                        const toDir = target.resourceUri.fsPath;
                        const paths = uris.map(u=>u.fsPath);
                        provider.setCut(paths);
                        await provider.pasteInto(toDir);
                        return;
                    }

                    // 默认逻辑：拖拽到novel-helper或其他目录
                    const toDir = target && fs.existsSync(target.resourceUri.fsPath) && fs.statSync(target.resourceUri.fsPath).isDirectory()? target.resourceUri.fsPath : path.join(rootFsPath,'novel-helper');
                    const paths = uris.map(u=>u.fsPath);
                    provider.setCut(paths);
                    await provider.pasteInto(toDir);
                } catch (err) {
                    vscode.window.showErrorMessage('拖拽移动失败: '+err);
                }
            }
        }
    });

    // 监听树视图展开/折叠事件以保存状态
    context.subscriptions.push(
        treeView.onDidExpandElement(e => {
            provider.onDidExpandElement(e.element);
        }),
        treeView.onDidCollapseElement(e => {
            provider.onDidCollapseElement(e.element);
        }),
        treeView
    );

    // Command: open file with default application
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.openFileWithDefault', async (uri: vscode.Uri) => {
            try {
                // 使用 VS Code 的默认打开方式
                await vscode.commands.executeCommand('vscode.open', uri);
            } catch (error) {
                vscode.window.showErrorMessage(`无法打开文件: ${error}`);
            }
        })
    );

    // Helper: per-file preference store key
    const PER_FILE_KEY = 'andrea.roleJson5.perFileOpen';

    function getPerFilePrefs(): Record<string, boolean> {
        return context.workspaceState.get<Record<string, boolean>>(PER_FILE_KEY, {});
    }


    // —— 引用维护命令 ——
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.showReferenceMaintenance', async () => {
            showReferenceMaintenancePanel(rootFsPath);
        })
    );

    // —— 复制 / 剪切 / 粘贴 命令 ——
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.package.copy', (node: PackageNode | PackageNode[]) => {
            const nodes = Array.isArray(node)? node: treeView.selection.length? treeView.selection: [node];
            provider.setCopy(nodes.map(n=>n.resourceUri.fsPath));
            provider.setCut(null);
            vscode.window.setStatusBarMessage(`已复制 ${nodes.length} 个项目`, 2000);
        }),
        vscode.commands.registerCommand('AndreaNovelHelper.package.cut', (node: PackageNode | PackageNode[]) => {
            const nodes = Array.isArray(node)? node: treeView.selection.length? treeView.selection: [node];
            provider.setCut(nodes.map(n=>n.resourceUri.fsPath));
            provider.setCopy(null);
            vscode.window.setStatusBarMessage(`已剪切 ${nodes.length} 个项目`, 2000);
        }),
        vscode.commands.registerCommand('AndreaNovelHelper.package.paste', async (target?: PackageNode) => {
            const dir = target && fs.existsSync(target.resourceUri.fsPath) && fs.statSync(target.resourceUri.fsPath).isDirectory()? target.resourceUri.fsPath: path.join(rootFsPath,'novel-helper');
            await provider.pasteInto(dir);
            vscode.window.setStatusBarMessage('粘贴完成', 2000);
        })
    );

    // Command: open file
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.openFile', async (uri: vscode.Uri | PackageNode) => {
            try {
                // 如果传入的是 PackageNode，提取 resourceUri
                const fileUri = uri instanceof vscode.Uri ? uri : (uri as PackageNode).resourceUri;

                // consult per-file preference and global config
                const prefs = getPerFilePrefs();
                const pref = prefs[fileUri.fsPath];
                const globalDefault = vscode.workspace.getConfiguration().get<boolean>('andrea.roleJson5.openWithRoleManager', true);

                const shouldOpenWithManager = typeof pref === 'boolean' ? pref : !!globalDefault;

                // Decide by extension: .json5 and .ojson are eligible for role manager.
                const ext = path.extname(fileUri.fsPath).toLowerCase();
                if (ext === '.json5' || ext === '.ojson') {
                    if (shouldOpenWithManager) {
                        try {
                            // ensure it's recognized as role-related before opening with manager
                            if (shouldUpdateRoles(fileUri.fsPath)) {
                                await vscode.commands.executeCommand('vscode.openWith', fileUri, 'andrea.roleJson5Editor');
                                return;
                            }
                        } catch (err) {
                            console.warn('openWith andrea.roleJson5Editor failed, fallback to vscode.open', err);
                        }
                    }
                    // fallback to VS Code default open for .json5
                    await vscode.commands.executeCommand('vscode.open', fileUri);
                    return;
                }

                // For markdown and all other types use VS Code default opening behavior
                await vscode.commands.executeCommand('vscode.open', fileUri);
                return;
            } catch (error) {
                vscode.window.showErrorMessage(`无法打开文件: ${error}`);
            }
        })
    );

        // 右键快速切换：是否使用角色卡管理器打开 JSON5 文件（全局布尔开关）
        context.subscriptions.push(
            vscode.commands.registerCommand('AndreaNovelHelper.toggleRoleManagerOpenForFile', async (resource?: vscode.Uri) => {
                try {
                    const config = vscode.workspace.getConfiguration();
                    const key = 'andrea.roleJson5.openWithRoleManager';
                    const current = config.get<boolean>(key, true);
                    const target = !current;
                    // 优先更新工作区设置（如果有工作区），否则用户设置
                    const targetScope = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
                    await config.update(key, target, targetScope);
                    vscode.window.showInformationMessage(`已${target ? '启用' : '禁用'}：使用角色卡管理器打开 JSON5 文件（全局设置）`);
                } catch (e) {
                    console.error('[ANH] toggleRoleManagerOpenForFile error', e);
                    vscode.window.showErrorMessage('切换角色卡管理器打开方式失败，请在设置中手动修改。');
                }
            })
        );

    // Command: open with specific application
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.openWith', async (node: PackageNode) => {
            const filePath = node.resourceUri.fsPath;
            const fileName = path.basename(filePath);
            
            // 直接调用 VS Code 的内置"打开方式"命令
            try {
                await vscode.commands.executeCommand('explorer.openWith', node.resourceUri);
            } catch (error) {
                // 如果上面的命令不可用，提供一个简化的选择菜单
                const options = [
                    {
                        label: 'VS Code 编辑器',
                        description: '在当前编辑器中打开',
                        action: 'vscode'
                    },
                    {
                        label: 'VS Code 新窗口',
                        description: '在新的 VS Code 窗口中打开',
                        action: 'vscode-new'
                    },
                    {
                        label: '系统默认程序',
                        description: '使用系统默认关联程序打开',
                        action: 'system-default'
                    },
                    {
                        label: '文件资源管理器',
                        description: '在文件资源管理器中显示',
                        action: 'explorer'
                    }
                ];

                const selected = await vscode.window.showQuickPick(options, {
                    placeHolder: `选择打开 ${fileName} 的方式`,
                    title: '打开方式'
                });

                if (selected) {
                    await executeOpenAction(selected.action, node.resourceUri);
                }
            }
        })
    );

    // Command: reveal in file explorer
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.revealInExplorer', async (node: PackageNode) => {
            try {
                await vscode.commands.executeCommand('revealFileInOS', node.resourceUri);
            } catch (error) {
                vscode.window.showErrorMessage(`无法在文件资源管理器中显示文件: ${error}`);
            }
        })
    );

    // Command: delete package or file
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.deleteNode', async (node: PackageNode) => {
            const confirm = await vscode.window.showWarningMessage(
                `Delete ${node.label}?`, { modal: true }, 'Yes'
            );
            if (confirm === 'Yes') {
                const p = node.resourceUri.fsPath;
                statSync(p).isDirectory() ? fs.rmdirSync(p, { recursive: true }) : fs.unlinkSync(p);
                provider.refresh();
            }
        })
    );

    // 统一创建命令：角色库 / 敏感词库 / 词汇库 （内部选择 json5 / txt / md）
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.createCharacterGallery', async (node: PackageNode | NewFileNode) => {
            const file = await promptForExtensionCustom(node.resourceUri.fsPath, { defaultBase: 'character-gallery', kind: 'character' });
            if (file) provider.refresh();
        }),
        vscode.commands.registerCommand('AndreaNovelHelper.createSensitiveWords', async (node: PackageNode | NewFileNode) => {
            const file = await promptForExtensionCustom(node.resourceUri.fsPath, { defaultBase: 'sensitive-words', kind: 'sensitive' });
            if (file) provider.refresh();
        }),
        vscode.commands.registerCommand('AndreaNovelHelper.createVocabulary', async (node: PackageNode | NewFileNode) => {
            const file = await promptForExtensionCustom(node.resourceUri.fsPath, { defaultBase: 'vocabulary', kind: 'vocabulary' });
            if (file) provider.refresh();
        })
    );

    // 新增：创建 ojson5 和 rjson5 文件的命令
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.createRoleFile', async (node: PackageNode | NewFileNode) => {
            const file = await createRoleFile(node.resourceUri.fsPath);
            if (file) provider.refresh();
        }),
        vscode.commands.registerCommand('AndreaNovelHelper.createRelationshipFile', async (node: PackageNode | NewFileNode) => {
            const file = await createRelationshipFile(node.resourceUri.fsPath);
            if (file) provider.refresh();
        }),
        vscode.commands.registerCommand('AndreaNovelHelper.createTimelineFile', async (node: PackageNode | NewFileNode) => {
            const file = await createTimelineFile(node.resourceUri.fsPath);
            if (file) provider.refresh();
        })
    );

    // Command: create sub-package
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.createSubPackage', async (node: PackageNode | NewFileNode) => {
            const name = await vscode.window.showInputBox({ prompt: 'Sub-package name' });
            if (!name) return;
            const newDir = path.join(node.resourceUri.fsPath, name);
            if (fs.existsSync(newDir)) {
                vscode.window.showWarningMessage('Sub-package already exists');
            } else {
                fs.mkdirSync(newDir);
                provider.refresh();
            }
        })
    );

    // Command: rename package or file
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'AndreaNovelHelper.renamePackage',
            async (node: PackageNode) => {
                const stat = fs.statSync(node.resourceUri.fsPath);
                if (stat.isDirectory()) {
                    // 原有的包重命名逻辑
                    const oldName = node.label as string;
                    const newName = await vscode.window.showInputBox({
                        prompt: `重命名包 ${oldName}`,
                        value: oldName
                    });
                    if (!newName || newName === oldName) {
                        return;
                    }

                    // 计算旧路径和新路径
                    const oldPath = node.resourceUri.fsPath;
                    const newPath = path.join(path.dirname(oldPath), newName);
                    if (fs.existsSync(newPath)) {
                        vscode.window.showErrorMessage(`目标名称 "${newName}" 已存在`);
                        return;
                    }

                    // 重命名文件夹
                    fs.renameSync(oldPath, newPath);
                    provider.refresh();
                } else {
                    // 新的文件重命名逻辑
                    const newFileName = await promptForFileRename(node);
                    if (newFileName) {
                        provider.refresh();
                    }
                }
            }
        )
    );

    // 旧的单独 md / txt 创建命令已移除，避免菜单冗余

    // Command: create regex patterns file
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.createRegexPatterns', async (node: PackageNode | NewFileNode) => {
            const file = await createRegexPatternsFile(node.resourceUri.fsPath);
            if (file) provider.refresh();
        })
    );

    // —— 使用全局文件追踪系统 —— 
    const helperRoot = path.join(rootFsPath, 'novel-helper');
    
    // 改进的过滤逻辑：只关注相关文件和目录
    const shouldRefresh = (filePath: string) => {
        const relativePath = path.relative(helperRoot, filePath);
        
        // 排除 outline 目录
        if (relativePath.startsWith('outline' + path.sep) || relativePath === 'outline') {
            return false;
        }
        // 排除内部数据库目录
        if (relativePath === '.anh-fsdb' || relativePath.startsWith('.anh-fsdb' + path.sep)) {
            return false;
        }
        // 排除 typo 和 comments 目录
        if (relativePath.startsWith('typo' + path.sep) || relativePath === 'typo' ||
            relativePath.startsWith('comments' + path.sep) || relativePath === 'comments') {
            return false;
        }
        
        // 如果是目录变化，总是刷新（用于显示结构变化）
        try {
            if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
                return true;
            }
        } catch (error) {
            // 文件可能已被删除，仍需要刷新
        }
        
        // 如果是文件，优先按扩展名判断：任意 .ojson5/.rjson5/.ojson/.rjson 均视为角色/关系文件，
        // 否则使用关键词 + 扩展名组合判断（旧逻辑，兼容其他资源类型）
        const fileName = path.basename(filePath);
        const ext = path.extname(fileName).toLowerCase();
        // 仅允许 .ojson5 和 .rjson5 在无关键词时也被识别为角色/关系文件
        const autoExts = new Set(['.ojson5', '.rjson5' ,'tjson5']);

        if (autoExts.has(ext)) {
            return true;
        }

        const hasKeywords = /character-gallery|character|role|roles|sensitive-words|sensitive|vocabulary|vocab|regex-patterns|regex|-relationship|timeline/.test(fileName);
        const hasValidExtension = /\.(json5|txt|md|ojson|rjson|rjson5|ojson5|tjson5)$/i.test(fileName);

        return hasKeywords && hasValidExtension;
    };

    // 改进的角色数据更新判断：任意角色/关系扩展名均触发角色数据更新（即使文件名无关键词）
    const shouldUpdateRoles = (filePath: string) => {
    const fileName = path.basename(filePath);
    const ext = path.extname(fileName).toLowerCase();
    const autoExts = new Set(['.ojson5', '.rjson5']);

    if (autoExts.has(ext)) return true;

    const hasKeywords = /character-gallery|character|role|roles|sensitive-words|sensitive|vocabulary|vocab|regex-patterns|timeline|regex/.test(fileName);
    const hasValidExtension = /\.(json5|txt|md|ojson|rjson|rjson5|ojson5|tjson5)$/i.test(fileName);

    return hasKeywords && hasValidExtension;
    };

    // 统一的刷新处理函数
    const handleFileChange = (event: FileChangeEvent) => {
        const filePath = event.filePath;
        
        // 只处理 novel-helper 目录下的文件
        if (!filePath.startsWith(helperRoot)) {
            return;
        }
        
        if (!shouldRefresh(filePath)) {
            return;
        }

        console.log(`包管理器：检测到文件${event.type} ${filePath}`);
        provider.refresh();
        
        // 只有角色相关文件才触发角色数据更新
        if (shouldUpdateRoles(filePath)) {
            try {
                if (event.type === 'delete') {
                    // 文件删除：强制完整刷新
                    loadRoles(true);
                } else {
                    // 文件创建或修改：增量更新
                    loadRoles(false, [filePath]);
                }
                
                // 触发装饰器更新
                try {
                    updateDecorations();
                } catch (error) {
                    console.error(`装饰器更新失败: ${error}`);
                }
                
                // 显示用户通知
                const fileName = path.basename(filePath);
                const changeTypeMap: { [key: string]: string } = {
                    'create': '创建',
                    'delete': '删除', 
                    'change': '修改',
                    'rename': '重命名'
                };
                vscode.window.showInformationMessage(`检测到角色文件${changeTypeMap[event.type]}: ${fileName}`);
            } catch (error) {
                console.error(`角色数据更新失败: ${error}`);
            }
        }
    };

    // 注册全局文件追踪回调
    registerFileChangeCallback('packageManager', handleFileChange);

    // 额外监听文本文档保存事件（更精确的文件内容变化检测）
    const saveWatcher = vscode.workspace.onDidSaveTextDocument((document) => {
        const filePath = document.uri.fsPath;
        
        // 检查是否在 novel-helper 目录下
        if (!filePath.startsWith(helperRoot)) {
            return;
        }
        
        if (shouldRefresh(filePath)) {
            console.log(`包管理器：检测到相关文件保存 ${filePath}`);
            provider.refresh();
            
            // 只有角色相关文件才触发角色数据更新
            if (shouldUpdateRoles(filePath)) {
                try {
                    loadRoles(false, [filePath]);
                    
                    // 触发装饰器更新
                    try {
                        updateDecorations();
                    } catch (error) {
                        console.error(`装饰器更新失败: ${error}`);
                    }
                } catch (error) {
                    console.error(`角色数据更新失败: ${error}`);
                }
            }
        }
    });

    context.subscriptions.push(saveWatcher);

    // 清理函数：取消注册文件追踪回调
    context.subscriptions.push({
        dispose: () => {
            unregisterFileChangeCallback('packageManager');
        }
    });
}

interface ExtensionCustomOptions { defaultBase: string; kind: 'character' | 'sensitive' | 'vocabulary'; }
async function promptForExtensionCustom(dir: string, opts: ExtensionCustomOptions): Promise<string | undefined> {
    const baseInput = await vscode.window.showInputBox({ prompt: '输入基础文件名（不含扩展名，留空使用默认）', value: opts.defaultBase });
    if (baseInput === undefined) return; // 取消
    const baseNameRaw = (baseInput.trim() || opts.defaultBase).replace(/\s+/g,'-');
    const extPick = await vscode.window.showQuickPick(['json5','txt','md'], { placeHolder: '选择文件格式 (json5 / txt / md)' });
    if (!extPick) return;
    const fileInfo = resolveFileConflict(dir, baseNameRaw, '.'+extPick);
    let initialContent = '';
    if (extPick === 'json5') {
        if (opts.kind === 'sensitive') initialContent = generateSensitiveWordsJson5();
        else if (opts.kind === 'vocabulary') initialContent = generateVocabularyJson5();
        else if (opts.kind === 'character') initialContent = generateCharacterGalleryJson5();
        else initialContent = '[\n  // 新文件\n]';
    } else if (extPick === 'txt') {
        if (opts.kind === 'character') initialContent = '# 一行一个角色名称 (支持 # / // 注释)';
        else if (opts.kind === 'sensitive') initialContent = '# 一行一个敏感词 (支持 # / // 注释)';
        else if (opts.kind === 'vocabulary') initialContent = '# 一行一个词汇/术语 (支持 # / // 注释)';
    } else if (extPick === 'md') {
        if (opts.kind === 'character') initialContent = generateMarkdownRoleTemplate();
        else if (opts.kind === 'sensitive') initialContent = generateMarkdownSensitiveTemplate();
        else if (opts.kind === 'vocabulary') initialContent = generateMarkdownVocabularyTemplate();
        else initialContent = '# 新文件\n';
    }
    fs.writeFileSync(fileInfo.path, initialContent + (initialContent.endsWith('\n')? '':'\n'), 'utf8');
    // 自动打开新文件
    try {
        const doc = await vscode.workspace.openTextDocument(fileInfo.path);
        await vscode.window.showTextDocument(doc, { preview: false });
    } catch (err) {
        console.warn('自动打开新文件失败: ', err);
    }
    if (fileInfo.conflicted) vscode.window.showInformationMessage(`文件已存在，自动使用名称: ${path.basename(fileInfo.path)}`);
    return fileInfo.path;
}

async function createRegexPatternsFile(dir: string): Promise<string | undefined> {
    // 询问自定义文件名
    const customName = await vscode.window.showInputBox({
        prompt: '输入正则表达式文件的自定义名称（留空使用默认名称）',
        placeHolder: '例如: 对话着色、特殊格式等'
    });
    
    // 生成文件名
    let fileNameBase: string;
    if (customName && customName.trim()) {
        fileNameBase = `${customName.trim()}_regex-patterns`;
    } else {
        fileNameBase = 'regex-patterns';
    }
    const fileInfo = resolveFileConflict(dir, fileNameBase, '.json5');
    
    // 生成模板内容（从模板生成器导入）
    const template = generateRegexPatternsTemplate();
    fs.writeFileSync(fileInfo.path, template, 'utf8');
    const document = await vscode.workspace.openTextDocument(fileInfo.path);
    await vscode.window.showTextDocument(document);
    if (fileInfo.conflicted) vscode.window.showInformationMessage(`文件已存在，自动使用名称: ${path.basename(fileInfo.path)}`);
    return fileInfo.path;
}

// generateRegexPatternsTemplate 已迁移到 templates/templateGenerators


async function promptForFileRename(node: PackageNode): Promise<string | undefined> {
    const oldPath = node.resourceUri.fsPath;
    const oldName = path.basename(oldPath);
    const ext = path.extname(oldName).toLowerCase();
    const baseName = path.basename(oldName, ext);
    const dir = path.dirname(oldPath);

    // 检测当前文件类型
    let detectedType = '角色';
    if (/sensitive-words|sensitive/i.test(baseName)) {
        detectedType = '敏感词';
    } else if (/vocabulary|vocab/i.test(baseName)) {
        detectedType = '词汇';
    } else if (/character-gallery|character|role|roles/i.test(baseName)) {
        detectedType = '角色';
    }

    if (ext === '.md') {
        // Markdown 解析器函数已静态导入
        
        // 选择文件类型
        const roleType = await vscode.window.showQuickPick(
            ['角色', '敏感词', '词汇'], 
            { 
                placeHolder: '选择文件类型',
                title: `重命名文件: ${oldName}`
            }
        );
        if (!roleType) return;
        if (!roleType) return;

        // 询问自定义文件名
        const customName = await vscode.window.showInputBox({
            prompt: `输入${roleType}文件的自定义名称（留空使用默认名称）`,
            placeHolder: '例如: 主要人物、禁用词汇等'
        });
        
        // 生成新文件名
        let newFileName: string;
        if (customName && customName.trim()) {
            newFileName = generateCustomFileName(customName.trim(), roleType);
        } else {
            newFileName = generateDefaultFileName(roleType);
        }
        
        const newPath = path.join(dir, `${newFileName}.md`);
        
        if (newPath === oldPath) {
            return; // 没有变化
        }
        
        if (fs.existsSync(newPath)) {
            vscode.window.showErrorMessage(`文件 ${newFileName}.md 已存在`);
            return;
        }
        
        // 重命名文件
        fs.renameSync(oldPath, newPath);
        return newPath;
    } 
    // 对于 .json5 和 .txt 文件，使用简化的重命名流程
    else if (ext === '.json5' || ext === '.txt') {
        // 选择文件类型
        const roleType = await vscode.window.showQuickPick(
            ['角色', '敏感词', '词汇'], 
            { 
                placeHolder: '选择文件类型',
                title: `重命名文件: ${oldName}`
            }
        );
        if (!roleType) return;

        // 询问自定义文件名前缀
        const customName = await vscode.window.showInputBox({
            prompt: `输入${roleType}文件的自定义名称（留空使用默认名称）`,
            placeHolder: '例如: 主要人物、禁用词汇等'
        });
        
        // 生成新文件名
        let newFileName: string;
        if (customName && customName.trim()) {
            // 生成格式：自定义名字_关键词
            const keyword = roleType === '角色' ? 'character-gallery' : 
                           roleType === '敏感词' ? 'sensitive-words' : 'vocabulary';
            newFileName = `${customName.trim()}_${keyword}`;
        } else {
            // 使用默认名称
            newFileName = roleType === '角色' ? 'character-gallery' : 
                         roleType === '敏感词' ? 'sensitive-words' : 'vocabulary';
        }
        
        const newPath = path.join(dir, `${newFileName}${ext}`);
        
        if (newPath === oldPath) {
            return; // 没有变化
        }
        
        if (fs.existsSync(newPath)) {
            vscode.window.showErrorMessage(`文件 ${newFileName}${ext} 已存在`);
            return;
        }
        
        // 重命名文件
        fs.renameSync(oldPath, newPath);
        return newPath;
    } else {
        // 对于其他文件类型，使用简单的重命名
        const newName = await vscode.window.showInputBox({
            prompt: `重命名文件 ${oldName}`,
            value: baseName
        });
        
        if (!newName || newName === baseName) {
            return;
        }
        
        const newPath = path.join(dir, `${newName}${ext}`);
        
        if (fs.existsSync(newPath)) {
            vscode.window.showErrorMessage(`文件 ${newName}${ext} 已存在`);
            return;
        }
        
        // 重命名文件
        fs.renameSync(oldPath, newPath);
        return newPath;
    }
}

/**
 * 执行不同的打开操作
 */
async function executeOpenAction(action: string, uri: vscode.Uri): Promise<void> {
    try {
        switch (action) {
            case 'role-manager':
                await vscode.commands.executeCommand('AndreaNovelHelper.openWithRoleManager', uri);
                break;
            case 'text-editor':
                const doc = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(doc, { preview: false });
                break;
            case 'system-default':
                await vscode.env.openExternal(uri);
                break;
            case 'explorer':
                await vscode.commands.executeCommand('revealFileInOS', uri);
                break;
            default:
                vscode.window.showErrorMessage(`未知的打开方式: ${action}`);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`打开文件失败: ${error}`);
    }
}

/** 创建角色文件 (.ojson5) */
async function createRoleFile(dir: string): Promise<string | undefined> {
    const name = await vscode.window.showInputBox({ 
        prompt: '输入角色文件名称',
        placeHolder: '例如: main-characters'
    });
    if (!name) return;

    const fileName = name.endsWith('.ojson5') ? name : `${name}.ojson5`;
    const filePath = path.join(dir, fileName);
    
    if (fs.existsSync(filePath)) {
        vscode.window.showErrorMessage(`文件 ${fileName} 已存在`);
        return;
    }

    // 生成角色文件初始内容
    const initialContent = generateRoleFileTemplate();
    
    fs.writeFileSync(filePath, initialContent, 'utf8');
    
    // 自动打开新文件
    try {
        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(doc, { preview: false });
    } catch (err) {
        console.warn('自动打开新文件失败: ', err);
    }
    
    vscode.window.showInformationMessage(`角色文件 ${fileName} 创建成功`);
    return filePath;
}

/** 创建关系文件 (.rjson5) */
async function createRelationshipFile(dir: string): Promise<string | undefined> {
    const name = await vscode.window.showInputBox({ 
        prompt: '输入关系文件名称',
        placeHolder: '例如: character-relationships'
    });
    if (!name) return;

    const fileName = name.endsWith('.rjson5') ? name : `${name}.rjson5`;
    const filePath = path.join(dir, fileName);
    
    if (fs.existsSync(filePath)) {
        vscode.window.showErrorMessage(`文件 ${fileName} 已存在`);
        return;
    }

    // 生成关系文件初始内容
    const initialContent = generateRelationshipFileTemplate();
    
    fs.writeFileSync(filePath, initialContent, 'utf8');
    
    // 自动打开新文件
    try {
        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(doc, { preview: false });
    } catch (err) {
        console.warn('自动打开新文件失败: ', err);
    }
    
    vscode.window.showInformationMessage(`关系文件 ${fileName} 创建成功`);
    return filePath;
}

/** 生成角色文件模板 */
function generateRoleFileTemplate(): string {
    const id = generateUUIDv7();
    return `[
    // === 示例角色（可删除或修改）===
    {
        uuid: "${id}",
        name: "示例角色",
        type: "主角",
        affiliation: "示例阵营",
        aliases: ["示例"],
        color: "#FFA500",
        description: "这是一个示例角色，用于说明角色文件格式。",
        age: 25,
        gender: "未知",
        occupation: "示例职业"
    }
]`;
}

/** 生成关系文件模板 */
function generateRelationshipFileTemplate(): string {
    const src = generateUUIDv7();
    const tgt = generateUUIDv7();
    return `{
    // === 角色关系配置文件 ===
    "relationships": [
        // 示例关系（可删除或修改）
        {
            "sourceRoleUuid": "${src}",
            "targetRoleUuid": "${tgt}", 
            "relationshipType": "朋友",
            "description": "从小一起长大的好朋友",
            "strength": 8,
            "isPublic": true,
            "tags": ["友情", "童年"],
            "metadata": {
                "startChapter": 1,
                "developmentStage": "稳定期"
            }
        }
    ]
}`;
}

/** 创建时间线文件 (.tjson5) */
async function createTimelineFile(dir: string): Promise<string | undefined> {
    const name = await vscode.window.showInputBox({ 
        prompt: '输入时间线文件名称',
        placeHolder: '例如: story-timeline'
    });
    if (!name) return;

    const fileName = name.endsWith('.tjson5') ? name : `${name}.tjson5`;
    const filePath = path.join(dir, fileName);
    
    if (fs.existsSync(filePath)) {
        vscode.window.showErrorMessage(`文件 ${fileName} 已存在`);
        return;
    }

    // 生成时间线文件初始内容
    const initialContent = generateTimelineFileTemplate();
    
    fs.writeFileSync(filePath, initialContent, 'utf8');
    
    // 自动打开新文件
    try {
        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(doc, { preview: false });
    } catch (err) {
        console.warn('自动打开新文件失败: ', err);
    }
    
    vscode.window.showInformationMessage(`时间线文件 ${fileName} 创建成功`);
    return filePath;
}

/** 生成时间线文件模板 */
function generateTimelineFileTemplate(): string {
    return `{
    // === 时间线配置文件 ===
    "events": [],
    "connections": []
}`;
}

// 显示引用维护面板
async function showReferenceMaintenancePanel(workspaceRoot: string) {
    try {
        // 获取角色和引用统计信息
        const stats = await getReferenceStats(workspaceRoot);

        // 创建快速选择面板
        const options: vscode.QuickPickItem[] = [
            {
                label: '$(database) 清理数据库中的绝对路径',
                description: '清理角色文件中的绝对路径，避免路径依赖问题',
                detail: '扫描所有角色文件，将绝对路径转换为相对路径'
            },
            {
                label: '$(refresh) 重建角色引用索引',
                description: '重新分析并建立角色之间的引用关系',
                detail: '扫描角色文件，更新引用关系数据库'
            },
            {
                label: '$(graph) 打开角色引用热力图',
                description: '可视化查看角色之间的引用关系强度',
                detail: '在图表中显示角色引用的热力分布'
            }
        ];

        const selected = await vscode.window.showQuickPick(options, {
            placeHolder: `当前统计：${stats.roleCount} 个角色，${stats.referenceCount} 个引用`,
            title: '引用维护操作'
        });

        if (selected) {
            await executeReferenceMaintenanceAction(selected.label, workspaceRoot);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`显示引用维护面板失败: ${error}`);
    }
}

// 获取角色和引用统计信息
async function getReferenceStats(workspaceRoot: string): Promise<{ roleCount: number; referenceCount: number }> {
    try {
        // 从全局关系管理器获取角色数量
        const roleCount = globalRelationshipManager.getAllRoles().size;

        // 执行命令获取角色引用数据统计
        const roleReferenceData = await vscode.commands.executeCommand<any>('AndreaNovelHelper.circlePacking.getRoleReferenceData');
        let referenceCount = 0;

        if (roleReferenceData && roleReferenceData.items) {
            referenceCount = roleReferenceData.items.reduce((total: number, item: any) => total + (item.count || 0), 0);
        }

        return { roleCount, referenceCount };
    } catch (error) {
        console.error('获取引用统计失败:', error);
        // 如果获取引用统计失败，至少返回角色数量
        try {
            const roleCount = globalRelationshipManager.getAllRoles().size;
            return { roleCount, referenceCount: 0 };
        } catch (roleError) {
            console.error('获取角色数量也失败:', roleError);
            return { roleCount: 0, referenceCount: 0 };
        }
    }
}

// 执行引用维护操作
async function executeReferenceMaintenanceAction(actionLabel: string, workspaceRoot: string): Promise<void> {
    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: '执行引用维护操作',
            cancellable: true
        }, async (progress, token) => {
            progress.report({ increment: 0, message: `正在执行: ${actionLabel}` });

            if (actionLabel.includes('清理数据库中的绝对路径')) {
                progress.report({ increment: 20, message: '清理绝对路径...' });
                await vscode.commands.executeCommand('AndreaNovelHelper.cleanAbsolutePaths');
                progress.report({ increment: 80, message: '绝对路径清理完成' });
            } else if (actionLabel.includes('重建角色引用索引')) {
                progress.report({ increment: 20, message: '重建引用索引...' });
                await vscode.commands.executeCommand('AndreaNovelHelper.rebuildRoleIndex');
                progress.report({ increment: 80, message: '引用索引重建完成' });
            } else if (actionLabel.includes('打开角色引用热力图')) {
                progress.report({ increment: 20, message: '准备热力图数据...' });
                await vscode.commands.executeCommand('AndreaNovelHelper.openRoleHeatmap');
                progress.report({ increment: 80, message: '热力图已打开' });
            }

            progress.report({ increment: 100, message: '操作完成' });
        });

        vscode.window.showInformationMessage(`引用维护操作完成: ${actionLabel}`);
    } catch (error) {
        vscode.window.showErrorMessage(`执行引用维护操作失败: ${error}`);
    }
}
