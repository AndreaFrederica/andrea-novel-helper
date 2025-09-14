import * as vscode from 'vscode';
import { FileChangeEvent, initializeFileTracker, disposeFileTracker, getFileTracker } from './fileTracker';
import { FileMetadata } from './fileTrackingData';

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
            // 统一过滤：只处理允许类型
            if (fileTracker.isFileIgnored(filePath)) {
                return;
            }
            if (dataManager.handleFileDeleted(filePath)) {
                console.log(`文件删除事件处理: ${filePath}`);
            }
        });

        context.subscriptions.push(deleteWatcher);

        // 监听文件重命名（通过创建事件检测）
        deleteWatcher.onDidCreate(async (uri) => {
            const filePath = uri.fsPath;
            const dataManager = fileTracker.getDataManager();
            if (!dataManager) { return; }
            // 统一过滤：只处理允许类型
            if (fileTracker.isFileIgnored(filePath)) {
                return;
            }
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
    
    const uuid = tracker.getFileUuid(filePath);
    return uuid;
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
    achievedMilestones?: number[]; // 已达成的里程碑目标
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


// ====== 新增：统一的异步类型 ======
export type WritingStatsView = {
    filePath: string;
    totalMillis: number;
    charsAdded: number;
    charsDeleted: number;
    lastActiveTime: number;
    sessionsCount: number;
    averageCPM: number;
    buckets?: { start: number; end: number; charsAdded: number }[];
    sessions?: { start: number; end: number }[];
};

// ====== 新增：异步便捷函数 ======

/** 异步：获取所有被追踪的文件路径列表 */
export async function getTrackedFileListAsync(): Promise<string[]> {
    const tracker = getFileTracker();
    if (!tracker) {return [];}
    const dm = tracker.getDataManager();

    // 优先走异步分片枚举
    const getAllFilesAsync = (dm as any).getAllFilesAsync as (opts?: { cacheLoaded?: boolean }) => Promise<FileMetadata[]>;
    if (typeof getAllFilesAsync === 'function') {
        const files = await getAllFilesAsync({ cacheLoaded: true });
        return files.map(f => f.filePath);
    }
    // 回退同步
    return dm.getAllFiles().map(f => f.filePath);
}

/** 异步：获取所有文件的元数据 */
export async function getAllTrackedFilesAsync(): Promise<FileMetadata[]> {
    const tracker = getFileTracker();
    if (!tracker) {return [];}
    const dm = tracker.getDataManager();

    const getAllFilesAsync = (dm as any).getAllFilesAsync as (opts?: { cacheLoaded?: boolean }) => Promise<FileMetadata[]>;
    if (typeof getAllFilesAsync === 'function') {
        return await getAllFilesAsync({ cacheLoaded: true });
    }
    return dm.getAllFiles();
}

/** 异步：获取追踪统计信息 */
export async function getTrackingStatsAsync(): Promise<{
    totalFiles: number;
    totalSize: number;
    filesByExtension: { [ext: string]: number };
    lastUpdated: number;
} | null> {
    const tracker = getFileTracker();
    if (!tracker) {return null;}
    const dm = tracker.getDataManager();

    const getStatsAsync = (dm as any).getStatsAsync as () => Promise<{
        totalFiles: number; totalSize: number; filesByExtension: { [ext: string]: number }; lastUpdated: number;
    }>;
    if (typeof getStatsAsync === 'function') {
        return await getStatsAsync();
    }
    return dm.getStats();
}

/** 异步：一次性获取全部写作统计（这里只取快路径的第一批） */
export async function getAllWritingStatsAsync(): Promise<WritingStatsView[]> {
    const tracker = getFileTracker();
    if (!tracker) {return [];}
    const dm: any = tracker.getDataManager();

    const fn = dm?.getAllWritingStatsAsync;
    if (typeof fn === 'function') {
        // 只等第一次 onPartial（就是快路径 fast 批次），随后立刻 resolve
        return await new Promise<WritingStatsView[]>((resolve) => {
            let resolved = false;

            // 启动 DataManager 的并发流程，但我们不等待最终 Promise
            // 只在第一次 onPartial 时返回
            try {
                fn.call(dm, {
                    onPartial: (chunk: WritingStatsView[]) => {
                        if (!resolved) {
                            resolved = true;
                            resolve(chunk ?? []);
                        }
                    },
                    flushIntervalMs: 0, // 让第一次回调更及时；你实现里会 flush(true) 立即触发
                }).catch(() => { /* 忽略慢路径的错误，反正我们不等它 */ });
            } catch {
                // 若签名不匹配或抛错，直接返回空
                if (!resolved) {resolve([]);}
            }

            // 兜底：若没有快路径（fast 为空），下一轮事件循环返回空
            //（即只要没立即触发 onPartial，就视为无快路径）
            setTimeout(() => {
                if (!resolved) {resolve([]);}
            }, 0);
        });
    }

    // 老版本 DataManager：没有异步方法时走同步快路径（仅内存）
    return typeof dm.getAllWritingStats === 'function' ? dm.getAllWritingStats() : [];
}


/** 异步生成器：流式产出写作统计（适合大仓库渐进展示） */
export async function* streamAllWritingStats(): AsyncGenerator<WritingStatsView> {
    const tracker = getFileTracker();
    if (!tracker) {return;}
    const dm = tracker.getDataManager();

    const streamDM = (dm as any).streamWritingStats as () => AsyncGenerator<WritingStatsView>;
    if (typeof streamDM === 'function') {
        for await (const item of streamDM()) {
            yield item;
        }
        return;
    }
    // 回退：同步数组 -> 逐条 yield
    const all = dm.getAllWritingStats();
    for (const item of all) {yield item;}
}

/** 异步：通过 UUID 获取元数据（非阻塞） */
export async function getFileByUuidAsync(uuid: string): Promise<FileMetadata | undefined> {
    const tracker = getFileTracker();
    if (!tracker) {return undefined;}
    const dm = tracker.getDataManager();

    // 若 DataManager 没有公开异步单项读取，则用异步全量再筛选（保证不阻塞）
    const getAllFilesAsync = (dm as any).getAllFilesAsync as (opts?: { cacheLoaded?: boolean }) => Promise<FileMetadata[]>;
    if (typeof getAllFilesAsync === 'function') {
        const files = await getAllFilesAsync({ cacheLoaded: true });
        return files.find(f => f.uuid === uuid);
    }
    // 回退：同步（可能阻塞）
    return dm.getFileByUuid(uuid);
}

/** 异步：通过路径获取元数据（非阻塞） */
export async function getFileByPathAsync(filePath: string): Promise<FileMetadata | undefined> {
    const tracker = getFileTracker();
    if (!tracker) {return undefined;}
    const dm = tracker.getDataManager();

    const getAllFilesAsync = (dm as any).getAllFilesAsync as (opts?: { cacheLoaded?: boolean }) => Promise<FileMetadata[]>;
    if (typeof getAllFilesAsync === 'function') {
        const files = await getAllFilesAsync({ cacheLoaded: true });
        return files.find(f => f.filePath === filePath);
    }
    // 回退：同步（内部可能同步读取分片）
    return dm.getFileByPath(filePath);
}

/** 异步：通过 UUID 获取写作统计 */
export async function getWritingStatsByUuidAsync(uuid: string): Promise<WritingStatsView | undefined> {
    const meta = await getFileByUuidAsync(uuid);
    if (!meta || !meta.writingStats) {return undefined;}
    const ws = meta.writingStats;
    return {
        filePath: meta.filePath,
        totalMillis: ws.totalMillis || 0,
        charsAdded: ws.charsAdded || 0,
        charsDeleted: ws.charsDeleted || 0,
        lastActiveTime: ws.lastActiveTime || 0,
        sessionsCount: ws.sessionsCount || 0,
        averageCPM: ws.averageCPM || 0,
        buckets: ws.buckets,
        sessions: ws.sessions,
    };
}

// ====== 新增：异步版“全局句柄”聚合 ======

/**
 * 异步获取全局文件追踪句柄（返回一组 **异步** 方法）
 * 若追踪器未初始化，返回 null
 */
export async function getGlobalFileTrackingAsync(): Promise<{
    getFileUuid: (filePath: string) => string | undefined; // 同步：纯映射查找即可
    getFileMetadataAsync: (uuid: string) => Promise<FileMetadata | undefined>;
    getFileByPathAsync: (filePath: string) => Promise<FileMetadata | undefined>;
    getWritingStatsAsync: (uuid: string) => Promise<WritingStatsView | undefined>;
    getAllWritingStatsAsync: () => Promise<WritingStatsView[]>;
    streamWritingStats: () => AsyncGenerator<WritingStatsView>;
    markAsTemporary: (filePath: string) => void; // 同步标记即可
    markAsSaved: (filePath: string) => void;     // 同步标记即可
} | null> {
    const tracker = getFileTracker();
    if (!tracker) {return null;}
    const dm = tracker.getDataManager();

    return {
        getFileUuid: (filePath: string) => dm.getFileUuid(filePath),
        getFileMetadataAsync: (uuid: string) => getFileByUuidAsync(uuid),
        getFileByPathAsync: (filePath: string) => getFileByPathAsync(filePath),
        getWritingStatsAsync: (uuid: string) => getWritingStatsByUuidAsync(uuid),
        getAllWritingStatsAsync: () => getAllWritingStatsAsync(),
        streamWritingStats: () => streamAllWritingStats(),
        markAsTemporary: (filePath: string) => dm.markAsTemporary(filePath),
        markAsSaved: (filePath: string) => dm.markAsSaved(filePath),
    };
}
