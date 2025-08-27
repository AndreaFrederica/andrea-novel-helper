import * as vscode from 'vscode';
import { getTrackingStats, getAllTrackedFiles, getTrackingStatus } from '../utils/tracker/globalFileTracking';
import { getFileTracker } from '../utils/tracker/fileTracker';
import * as fs from 'fs';
import * as path from 'path';

/** ===== 路径工具：与数据管理器保持同样的“相对键”规范 ===== */
function normCase(p: string) { return process.platform === 'win32' ? p.toLowerCase() : p; }
function toPosix(p: string) { return p.replace(/\\/g, '/'); }

/** 计算“相对键”：相对 workspaceRoot，分隔符 POSIX，Win 下小写；不在工作区内返回绝对（POSIX） */
function relKey(absPath: string, workspaceRoot: string): string {
    const root = path.resolve(workspaceRoot);
    const abs = path.resolve(absPath);
    let rel = path.relative(root, abs);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
        const canon = toPosix(abs);
        return process.platform === 'win32' ? canon.toLowerCase() : canon;
    }
    rel = toPosix(rel);
    return process.platform === 'win32' ? rel.toLowerCase() : rel;
}

/** 用相对键还原绝对路径（键若本身绝对/含盘符/UNC，则原样转回本地分隔符） */
function absFromKey(key: string, workspaceRoot: string): string {
    const localish = key.replace(/\//g, path.sep);
    if (path.isAbsolute(localish) || /^[a-z]:[\\/]/i.test(localish) || localish.startsWith('\\\\')) {
        return path.resolve(localish);
    }
    return path.resolve(path.join(workspaceRoot, localish));
}

/** 是否位于 .git/ */
function isInGit(absPath: string, workspaceRoot: string): boolean {
    const gitDir = path.resolve(path.join(workspaceRoot, '.git'));
    const p = path.resolve(absPath);
    return p === gitDir || p.startsWith(gitDir + path.sep);
}

/** 是否位于本扩展的分片目录 novel-helper/.anh-fsdb/ */
function isInFsdb(absPath: string, workspaceRoot: string): boolean {
    const fsdb = path.resolve(path.join(workspaceRoot, 'novel-helper', '.anh-fsdb'));
    const p = path.resolve(absPath);
    return p === fsdb || p.startsWith(fsdb + path.sep);
}

/** 统计报告里显示相对路径（容忍大小写差异） */
function displayRel(absOrRel: string, workspaceRoot: string): string {
    try {
        const abs = path.isAbsolute(absOrRel) || /^[a-z]:[\\/]/i.test(absOrRel) ? absOrRel : absFromKey(absOrRel, workspaceRoot);
        return toPosix(path.relative(path.resolve(workspaceRoot), path.resolve(abs)));
    } catch { return absOrRel; }
}

/** ===== 现有命令：显示统计 ===== */
export async function showFileTrackingStats(): Promise<void> {
    const status = getTrackingStatus();
    const stats = getTrackingStats();

    if (!status.isActive || !stats) {
        vscode.window.showInformationMessage('文件追踪未激活或无数据');
        return;
    }

    const files = getAllTrackedFiles();
    const wsRoot = status.workspaceRoot || '';

    const report = [
        '# 文件追踪统计报告',
        '',
        `**工作区根目录**: ${wsRoot}`,
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
                const rel = displayRel(file.filePath, wsRoot);
                const lastModified = new Date(file.updatedAt).toLocaleString();
                const sizeStr = formatFileSize(file.size);
                const heading = file.maxHeading ? ` - "${file.maxHeading}"` : '';
                return `- \`${rel}\` (${sizeStr}, ${lastModified})${heading}`;
            }),
        '',
        '## 写作统计 (有数据的文件)',
        ...files
            .filter(f => f.writingStats && f.writingStats.totalMillis > 0)
            .sort((a, b) => (b.writingStats?.totalMillis || 0) - (a.writingStats?.totalMillis || 0))
            .slice(0, 10)
            .map(file => {
                const rel = displayRel(file.filePath, wsRoot);
                const s = file.writingStats!;
                const minutes = Math.floor(s.totalMillis / 60000);
                return `- \`${rel}\`: ${minutes} 分钟, ${s.averageCPM} CPM, ${s.sessionsCount} 次会话`;
            })
    ].join('\n');

    const doc = await vscode.workspace.openTextDocument({ content: report, language: 'markdown' });
    await vscode.window.showTextDocument(doc, { preview: false });
}

/** ===== 现有命令：清理缺失文件（保留） ===== */
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
            vscode.window.showInformationMessage(`已清理 ${removedFiles.length} 个不存在的文件记录`);
        } else {
            vscode.window.showInformationMessage('没有发现需要清理的文件');
        }
    } catch (error) {
        vscode.window.showErrorMessage(`清理文件时出错: ${error}`);
    }
}

/** ===== 现有命令：导出数据（显示路径更稳） ===== */
export async function exportTrackingData(): Promise<void> {
    const files = getAllTrackedFiles();
    const stats = getTrackingStats();
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (!stats || !ws) {
        vscode.window.showWarningMessage('没有可导出的追踪数据或未打开工作区');
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
            updatedAt: new Date(file.updatedAt).toISOString(),
            relPath: displayRel(file.filePath, ws)   // 新增：导出相对路径，便于跨机对齐
        }))
    };

    const exportPath = path.join(ws, 'novel-helper', `file-tracking-export-${Date.now()}.json`);
    try {
        await fs.promises.writeFile(exportPath, JSON.stringify(exportData, null, 2), 'utf8');
        vscode.window.showInformationMessage(`数据已导出到: ${exportPath}`);
        try { await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(exportPath)); } catch { /* ignore */ }
    } catch (error) {
        vscode.window.showErrorMessage(`导出失败: ${error}`);
    }
}

/** ===== 新增命令：路径迁移（index 归一化 + 自动移除 .git / .anh-fsdb + 内存映射刷新） ===== */
export async function migrateTrackingPaths(): Promise<void> {
    const tracker = getFileTracker();
    const status = getTrackingStatus();
    if (!tracker || !status.workspaceRoot) {
        vscode.window.showWarningMessage('文件追踪器未初始化或无工作区');
        return;
    }
    const wsRoot = status.workspaceRoot;
    const dm: any = tracker.getDataManager(); // 这里用 any 访问内部字段，保持与现有 GC 写法一致

    const indexPath = path.join(wsRoot, 'novel-helper', '.anh-fsdb', 'index.json');
    let idxChanged = false;
    let removedByIndex = 0;

    // 1) 迁移 index.json 的 p -> 相对键；并移除 .git / .anh-fsdb
    try {
        if (fs.existsSync(indexPath)) {
            const raw = await fs.promises.readFile(indexPath, 'utf8');
            const json = JSON.parse(raw);
            const entries = Array.isArray(json?.entries) ? json.entries : (Array.isArray(json?.files) ? json.files : []);
            const out: any[] = [];

            for (const ent of entries) {
                if (!ent || typeof ent !== 'object') { continue; }
                const u = ent.u; const p = ent.p; const d = ent.d;
                if (!u || !p) { continue; }

                // 兼容：p 可能是绝对或历史相对；都先转为绝对再算相对键
                const abs = absFromKey(String(p), wsRoot);
                if (isInGit(abs, wsRoot) || isInFsdb(abs, wsRoot)) {
                    idxChanged = true;
                    removedByIndex++;
                    continue; // 直接从 index 移除
                }
                const rel = relKey(abs, wsRoot);
                if (p !== rel) { idxChanged = true; }
                out.push({ u, p: rel, d: d ? 1 : 0 });
            }

            if (idxChanged) {
                const next = { version: String(json?.version || '') || (dm?.DB_VERSION ? dm.DB_VERSION + '+idx1' : '1.0.0+idx1'), lastUpdated: Date.now(), entries: out };
                await fs.promises.writeFile(indexPath, JSON.stringify(next), 'utf8');
            }
        }
    } catch (e) {
        vscode.window.showWarningMessage(`迁移 index.json 失败：${e}`);
    }

    // 2) 刷新内存 pathToUuid（统一相对键；同时剔除 .git / .anh-fsdb）
    try {
        const orig: Record<string, string> = (dm?.database?.pathToUuid || {}) as Record<string, string>;
        const next: Record<string, string> = {};
        let removedByMap = 0, migratedKeys = 0;

        for (const [key, uuid] of Object.entries(orig)) {
            const abs = absFromKey(key, wsRoot);
            if (isInGit(abs, wsRoot) || isInFsdb(abs, wsRoot)) {
                // 内部目录：移除且尝试清理分片文件
                removedByMap++;
                try {
                    const shardDir = path.join(wsRoot, 'novel-helper', '.anh-fsdb', String(uuid).slice(0, 2));
                    const shard = path.join(shardDir, `${uuid}.json`);
                    if (fs.existsSync(shard)) { await fs.promises.unlink(shard).catch(() => {}); }
                } catch { /* ignore */ }
                continue;
            }
            const rel = relKey(abs, wsRoot);
            if (rel !== key) { migratedKeys++; }
            next[rel] = uuid;
        }

        if (removedByMap || migratedKeys) {
            dm.database.pathToUuid = next;
            dm.markChanged();
            dm.scheduleSave();
        }

        vscode.window.showInformationMessage(
            `已迁移路径：index更改=${idxChanged ? '是' : '否'}，移除(索引)=${removedByIndex}，移除(映射)=${removedByMap}，迁移键=${migratedKeys}`
        );
    } catch (e) {
        vscode.window.showErrorMessage(`刷新内存映射失败：${e}`);
    }
}

/** ===== 现有命令：GC（增强：自动剔除 .git 与 .anh-fsdb；修正绝对路径判断） ===== */
export async function gcFileTracking(): Promise<void> {
    const tracker = getFileTracker();
    const status = getTrackingStatus();
    if (!tracker || !status.workspaceRoot) {
        vscode.window.showWarningMessage('文件追踪器未初始化或无工作区');
        return;
    }
    const wsRoot = status.workspaceRoot;
    const dm: any = tracker.getDataManager();
    const allKeys: string[] = Object.keys(dm?.database?.pathToUuid || {});

    if (allKeys.length === 0) {
        vscode.window.showInformationMessage('追踪数据库为空');
        return;
    }

    let removed: string[] = [];
    let checked = 0;

    const start = Date.now();
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: '文件追踪 GC',
        cancellable: true
    }, async (progress, token) => {
        for (let i = 0; i < allKeys.length; i++) {
            if (token.isCancellationRequested) { break; }
            const key = allKeys[i];
            const abs = absFromKey(key, wsRoot);

            // 先剔除内部目录与 .git
            if (isInGit(abs, wsRoot) || isInFsdb(abs, wsRoot)) {
                const uuid = dm.database.pathToUuid[key];
                if (uuid) { delete dm.database.files[uuid]; }
                delete dm.database.pathToUuid[key];
                removed.push(key);

                // 清 shard（可选）
                try {
                    const shardDir = path.join(wsRoot, 'novel-helper', '.anh-fsdb', String(uuid).slice(0, 2));
                    const shard = path.join(shardDir, `${uuid}.json`);
                    if (fs.existsSync(shard)) { await fs.promises.unlink(shard).catch(() => {}); }
                } catch { /* ignore */ }

                if (i % 50 === 0) {
                    progress.report({ message: `清理内部/版本控制目录 ${removed.length} 个`, increment: (50 / allKeys.length) * 100 });
                }
                continue;
            }

            // 正常文件存在性检查
            try {
                await fs.promises.access(abs);
            } catch {
                const uuid = dm.database.pathToUuid[key];
                if (uuid) { delete dm.database.files[uuid]; }
                delete dm.database.pathToUuid[key];
                removed.push(key);
            }

            checked++;
            if (i % 50 === 0) {
                progress.report({ message: `检查 ${i}/${allKeys.length}`, increment: (50 / allKeys.length) * 100 });
            }
        }

        if (removed.length) {
            dm.markChanged();
            dm.scheduleSave();
        }
    });

    const dur = Date.now() - start;
    if (removed.length) {
        vscode.window.showInformationMessage(`GC 完成：移除 ${removed.length} 项，用时 ${dur}ms`);
    } else {
        vscode.window.showInformationMessage(`GC 完成：无过期条目，用时 ${dur}ms`);
    }
}

/** ===== 辅助：文件大小格式化 ===== */
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
