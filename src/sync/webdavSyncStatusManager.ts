import * as vscode from 'vscode';

export type WebDAVSyncStatus = 'idle' | 'syncing';

export interface WebDAVSyncStatusChangeEvent {
    status: WebDAVSyncStatus;
    message?: string;
    progress?: {
        current: number;
        total: number;
    };
}

/**
 * WebDAV同步状态管理器
 * 负责跟踪和通知WebDAV同步状态的变化
 */
export class WebDAVSyncStatusManager {
    private static instance: WebDAVSyncStatusManager | undefined;
    private _status: WebDAVSyncStatus = 'idle';
    private _onDidChangeStatus = new vscode.EventEmitter<WebDAVSyncStatusChangeEvent>();
    
    public readonly onDidChangeStatus = this._onDidChangeStatus.event;
    
    private constructor() {}
    
    public static getInstance(): WebDAVSyncStatusManager {
        if (!WebDAVSyncStatusManager.instance) {
            WebDAVSyncStatusManager.instance = new WebDAVSyncStatusManager();
        }
        return WebDAVSyncStatusManager.instance;
    }
    
    public get status(): WebDAVSyncStatus {
        return this._status;
    }
    
    public get isSyncing(): boolean {
        return this._status === 'syncing';
    }
    
    /**
     * 设置同步状态为开始同步
     * @param message 可选的状态消息
     */
    public startSync(message?: string): void {
        if (this._status === 'syncing') {
            return; // 已经在同步中，避免重复设置
        }
        
        this._status = 'syncing';
        this._onDidChangeStatus.fire({
            status: 'syncing',
            message: message || '正在同步...'
        });
    }
    
    /**
     * 更新同步进度
     * @param current 当前进度
     * @param total 总进度
     * @param message 可选的状态消息
     */
    public updateProgress(current: number, total: number, message?: string): void {
        if (this._status !== 'syncing') {
            return; // 只有在同步中才更新进度
        }
        
        this._onDidChangeStatus.fire({
            status: 'syncing',
            message: message || '正在同步...',
            progress: { current, total }
        });
    }
    
    /**
     * 设置同步状态为完成
     * @param message 可选的完成消息
     */
    public endSync(message?: string): void {
        if (this._status === 'idle') {
            return; // 已经是空闲状态
        }
        
        this._status = 'idle';
        this._onDidChangeStatus.fire({
            status: 'idle',
            message: message || '同步完成'
        });
    }
    
    /**
     * 释放资源
     */
    public dispose(): void {
        this._onDidChangeStatus.dispose();
    }
}