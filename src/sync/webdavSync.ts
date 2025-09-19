import * as vscode from 'vscode';
import * as path from 'path';
import { Worker } from 'worker_threads';
import { WebDAVAccountManager, WebDAVAccount } from './accountManager';
import { ProjectConfigManager } from '../projectConfig/projectConfigManager';
import { WebDAVSyncStatusManager } from './webdavSyncStatusManager';
import { getAllTrackedFilesAsync } from '../utils/tracker/globalFileTracking';
import { SidecarDataMap, createTrackedSidecarData, createUntrackedSidecarData } from '../types/sidecarTypes';
import * as fs from 'fs';

export type SyncDirection = 'two-way' | 'push' | 'pull';

export interface SyncProgressCallback {
    onProgress?: (current: number, total: number, message: string) => void;
    onComplete?: (success: boolean, message: string) => void;
    onError?: (error: string) => void;
}

interface SyncMessage {
    id: string;
    type: 'webdav-sync' | 'file-read' | 'file-write' | 'file-list' | 'set-encryption-key' | 'create-directory' | 'delete' | 'rename' | 'webdav-file-read';
    data: any;
}

interface SyncResponse {
    id: string;
    success: boolean;
    data?: any;
    error?: string;
}

export class WebDAVSyncService {
    private context: vscode.ExtensionContext;
    private worker: Worker | null = null;
    private messageId = 0;
    private pendingMessages = new Map<string, { resolve: Function; reject: Function }>();
    private static readonly LAST_SYNC_KEY = 'webdav.lastSyncTime';
    private syncStatusManager: WebDAVSyncStatusManager;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.syncStatusManager = WebDAVSyncStatusManager.getInstance();
        this.initWorker();
    }

    private initWorker(): void {
        const workerPath = path.join(__dirname, '../workers/syncWorker.js');
        
        // 获取配置数据传递给worker
        const config = vscode.workspace.getConfiguration('AndreaNovelHelper.webdav.sync');
        const ignoredDirectories = config.get<string[]>('ignoredDirectories', [
            '.git', 'node_modules', '.pixi', '.venv', '__pycache__', '.pytest_cache',
            'target', 'build', 'dist', '.gradle', '.mvn', 'bin', 'obj', '.vs', '.idea',
            '.next', '.nuxt', '.cache', '.tmp', 'tmp', '.cargo', 'vendor', 'coverage',
            '.nyc_output', '.tox', '.nox', 'out', 'Debug', 'Release', '.dart_tool', '.pub-cache'
        ]);
        const ignoredFiles = config.get<string[]>('ignoredFiles', [
            '.DS_Store', 'Thumbs.db', 'desktop.ini', '*.tmp', '*.temp', '*.log', '*.pid', '*.lock'
        ]);
        const ignoreAppDataDirectories = config.get<boolean>('ignoreAppDataDirectories', true);
        
        const workerData = {
            config: {
                ignoredDirectories,
                ignoredFiles,
                ignoreAppDataDirectories
            }
        };
        
        this.worker = new Worker(workerPath, { workerData });
        
        this.worker.on('message', (response: SyncResponse) => {
            const pending = this.pendingMessages.get(response.id);
            if (pending) {
                this.pendingMessages.delete(response.id);
                if (response.success) {
                    pending.resolve(response.data);
                } else {
                    pending.reject(new Error(response.error || 'Unknown error'));
                }
            }
        });

        this.worker.on('error', (error) => {
            console.error('Sync worker error:', error);
            vscode.window.showErrorMessage(`Sync worker error: ${error.message}`);
        });
    }

    async sendMessage(type: string, data: any): Promise<any> {
        if (!this.worker) {
            throw new Error('Worker not initialized');
        }

        const id = `msg_${++this.messageId}`;
        const message: SyncMessage = { id, type: type as any, data };

        return new Promise((resolve, reject) => {
            this.pendingMessages.set(id, { resolve, reject });
            this.worker!.postMessage(message);
            
            // 设置超时
            setTimeout(() => {
                if (this.pendingMessages.has(id)) {
                    this.pendingMessages.delete(id);
                    reject(new Error('Worker message timeout'));
                }
            }, 30000); // 30秒超时
        });
    }

    private getRoot(): string | undefined {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }

    async syncNow(direction: SyncDirection = 'two-way', customPath?: string, progressCallback?: SyncProgressCallback) {
        const root = customPath || this.getRoot();
        if (!root) {
            vscode.window.showWarningMessage('未打开工作区，无法进行同步');
            return;
        }

        // 检查是否有项目关联
        const linkData = this.context.workspaceState.get<any>(`webdav.projectLink.${root}`);
        
        const am = new WebDAVAccountManager(this.context);
        let acc: WebDAVAccount | undefined;
        let remoteBase: string;
        
        if (linkData) {
            // 使用关联的账户和路径
            const accounts = await am.listAccounts();
            acc = accounts.find(a => a.id === linkData.accountId);
            if (!acc) {
                vscode.window.showErrorMessage('关联的WebDAV账户不存在，请重新关联项目');
                return;
            }
            remoteBase = linkData.remotePath;
        } else {
            // 直接同步整个工作区到WebDAV
            acc = await am.pickAccount();
            if (!acc) return;
            
            // 获取工作区名称作为远程文件夹名
            const workspaceName = path.basename(root);
            
            // 直接使用工作区名称作为远程路径，不再使用项目UUID
            remoteBase = acc.rootPath 
                ? path.posix.join('/', acc.rootPath, workspaceName).replace(/\\/g, '/') 
                : `/${workspaceName}`;
        }
        
        const password = await am.getPassword(acc.id);
        if (!password) {
            vscode.window.showErrorMessage('该账户无密码，请重新保存账户');
            return;
        }

        const out = vscode.window.createOutputChannel('WebDAV Sync');
        out.show(true);
        out.appendLine(`[WebDAV] 同步开始 方向=${direction} 根=${root}`);
        out.appendLine(`[WebDAV] 本地路径: ${root}`);
        out.appendLine(`[WebDAV] 远程路径: ${remoteBase}`);
        out.appendLine(`[WebDAV] WebDAV服务器: ${acc.url}`);
        out.appendLine(`[WebDAV] 账户: ${acc.username}`);
        
        if (linkData) {
            out.appendLine(`[WebDAV] 使用项目关联模式`);
        } else {
            out.appendLine(`[WebDAV] 使用直接同步模式，工作区名称: ${path.basename(root)}`);
        }

        try {
            // 开始同步，更新状态
            this.syncStatusManager.startSync('正在连接WebDAV服务器...');
            
            // 使用worker进行同步
            const progressOpts = {
                location: vscode.ProgressLocation.Notification,
                title: 'WebDAV 同步中',
                cancellable: false
            };

            await vscode.window.withProgress(progressOpts, async (progress) => {
                const initialMessage = '正在连接WebDAV服务器...';
                progress.report({ message: initialMessage });
                progressCallback?.onProgress?.(0, 100, initialMessage);
                this.syncStatusManager.updateProgress(0, 100, initialMessage);
                
                // 将direction转换为worker期望的格式
                let workerDirection: 'upload' | 'download' | 'two-way';
                switch (direction) {
                    case 'push':
                        workerDirection = 'upload';
                        break;
                    case 'pull':
                        workerDirection = 'download';
                        break;
                    default:
                        workerDirection = 'two-way';
                        break;
                }

                // 获取上次同步时间用于增量同步
                const lastSyncTime = this.context.workspaceState.get<number>(`${WebDAVSyncService.LAST_SYNC_KEY}.${acc.id}`);
                // 只有在上次同步时间存在且在1小时内才使用增量同步，避免过度过滤文件
                const isIncremental = lastSyncTime && (Date.now() - lastSyncTime) < 60 * 60 * 1000; // 1小时内使用增量同步

                // 读取同步策略配置
                const config = vscode.workspace.getConfiguration('AndreaNovelHelper.webdav.sync');
                const syncStrategy = config.get<'timestamp' | 'size' | 'both' | 'content'>('strategy', 'timestamp');
                const timeTolerance = config.get<number>('timeTolerance', 15000);
                const enableSmartComparison = config.get<boolean>('enableSmartComparison', true);
                const enableSidecar = config.get<boolean>('enableMetadataSidecar', true);
                const sidecarSuffix = config.get<string>('metadataSidecarSuffix', '.anhmeta.json');

                // 构建侧车数据映射（键为工作区内相对路径，posix风格）
                let metadataMap: SidecarDataMap = {};
                try {
                    // 1. 首先添加已追踪文件的完整数据
                    const trackedFiles = await getAllTrackedFilesAsync();
                    for (const m of trackedFiles) {
                        const rel = toPosix(path.relative(root, m.filePath));
                        if (!rel || rel.startsWith('..')) continue; // 只收录工作区内文件
                        metadataMap[rel] = createTrackedSidecarData(m, rel);
                    }

                    // 2. 然后扫描工作区中的所有文件，为未追踪文件创建基础侧车数据
                    const scanDirectory = (dirPath: string) => {
                        try {
                            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
                            for (const entry of entries) {
                                const fullPath = path.join(dirPath, entry.name);
                                const rel = toPosix(path.relative(root, fullPath));
                                
                                // 跳过已存在的追踪文件、超出工作区的文件、隐藏文件和特殊目录
                                if (!rel || rel.startsWith('..') || metadataMap[rel] || 
                                    entry.name.startsWith('.') || entry.name === 'node_modules') {
                                    continue;
                                }

                                try {
                                    const stats = fs.statSync(fullPath);
                                    const fileName = path.basename(fullPath);
                                    const fileExtension = path.extname(fullPath).toLowerCase();
                                    
                                    // 为未追踪文件创建基础侧车数据
                                    metadataMap[rel] = createUntrackedSidecarData(
                                        rel,
                                        fileName,
                                        fileExtension,
                                        stats.size,
                                        stats.mtimeMs,
                                        stats.isDirectory(),
                                        stats.birthtimeMs || stats.ctimeMs
                                    );

                                    // 递归扫描子目录
                                    if (stats.isDirectory()) {
                                        scanDirectory(fullPath);
                                    }
                                } catch (statError) {
                                    // 忽略无法访问的文件
                                    console.debug(`[WebDAV] 无法获取文件信息: ${fullPath}`, statError);
                                }
                            }
                        } catch (readError) {
                            console.debug(`[WebDAV] 无法读取目录: ${dirPath}`, readError);
                        }
                    };

                    // 开始扫描工作区根目录
                    scanDirectory(root);
                } catch (e) {
                    console.warn('[WebDAV] 构建侧车数据映射失败，继续同步流程:', e);
                    metadataMap = {};
                }

                // 更新同步状态
                this.syncStatusManager.updateProgress(10, 100, '正在同步文件...');
                
                const result = await this.sendMessage('webdav-sync', {
                    url: acc.url,
                    username: acc.username,
                    password: password,
                    direction: workerDirection,
                    localPath: root,
                    remotePath: remoteBase,
                    incremental: isIncremental,
                    lastSyncTime: lastSyncTime,
                    syncStrategy: syncStrategy,
                    timeTolerance: timeTolerance,
                    enableSmartComparison: enableSmartComparison,
                    // 侧车元数据支持
                    metadataMap: metadataMap,
                    enableSidecar: enableSidecar,
                    sidecarSuffix: sidecarSuffix
                });

                const successCount = result.results.filter((r: any) => r.success).length;
                const failCount = result.results.filter((r: any) => !r.success).length;
                
                // 记录详细结果
                for (const r of result.results) {
                    if (r.success) {
                        const arrow = r.action.type === 'upload' ? '↑' : r.action.type === 'download' ? '↓' : '';
                        out.appendLine(`[WebDAV] 成功 ${arrow} ${r.action.type} ${r.action.localPath}`);
                    } else {
                        const arrow = r.action.type === 'upload' ? '↑' : r.action.type === 'download' ? '↓' : '';
                        out.appendLine(`[WebDAV] 失败 ${arrow} ${r.action.type} ${r.action.localPath}: ${r.error}`);
                    }
                }

                out.appendLine(`[WebDAV] 完成：${successCount}/${result.totalActions} 成功`);
                
                // 保存同步时间
                if (result.syncTime) {
                    await this.context.workspaceState.update(`${WebDAVSyncService.LAST_SYNC_KEY}.${acc.id}`, result.syncTime);
                }
                
                const syncType = isIncremental ? '增量' : '完整';
                const completionMessage = failCount > 0 
                    ? `WebDAV ${syncType}同步完成，但有 ${failCount} 个错误：${successCount}/${result.totalActions} 成功`
                    : `WebDAV ${syncType}同步完成：${successCount} 个文件同步成功`;
                
                progressCallback?.onProgress?.(100, 100, completionMessage);
                progressCallback?.onComplete?.(failCount === 0, completionMessage);
                
                // 结束同步，更新状态
                this.syncStatusManager.endSync(completionMessage);
                
                if (failCount > 0) {
                    vscode.window.showWarningMessage(completionMessage);
                } else {
                    vscode.window.showInformationMessage(completionMessage);
                }
            });
        } catch (error) {
            out.appendLine(`[WebDAV] 同步失败: ${error}`);
            vscode.window.showErrorMessage(`WebDAV 同步失败: ${error}`);
            progressCallback?.onError?.(String(error));
            
            // 同步失败，结束状态
            this.syncStatusManager.endSync(`同步失败: ${error}`);
        }
    }

    async getFileList(accountId: string): Promise<any[]> {
        const am = new WebDAVAccountManager(this.context);
        const accounts = await am.getAccounts();
        const account = accounts.find(acc => acc.id === accountId);
        if (!account) {
            throw new Error('账户不存在');
        }

        const password = await am.getPassword(account.id);
        if (!password) {
            throw new Error('账户密码不存在');
        }

        const remoteBase = account.rootPath ? path.posix.join('/', account.rootPath).replace(/\\/g, '/') : '/';

        try {
            const result = await this.sendMessage('file-list', {
                url: account.url,
                username: account.username,
                password: password,
                dirPath: remoteBase
            });
            return result.files || [];
        } catch (error) {
            throw new Error(`获取文件列表失败: ${error}`);
        }
    }

    async getFileContent(accountId: string, remotePath: string): Promise<string> {
        console.log('[WebDAVSyncService] getFileContent 开始:', { accountId, remotePath });
        
        const am = new WebDAVAccountManager(this.context);
        const accounts = await am.getAccounts();
        const account = accounts.find(acc => acc.id === accountId);
        if (!account) {
            console.error('[WebDAVSyncService] 账户不存在:', accountId);
            throw new Error('账户不存在');
        }
        
        console.log('[WebDAVSyncService] 找到账户:', { name: account.name, url: account.url, rootPath: account.rootPath });

        const password = await am.getPassword(account.id);
        if (!password) {
            console.error('[WebDAVSyncService] 账户密码不存在:', account.id);
            throw new Error('账户密码不存在');
        }

        // 构建完整的远程路径
        let fullRemotePath = remotePath;
        if (account.rootPath && account.rootPath !== '/') {
            // 确保rootPath以/开头但不以/结尾
            const normalizedRootPath = account.rootPath.startsWith('/') ? account.rootPath : '/' + account.rootPath;
            const cleanRootPath = normalizedRootPath.endsWith('/') ? normalizedRootPath.slice(0, -1) : normalizedRootPath;
            
            // 确保remotePath以/开头
            const normalizedRemotePath = remotePath.startsWith('/') ? remotePath : '/' + remotePath;
            
            fullRemotePath = cleanRootPath + normalizedRemotePath;
        }
        
        console.log('[WebDAVSyncService] 完整远程路径:', fullRemotePath);

        try {
            const result = await this.sendMessage('webdav-file-read', {
                url: account.url,
                username: account.username,
                password: password,
                remotePath: fullRemotePath
            });
            console.log('[WebDAVSyncService] 文件内容获取成功');
            return result.content || '';
        } catch (error) {
            console.error('[WebDAVSyncService] 获取文件内容失败:', error);
            throw new Error(`获取文件内容失败: ${error}`);
        }
    }

    async getDirectoryFileList(accountId: string, dirPath: string): Promise<any[]> {
        console.log(`[WebDAV-Sync] getDirectoryFileList: 开始获取目录文件列表`, { accountId, dirPath });
        const am = new WebDAVAccountManager(this.context);
        const accounts = await am.getAccounts();
        const account = accounts.find(acc => acc.id === accountId);
        if (!account) {
            throw new Error('账户不存在');
        }
        console.log(`[WebDAV-Sync] getDirectoryFileList: 找到账户`, { accountName: account.name, accountUrl: account.url, accountRootPath: account.rootPath });

        const password = await am.getPassword(account.id);
        if (!password) {
            throw new Error('账户密码不存在');
        }

        // 构建完整的远程路径
        let fullRemotePath = dirPath;
        if (account.rootPath && account.rootPath !== '/') {
            // 确保rootPath以/开头但不以/结尾
            const normalizedRootPath = account.rootPath.startsWith('/') ? account.rootPath : '/' + account.rootPath;
            const cleanRootPath = normalizedRootPath.endsWith('/') ? normalizedRootPath.slice(0, -1) : normalizedRootPath;
            
            // 如果dirPath是根路径或等于rootPath，直接使用rootPath
            if (dirPath === '/' || dirPath === account.rootPath) {
                fullRemotePath = cleanRootPath;
            } else {
                // 确保dirPath以/开头
                const normalizedDirPath = dirPath.startsWith('/') ? dirPath : '/' + dirPath;
                
                // 如果dirPath已经包含rootPath，直接使用
                if (normalizedDirPath.startsWith(cleanRootPath)) {
                    fullRemotePath = normalizedDirPath;
                } else {
                    // 否则拼接rootPath和dirPath
                    fullRemotePath = cleanRootPath + normalizedDirPath;
                }
            }
        }
        
        console.log(`[WebDAV-Sync] getDirectoryFileList: 完整远程路径`, { originalDirPath: dirPath, fullRemotePath });

        try {
            console.log(`[WebDAV-Sync] getDirectoryFileList: 发送file-list消息`, {
                url: account.url,
                username: account.username,
                dirPath: fullRemotePath
            });
            const result = await this.sendMessage('file-list', {
                url: account.url,
                username: account.username,
                password: password,
                dirPath: fullRemotePath
            });
            console.log(`[WebDAV-Sync] getDirectoryFileList: 收到结果`, result);
            return result.files || [];
        } catch (error) {
            console.error(`[WebDAV-Sync] getDirectoryFileList: 获取失败`, error);
            throw new Error(`获取目录文件列表失败: ${error}`);
        }
    }

    /**
     * 设置文件加密密钥
     */
    async setEncryptionKey(key: string): Promise<void> {
        await this.sendMessage('set-encryption-key', { key });
    }

    /**
     * 清除文件加密密钥
     */
    async clearEncryptionKey(): Promise<void> {
        await this.sendMessage('set-encryption-key', { key: '' });
    }

    dispose(): void {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        this.pendingMessages.clear();
    }
}

function toPosix(p: string) {
    return p.replace(/\\/g, '/');
}