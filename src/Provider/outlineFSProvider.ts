// src/providers/outlineFsProvider.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class OutlineFSProvider implements vscode.FileSystemProvider {
    private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile = this._emitter.event;

    // 新增：保存最后收到的两条 rel
    private lastFolderRel: string | undefined;
    private lastFileRel: string | undefined;

    constructor(private outlineRoot: string) { }

    /** 
     * 计算磁盘路径，支持别名 /outline_dir 和 /outline_file
     * 会优先用 lastFolderRel/lastFileRel，再 fallback 到 uri.path 
     */
    private toDiskPath(uri: vscode.Uri): string {
        // 别名处理
        if (uri.path === '/outline_dir') {
            if (this.lastFolderRel) {
                return path.join(this.outlineRoot, this.lastFolderRel);
            }
        }
        if (uri.path === '/outline_file') {
            if (this.lastFileRel) {
                return path.join(this.outlineRoot, this.lastFileRel);
            }
        }

        // 默认映射：直接把 path（去掉前导 /）拼到 outlineRoot
        const rel = uri.path.replace(/^\/+/, '');
        return path.join(this.outlineRoot, rel);
    }

    watch(): vscode.Disposable {
        return new vscode.Disposable(() => { });
    }

    stat(uri: vscode.Uri): vscode.FileStat {
        const p = this.toDiskPath(uri);
        const s = fs.statSync(p);
        return {
            type: s.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File,
            ctime: s.ctimeMs,
            mtime: s.mtimeMs,
            size: s.size
        };
    }

    readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
        const p = this.toDiskPath(uri);
        return fs.readdirSync(p, { withFileTypes: true })
            .map(e => [e.name, e.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File]);
    }

    readFile(uri: vscode.Uri): Uint8Array {
        const p = this.toDiskPath(uri);
        return fs.readFileSync(p);
    }

    writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean, overwrite: boolean }): void {
        const p = this.toDiskPath(uri);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, content);
        this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    }

    /** 外部调用：根据传统 relPath 记录并刷新对应 alias */
    public refreshByTraditionalRel(relPath: string): void {
        if (relPath.endsWith('_dir_outline.md')) {
            this.lastFolderRel = relPath;
            const alias = vscode.Uri.parse('andrea-outline://outline/outline_dir');
            this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri: alias }]);
        }
        else if (relPath.endsWith('_outline.md')) {
            this.lastFileRel = relPath;
            const alias = vscode.Uri.parse('andrea-outline://outline/outline_file');
            this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri: alias }]);
        }
        // 否则忽略
    }

    // 若你还想提供单独的 refreshDir/refreshFile，也可以调用上面的 rel 触发：
    public refreshDir(): void { this.refreshByTraditionalRel(this.lastFolderRel!); }
    public refreshFile(): void { this.refreshByTraditionalRel(this.lastFileRel!); }

    /**
 * 返回当前 “文件夹大纲” 在磁盘上的真实路径，
 * 如果 lastFolderRel 可用就用它，否则根据 active editor 计算。
 */
    public getCurrentFolderOutlineFsPath(): string | undefined {
        // 优先用上次记录的
        if (this.lastFolderRel) {
            return path.join(this.outlineRoot, this.lastFolderRel);
        }
        // 回退到根据 activeTextEditor 计算
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.uri.scheme !== 'file') {
            return undefined;
        }
        const wsFolders = vscode.workspace.workspaceFolders;
        if (!wsFolders?.length) {
            return undefined;
        }
        const wsRoot = wsFolders[0].uri.fsPath;
        const rel = path.relative(wsRoot, editor.document.uri.fsPath);
        const parts = rel.split(path.sep);
        const dirParts = parts.slice(0, -1);
        const folderKey = dirParts.length
            ? dirParts[dirParts.length - 1]
            : 'root';
        const outlineDirRel = dirParts.join('/');
        const folderOutlineRel = outlineDirRel
            ? `${outlineDirRel}/${folderKey}_dir_outline.md`
            : `root_dir_outline.md`;
        return path.join(this.outlineRoot, folderOutlineRel);
    }

    /**
     * 返回当前 “文件大纲” 在磁盘上的真实路径，
     * 如果 lastFileRel 可用就用它，否则根据 active editor 计算。
     */
    public getCurrentFileOutlineFsPath(): string | undefined {
        if (this.lastFileRel) {
            return path.join(this.outlineRoot, this.lastFileRel);
        }
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.uri.scheme !== 'file') {
            return undefined;
        }
        const wsFolders = vscode.workspace.workspaceFolders;
        if (!wsFolders?.length) {
            return undefined;
        }
        const wsRoot = wsFolders[0].uri.fsPath;
        const rel = path.relative(wsRoot, editor.document.uri.fsPath);
        const parts = rel.split(path.sep);
        const fileBase = path.basename(parts.pop()!, '.md');
        const outlineDirRel = parts.join('/');
        const fileOutlineRel = outlineDirRel
            ? `${outlineDirRel}/${fileBase}_outline.md`
            : `${fileBase}_outline.md`;
        return path.join(this.outlineRoot, fileOutlineRel);
    }

    /**
 * 根据内部记录的 lastFileRel（如 "foo/bar_outline.md"）
 * 返回工作区里对应的源 .md 文件的绝对文件系统路径，
 * 如果找不到就返回 undefined。
 */
    public getSourceFileFsPath(): string | undefined {
        // 1. 必须先有一次 refreshByTraditionalRel 调用过，才能有 lastFileRel
        if (!this.lastFileRel) {
            return undefined;
        }

        // 2. 去掉 "_outline.md" 后缀，拼回 ".md"
        const withoutSuffix = this.lastFileRel.slice(0, -'_outline.md'.length);
        const sourceRel = `${withoutSuffix}.md`;  // e.g. "foo/bar.md"

        // 3. 拿到工作区根
        const wsFolders = vscode.workspace.workspaceFolders;
        if (!wsFolders?.length) {
            return undefined;
        }
        const wsRoot = wsFolders[0].uri.fsPath;

        // 4. 返回绝对路径
        return path.join(wsRoot, sourceRel);
    }

    // 不支持的操作一律报错
    rename(): void { throw vscode.FileSystemError.NoPermissions(); }
    delete(): void { throw vscode.FileSystemError.NoPermissions(); }
    createDirectory(): void { throw vscode.FileSystemError.NoPermissions(); }
}
