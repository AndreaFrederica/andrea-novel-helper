/**
 * 数据库后端抽象接口
 * 支持多种存储后端（JSON文件、SQLite等）
 */

export interface WritingProjectSummary {
    version: number;
    bucketSizeMs: number;
    todayKey: number;
    totalMillisAll: number;
    today: {
        millis: number;
        chars: number;
        avgCPM: number;
        peakCPM: number;
        hourly: Record<number, number>;
        quarterHourly: Record<number, number>;
    };
    heatmap: Record<number, number>;
    filesWithWritingStats: number;
    updatedAt: number;
}

export interface WritingFileSummary {
    uuid: string;
    path: string;
    totalMillis: number;
    charsAdded: number;
    charsDeleted: number;
    sessionsCount: number;
    averageCPM: number;
    lastActiveTime: number;
    todayKey: number;
    todayPeakCPM: number;
    updatedAt: number;
}

export interface WritingFileSummaryIndex {
    version: number;
    updatedAt: number;
    entries: Record<string, WritingFileSummary>;
}

export interface IDatabaseBackend {
    /**
     * 初始化数据库
     */
    initialize(): Promise<void>;

    /**
     * 关闭数据库连接
     */
    close(): Promise<void>;

    /**
     * 保存文件元数据
     */
    saveFileMetadata(uuid: string, metadata: any): Promise<void>;

    /**
     * 批量保存文件元数据
     */
    saveFileMetadataBatch(entries: Array<{ uuid: string; metadata: any }>): Promise<void>;

    /**
     * 读取文件元数据
     */
    loadFileMetadata(uuid: string): Promise<any | null>;

    /**
     * 批量读取文件元数据
     */
    loadFileMetadataBatch(uuids: string[]): Promise<Map<string, any>>;

    /**
     * 删除文件元数据
     */
    deleteFileMetadata(uuid: string): Promise<void>;

    /**
     * 批量删除文件元数据
     */
    deleteFileMetadataBatch(uuids: string[]): Promise<void>;

    /**
     * 保存路径到UUID的映射
     */
    savePathMapping(path: string, uuid: string): Promise<void>;

    /**
     * 批量保存路径映射
     */
    savePathMappingBatch(mappings: Array<{ path: string; uuid: string }>): Promise<void>;

    /**
     * 通过路径获取UUID
     */
    getUuidByPath(path: string): Promise<string | null>;

    /**
     * 删除路径映射
     */
    deletePathMapping(path: string): Promise<void>;

    /**
     * 按持久层原始 key 删除路径映射。
     * 用于清理历史脏 key；普通调用应继续使用 deletePathMapping。
     */
    deletePathMappingRaw?(path: string): Promise<void>;

    /**
     * 获取所有路径映射
     */
    getAllPathMappings(): Promise<Map<string, string>>;

    /**
     * 获取所有文件UUID列表
     */
    getAllFileUuids(): Promise<string[]>;

    /**
     * 保存索引信息
     */
    saveIndex(data: any): Promise<void>;

    /**
     * 加载索引信息
     */
    loadIndex(): Promise<any | null>;

    /**
     * 保存项目级写作汇总
     */
    saveWritingProjectSummary(summary: WritingProjectSummary): Promise<void>;

    /**
     * 读取项目级写作汇总
     */
    loadWritingProjectSummary(): Promise<WritingProjectSummary | null>;

    /**
     * 保存单文件轻量写作索引
     */
    saveWritingFileSummary(summary: WritingFileSummary): Promise<void>;

    /**
     * 批量保存单文件轻量写作索引
     */
    saveWritingFileSummaryBatch(entries: WritingFileSummary[]): Promise<void>;

    /**
     * 读取单文件轻量写作索引
     */
    loadWritingFileSummary(uuid: string): Promise<WritingFileSummary | null>;

    /**
     * 读取全部单文件轻量写作索引
     */
    loadAllWritingFileSummaries(): Promise<Map<string, WritingFileSummary>>;

    /**
     * 删除单文件轻量写作索引
     */
    deleteWritingFileSummary(uuid: string): Promise<void>;

    /**
     * 获取数据库统计信息
     */
    getStats(): Promise<{
        totalFiles: number;
        totalMappings: number;
        dbSize?: number;
    }>;

    /**
     * 执行数据库优化（如SQLite的VACUUM）
     */
    optimize(): Promise<void>;

    /**
     * 导出所有数据（用于迁移）
     */
    exportAll(): Promise<{
        files: Map<string, any>;
        pathMappings: Map<string, string>;
        index: any;
    }>;

    /**
     * 导入所有数据（用于迁移）
     */
    importAll(data: {
        files: Map<string, any>;
        pathMappings: Map<string, string>;
        index: any;
    }): Promise<void>;

    /**
     * 检查数据库健康状态
     */
    checkHealth(): Promise<{
        healthy: boolean;
        issues?: string[];
    }>;

    /**
     * 获取后端类型标识
     */
    getBackendType(): string;
}

/**
 * 数据库配置
 */
export interface DatabaseConfig {
    /**
     * 后端类型：'json' | 'sqlite'
     */
    backend: 'json' | 'sqlite';

    /**
     * 工作区根目录
     */
    workspaceRoot: string;

    /**
     * 是否启用调试日志
     */
    debug?: boolean;

    /**
     * SQLite特定配置
     */
    sqlite?: {
        /**
         * 数据库文件路径（相对于工作区）
         */
        dbPath?: string;

        /**
         * 是否启用WAL模式
         */
        enableWAL?: boolean;

        /**
         * 缓存大小（页数）
         */
        cacheSize?: number;

        /**
         * 是否启用内存映射IO
         */
        enableMmap?: boolean;
    };

    /**
     * JSON特定配置
     */
    json?: {
        /**
         * 数据目录路径（相对于工作区）
         */
        dataPath?: string;

        /**
         * 是否启用惰性加载
         */
        lazyLoad?: boolean;
    };
}
