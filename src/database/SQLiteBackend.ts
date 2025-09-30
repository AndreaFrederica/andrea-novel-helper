/**
 * SQLite数据库后端实现
 * 使用 @vscode/sqlite3 提供高性能的本地存储
 */

import * as fs from 'fs';
import * as path from 'path';
import { Database } from '@vscode/sqlite3';
import { IDatabaseBackend, DatabaseConfig } from './IDatabaseBackend';

export class SQLiteBackend implements IDatabaseBackend {
    private db: Database | null = null;
    private config: DatabaseConfig;
    private dbPath: string;
    private initialized = false;

    constructor(config: DatabaseConfig) {
        this.config = config;
        const dbFileName = config.sqlite?.dbPath || 'novel-helper/.anh-fsdb/tracking.db';
        this.dbPath = path.join(config.workspaceRoot, dbFileName);
    }

    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        // 确保目录存在
        const dbDir = path.dirname(this.dbPath);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }

        // 打开数据库
        this.db = await this.openDatabase();

        // 创建表结构
        await this.createTables();

        // 配置性能优化
        await this.optimizeDatabase();

        this.initialized = true;

        if (this.config.debug) {
            console.log(`[SQLite] 数据库已初始化: ${this.dbPath}`);
        }
    }

    private openDatabase(): Promise<Database> {
        return new Promise((resolve, reject) => {
            const db = new Database(this.dbPath, (err) => {
                if (err) {
                    reject(new Error(`打开SQLite数据库失败: ${err.message}`));
                } else {
                    resolve(db);
                }
            });
        });
    }

    private async createTables(): Promise<void> {
        const sql = `
            -- 文件元数据表
            CREATE TABLE IF NOT EXISTS file_metadata (
                uuid TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                updated_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            );

            -- 路径映射表
            CREATE TABLE IF NOT EXISTS path_mappings (
                path TEXT PRIMARY KEY,
                uuid TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );

            -- 索引数据表
            CREATE TABLE IF NOT EXISTS index_data (
                key TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );

            -- 创建索引
            CREATE INDEX IF NOT EXISTS idx_path_mappings_uuid ON path_mappings(uuid);
            CREATE INDEX IF NOT EXISTS idx_file_metadata_updated ON file_metadata(updated_at);
        `;

        await this.exec(sql);
    }

    private async optimizeDatabase(): Promise<void> {
        const config = this.config.sqlite || {};

        // 启用WAL模式（Write-Ahead Logging）提升并发性能
        if (config.enableWAL !== false) {
            await this.exec('PRAGMA journal_mode = WAL;');
        }

        // 设置缓存大小（默认10MB，约2560页）
        const cacheSize = config.cacheSize || 2560;
        await this.exec(`PRAGMA cache_size = -${cacheSize};`);

        // 启用内存映射IO（默认64MB）
        if (config.enableMmap !== false) {
            await this.exec('PRAGMA mmap_size = 67108864;');
        }

        // 其他性能优化
        await this.exec('PRAGMA synchronous = NORMAL;');
        await this.exec('PRAGMA temp_store = MEMORY;');
        await this.exec('PRAGMA page_size = 4096;');
    }

    private exec(sql: string): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('数据库未初始化'));
                return;
            }
            this.db.exec(sql, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    private run(sql: string, params: any[]): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('数据库未初始化'));
                return;
            }
            this.db.run(sql, params, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    private get<T = any>(sql: string, params: any[]): Promise<T | null> {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('数据库未初始化'));
                return;
            }
            this.db.get(sql, params, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row as T | null);
                }
            });
        });
    }

    private all<T = any>(sql: string, params: any[]): Promise<T[]> {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('数据库未初始化'));
                return;
            }
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows as T[]);
                }
            });
        });
    }

    async close(): Promise<void> {
        if (this.db) {
            await new Promise<void>((resolve, reject) => {
                this.db!.close((err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            });
            this.db = null;
            this.initialized = false;

            if (this.config.debug) {
                console.log('[SQLite] 数据库已关闭');
            }
        }
    }

    async saveFileMetadata(uuid: string, metadata: any): Promise<void> {
        const now = Date.now();
        const data = JSON.stringify(metadata);
        const sql = `
            INSERT INTO file_metadata (uuid, data, updated_at, created_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(uuid) DO UPDATE SET
                data = excluded.data,
                updated_at = excluded.updated_at
        `;
        await this.run(sql, [uuid, data, now, metadata.createdAt || now]);
    }

    async saveFileMetadataBatch(entries: Array<{ uuid: string; metadata: any }>): Promise<void> {
        if (entries.length === 0) return;

        await this.exec('BEGIN TRANSACTION');
        try {
            for (const { uuid, metadata } of entries) {
                await this.saveFileMetadata(uuid, metadata);
            }
            await this.exec('COMMIT');
        } catch (err) {
            await this.exec('ROLLBACK');
            throw err;
        }
    }

    async loadFileMetadata(uuid: string): Promise<any | null> {
        const row = await this.get<{ data: string }>(
            'SELECT data FROM file_metadata WHERE uuid = ?',
            [uuid]
        );
        return row ? JSON.parse(row.data) : null;
    }

    async loadFileMetadataBatch(uuids: string[]): Promise<Map<string, any>> {
        if (uuids.length === 0) return new Map();

        // 查询合并优化：对于大量UUID，分批查询以避免SQL语句过长
        const BATCH_SIZE = 500; // SQLite 的 SQLITE_MAX_VARIABLE_NUMBER 默认是 999
        const result = new Map<string, any>();

        for (let i = 0; i < uuids.length; i += BATCH_SIZE) {
            const batch = uuids.slice(i, i + BATCH_SIZE);
            const placeholders = batch.map(() => '?').join(',');
            const rows = await this.all<{ uuid: string; data: string }>(
                `SELECT uuid, data FROM file_metadata WHERE uuid IN (${placeholders})`,
                batch
            );

            for (const row of rows) {
                result.set(row.uuid, JSON.parse(row.data));
            }
        }

        return result;
    }

    async deleteFileMetadata(uuid: string): Promise<void> {
        await this.run('DELETE FROM file_metadata WHERE uuid = ?', [uuid]);
    }

    async deleteFileMetadataBatch(uuids: string[]): Promise<void> {
        if (uuids.length === 0) return;

        await this.exec('BEGIN TRANSACTION');
        try {
            for (const uuid of uuids) {
                await this.deleteFileMetadata(uuid);
            }
            await this.exec('COMMIT');
        } catch (err) {
            await this.exec('ROLLBACK');
            throw err;
        }
    }

    async savePathMapping(path: string, uuid: string): Promise<void> {
        const now = Date.now();
        const sql = `
            INSERT INTO path_mappings (path, uuid, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(path) DO UPDATE SET
                uuid = excluded.uuid,
                updated_at = excluded.updated_at
        `;
        await this.run(sql, [path, uuid, now]);
    }

    async savePathMappingBatch(mappings: Array<{ path: string; uuid: string }>): Promise<void> {
        if (mappings.length === 0) return;

        await this.exec('BEGIN TRANSACTION');
        try {
            for (const { path, uuid } of mappings) {
                await this.savePathMapping(path, uuid);
            }
            await this.exec('COMMIT');
        } catch (err) {
            await this.exec('ROLLBACK');
            throw err;
        }
    }

    async getUuidByPath(path: string): Promise<string | null> {
        const row = await this.get<{ uuid: string }>(
            'SELECT uuid FROM path_mappings WHERE path = ?',
            [path]
        );
        return row ? row.uuid : null;
    }

    async deletePathMapping(path: string): Promise<void> {
        await this.run('DELETE FROM path_mappings WHERE path = ?', [path]);
    }

    async getAllPathMappings(): Promise<Map<string, string>> {
        const rows = await this.all<{ path: string; uuid: string }>(
            'SELECT path, uuid FROM path_mappings',
            []
        );

        const result = new Map<string, string>();
        for (const row of rows) {
            result.set(row.path, row.uuid);
        }
        return result;
    }

    async getAllFileUuids(): Promise<string[]> {
        const rows = await this.all<{ uuid: string }>(
            'SELECT uuid FROM file_metadata',
            []
        );
        return rows.map(r => r.uuid);
    }

    async saveIndex(data: any): Promise<void> {
        const now = Date.now();
        const jsonData = JSON.stringify(data);
        const sql = `
            INSERT INTO index_data (key, data, updated_at)
            VALUES ('main', ?, ?)
            ON CONFLICT(key) DO UPDATE SET
                data = excluded.data,
                updated_at = excluded.updated_at
        `;
        await this.run(sql, [jsonData, now]);
    }

    async loadIndex(): Promise<any | null> {
        const row = await this.get<{ data: string }>(
            'SELECT data FROM index_data WHERE key = ?',
            ['main']
        );
        return row ? JSON.parse(row.data) : null;
    }

    async getStats(): Promise<{ totalFiles: number; totalMappings: number; dbSize?: number }> {
        const fileCount = await this.get<{ count: number }>(
            'SELECT COUNT(*) as count FROM file_metadata',
            []
        );
        const mappingCount = await this.get<{ count: number }>(
            'SELECT COUNT(*) as count FROM path_mappings',
            []
        );

        let dbSize: number | undefined;
        try {
            const stats = fs.statSync(this.dbPath);
            dbSize = stats.size;
        } catch {
            // 忽略错误
        }

        return {
            totalFiles: fileCount?.count || 0,
            totalMappings: mappingCount?.count || 0,
            dbSize
        };
    }

    async optimize(): Promise<void> {
        // 执行VACUUM清理和优化数据库
        await this.exec('VACUUM;');
        await this.exec('ANALYZE;');

        if (this.config.debug) {
            console.log('[SQLite] 数据库已优化');
        }
    }

    async exportAll(): Promise<{
        files: Map<string, any>;
        pathMappings: Map<string, string>;
        index: any;
    }> {
        const files = new Map<string, any>();
        const fileRows = await this.all<{ uuid: string; data: string }>(
            'SELECT uuid, data FROM file_metadata',
            []
        );
        for (const row of fileRows) {
            files.set(row.uuid, JSON.parse(row.data));
        }

        const pathMappings = await this.getAllPathMappings();
        const index = await this.loadIndex();

        return { files, pathMappings, index };
    }

    async importAll(data: {
        files: Map<string, any>;
        pathMappings: Map<string, string>;
        index: any;
    }): Promise<void> {
        await this.exec('BEGIN TRANSACTION');
        try {
            // 清空现有数据
            await this.exec('DELETE FROM file_metadata');
            await this.exec('DELETE FROM path_mappings');
            await this.exec('DELETE FROM index_data');

            // 导入文件元数据
            for (const [uuid, metadata] of data.files) {
                await this.saveFileMetadata(uuid, metadata);
            }

            // 导入路径映射
            for (const [path, uuid] of data.pathMappings) {
                await this.savePathMapping(path, uuid);
            }

            // 导入索引
            if (data.index) {
                await this.saveIndex(data.index);
            }

            await this.exec('COMMIT');

            if (this.config.debug) {
                console.log(`[SQLite] 数据导入完成: ${data.files.size} 个文件, ${data.pathMappings.size} 个路径映射`);
            }
        } catch (err) {
            await this.exec('ROLLBACK');
            throw err;
        }
    }

    async checkHealth(): Promise<{ healthy: boolean; issues?: string[] }> {
        const issues: string[] = [];

        try {
            // 检查数据库文件是否存在
            if (!fs.existsSync(this.dbPath)) {
                issues.push('数据库文件不存在');
                return { healthy: false, issues };
            }

            // 检查数据库是否可访问
            if (!this.db) {
                issues.push('数据库未初始化');
                return { healthy: false, issues };
            }

            // 运行完整性检查
            const result = await this.get<{ integrity_check: string }>(
                'PRAGMA integrity_check',
                []
            );

            if (result?.integrity_check !== 'ok') {
                issues.push(`数据库完整性检查失败: ${result?.integrity_check}`);
            }

            // 检查表是否存在
            const tables = await this.all<{ name: string }>(
                "SELECT name FROM sqlite_master WHERE type='table'",
                []
            );
            const tableNames = tables.map(t => t.name);

            if (!tableNames.includes('file_metadata')) {
                issues.push('缺少 file_metadata 表');
            }
            if (!tableNames.includes('path_mappings')) {
                issues.push('缺少 path_mappings 表');
            }
            if (!tableNames.includes('index_data')) {
                issues.push('缺少 index_data 表');
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
        return 'sqlite';
    }
}
