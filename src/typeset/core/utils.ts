import * as vscode from 'vscode';
import { getSupportedLanguages } from '../../utils/utils';

export function isSupportedDoc(doc: vscode.TextDocument) {
    return getSupportedLanguages().includes(doc.languageId);
}

export function getIndentUnit(editor: vscode.TextEditor): string {
    const opt = editor.options;
    const insertSpaces = opt.insertSpaces === 'auto' ? true : !!opt.insertSpaces;
    const tabSize = typeof opt.tabSize === 'number' ? opt.tabSize : 2;
    return insertSpaces ? ' '.repeat(Math.max(1, tabSize)) : '\t';
}

export function trimTrailingSpacesIfNeeded(edit: vscode.TextEditorEdit, doc: vscode.TextDocument, line: number) {
    const cfg = vscode.workspace.getConfiguration();
    if (!cfg.get<boolean>('andrea.typeset.trimTrailingSpaces', true)) { return; }
    if (line < 0 || line >= doc.lineCount) { return; }
    const rng = doc.lineAt(line).range;
    const text = doc.getText(rng);
    const trimmed = text.replace(/[ \t]+$/u, '');
    if (trimmed !== text) { edit.replace(rng, trimmed); }
}

/**
 * 规范“段间空行数”为 exactly N：
 * 仅当原本有≥1个空行时才会调整，不会给“没有空行”的相邻行强行插。
 */
export function normalizeBlankRuns(text: string, N: number, trimTrailing: boolean): string {
    const lines = text.split(/\r?\n/);
    const out: string[] = [];
    let i = 0;

    const pushLine = (s: string) => {
        out.push(trimTrailing ? s.replace(/[ \t]+$/u, '') : s);
    };

    while (i < lines.length) {
        const cur = lines[i];
        pushLine(cur);
        let j = i + 1, blanks = 0;
        while (j < lines.length && lines[j].trim().length === 0) {
            blanks++; j++;
        }
        if (blanks > 0) {
            for (let k = 0; k < N; k++) { out.push(''); }
        }
        i = j;
    }

    return out.join('\n');
}

export function ensureBlankLinesBetweenParas(text: string, N: number, trimTrailing: boolean): string {
    const lines = text.split(/\r?\n/);
    const out: string[] = [];
    let inFencedCodeBlock = false;
    const cfg = vscode.workspace.getConfiguration('andrea.typeset');
    const defaultClosers = ["'", '"', '’', '”', '」', '』', '》', '）', '】', '〉', '〕', '〗', '〙', '〛', '〞', '＂', '＇', '｝', '］'];
    const defaultOpeners = ['“', '"', '『', '「', '（', '(', '《', '〈', '【', '['];
    const defaultEnders = ['。','！','？','…','；','：','!','?',';',':', '.'];
    const userClosers = cfg.get<string[]>('addBlanks.trailingClosers', defaultClosers) || defaultClosers;
    const userOpeners = cfg.get<string[]>('addBlanks.leadingOpeners', defaultOpeners) || defaultOpeners;
    const userEnders = cfg.get<string[]>('addBlanks.sentenceEnders', defaultEnders) || defaultEnders;
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const closersAlt = userClosers.map(esc).join('|');
    const openersAlt = userOpeners.map(esc).join('|');
    const endersAlt = userEnders.map(esc).join('|');
    const endsWithRe = closersAlt
        ? new RegExp(`(?:${endersAlt})+(?:(?:${closersAlt}))*$`, 'u')
        : new RegExp(`(?:${endersAlt})+$`, 'u');
    const openerSeqRe = openersAlt ? new RegExp(`^(?:${openersAlt})+`) : null;

    const isStructural = (s: string): boolean => {
        const t = s.trim();
        if (!t) return false;
        if (/^```/.test(t)) return true;
        if (/^(#{1,6}\s+|>+\s+|\|)/.test(t)) return true;
        if (/^(-|\*|\+)\s+/.test(t)) return true;
        if (/^\d+(\.|\))\s+/.test(t)) return true;
        return false;
    };

    const pushLine = (s: string) => {
        out.push(trimTrailing ? s.replace(/[ \t]+$/u, '') : s);
    };

    let i = 0;
    while (i < lines.length) {
        const cur = lines[i];
        if (/^\s*```/.test(cur)) {
            inFencedCodeBlock = !inFencedCodeBlock;
        }
        pushLine(cur);
        let j = i + 1;
        let blanks = 0;
        while (j < lines.length && lines[j].trim().length === 0) {
            blanks++; j++;
        }
        if (blanks > 0) {
            for (let k = 0; k < N; k++) { out.push(''); }
            i = j;
            continue;
        }
        if (i + 1 < lines.length) {
            const prevTrimmedEnd = cur.trimEnd();
            const nextRaw = lines[i + 1];
            const nextTrimmedStart = nextRaw.trimStart();
            const prevStructural = isStructural(cur);
            const nextStructural = isStructural(nextRaw);
            const endsWithPunct = endsWithRe.test(prevTrimmedEnd);
            const nextCore = openerSeqRe ? nextTrimmedStart.replace(openerSeqRe, '') : nextTrimmedStart;
            const nextStartsWord = /^[\p{Script=Han}A-Za-z]/u.test(nextCore);
            if (!inFencedCodeBlock && !prevStructural && !nextStructural && prevTrimmedEnd && nextCore && endsWithPunct && nextStartsWord) {
                for (let k = 0; k < N; k++) { out.push(''); }
            }
        }
        i = i + 1;
    }
    return out.join('\n');
}
