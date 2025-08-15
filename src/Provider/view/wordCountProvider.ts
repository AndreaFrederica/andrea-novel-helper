/* eslint-disable curly */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { countAndAnalyze, countWordsMixed, getSupportedExtensions, mergeStats, readTextFileDetectEncoding, TextStats, analyzeText } from '../../utils/utils';
import { CombinedIgnoreParser } from '../../utils/gitignoreParser';
import { sortItems } from '../../utils/sorter';
import { GitGuard } from '../../utils/gitGuard';
import { getFileTracker } from '../../utils/fileTracker';
import { WordCountOrderManager } from '../../utils/wordCountOrder';

// 特殊文件（无扩展名但需要显示）
function isSpecialVisibleFile(name: string): boolean {
    return name === '.gitignore' || name === '.wcignore';
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
    private isInitializing = false;
    private pendingRefresh = false;
    private refreshThrottleTimer: NodeJS.Timeout | null = null;
    private ignoreParser: CombinedIgnoreParser | null = null;

    // Git Guard 用于缓存优化
    private gitGuard: GitGuard;
    private orderManager: WordCountOrderManager | null = null;

    // 状态持久化
    private expandedNodes = new Set<string>();
    private memento: vscode.Memento;

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

            // 只刷新保存的文件相关的统计
            this.invalidateCache(doc.uri.fsPath);
            this.refreshDebounced();
        });
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            this.clearCache();
            this.initIgnoreParser();
            this.refresh();
        });

        // 初始化忽略解析器
        this.initIgnoreParser();
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
    }

    private invalidateCache(filePath: string) {
        // 删除文件缓存
        this.statsCache.delete(filePath);
        // 删除所有父目录缓存（因为文件夹统计依赖子文件）
        let dir = path.dirname(filePath);
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        while (dir && dir !== root && dir !== path.dirname(dir)) {
            this.statsCache.delete(dir);
            dir = path.dirname(dir);
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

        const exts = getSupportedExtensions();

        let dirents: fs.Dirent[] = [];
        try {
            dirents = await fs.promises.readdir(root, { withFileTypes: true });
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
            if (this.ignoreParser && this.ignoreParser.shouldIgnore(full)) continue;

            if (d.isDirectory()) {
                const isExpanded = this.expandedNodes.has(full);
                const cached = this.statsCache.get(full);
                if (cached) {
                    const item = new WordCountItem(
                        uri,
                        d.name,
                        cached.stats,
                        isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
                        false
                    );
                    item.id = full;
                    this.itemsById.set(item.id, item);
                    items.push(item);
                } else {
                    // 占位符，稍后异步计算
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
                    const item = new WordCountItem(uri, d.name, cached.stats, vscode.TreeItemCollapsibleState.None, false);
                    item.id = full;
                    this.itemsById.set(item.id, item);
                    items.push(item);
                } else {
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

        // 异步批量计算，分批刷新
        if (needsAsync) {
            void this.calculateStatsAsync(root, exts, dirents).then(() => {
                // 最后统一刷新一次，确保占位符替换为真实统计
                this.refresh();
            });
        }

        return sortedItems;
    }


    /**
     * 递归分析一个文件夹下所有匹配文件，聚合 TextStats
     */
    private async analyzeFolder(folder: string, exts: string[]): Promise<TextStats> {
        let agg: TextStats = { cjkChars: 0, asciiChars: 0, words: 0, nonWSChars: 0, total: 0 };

        try {
            const dirents = await fs.promises.readdir(folder, { withFileTypes: true });

            for (const d of dirents) {
                const full = path.join(folder, d.name);

                // 检查是否应该被忽略（gitignore 或 wcignore）
                if (this.ignoreParser && this.ignoreParser.shouldIgnore(full)) {
                    continue;
                }

                if (d.isDirectory()) {
                    const child = await this.getOrCalculateFolderStats(full, exts);
                    agg = mergeStats(agg, child);
                } else {
                    const ext = path.extname(d.name).slice(1).toLowerCase();
                    if (!exts.includes(ext)) continue;
                    const stats = await this.getOrCalculateFileStats(full);
                    agg = mergeStats(agg, stats);
                }
            }
        } catch (error) {
            console.error(`Error analyzing folder ${folder}:`, error);
        }

        return agg;
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
                tasks.push(this.getOrCalculateFolderStats(full, exts).then(() => { }));
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
    private async getOrCalculateFileStats(filePath: string): Promise<TextStats> {
        try {
            const stat = await fs.promises.stat(filePath);
            const mtime = stat.mtimeMs;

            // 1. 检查内存缓存
            const cached = this.statsCache.get(filePath);
            if (cached && cached.mtime === mtime) {
                return cached.stats;
            }

            // 2. 检查持久化缓存（从文件追踪数据库）
            const fileTracker = getFileTracker();
            if (fileTracker) {
                const dataManager = fileTracker.getDataManager();
                const fileMetadata = dataManager.getFileByPath(filePath);

                if (fileMetadata && fileMetadata.wordCountStats) {
                    // 如果文件的 mtime 没有变化，使用持久化的统计数据
                    if (fileMetadata.mtime === mtime) {
                        const stats = fileMetadata.wordCountStats;
                        // 更新内存缓存
                        this.statsCache.set(filePath, { stats, mtime });
                        return stats;
                    }
                }
            }

            // 3. 使用 GitGuard 检查是否需要重新计算
            const uri = vscode.Uri.file(filePath);
            const shouldRecalculate = await this.gitGuard.shouldCount(uri);

            if (!shouldRecalculate && cached) {
                // Git 认为文件没有变化，使用现有缓存
                return cached.stats;
            }

            // 4. 重新计算统计
            const stats = await countAndAnalyze(filePath);

            // 5. 更新内存缓存
            this.statsCache.set(filePath, { stats, mtime });

            // 6. 持久化到文件追踪数据库
            if (fileTracker) {
                const dataManager = fileTracker.getDataManager();
                await dataManager.addOrUpdateFile(filePath);
                dataManager.updateWordCountStats(filePath, stats);
            }

            // 7. 通知 GitGuard 已完成统计
            const content = await readTextFileDetectEncoding(filePath);
            this.gitGuard.markCounted(uri, content);

            return stats;
        } catch (error) {
            console.error(`Error calculating stats for ${filePath}:`, error);
            return { cjkChars: 0, asciiChars: 0, words: 0, nonWSChars: 0, total: 0 };
        }
    }

    /**
     * 获取或计算文件夹统计（带缓存和 Git 优化）
     */
    private async getOrCalculateFolderStats(folder: string, exts: string[]): Promise<TextStats> {
        try {
            const stat = await fs.promises.stat(folder);
            const mtime = stat.mtimeMs;

            // 1. 检查内存缓存
            const cached = this.statsCache.get(folder);
            if (cached && cached.mtime === mtime) {
                return cached.stats;
            }

            // 2. 检查持久化缓存（从文件追踪数据库）
            const fileTracker = getFileTracker();
            if (fileTracker) {
                const dataManager = fileTracker.getDataManager();
                const fileMetadata = dataManager.getFileByPath(folder);

                if (fileMetadata && fileMetadata.wordCountStats) {
                    // 如果文件夹的 mtime 没有变化，使用持久化的统计数据
                    if (fileMetadata.mtime === mtime) {
                        const stats = fileMetadata.wordCountStats;
                        // 更新内存缓存
                        this.statsCache.set(folder, { stats, mtime });
                        return stats;
                    }
                }
            }

            // 3. 重新计算统计
            const stats = await this.analyzeFolder(folder, exts);

            // 4. 更新内存缓存
            this.statsCache.set(folder, { stats, mtime });

            // 5. 持久化到文件追踪数据库（可选，文件夹统计变化较少）
            if (fileTracker) {
                const dataManager = fileTracker.getDataManager();
                try {
                    // 避免重复对目录做深度 stat 引起的 EISDIR；addOrUpdateFile 已能区分目录
                    await dataManager.addOrUpdateFile(folder);
                    dataManager.updateWordCountStats(folder, stats);
                } catch (error) {
                    // 忽略目录追踪异常
                }
            }

            return stats;
        } catch (error) {
            console.error(`Error calculating folder stats for ${folder}:`, error);
            return { cjkChars: 0, asciiChars: 0, words: 0, nonWSChars: 0, total: 0 };
        }
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
                const { getFileUuid } = require('../../utils/globalFileTracking');
                const fUuid = getFileUuid(resourceUri.fsPath);
                if (fUuid) {
                    tip.appendMarkdown(`\n\nUUID: \
\`${fUuid}\``);
                }
            } catch { /* ignore */ }
            // 剪切状态标记（从辅助模块获取剪切集合）
            try {
                const { getCutClipboard } = require('../../utils/wordCountCutHelper');
                const cutSet: Set<string> | undefined = getCutClipboard?.();
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