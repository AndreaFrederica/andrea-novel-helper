/**
 * JSON分片存储后端
 * 包装现有的JSON分片文件系统实现
 */

import * as fs from 'fs';
import * as path from 'path';
import { IDatabaseBackend, DatabaseConfig } from './IDatabaseBackend';

export class JSONShardedBackend implements IDatabaseBackend {
    private config: DatabaseConfig;
    private dbDir: string;
    private indexPath: string;
    private initialized = false;

    // 内存缓存（用于加速重复查询）
    private memoryCache: Map<string, any> = new Map();
    private pathToUuid: Map<string, string> = new Map();

    constructor(config: DatabaseConfig) {
        this.config = config;
        const dataPath = config.json?.dataPath || 'novel-helper/.anh-fsdb';
        this.dbDir = path.join(config.workspaceRoot, dataPath);
        this.indexPath = path.join(this.dbDir, 'index.json');
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

            this.pathToUuid.clear();
            for (const ent of entries) {
                if (typeof ent === 'string') continue;
                const u = ent.u;
                const p = ent.p;
                if (u && p) {
                    this.pathToUuid.set(p, u);
                }
            }

            if (this.config.debug) {
                console.log(`[JSONSharded] 加载索引: ${this.pathToUuid.size} 个路径映射`);
            }
        } catch (err) {
            console.warn('[JSONSharded] 加载索引失败:', err);
        }
    }

    async close(): Promise<void> {
        // JSON后端不需要特殊关闭操作
        this.memoryCache.clear();
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

        fs.writeFileSync(shardPath, JSON.stringify(metadata));
        
        // 更新内存缓存
        this.memoryCache.set(uuid, metadata);
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
                fs.writeFileSync(shardPath, JSON.stringify(metadata));
                this.memoryCache.set(uuid, metadata);
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
            
            // 更新缓存
            this.memoryCache.set(uuid, data);
            
            return data;
        } catch {
            return null;
        }
    }

    async loadFileMetadataBatch(uuids: string[]): Promise<Map<string, any>> {
        const result = new Map<string, any>();
        const toLoad: string[] = [];

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
                            result.set(uuid, data);
                            this.memoryCache.set(uuid, data);
                        } catch {
                            // 忽略读取失败
                        }
                    }
                }
            })
        );

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
        this.pathToUuid.set(path, uuid);
        // 路径映射通过index.json持久化
    }

    async savePathMappingBatch(mappings: Array<{ path: string; uuid: string }>): Promise<void> {
        for (const { path, uuid } of mappings) {
            this.pathToUuid.set(path, uuid);
        }
    }

    async getUuidByPath(path: string): Promise<string | null> {
        return this.pathToUuid.get(path) || null;
    }

    async deletePathMapping(path: string): Promise<void> {
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
            p,
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
            return JSON.parse(raw);
        } catch {
            return null;
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
                if (fs.statSync(subPath).isDirectory()) {
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
