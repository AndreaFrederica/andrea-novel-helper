import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Worker } from 'worker_threads';
import { loadComments, getDocUuidForDocument } from '../../comments/storage';
import { getFileByUuid, registerFileChangeCallback, unregisterFileChangeCallback, FileChangeEvent } from '../../utils/tracker/globalFileTracking';

interface CommentFileInfo {
    docUuid: string;
    filePath: string;
    relativePath: string;
    commentCount: number;
    resolvedCount: number;
    lastModified: number;
}

interface CommentMessage {
    id: string;
    type: 'scan-comments' | 'watch-comments' | 'load-comment-file' | 'response' | 'file-changed' | 'get-file-by-uuid';
    data: any;
}

interface CommentResponse {
    id: string;
    success: boolean;
    data?: any;
    error?: string;
}

/**
 * 批注树项数据结构
 */
export class CommentTreeItem extends vscode.TreeItem {
    public docUuid?: string;
    
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly fileUri?: vscode.Uri,
        public readonly lineNumber?: number,
        public readonly commentId?: string,
        public readonly isResolved?: boolean,
        public readonly commentText?: string,
        public readonly isCurrentFile?: boolean
    ) {
        super(label, collapsibleState);
        
        // 设置图标
        if (fileUri && lineNumber !== undefined) {
            // 批注项
            this.iconPath = new vscode.ThemeIcon(
                isResolved ? 'check' : 'comment',
                isResolved ? new vscode.ThemeColor('charts.green') : new vscode.ThemeColor('charts.orange')
            );
            this.tooltip = `${commentText || '批注'} (${isResolved ? '已解决' : '未解决'})`;
            this.command = {
                command: 'andrea.commentsExplorer.openComment',
                title: '跳转到批注',
                arguments: [this]
            };
        } else {
            // 文件夹项
            this.iconPath = new vscode.ThemeIcon(
                isCurrentFile ? 'file-text' : 'file',
                isCurrentFile ? new vscode.ThemeColor('list.highlightForeground') : undefined
            );
            this.tooltip = `文件: ${label}${isCurrentFile ? ' (当前文件)' : ''}`;
        }
        
        // 如果是当前文件，设置高亮样式
        if (isCurrentFile) {
            this.resourceUri = fileUri;
            this.description = '当前文件';
        }
        
        this.contextValue = fileUri && lineNumber !== undefined ? 'comment' : 'file';
    }
}

/**
 * 批注TreeView数据提供器
 */
export class CommentsTreeDataProvider implements vscode.TreeDataProvider<CommentTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<CommentTreeItem | undefined | null | void> = new vscode.EventEmitter<CommentTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<CommentTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
    
    private worker?: Worker;
    private pendingMessages = new Map<string, { resolve: (data: any) => void; reject: (error: Error) => void }>();
    private messageId = 0;
    private commentFiles: CommentFileInfo[] = [];
    private isLoading = false;
    
    // 搜索和过滤状态
    private searchQuery: string = '';
    private statusFilter: 'all' | 'active' | 'resolved' = 'all';
    private isFiltered: boolean = false;
    // 已发现的v2批注目录缓存（用于构造正确的索引路径）
    private commentsDirs: string[] = [];
    
    // 编辑器同步状态
    private currentActiveDocUri?: string;
    private disposables: vscode.Disposable[] = [];

    constructor() {
        this.initWorker();
        this.watchCommentChanges();
        // 初始化时自动扫描批注
        this.refresh();
        this.setupEditorSync();
        this.setupFileTracking();
    }

    // 计算指定文档的索引文件路径（使用v2 comments目录）
    private getIndexPathForDoc(docUuid: string, fileInfo: CommentFileInfo): string {
        // 规范化大小写（Windows不区分大小写），优先匹配与文件同一工作区下的comments目录
        const filePathLower = path.resolve(fileInfo.filePath).toLowerCase();
        let pickedDir: string | undefined;

        for (const dir of this.commentsDirs || []) {
            const dirResolved = path.resolve(dir);
            const workspaceRoot = path.dirname(dirResolved);
            const workspaceRootLower = workspaceRoot.toLowerCase();
            if (filePathLower.startsWith(workspaceRootLower + path.sep) || filePathLower === workspaceRootLower) {
                pickedDir = dirResolved;
                break;
            }
        }

        // 若未匹配到同工作区目录，但存在扫描到的目录，则选第一个
        if (!pickedDir && this.commentsDirs && this.commentsDirs.length > 0) {
            pickedDir = path.resolve(this.commentsDirs[0]);
        }

        if (pickedDir) {
            return path.join(pickedDir, `${docUuid}.json`);
        }

        // 如果没有找到comments目录，抛出错误
        throw new Error(`未找到批注目录，请确保项目中存在comments目录`);
    }

    /**
     * 初始化worker
     */
    private initWorker() {
        try {
            const workerPath = path.join(__dirname, '../../workers/commentsWorker.js');
            this.worker = new Worker(workerPath);
            
            this.worker.on('message', (message: CommentMessage) => {
                if (message.type === 'response') {
                    const pending = this.pendingMessages.get(message.id);
                    if (pending) {
                        if ((message as any).success === false) {
                            pending.reject(new Error((message as any).error || 'Worker error'));
                        } else {
                            pending.resolve((message as any).data);
                        }
                        this.pendingMessages.delete(message.id);
                    }
                } else if (message.type === 'file-changed') {
                    // 处理文件变化事件
                    this.handleFileChanged(message.data);
                } else if (message.type === 'get-file-by-uuid') {
                    // 处理Worker请求文件信息
                    this.handleGetFileByUuid(message);
                }
            });
            
            this.worker.on('error', (error) => {
                console.error('[comments] Comments worker error:', error);
                vscode.window.showErrorMessage(`批注加载器错误: ${error.message}`);
            });
            
            this.worker.on('exit', (code) => {
                if (code !== 0) {
                    console.error(`[comments] Comments worker exited with code ${code}`);
                }
            });
        } catch (error) {
            console.error('[comments] Failed to initialize comments worker:', error);
            vscode.window.showErrorMessage('无法初始化批注加载器');
        }
    }

    /**
     * 向worker发送消息
     */
    private sendWorkerMessage(type: string, data: any): Promise<any> {
        return new Promise((resolve, reject) => {
            if (!this.worker) {
                reject(new Error('Worker not initialized'));
                return;
            }
            
            const id = (++this.messageId).toString();
            this.pendingMessages.set(id, { resolve, reject });
            
            this.worker.postMessage({
                id,
                type,
                data
            });
            
            // 根据操作类型设置不同的超时时间
            const timeoutMs = type === 'scan-comments' ? 30000 : 15000; // 扫描操作30秒，其他15秒
            
            setTimeout(() => {
                if (this.pendingMessages.has(id)) {
                    this.pendingMessages.delete(id);
                    const errorMsg = `Worker message timeout after ${timeoutMs/1000}s for operation: ${type}`;
                    console.error(errorMsg, { type, data });
                    reject(new Error(errorMsg));
                }
            }, timeoutMs);
        });
    }

    /**
     * 异步扫描批注文件
     */
    private async scanComments() {
        if (this.isLoading) {
            return;
        }
        
        this.isLoading = true;
        
        try {
            const commentsDirs = await this.findCommentDirectories();
            
            console.log(`[comments] Found ${commentsDirs.length} comment directories:`, commentsDirs);
            
            // 缓存目录，供后续构造索引路径使用
            this.commentsDirs = commentsDirs;
            
            if (commentsDirs.length === 0) {
                this.commentFiles = [];
                this._onDidChangeTreeData.fire();
                return;
            }
            
            // 检查每个目录的文件数量
            for (const dir of commentsDirs) {
                try {
                    const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir));
                    const jsonFiles = files.filter(([name]) => name.endsWith('.json'));
                    console.log(`[comments] Directory ${dir} contains ${jsonFiles.length} JSON files`);
                } catch (error) {
                    console.warn(`[comments] Cannot read directory ${dir}:`, error);
                }
            }
            
            console.log('[comments] Sending scan request to worker...');
            
            // 扫描批注文件
            const result = await this.sendWorkerMessage('scan-comments', { commentsDirs });
            this.commentFiles = result.commentFiles || [];
            
            console.log(`[comments] Worker scan completed, found ${this.commentFiles.length} files`);
            
            // 开始监听文件变化
            await this.sendWorkerMessage('watch-comments', { commentsDirs });
            
            // 刷新树视图
            this._onDidChangeTreeData.fire();
        } catch (error) {
            console.error('[comments] Error scanning comments:', error);
            vscode.window.showErrorMessage(`扫描批注失败: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            this.isLoading = false;
        }
    }
    
    /**
     * 处理文件变化事件
     */
    private async handleFileChanged(data: { eventType: string; filePath: string; docUuid: string }) {
        console.log('[comments] Comment file changed:', data);
        
        try {
            if (data.eventType === 'rename' || data.eventType === 'change') {
                // 找到对应的文件信息
                const fileInfo = this.commentFiles.find(f => f.docUuid === data.docUuid);
                if (!fileInfo) {
                    console.warn('[comments] File info not found for docUuid:', data.docUuid);
                    return;
                }
                
                // 使用正确的路径计算方法
                const correctFilePath = this.getIndexPathForDoc(data.docUuid, fileInfo);
                
                // 文件被修改或重命名，重新加载该文件
                const result = await this.sendWorkerMessage('load-comment-file', { filePath: correctFilePath });
                if (result && result.commentData) {
                    // 更新或添加文件信息
                    const existingIndex = this.commentFiles.findIndex(f => f.docUuid === data.docUuid);
                    if (existingIndex >= 0) {
                        // 更新现有文件信息
                        const commentData = result.commentData;
                        const commentThreads = commentData.commentThreads || [];
                        const commentCount = commentThreads.reduce((count: number, thread: any) => {
                            return count + (thread.messages ? thread.messages.length : 0);
                        }, 0);
                        const resolvedCount = commentThreads.filter((thread: any) => thread.status === 'resolved').length;
                        
                        this.commentFiles[existingIndex] = {
                            docUuid: data.docUuid,
                            filePath: commentData.docPath || correctFilePath,
                            relativePath: this.commentFiles[existingIndex].relativePath,
                            commentCount,
                            resolvedCount,
                            lastModified: Date.now()
                        };
                    } else {
                        // 添加新文件
                        const commentData = result.commentData;
                        const commentThreads = commentData.commentThreads || [];
                        const commentCount = commentThreads.reduce((count: number, thread: any) => {
                            return count + (thread.messages ? thread.messages.length : 0);
                        }, 0);
                        const resolvedCount = commentThreads.filter((thread: any) => thread.status === 'resolved').length;
                        
                        this.commentFiles.push({
                            docUuid: data.docUuid,
                            filePath: commentData.docPath || correctFilePath,
                            relativePath: path.basename(commentData.docPath || correctFilePath),
                            commentCount,
                            resolvedCount,
                            lastModified: Date.now()
                        });
                    }
                } else {
                    // 加载失败，可能文件已被删除
                    this.commentFiles = this.commentFiles.filter(f => f.docUuid !== data.docUuid);
                }
            } else if (data.eventType === 'unlink') {
                // 文件被删除，从列表中移除
                this.commentFiles = this.commentFiles.filter(f => f.docUuid !== data.docUuid);
            }
            
            // 刷新树视图
            this._onDidChangeTreeData.fire();
        } catch (error) {
            console.error('[comments] Error handling file change:', error);
        }
    }

    /**
     * 设置编辑器同步
     */
    private setupEditorSync(): void {
        // 监听活动编辑器变化
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(editor => {
                if (editor && editor.document) {
                    this.currentActiveDocUri = editor.document.uri.toString();
                    this.highlightCurrentFileComments();
                }
            })
        );

        // 监听编辑器可见范围变化（滚动）
        this.disposables.push(
            vscode.window.onDidChangeTextEditorVisibleRanges(event => {
                if (event.textEditor && event.textEditor.document) {
                    const docUri = event.textEditor.document.uri.toString();
                    if (docUri === this.currentActiveDocUri) {
                        this.highlightCurrentFileComments();
                    }
                }
            })
        );

        // 初始化当前活动编辑器
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor && activeEditor.document) {
            this.currentActiveDocUri = activeEditor.document.uri.toString();
            this.highlightCurrentFileComments();
        }
    }

    /**
     * 设置文件追踪监听
     */
    private setupFileTracking(): void {
        // 注册文件变化回调，监听批注文件夹变化
        const fileChangeCallback = (event: FileChangeEvent) => {
            // 检查是否是批注相关文件的变化
            if (this.isCommentRelatedFile(event.filePath)) {
                console.log(`[comments] 检测到批注相关文件变化: ${event.type} - ${event.filePath}`);
                // 延迟刷新，避免频繁更新
                this.debounceRefresh();
            }
        };

        registerFileChangeCallback('commentsTreeView', fileChangeCallback);
        
        // 保存回调引用以便清理
        this.disposables.push({
            dispose: () => {
                unregisterFileChangeCallback('commentsTreeView', fileChangeCallback);
            }
        });
    }

    /**
     * 检查文件是否与批注相关
     */
    private isCommentRelatedFile(filePath: string): boolean {
        const normalizedPath = path.normalize(filePath).toLowerCase();
        
        // 检查是否在已知的批注目录中
        for (const commentsDir of this.commentsDirs) {
            const normalizedCommentsDir = path.normalize(commentsDir).toLowerCase();
            if (normalizedPath.startsWith(normalizedCommentsDir)) {
                // 检查是否是批注相关文件
                if (normalizedPath.endsWith('.json') || normalizedPath.endsWith('.md')) {
                    return true;
                }
            }
        }
        
        // 检查是否是批注目录本身或其子目录
        return normalizedPath.includes('comments') && 
               (normalizedPath.includes('data') || normalizedPath.includes('content'));
    }

    /**
     * 防抖刷新
     */
    private refreshTimeout?: NodeJS.Timeout;
    private debounceRefresh(): void {
        if (this.refreshTimeout) {
            clearTimeout(this.refreshTimeout);
        }
        
        this.refreshTimeout = setTimeout(() => {
            console.log('[comments] 执行防抖刷新');
            this.refresh();
        }, 500); // 500ms 防抖延迟
    }

    /**
     * 高亮当前文件的批注
     */
    private highlightCurrentFileComments(): void {
        // 触发树视图刷新以更新高亮状态
        this._onDidChangeTreeData.fire();
    }

    /**
     * 释放资源
     */
    dispose(): void {
        // 清理防抖定时器
        if (this.refreshTimeout) {
            clearTimeout(this.refreshTimeout);
        }
        
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        if (this.worker) {
            this.worker.terminate();
        }
    }

    /**
     * 监听批注文件变化
     */
    private watchCommentChanges() {
        // Worker会自动监听文件变化并通知
        // 这里保留方法以保持兼容性
    }

    /**
     * 刷新树视图
     */
    refresh(): void {
        this.scanComments();
    }
    
    /**
     * 设置搜索查询
     */
    setSearchQuery(query: string): void {
        this.searchQuery = query.toLowerCase();
        this.isFiltered = this.searchQuery !== '' || this.statusFilter !== 'all';
        this._onDidChangeTreeData.fire();
    }
    
    /**
     * 设置状态过滤器
     */
    setStatusFilter(filter: 'all' | 'active' | 'resolved'): void {
        this.statusFilter = filter;
        this.isFiltered = this.searchQuery !== '' || this.statusFilter !== 'all';
        this._onDidChangeTreeData.fire();
    }
    
    /**
     * 清除所有过滤器
     */
    clearFilters(): void {
        this.searchQuery = '';
        this.statusFilter = 'all';
        this.isFiltered = false;
        this._onDidChangeTreeData.fire();
    }
    
    /**
     * 获取当前过滤状态
     */
    getFilterStatus(): { searchQuery: string; statusFilter: string; isFiltered: boolean } {
        return {
            searchQuery: this.searchQuery,
            statusFilter: this.statusFilter,
            isFiltered: this.isFiltered
        };
    }
    
    /**
     * 切换批注状态
     */
    async toggleCommentStatus(docUuid: string, threadId: string): Promise<void> {
        try {
            // 查找对应的文件信息
            const fileInfo = this.commentFiles.find(f => f.docUuid === docUuid);
            if (!fileInfo) {
                vscode.window.showErrorMessage('未找到对应的批注文件');
                return;
            }
            
            const commentFilePath = this.getIndexPathForDoc(docUuid, fileInfo);
            
            // 加载批注文件
            const result = await this.sendWorkerMessage('load-comment-file', { filePath: commentFilePath });
            
            if (result && result.commentData) {
                const commentData = result.commentData;
                const commentThreads = commentData.commentThreads || [];
                const thread = commentThreads.find((t: any) => t.id === threadId);
                
                if (thread) {
                    // 切换状态
                    thread.status = thread.status === 'resolved' ? 'active' : 'resolved';
                    
                    // 保存文件
                    const commentFileUri = vscode.Uri.file(commentFilePath);
                    const updatedContent = JSON.stringify(commentData, null, 2);
                    await vscode.workspace.fs.writeFile(commentFileUri, Buffer.from(updatedContent, 'utf8'));
                    
                    // 更新本地缓存
                    const resolvedCount = commentThreads.filter((t: any) => t.status === 'resolved').length;
                    const fileIndex = this.commentFiles.findIndex(f => f.docUuid === docUuid);
                    if (fileIndex >= 0) {
                        this.commentFiles[fileIndex].resolvedCount = resolvedCount;
                        this.commentFiles[fileIndex].lastModified = Date.now();
                    }
                    
                    // 刷新树视图
                    this._onDidChangeTreeData.fire();
                    
                    vscode.window.showInformationMessage(`批注状态已更新为: ${thread.status === 'resolved' ? '已解决' : '活跃'}`);
                } else {
                    vscode.window.showErrorMessage('未找到指定的批注线程');
                }
            } else {
                vscode.window.showErrorMessage('无法加载批注文件');
            }
        } catch (error) {
            console.error('[comments] Error toggling comment status:', error);
            vscode.window.showErrorMessage(`切换批注状态失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    
    /**
     * 获取相对时间显示
     */
    private getTimeAgo(timestamp: number): string {
        if (!timestamp) return '未知时间';
        
        const now = Date.now();
        const diff = now - timestamp;
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        if (days > 0) {
            return `${days}天前`;
        } else if (hours > 0) {
            return `${hours}小时前`;
        } else if (minutes > 0) {
            return `${minutes}分钟前`;
        } else {
            return '刚刚';
        }
    }
    
    /**
     * 清理资源
     */
    /**
     * 导出批注数据
     */
    async exportComments(format: 'markdown' | 'json' | 'txt'): Promise<void> {
        try {
            // 获取所有批注数据
            const allComments = await this.getAllCommentsData();
            
            if (allComments.length === 0) {
                vscode.window.showWarningMessage('没有找到批注数据');
                return;
            }

            // 生成导出内容
            let content: string;
            let fileExtension: string;
            let defaultFileName: string;

            switch (format) {
                case 'markdown':
                    content = this.generateMarkdownContent(allComments);
                    fileExtension = 'md';
                    defaultFileName = `批注导出_${new Date().toISOString().split('T')[0]}.md`;
                    break;
                case 'json':
                    content = this.generateJsonContent(allComments);
                    fileExtension = 'json';
                    defaultFileName = `批注导出_${new Date().toISOString().split('T')[0]}.json`;
                    break;
                case 'txt':
                    content = this.generateTextContent(allComments);
                    fileExtension = 'txt';
                    defaultFileName = `批注导出_${new Date().toISOString().split('T')[0]}.txt`;
                    break;
                default:
                    throw new Error('不支持的导出格式');
            }

            // 选择保存位置
            const saveUri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(defaultFileName),
                filters: {
                    [format.toUpperCase()]: [fileExtension]
                }
            });

            if (saveUri) {
                await vscode.workspace.fs.writeFile(saveUri, Buffer.from(content, 'utf8'));
                const action = await vscode.window.showInformationMessage(
                    `批注已成功导出到 ${saveUri.fsPath}`,
                    '打开文件',
                    '显示在文件夹中'
                );

                if (action === '打开文件') {
                    await vscode.window.showTextDocument(saveUri);
                } else if (action === '显示在文件夹中') {
                    await vscode.commands.executeCommand('revealFileInOS', saveUri);
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage(`导出失败: ${error}`);
        }
    }

    /**
     * 获取所有批注数据
     */
    private async getAllCommentsData(): Promise<any[]> {
        const allComments: any[] = [];
        
        for (const fileInfo of this.commentFiles) {
            try {
                const comments = await loadComments(fileInfo.docUuid);
                if (comments && Array.isArray(comments)) {
                    for (const thread of comments) {
                        allComments.push({
                            fileInfo,
                            threadId: thread.id,
                            thread,
                            filePath: fileInfo.relativePath,
                            absolutePath: fileInfo.filePath
                        });
                    }
                }
            } catch (error) {
                console.warn(`[comments] 无法加载文件 ${fileInfo.relativePath} 的批注:`, error);
            }
        }
        
        return allComments;
    }

    /**
     * 生成Markdown格式内容
     */
    private generateMarkdownContent(comments: any[]): string {
        const now = new Date().toLocaleString('zh-CN');
        let content = `# 批注导出报告\n\n**导出时间:** ${now}\n**总批注数:** ${comments.length}\n\n---\n\n`;
        
        // 按文件分组
        const fileGroups = new Map<string, any[]>();
        comments.forEach(comment => {
            const filePath = comment.filePath;
            if (!fileGroups.has(filePath)) {
                fileGroups.set(filePath, []);
            }
            fileGroups.get(filePath)!.push(comment);
        });

        fileGroups.forEach((fileComments, filePath) => {
            content += `## 📁 ${filePath}\n\n`;
            
            fileComments.forEach((comment, index) => {
                const thread = comment.thread;
                const isResolved = thread.isResolved || false;
                const statusIcon = isResolved ? '✅' : '🔴';
                const statusText = isResolved ? '已解决' : '待处理';
                
                content += `### ${statusIcon} 批注 #${index + 1} - ${statusText}\n\n`;
                content += `**位置:** 第 ${thread.range?.start?.line + 1 || '未知'} 行\n`;
                content += `**创建时间:** ${new Date(thread.createdAt).toLocaleString('zh-CN')}\n`;
                
                if (thread.messages && thread.messages.length > 0) {
                    content += `\n**批注内容:**\n\n`;
                    thread.messages.forEach((message: any, msgIndex: number) => {
                        const messageTime = new Date(message.createdAt).toLocaleString('zh-CN');
                        content += `${msgIndex + 1}. **${messageTime}**\n`;
                        content += `   ${message.body}\n\n`;
                    });
                }
                
                content += `---\n\n`;
            });
        });
        
        return content;
    }

    /**
     * 生成JSON格式内容
     */
    private generateJsonContent(comments: any[]): string {
        const exportData = {
            exportInfo: {
                timestamp: new Date().toISOString(),
                totalComments: comments.length,
                exportedBy: 'Andrea Novel Helper'
            },
            comments: comments.map(comment => ({
                file: {
                    relativePath: comment.filePath,
                    absolutePath: comment.absolutePath,
                    docUuid: comment.fileInfo.docUuid
                },
                thread: {
                    id: comment.threadId,
                    isResolved: comment.thread.isResolved || false,
                    createdAt: comment.thread.createdAt,
                    range: comment.thread.range,
                    messages: comment.thread.messages || []
                }
            }))
        };
        
        return JSON.stringify(exportData, null, 2);
    }

    /**
     * 生成纯文本格式内容
     */
    private generateTextContent(comments: any[]): string {
        const now = new Date().toLocaleString('zh-CN');
        let content = `批注导出报告\n${'='.repeat(50)}\n\n`;
        content += `导出时间: ${now}\n`;
        content += `总批注数: ${comments.length}\n\n`;
        
        // 按文件分组
        const fileGroups = new Map<string, any[]>();
        comments.forEach(comment => {
            const filePath = comment.filePath;
            if (!fileGroups.has(filePath)) {
                fileGroups.set(filePath, []);
            }
            fileGroups.get(filePath)!.push(comment);
        });

        fileGroups.forEach((fileComments, filePath) => {
            content += `\n文件: ${filePath}\n${'-'.repeat(filePath.length + 4)}\n\n`;
            
            fileComments.forEach((comment, index) => {
                const thread = comment.thread;
                const isResolved = thread.isResolved || false;
                const statusText = isResolved ? '[已解决]' : '[待处理]';
                
                content += `批注 #${index + 1} ${statusText}\n`;
                content += `位置: 第 ${thread.range?.start?.line + 1 || '未知'} 行\n`;
                content += `创建时间: ${new Date(thread.createdAt).toLocaleString('zh-CN')}\n`;
                
                if (thread.messages && thread.messages.length > 0) {
                    content += `内容:\n`;
                    thread.messages.forEach((message: any, msgIndex: number) => {
                        const messageTime = new Date(message.createdAt).toLocaleString('zh-CN');
                        content += `  ${msgIndex + 1}. [${messageTime}] ${message.body}\n`;
                    });
                }
                
                content += `\n`;
            });
        });
        
        return content;
    }

    /**
     * 重新绑定文件 - 为未知文件的批注选择新的文件路径
     */
    async rebindFile(item: CommentTreeItem): Promise<void> {
        if (!item.docUuid) {
            vscode.window.showErrorMessage('无法获取批注文件信息');
            return;
        }

        try {
            // 查找对应的文件信息
            const fileInfo = this.commentFiles.find(f => f.docUuid === item.docUuid);
            if (!fileInfo) {
                vscode.window.showErrorMessage('无法找到批注文件信息');
                return;
            }

            // 对于正常绑定的文件，先询问是否真的要重新绑定
            if (item.contextValue === 'commentFile') {
                const preConfirm = await vscode.window.showWarningMessage(
                    `此批注文件已正常绑定到 "${fileInfo.relativePath}"。\n\n确定要重新绑定到其他文件吗？这将改变批注的关联关系。`,
                    { modal: true },
                    '确定重新绑定'
                );
                
                if (preConfirm !== '确定重新绑定') {
                    return;
                }
            }

            // 显示文件选择对话框
            const selectedFiles = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                openLabel: '选择新的文件',
                title: `为批注重新绑定文件 - 当前: ${fileInfo.relativePath}`,
                filters: {
                    '所有文件': ['*']
                }
            });

            if (!selectedFiles || selectedFiles.length === 0) {
                return; // 用户取消了选择
            }

            const newFilePath = selectedFiles[0].fsPath;
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('未找到工作区文件夹');
                return;
            }

            // 计算相对路径
            const newRelativePath = path.relative(workspaceFolder.uri.fsPath, newFilePath);

            // 对于未知文件，显示最终确认对话框
            if (item.contextValue === 'unknownFile') {
                const confirmation = await vscode.window.showWarningMessage(
                    `确定要将批注从 "${fileInfo.relativePath}" 重新绑定到 "${newRelativePath}" 吗？`,
                    { modal: true },
                    '确定'
                );

                if (confirmation !== '确定') {
                    return;
                }
            }

            // 获取文件追踪器
            const { getFileTracker } = await import('../../utils/tracker/globalFileTracking.js');
            const tracker = getFileTracker();
            if (!tracker) {
                vscode.window.showErrorMessage('文件追踪系统未初始化');
                return;
            }

            const dataManager = tracker.getDataManager();
            
            // 获取新文件的UUID（如果不存在则创建）
            let newFileUuid = await tracker.getFileUuid(newFilePath);
            if (!newFileUuid) {
                newFileUuid = await dataManager.addOrUpdateFile(newFilePath);
            }

            // 更新批注文件的docUuid
            const { updateCommentDocUuid } = await import('../../comments/storage.js');
            const updateSuccess = await updateCommentDocUuid(item.docUuid, newFileUuid);
            
            if (!updateSuccess) {
                vscode.window.showErrorMessage('更新批注文件docUuid失败');
                return;
            }

            // 更新文件追踪系统中的UUID映射：将新UUID映射到新文件路径
            await dataManager.setFileMetadata(newFilePath, {
                uuid: newFileUuid,
                filePath: newFilePath,
                fileName: path.basename(newFilePath),
                fileExtension: path.extname(newFilePath).toLowerCase(),
                size: fs.statSync(newFilePath).size,
                mtime: fs.statSync(newFilePath).mtimeMs,
                hash: '', // 将由系统重新计算
                isDirectory: false,
                createdAt: Date.now(),
                lastTrackedAt: Date.now(),
                updatedAt: Date.now()
            });

            // 更新本地文件信息缓存
            fileInfo.filePath = newFilePath;
            fileInfo.relativePath = newRelativePath;
            fileInfo.docUuid = newFileUuid; // 更新为新的UUID

            // 刷新树视图
            this.refresh();

            vscode.window.showInformationMessage(
                `批注已成功重新绑定到文件: ${newRelativePath}`
            );

        } catch (error) {
            vscode.window.showErrorMessage(`重新绑定文件失败: ${error}`);
        }
    }



    /**
     * 获取树项
     */
    getTreeItem(element: CommentTreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * 创建进度条
     */
    private createProgressBar(percentage: number): string {
        const barLength = 20;
        const filledLength = Math.round((percentage / 100) * barLength);
        const filled = '█'.repeat(filledLength);
        const empty = '░'.repeat(barLength - filledLength);
        return `[${filled}${empty}]`;
    }

    /**
     * 创建迷你进度条
     */
    private createMiniProgressBar(percentage: number): string {
        const barLength = 8;
        const filledLength = Math.round((percentage / 100) * barLength);
        const filled = '█'.repeat(filledLength);
        const empty = '░'.repeat(barLength - filledLength);
        return `[${filled}${empty}]`;
    }

    /**
     * 根据文件名获取合适的图标
     */
    private getFileIcon(fileName: string): string {
        const ext = path.extname(fileName).toLowerCase();
        switch (ext) {
            case '.md':
            case '.markdown':
                return 'markdown';
            case '.txt':
                return 'file-text';
            case '.json':
                return 'json';
            case '.js':
            case '.ts':
                return 'file-code';
            case '.html':
            case '.htm':
                return 'file-code';
            case '.css':
                return 'file-code';
            case '.py':
                return 'file-code';
            case '.java':
                return 'file-code';
            case '.cpp':
            case '.c':
                return 'file-code';
            case '.xml':
                return 'file-code';
            case '.yml':
            case '.yaml':
                return 'file-code';
            default:
                return 'file-text';
        }
    }

    /**
     * 获取子项
     */
    getChildren(element?: CommentTreeItem): Thenable<CommentTreeItem[]> {
        if (!element) {
            // 返回根级别的项目（文件列表）
            return this.getFilesWithComments();
        } else if (element.contextValue === 'statistics') {
            // 返回统计详情子项
            return this.getStatisticsDetails();
        } else if (element.contextValue === 'commentFile') {
            // 返回文件的批注线程（分层显示）
            return this.getCommentThreadsForFile(element.docUuid!);
        } else if (element.contextValue === 'commentThread') {
            // 返回线程的消息
            return this.getMessagesForThread(element.docUuid!, element.commentId!);
        } else {
            // 批注消息没有子项
            return Promise.resolve([]);
        }
    }

    /**
     * 获取统计详情子项
     */
    private async getStatisticsDetails(): Promise<CommentTreeItem[]> {
        const items: CommentTreeItem[] = [];
        
        if (this.commentFiles.length > 0) {
            const totalComments = this.commentFiles.reduce((sum, file) => sum + file.commentCount, 0);
            const totalResolved = this.commentFiles.reduce((sum, file) => sum + file.resolvedCount, 0);
            const totalUnresolved = totalComments - totalResolved;
            const totalFiles = this.commentFiles.length;
            
            const detailItems = [
                {
                    label: `✅ 已解决: ${totalResolved} 条`,
                    icon: 'check',
                    color: 'charts.green',
                    tooltip: `已解决的批注数量: ${totalResolved}`
                },
                {
                    label: `🟡 待处理: ${totalUnresolved} 条`,
                    icon: 'clock',
                    color: 'charts.orange',
                    tooltip: `待处理的批注数量: ${totalUnresolved}`
                },
                {
                    label: `📁 涉及文件: ${totalFiles} 个`,
                    icon: 'file',
                    color: 'charts.blue',
                    tooltip: `包含批注的文件数量: ${totalFiles}`
                },
                {
                    label: `📊 总计: ${totalComments} 条批注`,
                    icon: 'list-unordered',
                    color: 'charts.purple',
                    tooltip: `所有批注的总数量: ${totalComments}`
                }
            ];
            
            for (const detail of detailItems) {
                const item = new CommentTreeItem(
                    detail.label,
                    vscode.TreeItemCollapsibleState.None
                );
                item.contextValue = 'statisticsDetail';
                item.iconPath = new vscode.ThemeIcon(detail.icon, new vscode.ThemeColor(detail.color));
                item.tooltip = detail.tooltip;
                items.push(item);
            }
        }
        
        return items;
    }

    /**
     * 获取所有有批注的文件
     */
    private async getFilesWithComments(): Promise<CommentTreeItem[]> {
        if (this.isLoading) {
            return [new CommentTreeItem('正在加载批注...', vscode.TreeItemCollapsibleState.None)];
        }
        
        // 添加统计信息项
        const items: CommentTreeItem[] = [];
        
        if (this.commentFiles.length > 0) {
            const totalComments = this.commentFiles.reduce((sum, file) => sum + file.commentCount, 0);
            const totalResolved = this.commentFiles.reduce((sum, file) => sum + file.resolvedCount, 0);
            const totalUnresolved = totalComments - totalResolved;
            const totalFiles = this.commentFiles.length;
            
            // 计算完成率
            const completionRate = totalComments > 0 ? Math.round((totalResolved / totalComments) * 100) : 0;
            const progressBar = this.createProgressBar(completionRate);
            
            // 主统计项
            const statsItem = new CommentTreeItem(
                `📊 批注概览 (${completionRate}% 已完成)`,
                vscode.TreeItemCollapsibleState.Collapsed
            );
            statsItem.contextValue = 'statistics';
            statsItem.iconPath = new vscode.ThemeIcon('graph', 
                completionRate >= 80 ? new vscode.ThemeColor('charts.green') :
                completionRate >= 50 ? new vscode.ThemeColor('charts.yellow') :
                new vscode.ThemeColor('charts.red')
            );
            
            const filterStatus = this.getFilterStatus();
            const filterInfo = filterStatus.isFiltered ? 
                `\n🔍 当前过滤: ${filterStatus.searchQuery ? `搜索"${filterStatus.searchQuery}"` : ''}${filterStatus.statusFilter !== 'all' ? ` | 状态:${filterStatus.statusFilter}` : ''}` : '';
            
            statsItem.tooltip = `📈 批注统计概览\n${progressBar} ${completionRate}%\n\n📋 详细信息:\n• 总批注数: ${totalComments}\n• 已解决: ${totalResolved}\n• 待处理: ${totalUnresolved}\n• 涉及文件: ${totalFiles}${filterInfo}`;
            items.push(statsItem);
            
            // 添加分隔符
            const separatorItem = new CommentTreeItem(
                '─'.repeat(50),
                vscode.TreeItemCollapsibleState.None
            );
            separatorItem.contextValue = 'separator';
            separatorItem.iconPath = new vscode.ThemeIcon('dash', new vscode.ThemeColor('widget.border'));
            items.push(separatorItem);
        }
        
        if (this.commentFiles.length === 0) {
            return [new CommentTreeItem('未找到批注文件', vscode.TreeItemCollapsibleState.None)];
        }
        
        // 添加文件项（应用过滤器）
        const filteredFiles = this.applyFilters(this.commentFiles);
        
        for (const fileInfo of filteredFiles) {
            const unresolvedCount = fileInfo.commentCount - fileInfo.resolvedCount;
            const resolvedCount = fileInfo.resolvedCount;
            const completionRate = fileInfo.commentCount > 0 ? Math.round((resolvedCount / fileInfo.commentCount) * 100) : 0;
            
            // 检查文件是否存在
            const fileExistsCheck = fs.existsSync(fileInfo.filePath);
            
            // 状态图标和文本
            let statusIcon: string;
            let statusColor: string;
            let priorityLevel: string;
            
            if (!fileExistsCheck) {
                statusIcon = '❌';
                statusColor = 'list.errorForeground';
                priorityLevel = '文件不存在';
            } else if (completionRate === 100) {
                statusIcon = '✅';
                statusColor = 'charts.green';
                priorityLevel = '已完成';
            } else if (completionRate >= 50) {
                statusIcon = '🟡';
                statusColor = 'charts.yellow';
                priorityLevel = '进行中';
            } else if (unresolvedCount > 5) {
                statusIcon = '🔴';
                statusColor = 'list.errorForeground';
                priorityLevel = '高优先级';
            } else {
                statusIcon = '🟠';
                statusColor = 'charts.orange';
                priorityLevel = '待处理';
            }
            
            // 文件名和扩展名
            const fileName = path.basename(fileInfo.relativePath);
            const fileDir = path.dirname(fileInfo.relativePath);
            const displayPath = fileDir === '.' ? fileName : `${fileDir}/${fileName}`;
            
            // 创建进度条
            const miniProgressBar = this.createMiniProgressBar(completionRate);
            
            const item = new CommentTreeItem(
                `${statusIcon} ${displayPath} ${miniProgressBar} ${completionRate}%`,
                vscode.TreeItemCollapsibleState.Collapsed
            );
            item.docUuid = fileInfo.docUuid;
            
            // 检查文件是否存在，设置不同的contextValue
            const fileExistsForContext = fs.existsSync(fileInfo.filePath);
            item.contextValue = fileExistsForContext ? 'commentFile' : 'unknownFile';
            
            // 丰富的tooltip信息
            const lastModified = new Date(fileInfo.lastModified).toLocaleString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
            
            item.tooltip = `📁 ${fileName}\n📂 ${fileInfo.relativePath}\n\n📊 批注统计:\n• 总数: ${fileInfo.commentCount} 条\n• 已解决: ${resolvedCount} 条 (${completionRate}%)\n• 待处理: ${unresolvedCount} 条\n• 状态: ${priorityLevel}\n\n🕒 最后修改: ${lastModified}`;
            
            // 根据状态设置图标
            const iconName = this.getFileIcon(fileName);
            item.iconPath = new vscode.ThemeIcon(iconName, new vscode.ThemeColor(statusColor));
            
            // 检查是否为当前活动文件
            const isCurrentFile = this.currentActiveDocUri && 
                vscode.Uri.file(fileInfo.filePath).toString() === this.currentActiveDocUri;
            
            // 如果是当前文件，更新显示样式
            if (isCurrentFile) {
                item.description = '当前文件';
                item.iconPath = new vscode.ThemeIcon('file-text', new vscode.ThemeColor('list.highlightForeground'));
            }
            
            // 添加命令以打开文件
            item.command = {
                command: 'vscode.open',
                title: '打开文件',
                arguments: [vscode.Uri.file(fileInfo.filePath)]
            };
            
            items.push(item);
        }
        
        // 如果应用了过滤器但没有结果，显示提示
        if (this.isFiltered && filteredFiles.length === 0 && this.commentFiles.length > 0) {
            const noResultsItem = new CommentTreeItem(
                '未找到匹配的批注',
                vscode.TreeItemCollapsibleState.None
            );
            noResultsItem.contextValue = 'noResults';
            noResultsItem.iconPath = new vscode.ThemeIcon('search-stop');
            noResultsItem.tooltip = '当前搜索条件没有匹配的结果';
            items.push(noResultsItem);
        }
        
        return items.sort((a, b) => {
            // 统计信息和分隔符排在前面
            if (a.contextValue === 'statistics' || a.contextValue === 'separator') return -1;
            if (b.contextValue === 'statistics' || b.contextValue === 'separator') return 1;
            // 无结果提示排在后面
            if (a.contextValue === 'noResults') return 1;
            if (b.contextValue === 'noResults') return -1;
            // 文件按名称排序
            return a.label!.localeCompare(b.label!);
        });
    }

    /**
     * 动态搜索工作区中所有包含comments/data的目录
     */
    private async findCommentDirectories(): Promise<string[]> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return [];
        }
        
        const allCommentDirs: string[] = [];
        
        for (const folder of workspaceFolders) {
            try {
                // 只检查 novel-helper/comments 目录
                const novelHelperCommentsPath = path.join(folder.uri.fsPath, 'novel-helper', 'comments');
                console.log(`[comments] Checking: ${novelHelperCommentsPath}`);
                
                try {
                    const stat = await vscode.workspace.fs.stat(vscode.Uri.file(novelHelperCommentsPath));
                    if (stat.type === vscode.FileType.Directory) {
                        allCommentDirs.push(novelHelperCommentsPath);
                        console.log(`[comments] Found valid comments directory: ${novelHelperCommentsPath}`);
                    }
                } catch {
                    console.log(`[comments] Directory not found: ${novelHelperCommentsPath}`);
                }
            } catch (error) {
                console.error(`[comments] Error searching for comment directories:`, error);
            }
        }
        
        return allCommentDirs;
    }
    
    /**
     * 只检查 novel-helper/comments 目录
     */
    private async searchForCommentDirs(rootUri: vscode.Uri): Promise<string[]> {
        const commentDirs: string[] = [];
        
        try {
            // 只检查 novel-helper/comments 目录
            const novelHelperCommentsPath = path.join(rootUri.fsPath, 'novel-helper', 'comments');
            console.log(`[comments] Checking: ${novelHelperCommentsPath}`);
            
            try {
                const stat = await vscode.workspace.fs.stat(vscode.Uri.file(novelHelperCommentsPath));
                if (stat.type === vscode.FileType.Directory) {
                    commentDirs.push(novelHelperCommentsPath);
                    console.log(`[comments] Found valid comments directory: ${novelHelperCommentsPath}`);
                }
            } catch {
                console.log(`[comments] Directory not found: ${novelHelperCommentsPath}`);
            }
        } catch (error) {
            console.error(`[comments] Error searching for comment directories:`, error);
        }
        
        return commentDirs;
    }
    
    /**
     * 应用搜索和状态过滤器
     */
    private applyFilters(files: CommentFileInfo[]): CommentFileInfo[] {
        if (!this.isFiltered) {
            return files;
        }
        
        return files.filter(file => {
            // 状态过滤
            if (this.statusFilter !== 'all') {
                const hasUnresolved = file.commentCount > file.resolvedCount;
                if (this.statusFilter === 'active' && !hasUnresolved) {
                    return false;
                }
                if (this.statusFilter === 'resolved' && hasUnresolved) {
                    return false;
                }
            }
            
            // 文本搜索
            if (this.searchQuery) {
                const fileName = file.relativePath.toLowerCase();
                const filePath = file.filePath.toLowerCase();
                return fileName.includes(this.searchQuery) || filePath.includes(this.searchQuery);
            }
            
            return true;
        });
    }
    
    /**
     * 检查批注线程是否匹配搜索条件
     */
    private async threadMatchesSearch(docUuid: string, threadId: string): Promise<boolean> {
        if (!this.searchQuery) {
            return true;
        }
        
        try {
            const fileInfo = this.commentFiles.find(f => f.docUuid === docUuid);
            if (!fileInfo) {
                return false;
            }
            
            const result = await this.sendWorkerMessage('load-comment-file', { 
                filePath: this.getIndexPathForDoc(docUuid, fileInfo) 
            });
            
            if (result && result.commentData) {
                const commentData = result.commentData;
                const commentThreads = commentData.commentThreads || [];
                const thread = commentThreads.find((t: any) => t.id === threadId);
                
                if (thread && thread.messages) {
                    // 搜索批注内容
                    for (const message of thread.messages) {
                        const text = (message.text || '').toLowerCase();
                        const author = (message.author || '').toLowerCase();
                        if (text.includes(this.searchQuery) || author.includes(this.searchQuery)) {
                            return true;
                        }
                    }
                }
            }
        } catch (error) {
            console.error('[comments] Error checking thread search match:', error);
        }
        
        return false;
    }


    /**
     * 获取指定文件的所有批注
     */
    /**
     * 获取文件的批注线程（顶级显示）
     */
    private async getCommentThreadsForFile(docUuid: string): Promise<CommentTreeItem[]> {
        const threads: CommentTreeItem[] = [];
        
        try {
            // 查找对应的文件信息
            const fileInfo = this.commentFiles.find(f => f.docUuid === docUuid);
            if (!fileInfo) {
                return threads;
            }
            
            const fileUri = vscode.Uri.file(fileInfo.filePath);
            
            // 使用worker加载批注文件详细信息
            const commentFilePath = this.getIndexPathForDoc(docUuid, fileInfo);
            const result = await this.sendWorkerMessage('load-comment-file', { 
                filePath: commentFilePath 
            });
            
            if (result && result.commentData) {
                const commentData = result.commentData;
                const commentThreads = commentData.commentThreads || [];
                
                for (const thread of commentThreads) {
                    if (thread.messages && Array.isArray(thread.messages)) {
                        const lineNumber = thread.range?.start?.line || 0;
                        const isResolved = thread.status === 'resolved';
                        
                        // 应用状态过滤
                        if (this.statusFilter !== 'all') {
                            if (this.statusFilter === 'active' && isResolved) {
                                continue;
                            }
                            if (this.statusFilter === 'resolved' && !isResolved) {
                                continue;
                            }
                        }
                        
                        // 应用搜索过滤
                        if (this.searchQuery) {
                            let matchesSearch = false;
                            for (const message of thread.messages) {
                                const text = (message.text || '').toLowerCase();
                                const author = (message.author || '').toLowerCase();
                                if (text.includes(this.searchQuery) || author.includes(this.searchQuery)) {
                                    matchesSearch = true;
                                    break;
                                }
                            }
                            if (!matchesSearch) {
                                continue;
                            }
                        }
                        
                        // 为每个批注线程创建一个主条目
                        const statusIcon = isResolved ? '✅' : '🔄';
                        const statusText = isResolved ? '已解决' : '活跃';
                        const threadLabel = `${statusIcon} 第${lineNumber + 1}行 (${thread.messages.length}条消息)`;
                        const threadItem = new CommentTreeItem(
                            threadLabel,
                            vscode.TreeItemCollapsibleState.Collapsed,
                            fileUri,
                            lineNumber,
                            thread.id,
                            isResolved
                        );
                        threadItem.contextValue = 'commentThread';
                        threadItem.docUuid = docUuid;
                        
                        // 设置跳转命令
                        threadItem.command = {
                            command: 'andrea.commentsExplorer.openComment',
                            title: '跳转到批注',
                            arguments: [threadItem]
                        };
                        
                        // 设置图标
                        threadItem.iconPath = new vscode.ThemeIcon(
                            isResolved ? 'check' : 'comment-discussion',
                            isResolved ? new vscode.ThemeColor('charts.green') : new vscode.ThemeColor('charts.blue')
                        );
                        
                        // 设置工具提示
                        const firstMessage = thread.messages[0];
                        const previewText = firstMessage?.text || '无内容';
                        threadItem.tooltip = `状态: ${statusText}\n${previewText.substring(0, 100)}${previewText.length > 100 ? '...' : ''}`;
                        
                        threads.push(threadItem);
                    }
                }
            }
        } catch (error) {
            console.error('[comments] Error loading comment threads for docUuid:', docUuid, error);
        }

        return threads.sort((a, b) => (a.lineNumber || 0) - (b.lineNumber || 0));
    }
    
    /**
     * 获取批注线程的消息列表
     */
    private async getMessagesForThread(docUuid: string, threadId: string): Promise<CommentTreeItem[]> {
        const messages: CommentTreeItem[] = [];
        
        try {
            // 查找对应的文件信息
            const fileInfo = this.commentFiles.find(f => f.docUuid === docUuid);
            if (!fileInfo) {
                return messages;
            }
            
            const fileUri = vscode.Uri.file(fileInfo.filePath);
            
            // 使用worker加载批注文件详细信息
            const result = await this.sendWorkerMessage('load-comment-file', { 
                filePath: this.getIndexPathForDoc(docUuid, fileInfo)
            });
            
            if (result && result.commentData) {
                const commentData = result.commentData;
                const commentThreads = commentData.commentThreads || [];
                
                // 定位指定线程
                const targetThread = commentThreads.find((t: any) => t.id === threadId);
                if (targetThread && Array.isArray(targetThread.messages)) {
                    const lineNumber = targetThread.range?.start?.line || 0;
                    const isResolved = targetThread.status === 'resolved';
                    
                    for (let i = 0; i < targetThread.messages.length; i++) {
                        const message = targetThread.messages[i];
                        const messageText = message.text || '无内容';
                        const messageDate = new Date(message.timestamp);
                        const timeAgo = this.getTimeAgo(message.timestamp);
                        
                        // 截断过长的批注文本
                        const maxLength = 60;
                        const displayText = messageText.length > maxLength 
                            ? messageText.substring(0, maxLength) + '...' 
                            : messageText;
                        
                        const messageLabel = `💬 ${message.author || '未知用户'} (${timeAgo}): ${displayText}`;
                        
                        const messageItem = new CommentTreeItem(
                            messageLabel,
                            vscode.TreeItemCollapsibleState.None,
                            fileUri,
                            lineNumber,
                            `${threadId}-${i}`,
                            isResolved,
                            messageText
                        );
                        messageItem.contextValue = 'commentMessage';
                        messageItem.docUuid = docUuid;
                        
                        // 设置跳转命令
                        messageItem.command = {
                            command: 'andrea.commentsExplorer.openComment',
                            title: '跳转到批注',
                            arguments: [messageItem]
                        };
                        
                        // 根据消息位置设置不同图标
                        if (i === 0) {
                            messageItem.iconPath = new vscode.ThemeIcon('comment', new vscode.ThemeColor('charts.blue'));
                        } else {
                            messageItem.iconPath = new vscode.ThemeIcon('reply', new vscode.ThemeColor('charts.gray'));
                        }
                        
                        // 丰富的tooltip信息
                        const fullDate = messageDate.toLocaleString('zh-CN', {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit'
                        });
                        messageItem.tooltip = `👤 作者: ${message.author || '未知用户'}\n🕒 时间: ${fullDate} (${timeAgo})\n📝 内容:\n${messageText}`;
                        
                        messages.push(messageItem);
                    }
                }
            }
        } catch (error) {
            console.error('[comments] Error loading messages for thread:', threadId, error);
        }

        return messages;
    }
    
    /**
     * 获取文件的所有批注（平铺显示，保留兼容性）
     */
    private async getCommentsForFile(docUuid: string): Promise<CommentTreeItem[]> {
        const comments: CommentTreeItem[] = [];
        
        try {
            // 查找对应的文件信息
            const fileInfo = this.commentFiles.find(f => f.docUuid === docUuid);
            if (!fileInfo) {
                return comments;
            }
            
            const fileUri = vscode.Uri.file(fileInfo.filePath);
            
            // 使用worker加载批注文件详细信息
            const commentFilePath = this.getIndexPathForDoc(docUuid, fileInfo);
            const result = await this.sendWorkerMessage('load-comment-file', { 
                filePath: commentFilePath 
            });
            
            if (result && result.commentData) {
                const commentData = result.commentData;
                const commentThreads = commentData.commentThreads || [];
                
                for (const thread of commentThreads) {
                    if (thread.messages && Array.isArray(thread.messages)) {
                        const lineNumber = thread.range?.start?.line || 0;
                        const isResolved = thread.status === 'resolved';
                        
                        // 应用状态过滤
                        if (this.statusFilter !== 'all') {
                            if (this.statusFilter === 'active' && isResolved) {
                                continue;
                            }
                            if (this.statusFilter === 'resolved' && !isResolved) {
                                continue;
                            }
                        }
                        
                        // 应用搜索过滤
                        if (this.searchQuery) {
                            let matchesSearch = false;
                            for (const message of thread.messages) {
                                const text = (message.text || '').toLowerCase();
                                const author = (message.author || '').toLowerCase();
                                if (text.includes(this.searchQuery) || author.includes(this.searchQuery)) {
                                    matchesSearch = true;
                                    break;
                                }
                            }
                            if (!matchesSearch) {
                                continue;
                            }
                        }
                        
                        // 为每个批注线程创建一个主条目
                        const statusIcon = isResolved ? '✅' : '🔄';
                        const statusText = isResolved ? '已解决' : '活跃';
                        const threadLabel = `${statusIcon} 第${lineNumber + 1}行 (${thread.messages.length}条消息)`;
                        const threadItem = new CommentTreeItem(
                            threadLabel,
                            vscode.TreeItemCollapsibleState.Collapsed,
                            fileUri,
                            lineNumber,
                            thread.id,
                            isResolved
                        );
                        threadItem.contextValue = 'commentThread';
                        threadItem.docUuid = docUuid;
                        
                        // 设置图标
                        threadItem.iconPath = new vscode.ThemeIcon(
                            isResolved ? 'check' : 'comment',
                            isResolved ? new vscode.ThemeColor('charts.green') : new vscode.ThemeColor('charts.blue')
                        );
                        
                        // 设置工具提示
                        const firstMessage = thread.messages[0];
                        const previewText = firstMessage?.text || '无内容';
                        threadItem.tooltip = `${previewText.substring(0, 100)}${previewText.length > 100 ? '...' : ''}`;
                        
                        comments.push(threadItem);
                        
                        // 为每条消息创建子条目
                        for (let i = 0; i < thread.messages.length; i++) {
                            const message = thread.messages[i];
                            const messageText = message.text || '无内容';
                            const messageDate = new Date(message.timestamp);
                            const timeAgo = this.getTimeAgo(message.timestamp);
                            
                            // 截断过长的批注文本
                            const maxLength = 60;
                            const displayText = messageText.length > maxLength 
                                ? messageText.substring(0, maxLength) + '...' 
                                : messageText;
                            
                            const messageLabel = `💬 ${message.author || '未知用户'} (${timeAgo}): ${displayText}`;
                            
                            const messageItem = new CommentTreeItem(
                                messageLabel,
                                vscode.TreeItemCollapsibleState.None,
                                fileUri,
                                lineNumber,
                                `${thread.id}-${i}`,
                                isResolved,
                                messageText
                            );
                            messageItem.contextValue = 'commentMessage';
                            messageItem.docUuid = docUuid;
                            
                            // 根据消息位置设置不同图标
                            if (i === 0) {
                                messageItem.iconPath = new vscode.ThemeIcon('comment', new vscode.ThemeColor('charts.blue'));
                            } else {
                                messageItem.iconPath = new vscode.ThemeIcon('reply', new vscode.ThemeColor('charts.gray'));
                            }
                            
                            // 丰富的tooltip信息
                            const fullDate = messageDate.toLocaleString('zh-CN', {
                                year: 'numeric',
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit'
                            });
                            messageItem.tooltip = `👤 作者: ${message.author || '未知用户'}\n🕒 时间: ${fullDate} (${timeAgo})\n📝 内容:\n${messageText}`;
                            
                            comments.push(messageItem);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('[comments] Error loading comments for docUuid:', docUuid, error);
        }

        return comments.sort((a, b) => (a.lineNumber || 0) - (b.lineNumber || 0));
    }

    /**
     * 加载批注文件
     */
    private async loadCommentFile(commentFileUri: vscode.Uri): Promise<any> {
        try {
            const content = await vscode.workspace.fs.readFile(commentFileUri);
            const text = Buffer.from(content).toString('utf8');
            return JSON.parse(text);
        } catch (error) {
            console.warn('[comments] Failed to load comment file:', commentFileUri.fsPath, error);
            return null;
        }
    }

    /**
     * 处理Worker请求文件信息
     */
    private async handleGetFileByUuid(message: CommentMessage) {
        try {
            const { uuid } = message.data;
            const fileMetadata = getFileByUuid(uuid);
            
            // 发送响应回Worker
            this.worker?.postMessage({
                id: message.id,
                type: 'response',
                success: true,
                data: {
                    filePath: fileMetadata?.filePath,
                    fileName: fileMetadata?.fileName || '未知文件'
                }
            });
        } catch (error) {
            // 发送错误响应
            this.worker?.postMessage({
                id: message.id,
                type: 'response',
                success: false,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }
}

/**
 * 注册批注TreeView
 */
export function registerCommentsTreeView(context: vscode.ExtensionContext) {
    const provider = new CommentsTreeDataProvider();
    const treeView = vscode.window.createTreeView('andrea.commentsExplorer', {
        treeDataProvider: provider,
        showCollapseAll: true
    });

    // 注册跳转命令
    const openCommentCommand = vscode.commands.registerCommand(
        'andrea.commentsExplorer.openComment',
        async (item: CommentTreeItem) => {
            if (item && item.fileUri && item.lineNumber !== undefined) {
                try {
                    // 打开文件
                    const document = await vscode.workspace.openTextDocument(item.fileUri);
                    const editor = await vscode.window.showTextDocument(document);
                    
                    // 跳转到指定行
                    const position = new vscode.Position(item.lineNumber, 0);
                    editor.selection = new vscode.Selection(position, position);
                    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
                    
                    // 显示批注面板（如果存在）
                    vscode.commands.executeCommand('workbench.action.focusCommentsPanel');
                } catch (error) {
                    vscode.window.showErrorMessage(`无法跳转到批注: ${error}`);
                }
            }
        }
    );

    // 注册刷新命令
    const refreshCommand = vscode.commands.registerCommand(
        'andrea.commentsExplorer.refresh',
        () => provider.refresh()
    );

    // 注册切换批注状态命令
    const toggleStatusCommand = vscode.commands.registerCommand('andrea.commentsExplorer.toggleStatus',
        async (item: CommentTreeItem) => {
            if (item && item.contextValue === 'commentThread' && item.docUuid && item.commentId) {
                await provider.toggleCommentStatus(item.docUuid, item.commentId);
            }
        }
    );

    // 注册搜索命令
    const searchCommand = vscode.commands.registerCommand('andrea.commentsExplorer.search',
        async () => {
            const query = await vscode.window.showInputBox({
                prompt: '搜索批注内容、作者或文件名',
                placeHolder: '输入搜索关键词...',
                value: provider.getFilterStatus().searchQuery
            });
            
            if (query !== undefined) {
                provider.setSearchQuery(query);
                if (query) {
                    vscode.window.showInformationMessage(`搜索: "${query}"`);
                } else {
                    vscode.window.showInformationMessage('已清除搜索条件');
                }
            }
        }
    );

    // 注册状态过滤命令
    const filterByStatusCommand = vscode.commands.registerCommand('andrea.commentsExplorer.filterByStatus',
        async () => {
            const options = [
                { label: '$(list-unordered) 显示全部', value: 'all' as const },
                { label: '$(circle-outline) 仅显示活跃批注', value: 'active' as const },
                { label: '$(check) 仅显示已解决批注', value: 'resolved' as const }
            ];
            
            const selected = await vscode.window.showQuickPick(options, {
                placeHolder: '选择要显示的批注状态'
            });
            
            if (selected) {
                provider.setStatusFilter(selected.value);
                const statusText = selected.value === 'all' ? '全部' : 
                                 selected.value === 'active' ? '活跃' : '已解决';
                vscode.window.showInformationMessage(`过滤条件: ${statusText}批注`);
            }
        }
    );

    // 注册清除过滤命令
    const clearFilterCommand = vscode.commands.registerCommand('andrea.commentsExplorer.clearFilter',
        () => {
            provider.clearFilters();
            vscode.window.showInformationMessage('已清除所有过滤条件');
        }
    );

    // 注册导出命令
    const exportCommentsCommand = vscode.commands.registerCommand('andrea.commentsExplorer.exportComments',
        async () => {
            const options = [
                { label: '$(markdown) Markdown格式', value: 'markdown' },
                { label: '$(json) JSON格式', value: 'json' },
                { label: '$(file-text) 纯文本格式', value: 'txt' }
            ];
            
            const selected = await vscode.window.showQuickPick(options, {
                placeHolder: '选择导出格式'
            });
            
            if (selected) {
                await provider.exportComments(selected.value as 'markdown' | 'json' | 'txt');
            }
        }
    );

    const exportToMarkdownCommand = vscode.commands.registerCommand('andrea.commentsExplorer.exportToMarkdown',
        () => provider.exportComments('markdown')
    );

    const exportToJsonCommand = vscode.commands.registerCommand('andrea.commentsExplorer.exportToJson',
        () => provider.exportComments('json')
    );

    // 注册重新绑定文件命令
    const rebindFileCommand = vscode.commands.registerCommand('andrea.commentsExplorer.rebindFile',
        async (item: CommentTreeItem) => {
            if (item && (item.contextValue === 'unknownFile' || item.contextValue === 'commentFile') && item.docUuid) {
                await provider.rebindFile(item);
            }
        }
    );

    context.subscriptions.push(
        treeView, 
        openCommentCommand, 
        refreshCommand,
        toggleStatusCommand,
        searchCommand,
        filterByStatusCommand,
        clearFilterCommand,
        exportCommentsCommand,
        exportToMarkdownCommand,
        exportToJsonCommand,
        rebindFileCommand,
        provider
    );
    
    return provider;
}