import * as vscode from 'vscode';
import * as path from 'path';
import { FileTracker, FileChangeEvent, initializeFileTracker, disposeFileTracker, getFileTracker } from './fileTracker';
import { FileTrackingDataManager, FileMetadata } from './fileTrackingData';

/**
 * 全局文件追踪管理器
 * 统一管理项目中所有文件的变化追踪，为备份、统计等功能提供基础
 */

// 文件追踪回调注册表
const callbackRegistry = new Map<string, Set<(event: FileChangeEvent) => void>>();

/**
 * 初始化全局文件追踪
 */
export function initializeGlobalFileTracking(context: vscode.ExtensionContext): void {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) {
        return;
    }

    // 获取配置
    const config = vscode.workspace.getConfiguration('AndreaNovelHelper.fileTracker');
    const respectWcignore = config.get<boolean>('respectWcignore', false);

    // 初始化文件追踪器
    const fileTracker = initializeFileTracker({
        workspaceRoot: ws,
        respectWcignore: respectWcignore
    });

    // 添加全局事件分发器
    fileTracker.addCallback((event: FileChangeEvent) => {
        // 分发给所有注册的回调
        for (const [moduleName, callbacks] of callbackRegistry) {
            for (const callback of callbacks) {
                try {
                    callback(event);
                } catch (error) {
                    console.error(`File tracking callback error in module ${moduleName}:`, error);
                }
            }
        }
    });

    // 启动追踪
    fileTracker.start();

    // 监听文件系统事件（用于处理删除和重命名）
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0];
    if (workspaceRoot) {
        // 监听文件删除
        const deleteWatcher = vscode.workspace.createFileSystemWatcher('**/*');
        deleteWatcher.onDidDelete((uri) => {
            const filePath = uri.fsPath;
            const dataManager = fileTracker.getDataManager();
            if (!dataManager) { return; }
            // 过滤内部/忽略目录：.git / novel-helper 数据文件自身
            const wsRoot = workspaceRoot.uri.fsPath;
            const gitDir = path.join(wsRoot, '.git');
            const trackerJson = path.join(wsRoot, 'novel-helper', 'file-tracking.json');
            const orderJson = path.join(wsRoot, 'novel-helper', 'wordcount-order.json');
            const resolved = path.resolve(filePath);
            if (resolved.startsWith(path.resolve(gitDir) + path.sep) ||
                resolved === path.resolve(gitDir) ||
                resolved === path.resolve(trackerJson) ||
                resolved === path.resolve(orderJson)) {
                return; // 忽略这些内部路径
            }
            if (dataManager.handleFileDeleted(filePath)) {
                console.log(`文件删除事件处理: ${filePath}`);
            }
        });
        
        context.subscriptions.push(deleteWatcher);

        // 监听文件重命名（通过创建事件检测）
        deleteWatcher.onDidCreate(async (uri) => {
            const filePath = uri.fsPath;
            const wsRoot = workspaceRoot.uri.fsPath;
            const gitDir = path.join(wsRoot, '.git');
            const trackerJson = path.join(wsRoot, 'novel-helper', 'file-tracking.json');
            const orderJson = path.join(wsRoot, 'novel-helper', 'wordcount-order.json');
            const resolved = path.resolve(filePath);
            if (resolved === path.resolve(trackerJson) || resolved === path.resolve(orderJson) ||
                resolved === path.resolve(gitDir) || resolved.startsWith(path.resolve(gitDir) + path.sep)) {
                return; // 忽略内部/ .git 创建
            }
            const dataManager = fileTracker.getDataManager();
            if (!dataManager) { return; }
            setTimeout(async () => {
                try {
                    await fileTracker.handleFileCreated(filePath);
                } catch (error) {
                    console.error(`处理文件创建事件时出错: ${filePath}`, error);
                }
            }, 100);
        });
    }

    // 监听配置变化
    const configWatcher = vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('AndreaNovelHelper.fileTracker')) {
            const newConfig = vscode.workspace.getConfiguration('AndreaNovelHelper.fileTracker');
            const newRespectWcignore = newConfig.get<boolean>('respectWcignore', false);
            
            fileTracker.updateConfig({
                respectWcignore: newRespectWcignore
            });
            
            vscode.window.showInformationMessage('文件追踪配置已更新');
        }
    });

    context.subscriptions.push(configWatcher);

    // 清理函数
    context.subscriptions.push({
        dispose: () => {
            disposeFileTracker();
            callbackRegistry.clear();
        }
    });
}

/**
 * 为模块注册文件变化回调
 * @param moduleName 模块名称（用于调试和错误处理）
 * @param callback 文件变化回调函数
 */
export function registerFileChangeCallback(moduleName: string, callback: (event: FileChangeEvent) => void): void {
    if (!callbackRegistry.has(moduleName)) {
        callbackRegistry.set(moduleName, new Set());
    }
    callbackRegistry.get(moduleName)!.add(callback);
}

/**
 * 取消模块的文件变化回调
 * @param moduleName 模块名称
 * @param callback 要取消的回调函数（可选，不指定则清除该模块的所有回调）
 */
export function unregisterFileChangeCallback(moduleName: string, callback?: (event: FileChangeEvent) => void): void {
    const callbacks = callbackRegistry.get(moduleName);
    if (!callbacks) {
        return;
    }

    if (callback) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
            callbackRegistry.delete(moduleName);
        }
    } else {
        callbackRegistry.delete(moduleName);
    }
}

/**
 * 获取当前追踪状态
 */
export function getTrackingStatus(): {
    isActive: boolean;
    trackedFiles: number;
    workspaceRoot: string | null;
} {
    const tracker = getFileTracker();
    if (!tracker) {
        return {
            isActive: false,
            trackedFiles: 0,
            workspaceRoot: null
        };
    }

    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return {
        isActive: tracker.isTracking(),
        trackedFiles: 0, // TODO: 可以添加计数逻辑
        workspaceRoot: ws || null
    };
}

/**
 * 手动扫描所有文件（用于初始化或重新同步）
 */
export async function scanAllFiles(): Promise<FileChangeEvent[]> {
    const tracker = getFileTracker();
    if (!tracker) {
        return [];
    }

    return await tracker.scanAllFiles();
}

/**
 * 为备份功能提供的便捷接口：获取所有被追踪的文件列表
 */
export async function getTrackedFileList(): Promise<string[]> {
    const tracker = getFileTracker();
    if (!tracker) {
        return [];
    }

    const dataManager = tracker.getDataManager();
    const files = dataManager.getAllFiles();
    return files.map(file => file.filePath);
}

/**
 * 获取所有文件的元数据
 */
export function getAllTrackedFiles(): FileMetadata[] {
    const tracker = getFileTracker();
    if (!tracker) {
        return [];
    }

    const dataManager = tracker.getDataManager();
    return dataManager.getAllFiles();
}

/**
 * 获取文件的 UUID
 */
export function getFileUuid(filePath: string): string | undefined {
    const tracker = getFileTracker();
    if (!tracker) {
        return undefined;
    }

    return tracker.getFileUuid(filePath);
}

/**
 * 通过 UUID 获取文件元数据
 */
export function getFileByUuid(uuid: string): FileMetadata | undefined {
    const tracker = getFileTracker();
    if (!tracker) {
        return undefined;
    }

    const dataManager = tracker.getDataManager();
    return dataManager.getFileByUuid(uuid);
}

/**
 * 通过路径获取文件元数据
 */
export function getFileByPath(filePath: string): FileMetadata | undefined {
    const tracker = getFileTracker();
    if (!tracker) {
        return undefined;
    }

    const dataManager = tracker.getDataManager();
    return dataManager.getFileByPath(filePath);
}

/**
 * 更新文件的写作统计（供 timeStats 使用）
 */
export function updateFileWritingStats(filePath: string, stats: {
    totalMillis?: number;
    charsAdded?: number;
    charsDeleted?: number;
    lastActiveTime?: number;
    sessionsCount?: number;
    averageCPM?: number;
    buckets?: { start: number; end: number; charsAdded: number }[];
    sessions?: { start: number; end: number }[];
}): void {
    const tracker = getFileTracker();
    if (tracker) {
        tracker.updateFileWritingStats(filePath, stats);
    }
}

/**
 * 获取追踪统计信息
 */
export function getTrackingStats(): {
    totalFiles: number;
    totalSize: number;
    filesByExtension: { [ext: string]: number };
    lastUpdated: number;
} | null {
    const tracker = getFileTracker();
    if (!tracker) {
        return null;
    }

    const dataManager = tracker.getDataManager();
    return dataManager.getStats();
}

/**
 * 检查文件是否被追踪（即是否会触发事件）
 */
export function isFileTracked(filePath: string): boolean {
    const tracker = getFileTracker();
    if (!tracker) {
        return false;
    }

    // 这里可以添加更具体的检查逻辑
    // 目前简单返回 tracker 是否活跃
    return tracker.isTracking();
}

/**
 * 获取全局文件追踪实例（供其他模块使用）
 */
export function getGlobalFileTracking(): {
    getFileUuid: (filePath: string) => string | undefined;
    getFileMetadata: (uuid: string) => FileMetadata | undefined;
    getFileByPath: (filePath: string) => FileMetadata | undefined;
    getWritingStats: (uuid: string) => any;
    getAllWritingStats: () => Array<{
        filePath: string;
        totalMillis: number;
        charsAdded: number;
        charsDeleted: number;
        lastActiveTime: number;
        sessionsCount: number;
        averageCPM: number;
        buckets?: { start: number; end: number; charsAdded: number }[];
        sessions?: { start: number; end: number }[];
    }>;
    markAsTemporary: (filePath: string) => void;
    markAsSaved: (filePath: string) => void;
} | null {
    const tracker = getFileTracker();
    if (!tracker) {
        return null;
    }

    const dataManager = tracker.getDataManager();
    
    return {
        getFileUuid: (filePath: string) => dataManager.getFileUuid(filePath),
        getFileMetadata: (uuid: string) => dataManager.getFileByUuid(uuid),
        getFileByPath: (filePath: string) => {
            const uuid = dataManager.getFileUuid(filePath);
            return uuid ? dataManager.getFileByUuid(uuid) : undefined;
        },
        getWritingStats: (uuid: string) => {
            const metadata = dataManager.getFileByUuid(uuid);
            return metadata?.writingStats;
        },
        getAllWritingStats: () => dataManager.getAllWritingStats(),
        markAsTemporary: (filePath: string) => dataManager.markAsTemporary(filePath),
        markAsSaved: (filePath: string) => dataManager.markAsSaved(filePath)
    };
}
