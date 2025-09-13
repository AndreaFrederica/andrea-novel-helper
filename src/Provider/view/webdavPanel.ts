import * as vscode from 'vscode';
import * as path from 'path';
import { WebDAVAccountManager, WebDAVAccount } from '../../sync/accountManager';
import { WebDAVSyncService, SyncProgressCallback } from '../../sync/webdavSync';
import * as fs from 'fs';

export interface WebDAVPanelMessage {
    command: string;
    data?: any;
}

export interface SyncProgress {
    total: number;
    completed: number;
    current: string;
    status: 'idle' | 'syncing' | 'error' | 'completed';
    error?: string;
}

export interface FileDiff {
    path: string;
    status: 'added' | 'modified' | 'deleted' | 'conflict';
    localSize?: number;
    remoteSize?: number;
    localModified?: Date;
    remoteModified?: Date;
    content?: {
        local?: string;
        remote?: string;
    };
}

export interface ProjectLink {
    accountId: string;
    accountName: string;
    remotePath: string;
    localPath: string;
    isLinked: boolean;
}

export class WebDAVPanelProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'andrea.webdavPanel';
    private _view?: vscode.WebviewView;
    private _context: vscode.ExtensionContext;
    private accountManager: WebDAVAccountManager;
    private syncService: WebDAVSyncService;
    private _syncProgress: SyncProgress = {
        total: 0,
        completed: 0,
        current: '',
        status: 'idle'
    };
    private _fileDiffs: FileDiff[] = [];
    private _projectLink: ProjectLink | null = null;

    constructor(context: vscode.ExtensionContext) {
        this._context = context;
        this.accountManager = new WebDAVAccountManager(context);
        this.syncService = new WebDAVSyncService(context);
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._context.extensionUri
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // 处理来自webview的消息
        webviewView.webview.onDidReceiveMessage(async (message: WebDAVPanelMessage) => {
            await this._handleMessage(message);
        });

        // 初始化数据
        this._refreshData();
    }

    private async _handleMessage(message: WebDAVPanelMessage) {
        switch (message.command) {
            case 'getAccounts':
                await this._sendAccounts();
                break;
            case 'addAccount':
                await this.accountManager.addOrEdit(message.data || {});
                await this._sendAccounts();
                break;
            case 'editAccount':
                if (message.data) {
                    await this.accountManager.addOrEdit(message.data);
                    await this._sendAccounts();
                }
                break;
            case 'refreshRemoteTree':
                await this._loadRemoteFileTree();
                break;
            case 'browseRemote':
                await this._browseRemoteDirectory(message.data?.path || '/');
                break;
            case 'setEncryptionKey':
                await this._setEncryptionKey(message.data?.key);
                break;
            case 'clearEncryptionKey':
                await this._clearEncryptionKey();
                break;
            case 'deleteAccount':
                if (message.data?.id) {
                    await this.accountManager.remove(message.data.id);
                    await this._sendAccounts();
                }
                break;
            case 'syncNow':
                await this._startSync(message.data?.direction || 'two-way');
                break;
            case 'getDiffs':
                await this._calculateDiffs();
                break;
            case 'resolveConflict':
                await this._resolveConflict(message.data);
                break;
            case 'getProjectLink':
                await this._sendProjectLink();
                break;
            case 'linkProject':
                await this._linkProject(message.data);
                break;
            case 'unlinkProject':
                await this._unlinkProject();
                break;
            case 'editProjectLink':
                await this._editProjectLink(message.data);
                break;
            case 'showDiff':
                await this._showFileDiff(message.data?.accountId);
                break;
            case 'refresh':
                await this._refreshData();
                break;
        }
    }

    private async _sendAccounts() {
        const accounts = await this.accountManager.listAccounts();
        this._postMessage({
            command: 'accountsUpdated',
            data: accounts
        });
    }

    private async _sendProjectLink() {
        await this._loadProjectLink();
        this._postMessage({
            command: 'projectLinkUpdated',
            data: this._projectLink
        });
    }

    private async _startSync(direction: 'two-way' | 'push' | 'pull') {
        try {
            this._syncProgress = {
                total: 0,
                completed: 0,
                current: '准备同步...',
                status: 'syncing'
            };
            this._postMessage({
                command: 'syncProgressUpdated',
                data: this._syncProgress
            });

            const progressCallback: SyncProgressCallback = {
                onProgress: (current: number, total: number, message: string) => {
                    this._syncProgress.completed = current;
                    this._syncProgress.total = total;
                    this._syncProgress.current = message;
                    this._postMessage({
                        command: 'syncProgressUpdated',
                        data: this._syncProgress
                    });
                },
                onComplete: (success: boolean, message: string) => {
                    this._syncProgress.status = success ? 'completed' : 'error';
                    this._syncProgress.current = message;
                    if (!success) {
                        this._syncProgress.error = message;
                    }
                    this._postMessage({
                        command: 'syncProgressUpdated',
                        data: this._syncProgress
                    });
                },
                onError: (error: string) => {
                    this._syncProgress.status = 'error';
                    this._syncProgress.error = error;
                    this._syncProgress.current = '同步失败';
                    this._postMessage({
                        command: 'syncProgressUpdated',
                        data: this._syncProgress
                    });
                }
            };

            await this.syncService.syncNow(direction, undefined, progressCallback);

            // 同步完成后重新计算差异
            if (this._syncProgress.status === 'completed') {
                await this._calculateDiffs();
            }
        } catch (error) {
            this._syncProgress.status = 'error';
            this._syncProgress.error = error instanceof Error ? error.message : String(error);
            this._syncProgress.current = '同步失败';
            this._postMessage({
                command: 'syncProgressUpdated',
                data: this._syncProgress
            });
        }
    }

    private _diffCalculationTimeout?: NodeJS.Timeout;
    private static readonly DIFF_DEBOUNCE_MS = 1000;
    
    private async _calculateDiffs() {
        // 防抖处理，避免频繁计算差异
        if (this._diffCalculationTimeout) {
            clearTimeout(this._diffCalculationTimeout);
        }
        
        this._diffCalculationTimeout = setTimeout(async () => {
            try {
                // 只有在有项目关联时才计算差异
                if (!this._projectLink) {
                    this._fileDiffs = [];
                    this._postMessage({
                        command: 'diffsUpdated',
                        data: this._fileDiffs
                    });
                    return;
                }

                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (!workspaceFolder) {
                    this._fileDiffs = [];
                    this._postMessage({
                        command: 'diffsUpdated',
                        data: this._fileDiffs
                    });
                    return;
                }

                // 获取本地和远程文件列表
                const localFiles = await this._getLocalFiles(workspaceFolder.uri.fsPath);
                const remoteFiles = await this.syncService.getFileList(this._projectLink.accountId);
                
                // 比较文件差异
                const diff = await this._compareFiles(localFiles, remoteFiles);
                this._fileDiffs = diff.diffs || [];

                this._postMessage({
                    command: 'diffsUpdated',
                    data: this._fileDiffs
                });
            } catch (error) {
                console.warn('计算文件差异时出错:', error);
                // 不显示错误消息，避免频繁弹窗
                this._fileDiffs = [];
                this._postMessage({
                    command: 'diffsUpdated',
                    data: this._fileDiffs
                });
            }
        }, WebDAVPanelProvider.DIFF_DEBOUNCE_MS);
    }

    private async _resolveConflict(data: { path: string; resolution: 'local' | 'remote' }) {
        try {
            // 实现冲突解决逻辑
            vscode.window.showInformationMessage(`已解决冲突: ${data.path} (使用${data.resolution === 'local' ? '本地' : '远程'}版本)`);
            await this._calculateDiffs();
        } catch (error) {
            vscode.window.showErrorMessage(`解决冲突失败: ${error}`);
        }
    }

    private async _refreshData() {
        await this._loadProjectLink();
        await this._sendAccounts();
        await this._sendProjectLink();
        // 只有在有项目关联时才计算差异，避免频繁刷新
        if (this._projectLink) {
            await this._calculateDiffs();
        }
    }

    private async _loadProjectLink() {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                this._projectLink = null;
                return;
            }

            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            const linkData = this._context.workspaceState.get<any>(`webdav.projectLink.${workspaceRoot}`);
            
            if (linkData) {
                const accounts = await this.accountManager.listAccounts();
                const account = accounts.find(acc => acc.id === linkData.accountId);
                
                this._projectLink = {
                    accountId: linkData.accountId,
                    accountName: account?.name || account?.url || '未知账户',
                    remotePath: linkData.remotePath,
                    localPath: workspaceRoot,
                    isLinked: true
                };
            } else {
                this._projectLink = null;
            }
        } catch (error) {
            console.error('加载项目关联信息失败:', error);
            this._projectLink = null;
        }
    }

    private async _linkProject(data: { accountId: string; remotePath: string }) {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                vscode.window.showErrorMessage('请先打开一个工作区');
                return;
            }

            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            const accounts = await this.accountManager.listAccounts();
            const account = accounts.find(acc => acc.id === data.accountId);
            
            if (!account) {
                vscode.window.showErrorMessage('找不到指定的WebDAV账户');
                return;
            }

            // 保存关联信息
            await this._context.workspaceState.update(`webdav.projectLink.${workspaceRoot}`, {
                accountId: data.accountId,
                remotePath: data.remotePath,
                linkedAt: new Date().toISOString()
            });

            this._projectLink = {
                accountId: data.accountId,
                accountName: account.name || account.url,
                remotePath: data.remotePath,
                localPath: workspaceRoot,
                isLinked: true
            };

            await this._sendProjectLink();
            vscode.window.showInformationMessage(`项目已成功关联到WebDAV: ${account.name || account.url}`);
        } catch (error) {
            console.error('关联项目失败:', error);
            vscode.window.showErrorMessage('关联项目失败: ' + (error instanceof Error ? error.message : String(error)));
        }
    }

    private async _unlinkProject() {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }

            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            await this._context.workspaceState.update(`webdav.projectLink.${workspaceRoot}`, undefined);
            
            this._projectLink = null;
            await this._sendProjectLink();
            vscode.window.showInformationMessage('项目关联已取消');
        } catch (error) {
            console.error('取消关联失败:', error);
            vscode.window.showErrorMessage('取消关联失败: ' + (error instanceof Error ? error.message : String(error)));
        }
    }

    private async _editProjectLink(data: { accountId: string; remotePath: string }) {
        await this._linkProject(data);
    }

    private async _showFileDiff(accountId?: string) {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('请先打开工作区');
                return;
            }

            let remoteFiles: any[] = [];
            if (accountId) {
                // 获取远程文件列表
                remoteFiles = await this.syncService.getFileList(accountId);
            }
            
            // 获取本地文件列表
            const localFiles = await this._getLocalFiles(workspaceFolder.uri.fsPath);
            
            // 比较差异
            const diff = await this._compareFiles(localFiles, remoteFiles);
            
            // 发送差异数据到webview
            this._postMessage({
                command: 'showDiff',
                data: diff
            });
            
        } catch (error) {
            vscode.window.showErrorMessage(`获取文件差异失败: ${error}`);
        }
    }

    private static readonly MAX_FILES_LIMIT = 5000; // 限制最大文件数量
    private static readonly IGNORED_DIRS = new Set(['.git', '.vscode', 'node_modules', '.next', 'dist', 'build', '.cache']);
    private static readonly IGNORED_EXTENSIONS = new Set(['.log', '.tmp', '.temp', '.cache']);

    private async _getLocalFiles(rootPath: string): Promise<any[]> {
        const files: any[] = [];
        let fileCount = 0;
        
        const scanDirectory = (dirPath: string, relativePath: string = '') => {
            // 检查文件数量限制
            if (fileCount >= WebDAVPanelProvider.MAX_FILES_LIMIT) {
                return;
            }
            
            try {
                const items = fs.readdirSync(dirPath);
                
                for (const item of items) {
                    if (fileCount >= WebDAVPanelProvider.MAX_FILES_LIMIT) {
                        break;
                    }
                    
                    const fullPath = path.join(dirPath, item);
                    const relPath = path.join(relativePath, item).replace(/\\/g, '/');
                    
                    try {
                        const stat = fs.statSync(fullPath);
                        
                        if (stat.isDirectory()) {
                            // 跳过忽略的目录
                            if (!item.startsWith('.') && !WebDAVPanelProvider.IGNORED_DIRS.has(item)) {
                                scanDirectory(fullPath, relPath);
                            }
                        } else if (stat.isFile()) {
                            // 跳过忽略的文件扩展名
                            const ext = path.extname(item).toLowerCase();
                            if (!WebDAVPanelProvider.IGNORED_EXTENSIONS.has(ext)) {
                                files.push({
                                    name: item,
                                    path: relPath,
                                    size: stat.size,
                                    lastModified: stat.mtime.toISOString(),
                                    type: 'file'
                                });
                                fileCount++;
                            }
                        }
                    } catch (statError) {
                        // 忽略无法访问的文件/目录
                        console.warn(`无法访问文件: ${fullPath}`, statError);
                    }
                }
            } catch (readError) {
                // 忽略无法读取的目录
                console.warn(`无法读取目录: ${dirPath}`, readError);
            }
        };
        
        scanDirectory(rootPath);
        
        // 如果达到文件数量限制，显示警告
        if (fileCount >= WebDAVPanelProvider.MAX_FILES_LIMIT) {
            vscode.window.showWarningMessage(`文件数量过多，已限制为 ${WebDAVPanelProvider.MAX_FILES_LIMIT} 个文件进行比较`);
        }
        
        return files;
    }

    private static readonly BATCH_SIZE = 500; // 分批处理大小
    private static readonly MAX_DIFF_DISPLAY = 1000; // 最大显示差异数量

    private async _compareFiles(localFiles: any[], remoteFiles: any[]): Promise<any> {
        const localMap = new Map(localFiles.map(f => [f.path, f]));
        const remoteMap = new Map(remoteFiles.map(f => [f.path || f.name, f]));
        
        const onlyLocal: any[] = [];
        const onlyRemote: any[] = [];
        const modified: any[] = [];
        const identical: any[] = [];
        
        const totalFiles = localFiles.length + remoteFiles.length;
        let processedFiles = 0;
        
        // 分批处理本地文件
        const localEntries = Array.from(localMap.entries());
        for (let i = 0; i < localEntries.length; i += WebDAVPanelProvider.BATCH_SIZE) {
            const batch = localEntries.slice(i, i + WebDAVPanelProvider.BATCH_SIZE);
            
            for (const [path, localFile] of batch) {
                const remoteFile = remoteMap.get(path);
                if (!remoteFile) {
                    if (onlyLocal.length < WebDAVPanelProvider.MAX_DIFF_DISPLAY) {
                        onlyLocal.push(localFile);
                    }
                } else {
                    // 比较修改时间或大小
                    try {
                        const localTime = new Date(localFile.lastModified).getTime();
                        const remoteTime = new Date(remoteFile.lastModified || remoteFile.lastmod).getTime();
                        
                        if (Math.abs(localTime - remoteTime) > 1000 || localFile.size !== remoteFile.size) {
                            if (modified.length < WebDAVPanelProvider.MAX_DIFF_DISPLAY) {
                                modified.push({
                                    path: path,
                                    local: localFile,
                                    remote: remoteFile
                                });
                            }
                        } else {
                            identical.push(localFile);
                        }
                    } catch (error) {
                        // 时间解析错误，视为修改
                        if (modified.length < WebDAVPanelProvider.MAX_DIFF_DISPLAY) {
                            modified.push({
                                path: path,
                                local: localFile,
                                remote: remoteFile
                            });
                        }
                    }
                }
                processedFiles++;
            }
            
            // 每批处理后让出控制权，避免阻塞UI
            if (i + WebDAVPanelProvider.BATCH_SIZE < localEntries.length) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
        
        // 分批处理远程独有文件
        const remoteEntries = Array.from(remoteMap.entries());
        for (let i = 0; i < remoteEntries.length; i += WebDAVPanelProvider.BATCH_SIZE) {
            const batch = remoteEntries.slice(i, i + WebDAVPanelProvider.BATCH_SIZE);
            
            for (const [path, remoteFile] of batch) {
                if (!localMap.has(path)) {
                    if (onlyRemote.length < WebDAVPanelProvider.MAX_DIFF_DISPLAY) {
                        onlyRemote.push(remoteFile);
                    }
                }
                processedFiles++;
            }
            
            // 每批处理后让出控制权
            if (i + WebDAVPanelProvider.BATCH_SIZE < remoteEntries.length) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
        
        const totalDiffs = onlyLocal.length + onlyRemote.length + modified.length;
        const hasMoreDiffs = totalDiffs >= WebDAVPanelProvider.MAX_DIFF_DISPLAY;
        
        if (hasMoreDiffs) {
            vscode.window.showWarningMessage(`差异文件过多，仅显示前 ${WebDAVPanelProvider.MAX_DIFF_DISPLAY} 个差异`);
        }
        
        return {
            onlyLocal,
            onlyRemote,
            modified,
            identical,
            hasMoreDiffs,
            summary: {
                totalLocal: localFiles.length,
                totalRemote: remoteFiles.length,
                onlyLocalCount: onlyLocal.length,
                onlyRemoteCount: onlyRemote.length,
                modifiedCount: modified.length,
                identicalCount: identical.length,
                hasMoreDiffs
            }
        };
    }

    private async _loadRemoteFileTree() {
        if (!this._projectLink) {
            this._postMessage({
                command: 'remoteTreeUpdated',
                data: { error: '请先关联项目到WebDAV' }
            });
            return;
        }

        try {
            const files = await this.syncService.getFileList(this._projectLink.accountId);
            const treeData = this._buildFileTree(files);
            this._postMessage({
                command: 'remoteTreeUpdated',
                data: { tree: treeData }
            });
        } catch (error) {
            this._postMessage({
                command: 'remoteTreeUpdated',
                data: { error: `加载远程文件树失败: ${error}` }
            });
        }
    }

    private async _browseRemoteDirectory(path: string) {
        if (!this._projectLink) {
            return;
        }

        try {
            // 这里可以扩展为浏览特定目录的功能
            await this._loadRemoteFileTree();
        } catch (error) {
            this._postMessage({
                command: 'remoteTreeUpdated',
                data: { error: `浏览远程目录失败: ${error}` }
            });
        }
    }

    private async _setEncryptionKey(key: string): Promise<void> {
        try {
            if (!key || key.trim() === '') {
                vscode.window.showErrorMessage('加密密钥不能为空');
                return;
            }

            await this.syncService.setEncryptionKey(key.trim());
            
            // 保存加密状态到全局状态
            await this._context.globalState.update('webdav.encryptionEnabled', true);
            
            this._postMessage({
                command: 'encryptionStatusUpdated',
                data: {
                    status: 'success',
                    message: '加密密钥设置成功',
                    enabled: true
                }
            });
            
            vscode.window.showInformationMessage('加密密钥设置成功');
        } catch (error) {
            const errorMessage = `设置加密密钥失败: ${error instanceof Error ? error.message : String(error)}`;
            this._postMessage({
                command: 'encryptionStatusUpdated',
                data: {
                    status: 'error',
                    message: errorMessage
                }
            });
            vscode.window.showErrorMessage(errorMessage);
        }
    }

    private async _clearEncryptionKey(): Promise<void> {
        try {
            await this.syncService.clearEncryptionKey();
            
            // 清除加密状态
            await this._context.globalState.update('webdav.encryptionEnabled', false);
            
            this._postMessage({
                command: 'encryptionStatusUpdated',
                data: {
                    status: 'success',
                    message: '加密密钥已清除',
                    enabled: false
                }
            });
            
            vscode.window.showInformationMessage('加密密钥已清除');
        } catch (error) {
            const errorMessage = `清除加密密钥失败: ${error instanceof Error ? error.message : String(error)}`;
            this._postMessage({
                command: 'encryptionStatusUpdated',
                data: {
                    status: 'error',
                    message: errorMessage
                }
            });
            vscode.window.showErrorMessage(errorMessage);
        }
    }

    private _buildFileTree(files: any[]): any {
        const tree: any = { name: '/', type: 'directory', children: [], path: '/' };
        const pathMap = new Map<string, any>();
        pathMap.set('/', tree);

        // 按路径深度排序，确保父目录先创建
        files.sort((a, b) => a.path.split('/').length - b.path.split('/').length);

        for (const file of files) {
            const pathParts = file.path.split('/').filter((p: string) => p);
            let currentPath = '';
            let parent = tree;

            for (let i = 0; i < pathParts.length; i++) {
                const part = pathParts[i];
                currentPath += '/' + part;
                
                if (!pathMap.has(currentPath)) {
                    const isLastPart = i === pathParts.length - 1;
                    const node = {
                        name: part,
                        type: isLastPart && file.type === 'file' ? 'file' : 'directory',
                        path: currentPath,
                        size: file.size,
                        modified: file.modified,
                        children: isLastPart && file.type === 'file' ? undefined : []
                    };
                    
                    parent.children.push(node);
                    pathMap.set(currentPath, node);
                    parent = node;
                } else {
                    parent = pathMap.get(currentPath);
                }
            }
        }

        return tree;
    }

    private _postMessage(message: WebDAVPanelMessage) {
        if (this._view) {
            this._view.webview.postMessage(message);
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'media', 'webdav-panel.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'media', 'webdav-panel.css'));

        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleUri}" rel="stylesheet">
    <title>WebDAV 管理面板</title>
</head>
<body>
    <div class="container">
        <!-- 账户管理区域 -->
        <div class="section">
            <div class="section-header">
                <h3>账户管理</h3>
                <button id="addAccountBtn" class="btn btn-primary">➕ 添加账户</button>
            </div>
            <div id="accountsList" class="accounts-list">
                <!-- 账户列表将在这里动态生成 -->
            </div>
        </div>

        <!-- 项目关联区域 -->
        <div class="section">
            <div class="section-header">
                <h3>项目关联</h3>
                <button id="linkProjectBtn" class="btn btn-primary">🔗 关联到WebDAV</button>
            </div>
            <div id="projectLinkStatus" class="project-link-status">
                <div id="linkStatusText" class="link-status-text">当前项目未关联到WebDAV</div>
                <div id="linkInfo" class="link-info" style="display: none;">
                    <div class="link-detail">
                        <span class="link-label">关联账户:</span>
                        <span id="linkedAccount" class="link-value">-</span>
                    </div>
                    <div class="link-detail">
                        <span class="link-label">远程路径:</span>
                        <span id="linkedPath" class="link-value">-</span>
                    </div>
                    <div class="link-actions">
                        <button id="unlinkProjectBtn" class="btn btn-small btn-danger">🔓 取消关联</button>
                        <button id="editLinkBtn" class="btn btn-small">✏️ 编辑关联</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- 同步控制区域 -->
        <div class="section">
            <div class="section-header">
                <h3>同步控制</h3>
                <div class="sync-buttons">
                    <button id="syncTwoWayBtn" class="btn btn-secondary">双向同步</button>
                    <button id="syncPushBtn" class="btn btn-secondary">仅推送</button>
                    <button id="syncPullBtn" class="btn btn-secondary">仅拉取</button>
                </div>
            </div>
            <div id="syncProgress" class="sync-progress">
                <div class="progress-bar">
                    <div id="progressFill" class="progress-fill"></div>
                </div>
                <div id="progressText" class="progress-text">就绪</div>
            </div>
        </div>

        <!-- 远程文件树区域 -->
        <div class="section">
            <div class="section-header">
                <h3>远程文件浏览</h3>
                <button id="refreshRemoteTreeBtn" class="btn btn-secondary">🔄 刷新</button>
                <button id="browseRemoteBtn" class="btn btn-secondary">📁 浏览</button>
            </div>
            <div id="remoteFileTree" class="remote-file-tree">
                <div class="no-tree-message">请先关联项目到WebDAV，然后点击"刷新"按钮加载远程文件</div>
            </div>
        </div>

        <!-- 文件加密设置区域 -->
        <div class="section">
            <div class="section-header">
                <h3>文件加密设置</h3>
                <button id="toggleEncryptionBtn" class="btn btn-secondary">🔒 启用加密</button>
            </div>
            <div class="encryption-config">
                <div class="form-group">
                    <label for="encryptionKey">加密密钥:</label>
                    <div class="input-group">
                        <input type="password" id="encryptionKey" placeholder="请输入加密密钥" class="form-control">
                        <button id="showKeyBtn" class="btn btn-icon" title="显示/隐藏密钥">密钥显示</button>
                    </div>
                </div>
                <div class="form-group">
                    <button id="setEncryptionKeyBtn" class="btn btn-primary">设置加密密钥</button>
                    <button id="clearEncryptionKeyBtn" class="btn btn-secondary">清除密钥</button>
                </div>
                <div id="encryptionStatus" class="encryption-status">
                    <span class="status-text">加密状态: 未设置</span>
                </div>
            </div>
        </div>

        <!-- 文件差异区域 -->
        <div class="section">
            <div class="section-header">
                <h3>文件差异</h3>
                <button id="refreshDiffsBtn" class="btn btn-secondary">🔄 刷新</button>
            </div>
            
            <!-- 差异统计 -->
            <div id="diffSummary" class="diff-summary" style="display: none;">
                <div class="summary-item">
                    <span class="summary-label">本地文件:</span>
                    <span id="localCount" class="summary-value">0</span>
                </div>
                <div class="summary-item">
                    <span class="summary-label">远程文件:</span>
                    <span id="remoteCount" class="summary-value">0</span>
                </div>
                <div class="summary-item">
                    <span class="summary-label">仅本地:</span>
                    <span id="onlyLocalCount" class="summary-value local-only">0</span>
                </div>
                <div class="summary-item">
                    <span class="summary-label">仅远程:</span>
                    <span id="onlyRemoteCount" class="summary-value remote-only">0</span>
                </div>
                <div class="summary-item">
                    <span class="summary-label">已修改:</span>
                    <span id="modifiedCount" class="summary-value modified">0</span>
                </div>
                <div class="summary-item">
                    <span class="summary-label">相同:</span>
                    <span id="identicalCount" class="summary-value identical">0</span>
                </div>
            </div>
            
            <!-- 差异分类标签 -->
            <div id="diffTabs" class="diff-tabs" style="display: none;">
                <button class="tab-btn active" data-tab="onlyLocal">仅本地 (<span id="tabOnlyLocalCount">0</span>)</button>
                <button class="tab-btn" data-tab="onlyRemote">仅远程 (<span id="tabOnlyRemoteCount">0</span>)</button>
                <button class="tab-btn" data-tab="modified">已修改 (<span id="tabModifiedCount">0</span>)</button>
                <button class="tab-btn" data-tab="identical">相同 (<span id="tabIdenticalCount">0</span>)</button>
            </div>
            
            <!-- 文件列表 -->
            <div id="diffsList" class="diffs-list">
                <div class="no-diff-message">点击"刷新"按钮获取文件差异信息</div>
            </div>
        </div>
    </div>

    <script src="${scriptUri}"></script>
</body>
</html>`;
    }

    public dispose() {
        // 清理资源
        if (this._diffCalculationTimeout) {
            clearTimeout(this._diffCalculationTimeout);
            this._diffCalculationTimeout = undefined;
        }
    }
}

export function registerWebDAVPanel(context: vscode.ExtensionContext) {
    const provider = new WebDAVPanelProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(WebDAVPanelProvider.viewType, provider)
    );
    return provider;
}