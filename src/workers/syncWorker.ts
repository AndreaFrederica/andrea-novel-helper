import { parentPort, workerData } from 'worker_threads';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { createClient, WebDAVClient } from 'webdav';

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

        const localFiles = await this.walkLocal(data.localPath, data.incremental ? data.lastSyncTime : undefined);
        const remoteFiles = await this.walkRemote(data.remotePath);

        const actions = this.calculateSyncActions(localFiles, remoteFiles, data.direction);
        const results = [];

        for (const action of actions) {
            try {
                const fullLocalPath = path.join(data.localPath, action.localPath);
                const fullRemotePath = path.posix.join(data.remotePath, action.remotePath);
                
                if (action.type === 'upload') {
                    await this.uploadFile(fullLocalPath, fullRemotePath);
                } else if (action.type === 'download') {
                    await this.downloadFile(fullRemotePath, fullLocalPath);
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

    private async walkLocal(dirPath: string, lastSyncTime?: number): Promise<Array<{ path: string; mtime: number; size: number }>> {
        const files: Array<{ path: string; mtime: number; size: number }> = [];
        
        const walk = async (currentPath: string) => {
            const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(currentPath, entry.name);
                
                // 跳过隐藏文件和系统文件，但保留重要配置文件
                const allowedHiddenFiles = ['.gitignore', '.vscode'];
                if (entry.name.startsWith('.') && !allowedHiddenFiles.includes(entry.name)) {
                    continue;
                }
                
                // 跳过特殊的应用程序文件（可选同步）
                const skipSpecialFiles = ['.anh-fsdb', 'node_modules', '.git', '.DS_Store', 'Thumbs.db'];
                if (skipSpecialFiles.some(pattern => entry.name === pattern || entry.name.endsWith(pattern))) {
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
                const entries = await this.webdavClient!.getDirectoryContents(currentPath);
                console.log('[SyncWorker] walkRemote 目录内容获取成功，条目数:', entries.length);
                
                for (const entry of entries) {
                    console.log('[SyncWorker] walkRemote 处理条目:', {
                        filename: entry.filename,
                        type: entry.type,
                        lastmod: entry.lastmod,
                        size: entry.size
                    });
                    
                    if (entry.type === 'directory') {
                        // 修复：使用entry.filename作为下一级目录路径进行递归
                        await walk(entry.filename, depth + 1);
                    } else {
                        // 正确计算相对路径，保持目录结构
                        let relativePath = entry.filename;
                        if (relativePath.startsWith(normalizedRemotePath)) {
                            relativePath = relativePath.substring(normalizedRemotePath.length);
                        } else if (relativePath.startsWith(remotePath)) {
                            relativePath = relativePath.substring(remotePath.length);
                            if (relativePath.startsWith('/')) {
                                relativePath = relativePath.substring(1);
                            }
                        }
                        
                        console.log('[SyncWorker] walkRemote 添加文件:', {
                            originalPath: entry.filename,
                            relativePath: relativePath,
                            mtime: new Date(entry.lastmod).getTime(),
                            size: entry.size || 0
                        });
                        
                        files.push({
                            path: relativePath,
                            mtime: new Date(entry.lastmod).getTime(),
                            size: entry.size || 0
                        });
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

    private calculateSyncActions(
        localFiles: Array<{ path: string; mtime: number; size: number }>,
        remoteFiles: Array<{ path: string; mtime: number; size: number }>,
        direction: 'upload' | 'download' | 'two-way'
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
            } else if (localFile.mtime > remoteFile.mtime) {
                // 本地更新，需要上传
                if (direction === 'upload' || direction === 'two-way') {
                    actions.push({
                        type: 'upload',
                        localPath: localFile.path,
                        remotePath: localFile.path
                    });
                }
            }
        }

        // 处理远程文件
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
            } else if (remoteFile.mtime > localFile.mtime) {
                // 远程更新，需要下载
                if (direction === 'download' || direction === 'two-way') {
                    actions.push({
                        type: 'download',
                        localPath: remoteFile.path,
                        remotePath: remoteFile.path
                    });
                }
            }
        }

        return actions;
    }

    private async uploadFile(localPath: string, remotePath: string): Promise<void> {
        if (!this.webdavClient) {
            throw new Error('WebDAV client not initialized');
        }

        try {
            // 确保文件的父目录存在
            const remoteDir = path.posix.dirname(remotePath);
            if (remoteDir !== '.' && remoteDir !== '/') {
                await this.ensureRemoteDirectory(remoteDir);
            }
            
            const content = await fs.promises.readFile(localPath);
            // 如果设置了加密密钥，对内容进行加密
            const finalContent = this.encryptContent(content);
            await this.webdavClient!.putFileContents(remotePath, finalContent);
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
            let files: Array<{ path: string; mtime: number; size: number }>;
            
            if (data.url && data.username && data.password) {
                // 处理远程WebDAV文件列表
                this.webdavClient = createClient(data.url, {
                    username: data.username,
                    password: data.password
                });
                files = await this.walkRemote(data.dirPath);
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
}

const worker = new SyncWorker();

if (parentPort) {
    parentPort.on('message', async (message: SyncMessage) => {
        const response = await worker.handleMessage(message);
        parentPort!.postMessage(response);
    });
}

export { SyncWorker, SyncMessage, SyncResponse };