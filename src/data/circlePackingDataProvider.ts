/**
 * Circle Packing 可视化数据提供者
 * 负责从后端系统获取角色引用数据和文件时间线数据
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { Role } from '../extension';
import { getDocsUsingRoleKey } from '../context/roleUsageStore';
import type { WordCountProvider } from '../Provider/view/wordCountProvider';

/**
 * 前端数据格式：与 webview 的 dataSchema.ts 保持一致
 */
export interface TimeSeriesDataPoint {
    timestamp: string | number;  // 时间戳或章节标识
    value: number;               // 数值
    label?: string;              // 自定义标签（可选）
}

export interface BaseItem {
    id: string;          // 唯一标识符
    label: string;       // 显示名称
    count: number;       // 引用次数/权重值
    group?: string;      // 分组类别（可选）
    color?: string;      // 自定义颜色（可选）
    metadata?: Record<string, any>; // 扩展元数据（可选）
}

export interface CompleteItem extends BaseItem {
    timeSeriesData?: TimeSeriesDataPoint[]; // 时间序列数据（可选）
}

export interface DatasetConfig {
    title: string;                 // 数据集标题
    description?: string;          // 数据集描述（可选）
    items: CompleteItem[];         // 数据项列表
    timeSeriesConfig?: {           // 时间序列配置（可选）
        label: string;             // 轴标签
        unit?: string;             // 单位
        startTime?: string | number; // 起始时间
        endTime?: string | number;   // 结束时间
    };
}

/**
 * 文件信息接口（从字数统计树视图获取）
 */
interface FileInfo {
    fsPath: string;      // 文件路径
    label: string;       // 显示名称
    order: number;       // 排序序号
    uri: vscode.Uri;     // URI
}

/**
 * Circle Packing 数据提供者
 */
export class CirclePackingDataProvider {
    constructor(
        private readonly roles: Role[],
        private readonly wordCountProvider: WordCountProvider
    ) {}

    /**
     * 获取角色引用数据集
     * 包含每个角色的总引用次数和在各文件中的时间线数据
     * 使用分批处理避免阻塞主线程
     */
    async getRoleReferenceDataset(): Promise<DatasetConfig> {
        const items: CompleteItem[] = [];
        const files = await this.getOrderedFiles();

        // 分批处理角色,每批处理后让出控制权
        const BATCH_SIZE = 50; // 每批处理50个角色
        const totalRoles = this.roles.length;

        for (let i = 0; i < totalRoles; i += BATCH_SIZE) {
            const batch = this.roles.slice(i, Math.min(i + BATCH_SIZE, totalRoles));
            
            // 处理当前批次
            for (const role of batch) {
                const roleKey = this.getRoleKey(role);
                const docs = getDocsUsingRoleKey(roleKey);
                
                // 计算总引用次数
                const totalCount = docs.reduce((sum, doc) => {
                    const roleEntry = doc.roles.find(r => r.key === roleKey);
                    return sum + (roleEntry?.occurrences || 0);
                }, 0);

                // 如果没有引用，跳过该角色
                if (totalCount === 0) {
                    continue;
                }

                // 生成时间序列数据（按文件顺序）
                const timeSeriesData: TimeSeriesDataPoint[] = [];
                const filePathMap = new Map(files.map(f => [f.fsPath, f]));

                for (const file of files) {
                    const doc = docs.find(d => d.fsPath === file.fsPath);
                    const roleEntry = doc?.roles.find(r => r.key === roleKey);
                    const count = roleEntry?.occurrences || 0;

                    timeSeriesData.push({
                        timestamp: file.order,
                        value: count,
                        label: file.label
                    });
                }

                items.push({
                    id: roleKey,
                    label: role.name,
                    count: totalCount,
                    group: role.type || '未分类',
                    color: role.color,
                    metadata: {
                        type: role.type,
                        sourcePath: role.sourcePath,
                        uuid: role.uuid
                    },
                    timeSeriesData
                });
            }

            // 每批处理完后让出控制权,避免阻塞
            if (i + BATCH_SIZE < totalRoles) {
                await new Promise(resolve => setImmediate(resolve));
            }
        }

        // 按总引用次数降序排序
        items.sort((a, b) => b.count - a.count);

        return {
            title: '角色引用分析',
            description: '各角色在不同章节中的出现次数统计',
            items,
            timeSeriesConfig: {
                label: '章节顺序',
                unit: '次',
                startTime: files[0]?.order || 0,
                endTime: files[files.length - 1]?.order || 0
            }
        };
    }

    /**
     * 从字数统计树视图获取有序的文件列表
     */
    private async getOrderedFiles(): Promise<FileInfo[]> {
        const files: FileInfo[] = [];
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        
        if (!workspaceFolder) {
            return files;
        }

        // 获取根目录的子项
        const rootItems = await this.wordCountProvider.getChildren();
        
        // 递归收集所有文件
        await this.collectFilesRecursively(rootItems, files, 0);

        return files;
    }

    /**
     * 递归收集文件并分配顺序号
     */
    private async collectFilesRecursively(
        items: any[],
        files: FileInfo[],
        startOrder: number
    ): Promise<number> {
        let currentOrder = startOrder;
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

        for (const item of items) {
            // 跳过新建节点
            if (item.id?.includes('__newFile__') || item.id?.includes('__newFolder__')) {
                continue;
            }

            // 如果是文件（无子项）
            if (item.collapsibleState === vscode.TreeItemCollapsibleState.None) {
                // 生成相对于工作区的路径作为 label
                let label: string;
                if (workspaceFolder && item.resourceUri) {
                    const relativePath = path.relative(workspaceFolder.uri.fsPath, item.resourceUri.fsPath);
                    // 统一使用正斜杠
                    label = relativePath.replace(/\\/g, '/');
                } else {
                    // 回退到使用 item.label
                    label = typeof item.label === 'string' 
                        ? item.label.replace(/^\[\d+\]\s*/, '') // 移除序号前缀
                        : String(item.label);
                }

                files.push({
                    fsPath: item.resourceUri.fsPath,
                    label,
                    order: currentOrder++,
                    uri: item.resourceUri
                });
            } 
            // 如果是文件夹，递归获取子项
            else if (item.collapsibleState !== undefined) {
                const children = await this.wordCountProvider.getChildren(item);
                currentOrder = await this.collectFilesRecursively(children, files, currentOrder);
            }
        }

        return currentOrder;
    }

    /**
     * 获取角色的唯一键（与 roleUsageStore 保持一致）
     */
    private getRoleKey(role: Role): string {
        if (role.uuid) {
            return 'uuid:' + role.uuid;
        }
        const src = role.sourcePath ? role.sourcePath : '';
        return 'name:' + role.name + '|src:' + src;
    }

    /**
     * 获取文件时间线数据（按字数统计视图的排序）
     * 返回文件列表及其在时间线上的位置
     */
    async getFileTimelineData(): Promise<{
        files: Array<{
            fsPath: string;
            label: string;
            order: number;
            wordCount: number;
        }>;
        totalFiles: number;
    }> {
        const files = await this.getOrderedFiles();
        const result = files.map(f => {
            // 尝试从 wordCountProvider 的 itemsById 中获取字数
            const item = (this.wordCountProvider as any).itemsById?.get(f.fsPath);
            const wordCount = item?.stats?.total || 0;

            return {
                fsPath: f.fsPath,
                label: f.label,
                order: f.order,
                wordCount
            };
        });

        return {
            files: result,
            totalFiles: result.length
        };
    }

    /**
     * 获取完整数据集（包含角色引用和文件时间线）
     */
    async getCompleteDataset(): Promise<{
        roleReferences: DatasetConfig;
        fileTimeline: {
            files: Array<{
                fsPath: string;
                label: string;
                order: number;
                wordCount: number;
            }>;
            totalFiles: number;
        };
    }> {
        const [roleReferences, fileTimeline] = await Promise.all([
            this.getRoleReferenceDataset(),
            this.getFileTimelineData()
        ]);

        return {
            roleReferences,
            fileTimeline
        };
    }

    /**
     * 导出为 JSON 格式（供调试或导出使用）
     */
    async exportToJson(): Promise<string> {
        const data = await this.getCompleteDataset();
        return JSON.stringify(data, null, 2);
    }
}

/**
 * 创建数据提供者实例
 */
export function createCirclePackingDataProvider(
    roles: Role[],
    wordCountProvider: WordCountProvider
): CirclePackingDataProvider {
    return new CirclePackingDataProvider(roles, wordCountProvider);
}
