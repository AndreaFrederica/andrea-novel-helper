/**
 * JSON分片存储后端
 * 包装现有的JSON分片文件系统实现
 */

import * as fs from 'fs';
import * as path from 'path';
import {
    IDatabaseBackend,
    DatabaseConfig,
    WritingFileSummary,
    WritingFileSummaryIndex,
    WritingProjectSummary,
} from './IDatabaseBackend';

export class JSONShardedBackend implements IDatabaseBackend {
    private config: DatabaseConfig;
    private dbDir: string;
    private indexPath: string;
    private writingSummaryPath: string;
    private writingFileIndexPath: string;
    private initialized = false;
    private indexNeedsRewrite = false;
    private writingProjectSummaryCache: WritingProjectSummary | null | undefined = undefined;
    private writingFileSummaryLoaded = false;
    private writingFileSummaryCache: Map<string, WritingFileSummary> = new Map();

    // 内存缓存（用于加速重复查询）
    private memoryCache: Map<string, any> = new Map();
    private pathToUuid: Map<string, string> = new Map();

    constructor(config: DatabaseConfig) {
        this.config = config;
        const dataPath = config.json?.dataPath || 'novel-helper/.anh-fsdb';
        this.dbDir = path.join(config.workspaceRoot, dataPath);
        this.indexPath = path.join(this.dbDir, 'index.json');
        this.writingSummaryPath = path.join(this.dbDir, 'writing-summary.json');
        this.writingFileIndexPath = path.join(this.dbDir, 'writing-file-index.json');
    }

    private readJsonFile<T>(filePath: string): T | null {
        if (!fs.existsSync(filePath)) {
            return null;
        }

        try {
            return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
        } catch {
            return null;
        }
    }

    private writeJsonFile(filePath: string, data: unknown): void {
        fs.writeFileSync(filePath, JSON.stringify(data));
    }

    private loadWritingFileSummaryCache(): void {
        if (this.writingFileSummaryLoaded) {
            return;
        }

        this.writingFileSummaryLoaded = true;
        this.writingFileSummaryCache.clear();

        const index = this.readJsonFile<WritingFileSummaryIndex>(this.writingFileIndexPath);
        const entries = index?.entries || {};
        for (const [uuid, summary] of Object.entries(entries)) {
            if (!summary || typeof summary !== 'object') {
                continue;
            }
            this.writingFileSummaryCache.set(uuid, {
                ...summary,
                uuid,
                path: summary.path ? this.toAbsPath(summary.path) : summary.path,
            });
        }
    }

    private persistWritingFileSummaryCache(): void {
        const entries: Record<string, WritingFileSummary> = {};
        for (const [uuid, summary] of this.writingFileSummaryCache.entries()) {
            entries[uuid] = {
                ...summary,
                path: this.toRelKey(summary.path || ''),
            };
        }

        const payload: WritingFileSummaryIndex = {
            version: 1,
            updatedAt: Date.now(),
            entries,
        };

        this.writeJsonFile(this.writingFileIndexPath, payload);
    }

    /** 统一化：工作区内返回相对键（POSIX，Win 下小写），否则返回规范化绝对路径 */
    private toRelKey(p: string): string {
        const rootAbs = path.resolve(this.config.workspaceRoot).replace(/\\/g, '/');
        // 相对路径基于 workspaceRoot 归一化；避免相对路径被 path.resolve 按进程 cwd 解析到 VS Code 安装目录
        const absBase = path.isAbsolute(p) || /^[a-z]:[\\/]/i.test(p) ? p : path.join(this.config.workspaceRoot, p);
        const abs = path.resolve(absBase).replace(/\\/g, '/');
        const lower = process.platform === 'win32';
        const absCmp = lower ? abs.toLowerCase() : abs;
        const rootCmp = lower ? rootAbs.toLowerCase() : rootAbs;
        if (absCmp === rootCmp || absCmp.startsWith(rootCmp + '/')) {
            const rel = absCmp.slice(rootCmp.length + (absCmp.length === rootCmp.length ? 0 : 1));
            return rel;
        }
        return absCmp;
    }

    /** 相对键还原为绝对路径；若本身是绝对路径则原样返回 */
    private toAbsPath(key: string): string {
        if (path.isAbsolute(key) || /^[a-z]:[\\/]/i.test(key)) {
            return path.resolve(key);
        }
        return path.resolve(path.join(this.config.workspaceRoot, key));
    }

    /** 查找映射表中某个 uuid 的首个键（用于反推工作区内的正确路径） */
    private getKeyForUuid(uuid: string): string | undefined {
        for (const [k, u] of this.pathToUuid.entries()) {
            if (u === uuid) { return k; }
        }
        return undefined;
    }

    /** 判断绝对路径是否在当前工作区内 */
    private isInsideWorkspace(absPath: string): boolean {
        const rootAbs = path.resolve(this.config.workspaceRoot).replace(/\\/g, '/');
        const norm = path.resolve(absPath).replace(/\\/g, '/');
        if (process.platform === 'win32') {
            return norm.toLowerCase().startsWith(rootAbs.toLowerCase() + '/');
        }
        return norm.startsWith(rootAbs + '/');
    }

    /** 后台扫描并重写历史绝对路径的分片和索引 */
    private async normalizeShardPaths(): Promise<void> {
        const uuids = Array.from(new Set(this.pathToUuid.values()));
        if (uuids.length === 0) { return; }

        const CONCURRENCY = 8;
        let idxChanged = this.indexNeedsRewrite;
        const queue = uuids.slice();
        const workers: Promise<void>[] = [];

        const runOne = async () => {
            while (queue.length) {
                const uuid = queue.pop();
                if (!uuid) { continue; }
                try {
                    // 读取 meta（带归一化）
                    const meta = await this.loadFileMetadata(uuid);
                    if (!meta) { continue; }
                    const rawPath = meta.filePath || '';
                    const rel = this.toRelKey(rawPath);
                    const mappedKey = this.getKeyForUuid(uuid);
                    const preferredKey = mappedKey || rel;
                    const abs = this.toAbsPath(preferredKey);
                    const needShardRewrite = rawPath !== rel && rawPath !== abs;
                    const needIndexRewrite = mappedKey && mappedKey !== rel;

                    if (needShardRewrite || needIndexRewrite) {
                        await this.saveFileMetadata(uuid, { ...meta, filePath: abs });
                        this.pathToUuid.set(preferredKey, uuid);
                        idxChanged = true;
                    }
                } catch (e) {
                    console.warn('[JSONSharded] normalize shard failed', uuid, e);
                }
            }
        };

        for (let i = 0; i < CONCURRENCY; i++) {
            workers.push(runOne());
        }
        await Promise.all(workers);

        if (idxChanged) {
            try {
                await this.saveIndex({});
                this.indexNeedsRewrite = false;
            } catch (e) {
                console.warn('[JSONSharded] rewrite index after normalize failed', e);
            }
        }
    }

    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        // 确保目录存在
        if (!fs.existsSync(this.dbDir)) {
            fs.mkdirSync(this.dbDir, { recursive: true });
        }

        // 加载索引到内存
        await this.loadIndexToMemory();
        // 启动后异步规范化历史分片/索引中的绝对路径
        void this.normalizeShardPaths().catch((e) => {
            console.warn('[JSONSharded] normalizeShardPaths failed', e);
        });

        this.initialized = true;

        if (this.config.debug) {
            console.log(`[JSONSharded] 数据库已初始化: ${this.dbDir}`);
        }
    }

    private async loadIndexToMemory(): Promise<void> {
        if (!fs.existsSync(this.indexPath)) {
            return;
        }

        try {
            const raw = fs.readFileSync(this.indexPath, 'utf8');
            const idx = JSON.parse(raw);
            const entries = idx.entries || idx.files || [];

            // 先按 uuid 聚合候选键，择优选择唯一键
            type Cand = { key: string; abs: string; isWorkspace: boolean; exists: boolean };
            const perUuid = new Map<string, Cand[]>();
            let normalized = false;

            for (const ent of entries) {
                if (typeof ent === 'string') continue;
                const u = ent.u;
                const p = ent.p;
                if (!u || !p) { continue; }
                const rel = this.toRelKey(p);
                const abs = this.toAbsPath(rel);
                const exists = fs.existsSync(abs);
                const isWorkspace = this.isInsideWorkspace(abs);
                if (rel !== p) { normalized = true; }
                if (!perUuid.has(u)) { perUuid.set(u, []); }
                perUuid.get(u)!.push({ key: rel, abs, isWorkspace, exists });
            }

            const pickBest = (cands: Cand[]): Cand => {
                // 1) 优先工作区内
                const workspace = cands.filter(c => c.isWorkspace);
                const pool = workspace.length ? workspace : cands;
                // 2) 优先存在的路径
                const existing = pool.filter(c => c.exists);
                const pool2 = existing.length ? existing : pool;
                // 3) 最短键优先（相对路径更短）
                return pool2.reduce((best, cur) => cur.key.length < best.key.length ? cur : best, pool2[0]);
            };

            const newMap = new Map<string, string>();
            for (const [uuid, cands] of perUuid.entries()) {
                const best = pickBest(cands);
                newMap.set(best.key, uuid);
                if (cands.length > 1 || !best.exists || !best.isWorkspace) {
                    normalized = true;
                }
            }

            this.pathToUuid = newMap;
            this.indexNeedsRewrite = this.indexNeedsRewrite || normalized;

            if (this.config.debug) {
                console.log(`[JSONSharded] 加载索引: ${this.pathToUuid.size} 个路径映射`);
            }

            if (this.indexNeedsRewrite) {
                await this.saveIndex({}); // 用规范化后的映射重写 index
                this.indexNeedsRewrite = false;
                if (this.config.debug) {
                    console.log('[JSONSharded] 已重写 index 为相对键');
                }
            }
        } catch (err) {
            console.warn('[JSONSharded] 加载索引失败:', err);
        }
    }

    async close(): Promise<void> {
        // JSON后端不需要特殊关闭操作
        this.memoryCache.clear();
        this.writingProjectSummaryCache = undefined;
        this.writingFileSummaryLoaded = false;
        this.writingFileSummaryCache.clear();
        this.initialized = false;

        if (this.config.debug) {
            console.log('[JSONSharded] 数据库已关闭');
        }
    }

    private shardFilePath(uuid: string): string {
        const prefix = uuid.slice(0, 2);
        const dir = path.join(this.dbDir, prefix);
        return path.join(dir, `${uuid}.json`);
    }

    async saveFileMetadata(uuid: string, metadata: any): Promise<void> {
        const shardPath = this.shardFilePath(uuid);
        const dir = path.dirname(shardPath);

        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const payload = { ...metadata, filePath: this.toRelKey(metadata.filePath || '') };
        fs.writeFileSync(shardPath, JSON.stringify(payload));
        
        // 更新内存缓存
        this.memoryCache.set(uuid, payload);
    }

    async saveFileMetadataBatch(entries: Array<{ uuid: string; metadata: any }>): Promise<void> {
        // 按分片目录分组，减少目录创建操作
        const byPrefix = new Map<string, Array<{ uuid: string; metadata: any }>>();
        
        for (const entry of entries) {
            const prefix = entry.uuid.slice(0, 2);
            if (!byPrefix.has(prefix)) {
                byPrefix.set(prefix, []);
            }
            byPrefix.get(prefix)!.push(entry);
        }

        // 批量写入
        for (const [prefix, batch] of byPrefix) {
            const dir = path.join(this.dbDir, prefix);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            for (const { uuid, metadata } of batch) {
                const shardPath = path.join(dir, `${uuid}.json`);
                const payload = { ...metadata, filePath: this.toRelKey(metadata.filePath || '') };
                fs.writeFileSync(shardPath, JSON.stringify(payload));
                this.memoryCache.set(uuid, payload);
            }
        }
    }

    async loadFileMetadata(uuid: string): Promise<any | null> {
        // 先检查内存缓存
        if (this.memoryCache.has(uuid)) {
            return this.memoryCache.get(uuid);
        }

        const shardPath = this.shardFilePath(uuid);
        if (!fs.existsSync(shardPath)) {
            return null;
        }

        try {
            const raw = fs.readFileSync(shardPath, 'utf8');
            const data = JSON.parse(raw);
            const rawPath = data?.filePath;
            const rel = this.toRelKey(rawPath || '');
            const mappedKey = this.getKeyForUuid(uuid);
            const preferredKey = mappedKey || rel;
            const absPath = this.toAbsPath(preferredKey);
            // 只要分片中存的不是规范化相对键，就重写
            const needRewrite = rawPath && rawPath !== rel;
            if (data) {
                data.filePath = absPath;
            }
            
            // 更新缓存
            this.memoryCache.set(uuid, data);
            
            // 若发现工作区内条目仍存绝对键，立刻重写归一化
            if (needRewrite) {
                try { await this.saveFileMetadata(uuid, data); } catch {/* ignore rewrite errors */}
            }

            return data;
        } catch {
            return null;
        }
    }

    async loadFileMetadataBatch(uuids: string[]): Promise<Map<string, any>> {
        const result = new Map<string, any>();
        const toLoad: string[] = [];
        const pendingRewrite: Array<{ uuid: string; metadata: any }> = [];

        // 先从缓存获取
        for (const uuid of uuids) {
            if (this.memoryCache.has(uuid)) {
                result.set(uuid, this.memoryCache.get(uuid));
            } else {
                toLoad.push(uuid);
            }
        }

        if (toLoad.length === 0) {
            return result;
        }

        // 按分片目录分组，批量读取
        const byPrefix = new Map<string, string[]>();
        for (const uuid of toLoad) {
            const prefix = uuid.slice(0, 2);
            if (!byPrefix.has(prefix)) {
                byPrefix.set(prefix, []);
            }
            byPrefix.get(prefix)!.push(uuid);
        }

        // 并发读取各个分片目录
        await Promise.all(
            Array.from(byPrefix.entries()).map(async ([prefix, batch]) => {
                const dir = path.join(this.dbDir, prefix);
                
                for (const uuid of batch) {
                    const shardPath = path.join(dir, `${uuid}.json`);
            if (fs.existsSync(shardPath)) {
                try {
                    const raw = fs.readFileSync(shardPath, 'utf8');
                    const data = JSON.parse(raw);
                    const rawPath = data?.filePath;
                    const rel = this.toRelKey(rawPath || '');
                    const mappedKey = this.getKeyForUuid(uuid);
                    const preferredKey = mappedKey || rel;
                    const absPath = this.toAbsPath(preferredKey);
                    const needRewrite = rawPath && rawPath !== rel;
                    if (data) { data.filePath = absPath; }
                    result.set(uuid, data);
                    this.memoryCache.set(uuid, data);
                    if (needRewrite) { // 延迟重写，批量结束后统一写
                        pendingRewrite.push({ uuid, metadata: { ...data, filePath: absPath } });
                    }
                } catch {
                    // 忽略读取失败
                }
            }
                }
            })
        );

        if (pendingRewrite.length) {
            try { await this.saveFileMetadataBatch(pendingRewrite); } catch {/* ignore */}
        }

        return result;
    }

    async deleteFileMetadata(uuid: string): Promise<void> {
        const shardPath = this.shardFilePath(uuid);
        
        if (fs.existsSync(shardPath)) {
            fs.unlinkSync(shardPath);
        }

        this.memoryCache.delete(uuid);
    }

    async deleteFileMetadataBatch(uuids: string[]): Promise<void> {
        for (const uuid of uuids) {
            await this.deleteFileMetadata(uuid);
        }
    }

    async savePathMapping(path: string, uuid: string): Promise<void> {
        const rel = this.toRelKey(path);
        this.pathToUuid.set(rel, uuid);
        // 路径映射通过index.json持久化
    }

    async savePathMappingBatch(mappings: Array<{ path: string; uuid: string }>): Promise<void> {
        for (const { path, uuid } of mappings) {
            const rel = this.toRelKey(path);
            this.pathToUuid.set(rel, uuid);
        }
    }

    async getUuidByPath(path: string): Promise<string | null> {
        const rel = this.toRelKey(path);
        return this.pathToUuid.get(rel) || null;
    }

    async deletePathMapping(path: string): Promise<void> {
        const rel = this.toRelKey(path);
        this.pathToUuid.delete(rel);
    }

    async deletePathMappingRaw(path: string): Promise<void> {
        this.pathToUuid.delete(path);
    }

    async getAllPathMappings(): Promise<Map<string, string>> {
        return new Map(this.pathToUuid);
    }

    async getAllFileUuids(): Promise<string[]> {
        return Array.from(this.pathToUuid.values());
    }

    async saveIndex(data: any): Promise<void> {
        const entries = Array.from(this.pathToUuid.entries()).map(([p, u]) => ({
            u,
            p: this.toRelKey(p),
            d: 0  // 是否为目录，需要从元数据判断
        }));

        const idx = {
            version: '1.0.0+idx1',
            lastUpdated: Date.now(),
            entries
        };

        fs.writeFileSync(this.indexPath, JSON.stringify(idx));
    }

    async loadIndex(): Promise<any | null> {
        if (!fs.existsSync(this.indexPath)) {
            return null;
        }

        try {
            const raw = fs.readFileSync(this.indexPath, 'utf8');
            const json = JSON.parse(raw);
            if (json?.entries) {
                json.entries = json.entries.map((ent: any) => {
                    if (!ent || typeof ent !== 'object') { return ent; }
                    return { ...ent, p: this.toRelKey(ent.p) };
                });
            }
            return json;
        } catch {
            return null;
        }
    }

    async saveWritingProjectSummary(summary: WritingProjectSummary): Promise<void> {
        const normalized: WritingProjectSummary = {
            ...summary,
            updatedAt: summary.updatedAt || Date.now(),
        };
        this.writingProjectSummaryCache = normalized;
        this.writeJsonFile(this.writingSummaryPath, normalized);
    }

    async loadWritingProjectSummary(): Promise<WritingProjectSummary | null> {
        if (this.writingProjectSummaryCache !== undefined) {
            return this.writingProjectSummaryCache;
        }

        this.writingProjectSummaryCache = this.readJsonFile<WritingProjectSummary>(this.writingSummaryPath);
        return this.writingProjectSummaryCache;
    }

    async saveWritingFileSummary(summary: WritingFileSummary): Promise<void> {
        this.loadWritingFileSummaryCache();
        this.writingFileSummaryCache.set(summary.uuid, {
            ...summary,
            path: summary.path ? this.toAbsPath(summary.path) : summary.path,
            updatedAt: summary.updatedAt || Date.now(),
        });
        this.persistWritingFileSummaryCache();
    }

    async saveWritingFileSummaryBatch(entries: WritingFileSummary[]): Promise<void> {
        this.loadWritingFileSummaryCache();
        for (const summary of entries) {
            this.writingFileSummaryCache.set(summary.uuid, {
                ...summary,
                path: summary.path ? this.toAbsPath(summary.path) : summary.path,
                updatedAt: summary.updatedAt || Date.now(),
            });
        }
        this.persistWritingFileSummaryCache();
    }

    async loadWritingFileSummary(uuid: string): Promise<WritingFileSummary | null> {
        this.loadWritingFileSummaryCache();
        const summary = this.writingFileSummaryCache.get(uuid);
        return summary ? { ...summary } : null;
    }

    async loadAllWritingFileSummaries(): Promise<Map<string, WritingFileSummary>> {
        this.loadWritingFileSummaryCache();
        return new Map(
            Array.from(this.writingFileSummaryCache.entries()).map(([uuid, summary]) => [uuid, { ...summary }])
        );
    }

    async deleteWritingFileSummary(uuid: string): Promise<void> {
        this.loadWritingFileSummaryCache();
        if (this.writingFileSummaryCache.delete(uuid)) {
            this.persistWritingFileSummaryCache();
        }
    }

    async getStats(): Promise<{ totalFiles: number; totalMappings: number; dbSize?: number }> {
        return {
            totalFiles: this.memoryCache.size,
            totalMappings: this.pathToUuid.size
        };
    }

    async optimize(): Promise<void> {
        // 清理内存缓存，释放内存
        this.memoryCache.clear();

        if (this.config.debug) {
            console.log('[JSONSharded] 已清理内存缓存');
        }
    }

    async exportAll(): Promise<{
        files: Map<string, any>;
        pathMappings: Map<string, string>;
        index: any;
    }> {
        const files = new Map<string, any>();

        // 遍历所有分片目录
        if (fs.existsSync(this.dbDir)) {
            const entries = fs.readdirSync(this.dbDir);
            
            for (const sub of entries) {
                const subPath = path.join(this.dbDir, sub);
                
                if (fs.statSync(subPath).isDirectory()) {
                    const shardFiles = fs.readdirSync(subPath);
                    
                    for (const file of shardFiles) {
                        if (file.endsWith('.json')) {
                            const fullPath = path.join(subPath, file);
                            try {
                                const raw = fs.readFileSync(fullPath, 'utf8');
                                const data = JSON.parse(raw);
                                if (data.uuid) {
                                    if (data.filePath) { data.filePath = this.toAbsPath(data.filePath); }
                                    files.set(data.uuid, data);
                                }
                            } catch {
                                // 忽略损坏的文件
                            }
                        }
                    }
                }
            }
        }

        const index = await this.loadIndex();

        return {
            files,
            pathMappings: new Map(this.pathToUuid),
            index
        };
    }

    async importAll(data: {
        files: Map<string, any>;
        pathMappings: Map<string, string>;
        index: any;
    }): Promise<void> {
        // 清空现有数据
        if (fs.existsSync(this.dbDir)) {
            const entries = fs.readdirSync(this.dbDir);
            for (const sub of entries) {
                const subPath = path.join(this.dbDir, sub);
                if (/^[0-9a-f]{2}$/i.test(sub) && fs.statSync(subPath).isDirectory()) {
                    fs.rmSync(subPath, { recursive: true, force: true });
                }
            }
        }

        // 导入文件元数据（批量）
        const entries = Array.from(data.files.entries()).map(([uuid, metadata]) => ({
            uuid,
            metadata
        }));
        await this.saveFileMetadataBatch(entries);

        // 导入路径映射
        this.pathToUuid.clear();
        for (const [path, uuid] of data.pathMappings) {
            this.pathToUuid.set(path, uuid);
        }

        // 保存索引
        await this.saveIndex(data.index);

        if (this.config.debug) {
            console.log(`[JSONSharded] 数据导入完成: ${data.files.size} 个文件`);
        }
    }

    async checkHealth(): Promise<{ healthy: boolean; issues?: string[] }> {
        const issues: string[] = [];

        try {
            // 检查目录是否存在
            if (!fs.existsSync(this.dbDir)) {
                issues.push('数据目录不存在');
                return { healthy: false, issues };
            }

            // 检查索引文件
            if (!fs.existsSync(this.indexPath)) {
                issues.push('索引文件不存在');
            }

            // 抽样检查分片文件
            let checkedCount = 0;
            for (const uuid of this.pathToUuid.values()) {
                if (checkedCount >= 10) break;

                const shardPath = this.shardFilePath(uuid);
                if (!fs.existsSync(shardPath)) {
                    issues.push(`分片文件缺失: ${uuid}`);
                }

                checkedCount++;
            }

            return {
                healthy: issues.length === 0,
                issues: issues.length > 0 ? issues : undefined
            };
        } catch (err) {
            issues.push(`健康检查失败: ${err instanceof Error ? err.message : String(err)}`);
            return { healthy: false, issues };
        }
    }

    getBackendType(): string {
        return 'json-sharded';
    }
}
