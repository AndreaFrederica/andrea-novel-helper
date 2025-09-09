import * as vscode from 'vscode';

let ch: vscode.OutputChannel | null = null;
let shownOnce = false;

export function getLLMLogChannel(): vscode.OutputChannel {
    if (!ch) ch = vscode.window.createOutputChannel('Andrea Typo LLM');
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    const show = cfg.get<boolean>('typo.debug.llmTrace', false) || cfg.get<boolean>('typo.debug.serverTrace', false);
    if (show && !shownOnce) { ch.show(true); shownOnce = true; }
    return ch;
}

export function isClientLLMTraceEnabled(): boolean {
    return vscode.workspace.getConfiguration('AndreaNovelHelper').get<boolean>('typo.debug.llmTrace', false) === true;
}

export function isServerTraceEnabled(): boolean {
    return vscode.workspace.getConfiguration('AndreaNovelHelper').get<boolean>('typo.debug.serverTrace', false) === true;
}

function isCompactTraceEnabled(): boolean {
    return vscode.workspace.getConfiguration('AndreaNovelHelper').get<boolean>('typo.debug.compactTrace', true) === true;
}

function getTraceMaxLen(): number {
    const n = vscode.workspace.getConfiguration('AndreaNovelHelper').get<number>('typo.debug.traceMaxLen', 1200);
    return Math.max(200, Math.min(10000, n || 1200));
}

function compactOnce(s: string): string {
    // Replace CR/LF with single spaces and collapse excessive spaces
    let t = s.replace(/[\r\n]+/g, ' ');
    t = t.replace(/[\t ]{2,}/g, ' ');
    return t.trim();
}

export function appendTrace(line: string) {
    try {
        const out = getLLMLogChannel();
        let text = String(line ?? '');
        if (isCompactTraceEnabled()) text = compactOnce(text);
        const max = getTraceMaxLen();
        if (text.length > max) text = text.slice(0, max) + ' …';
        out.appendLine(text);
    } catch { /* ignore */ }
}

let llmReplyOpen = false;
export function appendLLMReplyChunk(chunk: string) {
    try {
        if (!isClientLLMTraceEnabled()) return;
        const out = getLLMLogChannel();
        const text = String(chunk ?? '');
        // Do NOT compact or truncate model reply; preserve spaces and newlines.
        if (!llmReplyOpen) {
            out.append('<== [ClientLLM] ');
            llmReplyOpen = true;
        }
        out.append(text);
    } catch { /* ignore */ }
}

export function endLLMReplyLine() {
    try {
        if (!isClientLLMTraceEnabled()) return;
        if (!llmReplyOpen) return;
        const out = getLLMLogChannel();
        out.appendLine('');
        llmReplyOpen = false;
    } catch { /* ignore */ }
}
