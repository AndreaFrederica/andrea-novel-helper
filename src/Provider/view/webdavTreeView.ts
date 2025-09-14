import * as vscode from 'vscode';
import * as path from 'path';
import { WebDAVAccountManager, WebDAVAccount } from '../../sync/accountManager';
import { WebDAVSyncService } from '../../sync/webdavSync';

export interface WebDAVFileItem {
    name: string;
    path: string;
    type: 'file' | 'directory' | 'account';
    size?: number;
    modified?: Date;
    accountId?: string;
    url?: string;
    children?: WebDAVFileItem[];
}

export class WebDAVTreeItem extends vscode.TreeItem {
    constructor(
        public readonly fileItem: WebDAVFileItem,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(fileItem.name, collapsibleState);
        
        this.tooltip = this._getTooltip();
        this.description = this._getDescription();
        this.contextValue = fileItem.type === 'file' ? 'webdavFile' : 
                           fileItem.type === 'directory' ? 'webdavFolder' : 
                           'webdavAccount';
        this.iconPath = this._getIcon();
        
        if (fileItem.type === 'file') {
            this.command = {
                command: 'andrea.webdav.openFile',
                title: '打开文件',
                arguments: [fileItem]
            };
        } else if (fileItem.type === 'account' && !fileItem.accountId) {
            // 添加账户的提示项目
            this.command = {
                command: 'andrea.webdav.addAccount',
                title: '添加WebDAV账户',
                arguments: []
            };
        }
    }

    private _getTooltip(): string {
        const item = this.fileItem;
        let tooltip = `${item.name}\n路径: ${item.path}`;
        
        if (item.size !== undefined) {
            tooltip += `\n大小: ${this._formatSize(item.size)}`;
        }
        
        if (item.modified) {
            tooltip += `\n修改时间: ${item.modified.toLocaleString()}`;
        }
        
        return tooltip;
    }

    private _getDescription(): string {
        const item = this.fileItem;
        if (item.type === 'file' && item.size !== undefined) {
            return this._formatSize(item.size);
        }
        return '';
    }

    private _getIcon(): vscode.ThemeIcon {
        if (this.fileItem.type === 'directory') {
            return new vscode.ThemeIcon('folder');
        }
        
        if (this.fileItem.type === 'account') {
            return new vscode.ThemeIcon('add');
        }
        
        const ext = path.extname(this.fileItem.name).toLowerCase();
        switch (ext) {
            case '.md':
            case '.markdown':
                return new vscode.ThemeIcon('markdown');
            case '.txt':
                return new vscode.ThemeIcon('file-text');
            case '.json':
                return new vscode.ThemeIcon('json');
            case '.js':
            case '.ts':
                return new vscode.ThemeIcon('file-code');
            case '.png':
            case '.jpg':
            case '.jpeg':
            case '.gif':
                return new vscode.ThemeIcon('file-media');
            default:
                return new vscode.ThemeIcon('file');
        }
    }

    private _formatSize(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
}

export class WebDAVTreeDataProvider implements vscode.TreeDataProvider<WebDAVTreeItem>, vscode.TreeDragAndDropController<WebDAVTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<WebDAVTreeItem | undefined | null | void> = new vscode.EventEmitter<WebDAVTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<WebDAVTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private _context: vscode.ExtensionContext;
    private _accountManager: WebDAVAccountManager;
    private _syncService: WebDAVSyncService;
    private _fileCache: Map<string, WebDAVFileItem[]> = new Map();
    private _rootItems: WebDAVFileItem[] = [];
    
    // 拖拽支持
    dropMimeTypes = ['application/vnd.code.tree.webdavFiles'];
    dragMimeTypes = ['application/vnd.code.tree.webdavFiles'];

    constructor(context: vscode.ExtensionContext) {
        this._context = context;
        this._accountManager = new WebDAVAccountManager(context);
        this._syncService = new WebDAVSyncService(context);
        this._loadRootItems();
    }

    refresh(): void {
        this._fileCache.clear();
        this._loadRootItems();
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: WebDAVTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: WebDAVTreeItem): Promise<WebDAVTreeItem[]> {
        try {
            console.log('[WebDAV-TreeView] getChildren: 开始获取子项目', element ? element.fileItem.name : '根级');
            if (!element) {
                // 返回根级项目（账户列表）
                if (this._rootItems.length === 0) {
                    console.log('[WebDAV-TreeView] getChildren: 根项目为空，重新加载');
                    await this._loadRootItems();
                }
                console.log('[WebDAV-TreeView] getChildren: 返回根项目数量:', this._rootItems.length);
                return this._rootItems.map(item => new WebDAVTreeItem(
                    item,
                    item.type === 'directory' ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
                ));
            }

            // 返回子项目
            if (element.fileItem.type === 'directory') {
                console.log('[WebDAV-TreeView] getChildren: 加载目录子项目:', element.fileItem.name, element.fileItem.path);
                const children = await this._loadChildren(element.fileItem);
                console.log('[WebDAV-TreeView] getChildren: 获取到子项目数量:', children.length);
                return children.map(item => new WebDAVTreeItem(
                    item,
                    item.type === 'directory' ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
                ));
            }

            console.log('[WebDAV-TreeView] getChildren: 非目录项目，返回空数组');
            return [];
        } catch (error) {
            console.error('[WebDAV-TreeView] getChildren: 获取子项目失败:', error);
            console.error('[WebDAV-TreeView] getChildren: 错误堆栈:', error instanceof Error ? error.stack : 'No stack trace');
            vscode.window.showErrorMessage(`获取文件列表失败: ${error}`);
            return [];
        }
    }

    private async _loadRootItems(): Promise<void> {
        try {
            console.log('[WebDAV-TreeView] _loadRootItems: 开始加载根项目');
            const accounts = await this._accountManager.getAccounts();
            console.log('[WebDAV-TreeView] _loadRootItems: 获取到账户数量:', accounts.length, accounts);
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            
            if (!workspaceFolder) {
                console.log('[WebDAV-TreeView] _loadRootItems: 没有工作区文件夹');
                vscode.window.showWarningMessage('没有打开的工作区');
                this._rootItems = [];
                return;
            }
            
            if (accounts.length === 0) {
                console.log('[WebDAV-TreeView] _loadRootItems: 没有配置的账户，显示添加提示');
                // 没有账户时显示提示项目
                this._rootItems = [{
                    name: '点击添加WebDAV账户',
                    path: '',
                    type: 'account' as const,
                    accountId: undefined
                }];
            } else {
                console.log('[WebDAV-TreeView] _loadRootItems: 为每个账户创建根项目');
                this._rootItems = accounts.map(account => ({
                    name: account.name || account.url,
                    path: account.rootPath || '/',
                    type: 'directory' as const,
                    accountId: account.id
                }));
                console.log('[WebDAV-TreeView] _loadRootItems: 创建的根项目:', this._rootItems);
            }
            this._onDidChangeTreeData.fire();
            console.log('[WebDAV-TreeView] _loadRootItems: 完成加载，触发树视图更新');
        } catch (error) {
            console.error('[WebDAV-TreeView] _loadRootItems: 加载根项目失败:', error);
            console.error('[WebDAV-TreeView] _loadRootItems: 错误堆栈:', error instanceof Error ? error.stack : 'No stack trace');
            vscode.window.showErrorMessage(`加载WebDAV账户失败: ${error}`);
            this._rootItems = [];
        }
    }

    private async _loadChildren(parent: WebDAVFileItem): Promise<WebDAVFileItem[]> {
        try {
            console.log('[WebDAV-TreeView] _loadChildren: 开始加载子项目', parent.name, parent.path, parent.accountId);
            if (!parent.accountId) {
                console.log('[WebDAV-TreeView] _loadChildren: 没有账户ID，返回空数组');
                return [];
            }
            
            // 如果已经有children属性且不为空，直接返回（用于已构建的目录树）
            if (parent.children && parent.children.length > 0) {
                console.log('[WebDAV-TreeView] _loadChildren: 使用缓存的子项目');
                return parent.children;
            }
            
            const cacheKey = `${parent.accountId}:${parent.path}`;
            
            if (this._fileCache.has(cacheKey)) {
                console.log('[WebDAV-TreeView] _loadChildren: 使用文件缓存');
                return this._fileCache.get(cacheKey) || [];
            }

            // 获取指定目录的直接子项
            console.log(`[WebDAV-TreeView] _loadChildren: 正在加载 ${parent.name} (${parent.path}) 的子项`);
            const children = await this._fetchRemoteFiles(parent.accountId, parent.path);
            console.log(`[WebDAV-TreeView] _loadChildren: 获取到 ${children.length} 个子项`);
            this._fileCache.set(cacheKey, children);
            return children;
        } catch (error) {
            console.error('[WebDAV-TreeView] _loadChildren: 加载子项目失败:', error);
            console.error('[WebDAV-TreeView] _loadChildren: 错误堆栈:', error instanceof Error ? error.stack : 'No stack trace');
            vscode.window.showErrorMessage(`加载文件列表失败: ${error}`);
            return [];
        }
    }

    private async _fetchRemoteFiles(accountId: string | undefined, remotePath: string): Promise<WebDAVFileItem[]> {
        try {
            console.log('[WebDAV-TreeView] _fetchRemoteFiles: 开始获取远程文件', accountId, remotePath);
            if (!accountId) {
                console.log('[WebDAV-TreeView] _fetchRemoteFiles: 没有账户ID');
                return [];
            }

            // 使用WebDAVSyncService的公共方法获取指定目录的文件列表
            console.log(`[WebDAV-TreeView] _fetchRemoteFiles: 开始获取文件列表，accountId: ${accountId}, remotePath: ${remotePath}`);
            console.log(`[WebDAV-TreeView] _fetchRemoteFiles: 调用getDirectoryFileList参数详情:`, { accountId, remotePath });
            const files = await this._syncService.getDirectoryFileList(accountId, remotePath);
            console.log(`[WebDAV-TreeView] _fetchRemoteFiles: getDirectoryFileList返回结果:`, files);
            console.log(`[WebDAV-TreeView] _fetchRemoteFiles: 获取到 ${files.length} 个文件，路径: ${remotePath}`, files);
            
            // 如果没有文件，返回一个提示项
            if (files.length === 0) {
                return [{
                    name: '(空目录)',
                    path: remotePath + '/(empty)',
                    type: 'file' as const,
                    accountId: accountId
                }];
            }
            
            // 标准化远程路径
            const normalizedRemotePath = remotePath.endsWith('/') ? remotePath : remotePath + '/';
            const remotePathDepth = remotePath === '/' || remotePath === '' ? 0 : remotePath.split('/').filter(p => p.length > 0).length;
            
            // 只获取直接子项（不递归）
            const directChildren: WebDAVFileItem[] = [];
            const seenPaths = new Set<string>();
            
            for (const file of files) {
                const filePath = file.path || '';
                
                // 跳过根路径本身
                if (filePath === remotePath || filePath === remotePath.replace(/\/$/, '')) {
                    continue;
                }
                
                // 计算相对路径
                let relativePath = filePath;
                if (remotePath && remotePath !== '/' && remotePath !== '') {
                    // 确保remotePath以/开头进行匹配
                    const pathToMatch = remotePath.startsWith('/') ? remotePath : '/' + remotePath;
                    if (filePath.startsWith(pathToMatch + '/')) {
                        relativePath = filePath.substring(pathToMatch.length + 1);
                    } else if (filePath.startsWith(pathToMatch) && filePath.length > pathToMatch.length) {
                        relativePath = filePath.substring(pathToMatch.length);
                        if (relativePath.startsWith('/')) {
                            relativePath = relativePath.substring(1);
                        }
                    }
                }
                
                // 只处理直接子项
                const pathParts = relativePath.split('/').filter((part: string) => part.length > 0);
                if (pathParts.length === 0) {
                    continue;
                }
                
                const directChildName = pathParts[0];
                const directChildPath = remotePath === '/' || remotePath === '' ? directChildName : `${remotePath}/${directChildName}`;
                console.log(`[WebDAV-TreeView] _fetchRemoteFiles: 构建路径详情`, {
                    file: file.path,
                    remotePath,
                    relativePath,
                    pathParts,
                    directChildName,
                    directChildPath
                });
                
                // 避免重复添加
                if (seenPaths.has(directChildPath)) {
                    continue;
                }
                seenPaths.add(directChildPath);
                
                // 判断是文件还是目录 - 优先使用从WebDAV返回的type信息
                const isDirectory = file.type === 'directory' || pathParts.length > 1;
                
                const fileItem: WebDAVFileItem = {
                    name: directChildName,
                    path: directChildPath,
                    type: isDirectory ? 'directory' as const : 'file' as const,
                    size: isDirectory ? undefined : (file.size || 0),
                    modified: file.mtime ? new Date(file.mtime) : undefined,
                    accountId: accountId
                };
                
                directChildren.push(fileItem);
            }
            
            console.log(`[WebDAV-TreeView] _fetchRemoteFiles: 返回 ${directChildren.length} 个直接子项`);
            return directChildren;
        } catch (error) {
            console.error('[WebDAV-TreeView] _fetchRemoteFiles: 获取远程文件列表失败:', error);
            console.error('[WebDAV-TreeView] _fetchRemoteFiles: 错误详情:', {
                accountId,
                remotePath,
                errorMessage: error instanceof Error ? error.message : String(error),
                errorStack: error instanceof Error ? error.stack : 'No stack trace'
            });
            vscode.window.showErrorMessage(`获取远程文件列表失败: ${error}`);
            return [];
        }
    }

    public async downloadFile(fileItem: WebDAVFileItem): Promise<void> {
        // 这个方法已被废弃，文件打开现在通过webdav://协议和文件系统提供器处理
        // 直接调用openFile命令
        vscode.commands.executeCommand('andrea.webdav.openFile', fileItem);
    }

    public async uploadFile(targetDir: WebDAVFileItem): Promise<void> {
        try {
            const fileUri = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                openLabel: '选择要上传的文件'
            });

            if (fileUri && fileUri[0]) {
                const fileName = path.basename(fileUri[0].fsPath);
                vscode.window.showInformationMessage(`正在上传文件: ${fileName}`);
                
                // 这里需要实现实际的文件上传逻辑
                
                vscode.window.showInformationMessage(`文件上传完成: ${fileName}`);
                this.refresh();
            }
        } catch (error) {
            vscode.window.showErrorMessage(`上传文件失败: ${error}`);
        }
    }

    public async deleteFile(fileItem: WebDAVFileItem): Promise<void> {
        try {
            const confirm = await vscode.window.showWarningMessage(
                `确定要删除 "${fileItem.name}" 吗？此操作无法撤销。`,
                { modal: true },
                '删除'
            );

            if (confirm === '删除') {
                vscode.window.showInformationMessage(`正在删除: ${fileItem.name}`);
                
                // 使用WebDAV文件系统提供器删除文件
                const uri = vscode.Uri.parse(`webdav://${fileItem.accountId}/${fileItem.path}`);
                await vscode.workspace.fs.delete(uri, { recursive: fileItem.type === 'directory' });
                
                vscode.window.showInformationMessage(`删除完成: ${fileItem.name}`);
                this.refresh();
            }
        } catch (error) {
            vscode.window.showErrorMessage(`删除文件失败: ${error}`);
        }
    }

    public async createFolder(parentItem: WebDAVFileItem): Promise<void> {
        try {
            const folderName = await vscode.window.showInputBox({
                prompt: '输入文件夹名称',
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return '文件夹名称不能为空';
                    }
                    if (value.includes('/') || value.includes('\\')) {
                        return '文件夹名称不能包含路径分隔符';
                    }
                    return null;
                }
            });

            if (folderName) {
                vscode.window.showInformationMessage(`正在创建文件夹: ${folderName}`);
                
                // 使用WebDAV文件系统提供器创建文件夹
                const newFolderPath = path.join(parentItem.path, folderName).replace(/\\/g, '/');
                const uri = vscode.Uri.parse(`webdav://${parentItem.accountId}/${newFolderPath}`);
                await vscode.workspace.fs.createDirectory(uri);
                
                vscode.window.showInformationMessage(`文件夹创建完成: ${folderName}`);
                this.refresh();
            }
        } catch (error) {
            vscode.window.showErrorMessage(`创建文件夹失败: ${error}`);
        }
    }

    public async renameFile(fileItem: WebDAVFileItem): Promise<void> {
        try {
            const newName = await vscode.window.showInputBox({
                prompt: '输入新名称',
                value: fileItem.name,
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return '名称不能为空';
                    }
                    if (value.includes('/') || value.includes('\\')) {
                        return '名称不能包含路径分隔符';
                    }
                    return null;
                }
            });

            if (newName && newName !== fileItem.name) {
                vscode.window.showInformationMessage(`正在重命名: ${fileItem.name} -> ${newName}`);
                
                // 使用WebDAV文件系统提供器重命名文件
                const oldUri = vscode.Uri.parse(`webdav://${fileItem.accountId}/${fileItem.path}`);
                const parentPath = path.dirname(fileItem.path);
                const newPath = path.join(parentPath, newName).replace(/\\/g, '/');
                const newUri = vscode.Uri.parse(`webdav://${fileItem.accountId}/${newPath}`);
                
                await vscode.workspace.fs.rename(oldUri, newUri, { overwrite: false });
                
                vscode.window.showInformationMessage(`重命名完成: ${newName}`);
                this.refresh();
            }
        } catch (error) {
            vscode.window.showErrorMessage(`重命名失败: ${error}`);
        }
    }

    public async copyFile(fileItem: WebDAVFileItem): Promise<void> {
        try {
            const newName = await vscode.window.showInputBox({
                prompt: '输入复制后的名称',
                value: `${path.parse(fileItem.name).name}_copy${path.parse(fileItem.name).ext}`,
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return '名称不能为空';
                    }
                    if (value.includes('/') || value.includes('\\')) {
                        return '名称不能包含路径分隔符';
                    }
                    return null;
                }
            });

            if (newName && newName !== fileItem.name) {
                vscode.window.showInformationMessage(`正在复制: ${fileItem.name} -> ${newName}`);
                
                // 使用WebDAV文件系统提供器复制文件
                const sourceUri = vscode.Uri.parse(`webdav://${fileItem.accountId}/${fileItem.path}`);
                const parentPath = path.dirname(fileItem.path);
                const newPath = path.join(parentPath, newName).replace(/\\/g, '/');
                const targetUri = vscode.Uri.parse(`webdav://${fileItem.accountId}/${newPath}`);
                
                await vscode.workspace.fs.copy(sourceUri, targetUri, { overwrite: false });
                
                vscode.window.showInformationMessage(`复制完成: ${newName}`);
                this.refresh();
            }
        } catch (error) {
            vscode.window.showErrorMessage(`复制失败: ${error}`);
        }
    }

    // 拖拽功能实现
    async handleDrag(source: WebDAVTreeItem[], treeDataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
        const items = source.map(item => ({
            name: item.fileItem.name,
            path: item.fileItem.path,
            type: item.fileItem.type,
            accountId: item.fileItem.accountId
        }));
        
        treeDataTransfer.set('application/vnd.code.tree.webdavFiles', new vscode.DataTransferItem(items));
    }

    async handleDrop(target: WebDAVTreeItem | undefined, sources: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
        const transferItem = sources.get('application/vnd.code.tree.webdavFiles');
        if (!transferItem) {
            return;
        }

        const items = transferItem.value as Array<{
            name: string;
            path: string;
            type: 'file' | 'directory' | 'account';
            accountId?: string;
        }>;

        if (!target || target.fileItem.type === 'account') {
            vscode.window.showWarningMessage('无法移动到此位置');
            return;
        }

        const targetPath = target.fileItem.type === 'directory' ? target.fileItem.path : path.dirname(target.fileItem.path);
        const targetAccountId = target.fileItem.accountId;

        for (const item of items) {
            if (item.accountId !== targetAccountId) {
                vscode.window.showWarningMessage('不支持跨账户移动文件');
                continue;
            }

            try {
                const newPath = path.join(targetPath, item.name).replace(/\\/g, '/');
                
                // 使用WebDAV文件系统提供器进行移动操作
                const oldUri = vscode.Uri.parse(`webdav://${item.accountId}/${item.path}`);
                const newUri = vscode.Uri.parse(`webdav://${targetAccountId}/${newPath}`);
                
                await vscode.workspace.fs.rename(oldUri, newUri, { overwrite: false });
                
                vscode.window.showInformationMessage(`移动成功: ${item.name}`);
            } catch (error) {
                vscode.window.showErrorMessage(`移动失败 ${item.name}: ${error}`);
            }
        }

        this.refresh();
    }
}

export function registerWebDAVTreeView(context: vscode.ExtensionContext): WebDAVTreeDataProvider {
    const provider = new WebDAVTreeDataProvider(context);
    
    const treeView = vscode.window.createTreeView('andrea.webdavFiles', {
        treeDataProvider: provider,
        showCollapseAll: true,
        canSelectMany: true,
        dragAndDropController: provider
    });

    // 注册相关命令
    context.subscriptions.push(
        treeView,
        vscode.commands.registerCommand('andrea.webdav.refreshFiles', () => provider.refresh()),
        vscode.commands.registerCommand('andrea.webdav.addAccount', async () => {
            const accountManager = new WebDAVAccountManager(context);
            await accountManager.addOrEdit({});
            provider.refresh(); // 刷新TreeView以显示新账户
        }),
        // openFile命令在activate.ts中重新注册，这里不需要重复注册
        vscode.commands.registerCommand('andrea.webdav.uploadFile', (targetDir: WebDAVFileItem) => {
            provider.uploadFile(targetDir);
        }),
        vscode.commands.registerCommand('andrea.webdav.deleteFile', (fileItem: WebDAVFileItem) => {
            provider.deleteFile(fileItem);
        }),
        vscode.commands.registerCommand('andrea.webdav.createFolder', (parentItem: WebDAVFileItem) => {
            provider.createFolder(parentItem);
        }),
        vscode.commands.registerCommand('andrea.webdav.renameFile', (fileItem: WebDAVFileItem) => {
            provider.renameFile(fileItem);
        }),
        vscode.commands.registerCommand('andrea.webdav.copyFile', (fileItem: WebDAVFileItem) => {
            provider.copyFile(fileItem);
        })
    );

    return provider;
}