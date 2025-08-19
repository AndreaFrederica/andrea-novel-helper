import * as vscode from 'vscode';
import { getTrackingStats, getAllTrackedFiles, getTrackingStatus } from '../utils/tracker/globalFileTracking';
import { getFileTracker } from '../utils/tracker/fileTracker';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 显示文件追踪统计信息
 */
export async function showFileTrackingStats(): Promise<void> {
    const status = getTrackingStatus();
    const stats = getTrackingStats();
    
    if (!status.isActive || !stats) {
        vscode.window.showInformationMessage('文件追踪未激活或无数据');
        return;
    }

    const files = getAllTrackedFiles();
    
    // 创建统计报告
    const report = [
        '# 文件追踪统计报告',
        '',
        `**工作区根目录**: ${status.workspaceRoot}`,
        `**追踪状态**: ${status.isActive ? '✅ 活跃' : '❌ 非活跃'}`,
        `**最后更新**: ${new Date(stats.lastUpdated).toLocaleString()}`,
        '',
        '## 文件统计',
        `- **总文件数**: ${stats.totalFiles}`,
        `- **总大小**: ${formatFileSize(stats.totalSize)}`,
        '',
        '## 按文件类型分布',
        ...Object.entries(stats.filesByExtension).map(([ext, count]) => 
            `- **${ext || '无扩展名'}**: ${count} 个文件`
        ),
        '',
        '## 最近修改的文件 (Top 10)',
        ...files
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, 10)
            .map(file => {
                const relPath = file.filePath.replace(status.workspaceRoot || '', '');
                const lastModified = new Date(file.updatedAt).toLocaleString();
                const sizeStr = formatFileSize(file.size);
                const heading = file.maxHeading ? ` - "${file.maxHeading}"` : '';
                return `- \`${relPath}\` (${sizeStr}, ${lastModified})${heading}`;
            }),
        '',
        '## 写作统计 (有数据的文件)',
        ...files
            .filter(file => file.writingStats && file.writingStats.totalMillis > 0)
            .sort((a, b) => (b.writingStats?.totalMillis || 0) - (a.writingStats?.totalMillis || 0))
            .slice(0, 10)
            .map(file => {
                const relPath = file.filePath.replace(status.workspaceRoot || '', '');
                const stats = file.writingStats!;
                const minutes = Math.floor(stats.totalMillis / 60000);
                const cpm = stats.averageCPM;
                const sessions = stats.sessionsCount;
                return `- \`${relPath}\`: ${minutes} 分钟, ${cpm} CPM, ${sessions} 次会话`;
            })
    ].join('\n');

    // 在新标签页中显示报告
    const doc = await vscode.workspace.openTextDocument({
        content: report,
        language: 'markdown'
    });
    
    await vscode.window.showTextDocument(doc, { preview: false });
}

/**
 * 格式化文件大小
 */
function formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    
    return `${size.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * 清理缺失的文件
 */
export async function cleanupMissingFiles(): Promise<void> {
    const tracker = getFileTracker();
    if (!tracker) {
        vscode.window.showWarningMessage('文件追踪器未初始化');
        return;
    }

    try {
        const dataManager = tracker.getDataManager();
        const removedFiles = await dataManager.cleanupMissingFiles();
        
        if (removedFiles.length > 0) {
            vscode.window.showInformationMessage(
                `已清理 ${removedFiles.length} 个不存在的文件记录`
            );
        } else {
            vscode.window.showInformationMessage('没有发现需要清理的文件');
        }
    } catch (error) {
        vscode.window.showErrorMessage(`清理文件时出错: ${error}`);
    }
}

/**
 * 导出文件追踪数据
 */
export async function exportTrackingData(): Promise<void> {
    const files = getAllTrackedFiles();
    const stats = getTrackingStats();
    
    if (!stats) {
        vscode.window.showWarningMessage('没有可导出的追踪数据');
        return;
    }

    const exportData = {
        exportTime: new Date().toISOString(),
        stats,
        files: files.map(file => ({
            uuid: file.uuid,
            fileName: file.fileName,
            fileExtension: file.fileExtension,
            size: file.size,
            maxHeading: file.maxHeading,
            writingStats: file.writingStats,
            createdAt: new Date(file.createdAt).toISOString(),
            updatedAt: new Date(file.updatedAt).toISOString()
        }))
    };

    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) {
        vscode.window.showErrorMessage('没有打开的工作区');
        return;
    }

    const exportPath = path.join(ws, 'novel-helper', `file-tracking-export-${Date.now()}.json`);
    
    try {
    await fs.promises.writeFile(exportPath, JSON.stringify(exportData, null, 2), 'utf8');
        vscode.window.showInformationMessage(`数据已导出到: ${exportPath}`);
        
        // 在资源管理器中显示文件
        try {
            await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(exportPath));
        } catch {
            // 忽略错误
        }
    } catch (error) {
        vscode.window.showErrorMessage(`导出失败: ${error}`);
    }
}

/**
 * GC：扫描数据库，移除已经不存在的文件/目录（带进度条）
 */
export async function gcFileTracking(): Promise<void> {
    const tracker = getFileTracker();
    if (!tracker) {
        vscode.window.showWarningMessage('文件追踪器未初始化');
        return;
    }
    const dataManager = tracker.getDataManager();
    const all = [...Object.keys((dataManager as any).database?.pathToUuid || {})];
    if (all.length === 0) {
        vscode.window.showInformationMessage('追踪数据库为空');
        return;
    }

    let removed: string[] = [];
    let checked = 0;
    const start = Date.now();
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '文件追踪 GC', cancellable: true }, async (progress, token) => {
        progress.report({ message: '初始化...', increment: 0 });
        for (let i = 0; i < all.length; i++) {
            if (token.isCancellationRequested) { break; }
            const p = all[i];
            checked++;
            if (i % 50 === 0) {
                const percent = (i / all.length) * 100;
                progress.report({ message: `检查 ${i}/${all.length}`, increment: (50 / all.length) * 100 });
            }
            try {
                await fs.promises.access(p);
            } catch {
                // 不存在，移除
                const uuid = (dataManager as any).database.pathToUuid[p];
                if (uuid) {
                    delete (dataManager as any).database.files[uuid];
                }
                delete (dataManager as any).database.pathToUuid[p];
                removed.push(p);
            }
        }
        if (removed.length) {
            (dataManager as any).markChanged();
            (dataManager as any).scheduleSave();
        }
    });
    const dur = Date.now() - start;
    if (removed.length) {
        vscode.window.showInformationMessage(`GC 完成：移除 ${removed.length} 项，用时 ${dur}ms`);
    } else {
        vscode.window.showInformationMessage(`GC 完成：无过期条目，用时 ${dur}ms`);
    }
}
