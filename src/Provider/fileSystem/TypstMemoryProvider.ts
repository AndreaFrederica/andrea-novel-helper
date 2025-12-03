/* eslint-disable curly */
/* eslint-disable semi */
import * as vscode from 'vscode';
import * as path from 'path';
import { Volume, createFsFromVolume } from 'memfs';

/**
 * Typst内存盘文件系统提供器
 * 基于memfs实现，允许VSCode Typst插件通过andrea-typst://协议
 * 实时访问生成的Typst文档，支持实时预览
 */
export class TypstMemoryProvider implements vscode.FileSystemProvider {
    private vol = new Volume();
    private memfs = createFsFromVolume(this.vol);
    private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile = this._emitter.event;

    // 保存当前编辑的文档映射
    private documentMap: Map<string, { uri: vscode.Uri; content: Buffer }> = new Map();

    constructor() {
        this.vol.mkdirSync('/', { recursive: true });
        this.vol.mkdirSync('/typst', { recursive: true });
    }

    /**
     * 将本地文档URI映射到内存盘，返回内存访问URI
     * 例如: doc.md -> andrea-typst://typst/current/doc.typ
     */
    public mapDocumentToMemory(docUri: vscode.Uri, content: string): vscode.Uri {
        const docName = path.basename(docUri.fsPath).replace(/\.[^.]+$/, '');
        const memPath = `/typst/current/${docName}.typ`;
        const buf = Buffer.from(content, 'utf8');
        
        // 确保目录存在
        try {
            this.memfs.mkdirSync('/typst/current', { recursive: true });
        } catch {
            // 目录可能已存在，忽略错误
        }
        
        this.memfs.writeFileSync(memPath, buf);
        this.documentMap.set(memPath, { uri: docUri, content: buf });
        
        // 触发文件变更事件
        const memUri = vscode.Uri.parse(`andrea-typst://${memPath}`);
        this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri: memUri }]);
        
        return memUri;
    }

    /**
     * 获取当前编辑文档的内存盘URI
     */
    public getCurrentMemoryUri(docUri?: vscode.Uri): vscode.Uri | undefined {
        const source = docUri || vscode.window.activeTextEditor?.document.uri;
        if (!source) return undefined;

        const docName = path.basename(source.fsPath).replace(/\.[^.]+$/, '');
        const memPath = `/typst/current/${docName}.typ`;
        
        if (this.documentMap.has(memPath)) {
            return vscode.Uri.parse(`andrea-typst://${memPath}`);
        }
        return undefined;
    }

    /**
     * 更新内存盘中的Typst文档内容
     */
    public updateMemoryContent(memPath: string, content: string): void {
        try {
            const buf = Buffer.from(content, 'utf8');
            this.memfs.writeFileSync(memPath, buf);
            this.documentMap.set(memPath, { uri: vscode.Uri.file(''), content: buf });
            
            // 触发文件变更事件以刷新预览
            const memUri = vscode.Uri.parse(`andrea-typst://${memPath}`);
            this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri: memUri }]);
        } catch (err) {
            console.error(`[TypstMemoryProvider] Failed to update ${memPath}:`, err);
        }
    }

    /**
     * 清空所有内存中的文档
     */
    public clearAll(): void {
        try {
            this.vol = new Volume();
            this.memfs = createFsFromVolume(this.vol);
            this.vol.mkdirSync('/', { recursive: true });
            this.vol.mkdirSync('/typst', { recursive: true });
            this.documentMap.clear();
        } catch (err) {
            console.error('[TypstMemoryProvider] Failed to clear all:', err);
        }
    }

    // FileSystemProvider 接口实现

    watch(): vscode.Disposable {
        return new vscode.Disposable(() => {});
    }

    stat(uri: vscode.Uri): vscode.FileStat {
        try {
            const p = decodeURIComponent(uri.path);
            const s = this.memfs.statSync(p);
            return {
                type: s.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File,
                ctime: s.ctimeMs,
                mtime: s.mtimeMs,
                size: s.size
            };
        } catch (err) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }

    readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
        try {
            const p = decodeURIComponent(uri.path) || '/';
            return (this.memfs.readdirSync(p, { withFileTypes: true }) as any[])
                .map(e => [e.name, e.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File]);
        } catch (err) {
            return [];
        }
    }

    readFile(uri: vscode.Uri): Uint8Array {
        try {
            const p = decodeURIComponent(uri.path);
            return this.memfs.readFileSync(p) as Uint8Array;
        } catch (err) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }

    writeFile(uri: vscode.Uri, content: Uint8Array): void {
        try {
            const p = decodeURIComponent(uri.path);
            this.memfs.writeFileSync(p, content);
            this.documentMap.set(p, { uri, content: Buffer.from(content) });
            this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
        } catch (err) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }

    rename(): void {
        throw vscode.FileSystemError.NoPermissions();
    }

    delete(): void {
        throw vscode.FileSystemError.NoPermissions();
    }

    createDirectory(): void {
        throw vscode.FileSystemError.NoPermissions();
    }
}
