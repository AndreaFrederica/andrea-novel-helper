import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import JSON5 from 'json5';
import { buildHtml } from '../utils/html-builder';
import { roles } from '../../activate';
import {
    getAllTrackedFilesAsync,
    getAllWritingStatsAsync,
    getTrackingStatsAsync,
    getWritingProjectOverviewAsync,
    getWritingProjectSummaryAsync,
    type WritingStatsView,
} from '../../utils/tracker/globalFileTracking';
import { ProjectConfigManager, type ProjectConfig } from '../../projectConfig/projectConfigManager';

type DashboardWidgetId =
    | 'energy'
    | 'heatmap'
    | 'clock'
    | 'profile'
    | 'gantt'
    | 'quadrant'
    | 'plan'
    | 'tasks'
    | 'yearPlan'
    | 'logs'
    | 'timer';

const widgetTitles: Record<DashboardWidgetId, string> = {
    energy: '能量条形图',
    heatmap: '码字热力图',
    clock: '当前时间',
    profile: '我的小说',
    gantt: '任务甘特图',
    quadrant: '任务四象限',
    plan: '今日计划',
    tasks: '任务清单',
    yearPlan: '年计划',
    logs: '创作记录',
    timer: '计时器',
};

type DashboardState = Record<string, unknown> & {
    windows?: unknown[];
    selectedPlanFile?: unknown;
    planMarkdown?: unknown;
};

type DashboardLogEntry = {
    id: string;
    createdAt: string;
    completedAt: string;
    title: string;
    tag: string;
};

type DashboardWebviewSettings = {
    widgetShowHeader: boolean;
};

const dashboardDirName = path.join('novel-helper', 'dashboard');
const dashboardLayoutFileName = 'layout.json';
const dashboardTasksFileName = 'tasks.json5';
const dashboardPlanDirName = 'plan';
const defaultDashboardPlanFileName = 'plan.md';
const legacyDashboardPlanFileName = 'plan.md';
const dashboardViewType = 'andrea.writingDashboard';

const dashboardWidgetIds = Object.keys(widgetTitles) as DashboardWidgetId[];

function getWidgetViewType(widgetId: DashboardWidgetId): string {
    return `${dashboardViewType}.${widgetId}`;
}

export class WritingDashboardPanel {
    private static dashboardInstance: WritingDashboardPanel | undefined;
    private static widgetInstances = new Map<string, WritingDashboardPanel>();
    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private readonly route: string;
    private readonly instanceKey: string;
    private disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, route: string, instanceKey: string) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        this.route = route;
        this.instanceKey = instanceKey;

        this.update();

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message?.command) {
                    case 'dashboard.ready':
                        await this.postDashboardData();
                        break;
                    case 'dashboard.save':
                        await this.saveDashboardData(message.data);
                        await this.postDashboardData();
                        break;
                    case 'dashboard.selectPlanFile':
                        await this.selectPlanFile(message.fileName, message.currentState);
                        break;
                    case 'dashboard.createPlanFile':
                        await this.createPlanFile(message.fileName, message.currentState);
                        break;
                    case 'dashboard.openWidget':
                        this.openWidget(message.widgetId);
                        break;
                    case 'dashboard.openCommand':
                        if (message.commandId) {
                            await vscode.commands.executeCommand(message.commandId);
                        }
                        break;
                    case 'dashboard.openPlanFile':
                        await openDashboardPlanFile(message.fileName);
                        break;
                }
            },
            null,
            this.disposables
        );
    }

    private static getWebviewOptions(extensionUri: vscode.Uri): vscode.WebviewPanelOptions & vscode.WebviewOptions {
        const workspaceRoots = vscode.workspace.workspaceFolders?.map(folder => folder.uri) ?? [];
        return {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [
                vscode.Uri.joinPath(extensionUri, 'packages', 'webview', 'dist', 'spa'),
                vscode.Uri.joinPath(extensionUri, 'packages', 'webview', 'dist', 'spa', 'assets'),
                vscode.Uri.joinPath(extensionUri, 'media'),
                ...workspaceRoots,
            ]
        };
    }

    public static createOrShow(extensionUri: vscode.Uri): WritingDashboardPanel {
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
        if (WritingDashboardPanel.dashboardInstance) {
            WritingDashboardPanel.dashboardInstance.panel.reveal(column);
            return WritingDashboardPanel.dashboardInstance;
        }

        const panel = vscode.window.createWebviewPanel(
            dashboardViewType,
            '创作工作台',
            column,
            WritingDashboardPanel.getWebviewOptions(extensionUri)
        );

        WritingDashboardPanel.dashboardInstance = new WritingDashboardPanel(
            panel,
            extensionUri,
            '/writing-dashboard',
            'dashboard'
        );
        return WritingDashboardPanel.dashboardInstance;
    }

    public static createOrShowWidget(extensionUri: vscode.Uri, widgetId: string): WritingDashboardPanel {
        const normalizedId = normalizeWidgetId(widgetId);
        const title = widgetTitles[normalizedId];
        const instanceKey = `widget:${normalizedId}`;
        const existing = WritingDashboardPanel.widgetInstances.get(instanceKey);
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.Beside;
        if (existing) {
            existing.panel.reveal(column);
            return existing;
        }

        const panel = vscode.window.createWebviewPanel(
            getWidgetViewType(normalizedId),
            title,
            column,
            WritingDashboardPanel.getWebviewOptions(extensionUri)
        );

        const route = `/writing-dashboard-widget/${encodeURIComponent(normalizedId)}`;
        const instance = new WritingDashboardPanel(panel, extensionUri, route, instanceKey);
        WritingDashboardPanel.widgetInstances.set(instanceKey, instance);
        return instance;
    }

    public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri): WritingDashboardPanel {
        panel.webview.options = WritingDashboardPanel.getWebviewOptions(extensionUri);
        panel.title = '创作工作台';
        WritingDashboardPanel.dashboardInstance = new WritingDashboardPanel(
            panel,
            extensionUri,
            '/writing-dashboard',
            'dashboard'
        );
        return WritingDashboardPanel.dashboardInstance;
    }

    public static reviveWidget(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, widgetId: string): WritingDashboardPanel {
        const normalizedId = normalizeWidgetId(widgetId);
        const instanceKey = `widget:${normalizedId}`;
        panel.webview.options = WritingDashboardPanel.getWebviewOptions(extensionUri);
        panel.title = widgetTitles[normalizedId];
        const route = `/writing-dashboard-widget/${encodeURIComponent(normalizedId)}`;
        const instance = new WritingDashboardPanel(panel, extensionUri, route, instanceKey);
        WritingDashboardPanel.widgetInstances.set(instanceKey, instance);
        return instance;
    }

    private update() {
        let resourceMapperScriptUri: string | undefined;
        try {
            const mapperFile = vscode.Uri.joinPath(this.extensionUri, 'media', 'resource-mapper.js');
            resourceMapperScriptUri = this.panel.webview.asWebviewUri(mapperFile).toString();
        } catch (_) { }

        this.panel.webview.html = buildHtml(this.panel.webview, {
            spaRoot: vscode.Uri.joinPath(this.extensionUri, 'packages', 'webview', 'dist', 'spa'),
            connectSrc: ['https:', 'http:', 'ws:', 'wss:'],
            resourceMapperScriptUri,
            route: this.route,
            editorTitle: this.panel.title
        });
    }

    private openWidget(widgetId: unknown) {
        if (typeof widgetId !== 'string') { return; }
        WritingDashboardPanel.createOrShowWidget(this.extensionUri, widgetId);
    }

    private async postDashboardData() {
        try {
            const data = mapDashboardWebviewResources(await loadDashboardState(), this.panel.webview);
            await this.panel.webview.postMessage({
                command: 'dashboard.data',
                data,
                settings: getDashboardWebviewSettings()
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await this.panel.webview.postMessage({ command: 'dashboard.error', message });
        }
    }

    private async saveDashboardData(data: unknown) {
        try {
            await saveDashboardState(data);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await this.panel.webview.postMessage({ command: 'dashboard.error', message });
            vscode.window.showErrorMessage(`创作工作台保存失败: ${message}`);
        }
    }

    private async selectPlanFile(fileName: unknown, currentState: unknown) {
        try {
            if (isRecord(currentState)) {
                await saveDashboardState(currentState);
            }
            await setSelectedPlanFile(fileName);
            await this.postDashboardData();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await this.panel.webview.postMessage({ command: 'dashboard.error', message });
            vscode.window.showErrorMessage(`切换计划文件失败: ${message}`);
        }
    }

    private async createPlanFile(fileName: unknown, currentState: unknown) {
        try {
            if (isRecord(currentState)) {
                await saveDashboardState(currentState);
            }
            await createDashboardPlanFile(fileName);
            await this.postDashboardData();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await this.panel.webview.postMessage({ command: 'dashboard.error', message });
            vscode.window.showErrorMessage(`新建计划文件失败: ${message}`);
        }
    }

    public dispose() {
        if (this.instanceKey === 'dashboard') {
            WritingDashboardPanel.dashboardInstance = undefined;
        } else {
            WritingDashboardPanel.widgetInstances.delete(this.instanceKey);
        }

        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            disposable?.dispose();
        }
    }
}

export function registerWritingDashboardPage(context: vscode.ExtensionContext): vscode.Disposable {
    const openDashboard = vscode.commands.registerCommand('andrea.openWritingDashboard', async () => {
        WritingDashboardPanel.createOrShow(context.extensionUri);
    });
    const openWidget = vscode.commands.registerCommand('andrea.openWritingDashboardWidget', async (widgetId?: string) => {
        const id = widgetId || await vscode.window.showQuickPick(
            Object.entries(widgetTitles).map(([value, label]) => ({ value, label })),
            { placeHolder: '选择要独立打开的工作台组件' }
        ).then(item => item?.value);
        if (!id) { return; }
        WritingDashboardPanel.createOrShowWidget(context.extensionUri, id);
    });

    const serializer = vscode.window.registerWebviewPanelSerializer(dashboardViewType, {
        async deserializeWebviewPanel(panel: vscode.WebviewPanel, _state: unknown) {
            WritingDashboardPanel.revive(panel, context.extensionUri);
        }
    });
    const widgetSerializers = dashboardWidgetIds.map(widgetId =>
        vscode.window.registerWebviewPanelSerializer(getWidgetViewType(widgetId), {
            async deserializeWebviewPanel(panel: vscode.WebviewPanel, _state: unknown) {
                WritingDashboardPanel.reviveWidget(panel, context.extensionUri, widgetId);
            }
        })
    );

    context.subscriptions.push(openDashboard, openWidget, serializer, ...widgetSerializers);
    return openDashboard;
}

function normalizeWidgetId(widgetId: string): DashboardWidgetId {
    if (widgetId in widgetTitles) {
        return widgetId as DashboardWidgetId;
    }
    return 'energy';
}

function getDashboardWebviewSettings(): DashboardWebviewSettings {
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper.writingDashboard');
    return {
        widgetShowHeader: cfg.get<boolean>('widget.showHeader', true)
    };
}

async function loadDashboardState(): Promise<DashboardState> {
    const layoutPath = getDashboardLayoutFilePath();
    const defaults = createDefaultDashboardState();
    let layoutState: Record<string, unknown> = {};

    if (layoutPath && fs.existsSync(layoutPath)) {
        const raw = await fs.promises.readFile(layoutPath, 'utf8');
        try {
            layoutState = JSON.parse(raw) as Record<string, unknown>;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`${layoutPath} 解析失败: ${message}`);
        }
    }

    const merged = mergeDashboardState(layoutState);
    const tasks = await loadDashboardTasks(defaults.tasks as unknown[]);
    let selectedPlanFile = normalizePlanFileName(merged.selectedPlanFile);
    const planFiles = await loadDashboardPlanFiles(selectedPlanFile, String(defaults.planMarkdown || ''));
    if (planFiles.length > 0 && !planFiles.some(file => file.name === selectedPlanFile)) {
        selectedPlanFile = planFiles[0].name;
    }
    const planMarkdown = await loadDashboardPlan(String(defaults.planMarkdown || ''), selectedPlanFile);
    const realtime = await loadDashboardRealtimeData({
        tasks,
        profile: merged.profile,
        yearPlan: merged.yearPlan,
        logs: merged.logs,
    });
    const profile = isRecord(merged.profile)
        ? { ...merged.profile, ...realtime.profileStats }
        : merged.profile;
    return {
        ...merged,
        tasks,
        profile,
        yearPlan: realtime.yearPlan,
        logs: realtime.logs,
        heatmapData: realtime.heatmapData,
        writingStats: realtime.writingStats,
        selectedPlanFile,
        planFiles,
        planMarkdown,
        dashboardFiles: getDashboardFileInfo(selectedPlanFile),
    };
}

async function loadDashboardRealtimeData(input: {
    tasks: unknown[];
    profile: unknown;
    yearPlan: unknown;
    logs: unknown;
}): Promise<{
    profileStats: Record<string, unknown>;
    yearPlan: unknown;
    logs: unknown[];
    heatmapData: Array<[string, number]>;
    writingStats: Record<string, unknown>;
}> {
    const [summaryResult, overviewResult, trackingResult, writingStatsResult] = await Promise.allSettled([
        getWritingProjectSummaryAsync(),
        getWritingProjectOverviewAsync(),
        getTrackingStatsAsync(),
        getAllWritingStatsAsync(),
    ]);

    const summaryPayload = summaryResult.status === 'fulfilled' ? summaryResult.value : undefined;
    const overviewPayload = overviewResult.status === 'fulfilled' ? overviewResult.value : undefined;
    const trackingStats = trackingResult.status === 'fulfilled' ? trackingResult.value : null;
    const fileWritingStats = writingStatsResult.status === 'fulfilled' ? writingStatsResult.value : [];
    const recentWritingLogs = buildRecentWritingLogs(fileWritingStats);
    const novelProfile = await buildNovelProfileData(input.profile);
    const taskStats = countTaskStats(input.tasks);
    const baseYearPlan = isRecord(input.yearPlan) ? input.yearPlan : {};

    return {
        profileStats: {
            ...novelProfile,
            roleCount: getRoleCount(),
            taskCount: input.tasks.length,
            noteCount: novelProfile.noteCount ?? trackingStats?.totalFiles ?? (isRecord(input.profile) ? input.profile.noteCount : 0),
        },
        yearPlan: {
            ...baseYearPlan,
            completedGoals: taskStats.done,
            totalGoals: taskStats.total,
            progress: taskStats.total > 0 ? Number((taskStats.done / taskStats.total).toFixed(4)) : 0,
        },
        logs: recentWritingLogs.length > 0
            ? recentWritingLogs
            : (Array.isArray(input.logs) ? input.logs : []),
        heatmapData: buildWritingHeatmapData(summaryPayload?.summary?.heatmap),
        writingStats: {
            ready: !!summaryPayload?.ready,
            staleReason: summaryPayload?.staleReason || overviewPayload?.staleReason,
            today: summaryPayload?.summary?.today,
            todayKey: summaryPayload?.summary?.todayKey,
            overview: overviewPayload?.overview,
            approximate: overviewPayload?.approximate,
            filesWithWritingStats: summaryPayload?.summary?.filesWithWritingStats ?? overviewPayload?.overview?.filesWithWritingStats ?? 0,
        },
    };
}

async function buildNovelProfileData(currentProfile: unknown): Promise<Record<string, unknown>> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const fallbackProfile = isRecord(currentProfile) ? currentProfile : {};
    let projectConfig: ProjectConfig | null = null;

    if (workspaceRoot) {
        try {
            projectConfig = await new ProjectConfigManager(workspaceRoot).readConfig();
        } catch (error) {
            console.warn('[WritingDashboard] 读取项目元数据失败', error);
        }
    }

    const trackedFiles = await getAllTrackedFilesSafe();
    const fileCount = trackedFiles.filter(file => !file.isDirectory).length;
    const wordCount = trackedFiles.reduce((sum, file) => {
        const stats = file.wordCountStats;
        return sum + Math.max(0, Number(stats?.total ?? stats?.nonWSChars ?? 0) || 0);
    }, 0);

    const workspaceName = workspaceRoot ? path.basename(workspaceRoot) : '未命名项目';
    const tags = normalizeStringArray(projectConfig?.tags).length > 0
        ? normalizeStringArray(projectConfig?.tags)
        : normalizeStringArray(fallbackProfile.tags);

    return {
        name: normalizeProfileString(projectConfig?.name) || normalizeProfileString(fallbackProfile.name) || workspaceName,
        role: normalizeProfileString(projectConfig?.author) || normalizeProfileString(fallbackProfile.role) || '未设置作者',
        quote: normalizeProfileString(projectConfig?.summary) || normalizeProfileString(projectConfig?.description) || normalizeProfileString(fallbackProfile.quote) || '未填写项目简介',
        tags,
        ...resolveProjectCover(projectConfig, workspaceRoot, fallbackProfile),
        noteCount: fileCount,
        wordCount,
    };
}

function mapDashboardWebviewResources(state: DashboardState, webview: vscode.Webview): DashboardState {
    const profile = isRecord(state.profile) ? { ...state.profile } : state.profile;
    if (isRecord(profile)) {
        const coverPath = normalizeProfileString(profile.coverPath);
        if (coverPath) {
            try {
                profile.coverUrl = webview.asWebviewUri(vscode.Uri.file(coverPath)).toString();
            } catch (error) {
                console.warn('[WritingDashboard] 转换封面资源失败', error);
                delete profile.coverUrl;
            }
        }
    }
    return {
        ...state,
        profile,
    };
}

function resolveProjectCover(
    projectConfig: ProjectConfig | null,
    workspaceRoot: string | undefined,
    fallbackProfile: Record<string, unknown>
): Record<string, string> {
    const rawCover = normalizeProfileString(projectConfig?.cover)
        || normalizeProfileString(fallbackProfile.coverPath)
        || normalizeProfileString(fallbackProfile.coverUrl);
    const source = extractCoverImageSource(rawCover);
    if (!source) {
        return { coverPath: '', coverUrl: '' };
    }
    if (/^(https?:|data:|blob:)/i.test(source)) {
        return { coverPath: '', coverUrl: source };
    }
    if (/^file:/i.test(source)) {
        try {
            const fsPath = vscode.Uri.parse(source).fsPath;
            return fsPath ? { coverPath: fsPath, coverUrl: '' } : { coverPath: '', coverUrl: '' };
        } catch {
            return { coverPath: '', coverUrl: '' };
        }
    }
    if (!workspaceRoot && !path.isAbsolute(source)) {
        return { coverPath: '', coverUrl: '' };
    }

    const coverPath = path.isAbsolute(source) ? source : path.resolve(workspaceRoot || '', source);
    return fs.existsSync(coverPath)
        ? { coverPath, coverUrl: '' }
        : { coverPath: '', coverUrl: '' };
}

function extractCoverImageSource(rawCover: string): string {
    const raw = rawCover.trim();
    if (!raw) {
        return '';
    }

    const markdownMatch = raw.match(/!\[[^\]]*]\((.+?)\)/);
    const content = (markdownMatch?.[1] || raw).trim();
    if (!content) {
        return '';
    }

    if (content.startsWith('<')) {
        const end = content.indexOf('>');
        return end > 1 ? content.slice(1, end).trim() : '';
    }

    const titledPath = content.match(/^(.+?)(?:\s+["'][^"']*["'])$/);
    return (titledPath?.[1] || content).trim();
}

async function getAllTrackedFilesSafe(): Promise<Array<{
    isDirectory?: boolean;
    wordCountStats?: {
        total?: number;
        nonWSChars?: number;
    };
}>> {
    try {
        return await getAllTrackedFilesAsync();
    } catch (error) {
        console.warn('[WritingDashboard] 读取文件追踪元数据失败', error);
        return [];
    }
}

function buildWritingHeatmapData(heatmap: Record<number, number> | undefined): Array<[string, number]> {
    if (!heatmap || typeof heatmap !== 'object') {
        return [];
    }
    return Object.entries(heatmap)
        .map(([key, value]) => {
            const timestamp = Number(key);
            const count = Number(value);
            if (!Number.isFinite(timestamp) || !Number.isFinite(count) || count <= 0) {
                return undefined;
            }
            return [formatLocalDate(timestamp), Math.round(count)] as [string, number];
        })
        .filter((item): item is [string, number] => !!item)
        .sort((a, b) => a[0].localeCompare(b[0]));
}

function buildRecentWritingLogs(stats: WritingStatsView[]): DashboardLogEntry[] {
    const rows: Array<DashboardLogEntry & { endTime: number }> = [];
    const mergeGapMs = getWritingLogMergeGapMs();

    for (const fileStats of stats) {
        const sessions = mergeWritingSessions(
            Array.isArray(fileStats.sessions) ? fileStats.sessions : [],
            mergeGapMs
        );
        const title = getWorkspaceRelativeLabel(fileStats.filePath);
        for (const session of sessions) {
            rows.push({
                id: `writing-${rows.length}-${session.start}-${session.end}`,
                createdAt: formatLocalDateTime(session.start),
                completedAt: formatLocalDateTime(session.end),
                title,
                tag: '写作',
                endTime: session.end,
            });
        }
    }
    return rows
        .sort((a, b) => b.endTime - a.endTime)
        .slice(0, 30)
        .map(({ endTime: _endTime, ...row }) => row);
}

function mergeWritingSessions(
    sessions: Array<{ start: number; end: number }>,
    mergeGapMs: number
): Array<{ start: number; end: number }> {
    const sorted = sessions
        .filter(session =>
            Number.isFinite(session.start) &&
            Number.isFinite(session.end) &&
            session.end > session.start
        )
        .map(session => ({ start: session.start, end: session.end }))
        .sort((a, b) => a.start - b.start);

    const merged: Array<{ start: number; end: number }> = [];
    for (const session of sorted) {
        const previous = merged[merged.length - 1];
        if (previous && session.start - previous.end <= mergeGapMs) {
            previous.end = Math.max(previous.end, session.end);
            continue;
        }
        merged.push({ ...session });
    }
    return merged;
}

function getWritingLogMergeGapMs(): number {
    return 120 * 60 * 1000;
}

function countTaskStats(tasks: unknown[]): { total: number; done: number } {
    let total = 0;
    let done = 0;
    for (const task of tasks) {
        if (!isRecord(task)) {
            continue;
        }
        total += 1;
        if (task.status === 'done') {
            done += 1;
        }
    }
    return { total, done };
}

function getWorkspaceRelativeLabel(filePath: string): string {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        return path.basename(filePath);
    }
    const relative = path.relative(workspaceRoot, filePath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        return path.basename(filePath);
    }
    return relative.replace(/\\/g, '/');
}

function formatLocalDate(timestamp: number): string {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatLocalDateTime(timestamp: number): string {
    const date = new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${formatLocalDate(timestamp)} ${hours}:${minutes}`;
}

function getRoleCount(): number {
    return Array.isArray(roles) ? roles.length : 0;
}

function normalizeProfileString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return Array.from(new Set(
        value
            .map(item => typeof item === 'string' ? item.trim() : '')
            .filter(Boolean)
    ));
}

async function saveDashboardState(data: unknown): Promise<void> {
    const layoutPath = getDashboardLayoutFilePath();
    if (!layoutPath) {
        throw new Error('当前没有工作区，独立调试或空窗口不会写入创作工作台数据。');
    }

    const state = mergeDashboardState(isRecord(data) ? data : {});
    await ensureDashboardDir();

    if (Array.isArray(state.tasks)) {
        await saveDashboardTasks(state.tasks);
    }
    const selectedPlanFile = normalizePlanFileName(state.selectedPlanFile);
    if (typeof state.planMarkdown === 'string') {
        await saveDashboardPlan(state.planMarkdown, selectedPlanFile);
    }

    const layoutState = {
        windows: state.windows,
        energyMetrics: state.energyMetrics,
        logs: state.logs,
        profile: state.profile,
        yearPlan: state.yearPlan,
        selectedPlanFile,
    };
    await fs.promises.writeFile(layoutPath, `${JSON.stringify(layoutState, null, 2)}\n`, 'utf8');
}

async function loadDashboardTasks(defaultTasks: unknown[]): Promise<unknown[]> {
    const filePath = getDashboardTasksFilePath();
    if (!filePath || !fs.existsSync(filePath)) {
        return defaultTasks;
    }
    try {
        const parsed = JSON5.parse(await fs.promises.readFile(filePath, 'utf8')) as unknown;
        return Array.isArray(parsed) ? parsed : defaultTasks;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${filePath} 解析失败: ${message}`);
    }
}

async function saveDashboardTasks(tasks: unknown[]): Promise<void> {
    const filePath = getDashboardTasksFilePath();
    if (!filePath) { return; }
    await fs.promises.writeFile(filePath, `${JSON5.stringify(tasks, null, 2)}\n`, 'utf8');
}

async function loadDashboardPlanFiles(selectedPlanFile: string, defaultMarkdown: string): Promise<Array<{ name: string; path: string }>> {
    await ensureDashboardPlanDir(defaultMarkdown);
    const dir = getDashboardPlanDirPath();
    if (!dir) { return []; }
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const files = entries
        .filter(entry => entry.isFile() && path.extname(entry.name).toLowerCase() === '.md')
        .map(entry => normalizePlanFileName(entry.name))
        .filter((name, index, list) => list.indexOf(name) === index)
        .sort((a, b) => a.localeCompare(b, 'zh-CN'));
    if (!files.includes(selectedPlanFile)) {
        const selectedPath = getDashboardPlanFilePath(selectedPlanFile);
        if (selectedPath && fs.existsSync(selectedPath)) {
            files.push(selectedPlanFile);
        }
    }
    return files.map(name => ({ name, path: getDashboardPlanFilePath(name) ?? name }));
}

async function loadDashboardPlan(defaultMarkdown: string, fileName: unknown): Promise<string> {
    const selectedPlanFile = normalizePlanFileName(fileName);
    await ensureDashboardPlanDir(defaultMarkdown);
    const filePath = getDashboardPlanFilePath(selectedPlanFile);
    if (!filePath || !fs.existsSync(filePath)) {
        return defaultMarkdown;
    }
    return fs.promises.readFile(filePath, 'utf8');
}

async function saveDashboardPlan(markdown: string, fileName: unknown): Promise<void> {
    await ensureDashboardPlanDir(markdown);
    const filePath = getDashboardPlanFilePath(fileName);
    if (!filePath) { return; }
    await fs.promises.writeFile(filePath, markdown, 'utf8');
}

async function setSelectedPlanFile(fileName: unknown): Promise<string> {
    const selectedPlanFile = normalizePlanFileName(fileName);
    const layoutPath = getDashboardLayoutFilePath();
    if (!layoutPath) {
        throw new Error('当前没有工作区，无法切换计划文件。');
    }
    await ensureDashboardPlanDir(String(createDefaultDashboardState().planMarkdown || ''));
    const filePath = getDashboardPlanFilePath(selectedPlanFile);
    if (filePath && !fs.existsSync(filePath)) {
        await fs.promises.writeFile(filePath, String(createDefaultDashboardState().planMarkdown || ''), 'utf8');
    }
    const layoutState = await readDashboardLayoutState();
    layoutState.selectedPlanFile = selectedPlanFile;
    await ensureDashboardDir();
    await fs.promises.writeFile(layoutPath, `${JSON.stringify(layoutState, null, 2)}\n`, 'utf8');
    return selectedPlanFile;
}

async function createDashboardPlanFile(fileName: unknown): Promise<string> {
    await ensureDashboardPlanDir(String(createDefaultDashboardState().planMarkdown || ''));
    const dir = getDashboardPlanDirPath();
    if (!dir) {
        throw new Error('当前没有工作区，无法新建计划文件。');
    }
    const requestedName = normalizePlanFileName(fileName);
    const selectedPlanFile = await getUniquePlanFileName(requestedName);
    const filePath = getDashboardPlanFilePath(selectedPlanFile);
    if (!filePath) {
        throw new Error('无法解析计划文件路径。');
    }
    const title = path.basename(selectedPlanFile, '.md');
    const content = [
        '---',
        `date: ${new Date().toISOString().slice(0, 10)}`,
        'tags: plan',
        '---',
        '',
        `## ${title}`,
        '',
    ].join('\n');
    await fs.promises.writeFile(filePath, content, 'utf8');
    await setSelectedPlanFile(selectedPlanFile);
    return selectedPlanFile;
}

async function openDashboardPlanFile(fileName?: unknown): Promise<void> {
    const selectedPlanFile = fileName ? normalizePlanFileName(fileName) : await getSelectedPlanFileFromLayout();
    const filePath = getDashboardPlanFilePath(selectedPlanFile);
    if (!filePath) {
        vscode.window.showErrorMessage('当前没有工作区，无法打开工作台计划文件。');
        return;
    }
    await ensureDashboardPlanDir(String(createDefaultDashboardState().planMarkdown || ''));
    if (!fs.existsSync(filePath)) {
        await saveDashboardPlan(String(createDefaultDashboardState().planMarkdown || ''), selectedPlanFile);
    }
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
}

async function ensureDashboardDir(): Promise<void> {
    const dir = getDashboardDirPath();
    if (dir) {
        await fs.promises.mkdir(dir, { recursive: true });
    }
}

async function ensureDashboardPlanDir(defaultMarkdown?: string): Promise<void> {
    const dir = getDashboardPlanDirPath();
    if (!dir) { return; }
    await fs.promises.mkdir(dir, { recursive: true });

    const defaultPlanPath = path.join(dir, defaultDashboardPlanFileName);
    const legacyPlanPath = getLegacyDashboardPlanFilePath();
    if (legacyPlanPath && fs.existsSync(legacyPlanPath) && !fs.existsSync(defaultPlanPath)) {
        await fs.promises.copyFile(legacyPlanPath, defaultPlanPath);
    }

    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const hasPlanFile = entries.some(entry => entry.isFile() && path.extname(entry.name).toLowerCase() === '.md');
    if (!hasPlanFile && defaultMarkdown !== undefined) {
        await fs.promises.writeFile(defaultPlanPath, defaultMarkdown, 'utf8');
    }
}

async function readDashboardLayoutState(): Promise<Record<string, unknown>> {
    const layoutPath = getDashboardLayoutFilePath();
    if (!layoutPath || !fs.existsSync(layoutPath)) { return {}; }
    const raw = await fs.promises.readFile(layoutPath, 'utf8');
    try {
        return JSON.parse(raw) as Record<string, unknown>;
    } catch {
        return {};
    }
}

async function getSelectedPlanFileFromLayout(): Promise<string> {
    const layoutState = await readDashboardLayoutState();
    return normalizePlanFileName(layoutState.selectedPlanFile);
}

async function getUniquePlanFileName(fileName: string): Promise<string> {
    const dir = getDashboardPlanDirPath();
    if (!dir) { return normalizePlanFileName(fileName); }
    const normalized = normalizePlanFileName(fileName);
    const ext = path.extname(normalized) || '.md';
    const base = path.basename(normalized, ext);
    let candidate = normalized;
    let index = 2;
    while (fs.existsSync(path.join(dir, candidate))) {
        candidate = `${base}-${index}${ext}`;
        index += 1;
    }
    return candidate;
}

function normalizePlanFileName(value: unknown): string {
    const raw = typeof value === 'string' && value.trim() ? value.trim() : defaultDashboardPlanFileName;
    const baseName = path.basename(raw.replace(/\\/g, '/'));
    const safeName = baseName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').trim();
    const withName = safeName && safeName !== '.md' ? safeName : defaultDashboardPlanFileName;
    return path.extname(withName).toLowerCase() === '.md' ? withName : `${withName}.md`;
}

function getDashboardDirPath(): string | undefined {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) { return undefined; }
    return path.join(workspaceRoot, dashboardDirName);
}

function getDashboardPlanDirPath(): string | undefined {
    const dir = getDashboardDirPath();
    return dir ? path.join(dir, dashboardPlanDirName) : undefined;
}

function getDashboardLayoutFilePath(): string | undefined {
    const dir = getDashboardDirPath();
    return dir ? path.join(dir, dashboardLayoutFileName) : undefined;
}

function getDashboardTasksFilePath(): string | undefined {
    const dir = getDashboardDirPath();
    return dir ? path.join(dir, dashboardTasksFileName) : undefined;
}

function getLegacyDashboardPlanFilePath(): string | undefined {
    const dir = getDashboardDirPath();
    return dir ? path.join(dir, legacyDashboardPlanFileName) : undefined;
}

function getDashboardPlanFilePath(fileName?: unknown): string | undefined {
    const dir = getDashboardPlanDirPath();
    return dir ? path.join(dir, normalizePlanFileName(fileName)) : undefined;
}

function getDashboardFileInfo(selectedPlanFile?: unknown): Record<string, string> {
    const info: Record<string, string> = {};
    const layoutPath = getDashboardLayoutFilePath();
    const tasksPath = getDashboardTasksFilePath();
    const planDirPath = getDashboardPlanDirPath();
    const planPath = getDashboardPlanFilePath(selectedPlanFile);
    if (layoutPath) { info.layoutPath = layoutPath; }
    if (tasksPath) { info.tasksPath = tasksPath; }
    if (planDirPath) { info.planDirPath = planDirPath; }
    if (planPath) { info.planPath = planPath; }
    return info;
}

function mergeDashboardState(value: Record<string, unknown>): DashboardState {
    const defaults = createDefaultDashboardState();
    return {
        ...defaults,
        ...value,
        windows: Array.isArray(value.windows) && value.windows.length > 0 ? value.windows : defaults.windows,
        energyMetrics: Array.isArray(value.energyMetrics) ? value.energyMetrics : defaults.energyMetrics,
        tasks: Array.isArray(value.tasks) ? value.tasks : defaults.tasks,
        logs: Array.isArray(value.logs) ? value.logs : defaults.logs,
        profile: isRecord(value.profile) ? value.profile : defaults.profile,
        yearPlan: isRecord(value.yearPlan) ? value.yearPlan : defaults.yearPlan,
        planMarkdown: typeof value.planMarkdown === 'string' ? value.planMarkdown : defaults.planMarkdown,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function createDefaultDashboardState(): DashboardState {
    const roleCount = getRoleCount();
    return {
        windows: [
            { id: 'win-energy', type: 'energy', title: '能量条形图', x: 20, y: 20, w: 360, h: 180 },
            { id: 'win-heatmap', type: 'heatmap', title: '码字热力图', x: 400, y: 20, w: 360, h: 180 },
            { id: 'win-clock', type: 'clock', title: '当前时间', x: 780, y: 20, w: 260, h: 180 },
            { id: 'win-profile', type: 'profile', title: '我的小说', x: 1060, y: 20, w: 280, h: 300 },
            { id: 'win-gantt', type: 'gantt', title: '任务甘特图', x: 20, y: 220, w: 760, h: 330 },
            { id: 'win-plan', type: 'plan', title: '今日计划', x: 800, y: 220, w: 540, h: 330 },
            { id: 'win-tasks', type: 'tasks', title: '任务清单', x: 20, y: 570, w: 760, h: 260 },
            { id: 'win-year', type: 'yearPlan', title: '年计划', x: 1060, y: 340, w: 280, h: 260 },
            { id: 'win-logs', type: 'logs', title: '创作记录', x: 800, y: 570, w: 540, h: 260 },
            { id: 'win-timer', type: 'timer', title: '计时器', x: 1360, y: 570, w: 320, h: 360 },
        ],
        energyMetrics: [
            { key: 'physical', label: 'Physical', value: 25, color: '#5d7bd5' },
            { key: 'mental', label: 'Mental', value: 25, color: '#84c66f' },
            { key: 'mood', label: 'Mood', value: 25, color: '#f7c75c' },
            { key: 'motivation', label: 'Motivation', value: 25, color: '#ef6262' },
            { key: 'longTerm', label: 'LongTerm', value: 7, color: '#65c0bd' },
        ],
        tasks: [
            {
                id: 't1',
                title: '整理真实数据接入方案',
                description: '将工作台数据源迁移到 novel-helper 项目结构',
                status: 'doing',
                priority: 'high',
                tags: ['工作台', '数据'],
                group: '开发',
                start: new Date('2026-04-21T00:00:00').getTime(),
                end: new Date('2026-04-23T23:59:59').getTime(),
                progress: 60,
                color: '#d94a9b',
                subtasks: [],
            },
        ],
        logs: [
            { id: 'l1', createdAt: '2026/04/14 23:42', completedAt: '2026/04/14 23:58', title: 'Java 语法学习', tag: '学习' },
            { id: 'l2', createdAt: '2026/04/18 00:42', completedAt: '2026/04/21 00:42', title: '构建个人修炼系统', tag: '项目' },
        ],
        profile: {
            name: '未命名项目',
            role: '未设置作者',
            quote: '未填写项目简介',
            coverUrl: '',
            coverPath: '',
            tags: [],
            noteCount: 0,
            taskCount: 0,
            goalCount: 0,
            roleCount,
            wordCount: 0,
        },
        yearPlan: {
            year: 2026,
            title: '专注成长，拥抱变化',
            category: '学习',
            progress: 0.72,
            completedGoals: 0,
            totalGoals: 2,
            tags: ['阅读', '工作', '健康', '写作'],
        },
        planMarkdown: [
            '---',
            'tags: 未知',
            'date: 2026-04-21 星期二 19:06',
            'update: 2026-04-21 星期二 19:58',
            '---',
            '',
            '## 2026计划',
            '',
            '深化模型治理、构建读写质量闭环，推进设定管理与监督描述系统化。',
        ].join('\n'),
    };
}
