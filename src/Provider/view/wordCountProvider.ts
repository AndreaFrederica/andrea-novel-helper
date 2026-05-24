/* eslint-disable curly */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import fg from 'fast-glob';
import { getSupportedExtensions, mergeStats, TextStats, isExternalResourceMarkerFile } from '../../utils/utils';
import { countAndAnalyzeOffThread } from '../../utils/WordCount/asyncWordCounter';
import { CombinedIgnoreParser } from '../../utils/Parser/gitignoreParser';
import { isFileIgnored, IgnoreConfig } from '../../utils/ignoreUtils';
import { sortItems } from '../../utils/Order/sorter';
import { GitGuard } from '../../utils/Git/gitGuard';
import { getFileTracker } from '../../utils/tracker/fileTracker';
import * as timeStatsModule from '../../timeStats';
import { mdToPlainText } from '../../utils/md_plain';
import { getFileByPath, updateFileWritingStats, getFileUuid, registerFileChangeCallback, unregisterFileChangeCallback, FileChangeEvent } from '../../utils/tracker/globalFileTracking';
import { txtToPlainText } from '../../utils/txt_plain';
import { getCutClipboard } from '../../utils/WordCount/wordCountCutHelper';
import { WordCountOrderManager } from '../../utils/Order/wordCountOrder';
import { pickPlainTextProcessor, renderPlainTextWithProcessor, scriptExtensionRegistry } from '../../mcp/scriptExtensions';
import { getObsidianInlineRenderOptions, getTxtExportObsidianInlineRenderOptions } from '../../utils/obsidianInlineConfig';

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

type WordCountPrimaryUnit = 'excludePunct' | 'includePunct' | 'nonWSNoPunct';

function getPrimaryUnit(): WordCountPrimaryUnit {
    const raw = vscode.workspace
        .getConfiguration('AndreaNovelHelper.wordCount')
        .get<string>('primaryUnit', 'excludePunct');
    return raw === 'includePunct' || raw === 'nonWSNoPunct' ? raw : 'excludePunct';
}

function getPrimaryWordCount(stats: TextStats): number {
    const unit = getPrimaryUnit();
    if (unit === 'includePunct') {
        return stats.nonWSChars || stats.total;
    }
    if (unit === 'nonWSNoPunct') {
        return stats.nonWSNoPunct || stats.total;
    }
    return stats.total;
}

function getPrimaryUnitLabel(): string {
    const unit = getPrimaryUnit();
    if (unit === 'includePunct') return '含标点';
    if (unit === 'nonWSNoPunct') return '不含标点';
    return '词计';
}

function formatWordCountNumber(total: number): string {
    const mode = vscode.workspace
        .getConfiguration()
        .get<string>('AndreaNovelHelper.wordCount.displayFormat', 'raw');
    switch (mode) {
        case 'wan':
            return total >= 10000 ? (total / 10000).toFixed(3).replace(/\.0+$/, '') + '万' : String(total);
        case 'k':
            return total >= 1000 ? (total / 1000).toFixed(3).replace(/\.0+$/, '') + 'k' : String(total);
        case 'qian':
            return total >= 1000 ? (total / 1000).toFixed(3).replace(/\.0+$/, '') + '千' : String(total);
        case 'raw':
        default:
            return String(total);
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
    
    // TreeView 引用，用于更新标题栏描述
    private treeView: vscode.TreeView<WordCountItem | NewItemNode> | undefined;

    // 缓存机制
    private statsCache = new Map<string, { stats: TextStats; mtime: number; size?: number }>();
    // 文件旧值缓存：当文件被修改时暂存旧值供 UI 显示（只显示旋转图标，保持旧字数），直到新值计算完成
    private previousStatsCache = new Map<string, { stats: TextStats; mtime: number; size?: number }>();
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
    
    // 解耦：计算线程只标记脏节点，UI线程统一调度刷新
    private dirtyRoots = new Set<string>();
    private pendingRefreshScheduled = false;
    private ignoreParser: CombinedIgnoreParser | null = null;
    private resourceFolderMarkCache = new Map<string, { marked: boolean; ts: number }>();

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

    // 新增：首次加载进度仅显示一次
    private initialProgressStarted = false;
    private initialProgressCompleted = false;
    // 新增：计算进度循环是否运行中（避免重复弹出）
    private computeProgressLoopRunning = false;


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

            if (this.isIgnoredByWordCountRules(fsPath)) {
                wcDebug(`WordCount: Ignoring saved document by .wcignore/.gitignore: ${fsPath}`);
                return;
            }

            // 2) 非跟踪类型直接忽略
            const ext = path.extname(fileName).slice(1).toLowerCase();
            if (!isSpecialVisibleFile(fileName) && !getSupportedExtensions().includes(ext)) return;

            // 3) 将当前缓存移到旧值缓存，清除当前缓存
            const oldCache = this.statsCache.get(fsPath);
            if (oldCache) {
                // 将旧值移到 previousStatsCache，用于显示旋转图标时保持原有字数
                this.previousStatsCache.set(fsPath, oldCache);
            }
            this.invalidateCache(fsPath);
            
            const parent = path.dirname(fsPath);
            
            // 父目录聚合缓存也标记为旧值（触发旋转图标）
            const parentAgg = this.dirAggCache.get(parent);
            if (parentAgg) {
                this.previousDirAggCache.set(parent, parentAgg);
                this.dirAggCache.delete(parent);
            }
            
            // 关键：立即同步刷新UI显示旋转图标（不使用防抖，确保用户能看到转圈）
            // 刷新文件本身
            const fileItem = this.itemsById.get(fsPath);
            if (fileItem && fileItem instanceof WordCountItem) {
                this._onDidChange.fire(fileItem);
            }
            // 刷新父目录
            const parentItem = this.itemsById.get(parent);
            if (parentItem && parentItem instanceof WordCountItem) {
                this._onDidChange.fire(parentItem);
            }
            
            this.markDirDirty(parent);
            this.enqueueDirRecompute(parent);

            // 4) 后台计算：由 scheduleFileStat 去 worker 线程精算
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

        // 新增：首次加载时显示实时进度条（仅本会话一次）
        setTimeout(() => { void this.maybeShowInitialProgress(); }, 300);
    }

    /**
     * 处理全局文件追踪事件
     */
    private handleFileChange(event: FileChangeEvent): void {
        const filePath = event.filePath;
        const fileName = path.basename(filePath);

        wcDebug(`WordCount: File change detected - ${event.type}: ${filePath}`);

        if (this.isIgnoredByWordCountRules(filePath)) {
            wcDebug(`WordCount: Ignoring file change by .wcignore/.gitignore: ${filePath}`);
            return;
        }

        this.resourceFolderMarkCache.clear();

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
    private scheduleFileStat(full: string, skipMarkDirty = false) {
        if (this.inFlightFileStats.has(full)) return;
        this.inFlightFileStats.add(full);
        // 新增：有新任务时尝试显示通用计算进度条
        this.ensureComputeProgressLoop();
        setTimeout(async () => {
            try {
                await this.getOrCalculateFileStats(full);   // 真正算在后台
            } finally {
                this.inFlightFileStats.delete(full);
                
                // 计算完成，清除文件的旧值缓存
                this.previousStatsCache.delete(full);
                
                const parent = path.dirname(full);
                this.markDirDirty(parent);                  // 标脏父目录
                this.enqueueDirRecompute(parent);           // 再次触发聚合（这次能命中缓存）
                
                // 批量优化：如果是批量计算模式，由调用者统一标记脏节点
                if (!skipMarkDirty) {
                    this.markDirty(parent);
                }
            }
        }, 0);
    }

    /** 将大文件加入精确统计后台队列 */
    private scheduleLargeAccurate(filePath: string) {
        if (this.largeProcessingQueue.includes(filePath)) return;
        this.largeProcessingQueue.push(filePath);
        // 新增：有新大文件精算任务时尝试显示通用计算进度条
        this.ensureComputeProgressLoop();
        this.runLargeProcessing();
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

    private isIgnoredByWordCountRules(fullPath: string): boolean {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) return false;
        const fileName = path.basename(fullPath);
        if (fileName === '.gitignore' || fileName === '.wcignore') return false;
        const refExts = (vscode.workspace.getConfiguration('AndreaNovelHelper')
            .get<string[]>('wordCount.referenceVisibleExtensions', []) || [])
            .map(s => (s || '').toLowerCase());
        return shouldIgnoreWordCountFile(fullPath, this.ignoreParser, {
            workspaceRoot,
            respectWcignore: vscode.workspace.getConfiguration('AndreaNovelHelper').get<boolean>('wordCount.respectWcignore', true),
            respectGitignore: vscode.workspace.getConfiguration('AndreaNovelHelper').get<boolean>('wordCount.respectGitignore', true),
            allowedLanguages: [...getAllowedExtensions(), ...refExts]
        });
    }

    /**
     * 公开方法，用于外部刷新忽略解析器
     */
    public refreshIgnoreParser() {
        this.initIgnoreParser();
        this.clearCache();
        this.resourceFolderMarkCache.clear();
        this.refresh();
    }

    private scanResourceMarkerFiles(dirPath: string): string[] {
        try {
            const candidates = fg.sync('**/*.{ojson5,rjson5,ojson,rjson,tjson5,json5,md,txt}', {
                cwd: dirPath,
                onlyFiles: true,
                dot: false,
                absolute: true,
                ignore: [
                    '**/.git/**',
                    '**/.vscode/**',
                    '**/.idea/**',
                    '**/node_modules/**',
                    '**/.anh-fsdb/**',
                    '**/dist/**',
                    '**/build/**',
                    '**/out/**'
                ]
            });
            return candidates.filter(filePath => isExternalResourceMarkerFile(path.basename(filePath)));
        } catch (error) {
            wcDebug('scanResourceMarkerFiles:error', dirPath, error);
            return [];
        }
    }

    private isResourceFolder(dirPath: string): boolean {
        const cache = this.resourceFolderMarkCache.get(dirPath);
        const now = Date.now();
        if (cache && (now - cache.ts) < 5000) {
            return cache.marked;
        }
        const markerFiles = this.scanResourceMarkerFiles(dirPath);
        const marked = markerFiles.length > 0;
        this.resourceFolderMarkCache.set(dirPath, { marked, ts: now });
        return marked;
    }

    public rescanResourceFilesInFolder(dirPath: string): { scannedFiles: number; markerFiles: string[] } {
        this.resourceFolderMarkCache.delete(dirPath);
        const markerFiles = this.scanResourceMarkerFiles(dirPath);
        this.resourceFolderMarkCache.set(dirPath, { marked: markerFiles.length > 0, ts: Date.now() });
        return {
            scannedFiles: markerFiles.length,
            markerFiles
        };
    }

    private refreshDebounced() {
        if (this.refreshThrottleTimer) return;
        this.refreshThrottleTimer = setTimeout(() => {
            this.refreshThrottleTimer = null;
            this.refresh();
        }, 800); // 增加到 800ms 防抖避免频繁刷新
    }

    /**
     * 标记节点为脏（需要刷新），但不立即触发UI更新
     * @param rootPath 需要刷新的根节点路径，undefined表示刷新整棵树
     */
    private markDirty(rootPath?: string) {
        if (rootPath === undefined) {
            this.dirtyRoots.add('__ROOT__'); // 特殊标记表示整棵树
        } else {
            this.dirtyRoots.add(rootPath);
        }
        this.scheduleRefresh();
    }

    /**
     * 标记节点及其所有祖先目录为脏（用于深层目录计算完成后向上传播刷新）
     * @param nodePath 节点路径
     */
    private markDirtyWithAncestors(nodePath: string) {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) return;

        let current = path.resolve(nodePath);
        const root = path.resolve(workspaceRoot);
        
        // 从当前节点开始向上标记所有祖先目录为脏
        while (current.startsWith(root)) {
            this.dirtyRoots.add(current);
            if (current === root) break;
            const parent = path.dirname(current);
            if (parent === current) break; // 防止无限循环
            current = parent;
        }
        
        this.scheduleRefresh();
    }

    /**
     * 调度UI刷新（防抖）
     */
    private scheduleRefresh() {
        if (this.pendingRefreshScheduled) return;
        this.pendingRefreshScheduled = true;
        setTimeout(() => {
            this.processPendingRefreshes();
        }, 50); // 50ms批量处理
    }

    /**
     * 处理所有待刷新的节点
     */
    private processPendingRefreshes() {
        this.pendingRefreshScheduled = false;
        if (this.dirtyRoots.size === 0) return;

        // 如果包含整棵树刷新标记，直接刷新整棵树
        if (this.dirtyRoots.has('__ROOT__')) {
            this.dirtyRoots.clear();
            this.refresh();
            return;
        }

        // 否则刷新所有标记的节点
        const roots = Array.from(this.dirtyRoots);
        this.dirtyRoots.clear();
        
        // 检查是否包含工作区根目录（工作区根目录在 itemsById 中不存在，需要特殊处理）
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const hasWorkspaceRoot = workspaceRoot && roots.some(r => path.resolve(r) === path.resolve(workspaceRoot));
        
        if (hasWorkspaceRoot) {
            // 如果标记了工作区根目录，直接刷新整棵树（因为根目录没有对应的 TreeItem）
            wcDebug('processPendingRefreshes:workspace-root-detected', 'refreshing-entire-tree');
            this.refresh();
            return;
        }
        
        for (const rootPath of roots) {
            const item = this.itemsById.get(rootPath);
            if (item && item instanceof WordCountItem) {
                this.refresh(item);
            }
        }
    }

    /**
     * 刷新树视图
     * @param element 可选，指定要刷新的节点。如果不传，则刷新整棵树
     */
    refresh(element?: WordCountItem) {
        // 如果正在初始化大量文件，延迟刷新
        if (this.isInitializing) {
            this.refreshDebounced();
            return;
        }
        // 增量更新：传入element只刷新该节点，不传则刷新整棵树
        this._onDidChange.fire(element);
        
        // 刷新时同时更新标题栏显示
        this.updateTreeViewTitle();
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
    // 收集当前目录下需要批量预取的文件（仅文件）
    const prefetchFiles: string[] = [];
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
                const resourceFolderMarked = this.isResourceFolder(full);
                const forced = this.forcedPaths.has(path.resolve(full));
                const cacheEntry = this.dirAggCache.get(full);
                const cacheValid = cacheEntry && !forced; // 去除 TTL 约束，仅强制/失效时重算
                if (cacheValid) {
                    const item = new WordCountItem(
                        uri,
                        d.name,
                        cacheEntry!.stats,
                        isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
                        false,
                        resourceFolderMarked
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
                    const zero: TextStats = { cjkChars: 0, asciiChars: 0, words: 0, nonWSChars: 0, nonWSNoPunct: 0, total: 0 };
                    const item = new WordCountItem(
                        uri,
                        d.name,
                        zero,
                        isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
                        true,
                        resourceFolderMarked
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
                        false,
                        resourceFolderMarked
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
                    const zero: TextStats = { cjkChars: 0, asciiChars: 0, words: 0, nonWSChars: 0, nonWSNoPunct: 0, total: 0 };
                    const item = new WordCountItem(
                        uri,
                        d.name,
                        zero,
                        isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
                        true,
                        resourceFolderMarked
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
                    const zero: TextStats = { cjkChars: 0, asciiChars: 0, words: 0, nonWSChars: 0, nonWSNoPunct: 0, total: 0 };
                    const item = new WordCountItem(uri, d.name, zero, vscode.TreeItemCollapsibleState.None, false, false, true);
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
                    } else if (this.previousStatsCache.has(full)) {
                        // 文件有旧值：显示旧值 + 旋转图标（不显示"计算中"，保持原有字数）
                        const prev = this.previousStatsCache.get(full)!;
                        wcDebug('use-previous-cache:file', full, 'total', prev.stats.total);
                        const staleItem = new WordCountItem(uri, d.name, prev.stats, vscode.TreeItemCollapsibleState.None, false);
                        staleItem.id = full;
                        staleItem.iconPath = new vscode.ThemeIcon('loading~spin');
                        try {
                            if (staleItem.tooltip instanceof vscode.MarkdownString) {
                                staleItem.tooltip.appendMarkdown(`\n\n🔄 重新计算中...`);
                            }
                        } catch { /* ignore */ }
                        this.itemsById.set(staleItem.id, staleItem);
                        items.push(staleItem);
                        needsAsync = true;
                        prefetchFiles.push(full);
                    } else {
                        // 首次加载，没有旧值：显示"计算中"
                        wcDebug('placeholder:file', full);
                        const zero: TextStats = { cjkChars: 0, asciiChars: 0, words: 0, nonWSChars: 0, nonWSNoPunct: 0, total: 0 };
                        const item = new WordCountItem(uri, d.name, zero, vscode.TreeItemCollapsibleState.None, true);
                        item.id = full;
                        this.itemsById.set(item.id, item);
                        items.push(item);
                        needsAsync = true;
                        // 收集用于后端批量预取的文件路径
                        prefetchFiles.push(full);
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
            // 为所有子文件夹更新 contextValue / description ⇅ / tooltip（反映其内容排序模式）
            for (const it of wordCountItems) {
                if (it.collapsibleState === vscode.TreeItemCollapsibleState.None) continue;
                const childIsManual = this.orderManager.isManual(it.resourceUri.fsPath);
                it.contextValue = childIsManual ? 'wordCountFolderManual' : 'wordCountFolder';
                if (childIsManual) {
                    const desc = typeof it.description === 'string' ? it.description : '';
                    it.description = desc ? `${desc} ⇅` : '⇅';
                }
                const modeText = childIsManual
                    ? '手动排序 ✎（可拖拽调整子项顺序）'
                    : '自动排序（按章节结构识别）';
                if (it.tooltip instanceof vscode.MarkdownString) {
                    it.tooltip.appendMarkdown(`\n\n内容排序: **${modeText}**`);
                } else {
                    const tip = new vscode.MarkdownString(String(it.tooltip || ''));
                    tip.appendMarkdown(`\n\n内容排序: **${modeText}**`);
                    tip.isTrusted = true;
                    it.tooltip = tip;
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

        // 前后端分离：getChildren 只负责渲染，不触发计算
        // 如果发现需要计算的节点，调度后端计算任务
        if (needsAsync) {
            wcDebug('getChildren:schedule-backend-compute', root, 'prefetchFiles', prefetchFiles.length);
            
            // 调度后端计算（非阻塞）
            void this.scheduleBackendCompute(root, dirents, prefetchFiles);
        }

        return sortedItems;
    }


    /**
     * 后端计算调度器：统一管理所有计算任务
     * 前端通过此方法触发后端计算，计算完成后自动刷新UI
     */
    private async scheduleBackendCompute(root: string, dirents: fs.Dirent[], prefetchFiles: string[]): Promise<void> {
        // 不再在初始化阶段硬跳过。
        // 原逻辑会在初始化状态异常或长时间未完成时导致目录节点长期停留“计算中”。
        if (!this.initialProgressCompleted) {
            wcDebug('scheduleBackendCompute:run-during-initial-load', root);
        }

        const exts = getSupportedExtensions();
        
        // 1. 批量预取（若后端支持），非阻塞
        if (prefetchFiles.length > 0) {
            try { 
                await this.prefetchDirStatsBatchIfPossible(prefetchFiles); 
            } catch (e) { 
                wcDebug('scheduleBackendCompute:prefetch-error', e);
            }
        }
        
        // 2. 启动后端批量计算任务
        const batchId = `${root}_${Date.now()}`;
        wcDebug('scheduleBackendCompute:start', root, 'batchId', batchId);
        
        try {
            await this.calculateStatsAsyncBatch(root, exts, dirents, batchId);
            wcDebug('scheduleBackendCompute:complete', root, 'batchId', batchId);
            
            // 3. 计算完成后，触发UI刷新
            // 策略：直接刷新当前根目录节点，VS Code会自动重新调用getChildren
            // 这样可以确保所有子目录都从dirAggCache读取最新数据渲染
            this.markDirtyWithAncestors(root);
            
            wcDebug('scheduleBackendCompute:refreshed', root);
        } catch (e) {
            wcDebug('scheduleBackendCompute:error', root, e);
        }
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
            let agg: TextStats = { cjkChars: 0, asciiChars: 0, words: 0, nonWSChars: 0, nonWSNoPunct: 0, total: 0 };
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
            const hadStaleCache = this.previousDirAggCache.has(folder);
            this.dirAggCache.set(folder, { stats: agg, ts: now });
            this.previousDirAggCache.delete(folder);
            wcDebug('dirAggCache:update', folder, 'total', agg.total, 'forced', forced, 'hadStale', hadStaleCache);

            if (forced) {
                this.forcedPaths.delete(path.resolve(folder));
                wcDebug('dir:forced-clear', folder);
            }
            
            // 前后端分离：后端只更新数据缓存（dirAggCache），不更新 itemsById
            // itemsById 由 getChildren() 在渲染时统一填充，保证前端无状态
            // 
            // 注意：这里不主动调用 markDirty，而是由调用方（scheduleBackendCompute）
            // 在批量计算完成后统一标记所有更新的目录，避免单个目录计算完就立即刷新UI，
            // 实现真正的批量更新，减少刷新次数
            
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
     * 批量异步计算（优化版）：等待所有文件和目录计算完成后才返回
     */
    private async calculateStatsAsyncBatch(root: string, exts: string[], dirents: fs.Dirent[], batchId: string) {
        const fileTasks: Promise<void>[] = [];
        const dirTasks: Promise<void>[] = [];

        for (const d of dirents) {
            const full = path.join(root, d.name);

            if (shouldIgnoreWordCountFile(full, this.ignoreParser, {
                workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
                respectWcignore: vscode.workspace.getConfiguration('AndreaNovelHelper').get<boolean>('wordCount.respectWcignore', true),
                respectGitignore: vscode.workspace.getConfiguration('AndreaNovelHelper').get<boolean>('wordCount.respectGitignore', true),
                allowedLanguages: getAllowedExtensions()
            })) { continue; }

            if (d.isDirectory()) {
                dirTasks.push(this.analyzeFolderDynamic(full, exts).then(() => {}));
            } else {
                const ext = path.extname(d.name).slice(1).toLowerCase();
                const special = isSpecialVisibleFile(d.name);
                if (special || exts.includes(ext)) {
                    // 将文件计算也加入等待队列
                    fileTasks.push(this.getOrCalculateFileStats(full).then(() => {}));
                }
            }
        }

        // 分批处理目录任务
        const dirBatchSize = 5;
        for (let i = 0; i < dirTasks.length; i += dirBatchSize) {
            const batch = dirTasks.slice(i, i + dirBatchSize);
            await Promise.all(batch);
            await new Promise(resolve => setImmediate(resolve));
        }

        // 分批处理文件任务
        const fileBatchSize = 10;
        for (let i = 0; i < fileTasks.length; i += fileBatchSize) {
            const batch = fileTasks.slice(i, i + fileBatchSize);
            await Promise.all(batch);
            await new Promise(resolve => setImmediate(resolve));
        }
        
        wcDebug('calculateStatsAsyncBatch:complete', root, 'dirs', dirTasks.length, 'files', fileTasks.length);
    }

    /**
     * 异步计算所有统计数据（旧版，保留向后兼容）
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
                // analyzeFolderDynamic 内部会自动更新缓存和刷新UI
                tasks.push(this.analyzeFolderDynamic(full, exts).then(() => {
                    // 不需要额外处理，analyzeFolderDynamic已经处理了更新
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
            // 让出线程，避免阻塞UI
            await new Promise(resolve => setImmediate(resolve));
        }
        
        // 批量优化：所有任务完成后才标记当前目录为脏，只触发一次UI刷新
        // 注意：这里不标记脏，由getChildren的then回调处理
    }

    /**
     * 获取或计算文件统计（带缓存和 Git 优化）
     */
    private async getOrCalculateFileStats(filePath: string, forceOverride = false, knownStats?: { mtime: number; size: number }): Promise<TextStats> {
        try {
            let mtime: number;
            let size: number;

            if (knownStats) {
                mtime = knownStats.mtime;
                size = knownStats.size;
            } else {
                const stat = await fs.promises.stat(filePath);
                mtime = stat.mtimeMs;
                size = stat.size;
            }

            const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
            const largeThreshold = cfg.get<number>('wordCount.largeFileThreshold', 50 * 1024) ?? 50 * 1024;
            const avgBytesPerChar = cfg.get<number>('wordCount.largeFileAvgBytesPerChar', 1.6) ?? 1.6;

            // 1. 检查内存缓存 —— 加 size 判断
            const cached = this.statsCache.get(filePath);
            // const isForced = forceOverride || this.forcedPaths.has(path.resolve(filePath));
            const isForced = forceOverride || this.isPathForced(filePath);

            if (!isForced && cached && cached.mtime === mtime && cached.size === size && !this.largeApproxPending.has(filePath)) {
                wcDebug('cache-hit:memory:file', filePath, 'mtime', mtime, 'size', size);
                // 命中内存缓存时也标记父目录聚合为脏，避免目录/工作区总数长期停留在旧值
                const parent = path.dirname(filePath);
                this.markDirDirty(parent);
                this.enqueueDirRecompute(parent);
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
                const est: TextStats = { cjkChars: 0, asciiChars: 0, words: 0, nonWSChars: 0, nonWSNoPunct: 0, total: estimatedTotal };
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
                    // 优化：复用已有的 mtime/size，不再重复 stat
                    if (fileMetadata.mtime === mtime && (fileMetadata.size === undefined || fileMetadata.size === size)) {
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
                            wcDebug('cache-hit:persistent:file', filePath, 'mtime', mtime, 'size', size, 'gitOk', gitOk);
                            const stats = fileMetadata.wordCountStats;
                            this.statsCache.set(filePath, { stats, mtime: mtime, size: size });
                            this.markDirDirty(path.dirname(filePath));
                            this.enqueueDirRecompute(path.dirname(filePath));
                            return stats;
                        } else {
                            wcDebug('cache-gitguard:fail', filePath);
                        }
                    } else {
                        wcDebug('cache-stale:persistent:file', filePath, 'cachedM', fileMetadata.mtime, 'curM', mtime, 'cachedS', fileMetadata.size, 'curS', size);
                    }
                }
            }

            // 3. 交给 asyncWordCounter
            // 激进优化：仅当外部显式传入 knownStats (如启动阶段) 时，才向 worker 传递 mtime/size 以跳过二次 stat
            // 常规调用（如文件变更）保持双重校验，确保安全
            const workerHint = knownStats ? { mtime, size } : undefined;
            const result: any = await countAndAnalyzeOffThread(filePath, workerHint);
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
            return { cjkChars: 0, asciiChars: 0, words: 0, nonWSChars: 0, nonWSNoPunct: 0, total: 0 };
        }
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
                // 解耦：只标记脏节点
                this.markDirty(path.dirname(fp));
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
                // 解耦：只标记根目录为脏
                this.markDirty(r);
            }
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
        const affectedDirs = new Set<string>();
        
        while (this.dirRecalcQueue.length) {
            const dir = this.dirRecalcQueue.shift()!;
            this.dirRecalcQueued.delete(dir);
            try { 
                await this.recomputeDirAggregate(dir);
                affectedDirs.add(dir);
            } catch (e) { wcDebug('dirRecalc:error', dir, e); }
            const parent = path.dirname(dir);
            const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
            if (parent && parent !== dir && parent.startsWith(root)) this.enqueueDirRecompute(parent);
            await new Promise(r => setImmediate(r));
        }
        
        // 解耦：批处理完成后统一标记所有受影响的目录
        for (const dir of affectedDirs) {
            this.markDirty(dir);
        }
        
        this.dirRecalcProcessing = false;
    }

    /** 非递归聚合目录：依赖子目录已更新的聚合值 + 文件最新值（支持祖先目录强制） */
    private async recomputeDirAggregate(dir: string) {
        let agg: TextStats = { cjkChars: 0, asciiChars: 0, words: 0, nonWSChars: 0, nonWSNoPunct: 0, total: 0 };
        const processedFiles = new Set<string>();
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
                        processedFiles.add(path.resolve(full));
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

        if (wcDebugEnabled()) {
            this.reportAggregateDiff(dir, agg, processedFiles);
        }

        wcDebug('dirAgg:update:eventChain', dir, 'total', agg.total);
    }

    private reportAggregateDiff(dir: string, agg: TextStats, processedFiles: Set<string>) {
        try {
            const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
            if (!root) return;
            const normalizedDir = path.resolve(dir);
            let realSum: TextStats = { cjkChars: 0, asciiChars: 0, words: 0, nonWSChars: 0, nonWSNoPunct: 0, total: 0 };
            const missing: string[] = [];
            for (const [fp, entry] of this.statsCache.entries()) {
                const abs = path.resolve(fp);
                if (abs === normalizedDir || abs.startsWith(normalizedDir + path.sep)) {
                    realSum = mergeStats(realSum, entry.stats);
                    if (!processedFiles.has(abs) && missing.length < 10) missing.push(abs);
                }
            }
            const diff = realSum.total - agg.total;
            if (Math.abs(diff) > 1000) {
                wcDebug('dirAgg:diff-detected', {
                    dir: normalizedDir,
                    aggregateTotal: agg.total,
                    realTotal: realSum.total,
                    diff,
                    missingSamples: missing
                });
            }
        } catch { /* ignore */ }
    }


    /** 目录聚合缓存 TTL(ms)，可配置 AndreaNovelHelper.wordCount.dirAggTTL，默认 2000，最小 500 */
    private getDirAggTTL(): number {
        try {
            const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
            const v = cfg.get<number>('wordCount.dirAggTTL', 2000) ?? 2000;
            return Math.max(500, v);
        } catch { return 2000; }
    }

    /** 设置 TreeView 引用（用于更新标题栏） */
    public setTreeView(treeView: vscode.TreeView<WordCountItem | NewItemNode>): void {
        this.treeView = treeView;
        // 初始化时更新一次标题
        this.updateTreeViewTitle();
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
        return stats ? getPrimaryWordCount(stats) : 0;
    }
    
    /** 获取工作区根目录的总字数统计 */
    public getWorkspaceTotalStats(): TextStats | null {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) return null;
        
        // 尝试从缓存读取工作区根目录聚合
        const rootAgg = this.dirAggCache.get(workspaceRoot);
        if (rootAgg) return rootAgg.stats;
        
        // 如果工作区根目录没有聚合缓存，手动聚合所有一级子目录和文件
        // 这样可以确保即使根目录聚合未完成，也能显示正确的总数
        try {
            const dirents = fs.readdirSync(workspaceRoot, { withFileTypes: true });
            let total: TextStats = { cjkChars: 0, asciiChars: 0, words: 0, nonWSChars: 0, nonWSNoPunct: 0, total: 0 };
            
            for (const d of dirents) {
                const full = path.join(workspaceRoot, d.name);
                
                // 检查是否应该忽略
                if (shouldIgnoreWordCountFile(full, this.ignoreParser, {
                    workspaceRoot,
                    respectWcignore: vscode.workspace.getConfiguration('AndreaNovelHelper').get<boolean>('wordCount.respectWcignore', true),
                    respectGitignore: vscode.workspace.getConfiguration('AndreaNovelHelper').get<boolean>('wordCount.respectGitignore', true),
                    allowedLanguages: getAllowedExtensions()
                })) continue;
                
                if (d.isDirectory()) {
                    // 读取子目录的聚合缓存
                    const dirAgg = this.dirAggCache.get(full);
                    if (dirAgg) {
                        total = mergeStats(total, dirAgg.stats);
                    }
                } else {
                    // 读取文件的统计缓存
                    const fileStats = this.statsCache.get(full);
                    if (fileStats) {
                        total = mergeStats(total, fileStats.stats);
                    }
                }
            }
            
            return getPrimaryWordCount(total) > 0 ? total : null;
        } catch {
            return null;
        }
    }
    
    /** 更新 TreeView 标题栏显示 */
    private updateTreeViewTitle(): void {
        if (!this.treeView) return;
        
        const stats = this.getWorkspaceTotalStats();
        if (stats) {
            const formatted = formatWordCountNumber(getPrimaryWordCount(stats));
            this.treeView.description = `(${formatted})`;
        } else {
            this.treeView.description = '(计算中...)';
        }
    }

    /** 清理资源 */
    public dispose(): void {
        // 取消注册全局文件追踪回调
        unregisterFileChangeCallback('wordCount');
        
        if (this.gitGuard) {
            this.gitGuard.dispose();
        }
        // 写出启动快照：仅保存相对路径及其统计结果（相对于工作区）
        try {
            const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper.startupSnapshot');
            if (cfg.get<boolean>('enabled', true)) {
                const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                if (ws) {
                    const snapDir = path.join(ws, 'novel-helper', '.anh-fsdb', 'snapshots');
                    if (!fs.existsSync(snapDir)) fs.mkdirSync(snapDir, { recursive: true });
                    const snapPath = path.join(snapDir, 'wordcount-files.json');

                    const files: any[] = [];
                    for (const [, item] of this.itemsById) {
                        try {
                            const p = (item as any)?.resourceUri?.fsPath as string | undefined;
                            if (!p) continue;
                            if (!fs.existsSync(p)) continue;
                            const st = fs.statSync(p);
                            if (!st.isFile()) continue;

                            const rel = path.relative(ws, p).split(path.sep).join('/'); // 只能存相对路径
                            const cached = this.statsCache.get(p);
                            if (!cached) continue;

                            files.push({
                                rel,
                                mtime: cached.mtime,
                                size: typeof cached.size === 'number' ? cached.size : undefined,
                                stats: cached.stats
                            });
                        } catch { /* ignore */ }
                    }

                    const payload = { version: 1, files };
                    fs.writeFileSync(snapPath, JSON.stringify(payload));
                }
            } else if (cfg.get<boolean>('deleteOnDisable', true)) {
                const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                if (ws) {
                    const snapPath = path.join(ws, 'novel-helper', '.anh-fsdb', 'snapshots', 'wordcount-files.json');
                    if (fs.existsSync(snapPath)) fs.unlinkSync(snapPath);
                }
            }
        } catch { /* ignore */ }
    }

    // 新增：收集需要进行字数统计的支持文件（忽略参考文件与忽略规则）
    private async collectSupportedFiles(root: string): Promise<string[]> {
        const results: string[] = [];
        const stack: string[] = [root];
        const supportedExts = new Set<string>(getSupportedExtensions());
        const refExts = new Set<string>(
            (vscode.workspace.getConfiguration('AndreaNovelHelper')
                .get<string[]>('wordCount.referenceVisibleExtensions', []) || [])
                .map(s => (s || '').toLowerCase())
        );

        while (stack.length) {
            const dir = stack.pop()!;
            let dirents: fs.Dirent[] = [];
            try {
                dirents = await fs.promises.readdir(dir, { withFileTypes: true });
            } catch { continue; }

            for (const d of dirents) {
                const full = path.join(dir, d.name);

                // 忽略规则统一判断（允许的语言包含支持+参考扩展，但真正加入结果时仅保留支持扩展）
                try {
                    if (shouldIgnoreWordCountFile(full, this.ignoreParser, {
                        workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
                        respectWcignore: vscode.workspace.getConfiguration('AndreaNovelHelper').get<boolean>('wordCount.respectWcignore', true),
                        respectGitignore: vscode.workspace.getConfiguration('AndreaNovelHelper').get<boolean>('wordCount.respectGitignore', true),
                        includePatterns: undefined,
                        excludePatterns: undefined,
                        allowedLanguages: [...Array.from(supportedExts), ...Array.from(refExts)]
                    })) { continue; }
                } catch { /* ignore */ }

                if (d.isDirectory()) { stack.push(full); continue; }
                if (!d.isFile()) { continue; }

                const name = d.name;
                const special = (name === '.gitignore' || name === '.wcignore');
                if (special) { continue; }
                const ext = path.extname(name).slice(1).toLowerCase();
                // 仅统计“支持的写作文件”，排除参考文件
                if (!supportedExts.has(ext)) { continue; }

                results.push(full);
            }
        }
        return results;
    }

    // 新增：首次加载时的进度条（实时更新）
    private async maybeShowInitialProgress(): Promise<void> {
        if (this.initialProgressStarted) return;
        this.initialProgressStarted = true;

        const folders = vscode.workspace.workspaceFolders || [];
        if (folders.length === 0) { return; }

        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '正在加载字数统计…',
                cancellable: false
            }, async (progress) => {
                const startTime = Date.now();
                const formatElapsed = () => ((Date.now() - startTime) / 1000).toFixed(1) + 's';
                
                progress.report({ message: '扫描文件中… 0.0s' });

                const phaseStartScan = Date.now();

                // 使用 fast-glob 高效扫描文件
                const supportedExts = getSupportedExtensions();
                const refExts = (vscode.workspace.getConfiguration('AndreaNovelHelper')
                    .get<string[]>('wordCount.referenceVisibleExtensions', []) || [])
                    .map(s => (s || '').toLowerCase());
                const allAllowedExts = [...supportedExts, ...refExts];
                
                const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
                const respectWcignore = vscode.workspace.getConfiguration('AndreaNovelHelper').get<boolean>('wordCount.respectWcignore', true);
                const respectGitignore = vscode.workspace.getConfiguration('AndreaNovelHelper').get<boolean>('wordCount.respectGitignore', true);
                
                // 构建 glob 模式：扫描支持的文件类型 + 参考文件类型
                const patterns = allAllowedExts.map(ext => `**/*.${ext}`);
                
                // 构建 ignore 模式：固定忽略的目录和文件
                const ignorePatterns = [
                    '**/node_modules/**',
                    '**/.git/**',
                    '**/.svn/**',
                    '**/.hg/**',
                    '**/.DS_Store/**',
                    '**/.idea/**',
                    '**/.vscode-test/**',
                    '**/novel-helper/.anh-fsdb/**',
                    '**/novel-helper/file-tracking.json',
                    '**/novel-helper/wordcount-order.json',
                    '**/.gitignore',
                    '**/.wcignore'
                ];
                
                // 读取 .gitignore 内容并转换为 glob 模式
                if (respectGitignore) {
                    try {
                        const gitignorePath = path.join(workspaceRoot, '.gitignore');
                        if (fs.existsSync(gitignorePath)) {
                            const content = fs.readFileSync(gitignorePath, 'utf-8');
                            const lines = content.split('\n')
                                .map(line => line.trim())
                                .filter(line => line && !line.startsWith('#') && !line.startsWith('!'));
                            for (const line of lines) {
                                // 转换 gitignore 格式到 glob 格式
                                let pattern = line;
                                // 处理尾部斜杠（表示目录）
                                if (pattern.endsWith('/')) {
                                    pattern = pattern.slice(0, -1) + '/**';
                                }
                                // 处理开头斜杠（相对于根目录）
                                if (pattern.startsWith('/')) {
                                    ignorePatterns.push(pattern.slice(1));
                                } else if (!pattern.includes('/')) {
                                    // 无斜杠：匹配任意层级
                                    ignorePatterns.push(`**/${pattern}`);
                                    ignorePatterns.push(`**/${pattern}/**`);
                                } else {
                                    // 有斜杠：相对路径
                                    ignorePatterns.push(pattern);
                                    // 如果不是通配符，也添加目录匹配
                                    if (!pattern.includes('*') && !pattern.endsWith('/**')) {
                                        ignorePatterns.push(`${pattern}/**`);
                                    }
                                }
                            }
                        }
                    } catch { /* ignore */ }
                }
                
                // 读取 .wcignore 内容并转换为 glob 模式
                if (respectWcignore) {
                    try {
                        const wcignorePath = path.join(workspaceRoot, '.wcignore');
                        if (fs.existsSync(wcignorePath)) {
                            const content = fs.readFileSync(wcignorePath, 'utf-8');
                            const lines = content.split('\n')
                                .map(line => line.trim())
                                .filter(line => line && !line.startsWith('#') && !line.startsWith('!'));
                            for (const line of lines) {
                                let pattern = line;
                                if (pattern.endsWith('/')) {
                                    pattern = pattern.slice(0, -1) + '/**';
                                }
                                if (pattern.startsWith('/')) {
                                    ignorePatterns.push(pattern.slice(1));
                                } else if (!pattern.includes('/')) {
                                    ignorePatterns.push(`**/${pattern}`);
                                    ignorePatterns.push(`**/${pattern}/**`);
                                } else {
                                    ignorePatterns.push(pattern);
                                    if (!pattern.includes('*') && !pattern.endsWith('/**')) {
                                        ignorePatterns.push(`${pattern}/**`);
                                    }
                                }
                            }
                        }
                    } catch { /* ignore */ }
                }
                
                // 使用 fast-glob 快速扫描（单次 IO，底层 C++ 优化）
                let allFiles = await fg(patterns, {
                    cwd: workspaceRoot,
                    absolute: true,
                    ignore: ignorePatterns,
                    onlyFiles: true,
                    followSymbolicLinks: false,
                    suppressErrors: true
                });

                // 统一规范路径格式：全部转成 resolve 后的绝对路径，避免不同来源格式不一致
                allFiles = allFiles.map(f => path.resolve(f));
                
                const scanElapsed = Date.now() - phaseStartScan;
                console.log('[WordCount][startup] phase:scan', { files: allFiles.length, elapsedMs: scanElapsed });

                // 过滤：只保留支持的文件类型（排除参考文件）
                const supportedExtsSet = new Set(supportedExts);
                allFiles = allFiles.filter(file => {
                    const ext = path.extname(file).slice(1).toLowerCase();
                    return supportedExtsSet.has(ext);
                });
                
                progress.report({ message: `扫描完成，找到 ${allFiles.length} 个文件 ${formatElapsed()}` });

                const total = allFiles.length;
                if (total === 0) {
                    progress.report({ message: `没有需要统计的文件 ${formatElapsed()}` });
                    // 没有可统计文件也必须结束初始化，否则后续目录计算会一直被跳过。
                    this.initialProgressCompleted = true;
                    wcDebug('maybeShowInitialProgress:no-supported-files');

                    // 仍然触发一次目录聚合，确保空目录也能从“计算中”收敛到 0。
                    for (const folder of folders) {
                        const root = folder.uri.fsPath;
                        try {
                            const dirents = await fs.promises.readdir(root, { withFileTypes: true });
                            void this.scheduleBackendCompute(root, dirents, []);
                        } catch (e) {
                            wcDebug('maybeShowInitialProgress:no-files-dir-aggregate-error', root, e);
                        }
                    }

                    this.refresh();
                    return;
                }

                // 优先从快照加载文件列表（避免全量扫描数据库）
                const snapshotCfg = vscode.workspace.getConfiguration('AndreaNovelHelper.startupSnapshot');
                let snapshotFiles: string[] = [];
                let snapshotRestoredCount = 0; // 统计从快照直接恢复到 statsCache 的条数
                if (snapshotCfg.get<boolean>('enabled', true)) {
                    const phaseStartSnapshot = Date.now();
                    try {
                        const snapPath = path.join(workspaceRoot, 'novel-helper', '.anh-fsdb', 'snapshots', 'wordcount-files.json');
                        if (fs.existsSync(snapPath)) {
                            const content = fs.readFileSync(snapPath, 'utf-8');
                            const data = JSON.parse(content);

                            // 兼容旧格式：files 是字符串数组
                            if (Array.isArray(data?.files) && (data.files.length === 0 || typeof data.files[0] === 'string')) {
                                snapshotFiles = (data.files || []).map((rel: string) =>
                                    path.join(workspaceRoot, rel.split('/').join(path.sep))
                                );
                                wcDebug('snapshot:loaded:legacy', snapshotFiles.length, 'files');
                            } else if (Array.isArray(data?.files)) {
                                // 新格式：包含相对路径和统计信息
                                const records = data.files as Array<{ rel?: string; mtime?: number; size?: number; stats?: TextStats }>;
                                for (const rec of records) {
                                    const rel = (rec.rel ?? '').toString();
                                    if (!rel) continue;
                                    const abs = path.resolve(path.join(workspaceRoot, rel.split('/').join(path.sep)));
                                    if (!allFiles.includes(abs)) continue; // 只恢复仍存在的文件
                                    if (!rec.stats) continue;

                                    this.statsCache.set(abs, {
                                        stats: rec.stats,
                                        mtime: typeof rec.mtime === 'number' ? rec.mtime : 0,
                                        size: typeof rec.size === 'number' ? rec.size : undefined
                                    });
                                    snapshotFiles.push(abs);
                                    snapshotRestoredCount++;

                                    // 从快照恢复时也标记目录聚合为脏，保证上级目录/总字数后续能正确刷新
                                    const parent = path.dirname(abs);
                                    this.markDirDirty(parent);
                                    this.enqueueDirRecompute(parent);
                                }
                                console.log('[WordCount][startup] snapshot rich loaded:', {
                                    files: snapshotFiles.length,
                                    restored: snapshotRestoredCount
                                });
                            }
                        }
                    } catch (e) {
                        wcDebug('snapshot:load:error', e);
                    }

                    console.log('[WordCount][startup] phase:snapshot', {
                        elapsedMs: Date.now() - phaseStartSnapshot,
                        snapshotEnabled: snapshotCfg.get<boolean>('enabled', true),
                        snapshotRestored: snapshotRestoredCount
                    });
                }

                // 批量预取缓存：优先使用快照文件列表，回退到全量扫描
                const filesToPrefetch = snapshotFiles.length > 0 
                    ? snapshotFiles.filter(f => allFiles.includes(path.resolve(f)))  // 只预取仍存在的快照文件
                    : allFiles;
                
                progress.report({ message: `预取缓存中 (${filesToPrefetch.length}/${allFiles.length})… ${formatElapsed()}` });
                const phaseStartPrefetch = Date.now();
                const prefetchLoaded = await this.prefetchDirStatsBatchIfPossible(filesToPrefetch);
                console.log('[WordCount][startup] phase:prefetch', {
                    loaded: prefetchLoaded,
                    candidateFiles: filesToPrefetch.length,
                    elapsedMs: Date.now() - phaseStartPrefetch
                });

                // 方案3：智能跳过已缓存文件，只对“完全没有缓存”的文件进行前台计算
                // 有缓存但 mtime/size 不一致的情况：前台直接使用旧值，并在后台排队精算
                const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
                const skipStatCheck = cfg.get<boolean>('wordCount.skipStartupStatCheck', false) ?? false;
                const parallelStatCheck = cfg.get<boolean>('wordCount.parallelStatCheck', false) ?? false;

                progress.report({ message: `检查缓存中… ${formatElapsed()}${skipStatCheck ? '（已跳过 stat 校验）' : parallelStatCheck ? '（并行校验）' : ''}` });
                const phaseStartCacheCheck = Date.now();
                const filesToCalculate: string[] = [];
                let staleCached = 0;
                let pureMissCount = 0;
                let statOkCount = 0;
                let statFailCount = 0;
                let statStaleCount = 0;
                const statStart = Date.now();

                if (skipStatCheck) {
                    // 危险模式：完全信任缓存，只区分“有无缓存”
                    for (const file of allFiles) {
                        const cached = this.statsCache.get(file);
                        if (!cached) {
                            pureMissCount++;
                            filesToCalculate.push(file);
                        }
                    }
                } else if (parallelStatCheck) {
                    // 并行批量 stat 模式：把所有需要 stat 的文件一次性并行处理
                    const cachedFiles: Array<{ file: string; cached: { stats: TextStats; mtime: number; size?: number } }> = [];
                    for (const file of allFiles) {
                        const cached = this.statsCache.get(file);
                        if (!cached) {
                            pureMissCount++;
                            filesToCalculate.push(file);
                        } else {
                            cachedFiles.push({ file, cached });
                        }
                    }

                    // 并行执行所有 fs.stat
                    const statResults = await Promise.allSettled(
                        cachedFiles.map(({ file }) => fs.promises.stat(file))
                    );

                    for (let i = 0; i < cachedFiles.length; i++) {
                        const { file, cached } = cachedFiles[i];
                        const result = statResults[i];
                        
                        if (result.status === 'fulfilled') {
                            statOkCount++;
                            const stat = result.value;
                            if (cached.mtime !== stat.mtimeMs || cached.size !== stat.size) {
                                staleCached++;
                                statStaleCount++;
                                // 后台重新精算，不阻塞这次冷启动
                                this.scheduleFileStat(file, true);
                            }
                        } else {
                            // stat 失败就保持现有缓存，稍后正常重算
                            statFailCount++;
                            filesToCalculate.push(file);
                        }
                    }
                } else {
                    // 串行逐个 stat 模式（原有逻辑）
                    for (const file of allFiles) {
                        const cached = this.statsCache.get(file);
                        if (!cached) {
                            pureMissCount++;
                            filesToCalculate.push(file);
                            continue;
                        }

                        // 放宽校验：只要有缓存就算命中，是否过期交给后台处理
                        try {
                            const stat = await fs.promises.stat(file);
                            statOkCount++;
                            if (cached.mtime !== stat.mtimeMs || cached.size !== stat.size) {
                                staleCached++;
                                statStaleCount++;
                                // 后台重新精算，不阻塞这次冷启动
                                this.scheduleFileStat(file, true);
                            }
                        } catch {
                            // stat 失败就保持现有缓存，稍后正常重算
                            statFailCount++;
                            filesToCalculate.push(file);
                        }
                    }
                }

                const needCalculate = filesToCalculate.length;
                const cachedCount = total - needCalculate;
                const cacheCheckElapsed = Date.now() - phaseStartCacheCheck;
                const statElapsed = Date.now() - statStart;
                console.log('[WordCount][startup] phase:cache-check', {
                    total,
                    pureMissCount,
                    cachedCount,
                    staleCached,
                    statOkCount,
                    statFailCount,
                    statStaleCount,
                    cacheCheckElapsedMs: cacheCheckElapsed,
                    statElapsedMs: statElapsed,
                    skipStatCheck,
                    parallelStatCheck
                });
                console.log('[WordCount][startup] summary:', {
                    total,
                    snapshotRestored: snapshotRestoredCount,
                    cachedAfterPrefetch: cachedCount,
                    needRecalculate: needCalculate,
                    staleCached,
                    cacheCheckElapsedMs: cacheCheckElapsed,
                    skipStatCheck,
                    parallelStatCheck
                });
                
                if (needCalculate === 0) {
                    progress.report({ message: `已从缓存加载 ${cachedCount} 个文件 ${formatElapsed()}` });
                    // 触发 UI 刷新，让 TreeView 显示缓存数据
                    this.refresh();
                    return;
                }

                progress.report({ message: `缓存命中 ${cachedCount}/${total}，处理剩余 ${needCalculate} 个… ${formatElapsed()}` });
                const phaseStartCompute = Date.now();

                // 统一小批量处理所有需要重新计算的文件：
                //  - 对于已有持久化缓存的文件，getOrCalculateFileStats 会先尝试内存/持久化缓存
                //  - 对于完全没有缓存的文件，则会走真正的异步计数
                let done = 0;
                const step = Math.max(0.05, 100 / Math.max(needCalculate, 1));

                const computeBatchSize = 20; // 控制批量大小，避免阻塞
                for (let i = 0; i < filesToCalculate.length; i += computeBatchSize) {
                    const batch = filesToCalculate.slice(i, i + computeBatchSize);
                    await Promise.all(batch.map(async file => {
                        try {
                            // 启动阶段激进优化：在此处 stat，并传入 getOrCalculateFileStats 以启用 workerHint
                            const st = await fs.promises.stat(file);
                            return this.getOrCalculateFileStats(file, false, { mtime: st.mtimeMs, size: st.size })
                                .catch(() => ({ total: 0, cjkChars: 0, asciiChars: 0, words: 0, nonWSChars: 0, nonWSNoPunct: 0 } as TextStats));
                        } catch {
                            return this.getOrCalculateFileStats(file)
                                .catch(() => ({ total: 0, cjkChars: 0, asciiChars: 0, words: 0, nonWSChars: 0, nonWSNoPunct: 0 } as TextStats));
                        }
                    }));
                    
                    done += batch.length;
                    progress.report({ 
                        increment: step * batch.length, 
                        message: `正在计算 ${done}/${needCalculate} ${formatElapsed()}` 
                    });
                    
                    // 每批之间让出线程
                    await new Promise(r => setImmediate(r));
                }

                progress.report({ message: `字数统计已准备就绪 (${total} 个文件) ${formatElapsed()}` });
                const computeElapsed = Date.now() - phaseStartCompute;
                console.log('[WordCount][startup] phase:compute', {
                    needCalculate,
                    elapsedMs: computeElapsed
                });
                console.log('[WordCount][startup] done:', {
                    elapsedMs: Date.now() - startTime,
                    elapsedHuman: formatElapsed(),
                    totalFiles: total,
                    snapshotEnabled: snapshotCfg.get<boolean>('enabled', true),
                    snapshotRestored: snapshotRestoredCount,
                    coldStart: !snapshotCfg.get<boolean>('enabled', true) || snapshotRestoredCount === 0,
                    computeElapsedMs: computeElapsed
                });
                
                // 标记初始加载完成，允许后续 getChildren 触发计算
                this.initialProgressCompleted = true;
                wcDebug('maybeShowInitialProgress:completed', total, 'files');
                
                // 后端计算：触发所有根目录的聚合计算（异步，不阻塞）
                const phaseStartDirAgg = Date.now();
                progress.report({ message: `计算目录统计中… ${formatElapsed()}` });
                const exts = getSupportedExtensions();
                for (const folder of folders) {
                    const root = folder.uri.fsPath;
                    try {
                        const dirents = await fs.promises.readdir(root, { withFileTypes: true });
                        void this.scheduleBackendCompute(root, dirents, []);
                    } catch (e) {
                        wcDebug('maybeShowInitialProgress:compute-dir-error', root, e);
                    }
                }
                console.log('[WordCount][startup] phase:dir-aggregate-started', {
                    roots: folders.length,
                    elapsedMs: Date.now() - phaseStartDirAgg
                });
                
                // 触发全局刷新，让 TreeView 显示加载的数据
                this.refresh();
            });
        } catch (error) {
            // 忽略进度异常，避免影响使用
            wcDebug('maybeShowInitialProgress:error', error);
            // 即使出错也标记完成，避免永久阻塞
            this.initialProgressCompleted = true;
        }
    }

    // 新增：确保在有计算任务时展示一个实时更新的进度条（非首次加载通用）
    private ensureComputeProgressLoop() {
        if (this.computeProgressLoopRunning) return;
        // 若当前没有任务，也不需要弹出
        if (this.inFlightFileStats.size === 0 && this.largeProcessingQueue.length === 0 && !this.largeProcessingRunning) {
            return;
        }
        this.computeProgressLoopRunning = true;
        void vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: '计算字数中…',
            cancellable: false
        }, async (progress) => {
            try {
                let tick = 0;
                while (this.inFlightFileStats.size > 0 || this.largeProcessingQueue.length > 0 || this.largeProcessingRunning) {
                    const remain = this.inFlightFileStats.size + this.largeProcessingQueue.length + (this.largeProcessingRunning ? 0 : 0);
                    // 轻微递增让进度条动起来（无固定总量，仅作视觉反馈）
                    progress.report({ increment: (tick % 5 === 0) ? 1 : 0, message: `剩余 ${remain} 个文件…` });
                    tick++;
                    await new Promise(r => setTimeout(r, 250));
                }
            } finally {
                this.computeProgressLoopRunning = false;
            }
        });
    }

    // 新增：批量预取当前目录下需要计算的文件的缓存（若后端支持批量），返回成功写入缓存的条目数
    private async prefetchDirStatsBatchIfPossible(files: string[]): Promise<number> {
        if (!files || files.length === 0) { return 0; }
        const ft = getFileTracker();
        if (!ft) { return 0; }
        try {
            const dm: any = ft.getDataManager();
            if (typeof dm.getWordCountStatsBatchByPaths === 'function') {
                const map: Map<string, { stats: TextStats; mtime?: number; size?: number }> = await dm.getWordCountStatsBatchByPaths(files);
                
                // 批量获取文件 stat（避免逐个调用）
                const statsPromises = files.map(f => 
                    fs.promises.stat(f).catch(() => null)
                );
                const fileStats = await Promise.all(statsPromises);
                const fileStatsMap = new Map<string, fs.Stats>();
                for (let i = 0; i < files.length; i++) {
                    if (fileStats[i]) {
                        fileStatsMap.set(files[i], fileStats[i]!);
                    }
                }
                
                // 写入内存缓存，减少后续单个读取/计算
                let changedCount = 0;
                for (const [abs, rec] of map.entries()) {
                    if (rec?.stats) {
                        const st = fileStatsMap.get(abs);
                        const mtime = rec.mtime ?? st?.mtimeMs;
                        const size = rec.size ?? st?.size;
                        if (mtime !== undefined && size !== undefined) {
                            this.statsCache.set(abs, { stats: rec.stats, mtime, size });
                        } else {
                            this.statsCache.set(abs, { stats: rec.stats, mtime: mtime ?? Date.now(), size });
                        }
                        changedCount++;
                    }
                }
                
                wcDebug('prefetch:cache-loaded', map.size, 'entries', 'written', changedCount);
                return changedCount;
            }
        } catch (e) {
            wcDebug('prefetch:error', e);
        }
        return 0;
    }
}

export class WordCountItem extends vscode.TreeItem {
    constructor(
        public readonly resourceUri: vscode.Uri,
        public readonly label: string,
        private readonly stats: TextStats,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        private readonly isPlaceholder: boolean = false,
        private readonly isResourceFolder: boolean = false,
        private readonly isReferenceFile: boolean = false
    ) {
        super(label, collapsibleState);

        this.resourceUri = resourceUri;

        // 设置 contextValue 用于右键菜单
        const isDirectory = collapsibleState !== vscode.TreeItemCollapsibleState.None;
        this.contextValue = isDirectory ? 'wordCountFolder' : 'wordCountFile';
        const isFile = collapsibleState === vscode.TreeItemCollapsibleState.None;

        if (isPlaceholder) {
            // 占位阶段：同时在 description 中展示文件名，保证名称可见
            // this.description = `${label} (计算中...)`;
            this.description = `(计算中...)`;
            this.iconPath = new vscode.ThemeIcon('loading~spin');
            const tip = new vscode.MarkdownString();
            tip.appendMarkdown(`**路径**: \`${resourceUri.fsPath}\``);
            tip.appendMarkdown(`\n\n正在计算字数统计...`);
            tip.isTrusted = true;
            this.tooltip = tip;
        } else if (isReferenceFile) {
            // 参考文件：不显示字数统计
            this.description = '';
        } else {
            const formatted = formatWordCountNumber(getPrimaryWordCount(stats));
            this.description = `(${formatted})`;
            if (isDirectory && this.isResourceFolder) {
                this.description = `🔑 ${this.description}`;
            }
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
            tip.appendMarkdown(`\n\n不含标点（词计）: **${stats.total}**`);
            tip.appendMarkdown(`\n\n不含标点（非空白且排除标点）: **${stats.nonWSNoPunct}**`);
            tip.appendMarkdown(`\n\n**当前显示单位（${getPrimaryUnitLabel()}）**: **${getPrimaryWordCount(stats)}**`);
            if (isDirectory && this.isResourceFolder) {
                tip.appendMarkdown(`\n\n🔑 **已识别为资源文件夹**`);
            }
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

            // 根据配置为文件设置图标
            const iconStyle = vscode.workspace.getConfiguration('AndreaNovelHelper.package').get<string>('iconStyle', 'auto');
            const fileName = path.basename(resourceUri.fsPath);
            const ext = path.extname(fileName).toLowerCase();
            const isRoleFile = ext === '.ojson5' || ext === '.ojson';
            const isRelationshipFile = ext === '.rjson5' || ext === '.rjson';
            const isTimelineFile = ext === '.tjson5';

            // auto 或 custom 模式下，为特殊文件设置语义化图标
            if (iconStyle === 'custom' || (iconStyle === 'auto' && (isRoleFile || isRelationshipFile || isTimelineFile))) {
                if (isRoleFile) {
                    this.iconPath = new vscode.ThemeIcon('person');
                } else if (isRelationshipFile) {
                    this.iconPath = new vscode.ThemeIcon('type-hierarchy');
                } else if (isTimelineFile) {
                    this.iconPath = new vscode.ThemeIcon('git-branch');
                }
            }
            // theme 模式或 auto 模式下非特殊文件：不设置 iconPath，使用主题默认图标
        } else if (!isPlaceholder && this.isResourceFolder) {
            this.iconPath = new vscode.ThemeIcon('symbol-key');
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
                        const text = (doc.languageId === 'markdown') ? mdToPlainText(sel, getObsidianInlineRenderOptions(doc.uri)).text : sel;
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
                    else text = mdToPlainText(doc.getText(), getTxtExportObsidianInlineRenderOptions(doc.uri)).text;
                } catch {
                    text = mdToPlainText(doc.getText(), getTxtExportObsidianInlineRenderOptions(doc.uri)).text;
                }
                text = await renderPlainTextWithProcessor(doc, text);

                await vscode.env.clipboard.writeText(text);
                vscode.window.setStatusBarMessage('已复制纯文本（全文）', 1200);
            } catch (e) { /* ignore */ }
        }),
        vscode.commands.registerCommand('WordCount.exportTxt', async (node?: any) => {
            await exportTxtWithProcessor(node, undefined);
        }),
        vscode.commands.registerCommand('WordCount.exportTxtWithProcessor', async (node?: any) => {
            const id = await pickPlainTextProcessor(true);
            if (!id) return;
            await exportTxtWithProcessor(node, id);
        })
    );

    async function exportTxtWithProcessor(node?: any, processorId?: string) {
            try {
                // console.log('[exportTxt] argIsItem=', !!node, 'type=', node?.constructor?.name, 'uri=', node?.resourceUri?.fsPath);
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
                const inlineOptions = getTxtExportObsidianInlineRenderOptions(doc.uri);

                // Always render the file from disk (not relying on active editor content)
                let text: string;
                try {
                    if (doc.languageId === 'markdown') { text = mdToPlainText(doc.getText(), inlineOptions).text; }
                    else if (doc.languageId === 'plaintext') { text = txtToPlainText(doc.getText(), inlineOptions).text; }
                    else {
                        const maybe = (provider as any).renderToPlainText ? (provider as any).renderToPlainText(doc) : null;
                        if (maybe && typeof maybe.text === 'string') { text = maybe.text; }
                        else { text = doc.getText(); }
                    }
                } catch {
                    if (doc.languageId === 'markdown') { text = mdToPlainText(doc.getText(), inlineOptions).text; }
                    else if (doc.languageId === 'plaintext') { text = txtToPlainText(doc.getText(), inlineOptions).text; }
                    else { text = doc.getText(); }
                }
                await scriptExtensionRegistry.emit('beforePlainTextExport', {
                    uri: doc.uri.toString(),
                    fileName: doc.fileName,
                    processorId: processorId || vscode.workspace.getConfiguration('AndreaNovelHelper').get<string>('scripts.defaultPlainTextProcessor', 'internal')
                });
                text = await renderPlainTextWithProcessor(doc, text, processorId);

                const saveUri = await vscode.window.showSaveDialog({
                    defaultUri: uri.with({ path: uri.path.replace(/\.[^/\\.]+$/, '') + '.txt' }),
                    filters: { Text: ['txt'] }
                });
                if (!saveUri) return;
                await vscode.workspace.fs.writeFile(saveUri, new TextEncoder().encode(text));
                await scriptExtensionRegistry.emit('afterPlainTextExport', {
                    uri: doc.uri.toString(),
                    fileName: doc.fileName,
                    output: saveUri.toString(),
                    outputPath: saveUri.fsPath,
                    processorId: processorId || vscode.workspace.getConfiguration('AndreaNovelHelper').get<string>('scripts.defaultPlainTextProcessor', 'internal')
                });
                vscode.window.showInformationMessage(`导出完成：${saveUri.fsPath}`);
            } catch (e) { /* ignore */ }
    }
}

// —— 在 activate.ts 里调用 registerWordCountOpenWith(context) —__
