/**
 * 数据库迁移工具
 * 支持在JSON和SQLite后端之间双向迁移数据
 */

import * as vscode from 'vscode';
import { IDatabaseBackend } from './IDatabaseBackend';

export interface MigrationProgress {
    phase: 'export' | 'import' | 'validate' | 'cleanup';
    current: number;
    total: number;
    message: string;
}

export interface MigrationResult {
    success: boolean;
    filesCount: number;
    mappingsCount: number;
    duration: number;
    errors?: string[];
}

export class DatabaseMigration {
    constructor(
        private source: IDatabaseBackend,
        private target: IDatabaseBackend
    ) {}

    /**
     * 执行数据迁移
     * @param options 迁移选项
     */
    async migrate(options?: {
        onProgress?: (progress: MigrationProgress) => void;
        validateAfter?: boolean;
        cleanupSource?: boolean;
    }): Promise<MigrationResult> {
        const startTime = Date.now();
        const errors: string[] = [];
        const onProgress = options?.onProgress || (() => {});

        try {
            // 阶段1：从源后端导出数据
            onProgress({
                phase: 'export',
                current: 0,
                total: 1,
                message: `从 ${this.source.getBackendType()} 导出数据...`
            });

            const exportedData = await this.source.exportAll();
            const filesCount = exportedData.files.size;
            const mappingsCount = exportedData.pathMappings.size;

            onProgress({
                phase: 'export',
                current: 1,
                total: 1,
                message: `已导出 ${filesCount} 个文件和 ${mappingsCount} 个路径映射`
            });

            // 阶段2：导入到目标后端
            onProgress({
                phase: 'import',
                current: 0,
                total: 1,
                message: `导入数据到 ${this.target.getBackendType()}...`
            });

            await this.target.importAll(exportedData);

            onProgress({
                phase: 'import',
                current: 1,
                total: 1,
                message: `数据导入完成`
            });

            // 阶段3：验证（可选）
            if (options?.validateAfter) {
                onProgress({
                    phase: 'validate',
                    current: 0,
                    total: 1,
                    message: '验证数据完整性...'
                });

                const validationErrors = await this.validateMigration(exportedData);
                if (validationErrors.length > 0) {
                    errors.push(...validationErrors);
                }

                onProgress({
                    phase: 'validate',
                    current: 1,
                    total: 1,
                    message: validationErrors.length > 0
                        ? `发现 ${validationErrors.length} 个问题`
                        : '数据验证通过'
                });
            }

            // 阶段4：清理源数据（可选）
            if (options?.cleanupSource && errors.length === 0) {
                onProgress({
                    phase: 'cleanup',
                    current: 0,
                    total: 1,
                    message: '清理源数据...'
                });

                // 注意：这里不真正删除数据，只是标记迁移完成
                // 实际删除应该由用户手动确认

                onProgress({
                    phase: 'cleanup',
                    current: 1,
                    total: 1,
                    message: '清理完成（建议手动备份后删除旧数据）'
                });
            }

            const duration = Date.now() - startTime;

            return {
                success: errors.length === 0,
                filesCount,
                mappingsCount,
                duration,
                errors: errors.length > 0 ? errors : undefined
            };
        } catch (err) {
            const duration = Date.now() - startTime;
            const errorMessage = err instanceof Error ? err.message : String(err);
            errors.push(`迁移失败: ${errorMessage}`);

            return {
                success: false,
                filesCount: 0,
                mappingsCount: 0,
                duration,
                errors
            };
        }
    }

    /**
     * 验证迁移后的数据完整性
     */
    private async validateMigration(originalData: {
        files: Map<string, any>;
        pathMappings: Map<string, string>;
        index: any;
    }): Promise<string[]> {
        const errors: string[] = [];

        try {
            // 验证文件数量
            const targetUuids = await this.target.getAllFileUuids();
            if (targetUuids.length !== originalData.files.size) {
                errors.push(
                    `文件数量不匹配: 原始 ${originalData.files.size}, 目标 ${targetUuids.length}`
                );
            }

            // 验证路径映射数量
            const targetMappings = await this.target.getAllPathMappings();
            if (targetMappings.size !== originalData.pathMappings.size) {
                errors.push(
                    `路径映射数量不匹配: 原始 ${originalData.pathMappings.size}, 目标 ${targetMappings.size}`
                );
            }

            // 抽样验证数据内容（验证前10个）
            let checkedCount = 0;
            for (const [uuid, originalMetadata] of originalData.files) {
                if (checkedCount >= 10) break;

                const targetMetadata = await this.target.loadFileMetadata(uuid);
                if (!targetMetadata) {
                    errors.push(`缺少文件元数据: ${uuid}`);
                } else {
                    // 简单比较关键字段
                    if (targetMetadata.filePath !== originalMetadata.filePath) {
                        errors.push(`文件路径不匹配: ${uuid}`);
                    }
                }

                checkedCount++;
            }

            // 验证路径映射
            checkedCount = 0;
            for (const [path, originalUuid] of originalData.pathMappings) {
                if (checkedCount >= 10) break;

                const targetUuid = await this.target.getUuidByPath(path);
                if (targetUuid !== originalUuid) {
                    errors.push(`路径映射不匹配: ${path}`);
                }

                checkedCount++;
            }
        } catch (err) {
            errors.push(`验证过程出错: ${err instanceof Error ? err.message : String(err)}`);
        }

        return errors;
    }

    /**
     * 显示迁移向导
     */
    static async showMigrationWizard(
        source: IDatabaseBackend,
        target: IDatabaseBackend
    ): Promise<MigrationResult | null> {
        // 确认迁移
        const sourceType = source.getBackendType().toUpperCase();
        const targetType = target.getBackendType().toUpperCase();

        const confirm = await vscode.window.showWarningMessage(
            `确认要将数据从 ${sourceType} 迁移到 ${targetType} 吗？\n\n` +
            `这个操作会将所有文件追踪数据复制到新的数据库后端。`,
            { modal: true },
            '开始迁移',
            '取消'
        );

        if (confirm !== '开始迁移') {
            return null;
        }

        // 创建进度通知
        return await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: '数据库迁移',
                cancellable: false
            },
            async (progress) => {
                const migration = new DatabaseMigration(source, target);

                const result = await migration.migrate({
                    validateAfter: true,
                    cleanupSource: false,
                    onProgress: (p) => {
                        const percentage = p.total > 0 ? (p.current / p.total) * 100 : 0;
                        progress.report({
                            message: p.message,
                            increment: percentage
                        });
                    }
                });

                // 显示结果
                if (result.success) {
                    const duration = (result.duration / 1000).toFixed(2);
                    vscode.window.showInformationMessage(
                        `数据迁移成功！\n\n` +
                        `迁移了 ${result.filesCount} 个文件和 ${result.mappingsCount} 个路径映射\n` +
                        `耗时: ${duration} 秒`
                    );
                } else {
                    vscode.window.showErrorMessage(
                        `数据迁移失败:\n\n${result.errors?.join('\n') || '未知错误'}`
                    );
                }

                return result;
            }
        );
    }

    /**
     * 比较两个后端的数据差异
     */
    static async compareBackends(
        backend1: IDatabaseBackend,
        backend2: IDatabaseBackend
    ): Promise<{
        filesOnlyIn1: string[];
        filesOnlyIn2: string[];
        differentFiles: string[];
        pathsOnlyIn1: string[];
        pathsOnlyIn2: string[];
    }> {
        const [data1, data2] = await Promise.all([
            backend1.exportAll(),
            backend2.exportAll()
        ]);

        const uuids1 = new Set(data1.files.keys());
        const uuids2 = new Set(data2.files.keys());

        const filesOnlyIn1: string[] = [];
        const filesOnlyIn2: string[] = [];
        const differentFiles: string[] = [];

        // 查找只在backend1中的文件
        for (const uuid of uuids1) {
            if (!uuids2.has(uuid)) {
                filesOnlyIn1.push(uuid);
            }
        }

        // 查找只在backend2中的文件和不同的文件
        for (const uuid of uuids2) {
            if (!uuids1.has(uuid)) {
                filesOnlyIn2.push(uuid);
            } else {
                // 比较内容
                const meta1 = data1.files.get(uuid);
                const meta2 = data2.files.get(uuid);
                if (JSON.stringify(meta1) !== JSON.stringify(meta2)) {
                    differentFiles.push(uuid);
                }
            }
        }

        // 比较路径映射
        const paths1 = new Set(data1.pathMappings.keys());
        const paths2 = new Set(data2.pathMappings.keys());

        const pathsOnlyIn1: string[] = [];
        const pathsOnlyIn2: string[] = [];

        for (const path of paths1) {
            if (!paths2.has(path)) {
                pathsOnlyIn1.push(path);
            }
        }

        for (const path of paths2) {
            if (!paths1.has(path)) {
                pathsOnlyIn2.push(path);
            }
        }

        return {
            filesOnlyIn1,
            filesOnlyIn2,
            differentFiles,
            pathsOnlyIn1,
            pathsOnlyIn2
        };
    }
}
