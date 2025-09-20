import * as vscode from 'vscode';
import { AutoGitUtils, GitStatus } from './autoGitUtils';

export interface HeadChangeEvent {
    oldCommit: string;
    newCommit: string;
    branch: string;
    timestamp: Date;
}

export interface MonitorOptions {
    intervalSeconds: number;
    enabled: boolean;
}

export class GitHeadMonitor {
    private _timer: NodeJS.Timeout | undefined;
    private _gitUtils: AutoGitUtils;
    private _options: MonitorOptions;
    private _lastStatus: GitStatus | undefined;
    private _outputChannel: vscode.OutputChannel;
    
    private _onHeadChanged = new vscode.EventEmitter<HeadChangeEvent>();
    public readonly onHeadChanged = this._onHeadChanged.event;
    
    private _onStatusChanged = new vscode.EventEmitter<GitStatus>();
    public readonly onStatusChanged = this._onStatusChanged.event;

    constructor(workspaceRoot: string, options: MonitorOptions) {
        this._gitUtils = new AutoGitUtils(workspaceRoot);
        this._options = options;
        this._outputChannel = vscode.window.createOutputChannel('ANH:GitHeadMonitor');
    }

    /**
     * 启动监听器
     */
    async start(): Promise<void> {
        if (this._timer) {
            this.stop();
        }

        if (!this._options.enabled) {
            this._log('监听器已禁用');
            return;
        }

        // 检查是否为Git仓库
        const isGitRepo = await this._gitUtils.isGitRepository();
        if (!isGitRepo) {
            this._log('当前工作区不是Git仓库');
            return;
        }

        // 获取初始状态
        try {
            this._lastStatus = await this._gitUtils.getGitStatus();
            this._log(`开始监听Git HEAD变更，当前提交: ${this._lastStatus.headCommit.substring(0, 8)}`);
            this._log(`当前分支: ${this._lastStatus.currentBranch}`);
            this._log(`检查间隔: ${this._options.intervalSeconds}秒`);
        } catch (error) {
            this._log(`获取初始Git状态失败: ${error}`);
            return;
        }

        // 启动定时器
        this._timer = setInterval(async () => {
            await this._checkForChanges();
        }, this._options.intervalSeconds * 1000);

        this._log('Git HEAD监听器已启动');
    }

    /**
     * 停止监听器
     */
    stop(): void {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = undefined;
            this._log('Git HEAD监听器已停止');
        }
    }

    /**
     * 更新监听器选项
     */
    updateOptions(options: Partial<MonitorOptions>): void {
        const oldEnabled = this._options.enabled;
        this._options = { ...this._options, ...options };
        
        this._log(`监听器选项已更新: ${JSON.stringify(this._options)}`);

        // 如果启用状态发生变化，重新启动或停止监听器
        if (oldEnabled !== this._options.enabled) {
            if (this._options.enabled) {
                this.start();
            } else {
                this.stop();
            }
        } else if (this._options.enabled && this._timer) {
            // 如果间隔时间发生变化，重新启动定时器
            this.stop();
            this.start();
        }
    }

    /**
     * 手动检查一次变更
     */
    async checkNow(): Promise<void> {
        await this._checkForChanges();
    }

    /**
     * 获取当前Git状态
     */
    async getCurrentStatus(): Promise<GitStatus | undefined> {
        try {
            return await this._gitUtils.getGitStatus();
        } catch (error) {
            this._log(`获取Git状态失败: ${error}`);
            return undefined;
        }
    }

    private async _checkForChanges(): Promise<void> {
        try {
            // 先检查远程更新（每次检查都fetch一次）
            await this._checkRemoteUpdates();
            
            const currentStatus = await this._gitUtils.getGitStatus();
            
            // 检查HEAD是否发生变更
            if (this._lastStatus && this._lastStatus.headCommit !== currentStatus.headCommit) {
                const changeEvent: HeadChangeEvent = {
                    oldCommit: this._lastStatus.headCommit,
                    newCommit: currentStatus.headCommit,
                    branch: currentStatus.currentBranch,
                    timestamp: new Date()
                };

                this._log(`检测到HEAD变更: ${changeEvent.oldCommit.substring(0, 8)} -> ${changeEvent.newCommit.substring(0, 8)}`);
                this._onHeadChanged.fire(changeEvent);
            }

            // 检查其他状态变更（包括远程状态变更）
            if (this._hasStatusChanged(this._lastStatus, currentStatus)) {
                this._log(`Git状态发生变更`);
                this._logStatusDiff(this._lastStatus, currentStatus);
                this._onStatusChanged.fire(currentStatus);
            }

            this._lastStatus = currentStatus;
        } catch (error) {
            this._log(`检查Git变更时发生错误: ${error}`);
        }
    }

    private async _checkRemoteUpdates(): Promise<void> {
        try {
            // 检查是否有远程仓库配置
            const hasRemote = await this._gitUtils.checkRemoteUpdates();
            if (hasRemote) {
                this._log('已检查远程更新');
            }
        } catch (error) {
            this._log(`检查远程更新时发生错误: ${error}`);
        }
    }

    private _hasStatusChanged(oldStatus: GitStatus | undefined, newStatus: GitStatus): boolean {
        if (!oldStatus) {
            return true;
        }

        return (
            oldStatus.hasChanges !== newStatus.hasChanges ||
            oldStatus.currentBranch !== newStatus.currentBranch ||
            oldStatus.remoteStatus !== newStatus.remoteStatus ||
            oldStatus.aheadCount !== newStatus.aheadCount ||
            oldStatus.behindCount !== newStatus.behindCount ||
            this._arraysDiffer(oldStatus.stagedFiles, newStatus.stagedFiles) ||
            this._arraysDiffer(oldStatus.unstagedFiles, newStatus.unstagedFiles) ||
            this._arraysDiffer(oldStatus.untrackedFiles, newStatus.untrackedFiles)
        );
    }

    private _arraysDiffer(arr1: string[], arr2: string[]): boolean {
        if (arr1.length !== arr2.length) {
            return true;
        }
        
        const sorted1 = [...arr1].sort();
        const sorted2 = [...arr2].sort();
        
        for (let i = 0; i < sorted1.length; i++) {
            if (sorted1[i] !== sorted2[i]) {
                return true;
            }
        }
        
        return false;
    }

    private _logStatusDiff(oldStatus: GitStatus | undefined, newStatus: GitStatus): void {
        if (!oldStatus) {
            this._log(`初始状态: 分支=${newStatus.currentBranch}, 变更=${newStatus.hasChanges}`);
            return;
        }

        const changes: string[] = [];

        if (oldStatus.currentBranch !== newStatus.currentBranch) {
            changes.push(`分支: ${oldStatus.currentBranch} -> ${newStatus.currentBranch}`);
        }

        if (oldStatus.hasChanges !== newStatus.hasChanges) {
            changes.push(`有变更: ${oldStatus.hasChanges} -> ${newStatus.hasChanges}`);
        }

        if (oldStatus.remoteStatus !== newStatus.remoteStatus) {
            changes.push(`远程状态: ${oldStatus.remoteStatus} -> ${newStatus.remoteStatus}`);
        }

        if (oldStatus.aheadCount !== newStatus.aheadCount) {
            changes.push(`领先提交: ${oldStatus.aheadCount} -> ${newStatus.aheadCount}`);
        }

        if (oldStatus.behindCount !== newStatus.behindCount) {
            changes.push(`落后提交: ${oldStatus.behindCount} -> ${newStatus.behindCount}`);
        }

        if (this._arraysDiffer(oldStatus.stagedFiles, newStatus.stagedFiles)) {
            changes.push(`暂存文件: ${oldStatus.stagedFiles.length} -> ${newStatus.stagedFiles.length}`);
        }

        if (this._arraysDiffer(oldStatus.unstagedFiles, newStatus.unstagedFiles)) {
            changes.push(`未暂存文件: ${oldStatus.unstagedFiles.length} -> ${newStatus.unstagedFiles.length}`);
        }

        if (this._arraysDiffer(oldStatus.untrackedFiles, newStatus.untrackedFiles)) {
            changes.push(`未跟踪文件: ${oldStatus.untrackedFiles.length} -> ${newStatus.untrackedFiles.length}`);
        }

        if (changes.length > 0) {
            this._log(`状态变更: ${changes.join(', ')}`);
        }
    }

    private _log(message: string): void {
        const timestamp = new Date().toLocaleString();
        this._outputChannel.appendLine(`[${timestamp}] ${message}`);
    }

    /**
     * 获取监听器状态
     */
    getStatus(): { running: boolean; options: MonitorOptions; lastCheck?: Date } {
        return {
            running: this._timer !== undefined,
            options: this._options,
            lastCheck: this._lastStatus ? new Date() : undefined
        };
    }

    dispose(): void {
        this.stop();
        this._onHeadChanged.dispose();
        this._onStatusChanged.dispose();
        this._outputChannel.dispose();
        this._gitUtils.dispose();
    }
}