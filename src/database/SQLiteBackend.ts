/**
 * SQLite数据库后端实现
 * 使用 Node.js 内置的 node:sqlite (Node >= 22.5) 提供本地存储，
 * 无需独立编译任何原生模块。
 */

import * as fs from 'fs';
import * as path from 'path';
import { DatabaseSync } from 'node:sqlite';
import {
    IDatabaseBackend,
    DatabaseConfig,
    WritingFileSummary,
    WritingProjectSummary,
} from './IDatabaseBackend';

export class SQLiteBackend implements IDatabaseBackend {
    private db: DatabaseSync | null = null;
    private config: DatabaseConfig;
    private dbPath: string;
    private initialized = false;

    constructor(config: DatabaseConfig) {
        this.config = config;
        const dbFileName = config.sqlite?.dbPath || 'novel-helper/.anh-fsdb/tracking.db';
        this.dbPath = path.join(config.workspaceRoot, dbFileName);
    }

    private toRelKey(p: string): string {
        const rootAbs = path.resolve(this.config.workspaceRoot).replace(/\\/g, '/');
        const absBase = path.isAbsolute(p) || /^[a-z]:[\\/]/i.test(p) ? p : path.join(this.config.workspaceRoot, p);
        const abs = path.resolve(absBase).replace(/\\/g, '/');
        const lower = process.platform === 'win32';
        const absCmp = lower ? abs.toLowerCase() : abs;
        const rootCmp = lower ? rootAbs.toLowerCase() : rootAbs;
        if (absCmp === rootCmp) {
            return '';
        }
        if (absCmp.startsWith(rootCmp + '/')) {
            return absCmp.slice(rootCmp.length + 1);
        }
        return absCmp;
    }

    private toAbsPath(key: string): string {
        if (path.isAbsolute(key) || /^[a-z]:[\\/]/i.test(key)) {
            return path.resolve(key);
        }
        return path.resolve(path.join(this.config.workspaceRoot, key));
    }

    private async getPathKeyForUuid(uuid: string): Promise<string | null> {
        const row = this.get<{ path: string }>(
            'SELECT path FROM path_mappings WHERE uuid = ? LIMIT 1',
            [uuid]
        );
        return row?.path || null;
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
        this.db = this.openDatabase();

        // 创建表结构
        this.createTables();

        // 配置性能优化
        this.optimizeDatabase();

        this.initialized = true;

        if (this.config.debug) {
            console.log(`[SQLite] 数据库已初始化: ${this.dbPath}`);
        }
    }

    private openDatabase(): DatabaseSync {
        try {
            return new DatabaseSync(this.dbPath);
        } catch (err) {
            throw new Error(`打开SQLite数据库失败: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    private createTables(): void {
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

            -- 项目级写作总表
            CREATE TABLE IF NOT EXISTS writing_project_summary (
                key TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );

            -- 文件级轻量写作索引
            CREATE TABLE IF NOT EXISTS writing_file_summary (
                uuid TEXT PRIMARY KEY,
                path TEXT NOT NULL,
                total_millis INTEGER,
                chars_added INTEGER,
                chars_deleted INTEGER,
                sessions_count INTEGER,
                average_cpm INTEGER,
                last_active_time INTEGER,
                today_key INTEGER NOT NULL DEFAULT 0,
                today_peak_cpm INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL
            );

            -- 创建索引
            CREATE INDEX IF NOT EXISTS idx_path_mappings_uuid ON path_mappings(uuid);
            CREATE INDEX IF NOT EXISTS idx_file_metadata_updated ON file_metadata(updated_at);
            CREATE INDEX IF NOT EXISTS idx_writing_file_summary_path ON writing_file_summary(path);
            CREATE INDEX IF NOT EXISTS idx_writing_file_summary_today ON writing_file_summary(today_key, today_peak_cpm);
        `;

        this.exec(sql);
    }

    private mapWritingFileSummaryRow(row: {
        uuid: string;
        path: string;
        total_millis: number | null;
        chars_added: number | null;
        chars_deleted: number | null;
        sessions_count: number | null;
        average_cpm: number | null;
        last_active_time: number | null;
        today_key: number | null;
        today_peak_cpm: number | null;
        updated_at: number | null;
    }): WritingFileSummary {
        return {
            uuid: row.uuid,
            path: this.toAbsPath(row.path),
            totalMillis: row.total_millis ?? 0,
            charsAdded: row.chars_added ?? 0,
            charsDeleted: row.chars_deleted ?? 0,
            sessionsCount: row.sessions_count ?? 0,
            averageCPM: row.average_cpm ?? 0,
            lastActiveTime: row.last_active_time ?? 0,
            todayKey: row.today_key ?? 0,
            todayPeakCPM: row.today_peak_cpm ?? 0,
            updatedAt: row.updated_at ?? 0,
        };
    }

    private optimizeDatabase(): void {
        const config = this.config.sqlite || {};

        // 启用WAL模式（Write-Ahead Logging）提升并发性能
        if (config.enableWAL !== false) {
            this.exec('PRAGMA journal_mode = WAL;');
        }

        // 设置缓存大小（默认10MB，约2560页）
        const cacheSize = config.cacheSize || 2560;
        this.exec(`PRAGMA cache_size = -${cacheSize};`);

        // 启用内存映射IO（默认64MB）
        if (config.enableMmap !== false) {
            this.exec('PRAGMA mmap_size = 67108864;');
        }

        // 其他性能优化
        this.exec('PRAGMA synchronous = NORMAL;');
        this.exec('PRAGMA temp_store = MEMORY;');
        this.exec('PRAGMA page_size = 4096;');
    }

    private exec(sql: string): void {
        if (!this.db) {
            throw new Error('数据库未初始化');
        }
        this.db.exec(sql);
    }

    private run(sql: string, params: any[]): void {
        if (!this.db) {
            throw new Error('数据库未初始化');
        }
        this.db.prepare(sql).run(...params);
    }

    private get<T = any>(sql: string, params: any[]): T | null {
        if (!this.db) {
            throw new Error('数据库未初始化');
        }
        const row = this.db.prepare(sql).get(...params) as T | undefined;
        return row ?? null;
    }

    private all<T = any>(sql: string, params: any[]): T[] {
        if (!this.db) {
            throw new Error('数据库未初始化');
        }
        return this.db.prepare(sql).all(...params) as T[];
    }

    async close(): Promise<void> {
        if (this.db) {
            this.db.close();
            this.db = null;
            this.initialized = false;

            if (this.config.debug) {
                console.log('[SQLite] 数据库已关闭');
            }
        }
    }

    async saveFileMetadata(uuid: string, metadata: any): Promise<void> {
        const now = Date.now();
        const payload = { ...metadata, filePath: this.toRelKey(metadata?.filePath || '') };
        const data = JSON.stringify(payload);
        const sql = `
            INSERT INTO file_metadata (uuid, data, updated_at, created_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(uuid) DO UPDATE SET
                data = excluded.data,
                updated_at = excluded.updated_at
        `;
        this.run(sql, [uuid, data, now, metadata.createdAt || now]);
    }

    async saveFileMetadataBatch(entries: Array<{ uuid: string; metadata: any }>): Promise<void> {
        if (entries.length === 0) return;

        this.exec('BEGIN TRANSACTION');
        try {
            for (const { uuid, metadata } of entries) {
                await this.saveFileMetadata(uuid, metadata);
            }
            this.exec('COMMIT');
        } catch (err) {
            this.exec('ROLLBACK');
            throw err;
        }
    }

    async loadFileMetadata(uuid: string): Promise<any | null> {
        const row = this.get<{ data: string }>(
            'SELECT data FROM file_metadata WHERE uuid = ?',
            [uuid]
        );
        if (!row) { return null; }

        const data = JSON.parse(row.data);
        const mappedKey = await this.getPathKeyForUuid(uuid);
        const rel = this.toRelKey(data?.filePath || '');
        const preferredKey = mappedKey || rel;
        const absPath = this.toAbsPath(preferredKey);
        const needsRewrite = data?.filePath !== preferredKey && data?.filePath !== absPath;
        data.filePath = absPath;
        if (needsRewrite) {
            try { await this.saveFileMetadata(uuid, { ...data, filePath: absPath }); } catch { /* ignore */ }
        }
        return data;
    }

    async loadFileMetadataBatch(uuids: string[]): Promise<Map<string, any>> {
        if (uuids.length === 0) return new Map();

        // 查询合并优化：对于大量UUID，分批查询以避免SQL语句过长
        const BATCH_SIZE = 500; // SQLite 的 SQLITE_MAX_VARIABLE_NUMBER 默认是 999
        const result = new Map<string, any>();

        for (let i = 0; i < uuids.length; i += BATCH_SIZE) {
            const batch = uuids.slice(i, i + BATCH_SIZE);
            const placeholders = batch.map(() => '?').join(',');
            const rows = this.all<{ uuid: string; data: string }>(
                `SELECT uuid, data FROM file_metadata WHERE uuid IN (${placeholders})`,
                batch
            );

            for (const row of rows) {
                const data = JSON.parse(row.data);
                const mappedKey = await this.getPathKeyForUuid(row.uuid);
                const rel = this.toRelKey(data?.filePath || '');
                const preferredKey = mappedKey || rel;
                const absPath = this.toAbsPath(preferredKey);
                const needsRewrite = data?.filePath !== preferredKey && data?.filePath !== absPath;
                data.filePath = absPath;
                result.set(row.uuid, data);
                if (needsRewrite) {
                    try { await this.saveFileMetadata(row.uuid, { ...data, filePath: absPath }); } catch { /* ignore */ }
                }
            }
        }

        return result;
    }

    async deleteFileMetadata(uuid: string): Promise<void> {
        this.run('DELETE FROM file_metadata WHERE uuid = ?', [uuid]);
    }

    async deleteFileMetadataBatch(uuids: string[]): Promise<void> {
        if (uuids.length === 0) return;

        this.exec('BEGIN TRANSACTION');
        try {
            for (const uuid of uuids) {
                await this.deleteFileMetadata(uuid);
            }
            this.exec('COMMIT');
        } catch (err) {
            this.exec('ROLLBACK');
            throw err;
        }
    }

    async savePathMapping(path: string, uuid: string): Promise<void> {
        const rel = this.toRelKey(path);
        const now = Date.now();
        const sql = `
            INSERT INTO path_mappings (path, uuid, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(path) DO UPDATE SET
                uuid = excluded.uuid,
                updated_at = excluded.updated_at
        `;
        this.run(sql, [rel, uuid, now]);
    }

    async savePathMappingBatch(mappings: Array<{ path: string; uuid: string }>): Promise<void> {
        if (mappings.length === 0) return;

        this.exec('BEGIN TRANSACTION');
        try {
            for (const { path, uuid } of mappings) {
                await this.savePathMapping(path, uuid);
            }
            this.exec('COMMIT');
        } catch (err) {
            this.exec('ROLLBACK');
            throw err;
        }
    }

    async getUuidByPath(path: string): Promise<string | null> {
        const rel = this.toRelKey(path);
        const row = this.get<{ uuid: string }>(
            'SELECT uuid FROM path_mappings WHERE path = ?',
            [rel]
        );
        return row ? row.uuid : null;
    }

    async deletePathMapping(path: string): Promise<void> {
        const rel = this.toRelKey(path);
        this.run('DELETE FROM path_mappings WHERE path = ?', [rel]);
    }

    async deletePathMappingRaw(path: string): Promise<void> {
        this.run('DELETE FROM path_mappings WHERE path = ?', [path]);
    }

    async getAllPathMappings(): Promise<Map<string, string>> {
        const rows = this.all<{ path: string; uuid: string }>(
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
        const rows = this.all<{ uuid: string }>(
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
        this.run(sql, [jsonData, now]);
    }

    async loadIndex(): Promise<any | null> {
        const row = this.get<{ data: string }>(
            'SELECT data FROM index_data WHERE key = ?',
            ['main']
        );
        return row ? JSON.parse(row.data) : null;
    }

    async saveWritingProjectSummary(summary: WritingProjectSummary): Promise<void> {
        const updatedAt = summary.updatedAt || Date.now();
        const sql = `
            INSERT INTO writing_project_summary (key, data, updated_at)
            VALUES ('main', ?, ?)
            ON CONFLICT(key) DO UPDATE SET
                data = excluded.data,
                updated_at = excluded.updated_at
        `;
        this.run(sql, [JSON.stringify({ ...summary, updatedAt }), updatedAt]);
    }

    async loadWritingProjectSummary(): Promise<WritingProjectSummary | null> {
        const row = this.get<{ data: string }>(
            'SELECT data FROM writing_project_summary WHERE key = ?',
            ['main']
        );
        return row ? JSON.parse(row.data) as WritingProjectSummary : null;
    }

    async saveWritingFileSummary(summary: WritingFileSummary): Promise<void> {
        const updatedAt = summary.updatedAt || Date.now();
        const sql = `
            INSERT INTO writing_file_summary (
                uuid, path, total_millis, chars_added, chars_deleted,
                sessions_count, average_cpm, last_active_time,
                today_key, today_peak_cpm, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(uuid) DO UPDATE SET
                path = excluded.path,
                total_millis = excluded.total_millis,
                chars_added = excluded.chars_added,
                chars_deleted = excluded.chars_deleted,
                sessions_count = excluded.sessions_count,
                average_cpm = excluded.average_cpm,
                last_active_time = excluded.last_active_time,
                today_key = excluded.today_key,
                today_peak_cpm = excluded.today_peak_cpm,
                updated_at = excluded.updated_at
        `;

        this.run(sql, [
            summary.uuid,
            this.toRelKey(summary.path),
            summary.totalMillis,
            summary.charsAdded,
            summary.charsDeleted,
            summary.sessionsCount,
            summary.averageCPM,
            summary.lastActiveTime,
            summary.todayKey,
            summary.todayPeakCPM,
            updatedAt,
        ]);
    }

    async saveWritingFileSummaryBatch(entries: WritingFileSummary[]): Promise<void> {
        if (entries.length === 0) {
            return;
        }

        this.exec('BEGIN TRANSACTION');
        try {
            for (const summary of entries) {
                await this.saveWritingFileSummary(summary);
            }
            this.exec('COMMIT');
        } catch (err) {
            this.exec('ROLLBACK');
            throw err;
        }
    }

    async loadWritingFileSummary(uuid: string): Promise<WritingFileSummary | null> {
        const row = this.get<{
            uuid: string;
            path: string;
            total_millis: number | null;
            chars_added: number | null;
            chars_deleted: number | null;
            sessions_count: number | null;
            average_cpm: number | null;
            last_active_time: number | null;
            today_key: number | null;
            today_peak_cpm: number | null;
            updated_at: number | null;
        }>(
            `SELECT uuid, path, total_millis, chars_added, chars_deleted, sessions_count,
                    average_cpm, last_active_time, today_key, today_peak_cpm, updated_at
             FROM writing_file_summary WHERE uuid = ?`,
            [uuid]
        );
        return row ? this.mapWritingFileSummaryRow(row) : null;
    }

    async loadAllWritingFileSummaries(): Promise<Map<string, WritingFileSummary>> {
        const rows = this.all<{
            uuid: string;
            path: string;
            total_millis: number | null;
            chars_added: number | null;
            chars_deleted: number | null;
            sessions_count: number | null;
            average_cpm: number | null;
            last_active_time: number | null;
            today_key: number | null;
            today_peak_cpm: number | null;
            updated_at: number | null;
        }>(
            `SELECT uuid, path, total_millis, chars_added, chars_deleted, sessions_count,
                    average_cpm, last_active_time, today_key, today_peak_cpm, updated_at
             FROM writing_file_summary`,
            []
        );

        const result = new Map<string, WritingFileSummary>();
        for (const row of rows) {
            result.set(row.uuid, this.mapWritingFileSummaryRow(row));
        }
        return result;
    }

    async deleteWritingFileSummary(uuid: string): Promise<void> {
        this.run('DELETE FROM writing_file_summary WHERE uuid = ?', [uuid]);
    }

    async getStats(): Promise<{ totalFiles: number; totalMappings: number; dbSize?: number }> {
        const fileCount = this.get<{ count: number }>(
            'SELECT COUNT(*) as count FROM file_metadata',
            []
        );
        const mappingCount = this.get<{ count: number }>(
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
        this.exec('VACUUM;');
        this.exec('ANALYZE;');

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
        const fileRows = this.all<{ uuid: string; data: string }>(
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
        this.exec('BEGIN TRANSACTION');
        try {
            // 清空现有数据
            this.exec('DELETE FROM file_metadata');
            this.exec('DELETE FROM path_mappings');
            this.exec('DELETE FROM index_data');

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

            this.exec('COMMIT');

            if (this.config.debug) {
                console.log(`[SQLite] 数据导入完成: ${data.files.size} 个文件, ${data.pathMappings.size} 个路径映射`);
            }
        } catch (err) {
            this.exec('ROLLBACK');
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
            const result = this.get<{ integrity_check: string }>(
                'PRAGMA integrity_check',
                []
            );

            if (result?.integrity_check !== 'ok') {
                issues.push(`数据库完整性检查失败: ${result?.integrity_check}`);
            }

            // 检查表是否存在
            const tables = this.all<{ name: string }>(
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
