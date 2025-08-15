/* eslint-disable curly */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { countAndAnalyze, countWordsMixed, getSupportedExtensions, mergeStats, readTextFileDetectEncoding, TextStats } from '../../utils/utils';
import { CombinedIgnoreParser } from '../../utils/gitignoreParser';
import { sortItems } from '../../utils/sorter';

export class WordCountProvider implements vscode.TreeDataProvider<WordCountItem> {
    private _onDidChange = new vscode.EventEmitter<WordCountItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChange.event;
    private itemsById = new Map<string, WordCountItem>();
    
    // 缓存机制
    private statsCache = new Map<string, { stats: TextStats; mtime: number }>();
    private isInitializing = false;
    private pendingRefresh = false;
    private ignoreParser: CombinedIgnoreParser | null = null;
    
    // 状态持久化
    private expandedNodes = new Set<string>();
    private memento: vscode.Memento;

    constructor(memento: vscode.Memento) {
        this.memento = memento;
        // 从工作区状态恢复展开状态
        const savedState = this.memento.get<string[]>('wordCountExpandedNodes', []);
        this.expandedNodes = new Set(savedState);
        
        vscode.workspace.onDidSaveTextDocument((doc) => {
            // 检查是否是 .gitignore 或 .wcignore 文件
            const fileName = path.basename(doc.uri.fsPath);
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
        if (this.pendingRefresh) return;
        this.pendingRefresh = true;
        setTimeout(() => {
            this.pendingRefresh = false;
            this.refresh();
        }, 500); // 500ms 防抖
    }

    refresh() { 
        this._onDidChange.fire(undefined); 
    }

    // 保存展开状态到工作区
    private saveExpandedState(): void {
        this.memento.update('wordCountExpandedNodes', Array.from(this.expandedNodes));
    }

    // 处理节点展开
    onDidExpandElement(node: WordCountItem): void {
        this.expandedNodes.add(node.id!);
        this.saveExpandedState();
    }

    // 处理节点折叠
    onDidCollapseElement(node: WordCountItem): void {
        this.expandedNodes.delete(node.id!);
        this.saveExpandedState();
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

    getTreeItem(item: WordCountItem): vscode.TreeItem {
        return item;
    }

    async getChildren(element?: WordCountItem): Promise<WordCountItem[]> {
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

        const items: WordCountItem[] = [];
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
                if (!exts.includes(ext)) continue;

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
        sortItems(items);

        // 异步批量计算，分批刷新
        if (needsAsync) {
            void this.calculateStatsAsync(root, exts, dirents).then(() => {
                // 最后统一刷新一次，确保占位符替换为真实统计
                this.refresh();
            });
        }

        return items;
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
                if (!exts.includes(ext)) continue;
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
                tasks.push(this.getOrCalculateFolderStats(full, exts).then(() => {}));
            } else {
                const ext = path.extname(d.name).slice(1).toLowerCase();
                if (exts.includes(ext)) {
                    tasks.push(this.getOrCalculateFileStats(full).then(() => {}));
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
     * 获取或计算文件统计（带缓存）
     */
    private async getOrCalculateFileStats(filePath: string): Promise<TextStats> {
        try {
            const stat = await fs.promises.stat(filePath);
            const mtime = stat.mtimeMs;
            
            // 检查缓存
            const cached = this.statsCache.get(filePath);
            if (cached && cached.mtime === mtime) {
                return cached.stats;
            }

            // 重新计算
            const stats = await countAndAnalyze(filePath);
            this.statsCache.set(filePath, { stats, mtime });
            return stats;
        } catch (error) {
            console.error(`Error calculating stats for ${filePath}:`, error);
            return { cjkChars: 0, asciiChars: 0, words: 0, nonWSChars: 0, total: 0 };
        }
    }

    /**
     * 获取或计算文件夹统计（带缓存）
     */
    private async getOrCalculateFolderStats(folder: string, exts: string[]): Promise<TextStats> {
        try {
            const stat = await fs.promises.stat(folder);
            const mtime = stat.mtimeMs;
            
            // 检查缓存
            const cached = this.statsCache.get(folder);
            if (cached && cached.mtime === mtime) {
                return cached.stats;
            }

            // 重新计算
            const stats = await this.analyzeFolder(folder, exts);
            this.statsCache.set(folder, { stats, mtime });
            return stats;
        } catch (error) {
            console.error(`Error calculating folder stats for ${folder}:`, error);
            return { cjkChars: 0, asciiChars: 0, words: 0, nonWSChars: 0, total: 0 };
        }
    }

    /** 通过路径拿到真实的 TreeItem */
    public getItemById(id: string): WordCountItem | undefined {
        return this.itemsById.get(id);
    }

    public getParent(element: WordCountItem): WordCountItem | undefined {
        const parentPath = path.dirname(element.resourceUri.fsPath);
        return this.itemsById.get(parentPath);
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
            this.description = `(${stats.total})`;
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
    }
}