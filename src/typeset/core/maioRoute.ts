/* eslint-disable curly */
import * as vscode from 'vscode';

const MAIO_LANG = new Set(['markdown', 'rmd', 'quarto']); // 仅在这些语言才考虑转发给 MAIO
const MAIO_EXTENSION_ID = 'yzhang.markdown-all-in-one';

let cachedMaioAvailable: boolean | undefined;

export function refreshMaioAvailability(): boolean {
    cachedMaioAvailable = !!vscode.extensions.getExtension(MAIO_EXTENSION_ID);
    return cachedMaioAvailable;
}

export function hasMaioAvailability(): boolean {
    if (cachedMaioAvailable === undefined) {
        return refreshMaioAvailability();
    }
    return cachedMaioAvailable;
}

export function isInFencedCodeBlock(doc: vscode.TextDocument, line: number): boolean {
    let fence = 0;
    for (let i = 0; i <= line && i < doc.lineCount; i++) {
        const t = doc.lineAt(i).text;
        if (/^\s*(```+|~~~+)/.test(t)) fence ^= 1;
    }
    return fence === 1;
}

export function isInMathBlock(doc: vscode.TextDocument, line: number): boolean {
    let math = 0;
    for (let i = 0; i <= line && i < doc.lineCount; i++) {
        if (/^\s*\$\$\s*$/.test(doc.lineAt(i).text)) math ^= 1;
    }
    return math === 1;
}

/** 只有在 MAIO 的语言集、单光标、且不在 fenced/math 时，才进一步看“列表/引用”等上下文 */
export function matchesMaioEnterContext(ed: vscode.TextEditor): boolean {
    const doc = ed.document;
    if (!MAIO_LANG.has(doc.languageId)) return false;
    if (ed.selections.length !== 1) return false;

    const pos = ed.selection.active;
    const lineText = doc.lineAt(pos.line).text;
    const left = lineText.slice(0, pos.character);
    const trimmed = lineText.trimStart();

    if (isInFencedCodeBlock(doc, pos.line) || isInMathBlock(doc, pos.line)) return false;

    // 区块引用（> / >>）
    if (/^(\s{0,3}(>\s?)+)/.test(trimmed)) return true;

    // 任务列表 - [ ] / - [x]
    if (/^\s*([*+-])\s+\[(?: |x|X)\]/.test(trimmed)) return true;

    // 无序列表
    if (/^\s*([*+-])\s+/.test(trimmed)) return true;

    // 有序列表 1. / 1)
    if (/^\s*\d+[.)]\s+/.test(trimmed)) return true;

    // “左侧恰为标记+空格”的切分
    if (/^\s*([*+-])\s$/.test(left)) return true;
    if (/^\s*\d+[.)]\s$/.test(left)) return true;
    if (/^\s*([*+-])\s+\[(?: |x|X)\]\s$/.test(left)) return true;

    // 空列表项的退出/退栈
    if (/^\s*([*+-])\s*$/.test(trimmed)) return true;
    if (/^\s*\d+[.)]\s*$/.test(trimmed)) return true;
    if (/^\s*([*+-])\s+\[(?: |x|X)\]\s*$/.test(trimmed)) return true;

    return false;
}

export async function forwardEnterToMaioOrNative(): Promise<void> {
    if (hasMaioAvailability()) {
        try {
            const ids = await vscode.commands.getCommands(true);
            if (ids.includes('markdown.extension.onEnterKey')) {
                await vscode.commands.executeCommand('markdown.extension.onEnterKey');
                return;
            }
        } catch { /* ignore and fallback */ }
    }
    await vscode.commands.executeCommand('type', { text: '\n' });
}
