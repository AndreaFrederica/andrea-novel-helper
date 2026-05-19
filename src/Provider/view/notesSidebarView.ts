/* eslint-disable curly */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { outlineFS } from '../../activate';
import { ensureOutlineFileExists } from '../../utils/outline';
import { getFileTracker } from '../../utils/tracker/fileTracker';
import { WcignoreManager, WcignoreRule } from '../../utils/wcignoreManager';
import { createDashboardPlanFile } from './writingDashboardView';

type NotesTreeKind = 'outline' | 'dailyPlan' | 'note';
type NotesNodeKind = 'folder' | 'file' | 'trackedOutlineFolder' | 'trackedOutlineFile' | 'group' | 'info';

const TRACKED_PACKAGE_FILE_EXTENSIONS = new Set([
    '.md',
    '.markdown',
    '.txt',
    '.csv',
    '.json',
    '.json5',
    '.ojson',
    '.ojson5',
    '.rjson',
    '.rjson5',
    '.tjson5',
    '.toml',
]);

const NOVEL_HELPER_INTERNAL_SEGMENTS = new Set([
    '.anh-fsdb',
    'comments',
    'dashboard',
    'free-outline',
    'notes',
    'outline',
    'scripts',
    'templates',
    'typo',
]);

interface NotesTreeConfig {
    viewId: string;
    label: string;
    kind: NotesTreeKind;
    resolveRootPath: () => string | undefined;
    ensureRoot: boolean;
}

class NotesItem extends vscode.TreeItem {
    constructor(
        public readonly viewId: string,
        public readonly fullPath: string,
        public readonly isDirectory: boolean,
        public readonly nodeKind: NotesNodeKind = isDirectory ? 'folder' : 'file',
        public readonly isVirtualInfo = false,
        public readonly displayLabel?: string,
    ) {
        super(
            isVirtualInfo ? fullPath : (displayLabel || path.basename(fullPath)),
            isVirtualInfo
                ? vscode.TreeItemCollapsibleState.None
                : (nodeKind === 'group'
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : (isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None)),
        );

        if (isVirtualInfo) {
            this.contextValue = 'andreaNotesInfo';
            this.iconPath = new vscode.ThemeIcon('info');
            return;
        }

        if (nodeKind === 'group') {
            this.contextValue = 'andreaNotesGroup';
            this.iconPath = new vscode.ThemeIcon('calendar');
            return;
        }

        this.resourceUri = vscode.Uri.file(fullPath);
        if (nodeKind === 'trackedOutlineFolder') {
            this.contextValue = 'andreaTrackedOutlineFolder';
            this.iconPath = new vscode.ThemeIcon('folder-library');
        } else if (nodeKind === 'trackedOutlineFile') {
            this.contextValue = 'andreaTrackedOutlineFile';
            this.iconPath = new vscode.ThemeIcon('book');
        } else {
            this.contextValue = isDirectory ? 'andreaNotesFolder' : 'andreaNotesFile';
            this.iconPath = isDirectory ? vscode.ThemeIcon.Folder : vscode.ThemeIcon.File;
        }
        this.tooltip = nodeKind === 'trackedOutlineFolder' || nodeKind === 'trackedOutlineFile'
            ? buildTrackedOutlineTooltip(fullPath, isDirectory)
            : fullPath;

        if (nodeKind === 'trackedOutlineFolder') {
            this.command = {
                command: 'andrea.notes.openTrackedDirectoryOutline',
                title: '打开目录大纲',
                arguments: [this],
            };
            return;
        }

        if (nodeKind === 'trackedOutlineFile') {
            this.command = {
                command: 'andrea.notes.openTrackedChapterOutline',
                title: '打开章节大纲',
                arguments: [this],
            };
            return;
        }

        if (!isDirectory) {
            this.command = {
                command: 'andrea.notes.open',
                title: '打开笔记文件',
                arguments: [this],
            };
        }
    }
}

class NotesTreeProvider implements vscode.TreeDataProvider<NotesItem> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<NotesItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private readonly config: NotesTreeConfig) {}

    refresh() {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: NotesItem): vscode.TreeItem {
        return element;
    }

    getParent(element: NotesItem): NotesItem | undefined {
        if (element.isVirtualInfo) return undefined;

        const rootPath = this.getRootPath();
        if (!rootPath) return undefined;

        const parentPath = path.dirname(element.fullPath);
        if (parentPath === element.fullPath) return undefined;

        const normalizedRoot = path.resolve(rootPath);
        const normalizedParent = path.resolve(parentPath);
        if (normalizedParent === normalizedRoot) return undefined;
        if (!normalizedParent.startsWith(normalizedRoot + path.sep)) return undefined;

        return this.createItem(normalizedParent, true);
    }

    getRootPath(): string | undefined {
        const rootPath = this.config.resolveRootPath();
        if (!rootPath) return undefined;

        if (!this.config.ensureRoot) return rootPath;
        try {
            if (!fs.existsSync(rootPath)) fs.mkdirSync(rootPath, { recursive: true });
            return rootPath;
        } catch {
            return rootPath;
        }
    }

    async getChildren(element?: NotesItem): Promise<NotesItem[]> {
        const rootPath = this.getRootPath();
        if (!rootPath) {
            return [new NotesItem(this.config.viewId, '未打开工作区', false, 'info', true)];
        }

        const targetDir = element ? element.fullPath : rootPath;
        if (!fs.existsSync(targetDir)) {
            return [new NotesItem(this.config.viewId, '目录不存在', false, 'info', true)];
        }

        let entries: fs.Dirent[] = [];
        try {
            entries = fs.readdirSync(targetDir, { withFileTypes: true });
        } catch {
            return [];
        }

        const sorted = entries.sort((a, b) => {
            if (a.isDirectory() && !b.isDirectory()) return -1;
            if (!a.isDirectory() && b.isDirectory()) return 1;
            return a.name.localeCompare(b.name, 'zh-CN');
        });

        const items: NotesItem[] = [];
        for (const entry of sorted) {
            const fullPath = path.join(targetDir, entry.name);
            if (entry.isDirectory()) {
                items.push(this.createItem(fullPath, true));
                continue;
            }
            if (!entry.isFile()) continue;
            if (path.extname(entry.name).toLowerCase() !== '.md') continue;
            items.push(this.createItem(fullPath, false));
        }

        return items;
    }

    protected createItem(fullPath: string, isDirectory: boolean): NotesItem {
        return new NotesItem(this.config.viewId, fullPath, isDirectory);
    }
}

class TrackedOutlineTreeProvider extends NotesTreeProvider {
    constructor() {
        super({
            viewId: 'andrea.notesOutlineTree',
            label: '跟随目录大纲',
            kind: 'outline',
            resolveRootPath: () => getWorkspaceRoot(),
            ensureRoot: false,
        });
    }

    async getChildren(element?: NotesItem): Promise<NotesItem[]> {
        const wsRoot = this.getRootPath();
        if (!wsRoot) {
            return [new NotesItem('andrea.notesOutlineTree', '未打开工作区', false, 'info', true)];
        }

        const targetDir = element ? element.fullPath : wsRoot;
        if (!fs.existsSync(targetDir)) {
            return [new NotesItem('andrea.notesOutlineTree', '目录不存在', false, 'info', true)];
        }

        const rules = new WcignoreManager(wsRoot).parseCurrentRules();
        let entries: fs.Dirent[] = [];
        try {
            entries = fs.readdirSync(targetDir, { withFileTypes: true });
        } catch {
            return [];
        }

        const items = entries
            .filter(entry => {
                const fullPath = path.join(targetDir, entry.name);
                if (entry.isDirectory()) {
                    return !shouldIgnoreTrackedOutlinePath(wsRoot, fullPath, true, rules);
                }
                if (!entry.isFile()) return false;
                if (!isTrackedOutlineSourceFile(wsRoot, fullPath)) return false;
                return !shouldIgnoreTrackedOutlinePath(wsRoot, fullPath, false, rules);
            })
            .sort((a, b) => {
                if (a.isDirectory() && !b.isDirectory()) return -1;
                if (!a.isDirectory() && b.isDirectory()) return 1;
                return a.name.localeCompare(b.name, 'zh-CN');
            })
            .map(entry => this.createItem(path.join(targetDir, entry.name), entry.isDirectory()));

        return items;
    }

    protected override createItem(fullPath: string, isDirectory: boolean): NotesItem {
        return new NotesItem(
            'andrea.notesOutlineTree',
            fullPath,
            isDirectory,
            isDirectory ? 'trackedOutlineFolder' : 'trackedOutlineFile'
        );
    }
}

type DailyPlanGroupEntry = {
    key: string;
    label: string;
    items: NotesItem[];
};

class DailyPlanTreeProvider extends NotesTreeProvider {
    constructor() {
        super({
            viewId: 'andrea.notesDailyPlanTree',
            label: '每日计划',
            kind: 'dailyPlan',
            resolveRootPath: () => {
                const ws = getWorkspaceRoot();
                if (!ws) return undefined;
                return path.join(ws, 'novel-helper', 'dashboard', 'plan');
            },
            ensureRoot: true,
        });
    }

    async getChildren(element?: NotesItem): Promise<NotesItem[]> {
        const rootPath = this.getRootPath();
        if (!rootPath) {
            return [new NotesItem(this.getViewId(), '未打开工作区', false, 'info', true)];
        }

        if (!this.shouldGroupByTime()) {
            return super.getChildren(element);
        }

        if (element?.nodeKind === 'group') {
            const groups = this.collectGroups(rootPath);
            return groups.find(group => group.key === element.fullPath)?.items ?? [];
        }

        const groups = this.collectGroups(rootPath);
        return groups.map(group => new NotesItem(this.getViewId(), group.key, true, 'group', false, group.label));
    }

    protected override createItem(fullPath: string, isDirectory: boolean): NotesItem {
        return new NotesItem(this.getViewId(), fullPath, isDirectory);
    }

    private getViewId(): string {
        return 'andrea.notesDailyPlanTree';
    }

    private shouldGroupByTime(): boolean {
        return vscode.workspace
            .getConfiguration('AndreaNovelHelper.writingDashboard')
            .get<boolean>('planSidebar.groupByTime', true);
    }

    private collectGroups(rootPath: string): DailyPlanGroupEntry[] {
        let entries: fs.Dirent[] = [];
        try {
            entries = fs.readdirSync(rootPath, { withFileTypes: true });
        } catch {
            return [];
        }

        const files = entries
            .filter(entry => entry.isFile() && path.extname(entry.name).toLowerCase() === '.md')
            .map(entry => this.createItem(path.join(rootPath, entry.name), false));

        const grouped = new Map<string, DailyPlanGroupEntry>();
        for (const item of files) {
            const bucket = getDailyPlanTimeBucket(item.fullPath);
            const key = `daily-plan-group:${bucket.key}`;
            const existing = grouped.get(key);
            if (existing) {
                existing.items.push(item);
                continue;
            }
            grouped.set(key, {
                key,
                label: bucket.label,
                items: [item],
            });
        }

        return Array.from(grouped.values())
            .map(group => ({
                ...group,
                items: group.items.sort((a, b) => path.basename(b.fullPath).localeCompare(path.basename(a.fullPath), 'zh-CN')),
            }))
            .sort((a, b) => b.key.localeCompare(a.key, 'zh-CN'));
    }
}

function getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function getDailyPlanAutoName(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}.md`;
}

function getDailyPlanTimeBucket(fullPath: string): { key: string; label: string } {
    const parsed = parseDailyPlanDate(fullPath);
    if (parsed) {
        return {
            key: `${parsed.year}-${parsed.month}`,
            label: `${parsed.year}年${parsed.month}月`,
        };
    }
    return {
        key: 'unsorted',
        label: '未分类',
    };
}

function parseDailyPlanDate(fullPath: string): { year: string; month: string; day: string } | undefined {
    const fileName = path.basename(fullPath, path.extname(fullPath));
    const fromName = fileName.match(/(20\d{2})[-_年]?(\d{2})[-_月]?(\d{2})/);
    if (fromName) {
        return { year: fromName[1], month: fromName[2], day: fromName[3] };
    }

    try {
        const raw = fs.readFileSync(fullPath, 'utf8');
        const fromFrontmatter = raw.match(/^[ \t]*date:\s*(20\d{2})-(\d{2})-(\d{2})/m);
        if (fromFrontmatter) {
            return { year: fromFrontmatter[1], month: fromFrontmatter[2], day: fromFrontmatter[3] };
        }
    } catch {
        // ignore
    }

    try {
        const stats = fs.statSync(fullPath);
        const year = String(stats.mtime.getFullYear());
        const month = String(stats.mtime.getMonth() + 1).padStart(2, '0');
        const day = String(stats.mtime.getDate()).padStart(2, '0');
        return { year, month, day };
    } catch {
        return undefined;
    }
}

function encodeSegments(relPath: string): string {
    return relPath.replace(/\\/g, '/').split('/').filter(Boolean).map(part => encodeURIComponent(part)).join('/');
}

function getOutlineRelativeRoot(): string {
    return (vscode.workspace.getConfiguration('AndreaNovelHelper').get<string>('outlinePath', 'novel-helper/outline') || 'novel-helper/outline').replace(/\\/g, '/').replace(/^\/+/, '');
}

function getOutlineRootPath(): string | undefined {
    const wsRoot = getWorkspaceRoot();
    if (!wsRoot) return undefined;
    return path.join(wsRoot, getOutlineRelativeRoot());
}

function getTrackedPrimaryUnit(): 'excludePunct' | 'includePunct' | 'nonWSNoPunct' {
    const raw = vscode.workspace
        .getConfiguration('AndreaNovelHelper.wordCount')
        .get<string>('primaryUnit', 'excludePunct');
    return raw === 'includePunct' || raw === 'nonWSNoPunct' ? raw : 'excludePunct';
}

function getTrackedPrimaryUnitLabel(): string {
    const unit = getTrackedPrimaryUnit();
    if (unit === 'includePunct') return '含标点';
    if (unit === 'nonWSNoPunct') return '不含标点';
    return '词计';
}

function getTrackedPrimaryWordCount(stats: {
    nonWSChars: number;
    nonWSNoPunct: number;
    total: number;
}): number {
    const unit = getTrackedPrimaryUnit();
    if (unit === 'includePunct') return stats.nonWSChars || stats.total;
    if (unit === 'nonWSNoPunct') return stats.nonWSNoPunct || stats.total;
    return stats.total;
}

function formatTrackedWordCount(total: number): string {
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

function formatTrackedTimestamp(timestamp?: number): string {
    if (!timestamp || Number.isNaN(timestamp)) return '未知';
    return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
}

function resolveTrackedOutlineForSource(sourcePath: string, isDirectory: boolean): { outlinePath: string; outlineRelPath: string } | undefined {
    const outlineRoot = getOutlineRootPath();
    const outlineRelPath = getTrackedOutlineRelativePath(sourcePath, isDirectory);
    if (!outlineRoot || !outlineRelPath) return undefined;

    return {
        outlinePath: path.join(outlineRoot, outlineRelPath),
        outlineRelPath,
    };
}

function appendTooltipLine(markdown: vscode.MarkdownString, label: string, value: string): void {
    markdown.appendMarkdown(`**${label}**: `);
    markdown.appendText(value);
    markdown.appendMarkdown('  \n');
}

function buildTrackedOutlineTooltip(sourcePath: string, isDirectory: boolean): vscode.MarkdownString {
    const markdown = new vscode.MarkdownString();
    const resolved = resolveTrackedOutlineForSource(sourcePath, isDirectory);
    const tracker = getFileTracker();
    const dataManager = tracker?.getDataManager();
    const outlinePath = resolved?.outlinePath;
    const outlineExists = !!outlinePath && fs.existsSync(outlinePath);
    const sourceMeta = dataManager?.getFileByPath(sourcePath);
    const outlineMeta = outlineExists && outlinePath ? dataManager?.getFileByPath(outlinePath) : undefined;
    const wordCountMeta = outlineMeta?.wordCountStats ? outlineMeta : sourceMeta?.wordCountStats ? sourceMeta : undefined;
    const wordCountText = wordCountMeta?.wordCountStats
        ? formatTrackedWordCount(getTrackedPrimaryWordCount(wordCountMeta.wordCountStats))
        : '未统计';

    markdown.appendMarkdown('**跟随大纲元数据**  \n');
    appendTooltipLine(markdown, '大纲文件', outlinePath ? path.basename(outlinePath) : '未生成');
    appendTooltipLine(markdown, '大纲 UUID', outlineMeta?.uuid || '未追踪');
    appendTooltipLine(markdown, '大纲路径', outlinePath || '未生成');
    appendTooltipLine(markdown, '源路径', sourcePath);
    appendTooltipLine(markdown, '源 UUID', sourceMeta?.uuid || '未追踪');
    appendTooltipLine(markdown, `字数（${getTrackedPrimaryUnitLabel()}）`, wordCountText);

    if (outlineMeta?.size !== undefined) {
        appendTooltipLine(markdown, '大纲大小', `${outlineMeta.size} B`);
    }

    if (outlineMeta?.mtime || sourceMeta?.mtime) {
        appendTooltipLine(markdown, '最近更新', formatTrackedTimestamp(outlineMeta?.mtime || sourceMeta?.mtime));
    }

    return markdown;
}

function shouldIgnoreOutlineByRules(relPath: string, rules: WcignoreRule[]): boolean {
    const posix = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
    const baseName = posix.split('/').pop() || '';
    for (const rule of rules) {
        if (!rule.enabled) continue;
        let pattern = rule.pattern.trim();
        pattern = pattern.replace(/\\/g, '/').replace(/^\/+/, '');
        if (!pattern) continue;
        if (pattern.endsWith('/')) {
            const prefix = pattern.slice(0, -1);
            if (posix.startsWith(prefix) || baseName === prefix) return true;
            continue;
        }
        const hasWildcard = /[\*\?]/.test(pattern);
        if (pattern.includes('/')) {
            if (hasWildcard) {
                const regexp = new RegExp('^' + pattern.split('').map(char => char === '*' ? '[^/]*' : char === '?' ? '[^/]' : char.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('') + '$');
                if (regexp.test(posix)) return true;
            } else if (posix === pattern || posix.endsWith(`/${pattern}`)) {
                return true;
            }
            continue;
        }
        if (hasWildcard) {
            const regexp = new RegExp('^' + pattern.split('').map(char => char === '*' ? '.*' : char === '?' ? '.' : char.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('') + '$');
            if (regexp.test(baseName)) return true;
        } else if (baseName === pattern) {
            return true;
        }
    }
    return false;
}

function shouldIgnoreTrackedOutlinePath(wsRoot: string, targetPath: string, isDirectory: boolean, rules: WcignoreRule[]): boolean {
    const relPath = path.relative(wsRoot, targetPath).replace(/\\/g, '/').replace(/^\/+/, '');
    if (!relPath) return false;

    const segments = relPath.split('/').filter(Boolean);
    const firstSegment = segments[0];
    if (['.git', '.vscode', 'node_modules', 'out', 'dist', 'target'].includes(firstSegment)) {
        return true;
    }

    const outlineRelRoot = getOutlineRelativeRoot();
    if (relPath === outlineRelRoot || relPath.startsWith(`${outlineRelRoot}/`)) {
        return true;
    }

    if (firstSegment === 'novel-helper' && segments[1] && NOVEL_HELPER_INTERNAL_SEGMENTS.has(segments[1])) {
        return true;
    }

    return shouldIgnoreOutlineByRules(relPath, rules);
}

function isTrackedOutlineSourceFile(wsRoot: string, targetPath: string): boolean {
    const ext = path.extname(targetPath).toLowerCase();
    if (ext === '.md') return true;

    const relPath = path.relative(wsRoot, targetPath).replace(/\\/g, '/').replace(/^\/+/, '');
    const firstSegment = relPath.split('/')[0];
    if (firstSegment !== 'novel-helper') return false;

    return TRACKED_PACKAGE_FILE_EXTENSIONS.has(ext);
}

function getTrackedOutlineRelativePath(sourcePath: string, isDirectory: boolean): string | undefined {
    const wsRoot = getWorkspaceRoot();
    if (!wsRoot) return undefined;

    const relPath = path.relative(wsRoot, sourcePath).replace(/\\/g, '/').replace(/^\/+/, '');
    if (!relPath || relPath.startsWith('..')) return undefined;

    if (isDirectory) {
        const key = relPath.split('/').filter(Boolean).pop() || 'root';
        return `${relPath}/${key}_dir_outline.md`;
    }

    const dirName = path.posix.dirname(relPath);
    const baseName = path.posix.basename(relPath, path.posix.extname(relPath));
    return dirName === '.' ? `${baseName}_outline.md` : `${dirName}/${baseName}_outline.md`;
}

function ensureTrackedOutlineForSource(sourcePath: string, isDirectory: boolean): { outlinePath: string; outlineRelPath: string } | undefined {
    const tracked = resolveTrackedOutlineForSource(sourcePath, isDirectory);
    if (!tracked) return undefined;

    const { outlinePath, outlineRelPath } = tracked;
    const label = isDirectory ? '📁目录大纲' : '📄文件大纲';
    const secondLine = isDirectory
        ? `目录：${path.basename(sourcePath)}`
        : `文件：${path.basename(sourcePath)}`;

    ensureOutlineFileExists(outlinePath, label, secondLine);
    return { outlinePath, outlineRelPath };
}

async function openTrackedOutlineForSource(sourcePath: string, isDirectory: boolean): Promise<void> {
    const tracked = ensureTrackedOutlineForSource(sourcePath, isDirectory);
    if (!tracked) {
        vscode.window.showErrorMessage('无法解析对应的大纲文件。');
        return;
    }

    if (outlineFS) {
        outlineFS.refreshByTraditionalRel(tracked.outlineRelPath);
    }

    await vscode.commands.executeCommand(
        'vscode.open',
        vscode.Uri.parse(`andrea-outline://outline/direct/${encodeSegments(tracked.outlineRelPath)}`),
        { preview: false }
    );
}

async function openTrackedOutlineForSourceSafely(sourcePath: string, isDirectory: boolean): Promise<void> {
    const tracked = resolveTrackedOutlineForSource(sourcePath, isDirectory);
    if (!tracked) {
        vscode.window.showErrorMessage('无法解析对应的大纲文件。');
        return;
    }

    if (!fs.existsSync(tracked.outlinePath)) {
        const pick = await vscode.window.showWarningMessage(
            `对应的大纲文件不存在，是否创建？\n${tracked.outlinePath}`,
            { modal: true },
            '创建并打开'
        );
        if (pick !== '创建并打开') return;
        const created = ensureTrackedOutlineForSource(sourcePath, isDirectory);
        if (!created) {
            vscode.window.showErrorMessage('创建对应的大纲文件失败。');
            return;
        }
    }

    if (outlineFS) {
        outlineFS.refreshByTraditionalRel(tracked.outlineRelPath);
    }

    await vscode.commands.executeCommand(
        'vscode.open',
        vscode.Uri.parse(`andrea-outline://outline/direct/${encodeSegments(tracked.outlineRelPath)}`),
        { preview: false }
    );
}

async function openTrackedDirectoryOutline(item?: NotesItem): Promise<void> {
    if (!item || item.isVirtualInfo) return;
    await openTrackedOutlineForSource(item.fullPath, true);
}

async function openTrackedChapterOutline(item?: NotesItem): Promise<void> {
    if (!item || item.isVirtualInfo) return;
    await openTrackedOutlineForSource(item.fullPath, false);
}

function resolvePathLikeTarget(target: unknown): { fullPath: string; isDirectory: boolean } | undefined {
    if (!target) return undefined;

    if (target instanceof NotesItem) {
        if (target.isVirtualInfo) return undefined;
        return { fullPath: target.fullPath, isDirectory: target.isDirectory };
    }

    if (target instanceof vscode.Uri) {
        const fullPath = target.fsPath;
        if (!fullPath) return undefined;
        return { fullPath, isDirectory: fs.existsSync(fullPath) ? fs.statSync(fullPath).isDirectory() : false };
    }

    if (typeof target === 'string') {
        return { fullPath: target, isDirectory: fs.existsSync(target) ? fs.statSync(target).isDirectory() : false };
    }

    if (typeof target === 'object') {
        const candidate = target as {
            fullPath?: string;
            fsPath?: string;
            resourceUri?: vscode.Uri;
            isDirectory?: boolean;
            collapsibleState?: vscode.TreeItemCollapsibleState;
        };
        const fullPath = candidate.fullPath || candidate.fsPath || candidate.resourceUri?.fsPath;
        if (!fullPath) return undefined;

        const inferredDirectory = typeof candidate.isDirectory === 'boolean'
            ? candidate.isDirectory
            : candidate.collapsibleState !== undefined
                ? candidate.collapsibleState !== vscode.TreeItemCollapsibleState.None
                : (fs.existsSync(fullPath) ? fs.statSync(fullPath).isDirectory() : false);

        return { fullPath, isDirectory: inferredDirectory };
    }

    return undefined;
}

async function openTrackedOutlineFromTarget(target?: unknown): Promise<void> {
    const resolved = resolvePathLikeTarget(target);
    if (!resolved) return;
    try {
        await openTrackedOutlineForSourceSafely(resolved.fullPath, resolved.isDirectory);
    } catch (error) {
        vscode.window.showErrorMessage(`打开对应大纲失败: ${error}`);
    }
}

function isWorkspacePackagePath(fullPath: string): boolean {
    const wsRoot = getWorkspaceRoot();
    if (!wsRoot) return false;
    const helperRoot = path.join(wsRoot, 'novel-helper');
    const normalizedTarget = path.resolve(fullPath);
    const normalizedHelperRoot = path.resolve(helperRoot);
    return normalizedTarget === normalizedHelperRoot || normalizedTarget.startsWith(normalizedHelperRoot + path.sep);
}

async function revealPathInVSCodeExplorer(fullPath: string): Promise<boolean> {
    if (!fullPath || !fs.existsSync(fullPath)) return false;
    try {
        await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(fullPath));
        return true;
    } catch {
        return false;
    }
}

async function revealPathSmartly(fullPath: string): Promise<void> {
    if (!fullPath || !fs.existsSync(fullPath)) {
        vscode.window.showErrorMessage(`路径不存在，无法定位：${fullPath || '(空路径)'}`);
        return;
    }

    const uri = vscode.Uri.file(fullPath);
    const packageFirst = isWorkspacePackagePath(fullPath);
    const packageReveal = () => vscode.commands.executeCommand<boolean>('AndreaNovelHelper.package.revealPath', uri, { silent: true });
    const writingReveal = () => vscode.commands.executeCommand<boolean>('AndreaNovelHelper.wordCount.revealPath', uri, { silent: true });

    const revealed = packageFirst
        ? await packageReveal() || await writingReveal()
        : await writingReveal() || await packageReveal();
    if (revealed) return;

    if (await revealPathInVSCodeExplorer(fullPath)) return;

    vscode.window.showErrorMessage(`无法在写作资源管理器、包管理器或 VS Code 文件资源管理器中定位：${fullPath}`);
}

async function revealTrackedOutlineStorage(item?: NotesItem): Promise<void> {
    if (!item || item.isVirtualInfo) return;
    const tracked = resolveTrackedOutlineForSource(item.fullPath, item.nodeKind === 'trackedOutlineFolder');
    if (!tracked) {
        vscode.window.showErrorMessage('无法解析对应的大纲文件。');
        return;
    }
    await revealPathSmartly(tracked.outlinePath);
}

async function findTrackedOutlineItemByPath(
    provider: TrackedOutlineTreeProvider,
    fullPath: string,
): Promise<NotesItem | undefined> {
    const rootPath = provider.getRootPath();
    if (!rootPath) return undefined;

    const normalizedRoot = path.resolve(rootPath);
    const normalizedTarget = path.resolve(fullPath);
    if (normalizedTarget === normalizedRoot) return undefined;
    if (!normalizedTarget.startsWith(normalizedRoot + path.sep)) return undefined;

    const relPath = path.relative(normalizedRoot, normalizedTarget);
    if (!relPath || relPath.startsWith('..')) return undefined;

    const segments = relPath.split(path.sep).filter(Boolean);
    let current: NotesItem | undefined;

    for (const segment of segments) {
        const children = await provider.getChildren(current);
        const nextPath = current ? path.join(current.fullPath, segment) : path.join(normalizedRoot, segment);
        const next = children.find(item => path.resolve(item.fullPath) === path.resolve(nextPath));
        if (!next) return undefined;
        current = next;
    }

    return current;
}

async function revealTrackedOutlineInTree(
    outlineProvider: TrackedOutlineTreeProvider,
    outlineView: vscode.TreeView<NotesItem>,
    target?: unknown,
): Promise<void> {
    const resolved = resolvePathLikeTarget(target);
    if (!resolved) return;

    const item = await findTrackedOutlineItemByPath(outlineProvider, resolved.fullPath);
    if (!item) {
        vscode.window.showWarningMessage('无法在跟随目录大纲树中定位对应节点。');
        return;
    }

    await vscode.commands.executeCommand('andrea.notesOutlineTree.focus');
    await outlineView.reveal(item, {
        select: true,
        focus: true,
        expand: resolved.isDirectory ? 1 : true,
    });
}

async function openTrackedSourceFile(item?: NotesItem): Promise<void> {
    if (!item || item.isVirtualInfo || item.nodeKind !== 'trackedOutlineFile') return;
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(item.fullPath));
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Active);
}

async function revealTrackedInWritingExplorer(item?: NotesItem): Promise<void> {
    if (!item || item.isVirtualInfo) return;
    await revealPathSmartly(item.fullPath);
}

function ensureMdName(name: string): string {
    const trimmed = name.trim();
    const safe = path.basename(trimmed).replace(/[<>:"/\\|?*\x00-\x1F]/g, '-');
    if (!safe) return '未命名.md';
    return safe.toLowerCase().endsWith('.md') ? safe : `${safe}.md`;
}

async function askNewFileName(placeHolder: string): Promise<string | undefined> {
    const fileName = await vscode.window.showInputBox({
        prompt: '输入 Markdown 文件名',
        placeHolder,
        validateInput: value => value.trim() ? null : '文件名不能为空',
    });
    if (!fileName) return undefined;
    return ensureMdName(fileName);
}

async function askNewFolderName(placeHolder: string): Promise<string | undefined> {
    const folderName = await vscode.window.showInputBox({
        prompt: '输入文件夹名称',
        placeHolder,
        validateInput: value => value.trim() ? null : '文件夹名不能为空',
    });
    if (!folderName) return undefined;
    return path.basename(folderName.trim()).replace(/[<>:"/\\|?*\x00-\x1F]/g, '-');
}

function getPathForCreate(provider: NotesTreeProvider, item?: NotesItem): string | undefined {
    const root = provider.getRootPath();
    if (!root) return undefined;
    if (!item) return root;
    return item.isDirectory ? item.fullPath : path.dirname(item.fullPath);
}

async function createMarkdownInProvider(provider: NotesTreeProvider, defaultName: string, item?: NotesItem): Promise<void> {
    const targetDir = getPathForCreate(provider, item);
    if (!targetDir) {
        vscode.window.showErrorMessage('当前没有可用工作区目录。');
        return;
    }

    const fileName = await askNewFileName(defaultName);
    if (!fileName) return;

    const filePath = path.join(targetDir, fileName);
    if (fs.existsSync(filePath)) {
        vscode.window.showWarningMessage(`文件已存在：${fileName}`);
        return;
    }

    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(filePath, `# ${path.basename(fileName, '.md')}\n\n`, 'utf8');
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Active);
    provider.refresh();
}

async function createDailyPlanInProvider(provider: NotesTreeProvider, defaultName: string): Promise<void> {
    const rootPath = provider.getRootPath();
    if (!rootPath) {
        vscode.window.showErrorMessage('当前没有可用工作区目录。');
        return;
    }

    const namingMode = await vscode.window.showQuickPick([
        {
            label: '按日期命名',
            description: getDailyPlanAutoName(),
            value: 'date',
        },
        {
            label: '自定义文件名',
            description: defaultName,
            value: 'custom',
        },
    ], {
        placeHolder: '选择每日计划文件命名方式',
    });
    if (!namingMode) return;

    const fileName = namingMode.value === 'date'
        ? getDailyPlanAutoName()
        : await askNewFileName(defaultName);
    if (!fileName) return;

    const createdFileName = await createDashboardPlanFile(fileName);
    const filePath = path.join(rootPath, createdFileName);
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Active);
    provider.refresh();
}

async function createFolderInProvider(provider: NotesTreeProvider, defaultName: string, item?: NotesItem): Promise<void> {
    const targetDir = getPathForCreate(provider, item);
    if (!targetDir) {
        vscode.window.showErrorMessage('当前没有可用工作区目录。');
        return;
    }

    const folderName = await askNewFolderName(defaultName);
    if (!folderName) return;

    const dirPath = path.join(targetDir, folderName);
    if (fs.existsSync(dirPath)) {
        vscode.window.showWarningMessage(`文件夹已存在：${folderName}`);
        return;
    }

    fs.mkdirSync(dirPath, { recursive: true });
    provider.refresh();
}

async function createTrackedChapterInProvider(provider: NotesTreeProvider, defaultName: string, item?: NotesItem): Promise<void> {
    const wsRoot = provider.getRootPath();
    if (!wsRoot) {
        vscode.window.showErrorMessage('当前没有可用工作区目录。');
        return;
    }

    const targetDir = item ? (item.isDirectory ? item.fullPath : path.dirname(item.fullPath)) : wsRoot;
    const fileName = await askNewFileName(defaultName);
    if (!fileName) return;

    const filePath = path.join(targetDir, fileName);
    if (fs.existsSync(filePath)) {
        vscode.window.showWarningMessage(`文件已存在：${fileName}`);
        return;
    }

    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(filePath, `# ${path.basename(fileName, '.md')}\n\n`, 'utf8');
    ensureTrackedOutlineForSource(filePath, false);
    await openTrackedOutlineForSource(filePath, false);
    provider.refresh();
}

async function createTrackedFolderInProvider(provider: NotesTreeProvider, defaultName: string, item?: NotesItem): Promise<void> {
    const wsRoot = provider.getRootPath();
    if (!wsRoot) {
        vscode.window.showErrorMessage('当前没有可用工作区目录。');
        return;
    }

    const targetDir = item ? (item.isDirectory ? item.fullPath : path.dirname(item.fullPath)) : wsRoot;
    const folderName = await askNewFolderName(defaultName);
    if (!folderName) return;

    const dirPath = path.join(targetDir, folderName);
    if (fs.existsSync(dirPath)) {
        vscode.window.showWarningMessage(`文件夹已存在：${folderName}`);
        return;
    }

    fs.mkdirSync(dirPath, { recursive: true });
    ensureTrackedOutlineForSource(dirPath, true);
    await openTrackedOutlineForSource(dirPath, true);
    provider.refresh();
}

export function registerNotesSidebarViews(context: vscode.ExtensionContext): void {
    const outlineProvider = new TrackedOutlineTreeProvider();

    const freeOutlineProvider = new NotesTreeProvider({
        viewId: 'andrea.notesFreeOutlineTree',
        label: '自由大纲',
        kind: 'note',
        resolveRootPath: () => {
            const ws = getWorkspaceRoot();
            if (!ws) return undefined;
            return path.join(ws, 'novel-helper', 'free-outline');
        },
        ensureRoot: true,
    });

    const dailyPlanProvider = new DailyPlanTreeProvider();

    const customNotesProvider = new NotesTreeProvider({
        viewId: 'andrea.notesCustomTree',
        label: '笔记',
        kind: 'note',
        resolveRootPath: () => {
            const ws = getWorkspaceRoot();
            if (!ws) return undefined;
            return path.join(ws, 'novel-helper', 'notes');
        },
        ensureRoot: true,
    });

    const providers = new Map<string, NotesTreeProvider>([
        ['andrea.notesOutlineTree', outlineProvider],
        ['andrea.notesFreeOutlineTree', freeOutlineProvider],
        ['andrea.notesDailyPlanTree', dailyPlanProvider],
        ['andrea.notesCustomTree', customNotesProvider],
    ]);

    const buildWatcher = (provider: NotesTreeProvider): vscode.FileSystemWatcher | undefined => {
        const rootPath = provider.getRootPath();
        if (!rootPath || !fs.existsSync(rootPath)) return undefined;

        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(rootPath, '**/*'));
        const refresh = () => provider.refresh();
        watcher.onDidCreate(refresh);
        watcher.onDidChange(refresh);
        watcher.onDidDelete(refresh);
        return watcher;
    };

    let outlineWatcher = buildWatcher(outlineProvider);
    const freeOutlineWatcher = buildWatcher(freeOutlineProvider);
    const dailyPlanWatcher = buildWatcher(dailyPlanProvider);
    const customNotesWatcher = buildWatcher(customNotesProvider);

    const outlineTreeView = vscode.window.createTreeView('andrea.notesOutlineTree', { treeDataProvider: outlineProvider, showCollapseAll: true });

    const views = [
        outlineTreeView,
        vscode.window.createTreeView('andrea.notesFreeOutlineTree', { treeDataProvider: freeOutlineProvider, showCollapseAll: true }),
        vscode.window.createTreeView('andrea.notesDailyPlanTree', { treeDataProvider: dailyPlanProvider, showCollapseAll: true }),
        vscode.window.createTreeView('andrea.notesCustomTree', { treeDataProvider: customNotesProvider, showCollapseAll: true }),
    ];

    const getProviderByViewId = (viewId: string): NotesTreeProvider | undefined => providers.get(viewId);

    context.subscriptions.push(
        ...views,
        ...(outlineWatcher ? [outlineWatcher] : []),
        ...(freeOutlineWatcher ? [freeOutlineWatcher] : []),
        ...(dailyPlanWatcher ? [dailyPlanWatcher] : []),
        ...(customNotesWatcher ? [customNotesWatcher] : []),
        vscode.commands.registerCommand('andrea.notes.refreshOutlineTree', () => outlineProvider.refresh()),
        vscode.commands.registerCommand('andrea.notes.refreshFreeOutlineTree', () => freeOutlineProvider.refresh()),
        vscode.commands.registerCommand('andrea.notes.refreshDailyPlanTree', () => dailyPlanProvider.refresh()),
        vscode.commands.registerCommand('andrea.notes.refreshCustomTree', () => customNotesProvider.refresh()),
        vscode.commands.registerCommand('andrea.notes.createTrackedOutlineChapter', async (item?: NotesItem) => {
            await createTrackedChapterInProvider(outlineProvider, '新章节.md', item);
        }),
        vscode.commands.registerCommand('andrea.notes.createTrackedOutlineFolder', async (item?: NotesItem) => {
            await createTrackedFolderInProvider(outlineProvider, '新目录', item);
        }),
        vscode.commands.registerCommand('andrea.notes.openTrackedDirectoryOutline', async (item?: NotesItem) => {
            await openTrackedDirectoryOutline(item);
        }),
        vscode.commands.registerCommand('andrea.notes.openTrackedChapterOutline', async (item?: NotesItem) => {
            await openTrackedChapterOutline(item);
        }),
        vscode.commands.registerCommand('andrea.notes.openTrackedOutlineForResource', async (target?: unknown) => {
            await openTrackedOutlineFromTarget(target);
        }),
        vscode.commands.registerCommand('andrea.notes.revealTrackedInOutlineTree', async (target?: unknown) => {
            await revealTrackedOutlineInTree(outlineProvider, outlineTreeView, target);
        }),
        vscode.commands.registerCommand('andrea.notes.openTrackedSourceFile', async (item?: NotesItem) => {
            await openTrackedSourceFile(item);
        }),
        vscode.commands.registerCommand('andrea.notes.revealTrackedInWritingExplorer', async (item?: NotesItem) => {
            await revealTrackedInWritingExplorer(item);
        }),
        vscode.commands.registerCommand('andrea.notes.revealTrackedOutlineStorage', async (item?: NotesItem) => {
            await revealTrackedOutlineStorage(item);
        }),

        vscode.commands.registerCommand('andrea.notes.createOutlineNote', async (item?: NotesItem) => {
            await createMarkdownInProvider(freeOutlineProvider, '新自由大纲.md', item);
        }),
        vscode.commands.registerCommand('andrea.notes.createDailyPlan', async (item?: NotesItem) => {
            await createDailyPlanInProvider(dailyPlanProvider, '每日计划.md');
        }),
        vscode.commands.registerCommand('andrea.notes.createCustomNote', async (item?: NotesItem) => {
            await createMarkdownInProvider(customNotesProvider, '笔记.md', item);
        }),

        vscode.commands.registerCommand('andrea.notes.createOutlineFolder', async (item?: NotesItem) => {
            await createFolderInProvider(freeOutlineProvider, '新文件夹', item);
        }),
        vscode.commands.registerCommand('andrea.notes.createDailyPlanFolder', async (item?: NotesItem) => {
            await createFolderInProvider(dailyPlanProvider, '新文件夹', item);
        }),
        vscode.commands.registerCommand('andrea.notes.createCustomFolder', async (item?: NotesItem) => {
            await createFolderInProvider(customNotesProvider, '新文件夹', item);
        }),

        vscode.commands.registerCommand('andrea.notes.createInFolder', async (item?: NotesItem) => {
            if (!item) return;
            const provider = getProviderByViewId(item.viewId);
            if (!provider) return;
            await createMarkdownInProvider(provider, '新建文件.md', item);
        }),
        vscode.commands.registerCommand('andrea.notes.createFolderInFolder', async (item?: NotesItem) => {
            if (!item) return;
            const provider = getProviderByViewId(item.viewId);
            if (!provider) return;
            await createFolderInProvider(provider, '新文件夹', item);
        }),

        vscode.commands.registerCommand('andrea.notes.open', async (item?: NotesItem) => {
            if (!item || item.isVirtualInfo) return;
            if (item.viewId === 'andrea.notesOutlineTree') {
                await openTrackedOutlineForSource(item.fullPath, item.nodeKind === 'trackedOutlineFolder');
                return;
            }
            if (item.isDirectory) return;
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(item.fullPath));
            await vscode.window.showTextDocument(doc, vscode.ViewColumn.Active);
        }),
        vscode.commands.registerCommand('andrea.notes.revealInExplorer', async (item?: NotesItem) => {
            if (!item || item.isVirtualInfo) return;
            await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(item.fullPath));
        }),
        vscode.commands.registerCommand('andrea.notes.rename', async (item?: NotesItem) => {
            if (!item || item.isVirtualInfo) return;
            const oldName = path.basename(item.fullPath);
            const input = await vscode.window.showInputBox({
                prompt: '输入新名称',
                value: oldName,
                validateInput: value => value.trim() ? null : '名称不能为空',
            });
            if (!input || input === oldName) return;

            const parent = path.dirname(item.fullPath);
            const targetName = item.isDirectory ? path.basename(input.trim()) : ensureMdName(input);
            const nextPath = path.join(parent, targetName);
            if (fs.existsSync(nextPath)) {
                vscode.window.showWarningMessage(`目标已存在：${targetName}`);
                return;
            }
            fs.renameSync(item.fullPath, nextPath);
            getProviderByViewId(item.viewId)?.refresh();
        }),
        vscode.commands.registerCommand('andrea.notes.delete', async (item?: NotesItem) => {
            if (!item || item.isVirtualInfo) return;
            const pick = await vscode.window.showWarningMessage(
                `确认删除：${path.basename(item.fullPath)}？`,
                { modal: true },
                '删除'
            );
            if (pick !== '删除') return;

            if (!fs.existsSync(item.fullPath)) return;
            if (item.isDirectory) {
                fs.rmSync(item.fullPath, { recursive: true, force: true });
            } else {
                fs.unlinkSync(item.fullPath);
            }
            getProviderByViewId(item.viewId)?.refresh();
        }),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('AndreaNovelHelper.outlinePath')) {
                outlineProvider.refresh();
                if (outlineWatcher) outlineWatcher.dispose();
                outlineWatcher = buildWatcher(outlineProvider);
                if (outlineWatcher) context.subscriptions.push(outlineWatcher);
            }
            if (event.affectsConfiguration('AndreaNovelHelper.writingDashboard.planSidebar.groupByTime')) {
                dailyPlanProvider.refresh();
            }
        }),
    );
}
