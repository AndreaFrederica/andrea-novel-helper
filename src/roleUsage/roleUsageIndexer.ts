import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getSupportedLanguages, getSupportedExtensions, isHugeFile } from '../utils/utils';
import { getTrackedFileList } from '../utils/tracker/globalFileTracking';
import { collectRoleUsageRanges } from '../utils/roleUsageCollector';
import { updateRoleUsageFromDocument, clearRoleUsageIndex, flushRoleUsageStore } from '../context/roleUsageStore';
import { Role } from '../extension';
import { getAsyncRoleMatcher } from '../utils/asyncRoleMatcher';

/**
 * 角色引用索引重建器
 * 负责扫描工作区中的所有文档，收集角色引用信息并建立索引
 */
export class RoleUsageIndexer {
    private isIndexing = false; // 防止重复索引
    
    constructor(private roles: Role[]) {}

    /**
     * 重建角色引用索引
     * 扫描所有追踪的文件和打开的文档，收集角色引用信息
     */
    async rebuildIndex(): Promise<void> {
        console.log('[RoleUsageIndexer] 开始重建索引，当前角色数量:', this.roles.length);
        
        // 防止重复索引
        if (this.isIndexing) {
            vscode.window.showWarningMessage('角色引用索引正在进行中，请稍候...');
            return;
        }
        
        if (this.roles.length === 0) {
            vscode.window.showWarningMessage('角色数据尚未加载完成，请稍后再试。');
            return;
        }

        this.isIndexing = true;
        try {
            await this.doRebuildIndex();
        } finally {
            this.isIndexing = false;
        }
    }

    /**
     * 实际执行索引重建
     */
    private async doRebuildIndex(): Promise<void> {

        const supportedLangs = getSupportedLanguages();
        const supportedExts = new Set(getSupportedExtensions().map(e => e.toLowerCase()));
        const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
        const hugeThreshold = cfg.get<number>('hugeFile.thresholdBytes', 50 * 1024) ?? 50 * 1024;

        // 立即显示进度条，边扫描边处理
        console.log('[RoleUsageIndexer] 开始显示进度条...');
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: '正在索引角色引用',
            cancellable: true,
        }, async (progress, token) => {
            console.log('[RoleUsageIndexer] 进度条回调已执行');
            
            // 第一步：获取追踪的文件列表
            progress.report({ message: '正在扫描文件...', increment: 0 });
            
            const tracked = new Set<string>();
            try {
                const list = await getTrackedFileList();
                console.log('[RoleUsageIndexer] 获取到追踪文件数量:', list.length);
                for (const file of list) {
                    // 过滤掉内部数据库文件和其他系统文件
                    const fileName = path.basename(file).toLowerCase();
                    
                    // 检查路径中是否包含内部目录
                    const normalizedPath = file.replace(/\\/g, '/').toLowerCase();
                    if (normalizedPath.includes('/.anh-') || 
                        normalizedPath.includes('/.git/') || 
                        normalizedPath.includes('/node_modules/')) {
                        continue;
                    }
                    
                    // 过滤文件名本身
                    if (fileName.startsWith('.anh-') || fileName === '.git' || fileName === 'node_modules') {
                        continue;
                    }
                    
                    // 检查是否存在且不是目录
                    try {
                        const stat = fs.statSync(file);
                        if (stat.isDirectory()) {
                            continue; // 跳过目录
                        }
                    } catch (err) {
                        // 文件不存在或无法访问，跳过
                        continue;
                    }
                    
                    // 检查文件扩展名是否在支持的列表中
                    const extMatch = fileName.match(/\.([a-z0-9_\-]+)$/);
                    const ext = extMatch ? extMatch[1] : '';
                    if (!supportedExts.has(ext)) {
                        // 文件扩展名不在白名单中，跳过
                        continue;
                    }
                    
                    tracked.add(path.resolve(file));
                }
                console.log('[RoleUsageIndexer] 过滤后追踪文件数量:', tracked.size);
            } catch (err) {
                console.warn('[RoleUsageIndexer] 获取追踪文件列表失败', err);
            }

            // 第二步：清空现有索引（在开始处理前）
            clearRoleUsageIndex();
            progress.report({ message: '正在收集已打开的文档...', increment: 5 });
            
            const openDocs = vscode.workspace.textDocuments.filter(doc => doc && doc.uri);
            const docsToProcess: vscode.TextDocument[] = [];
            
            for (const doc of openDocs) {
                if (token.isCancellationRequested) {
                    return;
                }
                
                if (doc.uri.scheme !== 'file' && doc.uri.scheme !== 'untitled') {
                    continue;
                }
                if (!this.shouldProcessDocument(doc, supportedLangs, supportedExts, hugeThreshold)) {
                    continue;
                }
                docsToProcess.push(doc);
                if (doc.uri.scheme === 'file') {
                    tracked.delete(path.resolve(doc.uri.fsPath));
                }
            }
            console.log('[RoleUsageIndexer] 已打开文档数量:', docsToProcess.length);

            // 第三步：处理追踪的文件（不打开文档，直接读取内容）
            const trackedArray = Array.from(tracked);
            const totalFiles = trackedArray.length;
            
            if (totalFiles > 0) {
                progress.report({ message: `正在处理追踪的文件 (0/${totalFiles})...`, increment: 0 });
                
                for (let i = 0; i < trackedArray.length; i++) {
                    if (token.isCancellationRequested) {
                        return;
                    }
                    
                    const file = trackedArray[i];
                    const fileName = path.basename(file);
                    
                    // 检查是否是目录，跳过目录
                    try {
                        const stat = fs.statSync(file);
                        if (stat.isDirectory()) {
                            console.log('[RoleUsageIndexer] 跳过目录:', file);
                            continue;
                        }
                    } catch (err) {
                        console.warn('[RoleUsageIndexer] 检查文件状态失败:', file, err);
                        continue;
                    }
                    
                    progress.report({ 
                        message: `正在处理: ${fileName} (${i + 1}/${totalFiles})`,
                        increment: 0
                    });
                    
                    try {
                        // 直接读取文件内容，避免触发文档打开事件（typo 服务等）
                        await this.processFileWithoutOpening(file);
                    } catch (err) {
                        console.warn('[RoleUsageIndexer] 处理文件失败', file, err);
                    }
                    
                    // 处理文件占用 20% 的进度
                    if (i % 10 === 0) {
                        progress.report({ increment: 20 / totalFiles * 10 });
                    }
                }
            }

            if (docsToProcess.length === 0 && totalFiles === 0) {
                console.log('[RoleUsageIndexer] 没有可索引的文档');
                vscode.window.showInformationMessage('没有可索引的角色文档，索引已清空。');
                return;
            }

            console.log('[RoleUsageIndexer] 准备索引打开的文档数量:', docsToProcess.length);

            // 第四步：处理已打开的文档
            if (docsToProcess.length > 0) {
                progress.report({ 
                    message: `开始索引 ${docsToProcess.length} 个打开的文件...`,
                    increment: 0
                });

                await this.processDocuments(docsToProcess, progress, token);
            }
            
            // 立即刷新存储，确保数据持久化
            await flushRoleUsageStore();
        });
        console.log('[RoleUsageIndexer] 索引完成');
    }

    /**
     * 处理文档列表，收集角色引用
     */
    private async processDocuments(
        docsToProcess: vscode.TextDocument[],
        progress: vscode.Progress<{ message?: string; increment?: number }>,
        token: vscode.CancellationToken
    ): Promise<void> {
        console.log('[RoleUsageIndexer] processDocuments 开始执行');
        let processed = 0;
        let errored = 0;
        const total = docsToProcess.length || 1;

        // 初始进度
        progress.report({
            message: `准备索引...`,
            increment: 0,
        });
        console.log('[RoleUsageIndexer] 已报告初始进度');

        for (const doc of docsToProcess) {
            if (token.isCancellationRequested) {
                console.log('[RoleUsageIndexer] 用户取消了索引');
                break;
            }

            const fileName = path.basename(doc.uri.fsPath || doc.uri.path);
            console.log(`[RoleUsageIndexer] 正在处理文件 [${processed + 1}/${total}]:`, fileName);
            
            // 更新进度条显示当前文件
            progress.report({
                message: `[${processed + 1}/${total}] ${fileName}`,
                increment: 0,
            });

            try {
                const result = await collectRoleUsageRanges(doc, { cancellationToken: token });
                updateRoleUsageFromDocument(doc, result.roleToRanges);
                console.log(`[RoleUsageIndexer] 文件索引成功:`, fileName);
            } catch (err) {
                errored++;
                console.warn('[RoleUsageIndexer] 索引文件失败', doc.uri.toString(), err);
            }

            processed++;
            
            // 更新增量进度
            progress.report({
                increment: 100 / total,
            });
        }

        console.log(`[RoleUsageIndexer] 处理完成: ${processed}/${total}, 失败: ${errored}`);

        // 显示完成消息
        if (token.isCancellationRequested) {
            vscode.window.showWarningMessage('角色引用索引已取消。');
        } else {
            const summary = errored
                ? `角色引用索引完成：处理 ${processed} 个文件，失败 ${errored} 个。`
                : `角色引用索引完成：处理 ${processed} 个文件。`;
            vscode.window.showInformationMessage(summary);
        }
    }

    /**
     * 判断文档是否应该被处理
     */
    private shouldProcessDocument(
        doc: vscode.TextDocument,
        supportedLangs: string[],
        supportedExts: Set<string>,
        hugeThreshold: number
    ): boolean {
        if (doc.isClosed) {
            return false;
        }

        const extMatch = doc.fileName.toLowerCase().match(/\.([a-z0-9_\-]+)$/);
        const ext = extMatch ? extMatch[1] : '';
        
        if (!supportedLangs.includes(doc.languageId) && !supportedExts.has(ext)) {
            return false;
        }

        try {
            if (isHugeFile(doc, hugeThreshold)) {
                return false;
            }
        } catch {
            /* ignore */
        }

        return true;
    }

    /**
     * 处理文件内容而不打开文档（避免触发 typo 等服务）
     * 直接读取文件，使用 AC 自动机匹配角色引用
     */
    private async processFileWithoutOpening(filePath: string): Promise<void> {
        try {
            // 检查文件大小，超过阈值则跳过 AC 匹配
            const stats = fs.statSync(filePath);
            const hugeThreshold = vscode.workspace.getConfiguration('AndreaNovelHelper').get<number>('hugeFile.thresholdBytes', 51200);
            
            if (stats.size > hugeThreshold) {
                console.log(`[RoleUsageIndexer] 跳过大文件 (${stats.size} bytes):`, filePath);
                return;
            }
            
            // 读取文件内容
            const content = fs.readFileSync(filePath, 'utf8');
            const uri = vscode.Uri.file(filePath);
            
            // 使用异步角色匹配器
            const matcher = getAsyncRoleMatcher();
            const matches = await matcher.search(content, 0); // version 设为 0
            
            // 将匹配结果转换为角色引用映射
            const roleToRanges = new Map<Role, vscode.Range[]>();
            
            for (const match of matches) {
                for (const pattern of match.pats) {
                    // 查找匹配的角色
                    const role = this.roles.find(r => 
                        r.name === pattern || 
                        (r.aliases && r.aliases.includes(pattern)) ||
                        (r.fixes && r.fixes.includes(pattern))
                    );
                    
                    if (!role) {
                        continue;
                    }
                    
                    // 计算位置（字节偏移转换为行列）
                    const end = match.end + 1;
                    const start = end - pattern.length;
                    
                    // 精确计算行号和列号
                    let line = 0;
                    let lineStart = 0;
                    for (let i = 0; i < start; i++) {
                        if (content[i] === '\n') {
                            line++;
                            lineStart = i + 1;
                        }
                    }
                    
                    const startCol = start - lineStart;
                    const endCol = end - lineStart;
                    
                    const range = new vscode.Range(
                        new vscode.Position(line, startCol),
                        new vscode.Position(line, endCol)
                    );
                    
                    if (!roleToRanges.has(role)) {
                        roleToRanges.set(role, []);
                    }
                    roleToRanges.get(role)!.push(range);
                }
            }
            
            // 构造一个最小的虚拟文档对象
            // 直接调用 updateRoleUsageFromDocument，传入伪文档
            if (roleToRanges.size > 0) {
                const pseudoDoc = {
                    uri: uri,
                    version: 0,
                    getText: () => content
                } as vscode.TextDocument;
                
                updateRoleUsageFromDocument(pseudoDoc, roleToRanges);
            }
        } catch (err) {
            console.error('[RoleUsageIndexer] processFileWithoutOpening 失败:', filePath, err);
            throw err;
        }
    }
}

/**
 * 创建角色引用索引重建器
 */
export function createRoleUsageIndexer(roles: Role[]): RoleUsageIndexer {
    return new RoleUsageIndexer(roles);
}
