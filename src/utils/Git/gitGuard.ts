/* eslint-disable curly */
import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';

/** VS Code Git 扩展 API 的最小类型声明（避免引入外部依赖） */
type Change = { uri: vscode.Uri; status: number };
type Repository = {
    rootUri: vscode.Uri;
    state: {
        workingTreeChanges: Change[];
        indexChanges: Change[];
    };
    diffWithHEAD(path?: string): Thenable<string>;
    // 某些版本没有 diffIndexWith；做存在性检查再用
    diffIndexWith?(path: string): Thenable<string>;
};
type GitAPIv1 = {
    repositories: Repository[];
    getRepository(uri: vscode.Uri): Repository | null;
};

export type Baseline =
    | 'HEAD'      // 相对 HEAD 有改动才统计（默认）
    | 'INDEX'     // 相对索引（已 add 的内容）有改动才统计
    | 'WORKTREE'; // 仅看 workingTreeChanges/indexChanges 是否包含该文件（最快）

export interface GitGuardOptions {
    /** 统计判定基线，默认 'HEAD' */
    baseline?: Baseline;
    /**
     * 内容哈希去重开关。默认 true：同样内容不会重复统计
     * （即使 git 判定“有改动”，若内容与上次被统计时一致，也跳过）
     */
    contentHashDedupe?: boolean;
    /**
     * 限定语言/文件类型，比如 ['markdown','plaintext']。
     * 留空表示不限制（你可以在调用 shouldCount 时自筛）。
     */
    allowedLanguageIds?: string[];
    /**
     * 过滤函数：返回 true 表示应被忽略（不统计）。
     * 默认忽略 .git 和 node_modules。
     */
    ignore?: (uri: vscode.Uri) => boolean;
}

export class GitGuard {
    private gitApi: GitAPIv1 | undefined;
    private options: Required<GitGuardOptions>;
    private lastCountedHash = new Map<string, string>(); // key = fsPath lowercased

    constructor() {
        this.options = {
            baseline: 'HEAD',
            contentHashDedupe: true,
            allowedLanguageIds: [],
            ignore: this.defaultIgnore,
        };
    }

    private _log(msg: string) {
        // VS Code 扩展主机控制台可见：帮助 > 切换开发人员工具
        console.log(`[GitGuard] ${msg}`);
    }



    /** 必须在 activate 时调用一次 */
    async init(context: vscode.ExtensionContext, opts?: GitGuardOptions) {
        this.options = { ...this.options, ...(opts ?? {}) };

        // 尝试获取 VS Code Git 扩展
        const gitExt = vscode.extensions.getExtension('vscode.git');
        if (!gitExt) return;

        try {
            if (!gitExt.isActive) {
                this._log(`activating GitGuard`);
                await gitExt.activate();
            }
            // 只取 v1 API
            // @ts-ignore
            const api = gitExt.exports?.getAPI?.(1) as GitAPIv1 | undefined;
            this.gitApi = api;
        } catch {
            // 无 git 扩展或获取失败：保持 undefined，后续使用内容哈希兜底
        }
    }

    /** 在统计前调用；返回 true 才继续统计 */
    async shouldCount(doc: vscode.TextDocument | vscode.Uri, content?: string): Promise<boolean> {
        const uri = this.toUri(doc);
        const langId = this.getLangId(doc);
        this._log(`ISshouldCount?: ${uri.fsPath}`);

        if (this.options.allowedLanguageIds.length > 0 && langId) {
            if (!this.options.allowedLanguageIds.includes(langId)) return false;
        }


        if (this.options.ignore(uri)) return false;

        // 1) Git 基线判定
        const gitModified = await this.isModifiedByGit(uri);
        if (!gitModified) return false;

        // 2) 内容哈希去重（可选）
        if (this.options.contentHashDedupe) {
            const text = typeof content === 'string'
                ? content
                : await this.tryReadDocumentText(doc);

            if (text !== undefined) {
                const key = uri.fsPath.toLowerCase();
                const h = this.sha1(text);
                const last = this.lastCountedHash.get(key);
                if (last && last === h) {
                    return false; // 内容没变，跳过重复统计
                }
                this.lastCountedHash.set(key, h);
            }
        }

        return true;
    }

    private toRepoRelPath(repo: Repository, uri: vscode.Uri): string {
        const abs = path.normalize(uri.fsPath);
        const root = path.normalize(repo.rootUri.fsPath);
        let rel = path.relative(root, abs);
        // VS Code Git API 需要 POSIX 分隔符
        rel = rel.split(path.sep).join('/');
        return rel;
    }

    /** 手动标记“已统计”，用于非 shouldCount 流程 */
    markCounted(uri: vscode.Uri, content: string) {
        if (!this.options.contentHashDedupe) return;
        const key = uri.fsPath.toLowerCase();
        this.lastCountedHash.set(key, this.sha1(content));
    }

    dispose() {
        this.lastCountedHash.clear();
    }

    /**
     * 重置已记录的内容哈希；用于“强制重算”场景。
     * @param filePath 仅清除指定文件；未提供则清空全部。
     */
    reset(filePath?: string) {
        if (!filePath) {
            this.lastCountedHash.clear();
            return;
        }
        const key = filePath.toLowerCase();
        this.lastCountedHash.delete(key);
    }

    // ———————————————— 内部实现 ————————————————

    private toUri(doc: vscode.TextDocument | vscode.Uri): vscode.Uri {
        return (doc as vscode.TextDocument).uri ? (doc as vscode.TextDocument).uri : (doc as vscode.Uri);
    }

    private getLangId(doc: vscode.TextDocument | vscode.Uri): string | undefined {
        return (doc as vscode.TextDocument).languageId;
    }

    private async isModifiedByGit(uri: vscode.Uri): Promise<boolean> {
        const repo = this.getRepo(uri);
        if (!repo) {
            // 没有 Git API 或文件不在任何 repo：保守为 true
            this._log(`no repo → treat as modified: ${uri.fsPath}`);
            return true;
        }

        const rel = this.toRepoRelPath(repo, uri);

        // WORKTREE：仅看变更列表
        if (this.options.baseline === 'WORKTREE') {
            const inList = this.inChangeList(repo, uri);
            this._log(`WORKTREE ${inList ? 'MODIFIED' : 'clean'}: ${rel}`);
            return this.inChangeList(repo, uri);
        }

        // INDEX：优先 diffIndexWith（若存在）
        if (this.options.baseline === 'INDEX') {
            if (typeof repo.diffIndexWith === 'function') {
                try {
                    const diff = await repo.diffIndexWith(rel);
                    // ⬇️ 注意：空字符串也要回退
                    if (typeof diff === 'string' && diff.trim().length > 0) {
                        this._log(`INDEX MODIFIED by diff: ${rel}`);
                        return true;
                    }
                    return this.inChangeList(repo, uri);
                } catch {
                    return this.inChangeList(repo, uri);
                }
            } else {
                return this.inChangeList(repo, uri);
            }
        }

        // HEAD（默认）：优先 diffWithHEAD，空字符串亦回退
        try {
            const diff = await repo.diffWithHEAD(rel);
            if (typeof diff === 'string' && diff.trim().length > 0) {
                this._log(`HEAD MODIFIED by diff: ${rel}`);
                return true;
            }
            return this.inChangeList(repo, uri);
        } catch {
            return this.inChangeList(repo, uri);
        }
    }


    private inChangeList(repo: Repository, uri: vscode.Uri): boolean {
        const eq = (a: vscode.Uri, b: vscode.Uri) =>
            path.normalize(a.fsPath).toLowerCase() === path.normalize(b.fsPath).toLowerCase();

        const inWT = repo.state.workingTreeChanges.some(c => eq(c.uri, uri));
        const inIdx = repo.state.indexChanges.some(c => eq(c.uri, uri));
        return inWT || inIdx;
    }

    private getRepo(uri: vscode.Uri): Repository | undefined {
        if (!this.gitApi) return undefined;
        const repo = this.gitApi.getRepository(uri);
        if (repo) return repo;
        // 兜底：用 startsWith 匹配
        return this.gitApi.repositories.find(r =>
            uri.fsPath.toLowerCase().startsWith(r.rootUri.fsPath.toLowerCase())
        );
    }

    private sha1(input: string) {
        return crypto.createHash('sha1').update(input).digest('hex');
    }

    private async tryReadDocumentText(doc: vscode.TextDocument | vscode.Uri): Promise<string | undefined> {
        const d = (doc as vscode.TextDocument).getText ? (doc as vscode.TextDocument) : undefined;
        if (d) return d.getText();
        try {
            const read = await vscode.workspace.fs.readFile(this.toUri(doc));
            return Buffer.from(read).toString('utf8');
        } catch {
            return undefined;
        }
    }

    private defaultIgnore = (uri: vscode.Uri) => {
        const parts = uri.fsPath.split(path.sep).map(s => s.toLowerCase());
        if (parts.includes('.git')) return true;
        if (parts.includes('node_modules')) return true;
        // 也可以在这里屏蔽临时/备份/编译产物
        return false;
    };
    // 在 GitGuard 里新增一个方法（贴到 class GitGuard 内）
    public async shouldCountByGitOnly(doc: vscode.TextDocument | vscode.Uri): Promise<boolean> {
        const uri = this.toUri(doc);
        const langId = this.getLangId(doc);
        if (this.options.allowedLanguageIds.length > 0 && langId) {
            if (!this.options.allowedLanguageIds.includes(langId)) return false;
        }

        if (this.options.ignore(uri)) return false;
        return this.isModifiedByGit(uri);
    }

}
