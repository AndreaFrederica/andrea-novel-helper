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
                const sig = `${wrong}@${correct}@${hint ?? -1}`;
                if (seen.has(sig)) continue;
                const offInSentence = computeBestOffset(s.text, wrong, correct, (r as any).target || undefined, hint);
                if (offInSentence === null) continue;
                const offInPara = (s.startOffset - para.startOffset) + offInSentence;
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
        for (const tuple of r.errors) {
            const wrong = tuple?.[0];
            const correct = tuple?.[1];
            const hint = typeof tuple?.[2] === 'number' ? tuple[2] : undefined;
            const score = typeof tuple?.[3] === 'number' ? tuple[3] : undefined;
            if (!wrong || !correct) continue;
            const offInSentence = computeBestOffset(s.text, wrong, correct, (r as any).target || undefined, hint);
            if (offInSentence === null) continue;
            const offInPara = (s.startOffset - para.startOffset) + offInSentence;
            rec.errors.push({ wrong, correct, offset: offInPara, length: wrong.length, score });
        }
    }
    return perPara;
}

async function createDiagnosticsForDoc(doc: vscode.TextDocument, options: TypoDiagnosticsApplyOptions) {
    if (!typoFeatureEnabled()) {
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
            const diag = new vscode.Diagnostic(range, msg, vscode.DiagnosticSeverity.Information);
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

    // Apply typo highlight decorations for this document
    const deco = ensureTypoDecorationType();
    for (const ed of vscode.window.visibleTextEditors) {
        if (ed.document.uri.toString() !== doc.uri.toString()) continue;
        if (deco) ed.setDecorations(deco, typoRanges);
        else if (typoDeco) ed.setDecorations(typoDeco, []);
    }
    updateStatusBar();
}

const diagnosticCollection = vscode.languages.createDiagnosticCollection('AndreaNovelHelper Typo');
const scanTimers = new Map<string, NodeJS.Timeout>();
const flushTimers = new Map<string, NodeJS.Timeout>();
const applyQueues = new Map<string, Promise<void>>(); // per-doc serial apply queue
const scanningDocs = new Set<string>();

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
    statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusItem.name = 'Andrea Typo';
    statusItem.tooltip = '错别字识别状态';
}

function updateStatusBar() {
    ensureStatusItem();
    const ed = vscode.window.activeTextEditor;
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    const mode = cfg.get<'macro' | 'llm'>('typo.mode', 'macro');
    const enabled = cfg.get<boolean>('typo.enabled', true);
    if (!enabled) { statusItem!.hide(); return; }
    if (!ed || ed.document.uri.scheme !== 'file' || !['markdown', 'plaintext'].includes(ed.document.languageId)) {
        statusItem!.hide();
        return;
    }
    const key = ed.document.uri.toString();
    const busy = scanningDocs.has(key);
    statusItem!.text = busy ? '$(sync~spin) Typo ' + mode : '$(check) Typo ' + mode;
    statusItem!.show();
}

function typoFeatureEnabled(): boolean {
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    return cfg.get<boolean>('typo.enabled', true) === true;
}

function clearDocDecorations(doc: vscode.TextDocument) {
    if (!typoDeco) return;
    for (const ed of vscode.window.visibleTextEditors) {
        if (ed.document.uri.toString() !== doc.uri.toString()) continue;
        try { ed.setDecorations(typoDeco, []); } catch { /* ignore */ }
    }
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
                diagnosticCollection.delete(doc.uri);
                clearDocDecorations(doc);
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
                    enqueueApply(doc);
                    limiter.release();
                })());
            }
            if (tasks.length) {
                scanningDocs.add(docKey); updateStatusBar();
                await Promise.all(tasks);
                scanningDocs.delete(docKey); updateStatusBar();
            }
            enqueueApply(doc);
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
            try {
                await resetParagraphs(docKey, editor.document);
            } catch {
                // 如果异步失败，使用同步版本作为后备
                resetParagraphsSync(docKey);
            }
            await scheduleScan(editor.document, { force: true });
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
                diagnosticCollection.delete(doc.uri);
                const keep = vscode.workspace.getConfiguration('AndreaNovelHelper').get<boolean>('typo.keepCacheOnClose', true);
                if (!keep) {
                    // Immediately drop cache if user prefers
                    try {
                        await clearDocDB(doc.uri.toString(), doc);
                    } catch {
                        // 如果异步失败，使用同步版本作为后备
                        clearDocDBSync(doc.uri.toString());
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
            if (doc.isClosed || !typoFeatureEnabled()) {
                // When disabled or closed, ensure UI cleared and skip
                diagnosticCollection.delete(doc.uri);
                clearDocDecorations(doc);
                return;
            }
            // Apply latest snapshot; createDiagnosticsForDoc internally recomputes ranges
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
