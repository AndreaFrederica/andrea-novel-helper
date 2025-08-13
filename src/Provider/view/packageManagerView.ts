/* eslint-disable curly */
// src/packageManagerView.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { statSync } from 'fs';

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
            this.command = {
                command: 'AndreaNovelHelper.openResourceFile',
                title: 'Open Resource File',
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

    constructor(private workspaceRoot: string) { }

    refresh(): void {
        this._onDidChange.fire();
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
                if (name === 'outline') {
                    return nodes;
                }
                const full = path.join(base, name);
                const stat = fs.statSync(full);

                if (stat.isDirectory()) {
                    nodes.push(
                        new PackageNode(
                            vscode.Uri.file(full),
                            vscode.TreeItemCollapsibleState.Collapsed
                        )
                    );
                } else if (/character-gallery|sensitive-words|vocabulary/.test(name)) {
                    const ext = path.extname(name).toLowerCase();
                    const allowed = ['.json5', '.txt'];
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

        // 子节点：按照文件夹/文件原逻辑扫描
        const dir = node.resourceUri.fsPath;
        if (!fs.existsSync(dir)) {
            return [];
        }
        return fs.readdirSync(dir).reduce<PackageNode[]>((nodes, name) => {
            const full = path.join(dir, name);
            const stat = fs.statSync(full);

            if (stat.isDirectory()) {
                nodes.push(
                    new PackageNode(
                        vscode.Uri.file(full),
                        vscode.TreeItemCollapsibleState.Collapsed
                    )
                );
            } else if (/character-gallery|sensitive-words|vocabulary/.test(name)) {
                const ext = path.extname(name).toLowerCase();
                const allowed = ['.json5', '.txt'];
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
    }
}

/**
 * Register view and commands in extension.ts
 */
export function registerPackageManagerView(context: vscode.ExtensionContext) {
    const ws = vscode.workspace.workspaceFolders;
    if (!ws) return;

    const rootFsPath = ws[0].uri.fsPath;
    const provider = new PackageManagerProvider(rootFsPath);

    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('packageManagerView', provider)
    );

    // Command: open resource file
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.openResourceFile', (uri: vscode.Uri) => {
            vscode.window.showTextDocument(uri);
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

    // Command: create character-gallery.json5
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.createCharacterGallery', async (node: PackageNode) => {
            const dir = node.resourceUri.fsPath;
            const file = path.join(dir, 'character-gallery.json5');
            if (fs.existsSync(file)) {
                vscode.window.showWarningMessage('character-gallery.json5 already exists');
            } else {
                // 创建空的角色数组而不是空对象
                fs.writeFileSync(file, '[\n  // 在这里添加角色\n]');
                provider.refresh();
            }
        })
    );

    // Command: create sensitive-words
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.createSensitiveWords', async (node: PackageNode) => {
            const file = await promptForExtension(node.resourceUri.fsPath, 'sensitive-words');
            if (file) provider.refresh();
        })
    );

    // Command: create vocabulary
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.createVocabulary', async (node: PackageNode) => {
            const file = await promptForExtension(node.resourceUri.fsPath, 'vocabulary');
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

    // Command: rename package
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'AndreaNovelHelper.renamePackage',
            async (node: PackageNode) => {
                // 弹出输入框，默认值为当前包名
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
            }
        )
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
        
        // 如果是目录变化，总是刷新
        try {
            if (fs.existsSync(uri.fsPath) && fs.statSync(uri.fsPath).isDirectory()) {
                return true;
            }
        } catch (error) {
            // 文件可能已被删除，仍需要刷新
        }
        
        // 如果是文件，只关注包含关键词的文件
        const fileName = path.basename(uri.fsPath);
        const hasKeywords = /character-gallery|character|role|roles|sensitive-words|sensitive|vocabulary|vocab/.test(fileName);
        const hasValidExtension = /\.(json5|txt)$/i.test(fileName);
        
        return hasKeywords && hasValidExtension;
    };

    // 统一的刷新处理函数
    const handleFileChange = (uri: vscode.Uri, changeType: 'create' | 'delete' | 'change') => {
        if (!shouldRefresh(uri)) {
            return;
        }

        console.log(`包管理器：检测到文件${changeType} ${uri.fsPath}`);
        provider.refresh();
        
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
    });

    context.subscriptions.push(saveWatcher);
}

async function promptForExtension(dir: string, baseName: string): Promise<string | undefined> {
    const ext = await vscode.window.showQuickPick(['json5', 'txt'], { placeHolder: 'Select file format' });
    if (!ext) return;
    const file = path.join(dir, `${baseName}.${ext}`);
    if (fs.existsSync(file)) {
        vscode.window.showWarningMessage(`${baseName}.${ext} already exists`);
        return;
    }
    
    // 根据文件类型创建合适的初始内容
    let initialContent = '';
    if (ext === 'json5') {
        // 创建空的角色数组
        initialContent = '[\n  // 在这里添加角色\n]';
    } else if (ext === 'txt') {
        // TXT 文件可以保持空白
        initialContent = '';
    }
    
    fs.writeFileSync(file, initialContent);
    return file;
}
