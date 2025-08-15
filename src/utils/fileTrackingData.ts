import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

/**
 * 文件追踪数据模型
 */

// 文件元数据接口
export interface FileMetadata {
    uuid: string;
    filePath: string;
    fileName: string;
    fileExtension: string;
    size: number;
    mtime: number;
    hash: string;
    /** 是否为目录 */
    isDirectory?: boolean;
    /** 是否为临时文件（未保存到磁盘） */
    isTemporary?: boolean;
    /** 文件创建时间 */
    createdAt: number;
    /** 最后追踪更新时间 */
    lastTrackedAt: number;
    // Markdown 特定字段
    maxHeading?: string;
    headingLevel?: number;
    // 写作统计字段（供 timeStats 使用）
    writingStats?: {
        totalMillis: number;
        charsAdded: number;
        charsDeleted: number;
        lastActiveTime: number;
        sessionsCount: number;
        averageCPM: number;
        buckets?: { start: number; end: number; charsAdded: number }[];
        sessions?: { start: number; end: number }[];
    };
    // 字数统计缓存（供 WordCountProvider 使用）
    wordCountStats?: {
        cjkChars: number;
        asciiChars: number;
        words: number;
        nonWSChars: number;
        total: number;
    };
    // 最后更新时间
    updatedAt: number;
}

// 文件追踪数据库
export interface FileTrackingDatabase {
    version: string;
    lastUpdated: number;
    files: { [uuid: string]: FileMetadata };
    pathToUuid: { [filePath: string]: string };
}

/**
 * 文件追踪数据管理器
 */
export class FileTrackingDataManager {
    private dbPath: string;
    private database: FileTrackingDatabase;
    private workspaceRoot: string;
    private pendingSaves = new Set<string>();
    private saveTimer: NodeJS.Timeout | null = null;
    private readonly SAVE_DEBOUNCE_MS = 1000; // 1秒防抖
    private readonly DB_VERSION = '1.0.0';
    private hasUnsavedChanges = false; // 追踪是否有未保存的变化
    private lastSavedHash: string = ''; // 上次保存时的数据哈希
    // 目录哈希缓存/异步机制
    private dirHashCache: Map<string, string> = new Map();
    private dirtyDirs: Set<string> = new Set();
    private dirHashTimer: NodeJS.Timeout | null = null;
    private readonly DIR_HASH_DEBOUNCE_MS = 500;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.dbPath = path.join(workspaceRoot, 'novel-helper', 'file-tracking.json');
        this.database = this.loadDatabase();
        this.ensureDirectoryExists();
        // 计算初始数据哈希
        this.lastSavedHash = this.calculateDatabaseHash();
    }

    /**
     * 计算数据库内容的哈希值（用于检测实质性变化）
     */
    private calculateDatabaseHash(): string {
        // 创建一个不包含 lastUpdated 的数据副本来计算哈希
        const dataForHash = {
            version: this.database.version,
            files: this.database.files,
            pathToUuid: this.database.pathToUuid
        };
        return crypto.createHash('sha256').update(JSON.stringify(dataForHash)).digest('hex');
    }

    /**
     * 检查数据库是否有实质性变化
     */
    private hasRealChanges(): boolean {
        const currentHash = this.calculateDatabaseHash();
        return currentHash !== this.lastSavedHash;
    }

    /**
     * 标记有变化需要保存
     */
    private markChanged(): void {
        this.hasUnsavedChanges = true;
    }
    private ensureDirectoryExists(): void {
        const dir = path.dirname(this.dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    /**
     * 加载数据库
     */
    private loadDatabase(): FileTrackingDatabase {
        try {
            if (fs.existsSync(this.dbPath)) {
                const content = fs.readFileSync(this.dbPath, 'utf8');
                const db = JSON.parse(content) as FileTrackingDatabase;
                
                // 验证数据库版本
                if (db.version !== this.DB_VERSION) {
                    console.log(`Migrating file tracking database from ${db.version} to ${this.DB_VERSION}`);
                    return this.migrateDatabase(db);
                }
                
                return db;
            }
        } catch (error) {
            console.warn('Failed to load file tracking database:', error);
        }

        // 返回默认数据库
        return {
            version: this.DB_VERSION,
            lastUpdated: Date.now(),
            files: {},
            pathToUuid: {}
        };
    }

    /**
     * 数据库版本迁移
     */
    private migrateDatabase(oldDb: any): FileTrackingDatabase {
        // 这里可以实现版本迁移逻辑
        // 目前简单地创建新数据库
        return {
            version: this.DB_VERSION,
            lastUpdated: Date.now(),
            files: {},
            pathToUuid: {}
        };
    }

    /**
     * 保存数据库（防抖）
     */
    private scheduleSave(): void {
        if (!this.hasUnsavedChanges) {
            return; // 没有变化，不需要保存
        }

        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
        }

        this.saveTimer = setTimeout(() => {
            this.saveDatabase();
            this.saveTimer = null;
        }, this.SAVE_DEBOUNCE_MS);
    }

    /**
     * 立即保存数据库
     */
    private saveDatabase(): void {
        try {
            // 检查是否有实质性变化
            if (!this.hasRealChanges()) {
                console.log('跳过保存：数据库无实质性变化');
                this.hasUnsavedChanges = false;
                return;
            }

            this.database.lastUpdated = Date.now();
            const content = JSON.stringify(this.database, null, 2);
            fs.writeFileSync(this.dbPath, content, 'utf8');
            
            // 更新保存状态
            this.lastSavedHash = this.calculateDatabaseHash();
            this.hasUnsavedChanges = false;
            
            console.log('文件追踪数据库已保存');
        } catch (error) {
            console.error('Failed to save file tracking database:', error);
        }
    }

    /**
     * 计算文件哈希
     */
    private async calculateFileHash(filePath: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const hash = crypto.createHash('sha256');
            const stream = fs.createReadStream(filePath);
            
            stream.on('data', data => hash.update(data));
            stream.on('end', () => resolve(hash.digest('hex')));
            stream.on('error', reject);
        });
    }

    /**
     * 递归聚合目录哈希：对所有深度子文件与子目录的哈希生成结构哈希。
     * token 格式：F:<relativePath>:<hash> 或 D:<relativePath>:<hash>
     */
    private computeDirectoryHash(dirPath: string): string {
        const tokens: string[] = [];
        const dirPathNormalized = path.resolve(dirPath);
        
        // 完全基于已追踪的数据库条目计算目录哈希，不读取文件系统
        for (const [filePath, uuid] of Object.entries(this.database.pathToUuid)) {
            const filePathNormalized = path.resolve(filePath);
            
            // 检查文件是否在此目录下（直接子项或深层子项）
            if (filePathNormalized.startsWith(dirPathNormalized + path.sep) || filePathNormalized === dirPathNormalized) {
                const meta = this.database.files[uuid];
                if (meta && meta.hash) {  // 只使用有哈希数据的条目
                    // 计算相对路径
                    const relativePath = path.relative(dirPathNormalized, filePathNormalized);
                    const prefix = meta.isDirectory ? 'D' : 'F';
                    // 直接使用数据库中已保存的哈希，不重新计算
                    tokens.push(`${prefix}:${relativePath}:${meta.hash}`);
                }
            }
        }
        
        if (tokens.length === 0) { 
            return ''; 
        }
        
        tokens.sort();
        return crypto.createHash('sha256').update(tokens.join('|')).digest('hex');
    }

    /** 更新目录及其祖先目录的聚合哈希 */
    private markAncestorsDirty(startPath: string): void {
        let dir = path.dirname(startPath);
        const root = this.workspaceRoot;
        while (dir && dir.startsWith(root)) {
            this.dirtyDirs.add(dir);
            const parent = path.dirname(dir);
            if (parent === dir) { break; }
            dir = parent;
        }
        this.scheduleDirHashRecompute();
    }

    private scheduleDirHashRecompute(): void {
    if (this.dirHashTimer) { return; }
        this.dirHashTimer = setTimeout(()=>{
            this.dirHashTimer = null;
            void this.recomputeDirtyDirHashes();
        }, this.DIR_HASH_DEBOUNCE_MS);
    }

    private async recomputeDirtyDirHashes(): Promise<void> {
    if (this.dirtyDirs.size === 0) { return; }
        // 深度优先：先按路径长度从长到短，确保子目录先算
        const dirs = Array.from(this.dirtyDirs).sort((a,b)=>b.length - a.length);
        this.dirtyDirs.clear();
        let changed = false;
        for (const dir of dirs) {
            const uuid = this.getFileUuid(dir);
            if (!uuid) { continue; }
            const meta = this.database.files[uuid];
            if (!meta || !meta.isDirectory) { continue; }
            const newHash = this.computeDirectoryHash(dir);
            if (meta.hash !== newHash) {
                meta.hash = newHash;
                meta.updatedAt = Date.now();
                meta.lastTrackedAt = Date.now();
                this.dirHashCache.set(dir, newHash);
                changed = true;
            }
        }
        if (changed) {
            this.markChanged();
            this.scheduleSave();
        }
    }

    /**
     * 解析 Markdown 文件的最大标题
     */
    private parseMarkdownHeading(filePath: string): { maxHeading?: string; headingLevel?: number } {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split('\n');
            
            let maxHeading: string | undefined;
            let headingLevel: number | undefined;
            
            for (const line of lines) {
                const match = line.match(/^(#{1,6})\s+(.+)$/);
                if (match) {
                    const level = match[1].length;
                    const heading = match[2].trim();
                    
                    if (headingLevel === undefined || level < headingLevel) {
                        headingLevel = level;
                        maxHeading = heading;
                    }
                }
            }
            
            return { maxHeading, headingLevel };
        } catch (error) {
            return {};
        }
    }

    /**
     * 获取文件的 UUID
     */
    public getFileUuid(filePath: string): string | undefined {
        return this.database.pathToUuid[filePath];
    }

    /**
     * 通过 UUID 获取文件元数据
     */
    public getFileByUuid(uuid: string): FileMetadata | undefined {
        return this.database.files[uuid];
    }

    /**
     * 通过路径获取文件元数据
     */
    public getFileByPath(filePath: string): FileMetadata | undefined {
        const uuid = this.getFileUuid(filePath);
        return uuid ? this.database.files[uuid] : undefined;
    }

    /**
     * 异步添加或更新文件
     */
    public async addOrUpdateFile(filePath: string): Promise<string> {
        // 避免追踪数据库文件自身
        if (filePath === this.dbPath) {
            throw new Error('Cannot track the database file itself');
        }

        try {
            const stats = await fs.promises.stat(filePath);
            const isDirectory = stats.isDirectory();
            // 目录不做内容哈希，避免 EISDIR
            const hash = isDirectory ? '' : await this.calculateFileHash(filePath);
            
            // 检查是否已存在
            let uuid = this.getFileUuid(filePath);
            const existingFile = uuid ? this.database.files[uuid] : undefined;
            
            // 如果文件已存在且哈希未变化，不需要任何更新
            if (!isDirectory) { // 仅对普通文件使用哈希短路
                if (existingFile && existingFile.hash === hash && uuid) {
                    return uuid; // 文件内容未变
                }
            }
            
            // 创建新的 UUID（如果不存在）
            if (!uuid) {
                uuid = uuidv4();
            }
            
            const fileName = path.basename(filePath);
            const fileExtension = path.extname(filePath).toLowerCase();
            
            // 解析 Markdown 标题
            let maxHeading: string | undefined;
            let headingLevel: number | undefined;
            if (fileExtension === '.md') {
                const headingInfo = this.parseMarkdownHeading(filePath);
                maxHeading = headingInfo.maxHeading;
                headingLevel = headingInfo.headingLevel;
            }
            
            const now = Date.now();
            const metadata: FileMetadata = {
                uuid,
                filePath,
                fileName,
                fileExtension,
                size: stats.size,
                mtime: stats.mtimeMs,
                hash,
                isDirectory,
                maxHeading,
                headingLevel,
                writingStats: existingFile?.writingStats, // 保留现有的写作统计
                createdAt: existingFile?.createdAt || now,
                lastTrackedAt: now,
                updatedAt: now
            };
            
            // 更新数据库
            this.database.files[uuid] = metadata;
            this.database.pathToUuid[filePath] = uuid;
            
            this.markChanged();
            this.scheduleSave();
            // 如果是文件，更新其父目录聚合哈希
            if (!isDirectory) {
                this.markAncestorsDirty(filePath);
            } else {
                // 初始目录 hash 延迟计算
                this.dirtyDirs.add(filePath);
                this.markAncestorsDirty(filePath);
            }
            return uuid;
            
        } catch (error) {
            console.error(`Failed to add/update file ${filePath}:`, error);
            throw error;
        }
    }

    /**
     * 移除文件
     */
    public removeFile(filePath: string): void {
        const uuid = this.getFileUuid(filePath);
        if (uuid) {
            delete this.database.files[uuid];
            delete this.database.pathToUuid[filePath];
            this.markChanged();
            this.scheduleSave();
            // 更新父目录哈希
            this.markAncestorsDirty(filePath);
        }
    }

    /**
     * 重命名文件
     */
    public renameFile(oldPath: string, newPath: string): void {
        const uuid = this.getFileUuid(oldPath);
        if (uuid) {
            const metadata = this.database.files[uuid];
            if (metadata) {
                metadata.filePath = newPath;
                metadata.fileName = path.basename(newPath);
                metadata.fileExtension = path.extname(newPath).toLowerCase();
                metadata.updatedAt = Date.now();
                
                // 更新路径映射
                delete this.database.pathToUuid[oldPath];
                this.database.pathToUuid[newPath] = uuid;
                
                this.markChanged();
                this.scheduleSave();
                this.markAncestorsDirty(newPath);
            }
        }
    }

    /**
     * 目录重命名：批量迁移子文件路径映射及元数据
     */
    public renameDirectoryChildren(oldDir: string, newDir: string): void {
        const oldPrefix = path.resolve(oldDir) + path.sep;
        const newPrefix = path.resolve(newDir) + path.sep;
        const entries = Object.entries(this.database.pathToUuid);
        let changed = false;
        for (const [p, uuid] of entries) {
            const abs = path.resolve(p);
            if (abs.startsWith(oldPrefix)) {
                const rel = abs.substring(oldPrefix.length);
                const newAbs = path.join(newPrefix, rel);
                // 更新 pathToUuid 映射
                delete this.database.pathToUuid[p];
                this.database.pathToUuid[newAbs] = uuid;
                // 更新元数据
                const meta = this.database.files[uuid];
                if (meta) {
                    meta.filePath = newAbs;
                    meta.fileName = path.basename(newAbs);
                    meta.fileExtension = path.extname(newAbs).toLowerCase();
                    meta.updatedAt = Date.now();
                    meta.lastTrackedAt = Date.now();
                }
                changed = true;
            }
        }
        if (changed) {
            this.markChanged();
            this.scheduleSave();
            this.markAncestorsDirty(newDir);
        }
    }

    /**
     * 更新文件的写作统计（供 timeStats 使用）
     */
    public updateWritingStats(filePath: string, stats: {
        totalMillis?: number;
        charsAdded?: number;
        charsDeleted?: number;
        lastActiveTime?: number;
        sessionsCount?: number;
        averageCPM?: number;
        buckets?: { start: number; end: number; charsAdded: number }[];
        sessions?: { start: number; end: number }[];
    }): void {
        const uuid = this.getFileUuid(filePath);
        if (uuid) {
            const metadata = this.database.files[uuid];
            if (metadata) {
                if (!metadata.writingStats) {
                    metadata.writingStats = {
                        totalMillis: 0,
                        charsAdded: 0,
                        charsDeleted: 0,
                        lastActiveTime: 0,
                        sessionsCount: 0,
                        averageCPM: 0
                    };
                }
                
                // 更新统计信息
                Object.assign(metadata.writingStats, stats);
                metadata.updatedAt = Date.now();
                
                this.markChanged();
                this.scheduleSave();
            }
        }
    }

    /**
     * 获取所有被追踪的文件
     */
    public getAllFiles(): FileMetadata[] {
        return Object.values(this.database.files);
    }

    /**
     * 根据条件筛选文件
     */
    public filterFiles(predicate: (file: FileMetadata) => boolean): FileMetadata[] {
        return this.getAllFiles().filter(predicate);
    }

    /**
     * 获取统计信息
     */
    public getStats(): {
        totalFiles: number;
        totalSize: number;
        filesByExtension: { [ext: string]: number };
        lastUpdated: number;
    } {
        const files = this.getAllFiles();
        const totalFiles = files.length;
        const totalSize = files.reduce((sum, file) => sum + file.size, 0);
        
        const filesByExtension: { [ext: string]: number } = {};
        files.forEach(file => {
            const ext = file.fileExtension || 'unknown';
            filesByExtension[ext] = (filesByExtension[ext] || 0) + 1;
        });
        
        return {
            totalFiles,
            totalSize,
            filesByExtension,
            lastUpdated: this.database.lastUpdated
        };
    }

    /**
     * 获取所有有写作统计的文件
     */
    public getAllWritingStats(): Array<{
        filePath: string;
        totalMillis: number;
        charsAdded: number;
        charsDeleted: number;
        lastActiveTime: number;
        sessionsCount: number;
        averageCPM: number;
        buckets?: { start: number; end: number; charsAdded: number }[];
        sessions?: { start: number; end: number }[];
    }> {
        return this.getAllFiles()
            .filter(file => file.writingStats)
            .map(file => ({
                filePath: file.filePath,
                totalMillis: file.writingStats!.totalMillis || 0,
                charsAdded: file.writingStats!.charsAdded || 0,
                charsDeleted: file.writingStats!.charsDeleted || 0,
                lastActiveTime: file.writingStats!.lastActiveTime || 0,
                sessionsCount: file.writingStats!.sessionsCount || 0,
                averageCPM: file.writingStats!.averageCPM || 0,
                buckets: file.writingStats!.buckets,
                sessions: file.writingStats!.sessions
            }));
    }

    /**
     * 清理不存在的文件
     */
    public async cleanupMissingFiles(): Promise<string[]> {
        const removedFiles: string[] = [];
        const files = this.getAllFiles();
        
        for (const file of files) {
            try {
                await fs.promises.access(file.filePath);
            } catch (error) {
                // 文件不存在，移除它
                this.removeFile(file.filePath);
                removedFiles.push(file.filePath);
            }
        }
        
        return removedFiles;
    }

    /**
     * 强制保存数据库
     */
    public async forceSave(): Promise<void> {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        this.saveDatabase();
    }

    /**
     * 处理文件删除
     */
    public handleFileDeleted(filePath: string): boolean {
        const uuid = this.database.pathToUuid[filePath];
        if (!uuid) {
            return false; // 文件未被追踪
        }

        // 从数据库中移除
        delete this.database.files[uuid];
        delete this.database.pathToUuid[filePath];
        
        this.markChanged();
        this.scheduleSave();
        
        console.log(`文件已从追踪中移除: ${filePath} (UUID: ${uuid})`);
        return true;
    }

    /**
     * 处理文件重命名
     */
    public handleFileRenamed(oldPath: string, newPath: string): boolean {
        const uuid = this.database.pathToUuid[oldPath];
        if (!uuid) {
            return false; // 原文件未被追踪
        }

        const fileMetadata = this.database.files[uuid];
        if (!fileMetadata) {
            return false;
        }

        // 更新路径映射
        delete this.database.pathToUuid[oldPath];
        this.database.pathToUuid[newPath] = uuid;

        // 更新文件元数据
        fileMetadata.filePath = newPath;
        fileMetadata.fileName = path.basename(newPath);
        fileMetadata.fileExtension = path.extname(newPath).substring(1);
        fileMetadata.lastTrackedAt = Date.now();
        fileMetadata.updatedAt = Date.now();

        this.markChanged();
        this.scheduleSave();

        console.log(`文件路径已更新: ${oldPath} -> ${newPath} (UUID: ${uuid})`);
        return true;
    }

    /**
     * 为未保存的文件创建临时追踪记录
     * 用于timeStats等需要在文件保存前就开始追踪的场景
     */
    public createTemporaryFile(filePath: string): string {
        // 检查是否已经存在
        let uuid = this.getFileUuid(filePath);
        if (uuid) {
            // 文件已存在，标记为临时状态
            this.markAsTemporary(filePath);
            return uuid;
        }

        // 创建新的临时文件记录
        uuid = uuidv4();
        const fileName = path.basename(filePath);
        const fileExtension = path.extname(filePath).toLowerCase();
        const now = Date.now();

        const metadata: FileMetadata = {
            uuid,
            filePath,
            fileName,
            fileExtension,
            size: 0, // 临时文件大小未知
            mtime: now,
            hash: '', // 临时文件没有哈希
            isTemporary: true,
            createdAt: now,
            lastTrackedAt: now,
            updatedAt: now
        };

        // 更新数据库
        this.database.files[uuid] = metadata;
        this.database.pathToUuid[filePath] = uuid;

        this.markChanged();
        this.scheduleSave();

        console.log(`创建临时文件追踪记录: ${filePath} (UUID: ${uuid})`);
        return uuid;
    }

    /**
     * 标记文件为临时文件（未保存到磁盘）
     */
    public markAsTemporary(filePath: string): void {
        const uuid = this.database.pathToUuid[filePath];
        if (uuid && this.database.files[uuid]) {
            const metadata = this.database.files[uuid];
            if (!metadata.isTemporary) { // 只有状态真的改变时才保存
                metadata.isTemporary = true;
                metadata.lastTrackedAt = Date.now();
                this.markChanged();
                this.scheduleSave();
            }
        }
    }

    /**
     * 标记文件为已保存（不再是临时文件）
     */
    public markAsSaved(filePath: string): void {
        const uuid = this.database.pathToUuid[filePath];
        if (uuid && this.database.files[uuid]) {
            const metadata = this.database.files[uuid];
            if (metadata.isTemporary !== false) { // 只有状态真的改变时才保存
                metadata.isTemporary = false;
                metadata.lastTrackedAt = Date.now();
                this.markChanged();
                this.scheduleSave();
            }
        }
    }

    /**
     * 更新文件的字数统计缓存（供 WordCountProvider 使用）
     */
    public updateWordCountStats(filePath: string, stats: {
        cjkChars: number;
        asciiChars: number;
        words: number;
        nonWSChars: number;
        total: number;
    }): void {
        const uuid = this.getFileUuid(filePath);
        if (uuid) {
            const metadata = this.database.files[uuid];
            if (metadata) {
                metadata.wordCountStats = { ...stats };
                metadata.updatedAt = Date.now();
                
                this.markChanged();
                this.scheduleSave();
            }
        }
    }

    /**
     * 关闭数据管理器
     */
    public async dispose(): Promise<void> {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        await this.forceSave();
    }
}
