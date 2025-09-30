/* eslint-disable curly */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getSupportedExtensions, mergeStats, TextStats } from '../../utils/utils';
import { countAndAnalyzeOffThread } from '../../utils/WordCount/asyncWordCounter';
import { CombinedIgnoreParser } from '../../utils/Parser/gitignoreParser';
import { isFileIgnored, IgnoreConfig } from '../../utils/ignoreUtils';
import { sortItems } from '../../utils/Order/sorter';
import { GitGuard } from '../../utils/Git/gitGuard';
import { getFileTracker } from '../../utils/tracker/fileTracker';
import * as timeStatsModule from '../../timeStats';
import { mdToPlainText } from '../../utils/md_plain';
import { getFileByPath, updateFileWritingStats, getFileUuid, registerFileChangeCallback, unregisterFileChangeCallback, FileChangeEvent } from '../../utils/tracker/globalFileTracking';
import { getCutClipboard } from '../../utils/WordCount/wordCountCutHelper';
import { WordCountOrderManager } from '../../utils/Order/wordCountOrder';

// 特殊文件（无扩展名但需要显示）
function isSpecialVisibleFile(name: string): boolean {
    return name === '.gitignore' || name === '.wcignore';
}

// 获取完整的允许文件扩展名列表（支持文件 + 参考文件）
function getAllowedExtensions(): string[] {
    const supportedExts = getSupportedExtensions();
    const refExts = (vscode.workspace.getConfiguration('AndreaNovelHelper')
        .get<string[]>('wordCount.referenceVisibleExtensions', []) || [])
        .map(s => (s || '').toLowerCase());
    return [...supportedExts, ...refExts];
}

// 统一忽略判断工具
function shouldIgnoreWordCountFile(fullPath: string, ignoreParser: CombinedIgnoreParser | null, config: { workspaceRoot: string, respectWcignore: boolean, respectGitignore?: boolean, includePatterns?: string[], excludePatterns?: string[], allowedLanguages?: string[] }) {
    return isFileIgnored(fullPath, {
        workspaceRoot: config.workspaceRoot,
        respectWcignore: config.respectWcignore,
        respectGitignore: config.respectGitignore,
        includePatterns: config.includePatterns,
        excludePatterns: config.excludePatterns,
        allowedLanguages: config.allowedLanguages,
        ignoreParser
    });
}

// —— 调试工具 ——
function wcDebugEnabled(): boolean {
    try {
        return vscode.workspace.getConfiguration('AndreaNovelHelper').get<boolean>('wordCount.debug', false) ?? false;
    } catch { return false; }
}
function wcDebug(...args: any[]) {
    if (wcDebugEnabled()) {
        try { console.warn('[WordCount][debug]', ...args); } catch { /* ignore */ }
    }
}

// 新建文章/文件夹的特殊节点
class NewItemNode extends vscode.TreeItem {
    constructor(public readonly baseDir: string, public readonly nodeType: 'newFile' | 'newFolder') {
        super(`+ 新建${nodeType === 'newFile' ? '文章' : '文件夹'}`, vscode.TreeItemCollapsibleState.None);

        this.resourceUri = vscode.Uri.file(baseDir);
        this.contextValue = nodeType === 'newFile' ? 'wordCountNewFile' : 'wordCountNewFolder';
        this.iconPath = new vscode.ThemeIcon(nodeType === 'newFile' ? 'file-add' : 'folder-add');
        this.description = nodeType === 'newFile' ? '创建新的 Markdown 或文本文件' : '创建新的文件夹';

        // 点击直接触发创建命令
        this.command = {
            command: nodeType === 'newFile' ? 'AndreaNovelHelper.wordCount.createNewFile' : 'AndreaNovelHelper.wordCount.createNewFolder',
            title: nodeType === 'newFile' ? '新建文章' : '新建文件夹',
            arguments: [this]
        };

        this.id = `${baseDir}/__${nodeType}__`;
    }
}

export class WordCountProvider implements vscode.TreeDataProvider<WordCountItem | NewItemNode> {
    private _onDidChange = new vscode.EventEmitter<WordCountItem | NewItemNode | undefined>();
    readonly onDidChangeTreeData = this._onDidChange.event;
    private itemsById = new Map<string, WordCountItem | NewItemNode>();

    // 缓存机制
    private statsCache = new Map<string, { stats: TextStats; mtime: number; size?: number }>();
    // 目录临时聚合缓存（仅内存，含时间戳；文件/目录变化、强制重算或 TTL 过期时失效）
    private dirAggCache = new Map<string, { stats: TextStats; ts: number }>();
    // 目录旧值缓存：当聚合被失效删除时暂存旧值供 UI 显示，直到新值计算完成
    private previousDirAggCache = new Map<string, { stats: TextStats; ts: number }>();
    // 格式化缓存年龄
    private formatCacheAge(ms: number): string {
        if (ms < 1000) return '<1s';
        if (ms < 60_000) return (ms / 1000).toFixed(ms < 5000 ? 1 : 0) + 's';
        const m = Math.floor(ms / 60000); const s = Math.floor((ms % 60000) / 1000);
        return `${m}m${s > 0 ? s + 's' : ''}`;
    }
    // 目录聚合进行中的 Promise，用于并发去重
    private inFlightDirAgg = new Map<string, Promise<TextStats>>();
    // 事件驱动目录重算：子目录完成后向父目录发送链式信号
    private dirRecalcQueue: string[] = [];
    private dirRecalcQueued = new Set<string>();
    private dirRecalcProcessing = false;
    private isInitializing = false;
    private pendingRefresh = false;
    private refreshThrottleTimer: NodeJS.Timeout | null = null;
    private ignoreParser: CombinedIgnoreParser | null = null;

    // 大文件异步精确统计支持
    private largeApproxPending = new Set<string>(); // 仍为估算结果等待精确统计
    private largeProcessingQueue: string[] = []; // 等待后台处理队列
    private largeProcessingRunning = false; // 是否在运行队列

    // Git Guard 用于缓存优化
    public gitGuard: GitGuard;
    private orderManager: WordCountOrderManager | null = null;
    // 强制重算列表：包含后一次访问时无条件重新计算并跳过持久化缓存
    private forcedPaths = new Set<string>();
    // 额外注册重算的文件完整路径列表，便于比对和调试
    public recountRegisteredFiles: string[] = [];

    // 状态持久化
    private expandedNodes = new Set<string>();
    private memento: vscode.Memento;
    private hasGitRepo = false;            // 是否存在 Git 仓库 (.git)
    private cacheTrusted = false;          // 仅在有 Git 时才认为缓存可信
    private verifying = new Set<string>(); // 正在校验的文件，避免并发重复

    // 新增：在类里加一个去重用的集合
    private inFlightFileStats = new Set<string>();


    constructor(memento: vscode.Memento, orderManager?: WordCountOrderManager) {
        this.memento = memento;
        this.gitGuard = new GitGuard();
        this.orderManager = orderManager ?? null;

        // 从工作区状态恢复展开状态
        const savedState = this.memento.get<string[]>('wordCountExpandedNodes', []);
        this.expandedNodes = new Set(savedState);

        // 初始化 GitGuard
        this.initializeGitGuard();

        // 注册全局文件追踪回调
        registerFileChangeCallback('wordCount', (event: FileChangeEvent) => {
            this.handleFileChange(event);
        });

        vscode.workspace.onDidSaveTextDocument((doc) => {
            const fsPath = doc.uri.fsPath;
            const fileName = path.basename(fsPath);

            // 1) 忽略文件变化：轻操作 + 立即刷新
            if (fileName === '.gitignore' || fileName === '.wcignore') {
                this.refreshIgnoreParser(); // 内部: initIgnoreParser + clearCache + refresh
                return;
            }

            // 2) 非跟踪类型直接忽略
            const ext = path.extname(fileName).slice(1).toLowerCase();
            if (!isSpecialVisibleFile(fileName) && !getSupportedExtensions().includes(ext)) return;

            // 3) 只做轻操作（标脏、占位、触发链）
            this.invalidateCache(fsPath);
            const parent = path.dirname(fsPath);
            this.markDirDirty(parent);
            this.enqueueDirRecompute(parent);
            this.refreshDebounced();

            // 4) 重活丢后台：由 scheduleFileStat 去 worker 线程精算并二次触发父目录聚合
            this.scheduleFileStat(fsPath);
        });

        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            this.refreshIgnoreParser(); // 简化：统一进这个方法
        });

        // 初始化忽略解析器
        this.initIgnoreParser();

        // 检测 Git 仓库并处理缓存可信度
        this.detectGitRepoAndMaybeRescan();

        // 延迟执行一次文件排序键迁移（确保 globalFileTracking 有时间生成 UUID）
        setTimeout(() => {
            try { this.orderManager?.migrateAllFileKeys?.(); } catch { /* ignore */ }
        }, 1500);
    }

    /**
     * 处理全局文件追踪事件
     */
    private handleFileChange(event: FileChangeEvent): void {
        const filePath = event.filePath;
        const fileName = path.basename(filePath);

        wcDebug(`WordCount: File change detected - ${event.type}: ${filePath}`);

        // 检查是否为支持的文件类型或参考文件类型
        const ext = path.extname(fileName).slice(1).toLowerCase();
        const supportedExts = getSupportedExtensions();
        const refExts = (vscode.workspace.getConfiguration('AndreaNovelHelper')
            .get<string[]>('wordCount.referenceVisibleExtensions', []) || [])
            .map(s => (s || '').toLowerCase());
        
        const isSupported = supportedExts.includes(ext);
        const isReference = refExts.includes(ext);
        const isSpecial = isSpecialVisibleFile(fileName);
        
        if (!isSpecial && !isSupported && !isReference) {
            wcDebug(`WordCount: Ignoring unsupported file type: ${ext} for ${filePath}`);
            return;
        }

        wcDebug(`WordCount: Processing ${event.type} for supported file: ${filePath}`);

        switch (event.type) {
            case 'create':
            case 'change':
                this.invalidateCache(filePath);
                const parent = path.dirname(filePath);
                this.markDirDirty(parent);
                this.enqueueDirRecompute(parent);
                this.refreshDebounced();
                // 对于新创建的文件，只有支持的文件类型才安排后台统计，参考文件不需要
                if (event.type === 'create' && isSupported) {
                    wcDebug(`WordCount: Scheduling file stats for new supported file: ${filePath}`);
                    this.scheduleFileStat(filePath);
                } else if (event.type === 'create' && isReference) {
                    wcDebug(`WordCount: Reference file created, UI refresh only: ${filePath}`);
                }
                break;
            case 'rename':
                wcDebug(`WordCount: Processing file rename: ${event.oldPath} -> ${filePath}`);
                if (event.oldPath) {
                    // 删除旧路径的缓存
                    this.statsCache.delete(event.oldPath);
                    // 删除旧路径的子文件缓存（如果是目录）
                    for (const key of Array.from(this.statsCache.keys())) {
                        if (key.startsWith(event.oldPath + path.sep)) {
                            this.statsCache.delete(key);
                        }
                    }
                    // 删除旧路径的目录聚合缓存
                    for (const key of Array.from(this.dirAggCache.keys())) {
                        if (key === event.oldPath || key.startsWith(event.oldPath + path.sep)) {
                            this.dirAggCache.delete(key);
                        }
                    }
                    // 标记旧路径的父目录为脏
                    const oldParent = path.dirname(event.oldPath);
                    this.markDirDirty(oldParent);
                    this.enqueueDirRecompute(oldParent);
                }
                // 处理新路径
                this.invalidateCache(filePath);
                const newParent = path.dirname(filePath);
                this.markDirDirty(newParent);
                this.enqueueDirRecompute(newParent);
                this.refreshDebounced();
                // 对于支持的文件类型，安排后台统计
                if (isSupported) {
                    wcDebug(`WordCount: Scheduling file stats for renamed supported file: ${filePath}`);
                    this.scheduleFileStat(filePath);
                } else if (isReference) {
                    wcDebug(`WordCount: Reference file renamed, UI refresh only: ${filePath}`);
                }
                break;
            case 'delete':
                wcDebug(`WordCount: Processing file deletion: ${filePath}`);
                // 删除文件缓存
                if (this.statsCache.delete(filePath)) {
                    const parentDir = path.dirname(filePath);
                    this.markDirDirty(parentDir);
                    this.enqueueDirRecompute(parentDir);
                    // 删除子文件缓存（如果是目录）
                    for (const key of Array.from(this.statsCache.keys())) {
                        if (key.startsWith(filePath + path.sep)) {
                            this.statsCache.delete(key);
                        }
                    }
                    // 删除目录聚合缓存
                    for (const key of Array.from(this.dirAggCache.keys())) {
                        if (key === filePath || key.startsWith(filePath + path.sep)) {
                            this.dirAggCache.delete(key);
                        }
                    }
                    this.refreshDebounced();
                }
                break;
        }
    }

    private isPathForced(p: string): boolean {
        const abs = path.resolve(p);
        // 新增：如果在 recountRegisteredFiles 列表中，直接返回 true
        if (this.recountRegisteredFiles.includes(abs)) return true;
        for (const base of this.forcedPaths) {
            if (abs === base) return true;
            if (abs.startsWith(base.endsWith(path.sep) ? base : (base + path.sep))) return true;
        }
        return false;
    }

    // 新增：非阻塞地安排单文件统计
    private scheduleFileStat(full: string) {
        if (this.inFlightFileStats.has(full)) return;
        this.inFlightFileStats.add(full);
        setTimeout(async () => {
            try {
                await this.getOrCalculateFileStats(full);   // 真正算在后台
            } finally {
                this.inFlightFileStats.delete(full);
                const parent = path.dirname(full);
                this.markDirDirty(parent);                  // 标脏父目录
                this.enqueueDirRecompute(parent);           // 再次触发聚合（这次能命中缓存）
                this.refreshDebounced();
            }
        }, 0);
    }

    private detectGitRepoAndMaybeRescan() {
        try {
            const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!root) return;
            this.hasGitRepo = fs.existsSync(path.join(root, '.git'));
            this.cacheTrusted = this.hasGitRepo; // 只有存在 git 仓库才信任缓存
            if (!this.hasGitRepo) {
                // 无 git：立刻强制重扫（即使当前缓存可能为空，以确保逻辑一致）
                setTimeout(() => {
                    wcDebug('noGit:forceFullRescan');
                    this.forceRecountAll();
                    vscode.window.showInformationMessage('未检测到 Git 仓库，已强制刷新字数缓存。建议在根目录执行 git init 获得更精准的增量统计。');
                }, 300);
            }
        } catch { /* ignore */ }
    }

    private async initializeGitGuard() {
        try {
            // 配置 GitGuard，只处理支持的文件类型
            await this.gitGuard.init({} as vscode.ExtensionContext, {
                baseline: 'HEAD',
                contentHashDedupe: true,
                allowedLanguageIds: ['markdown', 'plaintext'],
                ignore: (uri) => {
                    // 使用现有的忽略逻辑
                    return this.ignoreParser ? this.ignoreParser.shouldIgnore(uri.fsPath) : false;
                }
            });
        } catch (error) {
            console.warn('GitGuard 初始化失败，将使用传统缓存:', error);
        }
    }

    private initIgnoreParser() {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (workspaceRoot) {
            this.ignoreParser = new CombinedIgnoreParser(workspaceRoot);
        }
    }

    /**
     * 公开方法，用于外部刷新忽略解析器
     */
    public refreshIgnoreParser() {
        this.initIgnoreParser();
        this.clearCache();
        this.refresh();
    }

    private refreshDebounced() {
        if (this.refreshThrottleTimer) return;
        this.refreshThrottleTimer = setTimeout(() => {
            this.refreshThrottleTimer = null;
            this.refresh();
        }, 800); // 增加到 800ms 防抖避免频繁刷新
    }

    refresh() {
        // 如果正在初始化大量文件，延迟刷新
        if (this.isInitializing) {
            this.refreshDebounced();
            return;
        }
        this._onDidChange.fire(undefined);
    }

    // 保存展开状态到工作区
    private saveExpandedState(): void {
        this.memento.update('wordCountExpandedNodes', Array.from(this.expandedNodes));
    }

    // 处理节点展开
    onDidExpandElement(node: WordCountItem): void {
        if (node instanceof WordCountItem) {
            this.expandedNodes.add(node.id!);
            this.saveExpandedState();
        }
    }

    // 处理节点折叠
    onDidCollapseElement(node: WordCountItem): void {
        if (node instanceof WordCountItem) {
            this.expandedNodes.delete(node.id!);
            this.saveExpandedState();
        }
    }

    private clearCache() {
        this.statsCache.clear();
        this.itemsById.clear();
        this.dirAggCache.clear();
    }

    private invalidateCache(filePath: string) {
        // 仅删除该文件自身缓存（目录不缓存）
        this.statsCache.delete(filePath);
    }

    /**
     * 强制重算：清空全部缓存+GitGuard哈希并刷新。
     */
    public forceRecountAll() {
        wcDebug('forceRecount:all');
        const roots = vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) || [];
        // 清空缓存但保留 previousDirAgg 供 UI 占位
        for (const [k, v] of this.dirAggCache.entries()) this.previousDirAggCache.set(k, v);
        this.statsCache.clear();
        this.dirAggCache.clear();
        try { (this.gitGuard as any)?.reset?.(); } catch { /* ignore */ }
        roots.forEach(r => {
            const absPath = path.resolve(r);
            this.forcedPaths.add(absPath);
            // 只注册文件路径，排除目录
            try {
                const dirents = fs.readdirSync(absPath, { withFileTypes: true });
                dirents.forEach(d => {
                    if (d.isFile()) {
                        const filePath = path.join(absPath, d.name);
                        this.recountRegisteredFiles.push(filePath);
                    }
                });
            } catch { }
        });
        this.refresh();
        // 复用首次扫描：对每个根目录触发一次 getChildren -> calculateStatsAsync
        setTimeout(() => { this.refresh(); }, 0);
    }

    /**
     * 强制重算指定文件（或目录下所有文件）。
     */
    public forceRecountPath(targetPath: string) {
        if (!targetPath) return;

        const abs = path.resolve(targetPath);
        wcDebug('forceRecount:path', abs);

        let st: fs.Stats | null = null;
        try { st = fs.statSync(abs); } catch { return; }

        // 注册重算路径（只加入文件路径，不加入目录路径）
        if (st && st.isFile()) {
            if (!this.recountRegisteredFiles.includes(abs)) {
                this.recountRegisteredFiles.push(abs);
            }
        }

        if (st.isDirectory()) {
            // 1) 迁移现有聚合到 previous：UI 过渡
            const copy = this.dirAggCache.get(abs);
            if (copy) this.previousDirAggCache.set(abs, copy);

            // 2) 删除本目录自身聚合与在算中的聚合（不递归删子目录聚合）
            this.dirAggCache.delete(abs);
            this.inFlightDirAgg.delete(abs);

            // 3) 清掉该目录下所有“文件级”内存缓存，让后续聚合不会直接复用旧值
            const prefix = abs.endsWith(path.sep) ? abs : (abs + path.sep);
            for (const key of Array.from(this.statsCache.keys())) {
                if (key === abs || key.startsWith(prefix)) {
                    // 只处理文件路径
                    try {
                        const stat = fs.statSync(key);
                        if (stat.isFile()) {
                            if (!this.recountRegisteredFiles.includes(key)) {
                                this.recountRegisteredFiles.push(key);
                            }
                        }
                    } catch { }
                    this.statsCache.delete(key);
                }
            }
        } else {
            // 单文件：清掉该文件内存缓存，并注册重算路径
            this.statsCache.delete(abs);
            if (!this.recountRegisteredFiles.includes(abs)) {
                this.recountRegisteredFiles.push(abs);
            }
        }

        // 4) 标记强制：祖先目录强制逻辑会让子文件即便命中缓存也会后台重算
        this.forcedPaths.add(abs);

        // 5) 入队链式聚合；文件则顺带立刻做一次强制精算
        if (st.isDirectory()) {
            this.enqueueDirRecompute(abs);
        } else {
            const parent = path.dirname(abs);
            this.markDirDirty(parent);
            this.enqueueDirRecompute(parent);
            // 关键：强制绕过所有缓存，立即后台精算该文件
            void this.getOrCalculateFileStats(abs, /*forceOverride*/ true).catch(() => { });
        }

        // 6) 刷新视图（一次立即 + 一次让出事件循环后）
        this.refresh();
        setTimeout(() => { this.refresh(); }, 0);
        // 用防抖：把多次目录重算合并成一次 UI 刷新
        // this.refreshDebounced();

    }


    /**
     * 在有 Git 仓库的情况下，对刚激活的文件进行缓存校验：
     *  - 读取缓存（内存或持久化）
     *  - 新鲜计算一次
     *  - 若 total 不一致，则认为该文件所在目录缓存不可信 -> 失效该文件与其父层目录缓存
     *  - 若一致，不写入持久化（避免无意义写 I/O）
     */
    public async verifyFileCache(filePath: string) {
        if (!this.cacheTrusted) return; // 没有 Git 仓库不做校验，直接依赖强制重算策略
        if (this.verifying.has(filePath)) return;
        this.verifying.add(filePath);
        try {
            const stat = await fs.promises.stat(filePath).catch(() => null);
            if (!stat || !stat.isFile()) return;
            const mtime = stat.mtimeMs;

            // 取基线（内存缓存 或 持久化缓存）
            let baseline: TextStats | undefined;
            const mem = this.statsCache.get(filePath);
            if (mem && mem.mtime === mtime) baseline = mem.stats;
            if (!baseline) {
                const ft = getFileTracker();
                if (ft) {
                    const dm = ft.getDataManager();
                    const meta = dm.getFileByPath(filePath);
                    if (meta?.wordCountStats && meta.mtime === mtime) baseline = meta.wordCountStats;
                }
            }
            if (!baseline) return; // 没有可比对的缓存，无需校验

            // 新鲜计算（不触发持久化写入）
            const fresh = await countAndAnalyzeOffThread(filePath);
            if (fresh.stats.total !== baseline.total) {
                wcDebug('verification:mismatch', filePath, 'cached', baseline.total, 'fresh', fresh.stats.total);
                this.statsCache.set(filePath, { stats: fresh.stats, mtime });

                // 只失效“父目录聚合”，不要删掉文件本身的缓存
                const parent = path.dirname(filePath);
                this.markDirDirty(parent);
                this.enqueueDirRecompute(parent);

                // 点名刷新父目录（若拿不到就刷新整棵树）
                const parentNode = this.itemsById.get(parent);
                this._onDidChange.fire((parentNode as any) || undefined);

                // 更新持久化（确保后续启动正确）
                const ft = getFileTracker();
                if (ft) {
                    try {
                        const dm = ft.getDataManager();
                        await dm.addOrUpdateFile(filePath);
                        dm.updateWordCountStats(filePath, fresh.stats);
                        wcDebug('verification:persistent-fix', filePath);
                    } catch { /* ignore */ }
                }
            } else {
                wcDebug('verification:match', filePath, baseline.total);
                // 若内存没有但持久化有，可填充内存；不写持久化
                if (!mem) this.statsCache.set(filePath, { stats: baseline, mtime });
            }
        } catch { /* ignore */ }
        finally {
            this.verifying.delete(filePath);
        }
    }

    getTreeItem(item: WordCountItem | NewItemNode): vscode.TreeItem {
        return item;
    }

    async getChildren(element?: WordCountItem | NewItemNode): Promise<(WordCountItem | NewItemNode)[]> {
        // 如果是 NewItemNode，不应该有子项
        if (element instanceof NewItemNode) {
            return [];
        }

        const root = element
            ? element.resourceUri.fsPath
            : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root) return [];

        wcDebug('getChildren:enter', { root, element: element?.resourceUri.fsPath });

        const exts = getSupportedExtensions();
        // 参考文件扩展：仅显示不计数
        const refExts = new Set<string>(
            (vscode.workspace.getConfiguration('AndreaNovelHelper')
                .get<string[]>('wordCount.referenceVisibleExtensions', []) || [])
                .map(s => (s || '').toLowerCase())
        );

        let dirents: fs.Dirent[] = [];
        try {
            dirents = await fs.promises.readdir(root, { withFileTypes: true });
            wcDebug('getChildren:readDir', root, 'entries', dirents.length);
        } catch (e) {
            console.error('WordCountProvider: failed to read dir', root, e);
            return [];
        }

        const items: (WordCountItem | NewItemNode)[] = [];
        let needsAsync = false;

        for (const d of dirents) {
            const full = path.join(root, d.name);
            const uri = vscode.Uri.file(full);

            // 忽略规则（统一工具） - 扩展允许的文件类型包含参考文件
            if (shouldIgnoreWordCountFile(full, this.ignoreParser, {
                workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
                respectWcignore: vscode.workspace.getConfiguration('AndreaNovelHelper').get<boolean>('wordCount.respectWcignore', true),
                respectGitignore: vscode.workspace.getConfiguration('AndreaNovelHelper').get<boolean>('wordCount.respectGitignore', true),
                allowedLanguages: getAllowedExtensions()
            })) { wcDebug('skip:ignored', full); continue; }

            if (d.isDirectory()) {
                const isExpanded = this.expandedNodes.has(full);
                const forced = this.forcedPaths.has(path.resolve(full));
                const cacheEntry = this.dirAggCache.get(full);
                const cacheValid = cacheEntry && !forced; // 去除 TTL 约束，仅强制/失效时重算
                if (cacheValid) {
                    const item = new WordCountItem(
                        uri,
                        d.name,
                        cacheEntry!.stats,
                        isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
                        false
                    );
                    item.id = full;
                    this.itemsById.set(item.id, item);
                    try {
                        const ageMs = Date.now() - (cacheEntry!.ts);
                        if (item.tooltip instanceof vscode.MarkdownString) {
                            item.tooltip.appendMarkdown(`\n\n缓存年龄: **${this.formatCacheAge(ageMs)}**`);
                        }
                    } catch { /* ignore */ }
                    items.push(item);
                } else if (cacheEntry && !cacheValid) {
                    // 强制：改回占位符显示“计算中”
                    const zero: TextStats = { cjkChars: 0, asciiChars: 0, words: 0, nonWSChars: 0, total: 0 };
                    const item = new WordCountItem(
                        uri,
                        d.name,
                        zero,
                        isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
                        true
                    );
                    item.id = full;
                    this.itemsById.set(item.id, item);
                    items.push(item);
                    needsAsync = true;
                } else if (this.previousDirAggCache.has(full)) {
                    // 没有现缓存但有旧值：显示旧值 + 旋转图标，不出现“计算中”字样
                    const prev = this.previousDirAggCache.get(full)!;
                    const staleItem = new WordCountItem(
                        uri,
                        d.name,
                        prev.stats,
                        isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
                        false
                    );
                    staleItem.id = full;
                    staleItem.iconPath = new vscode.ThemeIcon('loading~spin');
                    try {
                        const ageMs = Date.now() - prev.ts;
                        if (staleItem.tooltip instanceof vscode.MarkdownString) {
                            staleItem.tooltip.appendMarkdown(`\n\n旧值年龄: **${this.formatCacheAge(ageMs)}** (重算中)`);
                        }
                    } catch { /* ignore */ }
                    this.itemsById.set(staleItem.id, staleItem);
                    items.push(staleItem);
                    needsAsync = true;
                } else {
                    const zero: TextStats = { cjkChars: 0, asciiChars: 0, words: 0, nonWSChars: 0, total: 0 };
                    const item = new WordCountItem(
                        uri,
                        d.name,
                        zero,
                        isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
                        true
                    );
                    item.id = full;
                    this.itemsById.set(item.id, item);
                    items.push(item);
                    needsAsync = true;
                }
            } else {
                const ext = path.extname(d.name).slice(1).toLowerCase();
                const special = isSpecialVisibleFile(d.name);
                const isRef = refExts.has(ext);
                if (!special && !exts.includes(ext) && !isRef) continue;

                if (isRef && !exts.includes(ext) && !special) {
                    // 参考文件：仅展示，不计数，不排队后台
                    const zero: TextStats = { cjkChars: 0, asciiChars: 0, words: 0, nonWSChars: 0, total: 0 };
                    const item = new WordCountItem(uri, d.name, zero, vscode.TreeItemCollapsibleState.None, false);
                    item.id = full;
                    // 显式标注：可在 tooltip 上注明“参考资料（不计数）”
                    try {
                        const tip = new vscode.MarkdownString(String(item.tooltip || ''));
                        tip.appendMarkdown(`\n\n参考资料：不计入字数统计`);
                        tip.isTrusted = true;
                        item.tooltip = tip;
                    } catch { /* ignore */ }
                    this.itemsById.set(item.id, item);
                    items.push(item);
                } else {
                    const cached = this.statsCache.get(full);
                    if (cached) {
                        wcDebug('use-cache:file', full, 'total', cached.stats.total);
                        const item = new WordCountItem(uri, d.name, cached.stats, vscode.TreeItemCollapsibleState.None, false);
                        item.id = full;
                        this.itemsById.set(item.id, item);
                        items.push(item);
                    } else {
                        wcDebug('placeholder:file', full);
                        const zero: TextStats = { cjkChars: 0, asciiChars: 0, words: 0, nonWSChars: 0, total: 0 };
                        const item = new WordCountItem(uri, d.name, zero, vscode.TreeItemCollapsibleState.None, true);
                        item.id = full;
                        this.itemsById.set(item.id, item);
                        items.push(item);
                        needsAsync = true;
                    }
                }
            }
        }

        // 目录在前，按名称排序
        // items.sort((a, b) => {
        //     const aDir = a.collapsibleState !== vscode.TreeItemCollapsibleState.None;
        //     const bDir = b.collapsibleState !== vscode.TreeItemCollapsibleState.None;
        //     if (aDir !== bDir) return aDir ? -1 : 1;
        //     return a.label.localeCompare(b.label, 'zh');
        // });
        const wordCountItems = items.filter(item => item instanceof WordCountItem) as WordCountItem[];
        if (this.orderManager) {
            const parentFolder = element ? element.resourceUri.fsPath : (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '');
            if (parentFolder && this.orderManager.isManual(parentFolder)) {
                wordCountItems.sort((a, b) => {
                    const aIsDir = a.collapsibleState !== vscode.TreeItemCollapsibleState.None;
                    const bIsDir = b.collapsibleState !== vscode.TreeItemCollapsibleState.None;
                    if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
                    const ia = this.orderManager!.getIndex(a.resourceUri.fsPath);
                    const ib = this.orderManager!.getIndex(b.resourceUri.fsPath);
                    if (ia !== undefined && ib !== undefined) {
                        if (ia !== ib) return ia - ib;
                    } else if (ia !== undefined) {
                        return -1; // 有 index 的排前
                    } else if (ib !== undefined) {
                        return 1;
                    }
                    return a.label.localeCompare(b.label, 'zh');
                });
            } else {
                sortItems(wordCountItems);
            }
        } else {
            sortItems(wordCountItems);
        }

        // 将排序后的项目重新组合，并在末尾添加新建项目按钮
        // 在手动模式下：为每个项目前置索引标签（不改真实文件名，只改 label 显示）
        if (this.orderManager) {
            const parentFolder = element ? element.resourceUri.fsPath : (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '');
            if (parentFolder && this.orderManager.isManual(parentFolder)) {
                const showInLabel = vscode.workspace.getConfiguration().get<boolean>('AndreaNovelHelper.wordCount.order.showIndexInLabel', true);
                // 只有第一项显示索引，其余索引仅在 tooltip
                // 在手动模式下为所有已排序项显示 [序号] 或 tooltip 索引
                // 先根据当前显示顺序派生用户可见的序号（忽略没有 index 的项）
                let visibleSeq = 1;
                for (let i = 0; i < wordCountItems.length; i++) {
                    const it = wordCountItems[i];
                    const idxVal = this.orderManager.getIndex(it.resourceUri.fsPath);
                    if (idxVal === undefined) continue;
                    const tag = this.orderManager.formatIndex(idxVal);
                    if (!tag) continue;
                    const orderDisplay = visibleSeq++; // 连续序号
                    // tooltip: 显示 原始索引(tag) 与 序号(orderDisplay)
                    const line = `排序序号: **${orderDisplay}** (索引值: ${tag})`;
                    if (it.tooltip instanceof vscode.MarkdownString) {
                        it.tooltip.appendMarkdown(`\n\n${line}`);
                    } else {
                        const tip = new vscode.MarkdownString(String(it.tooltip || ''));
                        tip.appendMarkdown(`\n\n${line}`);
                        tip.isTrusted = true;
                        it.tooltip = tip;
                    }
                    if (showInLabel) {
                        if (!(it.label as string).startsWith('[')) {
                            (it as any).label = `[${orderDisplay}] ${it.label}`;
                        }
                    } else {
                        if (typeof it.description === 'string') {
                            if (!it.description.startsWith('[')) {
                                it.description = `[${orderDisplay}] ${it.description}`;
                            }
                        } else if (!it.description) {
                            it.description = `[${orderDisplay}]`;
                        }
                    }
                }
            }
        }

        const sortedItems: (WordCountItem | NewItemNode)[] = [...wordCountItems];

        // 在文件夹末尾添加新建文章和新建文件夹按钮
        const newFileNode = new NewItemNode(root, 'newFile');
        const newFolderNode = new NewItemNode(root, 'newFolder');

        this.itemsById.set(newFileNode.id!, newFileNode);
        this.itemsById.set(newFolderNode.id!, newFolderNode);

        sortedItems.push(newFileNode, newFolderNode);

        // 异步批量计算（目录动态聚合 + 文件统计）
        if (needsAsync) {
            wcDebug('getChildren:needsAsyncBatch', root);
            void this.calculateStatsAsync(root, exts, dirents).then(() => {
                wcDebug('getChildren:asyncBatchComplete', root);
                this.refresh();
            });
        }

        return sortedItems;
    }


    // 动态聚合目录：不写缓存；被父目录调用
    // 动态聚合目录：不写缓存；被父目录调用（支持祖先目录强制）
    private async analyzeFolderDynamic(folder: string, exts: string[]): Promise<TextStats> {
        const forced = this.isPathForced(folder); // ⬅ 祖先目录强制判定
        if (!forced) {
            const hit = this.dirAggCache.get(folder);
            if (hit) {
                wcDebug('dirAggCache:hit', folder);
                return hit.stats;
            }
            const inflight = this.inFlightDirAgg.get(folder);
            if (inflight) {
                wcDebug('dirAgg:reuse-inflight', folder);
                return inflight;
            }
        } else {
            wcDebug('dirAgg:forced-recompute', folder);
        }

        const work = (async () => {
            let agg: TextStats = { cjkChars: 0, asciiChars: 0, words: 0, nonWSChars: 0, total: 0 };
            try {
                const dirents = await fs.promises.readdir(folder, { withFileTypes: true });
                // 分离文件与子目录，避免深度递归串行阻塞
                const subDirs: fs.Dirent[] = [];
                const files: fs.Dirent[] = [];
                for (const d of dirents) {
                    const full = path.join(folder, d.name);
                    if (shouldIgnoreWordCountFile(full, this.ignoreParser, {
                        workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
                        respectWcignore: vscode.workspace.getConfiguration('AndreaNovelHelper').get<boolean>('wordCount.respectWcignore', true),
                        respectGitignore: vscode.workspace.getConfiguration('AndreaNovelHelper').get<boolean>('wordCount.respectGitignore', true),
                        allowedLanguages: getAllowedExtensions()
                    })) continue;
                    if (d.isDirectory()) subDirs.push(d); else files.push(d);
                }

                // —— 先处理文件（并发分批）——
                const fileBatchSize = 6;
                for (let i = 0; i < files.length; i += fileBatchSize) {
                    const batch = files.slice(i, i + fileBatchSize);

                    const subResults = await Promise.all(batch.map(async d => {
                        const full = path.join(folder, d.name);
                        const ext = path.extname(d.name).slice(1).toLowerCase();
                        const special = isSpecialVisibleFile(d.name);
                        if (!special && !exts.includes(ext)) return null;

                        // 1) 内存缓存：强制时也先用旧值占位，但仍派发后台重算
                        const mem = this.statsCache.get(full);
                        if (mem) {
                            if (forced) this.scheduleFileStat(full); // ⬅ 强制：有缓存也重算
                            return mem.stats;
                        }

                        // 2) 持久化缓存（仅非强制时使用；强制时绕过）
                        if (!forced) {
                            try {
                                const ft = getFileTracker();
                                const dm = ft?.getDataManager();
                                const meta = dm?.getFileByPath(full);
                                if (meta?.wordCountStats) {
                                    const st = await fs.promises.stat(full);
                                    if (st && meta.mtime === st.mtimeMs && (meta.size === undefined || meta.size === st.size)) {
                                        this.statsCache.set(full, { stats: meta.wordCountStats, mtime: meta.mtime, size: st.size });
                                        return meta.wordCountStats;
                                    }
                                }
                            } catch { /* ignore */ }
                        }

                        // 3) 被强制或没有可用缓存 → 不阻塞：排队后台精算，聚合先略过
                        this.scheduleFileStat(full);
                        return null;
                    }));

                    for (const st of subResults) if (st) agg = mergeStats(agg, st);
                    await new Promise(r => setTimeout(r, 0));
                }

                // —— 再处理子目录（并发分批）——
                const dirBatchSize = 2; // 控制递归并发
                for (let i = 0; i < subDirs.length; i += dirBatchSize) {
                    const batch = subDirs.slice(i, i + dirBatchSize);
                    const subStats = await Promise.all(batch.map(async d => {
                        const full = path.join(folder, d.name);
                        try { return await this.analyzeFolderDynamic(full, exts); } catch { return null; }
                    }));
                    for (const st of subStats) if (st) agg = mergeStats(agg, st);
                    await new Promise(r => setTimeout(r, 0));
                }
            } catch { /* ignore */ }

            const now = Date.now();
            this.dirAggCache.set(folder, { stats: agg, ts: now });
            this.previousDirAggCache.delete(folder);
            wcDebug('dirAggCache:update', folder, 'total', agg.total, 'forced', forced);

            if (forced) {
                this.forcedPaths.delete(path.resolve(folder));
                wcDebug('dir:forced-clear', folder);
            }
            return agg;
        })();

        if (!forced) this.inFlightDirAgg.set(folder, work);
        try {
            return await work;
        } finally {
            if (!forced) this.inFlightDirAgg.delete(folder);
        }
    }

    /**
     * 异步计算所有统计数据
     */
    private async calculateStatsAsync(root: string, exts: string[], dirents: fs.Dirent[]) {
        const tasks: Promise<void>[] = [];

        for (const d of dirents) {
            const full = path.join(root, d.name);

            // 检查是否应该被忽略（统一工具）
            if (shouldIgnoreWordCountFile(full, this.ignoreParser, {
                workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
                respectWcignore: vscode.workspace.getConfiguration('AndreaNovelHelper').get<boolean>('wordCount.respectWcignore', true),
                respectGitignore: vscode.workspace.getConfiguration('AndreaNovelHelper').get<boolean>('wordCount.respectGitignore', true),
                allowedLanguages: getAllowedExtensions()
            })) { continue; }

            if (d.isDirectory()) {
                tasks.push(this.analyzeFolderDynamic(full, exts).then(stats => {
                    const existing = this.itemsById.get(full);
                    if (existing && existing instanceof WordCountItem) {
                        const item = new WordCountItem(vscode.Uri.file(full), path.basename(full), stats,
                            this.expandedNodes.has(full) ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
                            false);
                        item.id = full;
                        this.itemsById.set(full, item);
                    }
                }));
            } else {
                const ext = path.extname(d.name).slice(1).toLowerCase();
                const special = isSpecialVisibleFile(d.name);
                if (special || exts.includes(ext)) {
                    // tasks.push(this.getOrCalculateFileStats(full).then(() => { }));
                    if (!this.inFlightFileStats.has(full)) {
                        this.scheduleFileStat(full); // 统一走去重通道
                    }
                }
            }
        }

        // 分批处理，避免一次性创建太多任务
        const batchSize = 5;
        for (let i = 0; i < tasks.length; i += batchSize) {
            const batch = tasks.slice(i, i + batchSize);
            await Promise.all(batch);

            // 每处理一批就刷新一次UI
            if (i + batchSize < tasks.length) {
                this.refreshDebounced();
                // 让出线程，避免阻塞UI
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }
    }

    /**
     * 获取或计算文件统计（带缓存和 Git 优化）
     */
    private async getOrCalculateFileStats(filePath: string, forceOverride = false): Promise<TextStats> {
        try {
            const stat = await fs.promises.stat(filePath);
            const mtime = stat.mtimeMs;
            const size = stat.size;
            const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
            const largeThreshold = cfg.get<number>('wordCount.largeFileThreshold', 50 * 1024) ?? 50 * 1024;
            const avgBytesPerChar = cfg.get<number>('wordCount.largeFileAvgBytesPerChar', 1.6) ?? 1.6;

            // 1. 检查内存缓存 —— 加 size 判断
            const cached = this.statsCache.get(filePath);
            // const isForced = forceOverride || this.forcedPaths.has(path.resolve(filePath));
            const isForced = forceOverride || this.isPathForced(filePath);

            if (!isForced && cached && cached.mtime === mtime && cached.size === size && !this.largeApproxPending.has(filePath)) {
                wcDebug('cache-hit:memory:file', filePath, 'mtime', mtime, 'size', size);
                return cached.stats;
            }


            // 1.5 大文件快速估算路径（若无精确缓存或缓存为过期）
            // 如果已有任何内存缓存（即使 size/mtime 不匹配），优先使用旧缓存并后台精算，避免估算覆盖已有精确值
            if (!isForced && cached && !this.largeApproxPending.has(filePath)) {
                try { wcDebug('cache-preserve:using-existing-cache-and-schedule-background-precise', filePath, 'cachedM', cached.mtime, 'cachedS', cached.size, 'curS', size); } catch { /* ignore */ }
                // 后台异步精算并更新缓存/聚合
                this.scheduleFileStat(filePath);
                return cached.stats;
            }

            if (!isForced && size > largeThreshold && !this.largeApproxPending.has(filePath)) {
                // 生成估算结果（只估 total，其余置 0）
                const estimatedTotal = Math.max(1, Math.floor(size / Math.max(0.1, avgBytesPerChar)));
                const est: TextStats = { cjkChars: 0, asciiChars: 0, words: 0, nonWSChars: 0, total: estimatedTotal };
                // 1.5 大文件估算
                this.statsCache.set(filePath, { stats: est, mtime, size });

                this.largeApproxPending.add(filePath);
                wcDebug('largeFile:estimated', filePath, 'size', size, 'estTotal', estimatedTotal);
                // 加入后台精确统计队列
                this.scheduleLargeAccurate(filePath);
                return est;
            }

            // 2. 检查持久化缓存（从文件追踪数据库）
            const fileTracker = getFileTracker();
            if (!isForced && fileTracker) {
                const dataManager = fileTracker.getDataManager();
                const fileMetadata = dataManager.getFileByPath(filePath);

                if (fileMetadata && fileMetadata.wordCountStats) {
                    const st = await fs.promises.stat(filePath);
                    if (st && fileMetadata.mtime === st.mtimeMs && (fileMetadata.size === undefined || fileMetadata.size === st.size)) {
                        // 新增：命中缓存后校验 GitGuard
                        let gitOk = true;
                        if (this.gitGuard) {
                            try {
                                gitOk = await this.gitGuard.shouldCountByGitOnly(vscode.Uri.file(filePath));
                            } catch (e) {
                                wcDebug('gitGuard:check:error', filePath, e);
                                gitOk = true; // 校验异常时默认允许
                            }
                        }
                        if (gitOk) {
                            wcDebug('cache-hit:persistent:file', filePath, 'mtime', st.mtimeMs, 'size', st.size, 'gitOk', gitOk);
                            const stats = fileMetadata.wordCountStats;
                            this.statsCache.set(filePath, { stats, mtime: st.mtimeMs, size: st.size });
                            this.markDirDirty(path.dirname(filePath));
                            this.enqueueDirRecompute(path.dirname(filePath));
                            return stats;
                        } else {
                            wcDebug('cache-gitguard:fail', filePath);
                        }
                    } else {
                        wcDebug('cache-stale:persistent:file', filePath, 'cachedM', fileMetadata.mtime, 'curM', st?.mtimeMs, 'cachedS', fileMetadata.size, 'curS', st?.size);
                    }
                }
            }

            // 3. 交给 asyncWordCounter
            const result: any = await countAndAnalyzeOffThread(filePath);
            const stats: TextStats = (result && 'stats' in result) ? result.stats : result;
            const mtimeFromWorker = (typeof result?.mtime === 'number') ? result.mtime : undefined;
            const sizeFromWorker = (typeof result?.size === 'number') ? result.size : undefined;

            // 5. 更新内存缓存（优先采用 worker 的 mtime/size）
            const finalMtime = mtimeFromWorker ?? mtime;
            const finalSize = sizeFromWorker ?? size;
            const prev = this.statsCache.get(filePath);
            const changed =
                !prev ||
                prev.mtime !== finalMtime ||
                prev.size !== finalSize ||
                prev.stats.total !== stats.total;

            this.statsCache.set(filePath, { stats, mtime: finalMtime, size: finalSize });

            // 只有真的变了，才让父目录失效并重算
            if (changed) {
                this.markDirDirty(path.dirname(filePath));
                this.enqueueDirRecompute(path.dirname(filePath));
            }


            // 6. 持久化到文件追踪数据库（只写统计；mtime 按你的 DataManager 设计自处理）
            if (fileTracker) {
                const dataManager = fileTracker.getDataManager();
                await dataManager.addOrUpdateFile(filePath);
                dataManager.updateWordCountStats(filePath, stats);
                wcDebug('persistent-update:file', filePath);
            }

            if (isForced) {
                this.forcedPaths.delete(path.resolve(filePath));
                // 新增：强制重算后移除文件路径从 recountRegisteredFiles 列表
                const abs = path.resolve(filePath);
                const idx = this.recountRegisteredFiles.indexOf(abs);
                if (idx !== -1) this.recountRegisteredFiles.splice(idx, 1);
            }
            return stats;

        } catch (error) {
            console.error(`Error calculating stats for ${filePath}:`, error);
            return { cjkChars: 0, asciiChars: 0, words: 0, nonWSChars: 0, total: 0 };
        }
    }

    /** 将大文件加入精确统计后台队列 */
    private scheduleLargeAccurate(filePath: string) {
        if (this.largeProcessingQueue.includes(filePath)) return;
        this.largeProcessingQueue.push(filePath);
        this.runLargeProcessing();
    }

    /** 后台串行处理大文件精确统计，避免阻塞主线程 */
    private async runLargeProcessing() {
        if (this.largeProcessingRunning) return;
        this.largeProcessingRunning = true;
        while (this.largeProcessingQueue.length) {
            const fp = this.largeProcessingQueue.shift()!;
            if (!this.largeApproxPending.has(fp)) continue; // 已被其它路径精算
            try {
                wcDebug('largeFile:processing:start', fp);
                const stOnDisk = await fs.promises.stat(fp).catch(() => null);
                if (!stOnDisk || !stOnDisk.isFile()) { this.largeApproxPending.delete(fp); continue; }
                // 调用异步计数（可能返回 {stats, mtime, size, hash}，也可能直接是 TextStats）
                const res: any = await countAndAnalyzeOffThread(fp);
                const textStats = (res && typeof res === 'object' && 'stats' in res) ? res.stats : res;
                const mtimeFromWorker = (typeof res?.mtime === 'number') ? res.mtime : stOnDisk.mtimeMs;
                const sizeFromWorker = (typeof res?.size === 'number') ? res.size : stOnDisk.size;
                // 回写内存缓存：带上 mtime + size，避免 mtime 分辨率导致的误命中
                this.statsCache.set(fp, { stats: textStats, mtime: mtimeFromWorker, size: sizeFromWorker });
                this.largeApproxPending.delete(fp);
                // 失效目录聚合缓存以触发刷新
                this.markDirDirty(path.dirname(fp));
                this.enqueueDirRecompute(path.dirname(fp));
                wcDebug('largeFile:processing:done', fp, 'total', textStats.total);
                this.refreshDebounced();
            } catch (e) {
                wcDebug('largeFile:processing:error', fp, e);
                // 出错也移除，避免无限循环
                this.largeApproxPending.delete(fp);
            }
            // 小延迟让出事件循环，避免长时间占用
            await new Promise(res => setTimeout(res, 5));
        }
        // 队列清空后，对根目录做一次最终聚合，确保总数一致
        try {
            const roots = vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) || [];
            for (const r of roots) {
                this.markDirDirty(r);
                this.enqueueDirRecompute(r);
            }
            this.refreshDebounced();
        } catch { /* ignore */ }
        this.largeProcessingRunning = false;
    }

    // 目录聚合通过 dirAggCache 临时缓存，无持久化
    /** 标记目录脏：保存旧聚合值，移除现值（不递归） */
    private markDirDirty(dir: string) {
        if (!dir) return;
        const cur = this.dirAggCache.get(dir);
        if (cur) this.previousDirAggCache.set(dir, cur);
        this.dirAggCache.delete(dir);
    }

    /** 入队目录重算（事件链） */
    private enqueueDirRecompute(dir: string) {
        if (!dir) return;
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root || !dir.startsWith(root)) return;
        if (this.dirRecalcQueued.has(dir)) return;
        this.dirRecalcQueued.add(dir);
        this.dirRecalcQueue.push(dir);
        if (!this.dirRecalcProcessing) this.processDirRecalcQueue();
    }

    /** 处理目录重算队列：单层聚合+向上扩散 */
    private async processDirRecalcQueue() {
        this.dirRecalcProcessing = true;
        while (this.dirRecalcQueue.length) {
            const dir = this.dirRecalcQueue.shift()!;
            this.dirRecalcQueued.delete(dir);
            try { await this.recomputeDirAggregate(dir); } catch (e) { wcDebug('dirRecalc:error', dir, e); }
            const parent = path.dirname(dir);
            const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
            if (parent && parent !== dir && parent.startsWith(root)) this.enqueueDirRecompute(parent);
            this.refresh();
            await new Promise(r => setTimeout(r, 0));
        }
        this.dirRecalcProcessing = false;
    }

    /** 非递归聚合目录：依赖子目录已更新的聚合值 + 文件最新值（支持祖先目录强制） */
    private async recomputeDirAggregate(dir: string) {
        let agg: TextStats = { cjkChars: 0, asciiChars: 0, words: 0, nonWSChars: 0, total: 0 };
        try {
            const dirents = await fs.promises.readdir(dir, { withFileTypes: true });
            const exts = getSupportedExtensions();
            const forcedDir = this.isPathForced(dir); // ⬅ 当前目录是否处于强制状态

            for (const d of dirents) {
                const full = path.join(dir, d.name);

                if (shouldIgnoreWordCountFile(full, this.ignoreParser, {
                    workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
                    respectWcignore: vscode.workspace.getConfiguration('AndreaNovelHelper').get<boolean>('wordCount.respectWcignore', true),
                    respectGitignore: vscode.workspace.getConfiguration('AndreaNovelHelper').get<boolean>('wordCount.respectGitignore', true),
                    allowedLanguages: getAllowedExtensions()
                })) continue;

                if (d.isDirectory()) {
                    const childAgg = this.dirAggCache.get(full)?.stats;
                    if (childAgg) agg = mergeStats(agg, childAgg);

                    // 目录项这里不递归；若需要可在别处触发 analyzeFolderDynamic
                    // （保持“非递归聚合”的语义）
                } else {
                    const ext = path.extname(d.name).slice(1).toLowerCase();
                    const special = isSpecialVisibleFile(d.name);
                    if (!special && !exts.includes(ext)) continue;

                    const forcedHere = forcedDir || this.isPathForced(full); // ⬅ 文件是否被祖先目录强制
                    const cached = this.statsCache.get(full)?.stats;

                    if (cached) {
                        // 用旧值占位（避免 UI 抖动），但若是强制刷新，仍然派发精算
                        agg = mergeStats(agg, cached);
                        if (forcedHere) {
                            this.scheduleFileStat(full); // ⬅ 即便有缓存也派发后台重算
                        }
                    } else {
                        // 无缓存：不阻塞链式聚合；安排后台计算，回写后会再次聚合刷新
                        this.scheduleFileStat(full);
                    }
                }
            }
        } catch (e) { wcDebug('recomputeDirAggregate:error', dir, e); }

        this.dirAggCache.set(dir, { stats: agg, ts: Date.now() });
        this.previousDirAggCache.delete(dir);

        // 重算完成后清除目录 forced 标记（避免重复被视为强制状态）
        const rdir = path.resolve(dir);
        if (this.forcedPaths.has(rdir)) {
            this.forcedPaths.delete(rdir);
            wcDebug('dirAgg:forced-cleared', dir);
        }

        wcDebug('dirAgg:update:eventChain', dir, 'total', agg.total);
    }


    /** 目录聚合缓存 TTL(ms)，可配置 AndreaNovelHelper.wordCount.dirAggTTL，默认 2000，最小 500 */
    private getDirAggTTL(): number {
        try {
            const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
            const v = cfg.get<number>('wordCount.dirAggTTL', 2000) ?? 2000;
            return Math.max(500, v);
        } catch { return 2000; }
    }

    /** 通过路径拿到真实的 TreeItem */
    public getItemById(id: string): WordCountItem | undefined {
        const item = this.itemsById.get(id);
        return item instanceof WordCountItem ? item : undefined;
    }

    public getParent(element: WordCountItem): WordCountItem | undefined {
        const parentPath = path.dirname(element.resourceUri.fsPath);
        const item = this.itemsById.get(parentPath);
        return item instanceof WordCountItem ? item : undefined;
    }

    /** 获取文件的字数统计 */
    public async getFileStats(filePath: string): Promise<TextStats | null> {
        try {
            return await this.getOrCalculateFileStats(filePath);
        } catch (error) {
            console.error(`Error getting file stats for ${filePath}:`, error);
            return null;
        }
    }

    /** 获取文件的总字数 */
    public async getFileWordCount(filePath: string): Promise<number> {
        const stats = await this.getFileStats(filePath);
        return stats ? stats.total : 0;
    }

    /** 清理资源 */
    public dispose(): void {
        // 取消注册全局文件追踪回调
        unregisterFileChangeCallback('wordCount');
        
        if (this.gitGuard) {
            this.gitGuard.dispose();
        }
    }
}

export class WordCountItem extends vscode.TreeItem {
    constructor(
        public readonly resourceUri: vscode.Uri,
        public readonly label: string,
        private readonly stats: TextStats,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        private readonly isPlaceholder: boolean = false
    ) {
        super(label, collapsibleState);

        this.resourceUri = resourceUri;

        // 设置 contextValue 用于右键菜单
        const isDirectory = collapsibleState !== vscode.TreeItemCollapsibleState.None;
        this.contextValue = isDirectory ? 'wordCountFolder' : 'wordCountFile';
        const isFile = collapsibleState === vscode.TreeItemCollapsibleState.None;

        if (isPlaceholder) {
            // 占位阶段：同时在 description 中展示文件名，保证名称可见
            this.description = `${label} (计算中...)`;
            this.iconPath = new vscode.ThemeIcon('loading~spin');
            const tip = new vscode.MarkdownString();
            tip.appendMarkdown(`**路径**: \`${resourceUri.fsPath}\``);
            tip.appendMarkdown(`\n\n正在计算字数统计...`);
            tip.isTrusted = true;
            this.tooltip = tip;
        } else {
            // 根据配置格式化字数
            const cfg = vscode.workspace.getConfiguration();
            const mode = cfg.get<string>('AndreaNovelHelper.wordCount.displayFormat', 'raw');
            const total = stats.total;
            let formatted: string;
            switch (mode) {
                case 'wan':
                    if (total >= 10000) {
                        formatted = (total / 10000).toFixed(3).replace(/\.0+$/, '') + '万';
                    } else formatted = String(total);
                    break;
                case 'k':
                    if (total >= 1000) {
                        formatted = (total / 1000).toFixed(3).replace(/\.0+$/, '') + 'k';
                    } else formatted = String(total);
                    break;
                case 'qian':
                    if (total >= 1000) {
                        formatted = (total / 1000).toFixed(3).replace(/\.0+$/, '') + '千';
                    } else formatted = String(total);
                    break;
                case 'raw':
                default:
                    formatted = String(total);
            }
            this.description = `(${formatted})`;
        }

        this.id = this.resourceUri.fsPath;

        if (!isPlaceholder) {
            // 构造悬停提示
            const tip = new vscode.MarkdownString();
            tip.appendMarkdown(`**路径**: \`${resourceUri.fsPath}\``);
            tip.appendMarkdown(`\n\n中文字符数: **${stats.cjkChars}**`);
            tip.appendMarkdown(`\n\n英文单词数: **${stats.words}**`);
            tip.appendMarkdown(`\n\nASCII 字符数: **${stats.asciiChars}**`);
            tip.appendMarkdown(`\n\n非空白字符数: **${stats.nonWSChars}**`);
            tip.appendMarkdown(`\n\n**总字数**: **${stats.total}**`);
            // 附加 UUID（文件或目录）
            try {
                const fUuid = getFileUuid(resourceUri.fsPath);
                if (fUuid) {
                    tip.appendMarkdown(`\n\nUUID: \`${fUuid}\``);
                }
            } catch { /* ignore */ }
            // 剪切状态标记（从辅助模块获取剪切集合）
            try {
                const cutSet: Set<string> | null | undefined = getCutClipboard?.();
                if (cutSet && cutSet.has(resourceUri.fsPath)) {
                    tip.appendMarkdown(`\n\n$(scissors) **已剪切 (待粘贴)**`);
                    if (typeof this.description === 'string') {
                        if (!this.description.startsWith('✂')) {
                            this.description = `✂ ${this.description}`;
                        }
                    } else if (!this.description) {
                        this.description = '✂';
                    }
                }
            } catch { /* ignore */ }
            tip.isTrusted = true;
            this.tooltip = tip;
        }

        // 保持文件点击打开
        if (collapsibleState === vscode.TreeItemCollapsibleState.None) {
            this.command = {
                command: 'vscode.open',
                title: 'Open File',
                arguments: [resourceUri]
            };
        }

        if (isFile) {
            this.command = {
                command: 'AndreaNovelHelper.openFileWithDefault',
                title: 'Open File with Default',
                arguments: [this.resourceUri]
            };
        }
    }
}

// —— Order Manager 访问接口 ——
export interface HasOrderManager {
    setOrderManager(mgr: WordCountOrderManager): void;
    getOrderManager(): WordCountOrderManager | null;
}

// 为 provider 添加访问方法
export interface WordCountProvider extends HasOrderManager { }
(WordCountProvider.prototype as any).setOrderManager = function (mgr: WordCountOrderManager) { this.orderManager = mgr; };
(WordCountProvider.prototype as any).getOrderManager = function () { return this.orderManager; };

// // —— 打开方式工具函数（与包管理器一致）——
// async function executeOpenAction(action: string, uri: vscode.Uri): Promise<void> {
//     try {
//         switch (action) {
//             case 'vscode':
//                 await vscode.window.showTextDocument(uri);
//                 break;
//             case 'vscode-new':
//                 try {
//                     await vscode.commands.executeCommand('vscode.openWith', uri, 'default', vscode.ViewColumn.Beside);
//                 } catch {
//                     await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.Beside });
//                 }
//                 break;
//             case 'system-default':
//                 await vscode.env.openExternal(uri);
//                 break;
//             case 'explorer':
//                 await vscode.commands.executeCommand('revealFileInOS', uri);
//                 break;
//             default:
//                 await vscode.window.showTextDocument(uri);
//                 break;
//         }
//     } catch (error) {
//         vscode.window.showErrorMessage(`打开文件失败: ${error}`);
//     }
// }

// // —— 注册 openWith 命令 —__
// export function registerWordCountOpenWith(context: vscode.ExtensionContext) {
//     context.subscriptions.push(
//         vscode.commands.registerCommand('AndreaNovelHelper.openWith', async (node: any) => {
//             const uri = node.resourceUri || node.uri || node;
//             const filePath = uri.fsPath;
//             const fileName = path.basename(filePath);
//             try {
//                 await vscode.commands.executeCommand('explorer.openWith', uri);
//             } catch (error) {
//                 const options = [
//                     { label: 'VS Code 编辑器', description: '在当前编辑器中打开', action: 'vscode' },
//                     { label: 'VS Code 新窗口', description: '在新的 VS Code 窗口中打开', action: 'vscode-new' },
//                     { label: '系统默认程序', description: '使用系统默认关联程序打开', action: 'system-default' },
//                     { label: '文件资源管理器', description: '在文件资源管理器中显示', action: 'explorer' }
//                 ];
//                 const selected = await vscode.window.showQuickPick(options, {
//                     placeHolder: `选择打开 ${fileName} 的方式`,
//                     title: '打开方式'
//                 });
//                 if (selected) {
//                     await executeOpenAction(selected.action, uri);
//                 }
//             }
//         })
//     );
// }

// 在 WordCount 视图上注册复制/导出纯文本命令，复用 preview 的渲染逻辑
export function registerWordCountPlainTextCommands(context: vscode.ExtensionContext, provider: WordCountProvider) {
    // mdToPlainText helper imported statically above

    context.subscriptions.push(
        vscode.commands.registerCommand('WordCount.copyPlainText', async (node?: any) => {
            try {
                // Resolve URI from node if provided (TreeView invocation). Support several shapes.
                const resolveUri = (n: any): vscode.Uri | undefined => {
                    if (!n) return undefined;
                    if (n instanceof vscode.Uri) return n as vscode.Uri;
                    if (n.resourceUri && n.resourceUri instanceof vscode.Uri) return n.resourceUri as vscode.Uri;
                    if (typeof n === 'string') return vscode.Uri.file(n);
                    if (n.fsPath) return vscode.Uri.file(n.fsPath);
                    return undefined;
                };

                let uri = resolveUri(node);
                const invokedFromTree = !!uri;

                if (!uri) {
                    // fallback to active editor
                    const ed = vscode.window.activeTextEditor;
                    if (ed && ed.document) uri = ed.document.uri;
                }
                if (!uri) return;

                const doc = await vscode.workspace.openTextDocument(uri);

                // If invoked from tree, always render full document; if invoked without node, prefer selection.
                if (!invokedFromTree) {
                    const active = vscode.window.activeTextEditor;
                    if (active && active.document.uri.toString() === doc.uri.toString() && !active.selection.isEmpty) {
                        const sel = active.document.getText(active.selection);
                        const text = (doc.languageId === 'markdown') ? mdToPlainText(sel).text : sel;
                        await vscode.env.clipboard.writeText(text);
                        vscode.window.setStatusBarMessage('已复制纯文本（选区）', 1200);
                        return;
                    }
                }

                // Render whole document
                let text: string;
                try {
                    const maybe = (provider as any).renderToPlainText ? (provider as any).renderToPlainText(doc) : null;
                    if (maybe && typeof maybe.text === 'string') text = maybe.text;
                    else text = mdToPlainText(doc.getText()).text;
                } catch {
                    text = mdToPlainText(doc.getText()).text;
                }

                await vscode.env.clipboard.writeText(text);
                vscode.window.setStatusBarMessage('已复制纯文本（全文）', 1200);
            } catch (e) { /* ignore */ }
        }),
        vscode.commands.registerCommand('WordCount.exportTxt', async (node?: any) => {
            try {
                console.log('[exportTxt] argIsItem=', !!node, 'type=', node?.constructor?.name, 'uri=', node?.resourceUri?.fsPath);
                const resolveUri = (n: any): vscode.Uri | undefined => {
                    if (!n) return undefined;
                    if (n instanceof vscode.Uri) return n as vscode.Uri;
                    if (n.resourceUri && n.resourceUri instanceof vscode.Uri) return n.resourceUri as vscode.Uri;
                    if (typeof n === 'string') return vscode.Uri.file(n);
                    if (n.fsPath) return vscode.Uri.file(n.fsPath);
                    return undefined;
                };

                let uri = resolveUri(node);
                if (!uri) {
                    const ed = vscode.window.activeTextEditor;
                    if (ed && ed.document) uri = ed.document.uri;
                }
                if (!uri) return;

                const doc = await vscode.workspace.openTextDocument(uri);

                // Always render the file from disk (not relying on active editor content)
                let text: string;
                try {
                    const maybe = (provider as any).renderToPlainText ? (provider as any).renderToPlainText(doc) : null;
                    if (maybe && typeof maybe.text === 'string') text = maybe.text;
                    else text = mdToPlainText(doc.getText()).text;
                } catch {
                    text = mdToPlainText(doc.getText()).text;
                }

                const saveUri = await vscode.window.showSaveDialog({
                    defaultUri: uri.with({ path: uri.path.replace(/\.[^/\\.]+$/, '') + '.txt' }),
                    filters: { Text: ['txt'] }
                });
                if (!saveUri) return;
                await vscode.workspace.fs.writeFile(saveUri, new TextEncoder().encode(text));
                vscode.window.showInformationMessage(`导出完成：${saveUri.fsPath}`);
            } catch (e) { /* ignore */ }
        })
    );
}

// —— 在 activate.ts 里调用 registerWordCountOpenWith(context) —__