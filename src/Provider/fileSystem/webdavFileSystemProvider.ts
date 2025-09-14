import * as vscode from 'vscode';
import { WebDAVSyncService } from '../../sync/webdavSync';
import { WebDAVAccountManager } from '../../sync/accountManager';

export class WebDAVFileSystemProvider implements vscode.FileSystemProvider {
    private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    private _bufferedEvents: vscode.FileChangeEvent[] = [];
    private _fireSoonHandle?: NodeJS.Timeout;

    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

    private _syncService: WebDAVSyncService;
    private _accountManager: WebDAVAccountManager;

    constructor(context: vscode.ExtensionContext) {
        this._accountManager = new WebDAVAccountManager(context);
        this._syncService = new WebDAVSyncService(context);
    }

    // 监听文件变化
    watch(uri: vscode.Uri, options: { recursive: boolean; excludes: string[]; }): vscode.Disposable {
        // WebDAV文件系统不需要本地监听，返回空的Disposable
        return new vscode.Disposable(() => {});
    }

    // 获取文件统计信息
    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        console.log('[WebDAV-FileSystem] stat:', uri.toString());
        
        const { accountId, remotePath } = this._parseUri(uri);
        if (!accountId) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }

        try {
            // 首先尝试从父目录获取文件列表来查找目标文件
            const parentPath = remotePath.substring(0, remotePath.lastIndexOf('/')) || '/';
            const fileName = remotePath.substring(remotePath.lastIndexOf('/') + 1);
            
            console.log('[WebDAV-FileSystem] stat 解析路径:', { remotePath, parentPath, fileName });
            
            const files = await this._syncService.getDirectoryFileList(accountId, parentPath);
            console.log('[WebDAV-FileSystem] stat 获取到文件列表:', files.length, '个文件');
            
            // 在父目录中查找目标文件
            const targetFile = files.find(f => {
                const filePath = f.path;
                const fileBaseName = filePath.substring(filePath.lastIndexOf('/') + 1);
                console.log('[WebDAV-FileSystem] stat 比较文件:', { filePath, fileBaseName, targetFileName: fileName });
                return fileBaseName === fileName;
            });
            
            if (targetFile) {
                console.log('[WebDAV-FileSystem] stat 找到目标文件:', targetFile);
                return {
                    type: (targetFile.type === 'directory' || targetFile.isDirectory) ? vscode.FileType.Directory : vscode.FileType.File,
                    ctime: targetFile.lastModified?.getTime() || Date.now(),
                    mtime: targetFile.lastModified?.getTime() || Date.now(),
                    size: targetFile.size || 0
                };
            }
            
            // 如果在父目录中没找到，可能目标本身就是一个目录
            try {
                console.log('[WebDAV-FileSystem] stat 尝试作为目录获取:', remotePath);
                const dirFiles = await this._syncService.getDirectoryFileList(accountId, remotePath);
                // 如果能成功获取目录内容，说明这是一个目录
                return {
                    type: vscode.FileType.Directory,
                    ctime: Date.now(),
                    mtime: Date.now(),
                    size: 0
                };
            } catch (dirError) {
                console.log('[WebDAV-FileSystem] stat 作为目录获取失败:', dirError);
            }
            
            console.error('[WebDAV-FileSystem] stat 文件未找到:', remotePath);
            throw vscode.FileSystemError.FileNotFound(uri);
        } catch (error) {
            console.error('[WebDAV-FileSystem] stat error:', error);
            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }

    // 读取目录
    async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        console.log('[WebDAV-FileSystem] readDirectory:', uri.toString());
        
        const { accountId, remotePath } = this._parseUri(uri);
        if (!accountId) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }

        try {
            const files = await this._syncService.getDirectoryFileList(accountId, remotePath);
            const result: [string, vscode.FileType][] = [];
            
            // 获取直接子项
            const normalizedPath = remotePath.endsWith('/') ? remotePath : remotePath + '/';
            const pathDepth = remotePath === '/' || remotePath === '' ? 0 : remotePath.split('/').filter(p => p.length > 0).length;
            
            for (const file of files) {
                if (!file.path || file.path === remotePath) continue;
                
                let relativePath = file.path;
                if (remotePath && remotePath !== '/') {
                    const pathToMatch = remotePath.startsWith('/') ? remotePath : '/' + remotePath;
                    if (file.path.startsWith(pathToMatch + '/')) {
                        relativePath = file.path.substring(pathToMatch.length + 1);
                    } else if (file.path.startsWith(pathToMatch) && file.path.length > pathToMatch.length) {
                        relativePath = file.path.substring(pathToMatch.length);
                        if (relativePath.startsWith('/')) {
                            relativePath = relativePath.substring(1);
                        }
                    }
                }
                
                const pathParts = relativePath.split('/').filter((p: string) => p.length > 0);
                if (pathParts.length === 1) {
                    // 直接子项
                    const name = pathParts[0];
                    const type = (file.type === 'directory' || file.isDirectory) ? vscode.FileType.Directory : vscode.FileType.File;
                    result.push([name, type]);
                } else if (pathParts.length > 1) {
                    // 子目录中的文件，添加子目录
                    const dirName = pathParts[0];
                    if (!result.find(([n]) => n === dirName)) {
                        result.push([dirName, vscode.FileType.Directory]);
                    }
                }
            }
            
            return result;
        } catch (error) {
            console.error('[WebDAV-FileSystem] readDirectory error:', error);
            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }

    // 创建目录
    async createDirectory(uri: vscode.Uri): Promise<void> {
        console.log('[WebDAV-FileSystem] createDirectory:', uri.toString());
        
        const { accountId, remotePath } = this._parseUri(uri);
        if (!accountId) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }

        try {
            await this._syncService.sendMessage('create-directory', {
                accountId,
                dirPath: remotePath
            });
            this._fireSoon({ type: vscode.FileChangeType.Created, uri });
        } catch (error) {
            console.error('[WebDAV-FileSystem] createDirectory error:', error);
            throw vscode.FileSystemError.Unavailable(uri);
        }
    }

    // 读取文件
    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        console.log('[WebDAV-FileSystem] readFile:', uri.toString());
        
        const { accountId, remotePath } = this._parseUri(uri);
        if (!accountId) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }

        try {
            const content = await this._syncService.getFileContent(accountId, remotePath);
            return new TextEncoder().encode(content);
        } catch (error) {
            console.error('[WebDAV-FileSystem] readFile error:', error);
            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }

    // 写入文件
    async writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean; }): Promise<void> {
        console.log('[WebDAV-FileSystem] writeFile:', uri.toString());
        
        const { accountId, remotePath } = this._parseUri(uri);
        if (!accountId) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }

        try {
            // 获取WebDAV账户信息
            const accounts = await this._accountManager.getAccounts();
            const account = accounts.find(acc => acc.id === accountId);
            if (!account) {
                throw new Error(`WebDAV account not found: ${accountId}`);
            }

            // 获取账户密码
            const password = await this._accountManager.getPassword(accountId);
            if (!password) {
                throw new Error(`WebDAV account password not found: ${accountId}`);
            }

            const textContent = new TextDecoder().decode(content);
            await this._syncService.sendMessage('file-write', {
                accountId,
                remotePath,
                content: textContent,
                url: account.url,
                username: account.username,
                password: password
            });
            this._fireSoon({ type: vscode.FileChangeType.Changed, uri });
        } catch (error) {
            console.error('[WebDAV-FileSystem] writeFile error:', error);
            throw vscode.FileSystemError.Unavailable(uri);
        }
    }

    // 删除文件或目录
    async delete(uri: vscode.Uri, options: { recursive: boolean; }): Promise<void> {
        console.log('[WebDAV-FileSystem] delete:', uri.toString());
        
        const { accountId, remotePath } = this._parseUri(uri);
        if (!accountId) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }

        try {
            await this._syncService.sendMessage('delete', {
                accountId,
                path: remotePath
            });
            this._fireSoon({ type: vscode.FileChangeType.Deleted, uri });
        } catch (error) {
            console.error('[WebDAV-FileSystem] delete error:', error);
            throw vscode.FileSystemError.Unavailable(uri);
        }
    }

    // 重命名文件或目录
    async rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean; }): Promise<void> {
        console.log('[WebDAV-FileSystem] rename:', oldUri.toString(), '->', newUri.toString());
        
        const { accountId: oldAccountId, remotePath: oldPath } = this._parseUri(oldUri);
        const { accountId: newAccountId, remotePath: newPath } = this._parseUri(newUri);
        
        if (!oldAccountId || !newAccountId || oldAccountId !== newAccountId) {
            throw vscode.FileSystemError.Unavailable(oldUri);
        }

        try {
            await this._syncService.sendMessage('rename', {
                accountId: oldAccountId,
                oldPath,
                newPath
            });
            this._fireSoon(
                { type: vscode.FileChangeType.Deleted, uri: oldUri },
                { type: vscode.FileChangeType.Created, uri: newUri }
            );
        } catch (error) {
            console.error('[WebDAV-FileSystem] rename error:', error);
            throw vscode.FileSystemError.Unavailable(oldUri);
        }
    }

    // 解析URI获取账户ID和远程路径
    private _parseUri(uri: vscode.Uri): { accountId: string | null; remotePath: string } {
        // URI格式: anh-webdav://accountId/path/to/file
        // uri.authority 包含 accountId
        // uri.path 包含 /path/to/file
        const accountId = uri.authority;
        const remotePath = uri.path || '/';
        
        if (!accountId) {
            return { accountId: null, remotePath: '/' };
        }
        
        return { accountId, remotePath };
    }

    // 触发文件变化事件
    private _fireSoon(...events: vscode.FileChangeEvent[]): void {
        this._bufferedEvents.push(...events);

        if (this._fireSoonHandle) {
            clearTimeout(this._fireSoonHandle);
        }

        this._fireSoonHandle = setTimeout(() => {
            this._emitter.fire(this._bufferedEvents);
            this._bufferedEvents.length = 0;
        }, 5);
    }
}