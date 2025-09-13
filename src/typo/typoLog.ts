import * as vscode from 'vscode';

let ch: vscode.OutputChannel | null = null;
let shownOnce = false;

export function getLLMLogChannel(): vscode.OutputChannel {
    if (!ch) ch = vscode.window.createOutputChannel('Andrea Typo LLM');
    // 移除自动显示窗口的逻辑，让用户手动控制窗口显示
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
        // 检查调试开关，只有开启时才输出日志
        if (!isClientLLMTraceEnabled() && !isServerTraceEnabled()) return;
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
