/**
 * 数据库工厂
 * 根据配置创建合适的数据库后端
 */

import * as vscode from 'vscode';
import { IDatabaseBackend, DatabaseConfig } from './IDatabaseBackend';
import { SQLiteBackend } from './SQLiteBackend';
import { JSONShardedBackend } from './JSONShardedBackend';

export class DatabaseFactory {
    /**
     * 创建数据库后端实例
     */
    static async createBackend(workspaceRoot: string): Promise<IDatabaseBackend> {
        const config = vscode.workspace.getConfiguration('AndreaNovelHelper.database');
        const backendType = config.get<string>('backend', 'json');

        const dbConfig: DatabaseConfig = {
            backend: backendType as 'json' | 'sqlite',
            workspaceRoot,
            debug: config.get('debug', false),
            sqlite: {
                dbPath: 'novel-helper/.anh-fsdb/tracking.db',
                enableWAL: config.get('sqlite.enableWAL', true),
                cacheSize: config.get('sqlite.cacheSize', 2560),
                enableMmap: config.get('sqlite.enableMmap', true)
            },
            json: {
                dataPath: 'novel-helper/.anh-fsdb',
                lazyLoad: true
            }
        };

        let backend: IDatabaseBackend;

        if (backendType === 'sqlite') {
            backend = new SQLiteBackend(dbConfig);
        } else {
            backend = new JSONShardedBackend(dbConfig);
        }

        await backend.initialize();

        return backend;
    }

    /**
     * 获取当前配置的后端类型
     */
    static getCurrentBackendType(): 'json' | 'sqlite' {
        const config = vscode.workspace.getConfiguration('AndreaNovelHelper.database');
        return config.get<string>('backend', 'json') as 'json' | 'sqlite';
    }
}
