import * as vscode from 'vscode';
import * as path from 'path';
import { Volume, createFsFromVolume } from 'memfs';
import * as realFs from 'fs';
import { dir_outline_url, file_outline_url } from '../../activate';

/**
 * 基于 memfs 的内存盘 FileSystemProvider
 */
export class MemoryOutlineFSProvider implements vscode.FileSystemProvider {
    private vol = new Volume();
    private memfs = createFsFromVolume(this.vol);
    private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile = this._emitter.event;

    // 保存最新的 rel
    private lastFolderRel: string | undefined;
    private lastFileRel: string | undefined;

    constructor(private outlineRoot: string) {
        this.vol.mkdirSync('/', { recursive: true });
        // 先创建空包装内容
        this.memfs.writeFileSync('/current_dir_outline.md', '# 文件夹大纲');
        this.memfs.writeFileSync('/current_file_outline.md', '# 当前文件大纲');
    }

    /** 根据 alias 或 lastRel 计算内存盘路径 */
    private toMemPath(uri: vscode.Uri): string {
        const decodedPath = decodeURIComponent(uri.path);
        console.log(`[MemoryOutlineFSProvider] 处理路径：${decodedPath}`);
        if (['/目录大纲.md', '/outline_dir.md'].includes(decodedPath)) {
            console.log(`[MemoryOutlineFSProvider] 使用内存盘路径：/current_dir_outline.md`);
            return '/current_dir_outline.md';
        }
        if (['/文件大纲.md', '/outline_file.md'].includes(decodedPath)) {
            console.log(`[MemoryOutlineFSProvider] 使用内存盘路径：/current_file_outline.md`);
            return '/current_file_outline.md';
        }
        return decodedPath;
    }


    watch(): vscode.Disposable { return new vscode.Disposable(() => { }); }

    stat(uri: vscode.Uri): vscode.FileStat {
        const p = this.toMemPath(uri);
        const s = this.memfs.statSync(p);
        return {
            type: s.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File,
            ctime: s.ctimeMs, mtime: s.mtimeMs, size: s.size
        };
    }

    readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
        // 根目录下展示包装文件目录
        if (uri.path === '/') {
            return [
                ['current_dir_outline.md', vscode.FileType.File],
                ['current_file_outline.md', vscode.FileType.File]
            ];
        }
        return [];
    }

    readFile(uri: vscode.Uri): Uint8Array {
        const p = this.toMemPath(uri);
        return this.memfs.readFileSync(p) as Uint8Array;
    }

    writeFile(uri: vscode.Uri, content: Uint8Array): void {
        const p = this.toMemPath(uri);
        // 写入内存
        this.memfs.writeFileSync(p, content);
        // 同步到磁盘
        const rel = uri.path === '/outline_dir'
            ? this.lastFolderRel!
            : this.lastFileRel!;
        const disk = path.join(this.outlineRoot, rel);
        realFs.mkdirSync(path.dirname(disk), { recursive: true });
        realFs.writeFileSync(disk, content);
        this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    }

    /** 外部调用：设置最新 rel，并刷新 */
    public refreshByTraditionalRel(relPath: string): void {
        const diskPath = path.join(this.outlineRoot, relPath);

        if (!realFs.existsSync(diskPath)) {
            console.warn(`[MemoryOutlineFSProvider] File not found: ${diskPath}`);
            return;
        }

        const content = realFs.readFileSync(diskPath);
        let memPath: string;
        let uri: vscode.Uri;

        if (relPath.endsWith('_dir_outline.md')) {
            this.lastFolderRel = relPath;
            memPath = '/current_dir_outline.md';
            uri = vscode.Uri.parse(dir_outline_url);
        } else if (relPath.endsWith('_outline.md')) {
            this.lastFileRel = relPath;
            memPath = '/current_file_outline.md';
            uri = vscode.Uri.parse(file_outline_url);
        } else {
            console.warn(`[MemoryOutlineFSProvider] Unexpected relPath: ${relPath}`);
            return;
        }

        this.memfs.writeFileSync(memPath, content);
        this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    }



    public refreshDir(): void { this.refreshByTraditionalRel(this.lastFolderRel!); }
    public refreshFile(): void { this.refreshByTraditionalRel(this.lastFileRel!); }

    public getCurrentFolderOutlineFsPath(): string | undefined {
        return this.lastFolderRel ? path.join(this.outlineRoot, this.lastFolderRel) : undefined;
    }

    public getCurrentFileOutlineFsPath(): string | undefined {
        return this.lastFileRel ? path.join(this.outlineRoot, this.lastFileRel) : undefined;
    }

    public getSourceFileFsPath(): string | undefined {
        if (!this.lastFileRel) { return undefined; }
        const without = this.lastFileRel.slice(0, -'_outline.md'.length);
        return path.join(vscode.workspace.workspaceFolders![0].uri.fsPath, `${without}.md`);
    }

    rename(): void { throw vscode.FileSystemError.NoPermissions(); }
    delete(): void { throw vscode.FileSystemError.NoPermissions(); }
    createDirectory(): void { throw vscode.FileSystemError.NoPermissions(); }
}
