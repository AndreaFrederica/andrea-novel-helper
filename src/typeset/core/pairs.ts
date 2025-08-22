import * as vscode from 'vscode';

export type Pair = { open: string; close: string };

function parseArrayPairs(arr: unknown): Pair[] {
    if (!Array.isArray(arr)) {return [];}
    const out: Pair[] = [];
    for (const it of arr) {
        if (typeof it === 'string' && it.length === 2) {
            out.push({ open: it[0], close: it[1] });
        }
    }
    return out;
}

function parseStringPairs(seq: unknown): Pair[] {
    if (typeof seq !== 'string') {return [];}
    const s = seq;
    const out: Pair[] = [];
    for (let i = 0; i + 1 < s.length; i += 2) {
        out.push({ open: s[i], close: s[i + 1] });
    }
    return out;
}

/** 统一读取成对符号：优先 andrea.typeset.pairs（数组>字符串）；无则给默认 */
export function getPairsFromConfig(): Pair[] {
    const cfg = vscode.workspace.getConfiguration();
    const unified = cfg.get('andrea.typeset.pairs');

    let pairs: Pair[] = [];
    if (Array.isArray(unified)) {
        pairs = parseArrayPairs(unified);
    } else if (typeof unified === 'string') {
        pairs = parseStringPairs(unified);
    }

    if (pairs.length === 0) {
        pairs = parseArrayPairs(["()", "[]", "{}", "“”", "‘’", "「」", "『』", "《》"]);
    }

    const map = new Map<string, Pair>();
    for (const p of pairs) {
        const k = `${p.open}→${p.close}`;
        if (!map.has(k)) {map.set(k, p);}
    }
    return [...map.values()];
}

export function nextIsClosingPair(doc: vscode.TextDocument, pos: vscode.Position, pairs: Pair[]) {
    const next = doc.getText(new vscode.Range(pos, pos.translate(0, 1)));
    return pairs.find(p => p.close === next) ?? null;
}
