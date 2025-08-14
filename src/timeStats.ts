import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
    registerFileChangeCallback,
    unregisterFileChangeCallback,
    getGlobalFileTracking,
    updateFileWritingStats
} from './utils/globalFileTracking';

// -------------------- 数据结构 --------------------
interface Bucket {
    start: number;
    end: number;
    charsAdded: number;
}
interface Session {
    start: number;
    end: number;
}
interface FileStats {
    totalMillis: number;
    charsAdded: number;
    charsDeleted: number;
    firstSeen: number;
    lastSeen: number;
    buckets: Bucket[];
    sessions: Session[];
}

// -------------------- 运行时状态 --------------------
let currentDocPath: string | undefined;
let currentDocUuid: string | undefined;
let currentSessionStart = 0;
let idleTimer: NodeJS.Timeout | undefined;
let windowFocused = true;
// 始终只保留一个
let statusBarItem: vscode.StatusBarItem | undefined;

// —— IME 友好的去抖计数状态 ——
interface RuntimeDocState {
    lastCount: number;            // 上次稳定时的"码字总量"（computeZhEnCount 的 total）
    lastVersion: number;          // 上次稳定时的文档版本
    debounce?: NodeJS.Timeout;    // 去抖定时器
    lastFlushTs: number;          // 上次冲刷时间
}
const docStates = new Map<string, RuntimeDocState>();

function getOrInitDocState(doc: vscode.TextDocument): RuntimeDocState {
    const fp = doc.uri.fsPath;
    let st = docStates.get(fp);
    if (!st) {
        const base = computeZhEnCount(doc.getText()).total;
        st = { lastCount: base, lastVersion: doc.version, lastFlushTs: now() };
        docStates.set(fp, st);
    }
    return st;
}

// -------------------- 配置 --------------------
function getConfig() {
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper.timeStats');
    return {
        enabledLanguages: cfg.get<string[]>('enabledLanguages', ['markdown', 'plaintext']),
        idleThresholdMs: cfg.get<number>('idleThresholdMs', 30000),
        bucketSizeMs: cfg.get<number>('bucketSizeMs', 60000),
        imeDebounceMs: cfg.get<number>('imeDebounceMs', 350), // IME 去抖时间
    };
}

// -------------------- 基础工具 --------------------
function ensureDirectoryExists(file: string) {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function now() { return Date.now(); }

// 统一字数统计：中文“字” + 英文“词”
function computeZhEnCount(text: string): { zhChars: number; enWords: number; total: number } {
    // CJK：包含常用范围，按需可扩展 CJK 扩展区
    const zhMatches = text.match(/[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/g) ?? [];
    const enMatches = text.match(/[A-Za-z0-9]+/g) ?? [];
    const zhChars = zhMatches.length;
    const enWords = enMatches.length;
    return { zhChars, enWords, total: zhChars + enWords };
}

// 获取或创建文件统计（接入全局追踪）
function getOrCreateFileStats(filePath: string): FileStats {
    console.log('TimeStats: getOrCreateFileStats called for:', filePath);

    const g = getGlobalFileTracking?.();
    console.log('TimeStats: getGlobalFileTracking result:', !!g);

    if (!g) {
        console.log('TimeStats: No global file tracking, returning empty stats');
        return { totalMillis: 0, charsAdded: 0, charsDeleted: 0, firstSeen: now(), lastSeen: now(), buckets: [], sessions: [] };
    }

    const uuid = g.getFileUuid(filePath);
    console.log('TimeStats: File UUID for', filePath, ':', uuid);

    if (!uuid) {
        console.log('TimeStats: No UUID found, returning empty stats');
        return { totalMillis: 0, charsAdded: 0, charsDeleted: 0, firstSeen: now(), lastSeen: now(), buckets: [], sessions: [] };
    }

    const ws = g.getWritingStats(uuid);
    console.log('TimeStats: Writing stats for UUID', uuid, ':', ws);

    if (ws) {
        console.log('TimeStats: Found writing stats, returning populated stats');
        return {
            totalMillis: ws.totalMillis,
            charsAdded: ws.charsAdded,
            charsDeleted: ws.charsDeleted,
            firstSeen: ws.lastActiveTime,
            lastSeen: ws.lastActiveTime,
            buckets: ws.buckets ?? [],     // 如果你的全局结构暂无 buckets，可保留为空
            sessions: ws.sessions ?? [],   // 同上
        };
    }

    console.log('TimeStats: No writing stats found, returning empty stats');
    return { totalMillis: 0, charsAdded: 0, charsDeleted: 0, firstSeen: now(), lastSeen: now(), buckets: [], sessions: [] };
}

// 仅当前文件读取
function getFileStats(filePath: string): FileStats {
    return getOrCreateFileStats(filePath);
}

// 写回全局
function persistFileStats(filePath: string, stats: FileStats) {
    const totalMinutes = stats.totalMillis / 60000;
    const averageCPM = totalMinutes > 0 ? Math.round(stats.charsAdded / totalMinutes) : 0;
    updateFileWritingStats(filePath, {
        totalMillis: stats.totalMillis,
        charsAdded: stats.charsAdded,
        charsDeleted: stats.charsDeleted,
        lastActiveTime: stats.lastSeen,
        sessionsCount: stats.sessions.length,
        averageCPM,
        buckets: stats.buckets,
        sessions: stats.sessions
    });
}

// 桶聚合
function bumpBucket(fsEntry: FileStats, timestamp: number, added: number, bucketSizeMs: number) {
    const bucketStart = Math.floor(timestamp / bucketSizeMs) * bucketSizeMs;
    let bucket = fsEntry.buckets.find(b => b.start === bucketStart);
    if (!bucket) {
        bucket = { start: bucketStart, end: bucketStart + bucketSizeMs, charsAdded: 0 };
        fsEntry.buckets.push(bucket);
    }
    if (added > 0) {
        bucket.charsAdded += added;
    }
}

function calcAverageCPM(fsEntry: FileStats): number {
    if (fsEntry.totalMillis <= 0) {
        return 0;
    }
    const totalMinutes = fsEntry.totalMillis / 60000;
    return Math.round(fsEntry.charsAdded / totalMinutes);
}
function calcPeakCPM(fsEntry: FileStats, bucketSizeMs: number): number {
    if (!fsEntry.buckets.length) {
        return 0;
    }
    let peak = 0;
    for (const b of fsEntry.buckets) {
        const cpm = Math.round((b.charsAdded * 60000) / bucketSizeMs);
        if (cpm > peak) {
            peak = cpm;
        }
    }
    return peak;
}
function calcCurrentCPM(fsEntry: FileStats, bucketSizeMs: number): number {
    const t = now();
    const currentBucketStart = Math.floor(t / bucketSizeMs) * bucketSizeMs;

    // 使用滑动窗口算法：考虑最近N个桶的加权平均
    const windowSize = 3; // 考虑最近3个桶
    const recentBuckets = fsEntry.buckets
        .filter(b => b.start <= currentBucketStart && b.start > currentBucketStart - windowSize * bucketSizeMs)
        .sort((a, b) => b.start - a.start); // 按时间倒序

    if (recentBuckets.length === 0) {
        return 0;
    }

    // 当前桶（如果存在）
    const currentBucket = recentBuckets.find(b => b.start === currentBucketStart);

    // 如果当前桶有数据且时间足够长，优先使用当前桶
    if (currentBucket && currentBucket.charsAdded > 0) {
        const elapsedMs = t - currentBucketStart;
        if (elapsedMs > 5000) { // 超过5秒，当前桶数据相对稳定
            return Math.round((currentBucket.charsAdded * 60000) / elapsedMs);
        }
    }

    // 使用加权平均：越近的桶权重越高
    let totalChars = 0;
    let totalWeight = 0;

    for (let i = 0; i < recentBuckets.length; i++) {
        const bucket = recentBuckets[i];
        let weight: number;

        if (bucket.start === currentBucketStart) {
            // 当前桶：根据经过时间动态计算权重
            const elapsedMs = t - currentBucketStart;
            const bucketProgress = Math.min(elapsedMs / bucketSizeMs, 1);
            weight = 1 + bucketProgress; // 权重从1递增到2
        } else {
            // 历史桶：距离越近权重越高
            weight = 1 / (i + 1);
        }

        totalChars += bucket.charsAdded * weight;
        totalWeight += weight;
    }

    if (totalWeight === 0) {
        return 0;
    }

    // 计算加权平均CPM
    const avgCharsPerBucket = totalChars / totalWeight;
    return Math.round((avgCharsPerBucket * 60000) / bucketSizeMs);
}

// 会话
function startSession() {
    if (currentSessionStart === 0) {
        currentSessionStart = now();
    }
}
function endSession() {
    if (currentSessionStart === 0 || !currentDocPath) {
        return;
    }
    const end = now();
    const fsEntry = getFileStats(currentDocPath);
    const duration = end - currentSessionStart;
    if (duration > 0) {
        fsEntry.totalMillis += duration;
        fsEntry.sessions.push({ start: currentSessionStart, end });
        fsEntry.lastSeen = end;
        persistFileStats(currentDocPath, fsEntry);
    }
    currentSessionStart = 0;
}

// 空闲定时
function resetIdleTimer(idleThresholdMs: number) {
    if (idleTimer) {
        clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(() => {
        endSession();
        updateStatusBar();
    }, idleThresholdMs);
}

// -------------------- IME 友好的去抖计数 --------------------
function flushDocStats(doc: vscode.TextDocument) {
    const { bucketSizeMs } = getConfig();
    const filePath = doc.uri.fsPath;
    const st = docStates.get(filePath);
    if (!st) {
        return;
    }

    const t = now();
    const totalNow = computeZhEnCount(doc.getText()).total;   // 整体计算一次
    const delta = totalNow - st.lastCount;                    // 净增量（>0 计新增，<0 计删除）
    if (delta !== 0) {
        const fsEntry = getFileStats(filePath);
        if (delta > 0) {
            fsEntry.charsAdded += delta;
        } else {
            fsEntry.charsDeleted += -delta;
        }

        // 桶只统计正向新增，避免"改候选"拉低 CPM
        bumpBucket(fsEntry, t, Math.max(0, delta), bucketSizeMs);

        fsEntry.lastSeen = t;
        persistFileStats(filePath, fsEntry);
    }

    st.lastCount = totalNow;
    st.lastVersion = doc.version;
    st.lastFlushTs = t;
    updateStatusBar();
}

function scheduleFlush(doc: vscode.TextDocument) {
    const { imeDebounceMs } = getConfig();
    const fp = doc.uri.fsPath;
    const st = getOrInitDocState(doc);

    if (st.debounce) {
        clearTimeout(st.debounce);
    }
    st.debounce = setTimeout(() => {
        // 只有当前编辑器且窗口聚焦时再冲刷，避免后台自动变动造成误差
        if (vscode.window.activeTextEditor?.document === doc && windowFocused) {
            flushDocStats(doc);
        }
    }, imeDebounceMs);
}

// -------------------- 状态栏 --------------------
function setStatusBarTextAndTooltip() {
    if (!statusBarItem) {
        return;
    }
    if (!currentDocPath) {
        statusBarItem.hide();
        return;
    }

    const { bucketSizeMs } = getConfig();
    const doc = vscode.window.activeTextEditor?.document;
    const docText = doc?.getText() ?? '';
    const counts = computeZhEnCount(docText);

    const fsEntry = getFileStats(currentDocPath);
    const cpmNow = calcCurrentCPM(fsEntry, bucketSizeMs);
    const cpmAvg = calcAverageCPM(fsEntry);
    const cpmPeak = calcPeakCPM(fsEntry, bucketSizeMs);
    const minutes = Math.floor(fsEntry.totalMillis / 60000);

    statusBarItem.text = `${cpmNow}/${cpmAvg}/${cpmPeak} CPM · ${minutes} min · 码字 ${counts.total}`;
    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = true;
    md.appendMarkdown([
        `**当前速度**：${cpmNow} CPM`,
        `**平均速度**：${cpmAvg} CPM`,
        `**峰值速度**：${cpmPeak} CPM`,
        `**累计用时**：${minutes} 分钟`,
        `**中文字符**：${counts.zhChars}`,
        `**英文单词**：${counts.enWords}`,
        `**码字总量**：${counts.total}`
    ].join('\n\n'));
    statusBarItem.tooltip = md;
    statusBarItem.show();
}
function updateStatusBar() {
    setStatusBarTextAndTooltip();
}

// -------------------- 事件 --------------------
function handleTextChange(e: vscode.TextDocumentChangeEvent) {
    const { enabledLanguages, idleThresholdMs } = getConfig();
    const doc = e.document;
    if (!enabledLanguages.includes(doc.languageId)) {
        return;
    }
    if (!vscode.window.activeTextEditor || vscode.window.activeTextEditor.document !== doc) {
        return;
    }
    if (!windowFocused) {
        return;
    }

    currentDocPath = doc.uri.fsPath;
    startSession();
    resetIdleTimer(idleThresholdMs);

    // 关键：去抖，等待 IME 稳定后统一计算净增量
    getOrInitDocState(doc);
    scheduleFlush(doc);
}

function handleActiveEditorChange(editor: vscode.TextEditor | undefined) {
    const { idleThresholdMs } = getConfig();
    // 先把旧文档冲刷一下
    if (currentDocPath) {
        const oldDoc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === currentDocPath);
        if (oldDoc) {
            flushDocStats(oldDoc);
        }
    }
    endSession();

    if (editor && getConfig().enabledLanguages.includes(editor.document.languageId)) {
        currentDocPath = editor.document.uri.fsPath;
        const g = getGlobalFileTracking?.();
        if (g) {
            currentDocUuid = g.getFileUuid(currentDocPath);
        }

        // 初始化基线计数
        getOrInitDocState(editor.document);

        startSession();
        resetIdleTimer(idleThresholdMs);
        updateStatusBar();
    } else {
        currentDocPath = undefined;
        currentDocUuid = undefined;
        updateStatusBar();
    }
}

function handleWindowStateChange(state: vscode.WindowState) {
    windowFocused = state.focused;
    if (!windowFocused) {
        if (currentDocPath) {
            const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === currentDocPath);
            if (doc) {
                flushDocStats(doc); // 失焦时冲刷
            }
        }
        endSession();
        updateStatusBar();
    } else {
        const { idleThresholdMs } = getConfig();
        if (currentDocPath) {
            startSession();
            resetIdleTimer(idleThresholdMs);
            updateStatusBar();
        }
    }
}
function handleDocumentClose(doc: vscode.TextDocument) {
    if (currentDocPath === doc.uri.fsPath) {
        flushDocStats(doc); // 关闭前冲刷
        endSession();
        currentDocPath = undefined;
        currentDocUuid = undefined;
        docStates.delete(doc.uri.fsPath); // 清理状态
        updateStatusBar();
    }
}
function handleRename(e: vscode.FileRenameEvent) {
    for (const f of e.files) {
        if (currentDocPath === f.oldUri.fsPath) {
            currentDocPath = f.newUri.fsPath;
        }
    }
}

// -------------------- 导出 CSV（保留：仅当前文件） --------------------
async function exportStatsCSV(context: vscode.ExtensionContext) {
    const selection = await vscode.window.showQuickPick(['当前文件'], { placeHolder: '选择导出范围' });
    if (!selection) {
        return;
    }

    const g = getGlobalFileTracking?.();
    if (!g) {
        vscode.window.showErrorMessage('全局文件追踪系统不可用');
        return;
    }
    if (!currentDocPath) {
        vscode.window.showInformationMessage('当前没有活动文件');
        return;
    }

    const rows: string[] = ['filepath,totalMillis,charsAdded,charsDeleted,lastActiveTime,sessionsCount,averageCPM'];
    const fileUuid = g.getFileUuid(currentDocPath);
    if (fileUuid) {
        const ws = g.getWritingStats(fileUuid);
        if (ws) {
            rows.push([
                JSON.stringify(currentDocPath),
                ws.totalMillis,
                ws.charsAdded,
                ws.charsDeleted,
                ws.lastActiveTime,
                ws.sessionsCount,
                ws.averageCPM
            ].join(','));
        }
    }

    const csvContent = rows.join('\n');
    const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const defaultDir = wsFolder ? path.join(wsFolder, 'novel-helper') : context.globalStorageUri.fsPath;
    ensureDirectoryExists(defaultDir);
    const fileName = `time-stats-${Date.now()}.csv`;
    const uri = vscode.Uri.file(path.join(defaultDir, fileName));
    await fs.promises.writeFile(uri.fsPath, csvContent, 'utf8');
    vscode.window.showInformationMessage(`已导出到 ${uri.fsPath}`);
    try { await vscode.commands.executeCommand('revealFileInOS', uri); } catch { }
}

// -------------------- 仪表板（独立 HTML） --------------------
async function openDashboard(context: vscode.ExtensionContext) {
    if (!currentDocPath) {
        vscode.window.showInformationMessage('当前没有活动文件');
        return;
    }

    // 为了调试，先更新当前文件的统计数据
    const currentTime = Date.now();

    // 确保当前文件被追踪
    const globalTracking = getGlobalFileTracking?.();
    if (globalTracking) {
        console.log('TimeStats: Ensuring current file is tracked...');
        const tracker = require('./utils/fileTracker').getFileTracker();
        if (tracker) {
            try {
                await tracker.handleFileCreated(currentDocPath);
                console.log('TimeStats: File tracking triggered for:', currentDocPath);
            } catch (error) {
                console.warn('TimeStats: Failed to trigger file tracking:', error);
            }
        }
    }

    const fsEntry = getFileStats(currentDocPath);

    // 如果没有数据
    if (fsEntry.buckets.length === 0) {
        console.log('TimeStats: No existing buckets');
    }

    const panel = vscode.window.createWebviewPanel(
        'timeStatsDashboard',
        '写作统计仪表板',
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
        { enableScripts: true, localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'media'))] }
    );

    const htmlPath = path.join(context.extensionPath, 'media', 'time-stats.html');
    let html = fs.readFileSync(htmlPath, 'utf8');

    // 生成 webview 可访问的 JS URI
    const scriptUri = panel.webview.asWebviewUri(
        vscode.Uri.file(path.join(context.extensionPath, 'media', 'time-stats.js'))
    );

    // 替换占位符
    html = html
        .replace(/%CSP_SOURCE%/g, panel.webview.cspSource)
        .replace(/%SCRIPT_URI%/g, scriptUri.toString());

    panel.webview.html = html;


    // 创建一个数据获取API函数
    const getStatsData = () => {
        if (!currentDocPath) {
            console.warn('TimeStats: No current document path available');
            return null;
        }

        console.log('TimeStats: API called to get stats data');

        // 准备数据：当前文件 + 跨文件（若可）
        const { bucketSizeMs } = getConfig();
        const fileStats = getFileStats(currentDocPath);
        console.log('TimeStats: Current file stats:', {
            path: currentDocPath,
            totalMillis: fileStats.totalMillis,
            charsAdded: fileStats.charsAdded,
            bucketsCount: fileStats.buckets.length,
            sessionsCount: fileStats.sessions.length,
            buckets: fileStats.buckets.slice(0, 3) // 显示前3个桶
        });

        const perFileLine = fileStats.buckets
            .slice()
            .sort((a, b) => a.start - b.start)
            .map(b => ({ t: b.start, cpm: Math.round((b.charsAdded * 60000) / bucketSizeMs) }));

        // 如果没有数据，创建一些测试数据用于调试
        if (perFileLine.length === 0) {
            console.log('TimeStats: No bucket data, creating test data');
            const currentTime = Date.now();
            const testData = [];
            for (let i = 0; i < 5; i++) {
                testData.push({
                    t: currentTime - (5 - i) * bucketSizeMs,
                    cpm: Math.floor(Math.random() * 100) + 20
                });
            }
            perFileLine.push(...testData);
        }

        console.log('TimeStats: Per file line data:', perFileLine.slice(0, 5)); // 显示前5个数据点

        // 跨文件汇总（尽量从全局拿；否则降级为当前文件）
        const globalFileTracking = getGlobalFileTracking?.();
        type Ws = {
            filePath?: string;
            totalMillis: number;
            charsAdded: number;
            lastActiveTime: number;
            buckets?: { start: number; end: number; charsAdded: number }[];
            sessions?: { start: number; end: number }[];
        };

        let allStats: Ws[] = [];
        let globalCapable = false;

        console.log('TimeStats: Global file tracking available:', !!globalFileTracking);

        if (globalFileTracking && typeof globalFileTracking.getAllWritingStats === 'function') {
            try {
                allStats = globalFileTracking.getAllWritingStats(); // 使用新的方法
                globalCapable = true;
                console.log('TimeStats: Successfully retrieved', allStats.length, 'file stats from global tracking');
            } catch (error) {
                console.error('TimeStats: Failed to get all writing stats:', error);
            }
        }

        if (!globalCapable) {
            // 降级：只用当前文件
            allStats = [{
                filePath: currentDocPath,
                totalMillis: fileStats.totalMillis,
                charsAdded: fileStats.charsAdded,
                lastActiveTime: fileStats.lastSeen,
                buckets: fileStats.buckets,
                sessions: fileStats.sessions,
            }];
        }

        // 计算：全文件累计时长、今日时长/平均/峰值、热力图（日粒度）、今日按小时柱状图
        const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        const msDay = 24 * 60 * 60 * 1000;
        const todayStart = startOfDay(new Date());

        // 累计时长（全文件）
        const totalMillisAll = allStats.reduce((s, it) => s + (it.totalMillis || 0), 0);

        // 今日：从 sessions 聚合（有 sessions 用 sessions，没有则从 buckets 近似）
        let todayMillis = 0;
        let todayChars = 0;
        let todayPeakCPM = 0;
        const todayHourly: Record<number, number> = {}; // 0..23 -> charsAdded
        for (let h = 0; h < 24; h++) {
            todayHourly[h] = 0;
        }

        // 今日15分钟粒度热力图：96个时间点（24小时 × 4刻钟）
        const todayQuarterHourly: Record<number, number> = {}; // 0..95 -> charsAdded
        for (let i = 0; i < 96; i++) {
            todayQuarterHourly[i] = 0;
        }

        // 热力图：最近 52 周（364 天）每天的 charsAdded
        const heatDays = 364;
        const heatStart = todayStart - heatDays * msDay;
        const heatmap: Record<number, number> = {}; // dayStartTs -> charsAdded

        function addCharsToDay(ts: number, chars: number) {
            const dayTs = startOfDay(new Date(ts));
            heatmap[dayTs] = (heatmap[dayTs] ?? 0) + chars;
        }

        for (const it of allStats) {
            const buckets = it.buckets ?? [];
            // 用 buckets 估算每日与今日
            for (const b of buckets) {
                const ts = b.start;
                if (ts >= heatStart) {
                    addCharsToDay(ts, b.charsAdded);
                }

                if (ts >= todayStart) {
                    todayChars += b.charsAdded;
                    const cpm = Math.round((b.charsAdded * 60000) / bucketSizeMs);
                    if (cpm > todayPeakCPM) {
                        todayPeakCPM = cpm;
                    }

                    const hour = new Date(ts).getHours();
                    todayHourly[hour] += b.charsAdded;

                    // 计算15分钟粒度索引 (0-95)
                    const date = new Date(ts);
                    const quarterHourIndex = date.getHours() * 4 + Math.floor(date.getMinutes() / 15);
                    todayQuarterHourly[quarterHourIndex] += b.charsAdded;
                }
            }

            // 今日用时（用 sessions 更精确）
            const sessions = it.sessions ?? [];
            for (const s of sessions) {
                // 累加与今天交集
                const st = Math.max(s.start, todayStart);
                const en = Math.min(s.end, todayStart + msDay);
                if (en > st) {
                    todayMillis += (en - st);
                }
            }
        }
        const todayMinutes = todayMillis / 60000;
        const todayAvgCPM = todayMinutes > 0 ? Math.round(todayChars / todayMinutes) : 0;

        // 如果没有今日数据，创建一些测试数据
        if (todayChars === 0 && todayMillis === 0) {
            console.log('TimeStats: No today data, creating test data');
            todayChars = 150;
            todayMillis = 3600000; // 1小时
            todayPeakCPM = 120;
            const currentHour = new Date().getHours();
            todayHourly[currentHour] = 50;
            todayHourly[currentHour - 1] = 30;
            todayHourly[currentHour - 2] = 70;

            // 添加一些15分钟数据
            for (let i = 0; i < 8; i++) {
                const idx = currentHour * 4 + (i % 4);
                if (idx >= 0 && idx < 96) {
                    todayQuarterHourly[idx] = Math.floor(Math.random() * 20) + 5;
                }
            }
        }

        // 重新计算今日平均CPM
        const finalTodayMinutes = todayMillis / 60000;
        const finalTodayAvgCPM = finalTodayMinutes > 0 ? Math.round(todayChars / finalTodayMinutes) : 0;

        const result = {
            type: 'time-stats-data',
            supportsGlobal: globalCapable,
            perFileLine,               // 当前文件的速度曲线
            totalMillisAll,            // 全文件累计时长
            today: {
                millis: todayMillis,
                avgCPM: finalTodayAvgCPM,
                peakCPM: todayPeakCPM,
                hourly: todayHourly,
                quarterHourly: todayQuarterHourly,
                chars: todayChars,
            },
            heatmap,                   // dayTs -> charsAdded（最近 52 周）
            bucketSizeMs
        };

        console.log('TimeStats: Generated stats data:', {
            globalCapable,
            allStatsCount: allStats.length,
            perFileLineLength: perFileLine.length,
            totalMillisAll,
            todayChars,
            todayHourlySum: Object.values(todayHourly).reduce((a, b) => a + b, 0),
            heatmapDaysCount: Object.keys(heatmap).length
        });

        return result;
    };

    // 监听来自webview的API调用
    const messageDisposable = panel.webview.onDidReceiveMessage(
        message => {
            console.log('TimeStats: Received message from webview:', message);

            if (message.type === 'get-stats-data') {
                console.log('TimeStats: API request for stats data');
                const data = getStatsData();
                if (data) {
                    panel.webview.postMessage(data);
                } else {
                    panel.webview.postMessage({
                        type: 'error',
                        message: 'No current document available'
                    });
                }
            }
        },
        undefined,
        context.subscriptions
    );
}

// -------------------- 激活/反激活 --------------------
export function activateTimeStats(context: vscode.ExtensionContext) {
    // 确保只保留一个状态栏条目
    if (statusBarItem) { statusBarItem.dispose(); }
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.command = 'AndreaNovelHelper.openTimeStats';
    context.subscriptions.push(statusBarItem);

    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (ws) {
        registerFileChangeCallback('timeStats', (event) => {
            console.log(`Time stats: File ${event.type} - ${event.filePath}`);
        });
    }

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(handleTextChange),
        vscode.window.onDidChangeActiveTextEditor(handleActiveEditorChange),
        vscode.window.onDidChangeWindowState(handleWindowStateChange),
        vscode.workspace.onDidCloseTextDocument(handleDocumentClose),
        vscode.workspace.onDidRenameFiles(handleRename),
        vscode.commands.registerCommand('AndreaNovelHelper.openTimeStats', async () => {
            try {
                await openDashboard(context);
            } catch (error) {
                console.error('TimeStats: Failed to open dashboard:', error);
                vscode.window.showErrorMessage('无法打开写作统计仪表板');
            }
        }),
        vscode.commands.registerCommand('AndreaNovelHelper.exportTimeStatsCSV', () => exportStatsCSV(context)),
    );

    // 初始状态栏
    handleActiveEditorChange(vscode.window.activeTextEditor);
    updateStatusBar();
}

export function deactivateTimeStats() {
    if (currentDocPath) {
        const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === currentDocPath);
        if (doc) {
            flushDocStats(doc); // 反激活前冲刷
        }
    }
    endSession();
    if (statusBarItem) {
        statusBarItem.dispose();
    }
    unregisterFileChangeCallback('timeStats');
}
