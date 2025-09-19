import { parentPort, workerData } from 'worker_threads';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { createClient, WebDAVClient } from 'webdav';
import { SidecarDataMap, SidecarData, isTrackedSidecarData, isUntrackedSidecarData } from '../types/sidecarTypes';

// 时间容差常量（毫秒）
const TIME_TOLERANCE = 15000;

interface SyncMessage {
    id: string;
    type: 'webdav-sync' | 'file-read' | 'file-write' | 'file-list' | 'account-load' | 'account-save' | 'set-encryption-key' | 'webdav-file-read';
    data: any;
}

interface SyncResponse {
    id: string;
    success: boolean;
    data?: any;
    error?: string;
}

class SyncWorker {
    private webdavClient: WebDAVClient | null = null;
    private encryptionKey: string | null = null;
    private readonly algorithm = 'aes-256-gcm';

    /**
     * 验证和修正WebDAV URL格式
     */
    private validateAndCorrectWebDAVUrl(url: string): string {
        let correctedUrl = url.trim();
        
        // 确保URL以/结尾（对于WebDAV很重要）
        if (!correctedUrl.endsWith('/')) {
            correctedUrl += '/';
        }
        
        // 检查URL是否包含协议
        if (!correctedUrl.startsWith('http://') && !correctedUrl.startsWith('https://')) {
            throw new Error(`WebDAV URL格式错误: ${url} - URL必须以http://或https://开头`);
        }
        
        // 验证URL格式
        try {
            new URL(correctedUrl);
        } catch (error) {
            throw new Error(`WebDAV URL格式无效: ${url} - 请检查URL格式是否正确`);
        }
        
        return correctedUrl;
    }

    async handleMessage(message: SyncMessage): Promise<SyncResponse> {
        try {
            let result: SyncResponse;
            switch (message.type) {
                case 'webdav-sync':
                    result = await this.handleWebDAVSync(message.data);
                    break;
                case 'file-read':
                    result = await this.handleFileRead(message.data);
                    break;
                case 'file-write':
                    result = await this.handleFileWrite(message.data);
                    break;
                case 'file-list':
                    result = await this.handleFileList(message.data);
                    break;
                case 'account-load':
                    result = await this.handleAccountLoad(message.data);
                    break;
                case 'account-save':
                    result = await this.handleAccountSave(message.data);
                    break;
                case 'set-encryption-key':
                    result = await this.handleSetEncryptionKey(message.data);
                    break;
                case 'webdav-file-read':
                    result = await this.handleWebDAVFileRead(message.data);
                    break;
                default:
                    throw new Error(`Unknown message type: ${message.type}`);
            }
            result.id = message.id;
            return result;
        } catch (error) {
            return {
                id: message.id,
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    private async handleWebDAVSync(data: {
        url: string;
        username: string;
        password: string;
        direction: 'upload' | 'download' | 'two-way';
        localPath: string;
        remotePath: string;
        incremental?: boolean;
        lastSyncTime?: number;
        syncStrategy?: 'timestamp' | 'size' | 'both' | 'content';
        timeTolerance?: number;
        enableSmartComparison?: boolean;
        metadataMap?: SidecarDataMap;
        enableSidecar?: boolean;
        sidecarSuffix?: string;
        skipDatabaseAccess?: boolean;
    }): Promise<SyncResponse> {
        // 验证和修正URL格式
        let correctedUrl = this.validateAndCorrectWebDAVUrl(data.url);
        
        // 使用静态导入的webdav模块
        
        this.webdavClient = createClient(correctedUrl, {
            username: data.username,
            password: data.password
        });

        // 确保远程项目文件夹存在
        await this.ensureRemoteDirectory(data.remotePath);

        // 侧车配置
        const enableSidecar = data.enableSidecar !== undefined ? data.enableSidecar : true;
        const sidecarSuffix = data.sidecarSuffix || '.anhmeta.json';
        const metadataMap = data.metadataMap || {};
        const skipDatabaseAccess = data.skipDatabaseAccess !== undefined ? data.skipDatabaseAccess : true;

        console.log(`[SyncWorker] 侧车配置: enableSidecar=${enableSidecar}, skipDatabaseAccess=${skipDatabaseAccess}`);

        let localFiles = await this.walkLocal(data.localPath, data.incremental ? data.lastSyncTime : undefined);
        let remoteFiles = await this.walkRemote(data.remotePath);

        // 过滤掉侧车文件
        if (enableSidecar && sidecarSuffix) {
            localFiles = localFiles.filter(f => !f.path.endsWith(sidecarSuffix));
            remoteFiles = remoteFiles.filter(f => !f.path.endsWith(sidecarSuffix));
        }

        const actions = await this.calculateSyncActions(
            localFiles, 
            remoteFiles, 
            data.direction,
            data.syncStrategy || 'timestamp',
            data.timeTolerance || TIME_TOLERANCE,
            data.enableSmartComparison !== undefined ? data.enableSmartComparison : true,
            data.localPath,
            data.remotePath,
            metadataMap
        );

        // 检查并补充缺失的远端侧车文件
        if (enableSidecar && sidecarSuffix) {
            await this.ensureMissingSidecarFiles(remoteFiles, data.remotePath, sidecarSuffix, metadataMap);
        }

        const results = [];

        for (const action of actions) {
            try {
                const fullLocalPath = path.join(data.localPath, action.localPath);
                const fullRemotePath = path.posix.join(data.remotePath, action.remotePath);
                
                if (action.type === 'upload') {
                    await this.uploadFile(fullLocalPath, fullRemotePath);

                    // 上传侧车元数据（如果启用）
                    if (enableSidecar) {
                        const sidecarData = metadataMap[action.localPath];
                        if (sidecarData) {
                            try {
                                const sidecarPath = `${fullRemotePath}${sidecarSuffix}`;
                                
                                // 检查远端是否已存在侧车文件，避免重复上传
                                let shouldUploadSidecar = true;
                                try {
                                    const existingSidecar = await this.webdavClient!.stat(sidecarPath);
                                    if (existingSidecar) {
                                        // 侧车文件已存在，检查是否需要更新
                                        // 如果原文件被更新，则侧车文件也需要更新
                                        shouldUploadSidecar = true; // 暂时总是更新，后续可优化
                                    }
                                } catch (e) {
                                    // 侧车文件不存在，需要上传
                                    shouldUploadSidecar = true;
                                }
                                
                                if (shouldUploadSidecar) {
                                    // 根据数据类型决定侧车内容
                                    let sidecarContent: any;
                                    if (isTrackedSidecarData(sidecarData)) {
                                        // 已追踪文件：包含完整的追踪信息
                                        sidecarContent = {
                                            ...sidecarData,
                                            syncedAt: Date.now(),
                                            syncVersion: '1.0'
                                        };
                                    } else {
                                        // 未追踪文件：仅包含基础文件系统信息
                                        sidecarContent = {
                                            ...sidecarData,
                                            syncedAt: Date.now(),
                                            syncVersion: '1.0'
                                        };
                                    }
                                    
                                    const json = JSON.stringify(sidecarContent, null, 2);
                                    const buf = Buffer.from(json, 'utf8');
                                    const finalContent = this.encryptContent(buf);
                                    await this.webdavClient!.putFileContents(sidecarPath, finalContent);
                                    
                                    console.log(`[SyncWorker] ✓ 成功上传侧车文件: ${sidecarPath} (${sidecarData.source})`);
                                } else {
                                    console.log(`[SyncWorker] ⊘ 跳过侧车文件上传（已存在且无需更新）: ${sidecarPath}`);
                                }
                            } catch (e) {
                                console.warn('[SyncWorker] 上传侧车文件失败，忽略错误:', e);
                            }
                        } else {
                                console.log(`[SyncWorker] ⊘ 未找到文件的侧车数据: ${action.localPath}`);
                            }
                    }
                } else if (action.type === 'download') {
                    await this.downloadFile(fullRemotePath, fullLocalPath);
                    // 暂不下载sidecar
                }
                results.push({ success: true, action });
            } catch (error) {
                results.push({ 
                    success: false, 
                    action, 
                    error: error instanceof Error ? error.message : String(error) 
                });
            }
        }

        return {
            id: '',
            success: true,
            data: { results, totalActions: actions.length, syncTime: Date.now() }
        };
    }

    private _getIgnoredDirectories(): string[] {
        // 从workerData中获取配置，如果没有则使用默认值
        return workerData?.ignoredDirectories || [
            '.git', 'node_modules', '.pixi', '.venv', '__pycache__', '.pytest_cache',
            'target', 'build', 'dist', '.gradle', '.mvn', 'bin', 'obj', '.vs', '.idea',
            '.next', '.nuxt', '.cache', '.tmp', 'tmp', '.cargo', 'vendor', 'coverage',
            '.nyc_output', '.tox', '.nox', 'out', 'Debug', 'Release', '.dart_tool', '.pub-cache'
        ];
    }

    private _getIgnoredFiles(): string[] {
        // 从workerData中获取配置，如果没有则使用默认值
        return workerData?.ignoredFiles || [
            '.DS_Store', 'Thumbs.db', 'desktop.ini', '*.tmp', '*.temp', '*.log', '*.pid', '*.lock'
        ];
    }

    private _isFileIgnored(fileName: string): boolean {
        const ignoredFiles = this._getIgnoredFiles();
        return ignoredFiles.some(pattern => {
            if (pattern.includes('*')) {
                const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
                return regex.test(fileName);
            }
            return fileName === pattern;
        });
    }

    private _shouldIgnoreAppDataDirectories(): boolean {
        const config = workerData?.config;
        return config?.ignoreAppDataDirectories !== false; // 默认为true
    }

    private async walkLocal(dirPath: string, lastSyncTime?: number): Promise<Array<{ path: string; mtime: number; size: number }>> {
        const files: Array<{ path: string; mtime: number; size: number }> = [];
        const ignoredDirectories = this._getIgnoredDirectories();
        
        const walk = async (currentPath: string) => {
            const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(currentPath, entry.name);
                
                // 检查是否为忽略的目录
                if (entry.isDirectory() && ignoredDirectories.includes(entry.name)) {
                    continue;
                }
                
                // 检查是否为忽略的文件
                if (entry.isFile() && this._isFileIgnored(entry.name)) {
                    continue;
                }
                
                // 检查是否为忽略的目录或文件
                if (entry.isFile() && this._isFileIgnored(entry.name)) {
                    continue;
                }
                
                // 检查应用程序内部数据目录
                if (entry.name === '.anh-fsdb' && this._shouldIgnoreAppDataDirectories()) {
                    continue;
                }
                
                if (entry.isDirectory()) {
                    await walk(fullPath);
                } else if (entry.isFile()) {
                    const stats = await fs.promises.stat(fullPath);
                    
                    // 移除基于lastSyncTime的过滤，让calculateSyncActions方法来处理文件比对
                    // 增量同步应该基于本地和远程文件的mtime比较，而不是简单的时间戳过滤
                    files.push({
                        path: path.relative(dirPath, fullPath).replace(/\\/g, '/'),
                        mtime: stats.mtime.getTime(),
                        size: stats.size
                    });
                }
            }
        };
        
        await walk(dirPath);
        return files;
    }

    private async walkRemote(remotePath: string): Promise<Array<{ path: string; mtime: number; size: number }>> {
        console.log('[SyncWorker] walkRemote 开始:', { remotePath });
        if (!this.webdavClient) {
            throw new Error('WebDAV client not initialized');
        }

        const files: Array<{ path: string; mtime: number; size: number }> = [];
        const visitedPaths = new Set<string>(); // 防止循环引用
        const maxDepth = 50; // 限制递归深度
        
        // 标准化远程路径，确保以/结尾
        const normalizedRemotePath = remotePath.endsWith('/') ? remotePath : remotePath + '/';
        console.log('[SyncWorker] walkRemote 标准化路径:', { normalizedRemotePath });

        const walk = async (currentPath: string, depth: number = 0) => {
            // 检查递归深度限制
            if (depth > maxDepth) {
                console.warn('[SyncWorker] walkRemote 达到最大递归深度，跳过:', { currentPath, depth });
                return;
            }

            // 检查是否已访问过此路径（防止循环引用）
            const normalizedCurrentPath = currentPath.replace(/\/+$/, '') || '/';
            if (visitedPaths.has(normalizedCurrentPath)) {
                console.warn('[SyncWorker] walkRemote 检测到循环引用，跳过:', { currentPath });
                return;
            }
            visitedPaths.add(normalizedCurrentPath);

            try {
                console.log('[SyncWorker] walkRemote 获取目录内容:', { currentPath, depth });
                const response = await this.webdavClient!.getDirectoryContents(currentPath);
                // 处理可能的ResponseDataDetailed类型
                const entries = Array.isArray(response) ? response : response.data;
                console.log('[SyncWorker] walkRemote 目录内容获取成功，条目数:', entries.length);
                
                for (const entry of entries) {
                    console.log('[SyncWorker] walkRemote 处理条目:', {
                        filename: entry.filename,
                        type: entry.type,
                        lastmod: entry.lastmod,
                        size: entry.size
                    });
                    
                    // 计算相对于基础路径的相对路径
                    let relativePath = entry.filename;
                    if (entry.filename.startsWith(normalizedRemotePath)) {
                        relativePath = entry.filename.substring(normalizedRemotePath.length);
                    } else if (entry.filename.startsWith(remotePath)) {
                        const baseLength = remotePath.endsWith('/') ? remotePath.length : remotePath.length + 1;
                        relativePath = entry.filename.substring(baseLength);
                    }
                    
                    // 确保相对路径不以斜杠开头
                    if (relativePath.startsWith('/')) {
                        relativePath = relativePath.substring(1);
                    }
                    
                    // 只添加文件类型的条目到文件列表，目录不添加
                    if (entry.type === 'file') {
                        const fileInfo = {
                            path: relativePath,
                            type: entry.type,
                            mtime: new Date(entry.lastmod).getTime(),
                            size: entry.size || 0
                        };
                        
                        console.log('[SyncWorker] walkRemote 添加文件:', {
                            path: fileInfo.path,
                            type: fileInfo.type,
                            mtime: fileInfo.mtime,
                            size: fileInfo.size
                        });
                        
                        files.push(fileInfo);
                    } else if (entry.type === 'directory') {
                        console.log('[SyncWorker] walkRemote 跳过目录:', relativePath);
                    }
                    
                    if (entry.type === 'directory') {
                        // 递归处理子目录
                        await walk(entry.filename, depth + 1);
                    }
                }
            } catch (error) {
                // 目录不存在或无权限访问
                console.error('[SyncWorker] walkRemote 无法访问目录:', { currentPath, error, depth });
            } finally {
                // 访问完成后从已访问集合中移除，允许其他路径访问
                visitedPaths.delete(normalizedCurrentPath);
            }
        };
        
        await walk(remotePath);
        console.log('[SyncWorker] walkRemote 完成，总文件数:', files.length);
        console.log('[SyncWorker] walkRemote 文件列表:', files.map(f => f.path));
        return files;
    }

    /**
     * 专门用于TreeView的远程文件遍历方法
     * 与walkRemote不同，这个方法会返回所有文件和目录信息
     */
    private async walkRemoteForTreeView(remotePath: string): Promise<Array<{ path: string; mtime: number; size: number; type: string }>> {
        // console.log('[SyncWorker] walkRemoteForTreeView 开始:', { remotePath });
        if (!this.webdavClient) {
            throw new Error('WebDAV client not initialized');
        }

        const files: Array<{ path: string; mtime: number; size: number; type: string }> = [];
        const visitedPaths = new Set<string>(); // 防止循环引用
        const maxDepth = 50; // 限制递归深度
        
        // 标准化远程路径，确保以/结尾
        const normalizedRemotePath = remotePath.endsWith('/') ? remotePath : remotePath + '/';
        // console.log('[SyncWorker] walkRemoteForTreeView 标准化路径:', { normalizedRemotePath });

        const walk = async (currentPath: string, depth: number = 0) => {
            // 检查递归深度限制
            if (depth > maxDepth) {
                // console.warn('[SyncWorker] walkRemoteForTreeView 达到最大递归深度，跳过:', { currentPath, depth });
                return;
            }

            // 检查是否已访问过此路径（防止循环引用）
            const normalizedCurrentPath = currentPath.replace(/\/+$/, '') || '/';
            if (visitedPaths.has(normalizedCurrentPath)) {
                // console.warn('[SyncWorker] walkRemoteForTreeView 检测到循环引用，跳过:', { currentPath });
                return;
            }
            visitedPaths.add(normalizedCurrentPath);

            try {
                // console.log('[SyncWorker] walkRemoteForTreeView 获取目录内容:', { currentPath, depth });
                const response = await this.webdavClient!.getDirectoryContents(currentPath);
                // 处理可能的ResponseDataDetailed类型
                const entries = Array.isArray(response) ? response : response.data;
                // console.log('[SyncWorker] walkRemoteForTreeView 目录内容获取成功，条目数:', entries.length);
                
                for (const entry of entries) {
                    // console.log('[SyncWorker] walkRemoteForTreeView 处理条目:', {
                    //     filename: entry.filename,
                    //     type: entry.type,
                    //     lastmod: entry.lastmod,
                    //     size: entry.size
                    // });
                    
                    // 计算相对于基础路径的相对路径
                    let relativePath = entry.filename;
                    if (entry.filename.startsWith(normalizedRemotePath)) {
                        relativePath = entry.filename.substring(normalizedRemotePath.length);
                    } else if (entry.filename.startsWith(remotePath)) {
                        const baseLength = remotePath.endsWith('/') ? remotePath.length : remotePath.length + 1;
                        relativePath = entry.filename.substring(baseLength);
                    }
                    
                    // 确保相对路径不以斜杠开头
                    if (relativePath.startsWith('/')) {
                        relativePath = relativePath.substring(1);
                    }
                    
                    // 添加所有条目（文件和目录）到列表中
                    const fileInfo = {
                        path: entry.filename, // 使用完整路径，让treeview自己处理
                        type: entry.type,
                        mtime: new Date(entry.lastmod).getTime(),
                        size: entry.size || 0
                    };
                    
                    // console.log('[SyncWorker] walkRemoteForTreeView 添加条目:', {
                    //     path: fileInfo.path,
                    //     type: fileInfo.type,
                    //     mtime: fileInfo.mtime,
                    //     size: fileInfo.size
                    // });
                    
                    files.push(fileInfo);
                    
                    if (entry.type === 'directory') {
                        // 递归处理子目录
                        await walk(entry.filename, depth + 1);
                    }
                }
            } catch (error) {
                // 目录不存在或无权限访问
                console.error('[SyncWorker] walkRemoteForTreeView 无法访问目录:', { currentPath, error, depth });
            } finally {
                // 访问完成后从已访问集合中移除，允许其他路径访问
                visitedPaths.delete(normalizedCurrentPath);
            }
        };
        
        await walk(remotePath);
        // console.log('[SyncWorker] walkRemoteForTreeView 完成，总条目数:', files.length);
        // console.log('[SyncWorker] walkRemoteForTreeView 条目列表:', files.map(f => `${f.path} (${f.type})`));
        return files;
    }

    private async calculateSyncActions(
        localFiles: Array<{ path: string; mtime: number; size: number }>,
        remoteFiles: Array<{ path: string; mtime: number; size: number }>,
        direction: 'upload' | 'download' | 'two-way',
        syncStrategy: 'timestamp' | 'size' | 'both' | 'content' = 'timestamp',
        timeTolerance: number = TIME_TOLERANCE,
        enableSmartComparison: boolean = true,
        localBasePath: string,
        remoteBasePath: string,
        metadataMap?: SidecarDataMap
    ) {
        const actions: Array<{ type: 'upload' | 'download'; localPath: string; remotePath: string }> = [];
        const localMap = new Map(localFiles.map(f => [f.path, f]));
        const remoteMap = new Map(remoteFiles.map(f => [f.path, f]));

        // 处理本地文件
        for (const localFile of localFiles) {
            const remoteFile = remoteMap.get(localFile.path);
            
            if (!remoteFile) {
                // 远程不存在，需要上传
                if (direction === 'upload' || direction === 'two-way') {
                    actions.push({
                        type: 'upload',
                        localPath: localFile.path,
                        remotePath: localFile.path
                    });
                }
            } else {
                // 文件都存在，需要比较是否需要同步
                const fullLocalPath = path.join(localBasePath, localFile.path);
                const fullRemotePath = path.posix.join(remoteBasePath, localFile.path).replace(/\\/g, '/');
                
                const needsSync = await this.shouldSyncFile(
                    localFile, 
                    remoteFile, 
                    timeTolerance, 
                    syncStrategy, 
                    enableSmartComparison,
                    fullLocalPath,
                    fullRemotePath,
                    metadataMap
                );
                
                if (needsSync === 'upload' && (direction === 'upload' || direction === 'two-way')) {
                    actions.push({
                        type: 'upload',
                        localPath: localFile.path,
                        remotePath: localFile.path
                    });
                } else if (needsSync === 'download' && (direction === 'download' || direction === 'two-way')) {
                    actions.push({
                        type: 'download',
                        localPath: localFile.path,
                        remotePath: localFile.path
                    });
                }
            }
        }

        // 处理远程文件（只检查本地不存在的情况）
        for (const remoteFile of remoteFiles) {
            const localFile = localMap.get(remoteFile.path);
            
            if (!localFile) {
                // 本地不存在，需要下载
                if (direction === 'download' || direction === 'two-way') {
                    actions.push({
                        type: 'download',
                        localPath: remoteFile.path,
                        remotePath: remoteFile.path
                    });
                }
            }
            // 注意：如果本地存在，已经在上面的循环中处理过了
        }

        return actions;
    }
    
    /**
     * 计算文件的MD5哈希值
     */
    private async calculateFileHash(filePath: string): Promise<string> {
        const content = await fs.promises.readFile(filePath);
        return crypto.createHash('md5').update(content).digest('hex');
    }

    /**
     * 计算远程文件的MD5哈希值
     */
    private async calculateRemoteFileHash(remotePath: string): Promise<string> {
        if (!this.webdavClient) {
            throw new Error('WebDAV client not initialized');
        }
        
        const content = await this.webdavClient.getFileContents(remotePath) as Buffer;
        // 如果内容被加密，需要先解密
        const finalContent = this.encryptionKey ? this.decryptContent(content) : content;
        return crypto.createHash('md5').update(finalContent).digest('hex');
    }

    /**
     * 判断两个文件是否需要同步
     * @param localFile 本地文件信息
     * @param remoteFile 远程文件信息
     * @param timeTolerance 时间容差（毫秒）
     * @returns 'upload' | 'download' | null
     */
    private async shouldSyncFile(
        localFile: { path: string; mtime: number; size: number },
        remoteFile: { path: string; mtime: number; size: number },
        timeTolerance: number,
        strategy: 'timestamp' | 'size' | 'both' | 'content' = 'timestamp',
        enableSmartComparison: boolean = true,
        localPath?: string,
        remotePath?: string,
        metadataMap?: SidecarDataMap
    ): Promise<'upload' | 'download' | null> {
        // 尝试从metadataMap获取更精确的时间信息
        let effectiveLocalMtime = localFile.mtime;
        let effectiveRemoteMtime = remoteFile.mtime;
        
        if (metadataMap && localFile.path) {
            const metadata = metadataMap[localFile.path];
            if (metadata && typeof metadata.mtime === 'number') {
                effectiveLocalMtime = metadata.mtime;
                console.log(`[SyncWorker] 使用侧车时间信息: ${localFile.path}, 文件系统时间: ${localFile.mtime}, 侧车时间: ${metadata.mtime}`);
            }
        }
        
        // 创建使用有效时间的文件对象
        const effectiveLocalFile = { ...localFile, mtime: effectiveLocalMtime };
        const effectiveRemoteFile = { ...remoteFile, mtime: effectiveRemoteMtime };
        
        switch (strategy) {
            case 'size':
                // 仅基于文件大小比较
                if (effectiveLocalFile.size === effectiveRemoteFile.size) {
                    return null; // 大小相同，不需要同步
                }
                // 大小不同，选择修改时间更新的文件
                return effectiveLocalFile.mtime > effectiveRemoteFile.mtime ? 'upload' : 'download';
                
            case 'timestamp':
                // 基于时间戳比较，同时确保文件大小一致
                const timeDiff = Math.abs(effectiveLocalFile.mtime - effectiveRemoteFile.mtime);
                if (timeDiff <= timeTolerance) {
                    // 时间差在容差范围内，但还需检查文件大小是否一致
                    if (effectiveLocalFile.size !== effectiveRemoteFile.size) {
                        // 大小不一致，选择修改时间更新的文件
                        return effectiveLocalFile.mtime > effectiveRemoteFile.mtime ? 'upload' : 'download';
                    }
                    return null; // 时间和大小都匹配，不需要同步
                }
                return effectiveLocalFile.mtime > effectiveRemoteFile.mtime ? 'upload' : 'download';
                
            case 'content':
                // 基于内容哈希比较
                if (localPath && remotePath) {
                    try {
                        const localHash = await this.calculateFileHash(localPath);
                        const remoteHash = await this.calculateRemoteFileHash(remotePath);
                        
                        if (localHash === remoteHash) {
                            return null; // 内容相同，不需要同步
                        }
                        
                        // 内容不同，选择修改时间更新的文件
                        return effectiveLocalFile.mtime > effectiveRemoteFile.mtime ? 'upload' : 'download';
                    } catch (error) {
                        console.warn('无法计算文件哈希，回退到时间戳比较:', error);
                        // 回退到时间戳比较
                        const timeDiff = Math.abs(effectiveLocalFile.mtime - effectiveRemoteFile.mtime);
                        if (timeDiff <= timeTolerance) {
                            return null;
                        }
                        return effectiveLocalFile.mtime > effectiveRemoteFile.mtime ? 'upload' : 'download';
                    }
                } else {
                    // 没有提供文件路径，回退到大小+时间戳比较
                    if (effectiveLocalFile.size === effectiveRemoteFile.size) {
                        const timeDiff = Math.abs(effectiveLocalFile.mtime - effectiveRemoteFile.mtime);
                        if (timeDiff <= timeTolerance) {
                            return null;
                        }
                    }
                    return effectiveLocalFile.mtime > effectiveRemoteFile.mtime ? 'upload' : 'download';
                }
                
            case 'both':
            default:
                // 智能比较算法：结合大小和时间戳
                if (enableSmartComparison) {
                    // 首先比较文件大小
                    if (effectiveLocalFile.size !== effectiveRemoteFile.size) {
                        // 大小不同，选择修改时间更新的文件
                        return effectiveLocalFile.mtime > effectiveRemoteFile.mtime ? 'upload' : 'download';
                    }
                    
                    // 大小相同，比较修改时间（考虑容差）
                    const timeDiff = Math.abs(effectiveLocalFile.mtime - effectiveRemoteFile.mtime);
                    
                    if (timeDiff <= timeTolerance) {
                        // 时间差在容差范围内，认为文件相同，不需要同步
                        return null;
                    }
                    
                    // 时间差超过容差，选择更新的文件
                    return effectiveLocalFile.mtime > effectiveRemoteFile.mtime ? 'upload' : 'download';
                } else {
                    // 简单的both策略：大小或时间戳任一不同就同步
                    if (effectiveLocalFile.size !== effectiveRemoteFile.size) {
                        return effectiveLocalFile.mtime > effectiveRemoteFile.mtime ? 'upload' : 'download';
                    }
                    const timeDiff = Math.abs(effectiveLocalFile.mtime - effectiveRemoteFile.mtime);
                    if (timeDiff > timeTolerance) {
                        return effectiveLocalFile.mtime > effectiveRemoteFile.mtime ? 'upload' : 'download';
                    }
                    return null;
                }
        }
    }

    private async uploadFile(localPath: string, remotePath: string): Promise<void> {
        if (!this.webdavClient) {
            throw new Error('WebDAV client not initialized');
        }

        try {
            // 获取本地文件的stat信息，保留原始修改时间
            const localStat = await fs.promises.stat(localPath);
            const originalMtime = localStat.mtime;
            
            // 确保文件的父目录存在
            const remoteDir = path.posix.dirname(remotePath);
            if (remoteDir !== '.' && remoteDir !== '/') {
                await this.ensureRemoteDirectory(remoteDir);
            }
            
            const content = await fs.promises.readFile(localPath);
            // 如果设置了加密密钥，对内容进行加密
            const finalContent = this.encryptContent(content);
            await this.webdavClient!.putFileContents(remotePath, finalContent);
            
            // 尝试设置远程文件的修改时间
            try {
                const lastModified = originalMtime.toUTCString();
                await this.webdavClient!.customRequest(remotePath, {
                    method: 'PROPPATCH',
                    headers: {
                        'Content-Type': 'application/xml; charset=utf-8'
                    },
                    data: `<?xml version="1.0" encoding="utf-8" ?>
                    <D:propertyupdate xmlns:D="DAV:">
                        <D:set>
                            <D:prop>
                                <D:getlastmodified>${lastModified}</D:getlastmodified>
                            </D:prop>
                        </D:set>
                    </D:propertyupdate>`
                });
                console.log(`文件上传成功并设置修改时间: ${remotePath}, 修改时间: ${lastModified}`);
            } catch (proppatchError) {
                // 如果设置修改时间失败，记录警告但不影响上传成功
                console.warn(`文件上传成功但设置修改时间失败: ${remotePath}`, proppatchError);
                console.log(`文件上传成功: ${remotePath}, 本地修改时间: ${originalMtime.toISOString()}`);
            }
        } catch (error: any) {
            // 提供更详细的错误信息
            if (error.status === 403) {
                throw new Error(`上传文件权限被拒绝: ${remotePath} (403 Forbidden) - 请检查WebDAV账户权限和URL配置`);
            } else if (error.status === 401) {
                throw new Error(`WebDAV认证失败: ${remotePath} (401 Unauthorized) - 请检查用户名和密码`);
            } else if (error.status === 404) {
                throw new Error(`远程路径不存在: ${remotePath} (404 Not Found) - 请检查URL和路径配置`);
            } else {
                throw new Error(`上传文件失败: ${remotePath} - ${error.message || error}`);
            }
        }
    }

    private async downloadFile(remotePath: string, localPath: string): Promise<void> {
        if (!this.webdavClient) {
            throw new Error('WebDAV client not initialized');
        }

        const content = await this.webdavClient!.getFileContents(remotePath);
        
        // 确保目录存在
        const dir = path.dirname(localPath);
        await fs.promises.mkdir(dir, { recursive: true });
        
        // 如果设置了加密密钥，对内容进行解密
        const finalContent = this.decryptContent(content as Buffer);
        await fs.promises.writeFile(localPath, finalContent);
    }

    /**
     * 确保远程目录存在
     */
    private async ensureRemoteDirectory(remotePath: string): Promise<void> {
        if (!this.webdavClient) {
            throw new Error('WebDAV client not initialized');
        }

        try {
            // 检查目录是否存在
            await this.webdavClient!.stat(remotePath);
        } catch (error: any) {
            // 目录不存在，创建它
            try {
                await this.webdavClient!.createDirectory(remotePath, { recursive: true });
            } catch (createError: any) {
                if (createError.status === 403) {
                    throw new Error(`创建远程目录权限被拒绝: ${remotePath} (403 Forbidden) - 请检查WebDAV账户是否有创建目录的权限`);
                } else if (createError.status === 401) {
                    throw new Error(`WebDAV认证失败: ${remotePath} (401 Unauthorized) - 请检查用户名和密码`);
                } else if (createError.status === 409) {
                    // 409 Conflict - 通常表示父目录不存在或路径冲突
                    throw new Error(`创建目录冲突: ${remotePath} (409 Conflict) - 请检查父目录是否存在或路径是否正确`);
                } else {
                    console.warn(`Failed to create remote directory ${remotePath}:`, createError);
                    // 对于其他错误，记录警告但继续执行
                }
            }
        }
    }

    private async handleFileRead(data: { filePath: string }): Promise<SyncResponse> {
        const content = await fs.promises.readFile(data.filePath, 'utf8');
        return {
            id: '',
            success: true,
            data: { content }
        };
    }

    private async handleFileWrite(data: { filePath?: string; content: string; accountId?: string; remotePath?: string; url?: string; username?: string; password?: string }): Promise<SyncResponse> {
        try {
            // 如果提供了accountId和remotePath，则写入WebDAV
            if (data.accountId && data.remotePath) {
                console.log('[WebDAV-Worker] handleFileWrite - WebDAV write:', data.remotePath);
                
                // 如果提供了WebDAV连接信息，初始化客户端
                if (data.url && data.username && data.password) {
                    const correctedUrl = this.validateAndCorrectWebDAVUrl(data.url);
                    this.webdavClient = createClient(correctedUrl, {
                        username: data.username,
                        password: data.password
                    });
                }
                
                if (!this.webdavClient) {
                    throw new Error('WebDAV client not initialized - missing connection info');
                }
                
                // 确保远程目录存在
                const remoteDir = path.posix.dirname(data.remotePath);
                if (remoteDir !== '.' && remoteDir !== '/') {
                    await this.ensureRemoteDirectory(remoteDir);
                }
                
                // 将内容转换为Buffer并加密（如果需要）
                const contentBuffer = Buffer.from(data.content, 'utf8');
                const finalContent = this.encryptContent(contentBuffer);
                
                // 写入WebDAV服务器
                await this.webdavClient.putFileContents(data.remotePath, finalContent);
                console.log('[WebDAV-Worker] handleFileWrite - WebDAV write successful:', data.remotePath);
                
                return {
                    id: '',
                    success: true,
                    data: { remotePath: data.remotePath }
                };
            }
            // 否则写入本地文件
            else if (data.filePath) {
                console.log('[WebDAV-Worker] handleFileWrite - Local write:', data.filePath);
                const dir = path.dirname(data.filePath);
                await fs.promises.mkdir(dir, { recursive: true });
                await fs.promises.writeFile(data.filePath, data.content, 'utf8');
                
                return {
                    id: '',
                    success: true,
                    data: { filePath: data.filePath }
                };
            } else {
                throw new Error('Either filePath or (accountId + remotePath) must be provided');
            }
        } catch (error: any) {
            console.error('[WebDAV-Worker] handleFileWrite error:', error);
            return {
                id: '',
                success: false,
                error: error.message || String(error)
            };
        }
    }

    private async handleFileList(data: { url?: string; username?: string; password?: string; dirPath: string }): Promise<SyncResponse> {
        try {
            let files: Array<{ path: string; mtime: number; size: number; type?: string }>;
            
            if (data.url && data.username && data.password) {
                // 处理远程WebDAV文件列表 - 使用专门的treeview方法
                this.webdavClient = createClient(data.url, {
                    username: data.username,
                    password: data.password
                });
                files = await this.walkRemoteForTreeView(data.dirPath);
            } else {
                // 处理本地文件列表
                files = await this.walkLocal(data.dirPath);
            }
            
            return {
                id: '',
                success: true,
                data: { files }
            };
        } catch (error) {
            return {
                id: '',
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    private async handleAccountLoad(data: { accountsPath: string }): Promise<SyncResponse> {
        try {
            const content = await fs.promises.readFile(data.accountsPath, 'utf8');
            const accounts = JSON.parse(content);
            return {
                id: '',
                success: true,
                data: { accounts }
            };
        } catch (error) {
            // 文件不存在或解析失败
            return {
                id: '',
                success: true,
                data: { accounts: [] }
            };
        }
    }

    private async handleAccountSave(data: { accountsPath: string; accounts: any[] }): Promise<SyncResponse> {
        const dir = path.dirname(data.accountsPath);
        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.writeFile(data.accountsPath, JSON.stringify(data.accounts, null, 2), 'utf8');
        return {
            id: '',
            success: true
        };
    }

    private async handleSetEncryptionKey(data: { key: string }): Promise<SyncResponse> {
        try {
            this.encryptionKey = data.key;
            return {
                id: '',
                success: true,
                data: { message: '加密密钥设置成功' }
            };
        } catch (error: any) {
            return {
                id: '',
                success: false,
                error: error.message
            };
        }
    }

    private async handleWebDAVFileRead(data: { 
        url: string; 
        username: string; 
        password: string; 
        remotePath: string 
    }): Promise<SyncResponse> {
        try {
            console.log('[SyncWorker] handleWebDAVFileRead 开始:', {
                url: data.url,
                username: data.username,
                remotePath: data.remotePath
            });
            
            // 验证和修正URL格式
            const correctedUrl = this.validateAndCorrectWebDAVUrl(data.url);
            console.log('[SyncWorker] URL修正后:', correctedUrl);
            
            // 使用静态导入的webdav模块
            const webdavClient = createClient(correctedUrl, {
                username: data.username,
                password: data.password
            });
            
            console.log('[SyncWorker] WebDAV客户端创建成功，准备读取文件:', data.remotePath);
            
            // 检查文件是否存在
            try {
                const stat = await webdavClient.stat(data.remotePath);
                console.log('[SyncWorker] 文件状态:', stat);
            } catch (statError) {
                console.error('[SyncWorker] 文件不存在或无法访问:', statError);
                throw new Error(`文件不存在或无法访问: ${data.remotePath}`);
            }
            
            // 读取远程文件内容
            const content = await webdavClient.getFileContents(data.remotePath);
            console.log('[SyncWorker] 文件内容读取成功，长度:', (content as Buffer).length);
            
            // 如果设置了加密密钥，对内容进行解密
            const finalContent = this.decryptContent(content as Buffer);
            console.log('[SyncWorker] 解密完成，最终内容长度:', finalContent.length);
            
            return {
                id: '',
                success: true,
                data: { content: finalContent.toString('utf8') }
            };
        } catch (error: any) {
            console.error('[SyncWorker] handleWebDAVFileRead 错误:', error);
            return {
                id: '',
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * 加密文件内容
     */
    private encryptContent(content: Buffer): Buffer {
        if (!this.encryptionKey) {
            return content; // 如果没有设置密钥，直接返回原内容
        }

        const iv = crypto.randomBytes(16);
        const key = crypto.scryptSync(this.encryptionKey, 'salt', 32);
        const cipher = crypto.createCipheriv(this.algorithm, key, iv);
        
        const encrypted = Buffer.concat([cipher.update(content), cipher.final()]);
        const authTag = cipher.getAuthTag();
        
        // 返回格式: IV(16字节) + 加密内容 + authTag(16字节)
        return Buffer.concat([iv, encrypted, authTag]);
    }

    /**
     * 解密文件内容
     */
    private decryptContent(encryptedContent: Buffer): Buffer {
        if (!this.encryptionKey) {
            return encryptedContent; // 如果没有设置密钥，直接返回原内容
        }

        try {
            // 检查内容长度是否足够 (IV + authTag + 至少1字节数据)
            if (encryptedContent.length < 33) {
                return encryptedContent; // 可能不是加密内容，直接返回
            }

            const iv = encryptedContent.slice(0, 16);
            const authTag = encryptedContent.slice(-16);
            const encrypted = encryptedContent.slice(16, -16);
            
            const key = crypto.scryptSync(this.encryptionKey, 'salt', 32);
            const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
            decipher.setAuthTag(authTag);
            
            const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
            return decrypted;
        } catch (error) {
            // 解密失败，可能不是加密内容或密钥错误，返回原内容
            return encryptedContent;
        }
    }

    /**
     * 检查并补充缺失的远端侧车文件
     */
    private async ensureMissingSidecarFiles(
        remoteFiles: Array<{ path: string; mtime: number; size: number }>,
        remoteBasePath: string,
        sidecarSuffix: string,
        metadataMap: SidecarDataMap
    ): Promise<void> {
        if (!this.webdavClient) {
            throw new Error('WebDAV client not initialized');
        }

        // 获取所有远端侧车文件的路径
        const remoteSidecarPaths = new Set<string>();
        const allRemoteFiles = await this.walkRemote(remoteBasePath);
        
        for (const file of allRemoteFiles) {
            if (file.path.endsWith(sidecarSuffix)) {
                // 从侧车文件路径推导出原文件路径
                const originalPath = file.path.slice(0, -sidecarSuffix.length);
                remoteSidecarPaths.add(originalPath);
            }
        }

        // 检查每个远端文件是否有对应的侧车文件
        for (const remoteFile of remoteFiles) {
            if (!remoteSidecarPaths.has(remoteFile.path)) {
                // 该远端文件缺少侧车文件，需要补充
                await this.createMissingSidecarFile(remoteFile.path, remoteBasePath, sidecarSuffix, metadataMap);
            }
        }
    }

    /**
     * 为缺失侧车文件的远端文件创建侧车数据
     */
    private async createMissingSidecarFile(
        remoteFilePath: string,
        remoteBasePath: string,
        sidecarSuffix: string,
        metadataMap: SidecarDataMap
    ): Promise<void> {
        if (!this.webdavClient) {
            throw new Error('WebDAV client not initialized');
        }

        try {
            // 构建侧车文件的远程路径
            const fullRemotePath = `${remoteBasePath}/${remoteFilePath}`.replace(/\/+/g, '/');
            const sidecarRemotePath = fullRemotePath + sidecarSuffix;

            // 检查metadataMap中是否有该文件的数据
            const sidecarData = metadataMap[remoteFilePath];
            
            let sidecarContent: any;
            
            if (sidecarData && isTrackedSidecarData(sidecarData)) {
                // 已追踪文件：使用完整的侧车数据
                sidecarContent = {
                    ...sidecarData,
                    syncedAt: new Date().toISOString(),
                    version: '1.0'
                };
            } else if (sidecarData && isUntrackedSidecarData(sidecarData)) {
                // 未追踪文件：使用完整的文件系统侧车数据
                sidecarContent = {
                    ...sidecarData,
                    syncedAt: new Date().toISOString(),
                    version: '1.0'
                };
            } else {
                // 没有侧车数据：创建最基础的侧车数据
                sidecarContent = {
                    filePath: remoteFilePath,
                    syncedAt: new Date().toISOString(),
                    version: '1.0',
                    isTracked: false,
                    note: 'File not tracked by file tracking system'
                };
            }

            // 上传侧车文件
            const sidecarBuffer = Buffer.from(JSON.stringify(sidecarContent, null, 2), 'utf-8');
            const encryptedContent = this.encryptContent(sidecarBuffer);
            
            await this.webdavClient.putFileContents(sidecarRemotePath, encryptedContent);
            
            console.log(`[SyncWorker] ✓ 已为远端文件 ${remoteFilePath} 补充侧车文件`);
            
        } catch (error) {
            console.warn(`[SyncWorker] ⚠ 为远端文件 ${remoteFilePath} 创建侧车文件失败:`, error);
            // 不抛出错误，避免影响主同步流程
        }
    }
}

const worker = new SyncWorker();

if (parentPort) {
    parentPort.on('message', async (message: SyncMessage) => {
        const response = await worker.handleMessage(message);
        parentPort!.postMessage(response);
    });
}

export { SyncWorker, SyncMessage, SyncResponse };