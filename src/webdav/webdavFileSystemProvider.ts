import * as vscode from 'vscode';
import * as path from 'path';
import { WebDAVSyncService } from '../sync/webdavSync';
import { WebDAVAccountManager } from '../sync/accountManager';

export class WebDAVFileSystemProvider implements vscode.FileSystemProvider {
    private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    private syncService: WebDAVSyncService;
    private accountManager: WebDAVAccountManager;
    
    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

    constructor(context: vscode.ExtensionContext) {
        this.syncService = new WebDAVSyncService(context);
        this.accountManager = new WebDAVAccountManager(context);
    }

    watch(uri: vscode.Uri, options: { recursive: boolean; excludes: string[]; }): vscode.Disposable {
        // WebDAV文件系统不支持实时监听，返回空的Disposable
        return new vscode.Disposable(() => {});
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        const { accountId, remotePath } = this.parseUri(uri);
        
        try {
            // 如果是根路径，返回目录类型
            if (!remotePath || remotePath === '') {
                return {
                    type: vscode.FileType.Directory,
                    ctime: Date.now(),
                    mtime: Date.now(),
                    size: 0
                };
            }
            
            // 获取目录列表来判断文件类型和大小
            const parentPath = path.dirname(remotePath).replace(/\\/g, '/');
            const fileName = path.basename(remotePath);
            const files = await this.syncService.getDirectoryFileList(accountId, parentPath === '.' ? '' : parentPath);
            
            const fileInfo = files.find(f => f.filename === fileName);
            if (!fileInfo) {
                throw vscode.FileSystemError.FileNotFound(uri);
            }
            
            return {
                type: fileInfo.type === 'directory' ? vscode.FileType.Directory : vscode.FileType.File,
                ctime: fileInfo.lastmod ? new Date(fileInfo.lastmod).getTime() : Date.now(),
                mtime: fileInfo.lastmod ? new Date(fileInfo.lastmod).getTime() : Date.now(),
                size: fileInfo.size || 0
            };
        } catch (error) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }

    async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        const { accountId, remotePath } = this.parseUri(uri);
        
        try {
            const files = await this.syncService.getDirectoryFileList(accountId, remotePath);
            return files.map(file => [
                file.filename,
                file.type === 'directory' ? vscode.FileType.Directory : vscode.FileType.File
            ]);
        } catch (error) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }

    async createDirectory(uri: vscode.Uri): Promise<void> {
        const { accountId, remotePath } = this.parseUri(uri);
        
        try {
            await this.syncService.sendMessage('create-directory', {
                accountId,
                remotePath
            });
            
            this._emitter.fire([{
                type: vscode.FileChangeType.Created,
                uri
            }]);
        } catch (error) {
            throw vscode.FileSystemError.Unavailable(`创建目录失败: ${error}`);
        }
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        const { accountId, remotePath } = this.parseUri(uri);
        
        try {
            const content = await this.syncService.getFileContent(accountId, remotePath);
            return Buffer.from(content, 'utf8');
        } catch (error) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }

    async writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean; }): Promise<void> {
        const { accountId, remotePath } = this.parseUri(uri);
        
        try {
            const contentStr = Buffer.from(content).toString('utf8');
            await this.syncService.sendMessage('file-write', {
                accountId,
                remotePath,
                content: contentStr
            });
            
            this._emitter.fire([{
                type: options.create ? vscode.FileChangeType.Created : vscode.FileChangeType.Changed,
                uri
            }]);
        } catch (error) {
            throw vscode.FileSystemError.Unavailable(`写入文件失败: ${error}`);
        }
    }

    async delete(uri: vscode.Uri, options: { recursive: boolean; }): Promise<void> {
        const { accountId, remotePath } = this.parseUri(uri);
        
        try {
            await this.syncService.sendMessage('delete', {
                accountId,
                remotePath,
                recursive: options.recursive
            });
            
            this._emitter.fire([{
                type: vscode.FileChangeType.Deleted,
                uri
            }]);
        } catch (error) {
            throw vscode.FileSystemError.Unavailable(`删除失败: ${error}`);
        }
    }

    async rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean; }): Promise<void> {
        const { accountId: oldAccountId, remotePath: oldRemotePath } = this.parseUri(oldUri);
        const { accountId: newAccountId, remotePath: newRemotePath } = this.parseUri(newUri);
        
        if (oldAccountId !== newAccountId) {
            throw vscode.FileSystemError.NoPermissions('不支持跨账户重命名');
        }
        
        try {
            await this.syncService.sendMessage('rename', {
                accountId: oldAccountId,
                oldPath: oldRemotePath,
                newPath: newRemotePath,
                overwrite: options.overwrite
            });
            
            this._emitter.fire([
                {
                    type: vscode.FileChangeType.Deleted,
                    uri: oldUri
                },
                {
                    type: vscode.FileChangeType.Created,
                    uri: newUri
                }
            ]);
        } catch (error) {
            throw vscode.FileSystemError.Unavailable(`重命名失败: ${error}`);
        }
    }

    private parseUri(uri: vscode.Uri): { accountId: string; remotePath: string } {
        // URI格式: anh-webdav://accountId/remotePath
        const pathParts = uri.path.split('/').filter(p => p);
        if (pathParts.length === 0) {
            throw new Error('Invalid WebDAV URI');
        }
        
        const accountId = pathParts[0];
        const remotePath = pathParts.slice(1).join('/');
        
        return { accountId, remotePath };
    }
}