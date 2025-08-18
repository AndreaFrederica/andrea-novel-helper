/* eslint-disable curly */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { countAndAnalyze, countWordsMixed, getSupportedExtensions, mergeStats, readTextFileDetectEncoding, TextStats, analyzeText } from '../../utils/utils';
import { countAndAnalyzeOffThread } from '../../utils/asyncWordCounter';
import { CombinedIgnoreParser } from '../../utils/gitignoreParser';
import { sortItems } from '../../utils/sorter';
import { GitGuard } from '../../utils/gitGuard';
import { getFileTracker } from '../../utils/fileTracker';
import * as timeStatsModule from '../../timeStats';
import { getFileByPath, updateFileWritingStats, getFileUuid } from '../../utils/globalFileTracking';
import { getCutClipboard } from '../../utils/wordCountCutHelper';
import { WordCountOrderManager } from '../../utils/wordCountOrder';

// 特殊文件（无扩展名但需要显示）
function isSpecialVisibleFile(name: string): boolean {
    return name === '.gitignore' || name === '.wcignore';
}

// 内置始终忽略的目录 / 文件（无需用户在 .gitignore 或 .wcignore 中显式声明）
// 目的：避免遍历版本库 / 依赖包 等大量无关内容造成性能浪费与大量 0 统计噪声
const ALWAYS_IGNORE_DIR_NAMES = new Set([
    '.git', '.svn', '.hg', '.DS_Store', 'node_modules', '.idea', '.vscode-test'
]);

function alwaysIgnore(fullPath: string, direntName: string, isDir: boolean): boolean {
    if (ALWAYS_IGNORE_DIR_NAMES.has(direntName)) return true;
    // 额外保护：如果路径中包含 node_modules/.git 也跳过（防止多工作区嵌套）
    if (fullPath.includes(`${path.sep}node_modules${path.sep}`)) return true;
    if (fullPath.includes(`${path.sep}.git${path.sep}`)) return true;
    return false;
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
    private statsCache = new Map<string, { stats: TextStats; mtime: number }>();
    // 目录临时聚合缓存（仅内存，含时间戳；文件/目录变化、强制重算或 TTL 过期时失效）
    private dirAggCache = new Map<string, { stats: TextStats; ts: number }>();
    // 目录旧值缓存：当聚合被失效删除时暂存旧值供 UI 显示，直到新值计算完成
    private previousDirAggCache = new Map<string, { stats: TextStats; ts: number }>();
    // 格式化缓存年龄
    private formatCacheAge(ms: number): string {
        if (ms < 1000) return '<1s';
        if (ms < 60_000) return (ms/1000).toFixed(ms < 5000 ? 1 : 0) + 's';
        const m = Math.floor(ms/60000); const s = Math.floor((ms%60000)/1000);
        return `${m}m${s > 0 ? s+'s' : ''}`;
    }
    // 目录聚合进行中的 Promise，用于并发去重
    private inFlightDirAgg = new Map<string, Promise<TextStats>>();
    private isInitializing = false;
    private pendingRefresh = false;
    private refreshThrottleTimer: NodeJS.Timeout | null = null;
    private ignoreParser: CombinedIgnoreParser | null = null;

    // 大文件异步精确统计支持
    private largeApproxPending = new Set<string>(); // 仍为估算结果等待精确统计
    private largeProcessingQueue: string[] = []; // 等待后台处理队列
    private largeProcessingRunning = false; // 是否在运行队列

    // Git Guard 用于缓存优化
    private gitGuard: GitGuard;
    private orderManager: WordCountOrderManager | null = null;
    // 强制重算列表：包含后一次访问时无条件重新计算并跳过持久化缓存
    private forcedPaths = new Set<string>();

    // 状态持久化
    private expandedNodes = new Set<string>();
    private memento: vscode.Memento;
    private hasGitRepo = false;            // 是否存在 Git 仓库 (.git)
    private cacheTrusted = false;          // 仅在有 Git 时才认为缓存可信
    private verifying = new Set<string>(); // 正在校验的文件，避免并发重复

    constructor(memento: vscode.Memento, orderManager?: WordCountOrderManager) {
        this.memento = memento;
        this.gitGuard = new GitGuard();
        this.orderManager = orderManager ?? null;

        // 从工作区状态恢复展开状态
        const savedState = this.memento.get<string[]>('wordCountExpandedNodes', []);
        this.expandedNodes = new Set(savedState);

        // 初始化 GitGuard
        this.initializeGitGuard();

        vscode.workspace.onDidSaveTextDocument((doc) => {
            // 检查是否是 .gitignore 或 .wcignore 文件
            const fileName = path.basename(doc.uri.fsPath);
            // Add logic to handle orderManager if needed
            if (fileName === '.gitignore' || fileName === '.wcignore') {
                // 重新初始化忽略解析器
                this.initIgnoreParser();
                this.clearCache();
                this.refresh();
                return;
            }

            const fsPath = doc.uri.fsPath;
            this.invalidateCache(fsPath);
            // 尝试从 timeStats 运行时状态复用实时字数（避免依赖全局追踪缓存）
            let reused = false;
            try {
                const timeStats = timeStatsModule;
                // 使用 timeStats 全量 analyzeText 结果（computeZhEnCount 已包装）
                const active = vscode.window.visibleTextEditors.find(ed=>ed.document.uri.fsPath===fsPath);
                if (active) {
                    const text = active.document.getText();
                    const compute = timeStats.computeZhEnCount;
                    const cnt = compute ? compute(text) : null;
                    const full: TextStats | null = cnt?.full || null;
                    if (full) {
                        this.statsCache.set(fsPath, { stats: full, mtime: fs.statSync(fsPath).mtimeMs });
                        reused = true;
                    } else {
                        // 兜底：强制重算（避免不一致）
                        console.warn('无法复用实时字数统计，强制重算:', fsPath);
                        this.forcedPaths.add(path.resolve(fsPath));
                    }
                }
            } catch { /* ignore */ }
            if (!reused) {
                // 更新统计数据失败
                console.error('更新统计数据失败:', fsPath);
            }
            this.refreshDebounced();
        });
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            this.clearCache();
            this.initIgnoreParser();
            this.refresh();
        });

        // 删除事件：失效相关目录聚合缓存与文件缓存
        vscode.workspace.onDidDeleteFiles(evt => {
            let changed = false;
            for (const f of evt.files) {
                const p = f.fsPath;
                if (this.statsCache.delete(p)) changed = true;
                // 删除子文件缓存（目录不缓存文件以外聚合，但存在文件缓存需要移除）
                for (const key of Array.from(this.statsCache.keys())) {
                    if (key.startsWith(p + path.sep)) { this.statsCache.delete(key); changed = true; }
                }
                // 失效向上目录聚合
                this.invalidateDirAggUpwards(p);
                // 删除自身或子目录聚合缓存
                for (const key of Array.from(this.dirAggCache.keys())) {
                    if (key === p || key.startsWith(p + path.sep)) { this.dirAggCache.delete(key); changed = true; }
                }
            }
            if (changed) this.refreshDebounced();
        });

        // 重命名事件：迁移文件缓存并失效涉及目录聚合
        vscode.workspace.onDidRenameFiles(evt => {
            let changed = false;
            for (const { oldUri, newUri } of evt.files) {
                const oldPath = oldUri.fsPath;
                const newPath = newUri.fsPath;
                // 迁移文件缓存
                const direct = this.statsCache.get(oldPath);
                if (direct) { this.statsCache.set(newPath, direct); this.statsCache.delete(oldPath); changed = true; }
                for (const key of Array.from(this.statsCache.keys())) {
                    if (key.startsWith(oldPath + path.sep)) {
                        const suffix = key.slice(oldPath.length);
                        const newKey = newPath + suffix;
                        const val = this.statsCache.get(key)!;
                        this.statsCache.set(newKey, val);
                        this.statsCache.delete(key);
                        changed = true;
                    }
                }
                // 失效旧/新路径相关目录聚合
                this.invalidateDirAggUpwards(oldPath);
                this.invalidateDirAggUpwards(newPath);
                for (const key of Array.from(this.dirAggCache.keys())) {
                    if (key === oldPath || key.startsWith(oldPath + path.sep)) { this.dirAggCache.delete(key); changed = true; }
                }
            }
            if (changed) this.refreshDebounced();
        });

        // 初始化忽略解析器
        this.initIgnoreParser();

        // 检测 Git 仓库并处理缓存可信度
        this.detectGitRepoAndMaybeRescan();

        // 延迟执行一次文件排序键迁移（确保 globalFileTracking 有时间生成 UUID）
        setTimeout(()=>{
            try { this.orderManager?.migrateAllFileKeys?.(); } catch { /* ignore */ }
        }, 1500);
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
        this.statsCache.clear();
    this.dirAggCache.clear();
        try { (this.gitGuard as any)?.reset?.(); } catch { /* ignore */ }
    // 仅标记根目录，递归统计时向下传播强制标志，避免重复计算所有叶子
    const roots = vscode.workspace.workspaceFolders?.map(f=>f.uri.fsPath) || [];
    for (const r of roots) this.forcedPaths.add(path.resolve(r));
        this.refresh();
    }

    /**
     * 强制重算指定文件（或目录下所有文件）。
     */
    public forceRecountPath(targetPath: string) {
        if (!targetPath) return;
        wcDebug('forceRecount:path', targetPath);
        const stat = (()=>{ try { return fs.statSync(targetPath); } catch { return null; } })();
        if (!stat) return;
        const affected: string[] = [];
        if (stat.isDirectory()) {
            const walk = (dir: string) => {
                try {
                    for (const d of fs.readdirSync(dir,{withFileTypes:true})) {
                        const full = path.join(dir,d.name);
                        if (d.isDirectory()) walk(full); else affected.push(full); // 仍收集文件用于失效，其统计稍后按需重新计算
                    }
                } catch { /* ignore */ }
            };
            walk(targetPath);
            // 仅标记该目录本身；文件通过父目录传播强制重算
            this.forcedPaths.add(path.resolve(targetPath));
        } else {
            affected.push(targetPath);
        }
        for (const f of affected) {
            this.statsCache.delete(f);
            try { (this.gitGuard as any)?.reset?.(f); } catch { /* ignore */ }
        }
        // 失效被操作路径及上层目录聚合缓存
        this.invalidateDirAggUpwards(targetPath);
        if (stat.isDirectory()) {
            for (const key of Array.from(this.dirAggCache.keys())) {
                if (key === targetPath || key.startsWith(targetPath + path.sep)) this.dirAggCache.delete(key);
            }
        }
        // 目录层级缓存失效
        for (const f of affected) {
            this.invalidateCache(f);
            // 单文件强制时才直接标记文件
            if (!stat.isDirectory()) this.forcedPaths.add(path.resolve(f));
        }
        this.refresh();
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
            const stat = await fs.promises.stat(filePath).catch(()=>null);
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
            if (fresh.total !== baseline.total) {
                wcDebug('verification:mismatch', filePath, 'cached', baseline.total, 'fresh', fresh.total);
                // 更新内存缓存（使 UI 立即正确）
                this.statsCache.set(filePath, { stats: fresh, mtime });
                // 失效父目录缓存促使重算聚合
                this.invalidateCache(filePath);
                // 可选：立即刷新视图
                this.refresh();
                // 更新持久化（确保后续启动正确）
                const ft = getFileTracker();
                if (ft) {
                    try {
                        const dm = ft.getDataManager();
                        await dm.addOrUpdateFile(filePath);
                        dm.updateWordCountStats(filePath, fresh);
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

            // 忽略规则
            if (alwaysIgnore(full, d.name, d.isDirectory())) { wcDebug('skip:alwaysIgnore', full); continue; }
            if (this.ignoreParser && this.ignoreParser.shouldIgnore(full)) {
                wcDebug('skip:ignored', full);
                continue;
            }

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
                if (!special && !exts.includes(ext)) continue;

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
                wordCountItems.sort((a,b)=>{
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
                    return a.label.localeCompare(b.label,'zh');
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
                for (let i=0;i<wordCountItems.length;i++) {
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
    private async analyzeFolderDynamic(folder: string, exts: string[]): Promise<TextStats> {
        const forced = this.forcedPaths.has(path.resolve(folder));
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
                    if (alwaysIgnore(path.join(folder, d.name), d.name, d.isDirectory())) continue;
                    if (this.ignoreParser && this.ignoreParser.shouldIgnore(path.join(folder, d.name))) continue;
                    if (d.isDirectory()) subDirs.push(d); else files.push(d);
                }
                const forcedInner = this.forcedPaths.has(path.resolve(folder));
                // 先处理文件（并发批次）
                const fileBatchSize = 6;
                for (let i=0;i<files.length;i+=fileBatchSize) {
                    const batch = files.slice(i,i+fileBatchSize);
                    const statsArr = await Promise.all(batch.map(async d => {
                        const full = path.join(folder, d.name);
                        const ext = path.extname(d.name).slice(1).toLowerCase();
                        const special = isSpecialVisibleFile(d.name);
                        if (!special && !exts.includes(ext)) return null;
                        try { return await this.getOrCalculateFileStats(full, forcedInner); } catch { return null; }
                    }));
                    for (const st of statsArr) if (st) agg = mergeStats(agg, st);
                    // 让出事件循环，避免长任务
                    await new Promise(r=>setTimeout(r,0));
                }
                // 再处理子目录（并发+分批）
                const dirBatchSize = 2; // 控制递归并发
                for (let i=0;i<subDirs.length;i+=dirBatchSize) {
                    const batch = subDirs.slice(i,i+dirBatchSize);
                    const subStats = await Promise.all(batch.map(async d => {
                        const full = path.join(folder, d.name);
                        try { return await this.analyzeFolderDynamic(full, exts); } catch { return null; }
                    }));
                    for (const st of subStats) if (st) agg = mergeStats(agg, st);
                    await new Promise(r=>setTimeout(r,0));
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
     * 创建占位符项目（初始加载时显示）
     */
    private createPlaceholderItems(root: string, dirents: fs.Dirent[], exts: string[]): WordCountItem[] {
        const items: WordCountItem[] = [];

        for (const d of dirents) {
            const uri = vscode.Uri.file(path.join(root, d.name));

            // 检查是否应该被忽略（gitignore 或 wcignore）
            if (this.ignoreParser && this.ignoreParser.shouldIgnore(uri.fsPath)) {
                continue;
            }

            if (d.isDirectory()) {
                const placeholderStats: TextStats = { cjkChars: 0, asciiChars: 0, words: 0, nonWSChars: 0, total: 0 };
                // 根据保存的状态决定展开状态
                const isExpanded = this.expandedNodes.has(uri.fsPath);
                const item = new WordCountItem(uri, d.name, placeholderStats,
                    isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed, true);
                item.id = uri.fsPath;
                this.itemsById.set(item.id, item);
                items.push(item);
            } else {
                const ext = path.extname(d.name).slice(1).toLowerCase();
                const special = isSpecialVisibleFile(d.name);
                if (!special && !exts.includes(ext)) continue;
                const placeholderStats: TextStats = { cjkChars: 0, asciiChars: 0, words: 0, nonWSChars: 0, total: 0 };
                const item = new WordCountItem(uri, d.name, placeholderStats, vscode.TreeItemCollapsibleState.None, true);
                item.id = uri.fsPath;
                this.itemsById.set(item.id, item);
                items.push(item);
            }
        }

        return items;
    }

    /**
     * 异步计算所有统计数据
     */
    private async calculateStatsAsync(root: string, exts: string[], dirents: fs.Dirent[]) {
        const tasks: Promise<void>[] = [];

        for (const d of dirents) {
            const full = path.join(root, d.name);

            // 检查是否应该被忽略（gitignore 或 wcignore）
            if (this.ignoreParser && this.ignoreParser.shouldIgnore(full)) {
                continue;
            }

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
                    tasks.push(this.getOrCalculateFileStats(full).then(() => { }));
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
                this.refresh();
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

            // 1. 检查内存缓存
            const cached = this.statsCache.get(filePath);
            const prevStats: TextStats | undefined = cached?.stats; // 目录不缓存，仅用于文件更新时替换
            const isForced = forceOverride || this.forcedPaths.has(path.resolve(filePath));
            if (!isForced && cached && cached.mtime === mtime && !this.largeApproxPending.has(filePath)) {
                wcDebug('cache-hit:memory:file', filePath, 'mtime', mtime);
                return cached.stats;
            }

            // 1.5 大文件快速估算路径（若无精确缓存或缓存为过期）
            if (!isForced && size > largeThreshold && !this.largeApproxPending.has(filePath)) {
                // 生成估算结果（只估 total，其余置 0）
                const estimatedTotal = Math.max(1, Math.floor(size / Math.max(0.1, avgBytesPerChar)));
                const est: TextStats = { cjkChars: 0, asciiChars: 0, words: 0, nonWSChars: 0, total: estimatedTotal };
                this.statsCache.set(filePath, { stats: est, mtime });
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
                    // 如果文件的 mtime 没有变化，使用持久化的统计数据，并向上失效目录聚合（触发父级重算）
                    if (fileMetadata.mtime === mtime) {
                        wcDebug('cache-hit:persistent:file', filePath, 'mtime', mtime);
                        const stats = fileMetadata.wordCountStats;
                        this.statsCache.set(filePath, { stats, mtime });
                        this.invalidateDirAggUpwards(filePath);
                        return stats;
                    }
                    else {
                        wcDebug('cache-stale:persistent:file', filePath, 'cachedMtime', fileMetadata.mtime, 'current', mtime);
                    }
                }
            }

            // 3. 使用 GitGuard 检查是否需要重新计算
            const uri = vscode.Uri.file(filePath);
            const shouldRecalculate = isForced ? true : await this.gitGuard.shouldCount(uri);
            wcDebug('gitGuard:shouldCount', filePath, shouldRecalculate, 'forced', isForced);

            if (!shouldRecalculate && cached) {
                // Git 认为文件没有变化，使用现有缓存
                wcDebug('gitGuard-skip-using-stale-memory-cache', filePath);
                return cached.stats;
            }

            // 4. 重新计算统计
            wcDebug('recount:file:start', filePath);
            const stats = await countAndAnalyzeOffThread(filePath);
            wcDebug('recount:file:done', filePath, stats.total);
            // 同步更新实时写作统计（若开启 writingStats 并存在记录），用于 TreeView 显示与状态栏保持一致
            try {
                const meta = getFileByPath?.(filePath);
                if (meta) {
                    // 仅更新 wordCountStats 与 writingStats 无直接耦合；此处可选择在 wordCountStats 变化时触发刷新
                    // 若需要，可在此追加其它联动逻辑
                }
            } catch { /* ignore */ }
            if (stats.total === 0) {
                // 可能是解码失败或全部被识别为空白，调试输出
                const debug = vscode.workspace.getConfiguration('AndreaNovelHelper').get<boolean>('wordCount.debug', false);
                if (debug) {
                    console.warn('[WordCount][zeroFile]', filePath);
                }
            }

            // 5. 更新内存缓存
            this.statsCache.set(filePath, { stats, mtime });

            // 文件变更后失效上层目录聚合缓存（回退到旧逻辑）
            this.invalidateDirAggUpwards(filePath);

            // 6. 持久化到文件追踪数据库
            if (fileTracker) {
                const dataManager = fileTracker.getDataManager();
                await dataManager.addOrUpdateFile(filePath);
                dataManager.updateWordCountStats(filePath, stats);
                wcDebug('persistent-update:file', filePath);
            }

            // 7. 通知 GitGuard 已完成统计
            const content = await readTextFileDetectEncoding(filePath);
            this.gitGuard.markCounted(uri, content);
            wcDebug('gitGuard:markCounted', filePath, 'size', content.length);
            if (isForced && !forceOverride) this.forcedPaths.delete(path.resolve(filePath));

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
            if (!this.largeApproxPending.has(fp)) continue; // 已经被其它途径精确统计
            try {
                wcDebug('largeFile:processing:start', fp);
                const stat = await fs.promises.stat(fp).catch(()=>null);
                if (!stat || !stat.isFile()) { this.largeApproxPending.delete(fp); continue; }
                const mtime = stat.mtimeMs;
                const stats = await countAndAnalyzeOffThread(fp);
                this.statsCache.set(fp, { stats, mtime });
                this.largeApproxPending.delete(fp);
                // 失效目录聚合缓存以触发刷新
                this.invalidateDirAggUpwards(fp);
                wcDebug('largeFile:processing:done', fp, 'total', stats.total);
                this.refreshDebounced();
            } catch (e) {
                wcDebug('largeFile:processing:error', fp, e);
                // 出错也移除，避免无限循环
                this.largeApproxPending.delete(fp);
            }
            // 小延迟让出事件循环，避免长时间占用
            await new Promise(res=>setTimeout(res, 5));
        }
        this.largeProcessingRunning = false;
    }

    // 目录聚合通过 dirAggCache 临时缓存，无持久化

    /** 失效从文件/目录开始逐级向上的目录聚合缓存 */
    private invalidateDirAggUpwards(startPath: string) {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        let dir = path.dirname(startPath);
        while (dir && dir !== root && dir !== path.dirname(dir)) {
            const old = this.dirAggCache.get(dir);
            if (old) this.previousDirAggCache.set(dir, old);
            if (this.dirAggCache.delete(dir)) wcDebug('dirAggCache:invalidate', dir, 'dueTo', startPath);
            dir = path.dirname(dir);
        }
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
                        formatted = (total / 10000).toFixed(3).replace(/\.0+$/,'') + '万';
                    } else formatted = String(total);
                    break;
                case 'k':
                    if (total >= 1000) {
                        formatted = (total / 1000).toFixed(3).replace(/\.0+$/,'') + 'k';
                    } else formatted = String(total);
                    break;
                case 'qian':
                    if (total >= 1000) {
                        formatted = (total / 1000).toFixed(3).replace(/\.0+$/,'') + '千';
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
            tip.appendMarkdown(`\n\n非 ASCII 字符数: **${stats.asciiChars}**`);
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
export interface WordCountProvider extends HasOrderManager {}
(WordCountProvider.prototype as any).setOrderManager = function(mgr: WordCountOrderManager){ this.orderManager = mgr; };
(WordCountProvider.prototype as any).getOrderManager = function(){ return this.orderManager; };

// —— 打开方式工具函数（与包管理器一致）——
async function executeOpenAction(action: string, uri: vscode.Uri): Promise<void> {
    try {
        switch (action) {
            case 'vscode':
                await vscode.window.showTextDocument(uri);
                break;
            case 'vscode-new':
                try {
                    await vscode.commands.executeCommand('vscode.openWith', uri, 'default', vscode.ViewColumn.Beside);
                } catch {
                    await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.Beside });
                }
                break;
            case 'system-default':
                await vscode.env.openExternal(uri);
                break;
            case 'explorer':
                await vscode.commands.executeCommand('revealFileInOS', uri);
                break;
            default:
                await vscode.window.showTextDocument(uri);
                break;
        }
    } catch (error) {
        vscode.window.showErrorMessage(`打开文件失败: ${error}`);
    }
}

// —— 注册 openWith 命令 —__
export function registerWordCountOpenWith(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.openWith', async (node: any) => {
            const uri = node.resourceUri || node.uri || node;
            const filePath = uri.fsPath;
            const fileName = path.basename(filePath);
            try {
                await vscode.commands.executeCommand('explorer.openWith', uri);
            } catch (error) {
                const options = [
                    { label: 'VS Code 编辑器', description: '在当前编辑器中打开', action: 'vscode' },
                    { label: 'VS Code 新窗口', description: '在新的 VS Code 窗口中打开', action: 'vscode-new' },
                    { label: '系统默认程序', description: '使用系统默认关联程序打开', action: 'system-default' },
                    { label: '文件资源管理器', description: '在文件资源管理器中显示', action: 'explorer' }
                ];
                const selected = await vscode.window.showQuickPick(options, {
                    placeHolder: `选择打开 ${fileName} 的方式`,
                    title: '打开方式'
                });
                if (selected) {
                    await executeOpenAction(selected.action, uri);
                }
            }
        })
    );
}

// —— 在 activate.ts 里调用 registerWordCountOpenWith(context) —__