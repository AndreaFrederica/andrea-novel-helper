import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
    registerFileChangeCallback,
    unregisterFileChangeCallback,
    getGlobalFileTracking,
    updateFileWritingStats,
    getAllWritingStatsAsync
} from './utils/tracker/globalFileTracking';
import { analyzeText, TextStats } from './utils/utils';
import { countAndAnalyzeOffThread } from './utils/WordCount/asyncWordCounter';
import { isHugeFile } from './utils/utils';
import { getFileTracker } from './utils/tracker/fileTracker';
import { getIgnoredWritingStatsManager } from './utils/WritingCount/ignoredWritingStats';
import { CombinedIgnoreParser } from './utils/Parser/gitignoreParser';
import { getEffectiveDocumentSync, onDidChangeEffectiveDocument, setActivePreview } from './context/previewRedirect';
import { isAnyCommentPanelActive } from './context/commentRedirect';

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
    achievedMilestones?: number[]; // 已达成的里程碑目标
}

// -------------------- 运行时状态 --------------------
let currentDocPath: string | undefined;
let currentDocUuid: string | undefined;
let currentSessionStart = 0;
let ignoredAggregateSessionStart = 0; // 忽略文件聚合会话开始
let idleTimer: NodeJS.Timeout | undefined;
let windowFocused = true;
let isIdle = true; // 冷启动默认空闲：不开会话、不建桶
// 始终只保留一个
let statusBarItem: vscode.StatusBarItem | undefined;
// Webview面板状态管理
let dashboardPanel: vscode.WebviewPanel | undefined;
let suspendedByPreview = false; // 预览期间"暂挂"的标记
let suspendedByCommentPanel = false; // 批注面板期间"暂挂"的标记
let statusBarTicker: NodeJS.Timeout | undefined;

// 放在文件顶部“运行时状态”附近
function isDashboardActive(): boolean {
    return !!dashboardPanel && dashboardPanel.active;
}

function startStatusBarTicker() {
    if (statusBarTicker) { return; }
    statusBarTicker = setInterval(() => {
        // 只在会话进行且非 idle 时刷新，可避免无谓开销
        if (currentSessionStart > 0 && !isIdle) {
            updateStatusBar();
        }
    }, 1000);
}

function stopStatusBarTicker() {
    if (!statusBarTicker) { return; }
    clearInterval(statusBarTicker);
    statusBarTicker = undefined;
}

function isAnyPreviewActive(): boolean {
    try {
        return !!(getEffectiveDocumentSync()); // 只要有效预览在报 uri 就算活跃
    } catch {
        return false;
    }
}

function isAnyPanelActive(): boolean {
    try {
        return isAnyPreviewActive() || isAnyCommentPanelActive(); // 预览面板或批注面板活跃
    } catch {
        return false;
    }
}

// 调试开关读取
function tsDebugEnabled(): boolean {
    try { return vscode.workspace.getConfiguration('AndreaNovelHelper.timeStats').get<boolean>('debug', false) ?? false; } catch { return false; }
}
function tsDebug(tag: string, ...rest: any[]) {
    if (!tsDebugEnabled()) { return; }
    try { console.warn('[TimeStats][debug]', tag, ...rest); } catch { /* ignore */ }
}

// // 输出到扩展专用的 OutputChannel（代替 console.log）
// const timeStatsLog = vscode.window.createOutputChannel('Andrea Novel Helper:TimeStats');
// function ts.log(...args: any[]) {
//     try {
//         const parts = args.map(a => (typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()));
//         timeStatsLog.appendLine('[TimeStats] ' + parts.join(' '));
//     } catch (e) {
//         try { timeStatsLog.appendLine('[TimeStats] (log)'); } catch { /* ignore */ }
//     }
// }

// —— IME 友好的去抖计数状态 ——
interface RuntimeDocState {
    lastCount: number;            // 上次稳定时的"码字总量"（computeZhEnCount 的 total）
    lastVersion: number;          // 上次稳定时的文档版本
    debounce?: NodeJS.Timeout;    // 去抖定时器
    lastFlushTs: number;          // 上次冲刷时间
    // —— 大文件近似模式字段 ——
    isLarge?: boolean;            // 是否为大文件并启用近似模式
    pendingDelta?: number;        // 自上次冲刷以来累计的近似增量
    approxChanges?: number;       // 近似增量累计次数
    lastAccurateTs?: number;      // 最近一次精确校准时间
    lastFullStats?: TextStats;    // 最近一次精确统计的完整 TextStats（小文件或大文件校准时更新）
    pendingFlushCore?: boolean;   // 是否已有异步 flushCore 排队
    pendingBaseline?: boolean;    // 是否需要异步建立基线（用于大文件初始化）
    pendingPasteDelta?: number;
    // —— 里程碑跟踪字段 ——
    achievedMilestones?: Set<number>; // 已达成的里程碑目标
}
const docStates = new Map<string, RuntimeDocState>();

function getOrInitDocState(doc: vscode.TextDocument): RuntimeDocState {
    const fp = doc.uri.fsPath;
    let st = docStates.get(fp);
    if (!st) {
        const cfg = getConfig();
        const text = doc.getText();
        // 对于大文件，使用字符长度近似计算，避免精确的字节长度计算阻塞
        const charLength = text.length;
        const approximateSize = charLength > 100000 ? charLength * 2 : Buffer.byteLength(text, 'utf8');
        const isLarge = cfg.largeApproximate && approximateSize > cfg.largeThresholdBytes;
        
        // 超大文件提示（避免重复弹出）
        try {
            const hugeCfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
            const hugeTh = hugeCfg.get<number>('hugeFile.thresholdBytes', 50 * 1024)!;
            const suppress = hugeCfg.get<boolean>('hugeFile.suppressWarning', false)!;
            if (approximateSize > hugeTh && !suppress && !docStates.has('__hugewarn__' + fp)) {
                docStates.set('__hugewarn__' + fp, { lastCount: 0, lastVersion: 0, lastFlushTs: 0 });
                vscode.window.showInformationMessage('该大文件已启用 TimeStats 近似统计，其他高成本高亮功能已被跳过。');
            }
        } catch {/* ignore */ }
        
        // 对于大文件或超过10KB的文件，使用异步初始化避免阻塞
        if (isLarge || approximateSize > 10000) {
            // 创建占位状态，使用估算的初始值
            const estimatedCount = Math.floor(approximateSize * 0.8); // 粗略估算：假设80%的字节是有效字符
            st = { 
                lastCount: estimatedCount, 
                lastVersion: doc.version, 
                lastFlushTs: now(), 
                isLarge, 
                pendingDelta: 0, 
                approxChanges: 0, 
                lastAccurateTs: 0, // 标记为未校准
                lastFullStats: undefined,
                pendingBaseline: true // 标记需要异步建立基线
            };
            tsDebug('initDocState:async', { file: fp, isLarge, size: approximateSize, estimated: estimatedCount });
            
            // 异步建立精确基线
            computeZhEnCountAsync(fp).then(baseFull => {
                const currentSt = docStates.get(fp);
                if (currentSt && currentSt.pendingBaseline) {
                    currentSt.lastCount = baseFull.total;
                    currentSt.lastFullStats = baseFull.full;
                    currentSt.lastAccurateTs = now();
                    currentSt.pendingBaseline = false;
                    tsDebug('initDocState:baseline-ready', { file: fp, actual: baseFull.total, estimated: estimatedCount });
                    updateStatusBar();
                }
            }).catch(error => {
                tsDebug('initDocState:baseline-error', { file: fp, error });
                // 如果异步失败，退回到同步计算
                const currentSt = docStates.get(fp);
                if (currentSt && currentSt.pendingBaseline) {
                    try {
                        const baseFull = computeZhEnCount(text);
                        currentSt.lastCount = baseFull.total;
                        currentSt.lastFullStats = baseFull.full;
                        currentSt.lastAccurateTs = now();
                        currentSt.pendingBaseline = false;
                    } catch { /* ignore */ }
                }
            });
        } else {
            // 小文件直接同步计算
            const baseFull = computeZhEnCount(text);
            st = { lastCount: baseFull.total, lastVersion: doc.version, lastFlushTs: now(), isLarge, pendingDelta: 0, approxChanges: 0, lastAccurateTs: now(), lastFullStats: baseFull.full };
            tsDebug('initDocState:sync', { file: fp, isLarge, size: approximateSize, base: baseFull.total });
        }
        
        docStates.set(fp, st);
    }
    return st;
}

// -------------------- 配置 --------------------
function getConfig() {
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper.timeStats');
    const includePaste = cfg.get<boolean>('includePaste');
    return {
        enabledLanguages: cfg.get<string[]>('enabledLanguages', ['markdown', 'plaintext']),
        idleThresholdMs: cfg.get<number>('idleThresholdMs', 30000),
        bucketSizeMs: cfg.get<number>('bucketSizeMs', 60000),
        imeDebounceMs: cfg.get<number>('imeDebounceMs', 350), // IME 去抖时间
        exitIdleOn: cfg.get<string>('exitIdleOn', 'text-change'), // 退出空闲状态的条件
        statusBarAlignment: cfg.get<'left' | 'right'>('statusBar.alignment', 'left'),
        statusBarPriority: cfg.get<number>('statusBar.priority', 100),
        respectWcignore: cfg.get<boolean>('respectWcignore', false),
        // 大文件估算相关
        largeThresholdBytes: cfg.get<number>('largeFile.thresholdBytes', 64 * 1024),
        largeApproximate: cfg.get<boolean>('largeFile.approximate', true),
        largeAccurateEveryChanges: cfg.get<number>('largeFile.accurateEveryChanges', 80),
        largeAccurateEveryMs: cfg.get<number>('largeFile.accurateEveryMs', 60_000),
        includePasteSpeed: includePaste !== undefined ? includePaste : (cfg.get<boolean>('includePasteInSpeed', false) ?? false),
        includePasteCounters: includePaste !== undefined ? includePaste : (cfg.get<boolean>('includePasteInAddedCounters', true) ?? true),
        pasteThresholdChars: cfg.get<number>('pasteThresholdChars', 32)
    };
}
// 忽略解析器（按需实例化）
let combinedIgnoreParser: CombinedIgnoreParser | undefined;
function ensureIgnoreParser(): void {
    if (combinedIgnoreParser) { return; }
    try {
        const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (ws) {
            combinedIgnoreParser = new CombinedIgnoreParser(ws);
        }
    } catch (e) {
        console.warn('TimeStats: 初始化忽略解析器失败', e);
    }
}
function isFileIgnoredForTimeStats(filePath: string): boolean {
    const cfg = getConfig();
    if (!cfg.respectWcignore) { return false; }
    ensureIgnoreParser();
    try {
        if (combinedIgnoreParser && typeof combinedIgnoreParser.shouldIgnore === 'function') {
            return combinedIgnoreParser.shouldIgnore(filePath);
        }
    } catch (e) {
        console.warn('TimeStats: 检查忽略失败', e);
    }
    return false;
}

// -------------------- 里程碑功能 --------------------
function checkAndCelebrateMilestones(filePath: string, oldCount: number, newCount: number, st: RuntimeDocState) {
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper.timeStats');
    const enabled = cfg.get<boolean>('milestone.enabled', true);
    if (!enabled) { return; }

    const targets = cfg.get<number[]>('milestone.targets', [1000, 2000, 5000, 10000, 20000, 50000, 100000]);
    if (!targets || targets.length === 0) { return; }
    
    // 获取持久化的文件统计，包含已达成的里程碑
    const fileStats = getFileStats(filePath);
    const persistedMilestones = new Set(fileStats.achievedMilestones || []);
    
    // 初始化运行时里程碑集合（与持久化数据同步）
    if (!st.achievedMilestones) {
        st.achievedMilestones = new Set(persistedMilestones);
        tsDebug('milestone:loaded-from-persist', { filePath, milestones: Array.from(persistedMilestones) });
    }
    
    // 检查新达成的里程碑 - 只有当字数增加且首次达到时才触发
    const newMilestones: number[] = [];
    if (newCount > oldCount) { // 确保是字数增加的情况
        for (const target of targets) {
            // 条件：旧字数小于目标，新字数大于等于目标，且从未达成过（包括持久化数据）
            if (oldCount < target && newCount >= target && !st.achievedMilestones.has(target)) {
                st.achievedMilestones.add(target);
                newMilestones.push(target);
                tsDebug('milestone:newly-achieved', { filePath, target, oldCount, newCount });
            }
        }
    }
    
    // 如果有新达成的里程碑，更新持久化数据
    if (newMilestones.length > 0) {
        // 更新FileStats中的里程碑数据
        fileStats.achievedMilestones = Array.from(st.achievedMilestones);
        persistFileStats(filePath, fileStats);
        
        // 庆祝新达成的里程碑
        celebrateMilestones(filePath, newMilestones, newCount);
        
        tsDebug('milestone:persisted', { filePath, allMilestones: Array.from(st.achievedMilestones) });
    }
}

function celebrateMilestones(filePath: string, milestones: number[], currentCount: number) {
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper.timeStats');
    const notificationType = cfg.get<string>('milestone.notificationType', 'information');
    const fileName = path.basename(filePath);
    
    let message: string;
    let actionButton: string;
    
    if (milestones.length === 1) {
        const target = milestones[0];
        message = `🎉 恭喜！${fileName}已达到 ${target.toLocaleString()} 字！当前字数：${currentCount.toLocaleString()}`;
        actionButton = '继续加油！';
    } else {
        // 同时达成多个里程碑
        const targets = milestones.sort((a, b) => a - b).map(n => n.toLocaleString()).join('、');
        message = `🎉🎉 太棒了！${fileName}一举突破 ${targets} 字大关！当前字数：${currentCount.toLocaleString()}`;
        actionButton = '再接再厉！';
    }
    
    if (notificationType === 'modal') {
        // 模态对话框 - 阻塞用户操作
        vscode.window.showInformationMessage(
            message,
            { modal: true },
            actionButton,
            '查看详情'
        ).then((selection) => {
            if (selection === '查看详情') {
                // 可以在这里添加打开写作统计面板的逻辑
                vscode.commands.executeCommand('AndreaNovelHelper.openTimeStats');
            }
        });
    } else {
        // 默认：右下角信息提示 - 不阻塞用户操作
        vscode.window.showInformationMessage(message, actionButton, '查看详情').then((selection) => {
            if (selection === '查看详情') {
                // 可以在这里添加打开写作统计面板的逻辑
                vscode.commands.executeCommand('AndreaNovelHelper.openTimeStats');
            }
        });
    }
    
    tsDebug('milestone:celebrated', { file: fileName, milestones, currentCount, notificationType });
}

// -------------------- 基础工具 --------------------
function ensureDirectoryExists(file: string) {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function now() { return Date.now(); }

// 统一字数统计：使用与 WordCount 同源的全文分析，确保数据结构统一
export function computeZhEnCount(text: string): { zhChars: number; enWords: number; total: number; full: TextStats } {
    // analyzeText 返回 TextStats: { cjkChars, asciiChars, words, nonWSChars, total }
    const stats = analyzeText(text);
    return {
        zhChars: stats.cjkChars,
        enWords: stats.words, // 这里 words 代表英文/数字词数量
        total: stats.total,
        full: stats
    };
}

// 异步版本：使用 Worker 线程避免阻塞主线程
export async function computeZhEnCountAsync(filePath: string): Promise<{ zhChars: number; enWords: number; total: number; full: TextStats }> {
    try {
        const result = await countAndAnalyzeOffThread(filePath);
        // result 格式: { stats: TextStats, ... }
        const stats = result.stats || result;
        return {
            zhChars: stats.cjkChars,
            enWords: stats.words,
            total: stats.total,
            full: stats
        };
    } catch (error) {
        // 如果异步计算失败，返回一个估算结果而不是阻塞主线程
        tsDebug('computeZhEnCountAsync:error', { filePath, error });
        
        // 尝试从VSCode文档获取文本（如果文档已打开）
        const openDoc = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === filePath);
        if (openDoc) {
            const text = openDoc.getText();
            // 只对小文件使用同步计算，大文件返回估算值
            if (text.length <= 50000) {
                return computeZhEnCount(text);
            } else {
                // 大文件：返回基于长度的估算
                const estimatedTotal = Math.floor(text.length * 0.8);
                const estimatedCjk = Math.floor(estimatedTotal * 0.7);
                const estimatedWords = Math.floor(estimatedTotal * 0.1);
                tsDebug('computeZhEnCountAsync:estimated', { filePath, length: text.length, estimated: estimatedTotal });
                return {
                    zhChars: estimatedCjk,
                    enWords: estimatedWords,
                    total: estimatedTotal,
                    full: {
                        cjkChars: estimatedCjk,
                        asciiChars: estimatedTotal - estimatedCjk,
                        words: estimatedWords,
                        nonWSChars: estimatedTotal,
                        total: estimatedTotal
                    }
                };
            }
        }
        
        // 如果文档未打开，返回一个默认的空结果
        return {
            zhChars: 0,
            enWords: 0,
            total: 0,
            full: { cjkChars: 0, asciiChars: 0, words: 0, nonWSChars: 0, total: 0 }
        };
    }
}

// 获取或创建文件统计（接入全局追踪）
function getOrCreateFileStats(filePath: string): FileStats {
    console.log('TimeStats: getOrCreateFileStats called for:', filePath);

    const g = getGlobalFileTracking?.();
    console.log('TimeStats: getGlobalFileTracking result:', !!g);

    if (!g) {
        console.log('TimeStats: No global file tracking, returning empty stats');
        return { totalMillis: 0, charsAdded: 0, charsDeleted: 0, firstSeen: now(), lastSeen: now(), buckets: [], sessions: [], achievedMilestones: [] };
    }

    let uuid = g.getFileUuid(filePath);
    console.log('TimeStats: File UUID for', filePath, ':', uuid);

    // 如果文件没有UUID（可能是未保存的新文件），创建临时追踪记录
    if (!uuid) {
        console.log('TimeStats: No UUID found, creating temporary tracking record');
        try {
            // 通过数据管理器创建临时文件记录
            const tracker = getFileTracker();
            if (tracker) {
                const dataManager = tracker.getDataManager();
                uuid = dataManager.createTemporaryFile(filePath);
                console.log('TimeStats: Created temporary file record with UUID:', uuid);
            }
        } catch (error) {
            console.log('TimeStats: Failed to create temporary file record:', error);
        }

        if (!uuid) {
            console.log('TimeStats: Still no UUID, returning empty stats');
            return { totalMillis: 0, charsAdded: 0, charsDeleted: 0, firstSeen: now(), lastSeen: now(), buckets: [], sessions: [], achievedMilestones: [] };
        }
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
            achievedMilestones: ws.achievedMilestones ?? [], // 加载已达成的里程碑
        };
    }

    console.log('TimeStats: No writing stats found, returning empty stats');
    return { totalMillis: 0, charsAdded: 0, charsDeleted: 0, firstSeen: now(), lastSeen: now(), buckets: [], sessions: [], achievedMilestones: [] };
}

// 仅当前文件读取
function getFileStats(filePath: string): FileStats {
    return getOrCreateFileStats(filePath);
}

// 写回全局
function persistFileStats(filePath: string, stats: FileStats) {
    const totalMinutes = stats.totalMillis / 60000;
    const averageCPM = totalMinutes > 0 ? Math.round(stats.charsAdded / totalMinutes) : 0;
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper.timeStats');
    const persistReadOnly = cfg.get<boolean>('persistReadOnlySessions', false);
    const noCharChange = stats.charsAdded === 0 && stats.charsDeleted === 0;
    if (noCharChange && !persistReadOnly) {
        // 纯阅读: 不落盘以避免脏分片；仅更新内存状态栏
        return;
    }
    updateFileWritingStats(filePath, {
        totalMillis: stats.totalMillis,
        charsAdded: stats.charsAdded,
        charsDeleted: stats.charsDeleted,
        lastActiveTime: stats.lastSeen,
        sessionsCount: stats.sessions.length,
        averageCPM,
        buckets: stats.buckets,
        sessions: stats.sessions,
        achievedMilestones: stats.achievedMilestones // 持久化已达成的里程碑
    } as any);
}

// 桶聚合 - 空闲时不创建新桶，只更新现有桶
function bumpBucket(fsEntry: FileStats, timestamp: number, added: number, bucketSizeMs: number) {
    if (added <= 0) {
        return; // 没有新增内容，直接返回
    }

    const bucketStart = Math.floor(timestamp / bucketSizeMs) * bucketSizeMs;
    let bucket = fsEntry.buckets.find(b => b.start === bucketStart);

    if (!bucket) {
        // 如果用户处于空闲状态，不创建新桶来节省存储空间
        if (isIdle) {
            console.log('TimeStats: Skipping bucket creation due to idle state');
            return;
        }

        // 创建新桶
        bucket = { start: bucketStart, end: bucketStart + bucketSizeMs, charsAdded: 0 };
        fsEntry.buckets.push(bucket);
        console.log('TimeStats: Created new bucket at', new Date(bucketStart).toLocaleTimeString());
    }

    bucket.charsAdded += added;
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
    startStatusBarTicker();
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
    stopStatusBarTicker();
}
// 结束忽略聚合会话（若存在）并写入聚合时长
function endIgnoredAggregateSession() {
    if (ignoredAggregateSessionStart === 0) { return; }
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const mgr = getIgnoredWritingStatsManager(wsRoot);
    if (mgr) {
        const duration = now() - ignoredAggregateSessionStart;
        mgr.update({ deltaMillis: duration, deltaAdded: 0, deltaDeleted: 0, timestamp: now() });
    }
    ignoredAggregateSessionStart = 0;
}

// 空闲定时
function resetIdleTimer(idleThresholdMs: number) {
    if (idleTimer) {
        clearTimeout(idleTimer);
    }

    // 重置空闲状态 - 用户有活动
    isIdle = false;

    if (currentSessionStart > 0) { startStatusBarTicker(); }
    idleTimer = setTimeout(() => {
        console.log('TimeStats: User is now idle, stopping bucket creation');
        isIdle = true; // 设置为空闲状态，停止创建新桶
        endSession();
        updateStatusBar();
    }, idleThresholdMs);
}

// 根据配置决定是否退出空闲状态
function checkExitIdle(trigger: 'text-change' | 'window-focus' | 'editor-change') {
    const { exitIdleOn } = getConfig();

    switch (exitIdleOn) {
        case 'text-change':
            // 只有文本变化时才退出空闲状态
            return trigger === 'text-change';
        case 'window-focus':
            // 窗口获得焦点或文本变化时退出空闲状态
            return trigger === 'window-focus' || trigger === 'text-change';
        case 'editor-change':
            // 编辑器切换、窗口获得焦点或文本变化时退出空闲状态
            return trigger === 'editor-change' || trigger === 'window-focus' || trigger === 'text-change';
        default:
            // 默认只在文本变化时退出
            return trigger === 'text-change';
    }
}

// -------------------- IME 友好的去抖计数 --------------------
// 核心冲刷（可能执行重计算），不直接调用，使用 flushDocStats 异步调度
function flushDocStatsCore(doc: vscode.TextDocument) {
    const { bucketSizeMs, largeApproximate, largeAccurateEveryChanges, largeAccurateEveryMs, includePasteSpeed, includePasteCounters } = getConfig();
    const filePath = doc.uri.fsPath;
    const ignored = isFileIgnoredForTimeStats(filePath);
    const st = docStates.get(filePath);
    if (!st) { return; }

    const t = now();
    let totalNow: number;
    let delta: number;
    if (st.isLarge && largeApproximate) {
        delta = st.pendingDelta || 0;
        if (delta === 0) { st.lastFlushTs = t; tsDebug('flushCore:skip-no-delta', filePath); return; }
        totalNow = st.lastCount + delta;
    } else {
        // 对于小文件或禁用近似模式，使用同步计算
        // 大文件且启用近似模式的情况在上面已经处理
        const docText = doc.getText();
        
        // 检查是否需要异步建立基线
        if (st.pendingBaseline) {
            // 大文件初始化，使用异步计算建立基线
            st.pendingBaseline = false;
            computeZhEnCountAsync(filePath).then(full => {
                const currentSt = docStates.get(filePath);
                if (currentSt) {
                    currentSt.lastFullStats = full.full;
                    currentSt.lastCount = full.total;
                    tsDebug('flushCore:baseline-established', { filePath, total: full.total });
                }
            }).catch(error => {
                tsDebug('flushCore:baseline-error', { filePath, error });
            });
            
            // 暂时跳过这次flush，等待基线建立
            st.lastFlushTs = t;
            tsDebug('flushCore:skip-pending-baseline', filePath);
            return;
        }
        
        // 简单的文件大小检查：如果文本超过50KB，使用异步计算
        if (docText.length > 50000) {
            // 异步计算，暂时使用近似值
            if (st.pendingDelta) {
                totalNow = st.lastCount + st.pendingDelta;
                delta = st.pendingDelta;
                st.pendingDelta = 0;
            } else {
                // 没有变化，跳过
                st.lastFlushTs = t; 
                tsDebug('flushCore:skip-large-no-delta', filePath); 
                return;
            }
            
            // 启动异步重新计算（不阻塞）
            computeZhEnCountAsync(filePath).then(full => {
                const currentSt = docStates.get(filePath);
                if (currentSt && currentSt.lastFlushTs <= t) {
                    const oldCount = currentSt.lastCount;
                    currentSt.lastFullStats = full.full;
                    currentSt.lastCount = full.total;
                    tsDebug('flushCore:async-update', { filePath, total: full.total });
                    
                    // 检查里程碑（大文件异步检查）
                    checkAndCelebrateMilestones(filePath, oldCount, full.total, currentSt);
                    
                    // 异步更新完成后刷新状态栏
                    updateStatusBar();
                }
            }).catch(error => {
                tsDebug('flushCore:async-error', { filePath, error });
            });
        } else {
            // 小文件，使用同步计算
            const full = computeZhEnCount(docText);
            totalNow = full.total;
            delta = totalNow - st.lastCount;
            if (delta === 0) { st.lastFlushTs = t; tsDebug('flushCore:skip-no-change', filePath); return; }
            st.lastFullStats = full.full;
            
            // 检查里程碑（小文件立即检查）
            checkAndCelebrateMilestones(filePath, st.lastCount, totalNow, st);
        }
    }
    tsDebug('flushCore:delta', { file: filePath, delta, totalNow, isLarge: st.isLarge });

    if (delta !== 0) {
        if (ignored) {
            const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            const mgr = getIgnoredWritingStatsManager(wsRoot);
            if (mgr) {
                mgr.update({
                    deltaMillis: 0,
                    deltaAdded: delta > 0 ? delta : 0,
                    deltaDeleted: delta < 0 ? -delta : 0,
                    timestamp: t
                });
            }
        } else {
            const fsEntry = getFileStats(filePath);
            let addForCounters = delta;
            const pasteDelta = st.pendingPasteDelta || 0;
            if (!includePasteCounters && delta > 0 && pasteDelta > 0) {
                addForCounters = Math.max(0, delta - pasteDelta);
            }
            if (addForCounters > 0) {
                fsEntry.charsAdded += addForCounters;
            } else if (addForCounters < 0) {
                fsEntry.charsDeleted += -addForCounters;
            }
            const addForSpeed = includePasteSpeed ? Math.max(0, delta) : Math.max(0, delta - (st.pendingPasteDelta || 0));
            bumpBucket(fsEntry, t, addForSpeed, bucketSizeMs);
            fsEntry.lastSeen = t;
            persistFileStats(filePath, fsEntry);
            tsDebug('flushCore:updateFileStats', { file: filePath, charsAdded: fsEntry.charsAdded, charsDeleted: fsEntry.charsDeleted });
        }
    }

    st.lastCount = totalNow;
    st.lastVersion = doc.version;
    st.lastFlushTs = t;
    if (st.isLarge) { st.pendingDelta = 0; }
    st.pendingPasteDelta = 0;
    updateStatusBar();

    // 大文件近似模式：按时间或次数触发后台精确校准
    if (st.isLarge && largeApproximate) {
        const needAccurateByTime = (t - (st.lastAccurateTs || 0)) >= largeAccurateEveryMs;
        const needAccurateByChanges = (st.approxChanges || 0) >= largeAccurateEveryChanges;
        if (needAccurateByTime || needAccurateByChanges) {
            tsDebug('scheduleAccurate', { file: filePath, needAccurateByTime, needAccurateByChanges, approxChanges: st.approxChanges, sinceLastMs: t - (st.lastAccurateTs || 0) });
            const versionAtSchedule = doc.version;
            
            // 使用异步计算避免阻塞主线程
            setTimeout(async () => {
                try {
                    const full = await computeZhEnCountAsync(filePath);
                    const adjust = full.total - st.lastCount;
                    if (adjust !== 0) {
                        const fsEntry = getFileStats(filePath);
                        if (adjust > 0) { fsEntry.charsAdded += adjust; } else { fsEntry.charsDeleted += -adjust; }
                        bumpBucket(fsEntry, now(), Math.max(0, adjust), bucketSizeMs);
                        fsEntry.lastSeen = now();
                        persistFileStats(filePath, fsEntry);
                        st.lastCount = full.total;
                        st.lastFullStats = full.full;
                        tsDebug('accurateAdjust', { file: filePath, adjust, newTotal: st.lastCount });
                    }
                    st.lastAccurateTs = now();
                    st.approxChanges = 0;
                    if (versionAtSchedule === doc.version) { updateStatusBar(); }
                } catch (error) {
                    tsDebug('accurateAdjust:error', { file: filePath, error });
                }
            }, 0);
        }
    }
}

// 异步调度包装，确保所有重计算离开事件调用栈
function flushDocStats(doc: vscode.TextDocument) {
    const st = getOrInitDocState(doc);
    if (st.pendingFlushCore) { tsDebug('flushDebounce:alreadyPending', doc.uri.fsPath); return; }
    st.pendingFlushCore = true; tsDebug('flushDebounce:queue', doc.uri.fsPath);
    setTimeout(() => {
        const start = Date.now();
        try { flushDocStatsCore(doc); } finally {
            const cost = Date.now() - start;
            tsDebug('flushDebounce:done', { file: doc.uri.fsPath, costMs: cost });
            st.pendingFlushCore = false;
        }
    }, 0);
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
        const effectiveDoc2 = getEffectiveDocumentSync() ?? vscode.window.activeTextEditor?.document;
        if (effectiveDoc2 === doc && windowFocused) {
            flushDocStats(doc);
        }
    }, imeDebounceMs);
}

// -------------------- 状态栏 --------------------
function setStatusBarTextAndTooltip() {
    if (!statusBarItem) { return; }
    if (!currentDocPath) { statusBarItem.hide(); return; }

    const { bucketSizeMs, largeApproximate } = getConfig();
    const st = docStates.get(currentDocPath);

    // —— 字数统计展示（保持你现有的逻辑） ——
    let fullStats: TextStats | undefined = st?.lastFullStats;
    let displayTotal = st?.lastCount || 0;
    let approxFlag = false;
    if (st?.isLarge && largeApproximate) {
        if (st.pendingDelta && st.pendingDelta !== 0) { displayTotal = st.lastCount + st.pendingDelta; }
        approxFlag = true;
    }
    if (!fullStats) {
        fullStats = { cjkChars: 0, asciiChars: 0, words: 0, nonWSChars: 0, total: displayTotal };
    }

    // —— CPM & 累计用时计算 ——
    const fsEntry = getFileStats(currentDocPath);

    // ✅ 把“进行中的会话时长”叠加到累计用时里（会话未结束时也正确增长）
    let effectiveMillis = fsEntry.totalMillis;
    if (currentSessionStart > 0 && !isIdle) {
        // 面板激活时我们没有结束会话，这里同样要把这段时间算进去
        effectiveMillis += (Date.now() - currentSessionStart);
    }

    const cpmNow = calcCurrentCPM(fsEntry, bucketSizeMs);
    const cpmAvg = calcAverageCPM(fsEntry);
    const cpmPeak = calcPeakCPM(fsEntry, bucketSizeMs);
    const cphNow = cpmNow * 60;
    const cphAvg = cpmAvg * 60;
    const cphPeak = cpmPeak * 60;

    // 分钟 + mm:ss
    const minutes = Math.floor(effectiveMillis / 60000);
    const seconds = Math.floor((effectiveMillis % 60000) / 1000);
    const mmss = `${String(Math.floor(effectiveMillis / 60000)).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

    // —— 状态栏文字 —— 
    const idleIndicator = isIdle ? ' 💤' : '🖋️';
    const approxMark = approxFlag ? '≈' : '';
    const wcCfg = vscode.workspace.getConfiguration('AndreaNovelHelper.wordCount');
    const speedUnit = wcCfg.get<string>('statusBar.speedUnit', 'cpm') ?? 'cpm';
    const modeRaw = wcCfg.get<string>('statusBar.mode', 'detailed');
    const compactFallback = wcCfg.get<boolean>('statusBar.compact', false) ?? false;
    const mode = modeRaw || (compactFallback ? 'compact' : 'detailed');
    const now = speedUnit === 'cph' ? cphNow : cpmNow;
    const avg = speedUnit === 'cph' ? cphAvg : cpmAvg;
    const peak = speedUnit === 'cph' ? cphPeak : cpmPeak;
    const unitLabel = speedUnit === 'cph' ? 'CPH' : 'CPM';

    // 字数统计
    const primaryUnit = wcCfg.get<string>('primaryUnit', 'excludePunct');
    const wordCount = primaryUnit === 'includePunct' ? fullStats.nonWSChars : displayTotal;

    if (mode === 'compact') {
        statusBarItem.text = `$(edit) 总计 ${approxMark}${wordCount}字${idleIndicator}`;
    } else if (mode === 'semi') {
        statusBarItem.text = `速度 ${now} ${unitLabel} · 总计 ${approxMark}${wordCount}字 ${idleIndicator}`;
    } else {
        statusBarItem.text = `${now}/${avg}/${peak} ${unitLabel} · ${minutes} min (${mmss}) · CJK ${fullStats.cjkChars} 字 ROMA ${fullStats.words} 词  总计 ${approxMark}${wordCount} ${idleIndicator}`;
    }
    // —— Tooltip —— 
    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = true;
    md.appendMarkdown(
        [
            `**当前速度**：${cpmNow} 字/分钟 | ${cphNow} 字/小时`,
            `**平均速度**：${cpmAvg} 字/分钟 | ${cphAvg} 字/小时`,
            `**峰值速度**：${cpmPeak} 字/分钟 | ${cphPeak} 字/小时`,
            `**累计用时**：${minutes} 分钟（${mmss}）`,
            currentSessionStart > 0 && !isIdle
                ? `**当前会话**：已持续 ${Math.floor((Date.now() - currentSessionStart) / 1000)} 秒`
                : `**当前会话**：未进行或已暂停`,
            `**中文字符**：${fullStats.cjkChars}${approxFlag ? ' (近似可能滞后)' : ''}`,
            `**英文单词**：${fullStats.words}${approxFlag ? ' (近似可能滞后)' : ''}`,
            `**当前字数**：${approxMark}${wordCount}${approxFlag ? ' (估算/待校准)' : ''} ${primaryUnit === 'includePunct' ? '（含标点，按字符计）' : '（不含标点，数字按单词计）'}`,
            `**文件路径**：${currentDocPath}`,
            `**最后活动时间**：${new Date(fsEntry.lastSeen).toLocaleString()}`,
            `**会话数**：${fsEntry.sessions.length}`,
            `**状态**：${isIdle ? '离开' : '活跃'}`
        ].join('\n\n')
    );
    statusBarItem.tooltip = md;
    statusBarItem.show();
}

function updateStatusBar() {
    setStatusBarTextAndTooltip();
}

// -------------------- 事件 --------------------
function handleTextChange(e: vscode.TextDocumentChangeEvent) {
    const { enabledLanguages, idleThresholdMs, pasteThresholdChars } = getConfig();
    const doc = e.document;
    if (!enabledLanguages.includes(doc.languageId)) {
        tsDebug('textChange:skip-lang', { file: doc.uri.fsPath, lang: doc.languageId, enabledLanguages });
        return;
    }
    const effectiveDoc = getEffectiveDocumentSync() ?? vscode.window.activeTextEditor?.document;
    if (!effectiveDoc || effectiveDoc !== doc) {
        return;
    }
    if (!windowFocused) {
        return;
    }

    // .wcignore 影响：若启用并匹配忽略，直接不统计
    // 若被忽略：不进入全局写作统计，但仍允许记录到 ignored 分片（flush 时处理）
    const ignored = isFileIgnoredForTimeStats(doc.uri.fsPath);
    if (ignored) {
        // 保持 currentDocPath 为空，使状态栏不显示；仍跟踪去抖缓存以得到增量
        if (currentDocPath === doc.uri.fsPath) {
            endSession();
            currentDocPath = undefined;
        }
    }

    if (!ignored) {
        // 如果之前有忽略聚合会话，先结束它
        endIgnoredAggregateSession();
        currentDocPath = doc.uri.fsPath;
        startSession();
    } else {
        // 忽略文件：如果没有聚合会话则开启
        if (ignoredAggregateSessionStart === 0) { ignoredAggregateSessionStart = now(); }
    }

    // 根据配置决定是否退出空闲状态
    if (checkExitIdle('text-change')) {
        resetIdleTimer(idleThresholdMs);
    } else {
        // 不退出空闲状态，但仍然重置定时器
        if (idleTimer) {
            clearTimeout(idleTimer);
        }
        idleTimer = setTimeout(() => {
            console.log('TimeStats: User is now idle, stopping bucket creation');
            isIdle = true;
            endSession();
            updateStatusBar();
        }, idleThresholdMs);
    }

    // 关键：去抖，等待 IME 稳定后统一计算净增量（大文件采用增量估算）
    const st = getOrInitDocState(doc);
    if (e.contentChanges.length) {
        let deltaSum = 0;
        let pasteDeltaSum = 0;
        for (const c of e.contentChanges) {
            const added = c.text.length;
            const removed = (c as any).rangeLength !== undefined ? (c as any).rangeLength : c.range.end.character - c.range.start.character;
            const changeDelta = added - removed;
            deltaSum += changeDelta;
            const looksLikePaste = added >= pasteThresholdChars || (c.text.indexOf('\n') >= 0);
            if (looksLikePaste) {
                pasteDeltaSum += Math.max(0, changeDelta);
            }
        }
        if (pasteDeltaSum) {
            st.pendingPasteDelta = (st.pendingPasteDelta || 0) + pasteDeltaSum;
        }
        if (st.isLarge) {
            st.pendingDelta = (st.pendingDelta || 0) + deltaSum;
            st.approxChanges = (st.approxChanges || 0) + 1;
            tsDebug('textChange:largeAccum', { file: doc.uri.fsPath, deltaSum, pendingDelta: st.pendingDelta, approxChanges: st.approxChanges, pasteDeltaSum });
        }
    }
    scheduleFlush(doc);
}

function handleActiveEditorChange(editor: vscode.TextEditor | undefined) {
    const { idleThresholdMs } = getConfig();

    // 预览（任意 webview）抢焦点：activeTextEditor 会变成 undefined。
    // 这不是“无活动编辑器”，不要结算会话。
    if (!editor && isAnyPanelActive()) {
        if (isAnyPreviewActive()) {
            suspendedByPreview = true;
        }
        if (isAnyCommentPanelActive()) {
            suspendedByCommentPanel = true;
        }
        updateStatusBar();
        return;
    }

    // 跳过输出面板、调试控制台等非文件类型的文档
    if (editor?.document?.uri.scheme === 'output' || 
        editor?.document?.uri.scheme === 'debug' || 
        editor?.document?.uri.scheme === 'vscode') {
        currentDocPath = undefined;
        currentDocUuid = undefined;
        updateStatusBar();
        return;
    }

    const newPath = editor?.document?.uri.fsPath;
    const sameDoc = !!(newPath && currentDocPath && newPath === currentDocPath);

    // 仅在“真的切到别的文件/关闭编辑器”时，才冲刷并结束旧会话
    // if (!sameDoc && currentDocPath) {
    //     const oldDoc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === currentDocPath);
    //     if (oldDoc) { flushDocStats(oldDoc); }
    //     endSession();
    // }
    // 仅在“真的切到别的文件/关闭编辑器”时，才冲刷并结束旧会话。
    // 注意：从预览回到同文件的竞态里，可能暂时判断为 !sameDoc，此时若仍处于预览挂起态就不要结算。
    if (!sameDoc && currentDocPath) {
        if (suspendedByPreview || suspendedByCommentPanel || isAnyPanelActive()) {
            // 这是预览/批注→编辑器切换过程中的竞态，先不动会话，稍后 sameDoc 分支会接手续会。
            tsDebug('panel-return:skip-end-on-race', { currentDocPath, newPath, suspendedByPreview, suspendedByCommentPanel });
        } else {
            const oldDoc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === currentDocPath);
            if (oldDoc) { flushDocStats(oldDoc); }
            endSession();
        }
    }

    // 没有任何编辑器（且也没有预览活跃）：清空状态即可
    if (!editor) {
        currentDocPath = undefined;
        currentDocUuid = undefined;
        updateStatusBar();
        return;
    }

    // 非启用语言：不进入统计
    const langOk = getConfig().enabledLanguages.includes(editor.document.languageId);
    if (!langOk) {
        currentDocPath = undefined;
        currentDocUuid = undefined;
        updateStatusBar();
        return;
    }

    const ignored = isFileIgnoredForTimeStats(editor.document.uri.fsPath);

    // 从预览回到“同一个文件”：接续会话，不结束/重开
    // if (sameDoc && suspendedByPreview) {
    if (sameDoc && (suspendedByPreview || suspendedByCommentPanel) && !isAnyPanelActive()) {
        suspendedByPreview = false;
        suspendedByCommentPanel = false;
        if (!ignored && checkExitIdle('editor-change')) {
            resetIdleTimer(idleThresholdMs);
        }
        updateStatusBar();
        return;
    }

    // 到这里说明：第一次进入文件 或者 真正切换到另一个文件
    if (!ignored) {
        endIgnoredAggregateSession();
        currentDocPath = editor.document.uri.fsPath;
    } else {
        currentDocPath = undefined;
        if (ignoredAggregateSessionStart === 0) { ignoredAggregateSessionStart = now(); }
    }

    const g = getGlobalFileTracking?.();
    currentDocUuid = (g && currentDocPath) ? g.getFileUuid(currentDocPath) : undefined;

    // 初始化基线计数（即使忽略也初始化，以便 ignored 统计）
    getOrInitDocState(editor.document);

    if (!ignored) { startSession(); }

    // 根据配置决定是否退出空闲状态
    if (!ignored && checkExitIdle('editor-change')) {
        resetIdleTimer(idleThresholdMs);
    } else {
        if (idleTimer) { clearTimeout(idleTimer); }
        idleTimer = setTimeout(() => {
            console.log('TimeStats: User is now idle, stopping bucket creation');
            isIdle = true;
            endSession();
            endIgnoredAggregateSession();
            updateStatusBar();
        }, idleThresholdMs);
    }

    updateStatusBar();
}


function handleWindowStateChange(state: vscode.WindowState) {
    windowFocused = state.focused;
    if (!windowFocused) {
        console.log('TimeStats: Window lost focus, entering idle state');
        isIdle = true; // 窗口失焦时进入空闲状态
        if (currentDocPath) {
            const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === currentDocPath);
            if (doc) {
                flushDocStats(doc); // 失焦时冲刷
            }
        }
        endSession();
        endIgnoredAggregateSession();
        updateStatusBar();
    } else {
        console.log('TimeStats: Window gained focus');
        const { idleThresholdMs } = getConfig();
        if (currentDocPath) {
            startSession();

            // 根据配置决定是否退出空闲状态
            if (checkExitIdle('window-focus')) {
                console.log('TimeStats: Exiting idle state due to window focus');
                resetIdleTimer(idleThresholdMs);
            } else {
                console.log('TimeStats: Window focused but staying idle until configured trigger');
                // 不退出空闲状态，启动定时器但保持空闲
                if (idleTimer) {
                    clearTimeout(idleTimer);
                }
                idleTimer = setTimeout(() => {
                    console.log('TimeStats: User is now idle, stopping bucket creation');
                    isIdle = true;
                    endSession();
                    endIgnoredAggregateSession();
                    updateStatusBar();
                }, idleThresholdMs);
            }

            updateStatusBar();
        }
    }
}
function handleDocumentSave(doc: vscode.TextDocument) {
    const filePath = doc.uri.fsPath;
    const g = getGlobalFileTracking?.();
    if (g) {
        // 标记文件为已保存（不再是临时文件）
        g.markAsSaved(filePath);
        console.log('TimeStats: Marked file as saved:', filePath);
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
async function setupDashboardPanel(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
    // 允许脚本 & 本地资源
    panel.webview.options = {
        enableScripts: true,
        localResourceRoots: [
            vscode.Uri.file(path.join(context.extensionPath, 'media')),
            vscode.Uri.file(path.join(context.extensionPath, 'node_modules'))
        ]
    };

    const htmlPath = path.join(context.extensionPath, 'media', 'time-stats.html');
    let html = fs.readFileSync(htmlPath, 'utf8');

    // 生成 webview 可访问的 URI
    const scriptUri = panel.webview.asWebviewUri(
        vscode.Uri.file(path.join(context.extensionPath, 'media', 'time-stats.js'))
    );
    const chartjsUri = panel.webview.asWebviewUri(
        vscode.Uri.file(path.join(context.extensionPath, 'node_modules', 'chart.js', 'dist', 'chart.umd.js'))
    );
    const chartAdapterUri = panel.webview.asWebviewUri(
        vscode.Uri.file(path.join(
            context.extensionPath,
            'node_modules',
            'chartjs-adapter-date-fns',
            'dist',
            'chartjs-adapter-date-fns.bundle.js'
        ))
    );

    // 替换占位符
    html = html
        .replace(/%CSP_SOURCE%/g, panel.webview.cspSource)
        .replace(/%SCRIPT_URI%/g, scriptUri.toString())
        .replace(/%CHARTJS_URI%/g, chartjsUri.toString())
        .replace(/%ADAPTER_URI%/g, chartAdapterUri.toString());

    panel.webview.html = html;

    // 消息通道
    const getStatsData = async () => {
        tsDebug('API called to get stats data');

        // 准备数据：当前文件 + 跨文件（若可）
        const { bucketSizeMs } = getConfig();

        // 当前文件的速度曲线数据
        let perFileLine: { t: number; cpm: number }[] = [];

        if (currentDocPath) {
            const fileStats = getFileStats(currentDocPath);
            tsDebug('Current file stats:', {
                path: currentDocPath,
                totalMillis: fileStats.totalMillis,
                charsAdded: fileStats.charsAdded,
                bucketsCount: fileStats.buckets.length,
                sessionsCount: fileStats.sessions.length,
                buckets: fileStats.buckets.slice(0, 3) // 显示前3个桶
            });

            perFileLine = fileStats.buckets
                .slice()
                .sort((a, b) => a.start - b.start)
                .map(b => ({ t: b.start, cpm: Math.round((b.charsAdded * 60000) / bucketSizeMs) }));
        } else {
            tsDebug('No current document, using empty per-file line data');
        }

        tsDebug('Per file line data:', perFileLine.slice(0, 5)); // 显示前5个数据点

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

        tsDebug('Global file tracking available:', !!globalFileTracking);

        // if (globalFileTracking && typeof globalFileTracking.getAllWritingStats === 'function') {
        //     try {
        //         allStats = globalFileTracking.getAllWritingStats(); // 使用新的方法
        //         globalCapable = true;
        //         console.log('TimeStats: Successfully retrieved', allStats.length, 'file stats from global tracking');
        //     } catch (error) {
        //         console.log('TimeStats: Failed to get all writing stats:', error);
        //     }
        // }
        // 优先走异步全局统计，避免阻塞 UI 线程
        try {
            const asyncStats = await getAllWritingStatsAsync();
            if (Array.isArray(asyncStats)) {
                allStats = asyncStats;
                globalCapable = true;
            }
        } catch (error) {
            // 异步接口不可用或失败时再尝试同步回退（兼容老版本）
            if (globalFileTracking && typeof globalFileTracking.getAllWritingStats === 'function') {
                try {
                    allStats = globalFileTracking.getAllWritingStats();
                    globalCapable = true;
                } catch {/* ignore */ }
            }
        }

        if (!globalCapable) {
            // 降级：只用当前文件（如果有的话）
            if (currentDocPath) {
                const fileStats = getFileStats(currentDocPath);
                allStats = [{
                    filePath: currentDocPath,
                    totalMillis: fileStats.totalMillis,
                    charsAdded: fileStats.charsAdded,
                    lastActiveTime: fileStats.lastSeen,
                    buckets: fileStats.buckets,
                    sessions: fileStats.sessions,
                }];
            } else {
                // 没有当前文件，使用空数据
                allStats = [];
                tsDebug('No current document and no global tracking, using empty stats');
            }
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

        tsDebug('Generated stats data:', {
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
        async message => {
            tsDebug('Received message from webview:', message);

            if (message.type === 'get-stats-data') {
                tsDebug('API request for stats data');
                const data = await getStatsData();
                // 总是返回数据，即使没有当前文档也显示全局统计
                panel.webview.postMessage(data);
            }
        },
        undefined,
        context.subscriptions
    );

    // 关闭时清空引用
    panel.onDidDispose(() => {
        dashboardPanel = undefined;
        try { setActivePreview(undefined); } catch { }
    });

    // 当 dashboard 获得焦点时，把 effective document 指向当前 timeStats 的 currentDocPath（若有）
    panel.onDidChangeViewState(e => {
        try {
            if (e.webviewPanel.active) {
                if (currentDocPath) {
                    // ✅ 改成 URI 字符串
                    setActivePreview(vscode.Uri.file(currentDocPath).toString());
                } else {
                    setActivePreview(undefined);
                }
            } else {
                setActivePreview(undefined);
            }
        } catch { /* ignore */ }
    }, undefined, context.subscriptions);

}

// 修改 openDashboard 以复用 setupDashboardPanel，并缓存 panel 引用
async function openDashboard(context: vscode.ExtensionContext) {
    if (dashboardPanel) {
        dashboardPanel.reveal(vscode.ViewColumn.Beside, true);
        return;
    }

    // 可以在没有活动文件时也打开面板（面板里会显示提示）
    dashboardPanel = vscode.window.createWebviewPanel(
        'timeStatsDashboard',
        '写作统计仪表板',
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
        { enableScripts: true }
    );

    await setupDashboardPanel(dashboardPanel, context);
}

// -------------------- 激活/反激活 --------------------
export function activateTimeStats(context: vscode.ExtensionContext) {
    // 确保只保留一个状态栏条目
    function createOrRecreateStatusBarItem() {
        if (statusBarItem) {
            statusBarItem.dispose();
        }
        const cfg = getConfig();
        const alignment = cfg.statusBarAlignment === 'right' ? vscode.StatusBarAlignment.Right : vscode.StatusBarAlignment.Left;
        statusBarItem = vscode.window.createStatusBarItem('andrea.timeStats', alignment, cfg.statusBarPriority);
    statusBarItem.name = '时间统计';
    statusBarItem.command = 'AndreaNovelHelper.openTimeStats';
        context.subscriptions.push(statusBarItem!);
        updateStatusBar();
    }
    createOrRecreateStatusBarItem();

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
        vscode.workspace.onDidSaveTextDocument(handleDocumentSave),
        vscode.workspace.onDidRenameFiles(handleRename),
        vscode.commands.registerCommand('AndreaNovelHelper.openTimeStats', async () => {
            try {
                await openDashboard(context);
            } catch (error) {
                console.log('TimeStats: Failed to open dashboard:', error);
                vscode.window.showErrorMessage('无法打开写作统计仪表板');
            }
        }),
        vscode.commands.registerCommand('AndreaNovelHelper.exportTimeStatsCSV', () => exportStatsCSV(context)),
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('AndreaNovelHelper.timeStats.statusBar.alignment') ||
                e.affectsConfiguration('AndreaNovelHelper.timeStats.statusBar.priority') ||
                e.affectsConfiguration('AndreaNovelHelper.timeStats.respectWcignore') ||
                e.affectsConfiguration('AndreaNovelHelper.wordCount.statusBar.speedUnit') ||
                e.affectsConfiguration('AndreaNovelHelper.wordCount.statusBar.compact') ||
                e.affectsConfiguration('AndreaNovelHelper.wordCount.statusBar.mode')) {
                if (e.affectsConfiguration('AndreaNovelHelper.timeStats.respectWcignore')) {
                    // 重置忽略解析器以便重新加载规则
                    combinedIgnoreParser = undefined;
                }
                createOrRecreateStatusBarItem();
                // 重新评估当前活动文件
                handleActiveEditorChange(vscode.window.activeTextEditor);
            }
        })
    );

    // 监听 preview -> effective document 改变
    try {
        const disp = onDidChangeEffectiveDocument(uri => {
            try {
                if (!uri) {
                    // 只有当“没有任何预览活跃”时，才回退到 VS Code 的活动编辑器
                    if (!isAnyPreviewActive()) {
                        handleActiveEditorChange(vscode.window.activeTextEditor);
                    }
                    return;
                }

                const doc = vscode.workspace.textDocuments.find(d =>
                    d.uri.toString() === uri || d.uri.fsPath === uri
                );

                if (doc) {
                    handleActiveEditorChange({ document: doc } as vscode.TextEditor);
                } else {
                    // 找不到文档时不要清空当前状态；保持现状即可
                    updateStatusBar();
                }
            } catch { /* ignore */ }
        });
        context.subscriptions.push(disp);

    } catch { /* ignore */ }

    // 注册反序列化器：支持 VS Code 重启后恢复面板
    if (vscode.window.registerWebviewPanelSerializer) {
        const serializer = {
            async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: any) {
                dashboardPanel = panel;
                panel.title = '写作统计仪表板';
                await setupDashboardPanel(panel, context);
            }
        } as vscode.WebviewPanelSerializer;
        context.subscriptions.push(
            vscode.window.registerWebviewPanelSerializer('timeStatsDashboard', serializer)
        );
    }

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
