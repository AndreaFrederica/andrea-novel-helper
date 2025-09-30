/**
 * 数据库管理命令
 * 提供数据库后端切换、迁移、健康检查等功能
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { DatabaseMigration } from '../database/DatabaseMigration';
import { SQLiteBackend } from '../database/SQLiteBackend';
import { JSONBackend } from '../database/JSONBackend';
import { IDatabaseBackend, DatabaseConfig } from '../database/IDatabaseBackend';

/**
 * 注册所有数据库相关命令
 */
export function registerDatabaseCommands(context: vscode.ExtensionContext) {
    // 切换数据库后端
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.database.switchBackend', async () => {
            await switchDatabaseBackend();
        })
    );

    // 运行数据库迁移
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.database.migrate', async () => {
            await runDatabaseMigration();
        })
    );

    // 查看数据库状态
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.database.showStatus', async () => {
            await showDatabaseStatus();
        })
    );

    // 数据库健康检查
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.database.healthCheck', async () => {
            await runHealthCheck();
        })
    );

    // 优化数据库
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.database.optimize', async () => {
            await optimizeDatabase();
        })
    );

    // 比较后端数据
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.database.compare', async () => {
            await compareBackends();
        })
    );

    // 监听配置变化，提示迁移
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (e.affectsConfiguration('AndreaNovelHelper.database.backend')) {
                await onBackendConfigChanged();
            }
        })
    );
}

/**
 * 切换数据库后端
 */
async function switchDatabaseBackend() {
    const config = vscode.workspace.getConfiguration('AndreaNovelHelper.database');
    const currentBackend = config.get<string>('backend', 'json');

    const items = [
        {
            label: 'JSON',
            description: 'JSON文件存储（默认，兼容旧版本）',
            value: 'json',
            picked: currentBackend === 'json'
        },
        {
            label: 'SQLite',
            description: 'SQLite数据库（推荐，性能更好）',
            value: 'sqlite',
            picked: currentBackend === 'sqlite'
        }
    ];

    const selected = await vscode.window.showQuickPick(items, {
        title: '选择数据库后端',
        placeHolder: `当前使用: ${currentBackend.toUpperCase()}`
    });

    if (!selected || selected.value === currentBackend) {
        return;
    }

    // 更新配置
    await config.update('backend', selected.value, vscode.ConfigurationTarget.Workspace);

    vscode.window.showInformationMessage(
        `数据库后端已切换至 ${selected.label}。建议运行数据迁移以同步数据。`,
        '立即迁移',
        '稍后'
    ).then(choice => {
        if (choice === '立即迁移') {
            void runDatabaseMigration();
        }
    });
}

/**
 * 配置变化时的处理
 */
async function onBackendConfigChanged() {
    const config = vscode.workspace.getConfiguration('AndreaNovelHelper.database');
    const autoMigrate = config.get<boolean>('autoMigrate', false);

    if (autoMigrate) {
        await runDatabaseMigration();
    } else {
        const choice = await vscode.window.showInformationMessage(
            '数据库后端已更改，是否现在运行数据迁移？',
            '立即迁移',
            '稍后',
            '不再提示'
        );

        if (choice === '立即迁移') {
            await runDatabaseMigration();
        } else if (choice === '不再提示') {
            await config.update('autoMigrate', true, vscode.ConfigurationTarget.Workspace);
        }
    }
}

/**
 * 运行数据库迁移
 */
async function runDatabaseMigration() {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        vscode.window.showErrorMessage('未找到工作区');
        return;
    }

    const config = vscode.workspace.getConfiguration('AndreaNovelHelper.database');
    const targetBackend = config.get<string>('backend', 'json');

    // 确定源后端（与当前配置相反的）
    const sourceBackend = targetBackend === 'json' ? 'sqlite' : 'json';

    // 创建后端实例
    const source = await createBackend(sourceBackend, workspaceRoot);
    const target = await createBackend(targetBackend, workspaceRoot);

    if (!source || !target) {
        vscode.window.showErrorMessage('无法创建数据库后端实例');
        return;
    }

    try {
        // 初始化两个后端
        await source.initialize();
        await target.initialize();

        // 显示迁移向导
        const result = await DatabaseMigration.showMigrationWizard(source, target);

        if (result && result.success) {
            vscode.window.showInformationMessage(
                `数据迁移成功！迁移了 ${result.filesCount} 个文件。`
            );
        }
    } catch (err) {
        vscode.window.showErrorMessage(
            `数据迁移失败: ${err instanceof Error ? err.message : String(err)}`
        );
    } finally {
        // 关闭连接
        await source.close();
        await target.close();
    }
}

/**
 * 显示数据库状态
 */
async function showDatabaseStatus() {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        vscode.window.showErrorMessage('未找到工作区');
        return;
    }

    const config = vscode.workspace.getConfiguration('AndreaNovelHelper.database');
    const backendType = config.get<string>('backend', 'json');

    const backend = await createBackend(backendType, workspaceRoot);
    if (!backend) {
        vscode.window.showErrorMessage('无法创建数据库后端实例');
        return;
    }

    try {
        await backend.initialize();
        const stats = await backend.getStats();

        const sizeStr = stats.dbSize
            ? ` (${(stats.dbSize / 1024 / 1024).toFixed(2)} MB)`
            : '';

        const message = `
数据库状态
━━━━━━━━━━━━━━━━━━
后端类型: ${backendType.toUpperCase()}
文件数量: ${stats.totalFiles}
路径映射: ${stats.totalMappings}
数据库大小: ${sizeStr}
        `.trim();

        vscode.window.showInformationMessage(message, { modal: true });
    } catch (err) {
        vscode.window.showErrorMessage(
            `获取数据库状态失败: ${err instanceof Error ? err.message : String(err)}`
        );
    } finally {
        await backend.close();
    }
}

/**
 * 运行健康检查
 */
async function runHealthCheck() {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        vscode.window.showErrorMessage('未找到工作区');
        return;
    }

    const config = vscode.workspace.getConfiguration('AndreaNovelHelper.database');
    const backendType = config.get<string>('backend', 'json');

    const backend = await createBackend(backendType, workspaceRoot);
    if (!backend) {
        vscode.window.showErrorMessage('无法创建数据库后端实例');
        return;
    }

    try {
        await backend.initialize();
        const health = await backend.checkHealth();

        if (health.healthy) {
            vscode.window.showInformationMessage('数据库健康检查通过 ✓');
        } else {
            const issues = health.issues?.join('\n') || '未知问题';
            vscode.window.showWarningMessage(
                `数据库健康检查发现问题:\n\n${issues}`,
                { modal: true }
            );
        }
    } catch (err) {
        vscode.window.showErrorMessage(
            `健康检查失败: ${err instanceof Error ? err.message : String(err)}`
        );
    } finally {
        await backend.close();
    }
}

/**
 * 优化数据库
 */
async function optimizeDatabase() {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        vscode.window.showErrorMessage('未找到工作区');
        return;
    }

    const config = vscode.workspace.getConfiguration('AndreaNovelHelper.database');
    const backendType = config.get<string>('backend', 'json');

    if (backendType !== 'sqlite') {
        vscode.window.showInformationMessage('仅SQLite后端支持优化操作');
        return;
    }

    const backend = await createBackend(backendType, workspaceRoot);
    if (!backend) {
        vscode.window.showErrorMessage('无法创建数据库后端实例');
        return;
    }

    try {
        await backend.initialize();

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: '正在优化数据库...',
                cancellable: false
            },
            async () => {
                await backend.optimize();
            }
        );

        vscode.window.showInformationMessage('数据库优化完成');
    } catch (err) {
        vscode.window.showErrorMessage(
            `数据库优化失败: ${err instanceof Error ? err.message : String(err)}`
        );
    } finally {
        await backend.close();
    }
}

/**
 * 比较两个后端的数据
 */
async function compareBackends() {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        vscode.window.showErrorMessage('未找到工作区');
        return;
    }

    const json = await createBackend('json', workspaceRoot);
    const sqlite = await createBackend('sqlite', workspaceRoot);

    if (!json || !sqlite) {
        vscode.window.showErrorMessage('无法创建数据库后端实例');
        return;
    }

    try {
        await json.initialize();
        await sqlite.initialize();

        const diff = await DatabaseMigration.compareBackends(json, sqlite);

        const message = `
数据库差异分析
━━━━━━━━━━━━━━━━━━
仅在JSON中的文件: ${diff.filesOnlyIn1.length}
仅在SQLite中的文件: ${diff.filesOnlyIn2.length}
内容不同的文件: ${diff.differentFiles.length}
仅在JSON中的路径: ${diff.pathsOnlyIn1.length}
仅在SQLite中的路径: ${diff.pathsOnlyIn2.length}
        `.trim();

        const hasIssues = diff.filesOnlyIn1.length > 0 ||
            diff.filesOnlyIn2.length > 0 ||
            diff.differentFiles.length > 0 ||
            diff.pathsOnlyIn1.length > 0 ||
            diff.pathsOnlyIn2.length > 0;

        if (hasIssues) {
            vscode.window.showWarningMessage(message, { modal: true });
        } else {
            vscode.window.showInformationMessage('两个后端的数据完全一致 ✓');
        }
    } catch (err) {
        vscode.window.showErrorMessage(
            `比较失败: ${err instanceof Error ? err.message : String(err)}`
        );
    } finally {
        await json.close();
        await sqlite.close();
    }
}

/**
 * 创建数据库后端实例
 */
async function createBackend(
    type: string,
    workspaceRoot: string
): Promise<IDatabaseBackend | null> {
    const config = vscode.workspace.getConfiguration('AndreaNovelHelper.database');

    const dbConfig: DatabaseConfig = {
        backend: type as 'json' | 'sqlite',
        workspaceRoot,
        debug: false,
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

    if (type === 'sqlite') {
        return new SQLiteBackend(dbConfig);
    } else if (type === 'json') {
        return new JSONBackend(dbConfig);
    }

    return null;
}
