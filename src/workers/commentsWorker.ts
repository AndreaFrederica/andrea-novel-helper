import { parentPort } from 'worker_threads';
import * as fs from 'fs';
import * as path from 'path';

interface CommentMessage {
    id: string;
    type: 'scan-comments' | 'watch-comments' | 'load-comment-file';
    data: any;
}

interface CommentResponse {
    id: string;
    success: boolean;
    data?: any;
    error?: string;
}

interface CommentFileInfo {
    docUuid: string;
    filePath: string; // real document path to open in editor
    relativePath: string; // workspace-relative display path
    commentCount: number;
    resolvedCount: number;
    lastModified: number;
}

class CommentsWorker {
    private watchers = new Map<string, fs.FSWatcher>();

    async handleMessage(message: CommentMessage): Promise<CommentResponse> {
        try {
            switch (message.type) {
                case 'scan-comments':
                    return await this.handleScanComments(message.data);
                case 'watch-comments':
                    return await this.handleWatchComments(message.data);
                case 'load-comment-file':
                    return await this.handleLoadCommentFile(message.data);
                default:
                    throw new Error(`Unknown message type: ${message.type}`);
            }
        } catch (error) {
            return {
                id: message.id,
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    // Infer workspace root from a known commentsDir like <ws>/novel-helper/comments
    private guessWorkspaceRootFromCommentsDir(commentsDir: string): string {
        return path.resolve(commentsDir, '..', '..');
    }

    // 将索引中的键（可能为相对键）转换为绝对路径（兼容 Windows/UNC）
    private absFromIndexKey(workspaceRoot: string, p: string): string {
        const localish = p.replace(/\//g, path.sep);
        if (path.isAbsolute(localish) || /^[a-z]:[\\/]/i.test(localish) || localish.startsWith('\\\\')) {
            return path.resolve(localish);
        }
        return path.resolve(path.join(workspaceRoot, localish));
    }

    // Read novel-helper/.anh-fsdb/index.json and map uuid -> filePath（兼容 entries: [{u,p}]）
    private getDocPathByUuid(workspaceRoot: string, docUuid: string): { filePath: string | '', relativePath: string | '' } {
        try {
            const idxPath = path.join(workspaceRoot, 'novel-helper', '.anh-fsdb', 'index.json');
            const txt = fs.readFileSync(idxPath, 'utf8');
            const db = JSON.parse(txt);

            // 优先使用 entries: Array<{ u: string; p: string }>
            const entries = Array.isArray(db?.entries) ? db.entries : (Array.isArray(db?.files) ? db.files : null);
            if (Array.isArray(entries)) {
                for (const ent of entries) {
                    if (ent && typeof ent === 'object') {
                        const u = (ent as any).u;
                        const p = (ent as any).p;
                        if (typeof u === 'string' && typeof p === 'string' && u === docUuid) {
                            const abs = this.absFromIndexKey(workspaceRoot, p);
                            const rel = path.relative(workspaceRoot, abs) || path.basename(abs);
                            return { filePath: abs, relativePath: rel };
                        }
                    }
                }
            }
        } catch {
            // ignore
        }
        return { filePath: '', relativePath: docUuid };
    }

    /**
     * 扫描指定目录下的所有批注文件（v2: 根目录 *.json 为文档索引，data/ 下为线程元数据）
     */
    private async handleScanComments(data: { commentsDirs: string[] }): Promise<CommentResponse> {
        const commentFiles: CommentFileInfo[] = [];
        const startTime = Date.now();
        let processedFiles = 0;
        
        try {
            const maxConcurrentDirs = 3;
            const dirChunks: string[][] = [];
            for (let i = 0; i < data.commentsDirs.length; i += maxConcurrentDirs) {
                dirChunks.push(data.commentsDirs.slice(i, i + maxConcurrentDirs));
            }
            
            for (const dirChunk of dirChunks) {
                const promises = dirChunk.map(async (commentsDir) => {
                    const dirFiles: CommentFileInfo[] = [];
                    try {
                        if (!fs.existsSync(commentsDir)) {
                            console.warn(`Comments directory does not exist: ${commentsDir}`);
                            return dirFiles;
                        }
                        const files = await fs.promises.readdir(commentsDir);
                        // v2: 根目录下的 *.json 是文档索引
                        const jsonFiles = files.filter(f => f.endsWith('.json'));
                        
                        console.log(`Scanning ${jsonFiles.length} document index files in: ${commentsDir}`);
                        
                        const wsRoot = this.guessWorkspaceRootFromCommentsDir(commentsDir);
                        
                        for (const fileName of jsonFiles) {
                            const filePath = path.join(commentsDir, fileName);
                            const docUuid = fileName.replace('.json', '');
                            try {
                                const stat = await fs.promises.stat(filePath);
                                if (stat.size > 10 * 1024 * 1024) {
                                    console.warn(`Skipping large comment index: ${fileName} (${Math.round(stat.size / 1024 / 1024)}MB)`);
                                    continue;
                                }
                                // 读取索引
                                const content = await fs.promises.readFile(filePath, 'utf8');
                                const indexData = JSON.parse(content);
                                const threadIds: string[] = Array.isArray(indexData?.threadIds) ? indexData.threadIds : [];
                                
                                let commentCount = 0;
                                let resolvedCount = 0;
                                let lastModified = stat.mtimeMs;
                                
                                // 从 data 目录读取线程元数据
                                const dataDir = path.join(commentsDir, 'data');
                                for (const tid of threadIds) {
                                    try {
                                        const tPath = path.join(dataDir, `${tid}.json`);
                                        const tStat = await fs.promises.stat(tPath).catch(() => null as any);
                                        if (!tStat) continue;
                                        const tTxt = await fs.promises.readFile(tPath, 'utf8');
                                        const tMeta = JSON.parse(tTxt);
                                        const msgs = Array.isArray(tMeta?.messages) ? tMeta.messages : [];
                                        commentCount += msgs.length;
                                        if (tMeta?.status === 'resolved') resolvedCount += 1;
                                        if (tStat.mtimeMs > lastModified) lastModified = tStat.mtimeMs;
                                    } catch (e) {
                                        console.warn(`Failed to read thread metadata for ${tid}:`, e);
                                    }
                                }
                                
                                // 通过文件追踪数据库映射到真实文档路径
                                const { filePath: realPath, relativePath } = this.getDocPathByUuid(wsRoot, docUuid);
                                
                                dirFiles.push({
                                    docUuid,
                                    filePath: realPath,
                                    relativePath,
                                    commentCount,
                                    resolvedCount,
                                    lastModified
                                });
                                
                                processedFiles++;
                                if (processedFiles % 10 === 0) {
                                    const elapsed = Date.now() - startTime;
                                    if (elapsed > 25000) {
                                        console.warn(`Scan operation taking too long (${elapsed}ms), stopping early`);
                                        return dirFiles;
                                    }
                                }
                            } catch (error) {
                                console.error(`Error processing comment index ${fileName}:`, error);
                            }
                        }
                    } catch (error) {
                        console.error(`Error scanning comments directory ${commentsDir}:`, error);
                    }
                    return dirFiles;
                });
                
                const results = await Promise.all(promises);
                results.forEach(dirFiles => commentFiles.push(...dirFiles));
            }
            
            const elapsed = Date.now() - startTime;
            console.log(`Scan completed: ${commentFiles.length} comment files found in ${elapsed}ms`);
            
            return {
                id: '',
                success: true,
                data: { commentFiles }
            };
            
        } catch (error) {
            console.error('Error in handleScanComments:', error);
            return {
                id: '',
                success: false,
                error: `Scan failed: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    /**
     * 监听批注目录的文件变化（包含根目录与 data 子目录）
     */
    private async handleWatchComments(data: { commentsDirs: string[] }): Promise<CommentResponse> {
        // 清理现有的监听器
        for (const watcher of this.watchers.values()) {
            watcher.close();
        }
        this.watchers.clear();
        
        const addWatcher = (watchedPath: string) => {
            try {
                if (!fs.existsSync(watchedPath)) return;
                const watcher = fs.watch(watchedPath, { recursive: false }, async (eventType, filename) => {
                    if (!filename || !filename.endsWith('.json')) return;
                    try {
                        const fullPath = path.join(watchedPath, filename);
                        let docUuid: string | undefined;
                        if (path.basename(watchedPath) === 'data') {
                            // 线程元数据变化，解析对应 docUuid（尽力而为）
                            try {
                                const txt = fs.readFileSync(fullPath, 'utf8');
                                const meta = JSON.parse(txt);
                                docUuid = meta?.docUuid;
                            } catch {
                                // ignore
                            }
                        } else {
                            // 根目录索引变化
                            docUuid = filename.replace(/\.json$/, '');
                        }
                        if (docUuid) {
                            parentPort?.postMessage({
                                type: 'file-changed',
                                data: {
                                    eventType,
                                    filePath: fullPath,
                                    docUuid
                                }
                            });
                        }
                    } catch (e) {
                        // ignore
                    }
                });
                this.watchers.set(watchedPath, watcher);
            } catch (error) {
                console.error(`Error watching path ${watchedPath}:`, error);
            }
        };
        
        for (const commentsDir of data.commentsDirs) {
            addWatcher(commentsDir); // 根
            addWatcher(path.join(commentsDir, 'data')); // 线程元数据
        }
        
        return {
            id: '',
            success: true,
            data: { watchedDirs: data.commentsDirs.length }
        };
    }

    // Try to resolve provided path (possibly old .vscode/comments) to v2 path
    private resolveIndexPath(passedPath: string): { indexPath: string; docUuid: string; workspaceRoot: string | null } {
        const docUuid = path.basename(passedPath).replace(/\.json$/, '');
        if (fs.existsSync(passedPath)) {
            const wsRoot = path.basename(path.dirname(path.dirname(passedPath))) === '.vscode'
                ? path.dirname(path.dirname(path.dirname(passedPath)))
                : path.resolve(path.dirname(passedPath), '..', '..');
            return { indexPath: passedPath, docUuid, workspaceRoot: wsRoot };
        }
        // guess ws root from old .vscode/comments pattern
        let wsRootGuess = path.basename(path.dirname(passedPath)) === 'comments'
            && path.basename(path.dirname(path.dirname(passedPath))) === '.vscode'
            ? path.dirname(path.dirname(path.dirname(passedPath)))
            : path.resolve(path.dirname(passedPath), '..', '..');
        const v2 = path.join(wsRootGuess, 'novel-helper', 'comments', `${docUuid}.json`);
        if (fs.existsSync(v2)) {
            return { indexPath: v2, docUuid, workspaceRoot: wsRootGuess };
        }
        // As a last resort, walk up 3 levels and try
        const up3 = path.resolve(path.dirname(passedPath), '..', '..', '..');
        const v2b = path.join(up3, 'novel-helper', 'comments', `${docUuid}.json`);
        return { indexPath: v2b, docUuid, workspaceRoot: fs.existsSync(v2b) ? up3 : wsRootGuess };
    }

    /**
     * 加载单个批注文件的详细信息（兼容旧路径，返回标准化字段）
     */
    private async handleLoadCommentFile(data: { filePath: string }): Promise<CommentResponse> {
        try {
            const { indexPath, docUuid, workspaceRoot } = this.resolveIndexPath(data.filePath);
            const indexTxt = await fs.promises.readFile(indexPath, 'utf8');
            const indexData = JSON.parse(indexTxt);
            const realDocUuid: string = indexData?.docUuid || docUuid;
            const threadIds: string[] = Array.isArray(indexData?.threadIds) ? indexData.threadIds : [];
            
            const commentsDir = path.dirname(indexPath);
            const dataDir = path.join(commentsDir, 'data');
            const commentThreads: any[] = [];
            
            for (const tid of threadIds) {
                try {
                    const tPath = path.join(dataDir, `${tid}.json`);
                    const tTxt = await fs.promises.readFile(tPath, 'utf8');
                    const tMeta = JSON.parse(tTxt);
                    const normalizedMessages = Array.isArray(tMeta?.messages)
                        ? tMeta.messages.map((m: any) => ({
                            id: m.id,
                            author: m.author,
                            text: m.body ?? m.text ?? '',
                            timestamp: m.createdAt ?? m.timestamp ?? 0
                        }))
                        : [];
                    commentThreads.push({
                        id: tMeta?.id || tid,
                        status: tMeta?.status || 'open',
                        messages: normalizedMessages,
                        // optional range info
                        range: Array.isArray(tMeta?.anchor?.ranges) && tMeta.anchor.ranges.length > 0
                            ? { start: tMeta.anchor.ranges[0].start, end: tMeta.anchor.ranges[0].end }
                            : undefined
                    });
                } catch (e) {
                    console.warn(`handleLoadCommentFile: failed to read thread ${tid}:`, e);
                }
            }
            
            // Try map to real document path for UI convenience
            let docPath: string | undefined = undefined;
            if (workspaceRoot) {
                const mapped = this.getDocPathByUuid(workspaceRoot, realDocUuid);
                if (mapped.filePath) docPath = mapped.filePath;
            }
            
            const commentData = { version: indexData?.version || '2.0', docUuid: realDocUuid, docPath, commentThreads };
            
            return {
                id: '',
                success: true,
                data: { commentData }
            };
        } catch (error) {
            return {
                id: '',
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * 清理资源
     */
    cleanup() {
        for (const watcher of this.watchers.values()) {
            watcher.close();
        }
        this.watchers.clear();
    }
}

const worker = new CommentsWorker();

if (parentPort) {
    parentPort.on('message', async (message: CommentMessage) => {
        const response = await worker.handleMessage(message);
        parentPort!.postMessage({
            id: message.id,
            type: 'response',
            success: response.success,
            data: response.data,
            error: response.error
        });
    });
    
    process.on('exit', () => {
        worker.cleanup();
    });
    
    process.on('SIGINT', () => {
        worker.cleanup();
        process.exit(0);
    });
}

// 通知主线程worker已就绪（保持兼容）
parentPort?.postMessage({ type: 'ready' });

export { CommentsWorker, CommentMessage, CommentResponse };