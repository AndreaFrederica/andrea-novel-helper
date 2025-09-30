/**
 * JSON文件后端实现
 * 包装现有的 FileTrackingDataManager 以实现统一接口
 */

import * as path from 'path';
import { IDatabaseBackend, DatabaseConfig } from './IDatabaseBackend';
import { FileTrackingDataManager } from '../utils/tracker/fileTrackingData';

export class JSONBackend implements IDatabaseBackend {
    private manager: FileTrackingDataManager | null = null;
    private config: DatabaseConfig;
    private initialized = false;

    constructor(config: DatabaseConfig) {
        this.config = config;
    }

    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        // 使用现有的 FileTrackingDataManager
        this.manager = new FileTrackingDataManager(this.config.workspaceRoot);
        this.initialized = true;

        if (this.config.debug) {
            console.log(`[JSON] 数据库已初始化: ${this.config.workspaceRoot}`);
        }
    }

    async close(): Promise<void> {
        if (this.manager) {
            await this.manager.forceSave();
            this.manager = null;
            this.initialized = false;

            if (this.config.debug) {
                console.log('[JSON] 数据库已关闭');
            }
        }
    }

    async saveFileMetadata(uuid: string, metadata: any): Promise<void> {
        if (!this.manager) {
            throw new Error('数据库未初始化');
        }

        this.manager.setFileMetadata(metadata.filePath, metadata);
    }

    async saveFileMetadataBatch(entries: Array<{ uuid: string; metadata: any }>): Promise<void> {
        if (!this.manager) {
            throw new Error('数据库未初始化');
        }

        // JSON后端的批量操作实际上是逐个写入
        for (const { metadata } of entries) {
            this.manager.setFileMetadata(metadata.filePath, metadata);
        }
    }

    async loadFileMetadata(uuid: string): Promise<any | null> {
        if (!this.manager) {
            throw new Error('数据库未初始化');
        }

        return this.manager.getFileByUuid(uuid) || null;
    }

    async loadFileMetadataBatch(uuids: string[]): Promise<Map<string, any>> {
        if (!this.manager) {
            throw new Error('数据库未初始化');
        }

        const result = new Map<string, any>();
        for (const uuid of uuids) {
            const meta = this.manager.getFileByUuid(uuid);
            if (meta) {
                result.set(uuid, meta);
            }
        }
        return result;
    }

    async deleteFileMetadata(uuid: string): Promise<void> {
        if (!this.manager) {
            throw new Error('数据库未初始化');
        }

        const meta = this.manager.getFileByUuid(uuid);
        if (meta) {
            this.manager.removeFile(meta.filePath);
        }
    }

    async deleteFileMetadataBatch(uuids: string[]): Promise<void> {
        if (!this.manager) {
            throw new Error('数据库未初始化');
        }

        for (const uuid of uuids) {
            const meta = this.manager.getFileByUuid(uuid);
            if (meta) {
                this.manager.removeFile(meta.filePath);
            }
        }
    }

    async savePathMapping(path: string, uuid: string): Promise<void> {
        // JSON后端的路径映射是通过文件元数据自动维护的
        // 这里不需要额外操作
    }

    async savePathMappingBatch(mappings: Array<{ path: string; uuid: string }>): Promise<void> {
        // JSON后端的路径映射是通过文件元数据自动维护的
        // 这里不需要额外操作
    }

    async getUuidByPath(path: string): Promise<string | null> {
        if (!this.manager) {
            throw new Error('数据库未初始化');
        }

        return await this.manager.getFileUuid(path) || null;
    }

    async deletePathMapping(path: string): Promise<void> {
        // JSON后端的路径映射是通过文件元数据自动维护的
        // 删除文件时会自动删除映射
    }

    async getAllPathMappings(): Promise<Map<string, string>> {
        if (!this.manager) {
            throw new Error('数据库未初始化');
        }

        const result = new Map<string, string>();
        const db = (this.manager as any).database;
        
        if (db && db.pathToUuid) {
            for (const [path, uuid] of Object.entries(db.pathToUuid)) {
                result.set(path as string, uuid as string);
            }
        }

        return result;
    }

    async getAllFileUuids(): Promise<string[]> {
        if (!this.manager) {
            throw new Error('数据库未初始化');
        }

        const db = (this.manager as any).database;
        if (db && db.files) {
            return Object.keys(db.files);
        }

        return [];
    }

    async saveIndex(data: any): Promise<void> {
        // JSON后端的索引是通过 pathToUuid 维护的
        // 这里不需要额外操作
    }

    async loadIndex(): Promise<any | null> {
        if (!this.manager) {
            throw new Error('数据库未初始化');
        }

        const db = (this.manager as any).database;
        return db || null;
    }

    async getStats(): Promise<{ totalFiles: number; totalMappings: number; dbSize?: number }> {
        if (!this.manager) {
            throw new Error('数据库未初始化');
        }

        const stats = this.manager.getStats();
        return {
            totalFiles: stats.totalFiles,
            totalMappings: Object.keys((this.manager as any).database?.pathToUuid || {}).length
        };
    }

    async optimize(): Promise<void> {
        if (!this.manager) {
            throw new Error('数据库未初始化');
        }

        // JSON后端的优化：强制保存并清理无效条目
        await this.manager.forceSave();

        if (this.config.debug) {
            console.log('[JSON] 数据库已优化');
        }
    }

    async exportAll(): Promise<{
        files: Map<string, any>;
        pathMappings: Map<string, string>;
        index: any;
    }> {
        if (!this.manager) {
            throw new Error('数据库未初始化');
        }

        const db = (this.manager as any).database;
        
        const files = new Map<string, any>();
        if (db.files) {
            for (const [uuid, meta] of Object.entries(db.files)) {
                files.set(uuid, meta);
            }
        }

        const pathMappings = await this.getAllPathMappings();
        
        return {
            files,
            pathMappings,
            index: db
        };
    }

    async importAll(data: {
        files: Map<string, any>;
        pathMappings: Map<string, string>;
        index: any;
    }): Promise<void> {
        if (!this.manager) {
            throw new Error('数据库未初始化');
        }

        // 导入所有文件元数据
        for (const [uuid, metadata] of data.files) {
            this.manager.setFileMetadata(metadata.filePath, metadata);
        }

        // 强制保存
        await this.manager.forceSave();

        if (this.config.debug) {
            console.log(`[JSON] 数据导入完成: ${data.files.size} 个文件`);
        }
    }

    async checkHealth(): Promise<{ healthy: boolean; issues?: string[] }> {
        if (!this.manager) {
            return {
                healthy: false,
                issues: ['数据库未初始化']
            };
        }

        const issues: string[] = [];

        try {
            const db = (this.manager as any).database;

            if (!db) {
                issues.push('数据库对象不存在');
            } else {
                // 检查必要字段
                if (!db.files || typeof db.files !== 'object') {
                    issues.push('files 字段缺失或格式错误');
                }
                if (!db.pathToUuid || typeof db.pathToUuid !== 'object') {
                    issues.push('pathToUuid 字段缺失或格式错误');
                }

                // 检查数据一致性
                const fileUuids = new Set(Object.keys(db.files || {}));
                const mappingUuids = new Set(Object.values(db.pathToUuid || {}));
                
                for (const uuid of mappingUuids) {
                    if (!fileUuids.has(uuid as string)) {
                        issues.push(`路径映射引用了不存在的文件: ${uuid}`);
                        break;
                    }
                }
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
        return 'json';
    }
}
