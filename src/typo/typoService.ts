import * as vscode from 'vscode';
import { detectTyposBatch } from './typoDetector';
import { onTypoConfigChanged } from './typoHttp';
import { getDocDB, getParagraphResult, resetParagraphs, setParagraphResult, clearDocDB, pruneStoreToLimit } from './typoDB';
import { ParagraphPiece, SentencePiece, TypoDiagnosticsApplyOptions, ParagraphScanResult, ParagraphTypoError } from './typoTypes';
import { getDocumentRoleOccurrences } from '../context/documentRolesCache';
import { Role } from '../extension';

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

async function scanParagraph(para: ParagraphPiece): Promise<ParagraphScanResult | null> {
    const sentences = splitIntoSentences(para);
    const texts = sentences.map(s => s.text);
    const results = await detectTyposBatch(texts);
    const errors: ParagraphTypoError[] = [];
    for (let i = 0; i < sentences.length; i++) {
        const r = results[i];
        if (!r || !Array.isArray(r.errors) || r.errors.length === 0) continue;
        const s = sentences[i];
        for (const [wrong, correct, offset, score] of r.errors) {
            const length = wrong?.length ?? 0;
            if (!wrong || !correct || typeof offset !== 'number' || length <= 0) continue;
            const offInPara = (s.startOffset - para.startOffset) + offset;
            errors.push({ wrong, correct, offset: offInPara, length, score });
        }
    }
    return {
        paragraphHash: para.hash,
        scannedAt: Date.now(),
        paragraphTextSnapshot: para.text,
        errors
    };
}

function createDiagnosticsForDoc(doc: vscode.TextDocument, options: TypoDiagnosticsApplyOptions) {
    if (!typoFeatureEnabled()) {
        options.diagnosticCollection.delete(doc.uri);
        clearDocDecorations(doc);
        updateStatusBar();
        return;
    }
    const docKey = doc.uri.toString();
    const db = getDocDB(docKey);
    const text = doc.getText();
    const paras = splitIntoParagraphs(text);

    const diagnostics: vscode.Diagnostic[] = [];
    const typoRanges: vscode.Range[] = [];
    const currentHashes = new Set<string>();
    const roleMap = getDocumentRoleOccurrences(doc);
    for (const p of paras) {
        currentHashes.add(p.hash);
        const res = getParagraphResult(docKey, p.hash);
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
            for (const p of paras) {
                const exist = opts?.force ? undefined : getParagraphResult(docKey, p.hash);
                if (exist) continue; // already scanned
                tasks.push((async () => {
                    const res = await scanParagraph(p);
                    if (res) {
                        setParagraphResult(docKey, res);
                        // Progressive flush: update UI shortly after each paragraph completes
                        const prevFlush = flushTimers.get(docKey);
                        if (prevFlush) clearTimeout(prevFlush);
                        const fh = setTimeout(() => {
                            try { createDiagnosticsForDoc(doc, { diagnosticCollection }); } catch { /* ignore */ }
                        }, 100);
                        flushTimers.set(docKey, fh);
                    }
                })());
            }
            if (tasks.length) {
                scanningDocs.add(docKey); updateStatusBar();
                await Promise.all(tasks);
                scanningDocs.delete(docKey); updateStatusBar();
            }
            createDiagnosticsForDoc(doc, { diagnosticCollection });
        } catch (e) {
            // no-op
        }
    }, 400);
    scanTimers.set(docKey, handle);
}

export function registerTypoFeature(context: vscode.ExtensionContext) {
    context.subscriptions.push(diagnosticCollection);

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
            resetParagraphs(docKey);
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
        vscode.workspace.onDidCloseTextDocument(doc => {
            if (supported(doc)) {
                diagnosticCollection.delete(doc.uri);
                const keep = vscode.workspace.getConfiguration('AndreaNovelHelper').get<boolean>('typo.keepCacheOnClose', true);
                if (!keep) {
                    // Immediately drop cache if user prefers
                    clearDocDB(doc.uri.toString());
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

// Re-export for external integration convenience
export { setTypoDetector } from './typoDetector';
