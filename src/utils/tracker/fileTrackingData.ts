import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
// 仅在需要判断编辑器是否打开数据库文件时才使用 vscode API
// 避免循环依赖：此文件不被激活阶段直接 import 其它使用本模块的代码
import * as vscode from 'vscode';
import { getFileMetadataFromCache } from '../WordCount/asyncWordCounter.js';
// 文件级数据库对象，供外部直接访问和读写
export let fileTrackingDatabase: FileTrackingDatabase | undefined = undefined;

/**
 * 文件追踪数据模型
 */


type WritingStatsRow = {
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
        achievedMilestones?: number[]; // 已达成的里程碑目标
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
    /**
     * 直接写入或更新某个文件的元数据（外部可用，提升写入速度）
     */
    public setFileMetadata(filePath: string, meta: FileMetadata): void {
        if (!meta || !meta.uuid) { return; }
        this.database.files[meta.uuid] = meta;
        const key = this.toRelKey(filePath);
        this.database.pathToUuid[key] = meta.uuid;
        this.markChanged();
        this.markShardDirty(meta.uuid, 'setFileMetadata external update');
        this.scheduleSave();
    }

    // 标志：是否检测到需要路径迁移（index / 分片）
    private needsIndexPathMigration = false;
    private needsShardPathMigration = false;

    /** 外部可查询是否存在遗留绝对路径，决定是否弹窗/触发迁移任务 */
    public needsPathMigration(): boolean {
        return this.needsIndexPathMigration || this.needsShardPathMigration;
    }


    private dbPath: string; // 旧单文件（仍用于迁移检测）
    public database: FileTrackingDatabase; // 内存聚合（加载后）
    private dbDir: string; // 新的分片目录 .anh-fsdb
    private indexPath: string; // 索引文件 .anh-fsdb/index.json
    private useSharded: boolean = true; // 始终启用分片
    private lazyLoadShards: boolean = true; // 启动仅加载索引按需加载
    private trustCallerFilters: boolean = false; // 如果启用，则信任调用者已应用过滤，可跳过部分重复检查
    private indexDirFlag: Set<string> = new Set();
    private workspaceRoot: string;
    private pendingSaves = new Set<string>();
    private saveTimer: NodeJS.Timeout | null = null;
    private readonly SAVE_DEBOUNCE_MS = 1000; // 1秒防抖
    // 当数据库文件被用户在编辑器里打开时，延迟实际写入，避免频繁外部写入导致编辑器脏/闪烁
    private readonly SAVE_WHEN_OPEN_DELAY_MS = 2000;
    private openSkipCount = 0; // 连续因为文件打开而跳过的次数
    private readonly MAX_OPEN_SKIP = 5; // 最多跳过次数，之后强制写一次，防止无限推迟
    private readonly DB_VERSION = '1.0.0';
    private hasUnsavedChanges = false; // 追踪是否有未保存的变化
    private lastSavedHash: string = ''; // 上次保存时的数据哈希
    // 目录哈希缓存/异步机制
    private dirHashCache: Map<string, string> = new Map();
    private dirtyDirs: Set<string> = new Set();
    private dirHashTimer: NodeJS.Timeout | null = null;
    private readonly DIR_HASH_DEBOUNCE_MS = 500;
    // 调试统计
    private stats = {
        markChanged: 0,
        scheduleSave: 0,
        saveCalls: 0,
        saveSkipNoChange: 0,
        saveWrite: 0,
        addOrUpdateCalls: 0,
        addDir: 0,
        addFile: 0,
        skipUnchangedFile: 0,
        removeFile: 0,
        renameFile: 0,
        renameDirChildren: 0,
        dirHashRuns: 0,
        dirHashChanged: 0,
        markAncestorsDirty: 0,
        maxDirtyBatch: 0,
        wordCountUpdates: 0,
        writingStatsUpdates: 0,
        temporaryCreate: 0,
        markTemp: 0,
        markSaved: 0
    };
    // 脏分片追踪（仅写入变化的元数据分片，减少 IO）
    private dirtyShardUuids: Set<string> = new Set();
    private removedShardUuids: Set<string> = new Set();
    /**
     * 标记某个分片为脏并记录原因
     * @param uuid 分片 UUID
     * @param reason 触发原因 (用于调试定位不必要的写入)
     */

    public async rewriteAllShardsToRelative(): Promise<void> {
        for (const uuid of Object.keys(this.database.files)) {
            this.markShardDirty(uuid, 'rewrite to relative path');
        }
        this.saveSharded(true);  // 强制重写分片
        this.writeIndex();       // 顺带重写索引
    }


    /** 统一化：相对键（workspace 内用 POSIX 分隔符；Win 下小写） */
    private toRelKey(p: string): string {
        const root = path.resolve(this.workspaceRoot);
        const abs = path.resolve(p);
        let rel = path.relative(root, abs);
        // 不在工作区内：保留绝对路径（极端情况）；否则转 POSIX
        if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
            const canon = abs.replace(/\\/g, '/');
            return process.platform === 'win32' ? canon.toLowerCase() : canon;
        }
        rel = rel.split(path.sep).join('/');
        return process.platform === 'win32' ? rel.toLowerCase() : rel;
    }

    /** 由相对键还原为绝对路径（若键本身是绝对的则原样返回） */
    private toAbsPath(key: string): string {
        if (path.isAbsolute(key) || /^[a-z]:\//i.test(key)) {
            // 绝对键：把 POSIX 转回本地分隔符即可
            const local = key.replace(/\//g, path.sep);
            return process.platform === 'win32' ? local : local;
        }
        // 相对键：从 workspaceRoot 拼绝对路径
        const joined = path.join(this.workspaceRoot, key);
        return joined;
    }

    /** 统一大小写/分隔符用于 Map 键比较（传入键或路径均可） */
    private normKeyLike(k: string): string {
        const s = k.replace(/\\/g, '/');
        return process.platform === 'win32' ? s.toLowerCase() : s;
    }

    /** 一次性迁移：把 pathToUuid 的绝对键改为工作区相对键；冲突去重；刷新 meta.filePath */
    private migrateKeysToRelativeAndDedup(): void {
        const oldMap = this.database.pathToUuid || {};
        const newMap: Record<string, string> = {};
        const removedUuids: string[] = [];

        const pickCanonical = (u1: string, u2: string) => {
            const m1 = this.database.files[u1];
            const m2 = this.database.files[u2];
            const p1 = m1?.filePath ? this.toAbsPath(this.toRelKey(m1.filePath)) : undefined;
            const p2 = m2?.filePath ? this.toAbsPath(this.toRelKey(m2.filePath)) : undefined;
            const e1 = p1 ? fs.existsSync(p1) : false;
            const e2 = p2 ? fs.existsSync(p2) : false;
            if (e1 !== e2) { return e1 ? u1 : u2; }
            const t1 = m1?.updatedAt ?? 0;
            const t2 = m2?.updatedAt ?? 0;
            return t1 >= t2 ? u1 : u2;
        };

        for (const [oldKeyRaw, uuid] of Object.entries(oldMap)) {
            const relKey = this.toRelKey(oldKeyRaw);
            // 刷新 meta.filePath 为当前工作区绝对路径（便于 stat）
            const meta = this.database.files[uuid];
            if (meta) {
                meta.filePath = this.toAbsPath(relKey);
            }

            if (!newMap[relKey]) {
                newMap[relKey] = uuid;
            } else if (newMap[relKey] !== uuid) {
                // 同一相对键冲突：择优保留一个，删除另一个
                const keep = pickCanonical(newMap[relKey], uuid);
                const drop = keep === newMap[relKey] ? uuid : newMap[relKey];
                newMap[relKey] = keep;
                if (this.database.files[drop]) {
                    delete this.database.files[drop];
                    removedUuids.push(drop);
                }
            }
        }

        // 过滤掉“不在工作区内且不可相对化”的旧绝对键（被 toRelKey 处理为绝对路径的）
        for (const [k, u] of Object.entries(newMap)) {
            // 仍然是绝对键说明不在工作区；如果文件也不存在，清掉
            if (path.isAbsolute(k)) {
                const abs = this.toAbsPath(k);
                if (!fs.existsSync(abs)) {
                    delete newMap[k];
                    if (this.database.files[u]) {
                        delete this.database.files[u];
                        removedUuids.push(u);
                    }
                }
            }
        }

        if (removedUuids.length) {
            removedUuids.forEach(u => this.removedShardUuids.add(u));
        }
        this.database.pathToUuid = newMap;
        this.markChanged();
        this.scheduleSave();
        console.log(`[FileTracking] 迁移为相对键完成 keys=${Object.keys(newMap).length} removed=${removedUuids.length}`);
    }




    // 放到 class 里
    private async mapWithConcurrency<I, O>(
        items: I[],
        limit: number,
        worker: (item: I, index: number) => Promise<O | undefined>
    ): Promise<O[]> {
        const out: O[] = [];
        let i = 0;
        let inFlight = 0;
        return new Promise((resolve, reject) => {
            const pump = () => {
                if (i >= items.length && inFlight === 0) { return resolve(out); }
                while (inFlight < limit && i < items.length) {
                    const idx = i++;
                    const item = items[idx];
                    inFlight++;
                    worker(item, idx)
                        .then((r) => { if (r !== undefined) { out.push(r); } })
                        .catch(reject)
                        .finally(() => { inFlight--; setImmediate(pump); });
                }
            };
            pump();
        });
    }



    private markShardDirty(uuid?: string, reason?: string) {
        if (!uuid) { return; }
        if (!this.dirtyShardUuids.has(uuid)) {
            if (reason) {
                console.log(`[FileTracking] markShardDirty uuid=${uuid} reason=${reason}`);
            }
        }
        this.dirtyShardUuids.add(uuid);
    }

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.dbPath = path.join(workspaceRoot, 'novel-helper', 'file-tracking.json');
        this.dbDir = path.join(workspaceRoot, 'novel-helper', '.anh-fsdb');
        this.indexPath = path.join(this.dbDir, 'index.json');
        this.ensureDirectoryExists();
        this.ensureDbDir();
        // 读取配置：是否信任调用者的过滤器（可略过部分重复检查）
        try {
            this.trustCallerFilters = vscode.workspace.getConfiguration('AndreaNovelHelper.fileTracker').get<boolean>('trustCallerFilters', false) === true;
        } catch { this.trustCallerFilters = false; }
        this.database = this.loadDatabase(); //todo
        // 初始化时赋值到文件级变量，供外部直接访问
        fileTrackingDatabase = this.database;
        // 规范化旧版本/损坏结构（防止后续 Object.keys on undefined）
        if (!this.database) {
            this.database = { version: this.DB_VERSION, lastUpdated: Date.now(), files: {}, pathToUuid: {} };
        } else {
            (this.database as any).files = this.database.files && typeof this.database.files === 'object' ? this.database.files : {};
            (this.database as any).pathToUuid = this.database.pathToUuid && typeof this.database.pathToUuid === 'object' ? this.database.pathToUuid : {};
            if (!this.database.version) { (this.database as any).version = this.DB_VERSION; }
            if (!this.database.lastUpdated) { (this.database as any).lastUpdated = Date.now(); }
        }
        this.migrateKeysToRelativeAndDedup();
        this.ensureDirectoryExists();
        // 计算初始数据哈希
        this.lastSavedHash = this.calculateDatabaseHash();
        // 启动时清理遗留的 .git 目录内条目
        try { this.purgeGitEntries(); } catch (e) { console.warn('[FileTracking] purgeGitEntries 失败（忽略）', e); }
        // 迁移：如果存在旧的 file-tracking.json 且 index 未建立，则迁移到分片
        this.migrateIfNeeded();
        // 惰性：若存在 index 且开启惰性，则仅加载索引；否则全量加载分片
        if (this.lazyLoadShards && fs.existsSync(this.indexPath)) {
            this.loadIndexOnly();
        } else {
            this.loadShardedFiles();
        }
        this.getAllWritingStatsAsync = this.getAllWritingStatsAsync.bind(this);
        this.streamWritingStats = this.streamWritingStats.bind(this);
        this.getAllFilesAsync = this.getAllFilesAsync.bind(this);
        this.filterFilesAsync = this.filterFilesAsync.bind(this);
        this.getStatsAsync = this.getStatsAsync.bind(this);
    }

    /** 判断路径是否位于 .git 目录 */
    private isInGitDir(p: string): boolean {
        const gitDir = path.resolve(path.join(this.workspaceRoot, '.git'));
        const rp = path.resolve(p);
        return rp === gitDir || rp.startsWith(gitDir + path.sep);
    }

    /** 清理已追踪数据库中遗留的 .git 内条目 */
    private purgeGitEntries(): void {
        if (!this.database || !this.database.pathToUuid) { return; }
        const toRemove: string[] = [];
        for (const key of Object.keys(this.database.pathToUuid || {})) {
            const abs = this.toAbsPath(key);                    // ← 转成绝对路径
            if (this.isInGitDir(abs)) { toRemove.push(key); }   // ← 用绝对路径判定
        }
        if (toRemove.length) {
            for (const key of toRemove) {
                const uuid = this.database.pathToUuid[key];
                if (uuid) { delete this.database.files[uuid]; }
                delete this.database.pathToUuid[key];             // ← 按相对键删除
            }
            this.markChanged();
            this.scheduleSave();
            console.log(`[FileTracking] 清理 .git 遗留条目 count=${toRemove.length}`);
        }
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
        this.stats.markChanged++;
    }
    private ensureDirectoryExists(): void {
        const dir = path.dirname(this.dbPath);
        if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
    }
    private ensureDbDir(): void {
        if (!fs.existsSync(this.dbDir)) { fs.mkdirSync(this.dbDir, { recursive: true }); }
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
        // 若存在分片 index 优先用 index 重建空内存结构（随后 loadShardedFiles 会填充）
        if (fs.existsSync(this.indexPath)) {
            try {
                const idx = JSON.parse(fs.readFileSync(this.indexPath, 'utf8')) as { version: string; lastUpdated: number; files: string[] };
                return { version: this.DB_VERSION, lastUpdated: idx.lastUpdated || Date.now(), files: {}, pathToUuid: {} };
            } catch { }
        }
        return { version: this.DB_VERSION, lastUpdated: Date.now(), files: {}, pathToUuid: {} };
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
        this.stats.scheduleSave++;
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
    private saveDatabase(force = false): void {
        const t0 = Date.now();
        this.stats.saveCalls++;
        try {
            // 分片模式：写入增量而不是写整个聚合（除非强制或目录未建立）
            if (this.useSharded) {
                this.saveSharded(force);
            }
            // 如果不是强制保存，并且数据库文件当前被打开，则延迟保存以避免 VSCode 不断提示文件已在磁盘被修改
            if (!force && this.isDatabaseFileOpen()) {
                this.openSkipCount++;
                if (this.openSkipCount <= this.MAX_OPEN_SKIP) {
                    // 重新调度一次延迟写
                    if (this.saveTimer) { clearTimeout(this.saveTimer); }
                    this.saveTimer = setTimeout(() => {
                        this.saveDatabase(false);
                        this.saveTimer = null;
                    }, this.SAVE_WHEN_OPEN_DELAY_MS);
                    // 不重置 hasUnsavedChanges，保持待写状态
                    console.log(`[FileTracking] 打开中延迟保存 skip=${this.openSkipCount}`);
                    return;
                } else {
                    console.log('[FileTracking] 打开中过多跳过，执行强制写入');
                }
            } else {
                // 数据库文件未打开或强制写：重置跳过计数
                this.openSkipCount = 0;
            }
            if (!this.hasRealChanges()) {
                console.log('跳过保存：数据库无实质性变化');
                this.hasUnsavedChanges = false;
                this.stats.saveSkipNoChange++;
                return;
            }
            // 仍写一个精简 index（不包含写作统计和 wordCountStats 细节）方便调试；避免 VS Code 打开超大文件
            this.database.lastUpdated = Date.now();
            const slim = {
                version: this.database.version,
                lastUpdated: this.database.lastUpdated,
                totalFiles: Object.keys(this.database.files).length,
                // 只写基础字段映射用于备份/恢复（可选）
                files: Object.values(this.database.files).map(f => ({ uuid: f.uuid, filePath: f.filePath, isDirectory: f.isDirectory, size: f.size, mtime: f.mtime, hash: f.hash, updatedAt: f.updatedAt }))
            };
            // 根据配置决定是否写 legacy 快照
            let writeLegacy = false;
            try {
                writeLegacy = vscode.workspace.getConfiguration('AndreaNovelHelper.fileTracker').get<boolean>('writeLegacySnapshot', false) === true;
            } catch { }
            let content = '';
            if (writeLegacy) {
                content = JSON.stringify(slim, null, 2);
                fs.writeFileSync(this.dbPath, content, 'utf8');
            } else {
                // 若配置关闭且旧文件存在且我们是首次迁移后，可以选择清理；此处不自动删，避免用户依赖；仅在首次检测到未启用写入且文件为空列表写过时保留。
                content = '{"legacyDisabled":true}';
            }
            this.lastSavedHash = this.calculateDatabaseHash();
            this.hasUnsavedChanges = false;
            const dur = Date.now() - t0;
            this.stats.saveWrite++;
            console.log(`[FileTracking] 保存(Index) legacy=${writeLegacy ? 'yes' : 'no'} size=${content.length}B dur=${dur}ms files=${Object.keys(this.database.files).length}`);
        } catch (error) {
            console.error('Failed to save file tracking database:', error);
        }
    }

    /** 判断数据库文件是否在任一可见编辑器中被打开 */
    private isDatabaseFileOpen(): boolean {
        try {
            const editors = vscode.window.visibleTextEditors;
            if (!editors || editors.length === 0) { return false; }
            const target = path.resolve(this.dbPath);
            return editors.some(ed => path.resolve(ed.document.fileName) === target);
        } catch { return false; }
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

        for (const [key, uuid] of Object.entries(this.database.pathToUuid)) {
            const filePathNormalized = path.resolve(this.toAbsPath(key)); // ← 关键
            if (filePathNormalized.startsWith(dirPathNormalized + path.sep) || filePathNormalized === dirPathNormalized) {
                const meta = this.database.files[uuid];
                if (meta && meta.hash) {
                    const relativePath = path.relative(dirPathNormalized, filePathNormalized)
                        .split(path.sep).join('/');      // ← 稳定化分隔符
                    const prefix = meta.isDirectory ? 'D' : 'F';
                    tokens.push(`${prefix}:${relativePath}:${meta.hash}`);
                }
            }
        }
        if (tokens.length === 0) { return ''; }
        tokens.sort();
        return crypto.createHash('sha256').update(tokens.join('|')).digest('hex');
    }


    /** 更新目录及其祖先目录的聚合哈希 */
    private markAncestorsDirty(startPath: string): void {
        this.stats.markAncestorsDirty++;
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
        this.dirHashTimer = setTimeout(() => {
            this.dirHashTimer = null;
            void this.recomputeDirtyDirHashes();
        }, this.DIR_HASH_DEBOUNCE_MS);
    }

    private async recomputeDirtyDirHashes(): Promise<void> {
        if (this.dirtyDirs.size === 0) { return; }
        const batch = this.dirtyDirs.size;
        if (batch > this.stats.maxDirtyBatch) { this.stats.maxDirtyBatch = batch; }
        const t0 = Date.now();
        this.stats.dirHashRuns++;
        // 深度优先：先按路径长度从长到短，确保子目录先算
        const dirs = Array.from(this.dirtyDirs).sort((a, b) => b.length - a.length);
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
                this.stats.dirHashChanged++;
            }
        }
        if (changed) {
            this.markChanged();
            this.scheduleSave();
        }
        const dur = Date.now() - t0;
        console.log(`[FileTracking] 目录哈希重算 batch=${batch} changed=${changed} dur=${dur}ms`);
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
        const key = this.toRelKey(filePath);
        return this.database.pathToUuid[key];
    }


    /**
     * 通过 UUID 获取文件元数据
     */
    public getFileByUuid(uuid: string): FileMetadata | undefined {
        if (this.lazyLoadShards && !this.database.files[uuid]) { this.ensureShardLoaded(uuid); }
        return this.database.files[uuid];
    }

    /**
     * 通过路径获取文件元数据
     * （用工作区相对键查询；需要时惰性加载分片）
     */
    public getFileByPath(filePath: string): FileMetadata | undefined {
        const key = this.toRelKey(filePath);               // ← 相对键（POSIX，Win 下小写）
        const uuid = this.database.pathToUuid[key];
        if (!uuid) { return undefined; }
        if (this.lazyLoadShards && !this.database.files[uuid]) {
            this.ensureShardLoaded(uuid);
        }
        return this.database.files[uuid];
    }

    /**
     * 异步添加或更新文件
     * （pathToUuid 使用相对键；meta.filePath 仍保存为绝对路径）
     */
    public async addOrUpdateFile(filePath: string): Promise<string> {
        this.stats.addOrUpdateCalls++;

        // 避免追踪数据库文件自身
        if (filePath === this.dbPath) {
            return this.getFileUuid(filePath) || '';
        }
        // 完全忽略 .git 目录（除非信任调用者已完成过滤）
        if (!this.trustCallerFilters && this.isInGitDir(filePath)) {
            return this.getFileUuid(filePath) || '';
        }

        const key = this.toRelKey(filePath);               // ← 相对键
        try {
            const stats = await fs.promises.stat(filePath);
            const isDirectory = stats.isDirectory();
            // 目录不做内容哈希，避免 EISDIR
            const hash = isDirectory ? '' : await this.calculateFileHash(filePath);

            // 检查是否已存在
            let uuid = this.database.pathToUuid[key];
            let existingFile = uuid ? this.database.files[uuid] : undefined;

            // 惰性：如果已有 uuid 但尚未加载分片，先加载以便正确比较（避免误判为变化）
            if (uuid && !existingFile && this.lazyLoadShards) {
                this.ensureShardLoaded(uuid);
                existingFile = this.database.files[uuid];
            }

            // 如果文件已存在且哈希/size/mtime 未变化，不需要任何更新
            if (!isDirectory && existingFile && uuid) {
                if (existingFile.hash === hash && existingFile.size === stats.size && existingFile.mtime === stats.mtimeMs) {
                    this.stats.skipUnchangedFile++;
                    return uuid; // 完全未变
                }
                // 内容相同但 size/mtime 变化，或内容变化：只更新必要字段
                const nowLite = Date.now();
                let changed = false;
                if (existingFile.hash !== hash) { existingFile.hash = hash; changed = true; }
                if (existingFile.size !== stats.size) { existingFile.size = stats.size; changed = true; }
                if (existingFile.mtime !== stats.mtimeMs) { existingFile.mtime = stats.mtimeMs; changed = true; }
                if (changed) {
                    existingFile.lastTrackedAt = nowLite;
                    existingFile.updatedAt = nowLite;
                    this.markChanged();
                    this.markShardDirty(uuid, 'existing file content changed (hash/size/mtime)');
                    if (!isDirectory) { this.markAncestorsDirty(filePath); }
                    this.scheduleSave();
                }
                return uuid;
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
                filePath: this.toAbsPath(key),              // ← 绝对路径（与相对键解耦）
                fileName,
                fileExtension,
                size: stats.size,
                mtime: stats.mtimeMs,
                hash,
                isDirectory,
                maxHeading,
                headingLevel,
                writingStats: existingFile?.writingStats,   // 保留现有的写作统计
                createdAt: existingFile?.createdAt || now,
                lastTrackedAt: now,
                updatedAt: now
            };

            // 更新数据库（用相对键写映射）
            this.database.files[uuid] = metadata;
            this.database.pathToUuid[key] = uuid;

            this.markChanged();
            this.markShardDirty(uuid, existingFile ? 'recreate metadata (missing shard loaded later)' : 'new file tracked');
            this.scheduleSave();

            // 更新父目录聚合哈希
            if (!isDirectory) {
                this.stats.addFile++;
                this.markAncestorsDirty(filePath);
            } else {
                this.stats.addDir++;
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
        const key = this.toRelKey(filePath);
        const uuid = this.database.pathToUuid[key];
        if (uuid) {
            delete this.database.files[uuid];
            delete this.database.pathToUuid[key];
            this.removedShardUuids.add(uuid);
            this.markChanged();
            this.scheduleSave();
            this.markAncestorsDirty(filePath);
            this.stats.removeFile++;
        }
    }


    /**
     * 重命名文件
     */
    public renameFile(oldPath: string, newPath: string): void {
        const oldKey = this.toRelKey(oldPath);
        const newKey = this.toRelKey(newPath);
        const uuid = this.database.pathToUuid[oldKey];
        if (uuid) {
            const metadata = this.database.files[uuid];
            if (metadata) {
                metadata.filePath = this.toAbsPath(newKey);
                metadata.fileName = path.basename(newPath);
                metadata.fileExtension = path.extname(newPath).toLowerCase();
                metadata.updatedAt = Date.now();
            }
            delete this.database.pathToUuid[oldKey];
            this.database.pathToUuid[newKey] = uuid;
            this.markChanged();
            this.markShardDirty(uuid, 'rename file path/metadata changed');
            this.scheduleSave();
            this.markAncestorsDirty(newPath);
            this.stats.renameFile++;
        }
    }


    /**
     * 目录重命名：批量迁移子文件（含子目录）路径映射及元数据
     * - 使用工作区相对键进行前缀匹配与改写
     * - 仅迁移“子项”，不改动目录自身条目
     * - 同步刷新每个子项的 meta.filePath / fileName / fileExtension
     */
    public renameDirectoryChildren(oldDir: string, newDir: string): void {
        // 相对键前缀（统一大小写/分隔符）
        const oldRelPrefix = this.normKeyLike(this.toRelKey(oldDir)) + '/';
        const newRelPrefix = this.normKeyLike(this.toRelKey(newDir)) + '/';

        const entries = Object.entries(this.database.pathToUuid);
        let changed = false;

        for (const [key, uuid] of entries) {
            const kNorm = this.normKeyLike(key);

            // 仅处理“子项”：以 oldRelPrefix 开头，且不是目录本身
            if (!kNorm.startsWith(oldRelPrefix)) { continue; }

            const tail = kNorm.substring(oldRelPrefix.length);
            const newKey = newRelPrefix + tail;

            // 更新 pathToUuid 映射（删旧写新）
            delete this.database.pathToUuid[key];
            this.database.pathToUuid[newKey] = uuid;

            // 更新元数据的绝对路径及派生字段
            const meta = this.database.files[uuid];
            if (meta) {
                const newAbs = this.toAbsPath(newKey);
                meta.filePath = newAbs;
                meta.fileName = path.basename(newAbs);
                meta.fileExtension = path.extname(newAbs).toLowerCase();
                meta.updatedAt = Date.now();
                meta.lastTrackedAt = Date.now();
                this.markShardDirty(uuid, 'rename directory children path update');
            }

            changed = true;
        }

        if (changed) {
            this.markChanged();
            this.scheduleSave();
            // 两侧目录的聚合哈希都可能变化：旧目录失去子项，新目录获得子项
            this.markAncestorsDirty(oldDir);
            this.markAncestorsDirty(newDir);
            this.stats.renameDirChildren++;
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
        achievedMilestones?: number[]; // 已达成的里程碑目标
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
                        averageCPM: 0,
                        achievedMilestones: []
                    };
                }
                const prev = metadata.writingStats;
                // 构造新的临时对象以比较变化
                const next = { ...prev } as typeof prev;
                if (stats.totalMillis !== undefined) { next.totalMillis = stats.totalMillis; }
                if (stats.charsAdded !== undefined) { next.charsAdded = stats.charsAdded; }
                if (stats.charsDeleted !== undefined) { next.charsDeleted = stats.charsDeleted; }
                if (stats.lastActiveTime !== undefined) { next.lastActiveTime = stats.lastActiveTime; }
                if (stats.sessionsCount !== undefined) { next.sessionsCount = stats.sessionsCount; }
                if (stats.averageCPM !== undefined) { next.averageCPM = stats.averageCPM; }
                if (stats.buckets !== undefined) { next.buckets = stats.buckets; }
                if (stats.sessions !== undefined) { next.sessions = stats.sessions; }
                if (stats.achievedMilestones !== undefined) { next.achievedMilestones = stats.achievedMilestones; }

                const simpleChanged = prev.totalMillis !== next.totalMillis || prev.charsAdded !== next.charsAdded || prev.charsDeleted !== next.charsDeleted || prev.sessionsCount !== next.sessionsCount || prev.averageCPM !== next.averageCPM;
                const bucketsChanged = JSON.stringify(prev.buckets || []) !== JSON.stringify(next.buckets || []);
                const sessionsChanged = JSON.stringify(prev.sessions || []) !== JSON.stringify(next.sessions || []);
                const milestonesChanged = JSON.stringify(prev.achievedMilestones || []) !== JSON.stringify(next.achievedMilestones || []);
                const lastActiveChangedOnly = !simpleChanged && !bucketsChanged && !sessionsChanged && !milestonesChanged && prev.lastActiveTime !== next.lastActiveTime;

                // 仅 lastActiveTime 变化（纯阅读/聚焦）不写入，避免产生无意义脏分片
                if (lastActiveChangedOnly) {
                    return; // 不更新写库
                }
                if (simpleChanged || bucketsChanged || sessionsChanged || milestonesChanged) {
                    const reasonParts: string[] = [];
                    if (prev.totalMillis !== next.totalMillis) { reasonParts.push('totalMillis'); }
                    if (prev.charsAdded !== next.charsAdded) { reasonParts.push('charsAdded'); }
                    if (prev.charsDeleted !== next.charsDeleted) { reasonParts.push('charsDeleted'); }
                    if (prev.sessionsCount !== next.sessionsCount) { reasonParts.push('sessionsCount'); }
                    if (prev.averageCPM !== next.averageCPM) { reasonParts.push('averageCPM'); }
                    if (bucketsChanged) { reasonParts.push('buckets'); }
                    if (sessionsChanged) { reasonParts.push('sessions'); }
                    if (milestonesChanged) { reasonParts.push('achievedMilestones'); }
                    console.log(`[FileTracking] writingStats diff -> ${reasonParts.join(',') || 'unknown'} file=${filePath}`);
                    Object.assign(prev, next);
                    metadata.updatedAt = Date.now();
                    this.markChanged();
                    this.markShardDirty(uuid, 'writingStats changed');
                    this.scheduleSave();
                    this.stats.writingStatsUpdates++;
                }
            }
        }
    }

    /**
     * 更新文件的字数统计（供 WordCountProvider 使用）
     */
    public updateWordCountStats(filePath: string, stats: {
        cjkChars: number;
        asciiChars: number;
        words: number;
        nonWSChars: number;
        total: number;
    }): void {
        const uuid = this.getFileUuid(filePath);
        if (!uuid) { return; }
        const metadata = this.database.files[uuid];
        if (!metadata) { return; }
        if (!metadata.wordCountStats) {
            metadata.wordCountStats = { cjkChars: 0, asciiChars: 0, words: 0, nonWSChars: 0, total: 0 };
        }
        const prev = metadata.wordCountStats;
        const changed = prev.cjkChars !== stats.cjkChars || prev.asciiChars !== stats.asciiChars || prev.words !== stats.words || prev.nonWSChars !== stats.nonWSChars || prev.total !== stats.total;
        if (!changed) { return; }
        metadata.wordCountStats = { ...stats };
        metadata.updatedAt = Date.now();
        metadata.lastTrackedAt = Date.now();
        this.markChanged();
        this.markShardDirty(uuid, 'wordCountStats changed');
        this.scheduleSave();
        this.stats.wordCountUpdates++;
    }

    /** 标记文件为临时（未保存） */
    public markFileTemporary(filePath: string): void {
        const uuid = this.getFileUuid(filePath);
        if (!uuid) { return; }
        const meta = this.database.files[uuid];
        if (!meta) { return; }
        if (meta.isTemporary) { return; }
        meta.isTemporary = true;
        meta.updatedAt = Date.now();
        meta.lastTrackedAt = Date.now();
        this.markChanged();
        this.markShardDirty(uuid, 'mark temporary');
        this.scheduleSave();
        this.stats.markTemp++;
    }
    /** 取消临时标记（文件已保存） */
    public markFileSaved(filePath: string): void {
        const uuid = this.getFileUuid(filePath);
        if (!uuid) { return; }
        const meta = this.database.files[uuid];
        if (!meta) { return; }
        if (!meta.isTemporary) { return; }
        meta.isTemporary = false;
        meta.updatedAt = Date.now();
        meta.lastTrackedAt = Date.now();
        this.markChanged();
        this.markShardDirty(uuid, 'mark saved');
        this.scheduleSave();
        this.stats.markSaved++;
    }

    /**
     * 获取所有被追踪的文件
     */
    public getAllFiles(): FileMetadata[] {
        this.ensureAllShardsLoaded();
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

    // ===== 异步分片读取与异步流水线 =====

    /** 异步读取单个分片（不抛错，失败返回 undefined） */
    private async readSingleShardAsync(uuid: string): Promise<FileMetadata | undefined> {
        const p = this.shardFilePath(uuid);
        try {
            const raw = await fs.promises.readFile(p, 'utf8'); // 不要先 existsSync
            const meta = JSON.parse(raw) as FileMetadata;
            if (meta && meta.filePath) {
                meta.filePath = this.toAbsPath(meta.filePath);
            }
            return meta && meta.uuid ? meta : undefined;
        } catch (e: any) {
            // ENOENT/JSON 错误等都直接返回 undefined，避免抛错卡住批处理
            return undefined;
        }
    }


    /** 异步获取某 uuid 的元数据；可选写入内存缓存以便后续同步 API 复用 */
    private async getMetaAsync(uuid: string, cacheLoaded = true): Promise<FileMetadata | undefined> {
        const mem = this.database.files[uuid];
        if (mem) { return mem; }
        const meta = await this.readSingleShardAsync(uuid);
        if (cacheLoaded && meta) {
            this.database.files[uuid] = meta;
            if (meta.isDirectory) { this.indexDirFlag.add(uuid); }
        }
        return meta;
    }

    /** 异步枚举全部文件（惰性按需加载分片；不强制一次性加载全部） */
    public async getAllFilesAsync(opts?: { cacheLoaded?: boolean }): Promise<FileMetadata[]> {
        const entries = Object.entries(this.database.pathToUuid);
        const result: FileMetadata[] = [];
        for (const [key, uuid] of entries) {
            let meta = this.database.files[uuid];
            if (!meta) {
                const abs = this.toAbsPath(key);                                  // ←
                const cacheMeta = await getFileMetadataFromCache(abs).catch(() => null);
                if (cacheMeta !== null) {
                    this.database.files[uuid] = cacheMeta;
                    meta = cacheMeta;
                }
            }
            if (meta) { result.push(meta); }
        }
        return result;
    }


    /** 异步筛选（predicate 可为同步或异步） */
    public async filterFilesAsync(
        predicate: (file: FileMetadata) => boolean | Promise<boolean>,
        opts?: { cacheLoaded?: boolean }
    ): Promise<FileMetadata[]> {
        const all = await this.getAllFilesAsync(opts);
        const out: FileMetadata[] = [];
        for (const f of all) {
            if (await predicate(f)) { out.push(f); }
        }
        return out;
    }

    /** 异步统计（不强制全量预加载） */
    public async getStatsAsync(): Promise<{
        totalFiles: number;
        totalSize: number;
        filesByExtension: { [ext: string]: number };
        lastUpdated: number;
    }> {
        const files = await this.getAllFilesAsync({ cacheLoaded: true });
        const totalFiles = files.length;
        const totalSize = files.reduce((sum, f) => sum + (f.size || 0), 0);
        const filesByExtension: Record<string, number> = {};
        for (const f of files) {
            const ext = f.fileExtension || 'unknown';
            filesByExtension[ext] = (filesByExtension[ext] || 0) + 1;
        }
        return {
            totalFiles,
            totalSize,
            filesByExtension,
            lastUpdated: this.database.lastUpdated,
        };
    }

    //TODO 没有做快路径快速处理
    /** 并发一次性拉取所有 writingStats（优先内存，其次 pcache/worker，最后才回退分片） */
    // 允许传入 onPartial 回调与节流间隔（避免 UI 被刷爆）
    public async getAllWritingStatsAsync(opts?: {
        onPartial?: (chunk: WritingStatsRow[]) => void;   // 每次产出一批就回调
        flushIntervalMs?: number;                         // 批量回调节流，默认 80ms
    }): Promise<WritingStatsRow[]> {
        const entries = Object.entries(this.database.pathToUuid); // key 为“相对键”
        if (entries.length === 0) { return []; }

        const CONCURRENCY = 24; // 本地 SSD 可设 24~32；网络盘建议 8~16
        const onPartial = opts?.onPartial;
        const flushIntervalMs = opts?.flushIntervalMs ?? 80;

        // —— 小工具：把待发送的结果做一个节流批量回调，避免过于频繁 ——
        const pending: WritingStatsRow[] = [];
        let timer: ReturnType<typeof setTimeout> | undefined;
        const flush = (immediate = false) => {
            if (!onPartial || pending.length === 0) { return; }
            if (immediate) {
                const out = pending.splice(0);
                onPartial(out);
                return;
            }
            if (!timer) {
                timer = setTimeout(() => {
                    timer = undefined;
                    const out = pending.splice(0);
                    if (out.length) { onPartial(out); }
                }, flushIntervalMs);
            }
        };
        const pushEmit = (rows: WritingStatsRow[] | WritingStatsRow | undefined) => {
            if (!rows) { return; }
            if (Array.isArray(rows)) { pending.push(...rows); }
            else { pending.push(rows); }
            flush(false);
        };

        // —— 快路径：内存已有 meta 且含写作统计 ——
        const fast: WritingStatsRow[] = [];
        const toLoad: Array<[string, string]> = []; // [key(相对键), uuid]

        for (const [key, uuid] of entries) {
            const mem = this.database.files[uuid];
            // 目录一般不会有写作统计；索引里标记为目录的也跳过
            if (mem?.isDirectory || this.indexDirFlag.has(uuid)) { continue; }

            if (mem?.writingStats) {
                const ws = mem.writingStats;
                fast.push({
                    filePath: mem.filePath || this.toAbsPath(key), // ← 关键：回退为绝对路径
                    totalMillis: ws.totalMillis ?? 0,
                    charsAdded: ws.charsAdded ?? 0,
                    charsDeleted: ws.charsDeleted ?? 0,
                    lastActiveTime: ws.lastActiveTime ?? 0,
                    sessionsCount: ws.sessionsCount ?? 0,
                    averageCPM: ws.averageCPM ?? 0,
                    buckets: ws.buckets,
                    sessions: ws.sessions,
                });
            } else {
                toLoad.push([key, uuid]); // 仍需加载
            }
        }

        // 立刻把快路径的结果“抛出去”，调用方可先渲染
        if (fast.length) {
            pushEmit(fast);
            // 立刻刷新一次，确保第一批不被节流延迟
            flush(true);
        }

        // —— 慢路径：优先 pcache/worker（getFileMetadataFromCache），再回退分片 getMetaAsync ——
        // 在 mapper 内部就“边算边 emit”，最终仍收集全量数组以作为返回值
        const slow = await this.mapWithConcurrency<[string, string], WritingStatsRow | undefined>(
            toLoad,
            CONCURRENCY,
            async ([key, uuid]) => {
                const abs = this.toAbsPath(key); // ← 相对键转绝对路径

                // // 1) 先尝试 pcache（内部会用 worker + gitGuard 校验）
                // let meta = await getFileMetadataFromCache(abs).catch(() => null);
                //TODO 暂时回退到数据库自己读写
                let meta = undefined;

                // 2) 若 pcache miss，再回退到分片读取（一次）
                if (!meta) {
                    const m = await this.getMetaAsync(uuid, true).catch(() => undefined);
                    meta = m ?? null;
                    // 有了磁盘结果就顺带写回内存，避免下次再读
                    if (meta) { this.database.files[uuid] = meta; }
                }

                const ws = meta?.writingStats;
                if (!ws) { return undefined; }

                const row: WritingStatsRow = {
                    filePath: meta!.filePath || abs, // ← 优先 meta.filePath，回退绝对路径
                    totalMillis: ws.totalMillis ?? 0,
                    charsAdded: ws.charsAdded ?? 0,
                    charsDeleted: ws.charsDeleted ?? 0,
                    lastActiveTime: ws.lastActiveTime ?? 0,
                    sessionsCount: ws.sessionsCount ?? 0,
                    averageCPM: ws.averageCPM ?? 0,
                    buckets: ws.buckets,
                    sessions: ws.sessions,
                };

                // 一旦产出就触发部分结果回调（带节流）
                pushEmit(row);
                return row;
            }
        );

        // 把最后一批也冲出去
        flush(true);

        // 依然返回全量（老代码调用无感知）
        return fast.concat(slow.filter(Boolean) as WritingStatsRow[]);
    }



    /** 异步流式产出 writingStats（适合 UI 渐进展示或超大工程） */
    public async *streamWritingStats(): AsyncGenerator<{
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
        const entries = Object.entries(this.database.pathToUuid);
        for (const [key, uuid] of entries) {
            const meta = this.database.files[uuid] ?? await this.getMetaAsync(uuid, true);
            if (!meta || !meta.writingStats) { continue; }
            const ws = meta.writingStats;
            yield {
                filePath: meta.filePath || this.toAbsPath(key),   // ← 用绝对路径回退
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
        this.saveDatabase(true); // 关闭时强制写入
    }

    // ===== 分片存储逻辑 =====
    private migrateIfNeeded(): void {
        if (!fs.existsSync(this.indexPath) && fs.existsSync(this.dbPath)) {
            try {
                const raw = fs.readFileSync(this.dbPath, 'utf8');
                const json = JSON.parse(raw);
                if (json && json.files && json.pathToUuid) {
                    console.log('[FileTracking] 开始迁移旧 JSON -> 分片');
                    for (const uuid of Object.keys(json.files)) {
                        const meta = json.files[uuid];
                        this.writeShard(meta);
                    }
                    this.writeIndex();
                    try {
                        fs.unlinkSync(this.dbPath);
                        console.log('[FileTracking] 迁移完成并删除旧文件 file-tracking.json');
                    } catch (eDel) {
                        console.warn('迁移删除旧文件失败', eDel);
                    }
                }
            } catch (e) { console.warn('迁移失败或不需要:', e); }
        }
    }

    private shardFilePath(uuid: string): string {
        const prefix = uuid.slice(0, 2);
        const dir = path.join(this.dbDir, prefix);
        if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
        return path.join(dir, uuid + '.json');
    }
    private writeShard(meta: FileMetadata): void {
        try {
            const p = this.shardFilePath(meta.uuid);
            const { writingStats, wordCountStats, ...base } = meta;
            // 分片落盘一律使用“相对键”（工作区内，POSIX；Win 下小写）
            const relKey = this.toRelKey(meta.filePath);
            const payload = { ...base, filePath: relKey, writingStats, wordCountStats };
            fs.writeFileSync(p, JSON.stringify(payload));
        } catch (e) { console.warn('写入分片失败', e); }
    }

    private loadShardedFiles(): void {
        if (!fs.existsSync(this.dbDir)) { return; }
        try {
            const entries = fs.readdirSync(this.dbDir);
            for (const sub of entries) {
                const subPath = path.join(this.dbDir, sub);
                try {
                    if (fs.statSync(subPath).isDirectory()) {
                        const files = fs.readdirSync(subPath);
                        for (const f of files) {
                            if (!f.endsWith('.json')) { continue; }
                            const full = path.join(subPath, f);
                            try {
                                const meta = JSON.parse(fs.readFileSync(full, 'utf8')) as FileMetadata;
                                if (meta && meta.uuid) {
                                    // 只要分片里存了绝对路径，就记为需要“分片路径迁移”
                                    if (meta.filePath && (path.isAbsolute(meta.filePath) || /^[a-z]:[\\/]/i.test(meta.filePath))) {
                                        this.needsShardPathMigration = true;
                                    }
                                    // 分片里可能是相对键；读入内存先还原为绝对路径
                                    if (meta.filePath) { meta.filePath = this.toAbsPath(meta.filePath); }
                                    this.database.files[meta.uuid] = meta;
                                    const key = this.toRelKey(meta.filePath);       // ← 关键
                                    this.database.pathToUuid[key] = meta.uuid;
                                }
                            } catch { /* ignore */ }
                        }
                    }
                } catch {/* ignore */ }
            }
        } catch (e) { console.warn('加载分片失败', e); }
    }
    // ===== 惰性加载支持（重新实现并修复截断） =====
    private loadIndexOnly(): void {
        try {
            if (!fs.existsSync(this.indexPath)) { return; }
            const raw = fs.readFileSync(this.indexPath, 'utf8');
            const idx = JSON.parse(raw);
            const entries = idx.entries || idx.files || [];
            let cleaned = false;

            for (const ent of entries) {
                if (typeof ent === 'string') { continue; } // 老格式忽略
                const u = ent.u; const p = ent.p; const d = ent.d;
                if (!u || !p) { continue; }

                // 统一：index里的 p 可能是绝对路径，也可能是历史相对键
                const abs = this.toAbsPath(p);           // p -> 绝对
                const rel = this.toRelKey(abs);          // 绝对 -> 归一化相对键（POSIX，Win下小写）

                // 只要 p 与规范化后的 rel 不一致，就说明 index 中存在遗留绝对路径或未规范化路径
                if (p !== rel) {
                    this.needsIndexPathMigration = true;
                    cleaned = true;
                }

                // 内存映射中始终用“相对键”
                this.database.pathToUuid[rel] = u;

                // 目录项：尽量预载其分片（用于后续目录哈希聚合等）
                if (d) {
                    const meta = this.readSingleShard(u);
                    if (meta) { this.database.files[u] = meta; }
                    this.indexDirFlag.add(u);
                }
            }

            // 如果有清理，标记变化并调度一次保存（会重写 index 为纯相对键）
            if (cleaned) {
                this.markChanged();
                this.scheduleSave();
            }

            console.log(`[FileTracking] 惰性索引加载 paths=${Object.keys(this.database.pathToUuid).length} cleaned=${cleaned} needMigIdx=${this.needsIndexPathMigration}`);
        } catch (e) {
            console.warn('惰性加载 index 失败', e);
        }
    }

    private readSingleShard(uuid: string): FileMetadata | undefined {
        try {
            const p = this.shardFilePath(uuid);
            if (!fs.existsSync(p)) { return undefined; }
            let meta = JSON.parse(fs.readFileSync(p, 'utf8')) as FileMetadata;
            if (meta && meta.filePath) {
                meta.filePath = this.toAbsPath(meta.filePath); // 相对 -> 绝对（供内存使用）
            }
            return meta;
        } catch { return undefined; }
    }
    private ensureShardLoaded(uuid: string): void {
        if (this.database.files[uuid]) { return; }
        const meta = this.readSingleShard(uuid);
        if (meta) {
            this.database.files[uuid] = meta;
            if (meta.isDirectory) { this.indexDirFlag.add(uuid); }
        }
    }
    private ensureAllShardsLoaded(): void {
        if (!this.lazyLoadShards) { return; }
        const total = Object.keys(this.database.pathToUuid).length;
        if (Object.keys(this.database.files).length >= total) { return; }
        for (const u of Object.values(this.database.pathToUuid)) {
            if (!this.database.files[u]) { this.ensureShardLoaded(u); }
        }
        console.log('[FileTracking] 惰性补全加载完成');
    }
    private writeIndex(): void {
        try {
            // 使用 pathToUuid 保证即便尚未加载分片也能写出索引
            const entries = Object.entries(this.database.pathToUuid).map(([p, u]) => {
                const meta = this.database.files[u];
                const isDir = meta ? !!meta.isDirectory : this.indexDirFlag.has(u);
                return { u, p, d: isDir ? 1 : 0 };
            });
            const idx = { version: this.DB_VERSION + '+idx1', lastUpdated: Date.now(), entries };
            fs.writeFileSync(this.indexPath, JSON.stringify(idx));
        } catch (e) { console.warn('写入 index 失败', e); }
    }
    private saveSharded(force: boolean): void {
        if (!this.hasUnsavedChanges && !force) { return; }
        if (force && this.dirtyShardUuids.size === 0 && this.removedShardUuids.size === 0) {
            // 全量写入（包括惰性未加载但存在 pathToUuid 的分片 -> 若未加载则跳过，因为没有最新内存副本）
            for (const uuid of Object.values(this.database.pathToUuid)) {
                const meta = this.database.files[uuid];
                if (meta) { this.writeShard(meta); }
            }
            this.writeIndex();
            return;
        }
        for (const uuid of this.dirtyShardUuids) {
            const meta = this.database.files[uuid];
            if (meta) { this.writeShard(meta); }
        }
        for (const uuid of this.removedShardUuids) {
            try { const p = this.shardFilePath(uuid); if (fs.existsSync(p)) { fs.unlinkSync(p); } } catch {/* ignore */ }
        }
        this.writeIndex();
        this.dirtyShardUuids.clear();
        this.removedShardUuids.clear();
    }
    /** 兼容: 创建临时文件追踪记录 */
    public createTemporaryFile(filePath: string): string {
        const existing = this.getFileUuid(filePath);
        if (existing) { this.markFileTemporary(filePath); return existing; }
        const now = Date.now();
        const uuid = uuidv4();
        const fileName = path.basename(filePath);
        const fileExtension = path.extname(filePath).toLowerCase();
        const meta: FileMetadata = {
            uuid, filePath, fileName, fileExtension,
            size: 0, mtime: 0, hash: '', isDirectory: false,
            isTemporary: true, createdAt: now, lastTrackedAt: now, updatedAt: now
        };
        this.database.files[uuid] = meta;
        const key = this.toRelKey(filePath);
        this.database.pathToUuid[key] = uuid;
        this.markChanged();
        this.markShardDirty(uuid, 'create temporary file');
        this.scheduleSave();
        this.stats.temporaryCreate++;
        return uuid;
    }

    public markAsTemporary(filePath: string) { this.markFileTemporary(filePath); }
    public markAsSaved(filePath: string) { this.markFileSaved(filePath); }
    public handleFileDeleted(filePath: string): boolean { const uuid = this.getFileUuid(filePath); if (!uuid) { return false; } this.removeFile(filePath); return true; }
    public async dispose(): Promise<void> { await this.forceSave(); }
}
