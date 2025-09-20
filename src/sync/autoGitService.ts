import * as vscode from 'vscode';
import { AutoGitUtils, GitStatus, CommitOptions } from '../utils/Git/autoGitUtils';
import { GitHeadMonitor, HeadChangeEvent, MonitorOptions } from '../utils/Git/gitHeadMonitor';
import { WebDAVSyncService } from './webdavSync';
import { WebDAVSyncStatusManager, WebDAVSyncStatusChangeEvent } from './webdavSyncStatusManager';

export interface AutoGitConfig {
    enabled: boolean;
    checkIntervalSeconds: number;
    commitMessageTemplate: string;
    autoPull: boolean;
    autoPush: boolean;
    includeUntracked: boolean;
    excludePatterns: string[];
}

export interface AutoGitServiceStatus {
    enabled: boolean;
    gitStatus?: GitStatus;
    lastCommit?: { hash: string; message: string; date: Date };
    lastCheck?: Date;
    monitorRunning: boolean;
}

export class AutoGitService {
    private _context: vscode.ExtensionContext;
    private _workspaceRoot: string;
    private _gitUtils: AutoGitUtils;
    private _headMonitor: GitHeadMonitor;
    private _webdavSync?: WebDAVSyncService;
    private _config: AutoGitConfig;
    private _outputChannel: vscode.OutputChannel;
    private _statusBarItem: vscode.StatusBarItem;
    private _fileWatcher?: vscode.FileSystemWatcher;
    private _autoCommitTimer?: NodeJS.Timeout;
    private _isProcessingAutoCommit: boolean = false; // 添加处理状态标志
    private _webdavStatusManager: WebDAVSyncStatusManager;
    private _webdavStatusListener?: vscode.Disposable;
    private _webdavAutoSyncEnabled: boolean;
    private _lastWebdavStatus?: WebDAVSyncStatusChangeEvent;
    
    private _onStatusChanged = new vscode.EventEmitter<AutoGitServiceStatus>();
    public readonly onStatusChanged = this._onStatusChanged.event;

    constructor(context: vscode.ExtensionContext, workspaceRoot: string) {
        this._context = context;
        this._workspaceRoot = workspaceRoot;
        this._gitUtils = new AutoGitUtils(workspaceRoot);
        this._outputChannel = vscode.window.createOutputChannel('ANH:AutoGit Service');
        
        // 创建状态栏项
        this._statusBarItem = vscode.window.createStatusBarItem('andrea.autoGitSync', vscode.StatusBarAlignment.Left, 1000);
        this._statusBarItem.name = 'ANH:Sync 状态';
        this._statusBarItem.command = 'andrea.autoGit.showStatus';
        context.subscriptions.push(this._statusBarItem);

        // WebDAV状态管理
        this._webdavStatusManager = WebDAVSyncStatusManager.getInstance();
        this._webdavAutoSyncEnabled = this._getWebDavAutoSyncEnabled();
        const webdavListener = this._webdavStatusManager.onDidChangeStatus(event => {
            this._lastWebdavStatus = event;
            this._updateStatusBar();
        });
        context.subscriptions.push(webdavListener);
        this._webdavStatusListener = webdavListener;

        // 加载配置
        this._config = this._loadConfig();
        
        // 创建HEAD监听器
        this._headMonitor = new GitHeadMonitor(workspaceRoot, {
            intervalSeconds: this._config.checkIntervalSeconds,
            enabled: this._config.enabled
        });

        // 监听配置变更
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('AndreaNovelHelper.autoGit')) {
                    this._onConfigChanged();
                }
                if (e.affectsConfiguration('AndreaNovelHelper.webdav.sync.autoSync')) {
                    this._webdavAutoSyncEnabled = this._getWebDavAutoSyncEnabled();
                    this._updateStatusBar();
                }
            })
        );

        // 监听HEAD变更
        context.subscriptions.push(
            this._headMonitor.onHeadChanged(this._onHeadChanged.bind(this))
        );

        // 监听Git状态变更
        context.subscriptions.push(
            this._headMonitor.onStatusChanged(this._onGitStatusChanged.bind(this))
        );

        this._updateStatusBar();
    }

    /**
     * 启动AutoGit服务
     */
    async start(): Promise<void> {
        this._log('启动AutoGit服务');
        
        if (!this._config.enabled) {
            this._log('AutoGit功能已禁用');
            return;
        }

        // 检查是否为Git仓库
        const isGitRepo = await this._gitUtils.isGitRepository();
        if (!isGitRepo) {
            this._log('当前工作区不是Git仓库，无法启动AutoGit服务');
            vscode.window.showWarningMessage('当前工作区不是Git仓库，AutoGit功能无法使用');
            return;
        }

        // 启动HEAD监听器
        await this._headMonitor.start();
        
        // 启动文件变更监听器
        this._startFileWatcher();
        
        this._log('AutoGit服务已启动');
        this._updateStatusBar();
        this._fireStatusChanged();
    }

    /**
     * 停止AutoGit服务
     */
    stop(): void {
        this._log('停止AutoGit服务');
        this._headMonitor.stop();
        this._stopFileWatcher();
        this._updateStatusBar();
        this._fireStatusChanged();
    }

    /**
     * 手动执行提交
     */
    async manualCommit(): Promise<boolean> {
        this._log('执行手动提交');
        
        try {
            const commitOptions: CommitOptions = {
                message: this._config.commitMessageTemplate,
                includeUntracked: this._config.includeUntracked,
                excludePatterns: this._config.excludePatterns
            };

            const success = await this._gitUtils.autoCommit(commitOptions);
            
            if (success) {
                this._log('手动提交成功');
                
                // 如果启用了自动推送，执行推送
                if (this._config.autoPush) {
                    await this._pushChanges();
                }
                
                // 触发WebDAV同步
                await this._triggerWebDAVSync();
                
                vscode.window.showInformationMessage('AutoGit: 手动提交成功');
            } else {
                this._log('手动提交失败或没有变更需要提交');
                vscode.window.showInformationMessage('AutoGit: 没有变更需要提交');
            }
            
            this._fireStatusChanged();
            return success;
        } catch (error) {
            this._log(`手动提交失败: ${error}`);
            vscode.window.showErrorMessage(`AutoGit手动提交失败: ${error}`);
            return false;
        }
    }

    /**
     * 手动执行同步（拉取+推送）
     */
    async manualSync(): Promise<boolean> {
        this._log('执行手动同步');
        
        try {
            let success = true;
            
            // 先拉取远程变更
            if (this._config.autoPull) {
                const pullSuccess = await this._pullChanges();
                if (!pullSuccess) {
                    success = false;
                }
            }
            
            // 检查是否有本地变更需要提交
            const status = await this._gitUtils.getGitStatus();
            if (status.hasChanges) {
                const commitSuccess = await this.manualCommit();
                if (!commitSuccess) {
                    success = false;
                }
            }
            
            // 推送变更
            if (this._config.autoPush) {
                const pushSuccess = await this._pushChanges();
                if (!pushSuccess) {
                    success = false;
                }
            }
            
            // 触发WebDAV同步
            await this._triggerWebDAVSync();
            
            if (success) {
                this._log('手动同步成功');
                vscode.window.showInformationMessage('AutoGit: 手动同步成功');
            } else {
                this._log('手动同步部分失败');
                vscode.window.showWarningMessage('AutoGit: 手动同步部分失败，请查看输出日志');
            }
            
            this._fireStatusChanged();
            return success;
        } catch (error) {
            this._log(`手动同步失败: ${error}`);
            vscode.window.showErrorMessage(`AutoGit手动同步失败: ${error}`);
            return false;
        }
    }

    /**
     * 获取服务状态
     */
    async getStatus(): Promise<AutoGitServiceStatus> {
        const gitStatus = await this._headMonitor.getCurrentStatus();
        const lastCommit = await this._gitUtils.getLastCommitInfo();
        const monitorStatus = this._headMonitor.getStatus();
        
        return {
            enabled: this._config.enabled,
            gitStatus,
            lastCommit: lastCommit || undefined,
            lastCheck: monitorStatus.lastCheck,
            monitorRunning: monitorStatus.running
        };
    }

    /**
     * 设置WebDAV同步服务
     */
    setWebDAVSyncService(webdavSync: WebDAVSyncService): void {
        this._webdavSync = webdavSync;
        this._updateStatusBar();
    }

    private async _onHeadChanged(event: HeadChangeEvent): Promise<void> {
        this._log(`检测到HEAD变更: ${event.oldCommit.substring(0, 8)} -> ${event.newCommit.substring(0, 8)}`);
        
        // 如果启用了自动拉取，检查是否需要拉取远程变更
        if (this._config.autoPull) {
            const hasRemoteUpdates = await this._gitUtils.checkRemoteUpdates();
            if (hasRemoteUpdates) {
                await this._pullChanges();
            }
        }
        
        // 触发WebDAV同步
        await this._triggerWebDAVSync();
        
        this._fireStatusChanged();
    }

    private async _onGitStatusChanged(status: GitStatus): Promise<void> {
        this._log(`Git状态发生变更: 有变更=${status.hasChanges}, 远程状态=${status.remoteStatus}`);
        
        // 如果有本地变更，自动提交
        if (status.hasChanges && this._config.enabled) {
            // 防止重复处理
            if (this._isProcessingAutoCommit) {
                this._log('自动提交正在处理中，跳过此次请求');
                return;
            }

            this._isProcessingAutoCommit = true;
            
            try {
                const commitOptions: CommitOptions = {
                    message: this._config.commitMessageTemplate,
                    includeUntracked: this._config.includeUntracked,
                    excludePatterns: this._config.excludePatterns
                };

                const commitSuccess = await this._gitUtils.autoCommit(commitOptions);
                
                if (commitSuccess) {
                    this._log('自动提交成功');
                    if (this._config.autoPush) {
                        await this._pushChanges();
                    }
                } else {
                    this._log('自动提交失败或没有符合条件的文件');
                }
            } finally {
                this._isProcessingAutoCommit = false;
            }
        }
        
        this._updateStatusBar();
        this._fireStatusChanged();
    }

    private async _pullChanges(): Promise<boolean> {
        try {
            this._log('执行自动拉取');
            const success = await this._gitUtils.pullFromRemote();
            if (success) {
                this._log('自动拉取成功');
            } else {
                this._log('自动拉取失败');
            }
            return success;
        } catch (error) {
            this._log(`自动拉取失败: ${error}`);
            return false;
        }
    }

    private async _pushChanges(): Promise<boolean> {
        try {
            this._log('执行自动推送');
            const success = await this._gitUtils.pushToRemote();
            if (success) {
                this._log('自动推送成功');
            } else {
                this._log('自动推送失败');
            }
            return success;
        } catch (error) {
            this._log(`自动推送失败: ${error}`);
            return false;
        }
    }

    private async _triggerWebDAVSync(): Promise<void> {
        if (this._webdavSync) {
            try {
                this._log('触发WebDAV同步');
                // 这里可以调用WebDAV同步服务的方法
                // await this._webdavSync.performSync();
            } catch (error) {
                this._log(`WebDAV同步失败: ${error}`);
            }
        }
    }

    private _onConfigChanged(): void {
        this._log('配置发生变更，重新加载配置');
        const newConfig = this._loadConfig();
        const oldEnabled = this._config.enabled;
        
        this._config = newConfig;
        
        // 更新HEAD监听器配置
        this._headMonitor.updateOptions({
            intervalSeconds: this._config.checkIntervalSeconds,
            enabled: this._config.enabled
        });
        
        // 如果启用状态发生变化
        if (oldEnabled !== this._config.enabled) {
            if (this._config.enabled) {
                this.start();
            } else {
                this.stop();
            }
        }
        
        this._updateStatusBar();
        this._fireStatusChanged();
    }

    private _loadConfig(): AutoGitConfig {
        const config = vscode.workspace.getConfiguration('AndreaNovelHelper.autoGit');
        
        return {
            enabled: config.get('enabled', false),
            checkIntervalSeconds: config.get('checkIntervalSeconds', 30),
            commitMessageTemplate: config.get('commitMessageTemplate', 'Auto commit: {timestamp}'),
            autoPull: config.get('autoPull', true),
            autoPush: config.get('autoPush', true),
            includeUntracked: config.get('includeUntracked', true), // 默认包含未跟踪文件
            excludePatterns: config.get('excludePatterns', ['*.tmp', '*.log', '.DS_Store', 'Thumbs.db'])
        };
    }

    private _updateStatusBar(): void {
        const gitEnabled = this._config.enabled;
        const webdavEnabled = this._webdavAutoSyncEnabled;
        const webdavSyncing = this._webdavStatusManager.status === 'syncing';
        const gitState = gitEnabled ? 'ON' : 'OFF';
        const webdavState = webdavSyncing ? 'SYNC' : (webdavEnabled ? 'ON' : 'OFF');
        const leadingIcon = webdavSyncing ? '$(sync~spin)' : (gitEnabled || webdavEnabled ? '$(rocket)' : '$(debug-disconnect)');
        // 如果启用了简洁模式，则仅显示 ANH:Sync（保留图标和颜色）
        const compact = vscode.workspace.getConfiguration('AndreaNovelHelper.autoGit').get<boolean>('compactStatus', false);
        if (compact) {
            // 在简洁模式下仅隐藏详细文本，但保留图标和颜色逻辑
            this._statusBarItem.text = `${leadingIcon} ANH:Sync`;
            // 使用较简短的 tooltip，但仍允许显示 WebDAV 进度/信息在 hover 时
            const tooltipLinesCompact = [`ANH:Sync（简洁模式）`, `AutoGit: ${gitEnabled ? '已启用' : '已禁用'}`];
            if (this._lastWebdavStatus?.message) {
                tooltipLinesCompact.push(`WebDAV 状态: ${this._lastWebdavStatus.message}`);
            }
            const progressCompact = this._lastWebdavStatus?.progress;
            if (progressCompact && progressCompact.total > 0) {
                tooltipLinesCompact.push(`WebDAV 进度: ${progressCompact.current}/${progressCompact.total}`);
            }
            this._statusBarItem.tooltip = tooltipLinesCompact.join('\n');
        } else {
            this._statusBarItem.text = `${leadingIcon} ANH:Sync Git:${gitState} WebDAV:${webdavState}`;
            const tooltipLines = [
                `AutoGit: ${gitEnabled ? '已启用' : '已禁用'}`,
                `WebDAV 自动同步: ${webdavEnabled ? '已启用' : '已禁用'}`
            ];
            if (this._lastWebdavStatus?.message) {
                tooltipLines.push(`WebDAV 状态: ${this._lastWebdavStatus.message}`);
            }
            const progress = this._lastWebdavStatus?.progress;
            if (progress && progress.total > 0) {
                tooltipLines.push(`WebDAV 进度: ${progress.current}/${progress.total}`);
            }
            this._statusBarItem.tooltip = tooltipLines.join('\n');
        }
        const tooltipLines = [
            `AutoGit: ${gitEnabled ? '已启用' : '已禁用'}`,
            `WebDAV 自动同步: ${webdavEnabled ? '已启用' : '已禁用'}`
        ];
        if (this._lastWebdavStatus?.message) {
            tooltipLines.push(`WebDAV 状态: ${this._lastWebdavStatus.message}`);
        }
        const progress = this._lastWebdavStatus?.progress;
        if (progress && progress.total > 0) {
            tooltipLines.push(`WebDAV 进度: ${progress.current}/${progress.total}`);
        }
        this._statusBarItem.tooltip = tooltipLines.join('\n');
        if (webdavSyncing) {
            this._statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
            this._statusBarItem.color = new vscode.ThemeColor('statusBarItem.prominentForeground');
        } else if (gitEnabled && webdavEnabled) {
            this._statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.remoteBackground');
            this._statusBarItem.color = new vscode.ThemeColor('statusBarItem.remoteForeground');
        } else if (gitEnabled || webdavEnabled) {
            this._statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            this._statusBarItem.color = undefined;
        } else {
            this._statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
            this._statusBarItem.color = undefined;
        }
        this._statusBarItem.show();
    }

    private _getWebDavAutoSyncEnabled(): boolean {
        const config = vscode.workspace.getConfiguration('AndreaNovelHelper.webdav.sync.autoSync');
        return config.get('enabled', false);
    }

    private _fireStatusChanged(): void {
        this.getStatus().then(status => {
            this._onStatusChanged.fire(status);
        });
    }

    /**
     * 设置远程仓库
     */
    async setupRemoteRepository(remoteUrl: string): Promise<void> {
        try {
            // 检查是否已有origin远程仓库
            try {
                await this._gitUtils._execGit('remote get-url origin');
                // 如果已存在，更新URL
                await this._gitUtils._execGit(`remote set-url origin ${remoteUrl}`);
                this._log(`已更新远程仓库地址: ${remoteUrl}`);
            } catch {
                // 如果不存在，添加新的origin
                await this._gitUtils._execGit(`remote add origin ${remoteUrl}`);
                this._log(`已添加远程仓库: ${remoteUrl}`);
            }

            // 尝试推送当前分支到远程
            const status = await this._gitUtils.getGitStatus();
            if (status.currentBranch) {
                try {
                    await this._gitUtils._execGit(`push -u origin ${status.currentBranch}`);
                    this._log(`已推送分支 ${status.currentBranch} 到远程仓库`);
                } catch (pushError) {
                    this._log(`推送失败，但远程仓库已设置: ${pushError}`);
                }
            }

            this._fireStatusChanged();
        } catch (error) {
            this._log(`设置远程仓库失败: ${error}`);
            throw error;
        }
    }

    private _log(message: string): void {
        const timestamp = new Date().toLocaleString();
        this._outputChannel.appendLine(`[${timestamp}] ${message}`);
    }

    dispose(): void {
        this._headMonitor.dispose();
        this._gitUtils.dispose();
        this._outputChannel.dispose();
        this._stopFileWatcher();
        if (this._autoCommitTimer) {
            clearTimeout(this._autoCommitTimer);
        }
        this._statusBarItem.dispose();
        this._webdavStatusListener?.dispose();
        this._onStatusChanged.dispose();
    }

    /**
     * 启动文件变更监听器
     */
    private _startFileWatcher(): void {
        if (this._fileWatcher) {
            return;
        }

        // 监听工作区中的所有文件变更（排除.git目录）
        const pattern = new vscode.RelativePattern(this._workspaceRoot, '**/*');
        this._fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

        // 监听文件创建、修改、删除事件
        this._fileWatcher.onDidCreate(() => this._scheduleAutoCommit());
        this._fileWatcher.onDidChange(() => this._scheduleAutoCommit());
        this._fileWatcher.onDidDelete(() => this._scheduleAutoCommit());

        this._log('文件变更监听器已启动');
    }

    /**
     * 停止文件变更监听器
     */
    private _stopFileWatcher(): void {
        if (this._fileWatcher) {
            this._fileWatcher.dispose();
            this._fileWatcher = undefined;
            this._log('文件变更监听器已停止');
        }

        if (this._autoCommitTimer) {
            clearTimeout(this._autoCommitTimer);
            this._autoCommitTimer = undefined;
        }
    }

    /**
     * 调度自动提交（防抖处理）
     */
    private _scheduleAutoCommit(): void {
        if (!this._config.enabled) {
            return;
        }

        // 清除之前的定时器
        if (this._autoCommitTimer) {
            clearTimeout(this._autoCommitTimer);
        }

        // 设置新的定时器，延迟执行自动提交（防抖）
        this._autoCommitTimer = setTimeout(async () => {
            await this._checkAndAutoCommit();
        }, 3000); // 3秒延迟，避免频繁提交
    }

    /**
     * 检查并执行自动提交
     */
    private async _checkAndAutoCommit(): Promise<void> {
        // 防止重复处理
        if (this._isProcessingAutoCommit) {
            this._log('自动提交正在处理中，跳过此次检查');
            return;
        }

        try {
            const status = await this._gitUtils.getGitStatus();
            if (status.hasChanges) {
                this._log('检测到文件变更，执行自动提交');
                await this._onGitStatusChanged(status);
            } else {
                this._log('没有文件变更，跳过自动提交');
            }
        } catch (error) {
             this._log(`自动提交检查失败: ${error}`);
         }
     }
}