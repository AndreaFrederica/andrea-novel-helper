/**
 * 侧车文件记录数据类型定义
 * 支持已追踪和未追踪文件的不同数据结构
 */

/**
 * 基础文件信息（所有文件都能获取到的信息）
 */
export interface BaseSidecarData {
    /** 文件路径（相对于工作区根目录，POSIX风格） */
    filePath: string;
    /** 文件名 */
    fileName: string;
    /** 文件扩展名 */
    fileExtension: string;
    /** 文件大小（字节） */
    size: number;
    /** 文件修改时间（毫秒时间戳） */
    mtime: number;
    /** 侧车数据创建时间 */
    createdAt: number;
    /** 侧车数据最后更新时间 */
    updatedAt: number;
    /** 是否为目录 */
    isDirectory?: boolean;
    /** 数据来源标识 */
    source: 'tracked' | 'filesystem';
}

/**
 * 已追踪文件的侧车数据（包含完整的追踪信息）
 */
export interface TrackedSidecarData extends BaseSidecarData {
    source: 'tracked';
    /** 文件唯一标识符 */
    uuid: string;
    /** 文件内容哈希值 */
    hash: string;
    /** 文件创建时间（首次追踪时间） */
    fileCreatedAt: number;
    /** 最后追踪更新时间 */
    lastTrackedAt: number;
    /** Markdown 特定字段 */
    maxHeading?: string;
    headingLevel?: number;
    /** 写作统计数据 */
    writingStats?: {
        totalMillis: number;
        charsAdded: number;
        charsDeleted: number;
        lastActiveTime: number;
        sessionsCount: number;
        averageCPM: number;
        buckets?: { start: number; end: number; charsAdded: number }[];
        sessions?: { start: number; end: number }[];
        achievedMilestones?: number[];
    };
    /** 字数统计缓存 */
    wordCountStats?: {
        cjkChars: number;
        asciiChars: number;
        words: number;
        nonWSChars: number;
        total: number;
    };
}

/**
 * 未追踪文件的侧车数据（仅包含文件系统信息）
 */
export interface UntrackedSidecarData extends BaseSidecarData {
    source: 'filesystem';
    /** 文件系统创建时间（如果可获取） */
    fileCreatedAt?: number;
    /** 备注：此文件未被文件追踪系统记录 */
    note: 'File not tracked by file tracking system';
}

/**
 * 侧车数据联合类型
 */
export type SidecarData = TrackedSidecarData | UntrackedSidecarData;

/**
 * 侧车文件映射表类型（键为相对路径，值为侧车数据）
 */
export type SidecarDataMap = Record<string, SidecarData>;

/**
 * 侧车数据构建选项
 */
export interface SidecarDataBuildOptions {
    /** 是否包含未追踪文件 */
    includeUntrackedFiles?: boolean;
    /** 是否包含写作统计数据 */
    includeWritingStats?: boolean;
    /** 是否包含字数统计数据 */
    includeWordCountStats?: boolean;
    /** 文件过滤器 */
    fileFilter?: (filePath: string) => boolean;
}

/**
 * 类型守卫：检查是否为已追踪文件的侧车数据
 */
export function isTrackedSidecarData(data: SidecarData): data is TrackedSidecarData {
    return data.source === 'tracked';
}

/**
 * 类型守卫：检查是否为未追踪文件的侧车数据
 */
export function isUntrackedSidecarData(data: SidecarData): data is UntrackedSidecarData {
    return data.source === 'filesystem';
}

/**
 * 从FileMetadata创建TrackedSidecarData的工具函数
 */
export function createTrackedSidecarData(
    fileMetadata: any, // 使用any避免循环依赖，实际为FileMetadata
    relativePath: string
): TrackedSidecarData {
    const now = Date.now();
    return {
        source: 'tracked',
        filePath: relativePath,
        fileName: fileMetadata.fileName,
        fileExtension: fileMetadata.fileExtension,
        size: fileMetadata.size,
        mtime: fileMetadata.mtime,
        createdAt: now,
        updatedAt: now,
        isDirectory: fileMetadata.isDirectory,
        uuid: fileMetadata.uuid,
        hash: fileMetadata.hash,
        fileCreatedAt: fileMetadata.createdAt,
        lastTrackedAt: fileMetadata.lastTrackedAt,
        maxHeading: fileMetadata.maxHeading,
        headingLevel: fileMetadata.headingLevel,
        writingStats: fileMetadata.writingStats,
        wordCountStats: fileMetadata.wordCountStats
    };
}

/**
 * 从文件系统信息创建UntrackedSidecarData的工具函数
 */
export function createUntrackedSidecarData(
    filePath: string,
    fileName: string,
    fileExtension: string,
    size: number,
    mtime: number,
    isDirectory?: boolean,
    fileCreatedAt?: number
): UntrackedSidecarData {
    const now = Date.now();
    return {
        source: 'filesystem',
        filePath,
        fileName,
        fileExtension,
        size,
        mtime,
        createdAt: now,
        updatedAt: now,
        isDirectory,
        fileCreatedAt,
        note: 'File not tracked by file tracking system'
    };
}