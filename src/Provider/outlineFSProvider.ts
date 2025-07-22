import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * FileSystemProvider：把 andrea-outline://… 映射到真实磁盘上的大纲目录
 */
export class OutlineFSProvider implements vscode.FileSystemProvider {
    private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile = this._emitter.event;

    constructor(private outlineRoot: string) { }

    private toDiskPath(uri: vscode.Uri): string {
        // uri.path 形如 "/src/chapter1/foo_outline.md"
        const rel = uri.path.replace(/^\/+/, '');
        return path.join(this.outlineRoot, rel);
    }

    watch(): vscode.Disposable {
        // 不做增量 watch
        return new vscode.Disposable(() => { });
    }

    stat(uri: vscode.Uri): vscode.FileStat {
        const p = this.toDiskPath(uri);
        const s = fs.statSync(p);
        return {
            type: s.isDirectory()
                ? vscode.FileType.Directory
                : vscode.FileType.File,
            ctime: s.ctimeMs,
            mtime: s.mtimeMs,
            size: s.size
        };
    }

    readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
        const p = this.toDiskPath(uri);
        return fs.readdirSync(p, { withFileTypes: true }).map(e => [
            e.name,
            e.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File
        ]);
    }

    readFile(uri: vscode.Uri): Uint8Array {
        const p = this.toDiskPath(uri);
        return fs.readFileSync(p);
    }

    writeFile(
        uri: vscode.Uri,
        content: Uint8Array,
        options: { create: boolean; overwrite: boolean }
    ): void {
        const p = this.toDiskPath(uri);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, content);
        this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    }

    // 以下方法不允许外部调用
    rename(): void { throw vscode.FileSystemError.NoPermissions(); }
    delete(): void { throw vscode.FileSystemError.NoPermissions(); }
    createDirectory(): void { throw vscode.FileSystemError.NoPermissions(); }
}
