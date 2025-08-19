/* eslint-disable curly */
// src/packageManagerView.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { generateCharacterGalleryJson5, generateSensitiveWordsJson5, generateVocabularyJson5, generateRegexPatternsTemplate, generateMarkdownRoleTemplate, generateMarkdownSensitiveTemplate, generateMarkdownVocabularyTemplate } from '../../templates/templateGenerators';
import { statSync } from 'fs';

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

class NewFileNode extends vscode.TreeItem {
    /**
     * @param baseDir 完整的 novel-helper 根目录路径
     */
    constructor(public readonly baseDir: string) {
        // 让 TreeItem 也有 resourceUri，指向根目录
        super(vscode.Uri.file(baseDir), vscode.TreeItemCollapsibleState.None);

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
            // 所有文件都使用默认打开方式
            this.command = {
                command: 'AndreaNovelHelper.openFileWithDefault',
                title: 'Open File with Default',
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
        // 根节点：先展示“创建新文件”
        if (!node) {
            // 1）算出 novel-helper 根目录
            const base = path.join(this.workspaceRoot, 'novel-helper');
            // 2）用它来 new 一个带 resourceUri 的占位节点
            const newNode = new NewFileNode(base);

            if (!fs.existsSync(base)) {
                return [newNode as any];
            }

            // 扫描真实子项
            const children = fs.readdirSync(base).reduce<PackageNode[]>((nodes, name) => {
                if (name === 'outline' || name === '.anh-fsdb') {
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
                } else if (/character-gallery|character|role|roles|sensitive-words|sensitive|vocabulary|vocab|regex-patterns|regex/.test(name)) {
                    const ext = path.extname(name).toLowerCase();
                    const allowed = ['.json5', '.txt', '.md'];
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
                return nodes;
            }, []);

            // 把占位节点放到最前面
            return [newNode as any, ...children];
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
                if (/character-gallery|character|role|roles|sensitive-words|sensitive|vocabulary|vocab|regex-patterns|regex/.test(name)) {
                    // 角色相关文件：检查格式并标记错误
                    const ext = path.extname(name).toLowerCase();
                    const allowed = ['.json5', '.txt', '.md'];
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
                await vscode.window.showTextDocument(fileUri);
            } catch (error) {
                vscode.window.showErrorMessage(`无法打开文件: ${error}`);
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
        vscode.commands.registerCommand('AndreaNovelHelper.createCharacterGallery', async (node: PackageNode) => {
            const file = await promptForExtensionCustom(node.resourceUri.fsPath, { defaultBase: 'character-gallery', kind: 'character' });
            if (file) provider.refresh();
        }),
        vscode.commands.registerCommand('AndreaNovelHelper.createSensitiveWords', async (node: PackageNode) => {
            const file = await promptForExtensionCustom(node.resourceUri.fsPath, { defaultBase: 'sensitive-words', kind: 'sensitive' });
            if (file) provider.refresh();
        }),
        vscode.commands.registerCommand('AndreaNovelHelper.createVocabulary', async (node: PackageNode) => {
            const file = await promptForExtensionCustom(node.resourceUri.fsPath, { defaultBase: 'vocabulary', kind: 'vocabulary' });
            if (file) provider.refresh();
        })
    );

    // Command: create sub-package
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.createSubPackage', async (node: PackageNode) => {
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
        vscode.commands.registerCommand('AndreaNovelHelper.createRegexPatterns', async (node: PackageNode) => {
            const file = await createRegexPatternsFile(node.resourceUri.fsPath);
            if (file) provider.refresh();
        })
    );

    // —— 改进的文件系统监听 —— 
    const helperRoot = path.join(rootFsPath, 'novel-helper');
    // 监听 novel-helper 下所有变动
    const watcherPattern = new vscode.RelativePattern(rootFsPath, 'novel-helper/**');
    const watcher = vscode.workspace.createFileSystemWatcher(watcherPattern);

    // 改进的过滤逻辑：只关注相关文件和目录
    const shouldRefresh = (uri: vscode.Uri) => {
        const relativePath = path.relative(helperRoot, uri.fsPath);
        
        // 排除 outline 目录
        if (relativePath.startsWith('outline' + path.sep) || relativePath === 'outline') {
            return false;
        }
        // 排除内部数据库目录
        if (relativePath === '.anh-fsdb' || relativePath.startsWith('.anh-fsdb' + path.sep)) {
            return false;
        }
        
        // 如果是目录变化，总是刷新（用于显示结构变化）
        try {
            if (fs.existsSync(uri.fsPath) && fs.statSync(uri.fsPath).isDirectory()) {
                return true;
            }
        } catch (error) {
            // 文件可能已被删除，仍需要刷新
        }
        
        // 如果是文件，只关注包含关键词的文件（角色相关文件）
        const fileName = path.basename(uri.fsPath);
        const hasKeywords = /character-gallery|character|role|roles|sensitive-words|sensitive|vocabulary|vocab|regex-patterns|regex/.test(fileName);
        const hasValidExtension = /\.(json5|txt|md)$/i.test(fileName);
        
        return hasKeywords && hasValidExtension;
    };

    // 改进的角色数据更新判断：只有角色相关文件才触发角色数据更新
    const shouldUpdateRoles = (uri: vscode.Uri) => {
        const fileName = path.basename(uri.fsPath);
        const hasKeywords = /character-gallery|character|role|roles|sensitive-words|sensitive|vocabulary|vocab|regex-patterns|regex/.test(fileName);
        const hasValidExtension = /\.(json5|txt|md)$/i.test(fileName);
        
        return hasKeywords && hasValidExtension;
    };

    // 统一的刷新处理函数
    const handleFileChange = (uri: vscode.Uri, changeType: 'create' | 'delete' | 'change') => {
        if (!shouldRefresh(uri)) {
            return;
        }

        console.log(`包管理器：检测到文件${changeType} ${uri.fsPath}`);
        provider.refresh();
        
        // 只有角色相关文件才触发角色数据更新
        if (shouldUpdateRoles(uri)) {
            // 动态导入并触发角色数据增量更新
            import('../../utils/utils.js').then(({ loadRoles }) => {
                if (changeType === 'delete') {
                    // 文件删除：强制完整刷新
                    loadRoles(true);
                } else {
                    // 文件创建或修改：增量更新
                    loadRoles(false, [uri.fsPath]);
                }
                
                // 触发装饰器更新
                import('../../events/updateDecorations.js').then(({ updateDecorations }) => {
                    updateDecorations();
                }).catch(error => {
                    console.error(`装饰器更新失败: ${error}`);
                });
                
                // 显示用户通知
                const fileName = path.basename(uri.fsPath);
                const changeTypeMap = {
                    'create': '创建',
                    'delete': '删除', 
                    'change': '修改'
                };
                vscode.window.showInformationMessage(`检测到角色文件${changeTypeMap[changeType]}: ${fileName}`);
            }).catch(error => {
                console.error(`角色数据更新失败: ${error}`);
            });
        }
    };

    // 监听文件系统事件
    watcher.onDidCreate(uri => handleFileChange(uri, 'create'));
    watcher.onDidDelete(uri => handleFileChange(uri, 'delete'));
    watcher.onDidChange(uri => handleFileChange(uri, 'change'));

    context.subscriptions.push(watcher);

    // 额外监听文本文档保存事件（更精确的文件内容变化检测）
    const saveWatcher = vscode.workspace.onDidSaveTextDocument((document) => {
        const filePath = document.uri.fsPath;
        
        // 检查是否在 novel-helper 目录下
        if (!filePath.startsWith(helperRoot)) {
            return;
        }
        
        if (shouldRefresh(document.uri)) {
            console.log(`包管理器：检测到相关文件保存 ${filePath}`);
            provider.refresh();
            
            // 只有角色相关文件才触发角色数据更新
            if (shouldUpdateRoles(document.uri)) {
                // 触发角色数据增量更新
                import('../../utils/utils.js').then(({ loadRoles }) => {
                    loadRoles(false, [filePath]);
                    
                    // 触发装饰器更新
                    import('../../events/updateDecorations.js').then(({ updateDecorations }) => {
                        updateDecorations();
                    }).catch(error => {
                        console.error(`装饰器更新失败: ${error}`);
                    });
                }).catch(error => {
                    console.error(`角色数据更新失败: ${error}`);
                });
            }
        }
    });

    context.subscriptions.push(saveWatcher);
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

    // 如果是 .md 文件，使用完整的重命名流程
    if (ext === '.md') {
        // 导入 Markdown 解析器函数
        const { generateCustomFileName, generateDefaultFileName } = await import('../../utils/Parser/markdownParser.js');
        
        // 选择文件类型
        const roleType = await vscode.window.showQuickPick(
            ['角色', '敏感词', '词汇'], 
            { 
                placeHolder: '选择文件类型',
                title: `重命名文件: ${oldName}`
            }
        );
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
            case 'vscode':
                // 在当前编辑器中打开
                await vscode.window.showTextDocument(uri);
                break;
                
            case 'vscode-new':
                // 在新窗口中打开
                try {
                    await vscode.commands.executeCommand('vscode.openWith', uri, 'default', vscode.ViewColumn.Beside);
                } catch {
                    // 如果上面的命令失败，使用普通的新窗口打开
                    await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.Beside });
                }
                break;
                
            case 'system-default':
                // 系统默认程序
                await vscode.env.openExternal(uri);
                break;
                
            case 'explorer':
                // 在文件资源管理器中显示
                await vscode.commands.executeCommand('revealFileInOS', uri);
                break;
                
            default:
                // 默认用 VS Code 打开
                await vscode.window.showTextDocument(uri);
                break;
        }
    } catch (error) {
        vscode.window.showErrorMessage(`打开文件失败: ${error}`);
    }
}
