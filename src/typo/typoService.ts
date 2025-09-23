import * as vscode from 'vscode';
import { detectTyposBatch } from './typoDetector';
import { onTypoConfigChanged } from './typoHttp';
import { getDocDB, getParagraphResult, resetParagraphs, setParagraphResult, clearDocDB, pruneStoreToLimit, getDocDBSync, getParagraphResultSync, setParagraphResultSync, resetParagraphsSync, clearDocDBSync } from './typoDB';
import { ParagraphPiece, SentencePiece, TypoDiagnosticsApplyOptions, ParagraphScanResult, ParagraphTypoError } from './typoTypes';
import { getDocumentRoleOccurrences } from '../context/documentRolesCache';
import { Role } from '../extension';
import { registerClientLLMDetector } from './typoClientLLM';

// Sentence boundaries for Chinese + general punctuation; newline also ends a sentence
const SENTENCE_ENDERS = new Set(['。', '！', '？', '!', '?']);

function hashString(s: string): string {
    // Lightweight 32-bit FNV-1a
    let h = 0x811c9dc5 >>> 0;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
}

function splitIntoParagraphs(text: string): ParagraphPiece[] {
    const paras: ParagraphPiece[] = [];
    let start = 0;
    const len = text.length;
    let i = 0;
    function isBlankLine(line: string): boolean {
        return /^\s*$/.test(line);
    }
    let lineStart = 0;
    for (let pos = 0; pos <= len; pos++) {
        // detect line breaks
        if (pos === len || text.charCodeAt(pos) === 10 /*\n*/ || text.charCodeAt(pos) === 13 /*\r*/) {
            const line = text.slice(lineStart, pos);
            const isBlank = isBlankLine(line);
            // End of file or blank line ends a paragraph
            if (isBlank || pos === len) {
                const paraEnd = pos === len ? pos : lineStart; // if blank, paragraph ends before blank line
                if (paraEnd > start) {
                    const paraText = text.slice(start, paraEnd);
                    paras.push({
                        text: paraText,
                        startOffset: start,
                        endOffset: paraEnd,
                        hash: hashString(paraText),
                        sentences: []
                    });
                }
                // Skip consecutive blank lines
                lineStart = pos;
                // Advance past CRLF pairs
                // Normalize: if CRLF, we will process next loop
                // Reset next paragraph start after this blank line
                start = pos + (pos < len && text.charCodeAt(pos) === 13 && text.charCodeAt(pos + 1) === 10 ? 2 : 1);
                // Also move lineStart to next char after newline(s)
                lineStart = start;
                pos = start - 1; // because loop will ++
                continue;
            } else {
                // continue paragraph, move to next line
                lineStart = pos + 1;
            }
        }
    }

    // Fallback for text without trailing newline and not captured above
    if (start < len) {
        const paraText = text.slice(start);
        if (paraText.trim().length > 0) {
            paras.push({
                text: paraText,
                startOffset: start,
                endOffset: len,
                hash: hashString(paraText),
                sentences: []
            });
        }
    }
    return paras;
}

function splitIntoSentences(para: ParagraphPiece): SentencePiece[] {
    if (para.sentences && para.sentences.length) return para.sentences;
    const sents: SentencePiece[] = [];
    const t = para.text;
    let start = 0;
    for (let i = 0; i < t.length; i++) {
        const ch = t[i];
        if (SENTENCE_ENDERS.has(ch) || ch === '\n') {
            const end = i + 1;
            if (end > start) {
                const text = t.slice(start, end);
                sents.push({ text, startOffset: para.startOffset + start, endOffset: para.startOffset + end });
            }
            start = end;
        }
    }
    if (start < t.length) {
        const text = t.slice(start);
        if (text.trim().length > 0) {
            sents.push({ text, startOffset: para.startOffset + start, endOffset: para.startOffset + t.length });
        }
    }
    para.sentences = sents;
    return sents;
}

function computeBestOffset(sentence: string, wrong: string, correct?: string, target?: string, hint?: number): number | null {
    // 1) If hint valid and matches
    if (typeof hint === 'number' && hint >= 0 && hint + wrong.length <= sentence.length) {
        if (sentence.slice(hint, hint + wrong.length) === wrong) return hint;
    }
    // 2) Exact find all candidates
    const idxs: number[] = [];
    let pos = sentence.indexOf(wrong);
    while (pos >= 0) { idxs.push(pos); pos = sentence.indexOf(wrong, pos + 1); }
    if (idxs.length === 1) return idxs[0];
    if (idxs.length > 1 && typeof target === 'string' && correct) {
        // Pick the one leading to target when replaced once
        for (const i of idxs) {
            const tmp = sentence.slice(0, i) + correct + sentence.slice(i + wrong.length);
            if (tmp === target) return i;
        }
        // Otherwise pick first
        return idxs[0];
    }
    if (idxs.length > 0) return idxs[0];
    // 3) Fallback: simple approximate by scanning substrings of same length and picking minimal Hamming distance
    const L = wrong.length;
    if (L === 0 || L > sentence.length) return null;
    let bestI = -1, bestD = Number.MAX_SAFE_INTEGER;
    for (let i = 0; i + L <= sentence.length; i++) {
        let d = 0; for (let k = 0; k < L; k++) if (sentence.charCodeAt(i + k) !== wrong.charCodeAt(k)) d++;
        if (d < bestD) { bestD = d; bestI = i; if (d === 0) break; }
    }
    return bestI >= 0 ? bestI : null;
}

async function scanParagraphGroup(group: ParagraphPiece[], doc: vscode.TextDocument): Promise<Map<string, ParagraphScanResult>> {
    const allSentences: { para: ParagraphPiece; s: SentencePiece; idxInPara: number }[] = [];
    for (const para of group) {
        const sents = splitIntoSentences(para);
        for (let i = 0; i < sents.length; i++) {
            allSentences.push({ para, s: sents[i], idxInPara: i });
        }
    }
    const texts = allSentences.map(x => x.s.text);
    // Prepare role names context: exclude 正则表达式 and 敏感词
    let roleNamesCtx: string[] | undefined = undefined;
    try {
        const occ = getDocumentRoleOccurrences(doc);
        if (occ) {
            const names = new Set<string>();
            for (const [role] of occ.entries()) {
                const t = (role as Role).type;
                if (t === '正则表达式' || t === '敏感词') continue;
                if (role.name) names.add(role.name);
            }
            if (names.size) roleNamesCtx = Array.from(names);
        }
    } catch { /* ignore */ }
    const perPara = new Map<string, ParagraphScanResult>();
    const appliedSignatures = new Map<number, Set<string>>(); // sentenceIndex -> sigs
    const applyCorrections = async (corrs: import('./typoTypes').TypoApiResult[]) => {
        for (let i = 0; i < corrs.length; i++) {
            const r = corrs[i];
            const idx = typeof r?.index === 'number' ? r.index : i;
            if (idx < 0 || idx >= allSentences.length) continue;
            const { para, s } = allSentences[idx];
            const key = para.hash;
            let rec = perPara.get(key);
            if (!rec) {
                rec = { paragraphHash: para.hash, scannedAt: Date.now(), paragraphTextSnapshot: para.text, errors: [] };
                perPara.set(key, rec);
            }
            const seen = appliedSignatures.get(idx) || new Set<string>();
            appliedSignatures.set(idx, seen);
            for (const tuple of r.errors || []) {
                const wrong = tuple?.[0]; const correct = tuple?.[1];
                const hint = typeof tuple?.[2] === 'number' ? tuple[2] : undefined;
                const score = typeof tuple?.[3] === 'number' ? tuple[3] : undefined;
                if (!wrong || !correct) continue;
                // 先计算位置，再基于位置构建签名，确保与最终结果聚合一致，从源头去重
                const offInSentence = computeBestOffset(s.text, wrong, correct, (r as any).target || undefined, hint);
                if (offInSentence === null) continue;
                const offInPara = (s.startOffset - para.startOffset) + offInSentence;
                const sig = `${wrong}@${correct}@${hint ?? -1}@${offInPara}`;
                if (seen.has(sig)) continue;
                rec.errors.push({ wrong, correct, offset: offInPara, length: wrong.length, score });
                seen.add(sig);
            }
        }
        const docKey = doc.uri.toString();
        for (const [_, res] of perPara) { 
        try {
            await setParagraphResult(docKey, res, doc);
        } catch {
            // 如果异步失败，使用同步版本作为后备
            setParagraphResultSync(docKey, res);
        }
    }
        // 流式装饰：在接收到部分结果时通过装饰器管理器应用装饰
        enqueueApply(doc);
    };
    const results = await detectTyposBatch(texts, { docFsPath: doc.uri.fsPath, docUri: doc.uri.toString(), roleNames: roleNamesCtx, onPartial: applyCorrections });
    
    for (let i = 0; i < allSentences.length; i++) {
        const { para, s } = allSentences[i];
        const key = para.hash;
        let rec = perPara.get(key);
        if (!rec) {
            rec = { paragraphHash: para.hash, scannedAt: Date.now(), paragraphTextSnapshot: para.text, errors: [] };
            perPara.set(key, rec);
        }
        const r = results[i];
        if (!r || !Array.isArray(r.errors) || r.errors.length === 0) continue;
        // 与 partial 路径共用签名集合，避免“partial + final”重复
        const seen = appliedSignatures.get(i) || new Set<string>();
        appliedSignatures.set(i, seen);
        for (const tuple of r.errors) {
            const wrong = tuple?.[0];
            const correct = tuple?.[1];
            const hint = typeof tuple?.[2] === 'number' ? tuple[2] : undefined;
            const score = typeof tuple?.[3] === 'number' ? tuple[3] : undefined;
            if (!wrong || !correct) continue;
            const offInSentence = computeBestOffset(s.text, wrong, correct, (r as any).target || undefined, hint);
            if (offInSentence === null) continue;
            const offInPara = (s.startOffset - para.startOffset) + offInSentence;
            const sig = `${wrong}@${correct}@${hint ?? -1}@${offInPara}`;
            if (seen.has(sig)) continue;
            rec.errors.push({ wrong, correct, offset: offInPara, length: wrong.length, score });
            seen.add(sig);
        }
    }
    return perPara;
}

async function createDiagnosticsForDoc(doc: vscode.TextDocument, options: TypoDiagnosticsApplyOptions) {
    if (!typoFeatureEnabled() || doc.isClosed) {
        options.diagnosticCollection.delete(doc.uri);
        clearDocDecorations(doc);
        updateStatusBar();
        return;
    }
    const docKey = doc.uri.toString();
    let db;
    try {
        db = await getDocDB(docKey, doc);
    } catch {
        // 如果异步失败，使用同步版本作为后备
        db = getDocDBSync(docKey);
    }
    const text = doc.getText();
    const paras = splitIntoParagraphs(text);

    const diagnostics: vscode.Diagnostic[] = [];
    const typoRanges: vscode.Range[] = [];
    const currentHashes = new Set<string>();
    const roleMap = getDocumentRoleOccurrences(doc);
    for (const p of paras) {
        currentHashes.add(p.hash);
        let res;
        try {
            res = await getParagraphResult(docKey, p.hash, doc);
        } catch {
            // 如果异步失败，使用同步版本作为后备
            res = getParagraphResultSync(docKey, p.hash);
        }
        if (!res || !res.errors?.length) continue;
        for (const e of res.errors) {
            const absStart = p.startOffset + e.offset;
            const absEnd = absStart + e.length;
            const range = new vscode.Range(doc.positionAt(absStart), doc.positionAt(absEnd));
            // Suppress when inside any non-sensitive role occurrence to avoid interference
            if (roleMap) {
                let coveredByNonSensitive = false;
                for (const [role, ranges] of roleMap.entries()) {
                    if ((role as Role).type === '敏感词') continue;
                    for (const r of ranges) { if (r.intersection(range)) { coveredByNonSensitive = true; break; } }
                    if (coveredByNonSensitive) break;
                }
                if (coveredByNonSensitive) continue;
            }
            const msg = `错别字: ${e.wrong} → ${e.correct}`;
            const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
            const warningLevel = cfg.get<string>('typo.warningLevel', 'information');
            let severity: vscode.DiagnosticSeverity;
            switch (warningLevel) {
                case 'error': severity = vscode.DiagnosticSeverity.Error; break;
                case 'warning': severity = vscode.DiagnosticSeverity.Warning; break;
                case 'information': severity = vscode.DiagnosticSeverity.Information; break;
                case 'hint': severity = vscode.DiagnosticSeverity.Hint; break;
                default: severity = vscode.DiagnosticSeverity.Information;
            }
            const diag = new vscode.Diagnostic(range, msg, severity);
            diag.source = 'AndreaNovelHelper Typo';
            (diag as any).anhFixs = [e.correct]; // reuse existing CodeAction provider
            (diag as any).anhSensitiveWord = e.wrong; // label
            diagnostics.push(diag);
            typoRanges.push(range);
        }
    }
    options.diagnosticCollection.set(doc.uri, diagnostics);
    db.lastAppliedDocVersion = doc.version;

    // GC stale paragraph results (paragraphs that no longer exist in current content)
    // Keeps per-document DB bounded while still allowing reuse across minor edits.
    for (const key of Array.from(db.paragraphResults.keys())) {
        if (!currentHashes.has(key)) {
            db.paragraphResults.delete(key);
        }
    }

    // Apply typo highlight decorations for this document using decorator manager
    decoratorManager.requestDecoration(docKey, typoRanges);
    updateStatusBar();
}

const diagnosticCollection = vscode.languages.createDiagnosticCollection('AndreaNovelHelper Typo');
const scanTimers = new Map<string, NodeJS.Timeout>();
const flushTimers = new Map<string, NodeJS.Timeout>();
const applyQueues = new Map<string, Promise<void>>(); // per-doc serial apply queue
const scanningDocs = new Set<string>();

// 全局中止控制器管理
const activeAbortControllers = new Set<AbortController>();
let globalAbortController: AbortController | null = null;

function createAbortController(): AbortController {
    const controller = new AbortController();
    activeAbortControllers.add(controller);
    return controller;
}

function removeAbortController(controller: AbortController) {
    activeAbortControllers.delete(controller);
}

function abortAllRequests() {
    // 中止所有活动的请求
    for (const controller of activeAbortControllers) {
        try {
            controller.abort();
        } catch { /* ignore */ }
    }
    activeAbortControllers.clear();
    
    // 清除所有扫描定时器
    for (const timer of scanTimers.values()) {
        clearTimeout(timer);
    }
    scanTimers.clear();
    
    // 清除扫描状态
    scanningDocs.clear();
    updateStatusBar();
    
    vscode.window.showInformationMessage('已强制停止所有错别字扫描请求');
}

/**
 * 文档装饰器管理器 - 统一管理所有装饰请求，进行去重和批量应用
 */
class DocumentDecoratorManager {
    private pendingDecorations = new Map<string, vscode.Range[]>(); // 待应用的装饰
    private applyTimers = new Map<string, NodeJS.Timeout>(); // 防抖定时器
    private currentDecorations = new Map<string, vscode.Range[]>(); // 当前已应用的装饰
    private readonly debounceMs = 50; // 防抖延迟

    /**
     * 请求应用装饰到文档
     * @param docKey 文档键
     * @param ranges 装饰范围数组
     */
    requestDecoration(docKey: string, ranges: vscode.Range[]) {
        // 更新待应用的装饰
        this.pendingDecorations.set(docKey, ranges);
        
        // 清除现有定时器
        const existingTimer = this.applyTimers.get(docKey);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }
        
        // 设置新的防抖定时器
        const timer = setTimeout(() => {
            this.flushDecorations(docKey);
            this.applyTimers.delete(docKey);
        }, this.debounceMs);
        
        this.applyTimers.set(docKey, timer);
    }
    
    /**
     * 立即应用装饰（跳过防抖）
     * @param docKey 文档键
     */
    flushDecorations(docKey: string) {
        const ranges = this.pendingDecorations.get(docKey);
        if (!ranges) return;
        
        // 获取当前装饰
        const currentRanges = this.currentDecorations.get(docKey) || [];
        
        // 检查是否需要更新（去重逻辑）
        if (rangesEqual(currentRanges, ranges)) {
            return; // 装饰相同，无需更新
        }
        
        // 应用新装饰
        this.applyDecorationsToDocument(docKey, ranges);
        
        // 更新记录
        this.currentDecorations.set(docKey, ranges);
        this.pendingDecorations.delete(docKey);
    }
    
    /**
     * 实际应用装饰到文档
     * @param docKey 文档键
     * @param ranges 装饰范围
     */
    private applyDecorationsToDocument(docKey: string, ranges: vscode.Range[]) {
        const deco = ensureTypoDecorationType();
        if (!deco) return;
        
        // 找到对应的编辑器
        const editors = vscode.window.visibleTextEditors.filter(e => e.document.uri.toString() === docKey);
        
        for (const editor of editors) {
            editor.setDecorations(deco, ranges);
        }
    }
    
    /**
     * 清除文档的所有装饰
     * @param docKey 文档键
     */
    clearDecorations(docKey: string) {
        // 取消待处理的装饰请求
        const timer = this.applyTimers.get(docKey);
        if (timer) {
            clearTimeout(timer);
            this.applyTimers.delete(docKey);
        }
        
        this.pendingDecorations.delete(docKey);
        this.currentDecorations.delete(docKey);
        
        // 清除实际装饰
        this.applyDecorationsToDocument(docKey, []);
    }
    
    /**
     * 清理所有资源
     */
    dispose() {
        // 清除所有定时器
        for (const timer of this.applyTimers.values()) {
            clearTimeout(timer);
        }
        this.applyTimers.clear();
        this.pendingDecorations.clear();
    }
}

// 全局装饰器管理器实例
const decoratorManager = new DocumentDecoratorManager();

let statusItem: vscode.StatusBarItem | null = null;

let typoDeco: vscode.TextEditorDecorationType | null = null;
let typoDecoColor: string | null = null;

function ensureTypoDecorationType(): vscode.TextEditorDecorationType | null {
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    const enabled = cfg.get<boolean>('typo.enableHighlight', true);
    if (!enabled) {
        if (typoDeco) { try { typoDeco.dispose(); } catch { /* ignore */ } typoDeco = null; typoDecoColor = null; }
        return null;
    }
    const color = cfg.get<string>('typo.highlightColor', '#fff3a3');
    if (typoDeco && color === typoDecoColor) return typoDeco;
    if (typoDeco) { try { typoDeco.dispose(); } catch { /* ignore */ } }
    typoDeco = vscode.window.createTextEditorDecorationType({
        backgroundColor: color,
        isWholeLine: false,
        overviewRulerLane: vscode.OverviewRulerLane.Right,
        overviewRulerColor: color + '88'
    });
    typoDecoColor = color;
    return typoDeco;
}

function ensureStatusItem() {
    if (statusItem) return;
    statusItem = vscode.window.createStatusBarItem('andrea.typoService', vscode.StatusBarAlignment.Left, 100);
    statusItem.name = 'Andrea Typo';
    statusItem.tooltip = '错别字识别状态';
    statusItem.command = 'andrea.typo.quickSettings';
}

function updateStatusBar() {
    ensureStatusItem();
    const ed = vscode.window.activeTextEditor;
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    const mode = cfg.get<'macro' | 'llm'>('typo.mode', 'macro');
    const enabled = cfg.get<boolean>('typo.enabled', true);
    const clientLLMEnabled = cfg.get<boolean>('typo.clientLLM.enabled', false);
    const persistenceEnabled = cfg.get<boolean>('typo.persistence.enabled', false);
    
    if (!enabled) { 
        statusItem!.tooltip = '错别字识别已禁用\n点击打开快速设置';
        statusItem!.hide(); 
        return; 
    }
    
    if (!ed || ed.document.uri.scheme !== 'file' || !['markdown', 'plaintext'].includes(ed.document.languageId)) {
        statusItem!.tooltip = '错别字识别\n当前文件类型不支持或无活动编辑器\n点击打开快速设置';
        statusItem!.hide();
        return;
    }
    
    const key = ed.document.uri.toString();
    const busy = scanningDocs.has(key);
    const modeText = mode === 'macro' ? '规则识别' : '大语言模型';
    
    // 构建详细的tooltip信息
    let tooltip = `错别字识别状态\n`;
    tooltip += `模式: ${modeText}\n`;
    tooltip += `状态: ${busy ? '正在扫描...' : '就绪'}\n`;
    
    if (mode === 'llm' && clientLLMEnabled) {
        const apiBase = cfg.get<string>('typo.clientLLM.apiBase', 'https://api.deepseek.com/v1');
        const model = cfg.get<string>('typo.clientLLM.model', 'deepseek-v3');
        tooltip += `客户端直连: 已启用\n`;
        tooltip += `API: ${new URL(apiBase).hostname}\n`;
        tooltip += `模型: ${model}\n`;
    }
    
    tooltip += `数据持久化: ${persistenceEnabled ? '已启用' : '已禁用'}\n`;
    tooltip += `\n点击打开快速设置`;
    
    statusItem!.text = busy ? '$(sync~spin) Typo ' + mode : '$(check) Typo ' + mode;
    statusItem!.tooltip = tooltip;
    statusItem!.show();
}

function typoFeatureEnabled(): boolean {
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    return cfg.get<boolean>('typo.enabled', true) === true;
}

function clearDocDecorations(doc: vscode.TextDocument) {
    const docKey = doc.uri.toString();
    decoratorManager.clearDecorations(docKey);
}

function rangesEqual(ranges1: vscode.Range[], ranges2: vscode.Range[]): boolean {
    if (ranges1.length !== ranges2.length) return false;
    for (let i = 0; i < ranges1.length; i++) {
        const r1 = ranges1[i];
        const r2 = ranges2[i];
        if (!r1.isEqual(r2)) return false;
    }
    return true;
}

async function scheduleScan(doc: vscode.TextDocument, opts?: { force?: boolean }) {
    if (doc.isClosed) return;
    const docKey = doc.uri.toString();
    // debounce per doc
    const prev = scanTimers.get(docKey);
    if (prev) clearTimeout(prev);
    const handle = setTimeout(async () => {
        try {
            if (!typoFeatureEnabled()) {
                // 功能被禁用时，通过enqueueApply统一处理清理逻辑
                enqueueApply(doc);
                return;
            }
            const text = doc.getText();
            const paras = splitIntoParagraphs(text);
            const tasks: Promise<void>[] = [];
            const maxConc = vscode.workspace.getConfiguration('AndreaNovelHelper').get<number>('typo.docConcurrency', 3) || 3;
            const limiter = createLimiter(docKey, maxConc);
            // collect missing paragraphs first
            const missing: ParagraphPiece[] = [];
            for (const p of paras) {
                let exist;
            if (!opts?.force) {
                try {
                    exist = await getParagraphResult(docKey, p.hash, doc);
                } catch {
                    // 如果异步失败，使用同步版本作为后备
                    exist = getParagraphResultSync(docKey, p.hash);
                }
            }
                if (!exist) missing.push(p);
            }
            const groupSize = vscode.workspace.getConfiguration('AndreaNovelHelper').get<number>('typo.docGroupSize', 3) || 3;
            for (let i = 0; i < missing.length; i += Math.max(1, groupSize)) {
                const slice = missing.slice(i, i + Math.max(1, groupSize));
                tasks.push((async () => {
                    await limiter.acquire();
                    const map = await scanParagraphGroup(slice, doc);
                    for (const [_, res] of map) {
                        try {
                        await setParagraphResult(docKey, res, doc);
                    } catch {
                        // 如果异步失败，使用同步版本作为后备
                        setParagraphResultSync(docKey, res);
                    }
                    }
                    limiter.release();
                })());
            }
            if (tasks.length) {
                scanningDocs.add(docKey); updateStatusBar();
                await Promise.all(tasks);
                scanningDocs.delete(docKey); updateStatusBar();
                // 扫描完成后统一应用诊断
                enqueueApply(doc);
            } else {
                // 没有新任务但仍需要应用现有结果
                enqueueApply(doc);
            }
        } catch (e) {
            // no-op
        }
    }, 400);
    scanTimers.set(docKey, handle);
}

export function registerTypoFeature(context: vscode.ExtensionContext) {
    context.subscriptions.push(diagnosticCollection);
    // Optional: enable client-side LLM detector when configured
    try { registerClientLLMDetector(context); } catch { /* ignore */ }

    // Commands: scan & rescan current document
    context.subscriptions.push(
        vscode.commands.registerCommand('andrea.typo.scanDocument', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { vscode.window.showInformationMessage('没有活动编辑器'); return; }
            await scheduleScan(editor.document);
        }),
        vscode.commands.registerCommand('andrea.typo.rescanDocument', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { vscode.window.showInformationMessage('没有活动编辑器'); return; }
            const docKey = editor.document.uri.toString();
            
            // 先清除现有的装饰和诊断，避免新旧装饰叠加
            diagnosticCollection.delete(editor.document.uri);
            clearDocDecorations(editor.document);
            
            try {
                await resetParagraphs(docKey, editor.document);
            } catch {
                // 如果异步失败，使用同步版本作为后备
                resetParagraphsSync(docKey);
            }
            await scheduleScan(editor.document, { force: true });
        }),
        vscode.commands.registerCommand('andrea.typo.rescanCurrentFile', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { vscode.window.showInformationMessage('没有活动编辑器'); return; }
            const docKey = editor.document.uri.toString();
            
            // 先清除当前文件的装饰和诊断，避免新旧装饰叠加
            diagnosticCollection.delete(editor.document.uri);
            clearDocDecorations(editor.document);
            
            // 只清除当前文件的段落缓存，不影响其他文件
            try {
                await resetParagraphs(docKey, editor.document);
            } catch {
                // 如果异步失败，使用同步版本作为后备
                resetParagraphsSync(docKey);
            }
            await scheduleScan(editor.document, { force: true });
            
            vscode.window.showInformationMessage('已重新扫描当前文件的错别字');
        }),
        vscode.commands.registerCommand('andrea.typo.stopAllRequests', () => {
            abortAllRequests();
        })
    );

    // Auto schedule on change for supported docs
    const supported = (doc: vscode.TextDocument) => (
        (doc.languageId === 'markdown' || doc.languageId === 'plaintext') && doc.uri.scheme === 'file'
    );

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(doc => { if (supported(doc)) { scheduleScan(doc); updateStatusBar(); } }),
        vscode.workspace.onDidChangeTextDocument(e => { if (supported(e.document)) { scheduleScan(e.document); updateStatusBar(); } }),
        vscode.workspace.onDidCloseTextDocument(async (doc) => {
            if (supported(doc)) {
                const docKey = doc.uri.toString();
                diagnosticCollection.delete(doc.uri);
                
                // 清理装饰器管理器中的相关数据
                decoratorManager.clearDecorations(docKey);
                
                const keep = vscode.workspace.getConfiguration('AndreaNovelHelper').get<boolean>('typo.keepCacheOnClose', true);
                if (!keep) {
                    // Immediately drop cache if user prefers
                    try {
                        await clearDocDB(docKey, doc);
                    } catch {
                        // 如果异步失败，使用同步版本作为后备
                        clearDocDBSync(docKey);
                    }
                }
                // If keep=true: keep in-memory DB; LRU 会优先淘汰已关闭文档
                updateStatusBar();
            }
        }),
        vscode.workspace.onDidChangeConfiguration(e => {
            if (onTypoConfigChanged(e)) {
                if (!typoFeatureEnabled()) {
                    // Clear all open docs immediately when disabled
                    for (const ed of vscode.window.visibleTextEditors) {
                        if (supported(ed.document)) {
                            diagnosticCollection.delete(ed.document.uri);
                            clearDocDecorations(ed.document);
                        }
                    }
                    // 清理装饰器管理器
                    decoratorManager.dispose();
                } else {
                    // Rescan all visible supported documents to apply new settings
                    for (const ed of vscode.window.visibleTextEditors) {
                        if (supported(ed.document)) scheduleScan(ed.document, { force: true });
                    }
                }
                // Also enforce memory limit change immediately
                pruneStoreToLimit();
                updateStatusBar();
            }
        }),
        vscode.window.onDidChangeActiveTextEditor(() => updateStatusBar())
    );

    // On activation, schedule for all visible supported editors
    for (const ed of vscode.window.visibleTextEditors) {
        if (supported(ed.document)) scheduleScan(ed.document);
    }
    updateStatusBar();
}

function enqueueApply(doc: vscode.TextDocument) {
    const docKey = doc.uri.toString();
    const prev = applyQueues.get(docKey) || Promise.resolve();
    const startVersion = doc.version;
    const task = prev.then(async () => {
        try {
            // createDiagnosticsForDoc内部会检查功能状态和文档状态，统一处理清理逻辑
            await createDiagnosticsForDoc(doc, { diagnosticCollection });
            // If version changed significantly during apply, next queued apply will catch it
        } catch { /* ignore */ }
    });
    applyQueues.set(docKey, task.finally(() => {
        // Keep chain short: if this was the last task, reset chain
        if (applyQueues.get(docKey) === task) {
            applyQueues.set(docKey, Promise.resolve());
        }
    }));
}

function createLimiter(key: string, max: number) {
    const state = limiterStates.get(key) || { active: 0, queue: [] as Array<() => void> };
    limiterStates.set(key, state);
    return {
        acquire() {
            return new Promise<void>((resolve) => {
                if (state.active < Math.max(1, max)) {
                    state.active++;
                    resolve();
                } else {
                    state.queue.push(resolve);
                }
            });
        },
        release() {
            if (state.queue.length > 0) {
                const next = state.queue.shift()!;
                next();
            } else {
                state.active = Math.max(0, state.active - 1);
            }
        }
    };
}

const limiterStates = new Map<string, { active: number; queue: Array<() => void> }>();

// Re-export for external integration convenience
export { setTypoDetector } from './typoDetector';
