import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { CombinedIgnoreParser } from '../Parser/gitignoreParser';
import { isFileIgnored, IgnoreConfig } from '../ignoreUtils';
import { FileTrackingDataManager } from './fileTrackingData';

/**
 * 文件追踪器 - 负责追踪项目中所有文件的变化
 * 支持 .gitignore 和可选的 .wcignore 规则
 */

// 文件变化事件类型
export type FileChangeType = 'create' | 'change' | 'delete' | 'rename';

// 文件变化事件
export interface FileChangeEvent {
    type: FileChangeType;
    filePath: string;
    oldPath?: string; // 重命名时的旧路径
    timestamp: number;
    size?: number;
    mtime?: number;
}

// 文件追踪回调函数类型
export type FileChangeCallback = (event: FileChangeEvent) => void;

// 文件追踪器配置
export interface FileTrackerConfig {
    workspaceRoot: string;
    respectWcignore: boolean; // 是否遵循 .wcignore 规则
    includePatterns?: string[]; // 包含模式（glob）
    excludePatterns?: string[]; // 排除模式（glob）
}

/**
 * 文件追踪器类
 */
export class FileTracker {
    private config: FileTrackerConfig;
    private ignoreParser: CombinedIgnoreParser | null = null;
    private dataManager: FileTrackingDataManager;
    private watchers: vscode.FileSystemWatcher[] = [];
    private callbacks: FileChangeCallback[] = [];
    private isActive = false;
    private processingQueue: Promise<void> = Promise.resolve();

    constructor(config: FileTrackerConfig) {
        this.config = config;
        this.dataManager = new FileTrackingDataManager(config.workspaceRoot);
        this.initIgnoreParser();
    }

    /**
     * 初始化忽略文件解析器
     */
    private initIgnoreParser(): void {
        try {
            this.ignoreParser = new CombinedIgnoreParser(this.config.workspaceRoot);
        } catch (error) {
            console.warn('Failed to initialize ignore parser:', error);
            this.ignoreParser = null;
        }
    }

    /**
     * 刷新忽略解析器（当忽略文件变化时调用）
     */
    public refreshIgnoreParser(): void {
        this.initIgnoreParser();
    }

    /**
     * 检查文件是否应该被忽略
     */
    private shouldIgnoreFile(filePath: string): boolean {
        // 获取参考文件扩展名配置
        const refExts = (vscode.workspace.getConfiguration('AndreaNovelHelper')
            .get<string[]>('wordCount.referenceVisibleExtensions', []) || [])
            .map(s => (s || '').toLowerCase());
            
        return isFileIgnored(filePath, {
            workspaceRoot: this.config.workspaceRoot,
            respectWcignore: this.config.respectWcignore,
            includePatterns: this.config.includePatterns,
            excludePatterns: this.config.excludePatterns,
            ignoreParser: this.ignoreParser,
            ignoreReferenceFiles: true, // 启用参考文件忽略，防止生成数据库记录
            referenceExtensions: refExts
        });
    }

    /** 公共：判断某文件当前配置下是否会被追踪忽略（含 .git / 可选 .wcignore / 内部数据库与排除规则） */
    public isFileIgnored(filePath: string): boolean {
        return this.shouldIgnoreFile(filePath);
    }

    /**
     * 简单的 glob 模式匹配
     */
    // matchGlob 已由 ignoreUtils.ts 提供

    /**
     * 获取文件统计信息
     */
    private async getFileStats(filePath: string): Promise<{ size: number; mtime: number } | null> {
        try {
            const stats = await fs.promises.stat(filePath);
            return {
                size: stats.size,
                mtime: stats.mtimeMs
            };
        } catch (error) {
            return null;
        }
    }

    /**
     * 手动触发文件创建事件（公共接口）
     */
    public async handleFileCreated(filePath: string): Promise<void> {
        await this.triggerFileChange('create', filePath);
    }

    /**
     * 触发文件变化事件（异步处理）
     */
    private async triggerFileChange(type: FileChangeType, filePath: string, oldPath?: string): Promise<void> {
        if (this.shouldIgnoreFile(filePath)) {
            return;
        }

        // 将处理任务加入队列，避免阻塞 UI
        this.processingQueue = this.processingQueue.then(async () => {
            try {
                // 目录与文件分开处理，避免对目录做文件哈希导致 EISDIR
                let uuid: string | undefined;
                let statsInfo: { size: number; mtime: number } | null = null;
                if (type === 'delete') {
                    this.dataManager.removeFile(filePath);
                } else if (type === 'rename' && oldPath) {
                            this.dataManager.renameFile(oldPath, filePath);
                            // 如果是目录重命名，批量迁移子项
                            try {
                                const stat = await fs.promises.stat(filePath);
                                if (stat.isDirectory()) {
                                    this.dataManager.renameDirectoryChildren(oldPath, filePath);
                                }
                            } catch {/* ignore */}
                            uuid = await this.dataManager.getFileUuid(filePath);
                } else {
                    try {
                        const stat = await fs.promises.stat(filePath);
                        if (stat.isDirectory()) {
                            // 仅登记一次（若需要）
                            uuid = await this.dataManager.getFileUuid(filePath);
                            if (!uuid) {
                                // 为目录创建一个临时记录（无内容哈希）
                                uuid = await this.dataManager.addOrUpdateFile(filePath);
                            }
                            statsInfo = { size: stat.size, mtime: stat.mtimeMs };
                        } else {
                            uuid = await this.dataManager.addOrUpdateFile(filePath);
                            statsInfo = await this.getFileStats(filePath);
                        }
                    } catch (err) {
                        console.error('stat error', err);
                    }
                }

                const stats = statsInfo;
                const event: FileChangeEvent = {
                    type,
                    filePath,
                    oldPath,
                    timestamp: Date.now(),
                    size: stats?.size,
                    mtime: stats?.mtime
                };

                // 通知所有回调函数
                this.callbacks.forEach(callback => {
                    try {
                        callback(event);
                    } catch (error) {
                        console.error('File change callback error:', error);
                    }
                });
            } catch (error) {
                console.error(`Error processing file change for ${filePath}:`, error);
            }
        });
    }

    /**
     * 启动文件追踪
     */
    public start(): void {
        if (this.isActive) {
            return;
        }

        this.isActive = true;

        // 创建文件系统监听器
        const watcherPattern = new vscode.RelativePattern(this.config.workspaceRoot, '**/*');
        const watcher = vscode.workspace.createFileSystemWatcher(watcherPattern);

        // 监听文件创建
        watcher.onDidCreate(uri => {
            this.triggerFileChange('create', uri.fsPath);
        });

        // 监听文件修改
        watcher.onDidChange(uri => {
            this.triggerFileChange('change', uri.fsPath);
        });

        // 监听文件删除
        watcher.onDidDelete(uri => {
            this.triggerFileChange('delete', uri.fsPath);
        });

        this.watchers.push(watcher);

        // 监听文件重命名
        const renameWatcher = vscode.workspace.onDidRenameFiles(event => {
            event.files.forEach(file => {
                this.triggerFileChange('rename', file.newUri.fsPath, file.oldUri.fsPath);
            });
        });

        this.watchers.push(renameWatcher as any);

        // 监听忽略文件变化
        const gitignoreWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(this.config.workspaceRoot, '.gitignore')
        );
        gitignoreWatcher.onDidChange(() => this.refreshIgnoreParser());
        gitignoreWatcher.onDidCreate(() => this.refreshIgnoreParser());
        gitignoreWatcher.onDidDelete(() => this.refreshIgnoreParser());
        this.watchers.push(gitignoreWatcher);

        if (this.config.respectWcignore) {
            const wcignoreWatcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(this.config.workspaceRoot, '.wcignore')
            );
            wcignoreWatcher.onDidChange(() => this.refreshIgnoreParser());
            wcignoreWatcher.onDidCreate(() => this.refreshIgnoreParser());
            wcignoreWatcher.onDidDelete(() => this.refreshIgnoreParser());
            this.watchers.push(wcignoreWatcher);
        }
    }

    /**
     * 停止文件追踪
     */
    public stop(): void {
        if (!this.isActive) {
            return;
        }

        this.isActive = false;

        // 清理所有监听器
        this.watchers.forEach(watcher => {
            if (watcher && typeof watcher.dispose === 'function') {
                watcher.dispose();
            }
        });
        this.watchers = [];
    }

    /**
     * 添加文件变化回调
     */
    public addCallback(callback: FileChangeCallback): void {
        this.callbacks.push(callback);
    }

    /**
     * 移除文件变化回调
     */
    public removeCallback(callback: FileChangeCallback): void {
        const index = this.callbacks.indexOf(callback);
        if (index > -1) {
            this.callbacks.splice(index, 1);
        }
    }

    /**
     * 扫描所有文件（初始化时使用）
     */
    public async scanAllFiles(): Promise<FileChangeEvent[]> {
        const events: FileChangeEvent[] = [];

        const scanDirectory = async (dirPath: string): Promise<void> => {
            try {
                const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

                for (const entry of entries) {
                    const fullPath = path.join(dirPath, entry.name);

                    if (this.shouldIgnoreFile(fullPath)) {
                        continue;
                    }

                    if (entry.isDirectory()) {
                        await scanDirectory(fullPath);
                    } else if (entry.isFile()) {
                        try {
                            // 异步添加到数据库
                            const uuid = await this.dataManager.addOrUpdateFile(fullPath);
                            const stats = await this.getFileStats(fullPath);
                            if (stats) {
                                events.push({
                                    type: 'create',
                                    filePath: fullPath,
                                    timestamp: Date.now(),
                                    size: stats.size,
                                    mtime: stats.mtime
                                });
                            }
                        } catch (error) {
                            console.warn(`Failed to process file ${fullPath}:`, error);
                        }
                    }
                }
            } catch (error) {
                console.warn(`Failed to scan directory ${dirPath}:`, error);
            }
        };

        await scanDirectory(this.config.workspaceRoot);
        return events;
    }

    /**
     * 获取追踪状态
     */
    public isTracking(): boolean {
        return this.isActive;
    }

    /**
     * 更新配置
     */
    public updateConfig(newConfig: Partial<FileTrackerConfig>): void {
        const wasActive = this.isActive;
        
        if (wasActive) {
            this.stop();
        }

        this.config = { ...this.config, ...newConfig };
        this.initIgnoreParser();

        if (wasActive) {
            this.start();
        }
    }

    /**
     * 清理资源
     */
    public async dispose(): Promise<void> {
        this.stop();
        this.callbacks = [];
        await this.dataManager.dispose();
    }

    /**
     * 获取数据管理器（供其他模块使用）
     */
    public getDataManager(): FileTrackingDataManager {
        return this.dataManager;
    }

    /**
     * 获取文件的 UUID
     */
    public async getFileUuid(filePath: string): Promise<string | undefined> {
        return await this.dataManager.getFileUuid(filePath);
    }

    /**
     * 更新文件的写作统计（供 timeStats 使用）
     */
    public updateFileWritingStats(filePath: string, stats: {
        totalMillis?: number;
        charsAdded?: number;
        charsDeleted?: number;
        lastActiveTime?: number;
        sessionsCount?: number;
        averageCPM?: number;
        buckets?: { start: number; end: number; charsAdded: number }[];
        sessions?: { start: number; end: number }[];
        achievedMilestones?: number[]; // 已达成的里程碑目标
    }): void {
        this.dataManager.updateWritingStats(filePath, stats);
    }
}

/**
 * 全局文件追踪器实例
 */
let globalFileTracker: FileTracker | null = null;

/**
 * 获取全局文件追踪器实例
 */
export function getFileTracker(): FileTracker | null {
    return globalFileTracker;
}

/**
 * 初始化全局文件追踪器
 */
export function initializeFileTracker(config: FileTrackerConfig): FileTracker {
    if (globalFileTracker) {
        globalFileTracker.dispose();
    }

    globalFileTracker = new FileTracker(config);
    return globalFileTracker;
}

/**
 * 清理全局文件追踪器
 */
export function disposeFileTracker(): void {
    if (globalFileTracker) {
        globalFileTracker.dispose();
        globalFileTracker = null;
    }
}
