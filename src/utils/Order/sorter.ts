/* eslint-disable curly */
import * as vscode from 'vscode';

const collator = new Intl.Collator('zh', { numeric: true, sensitivity: 'base' });

export function sortItems(items: vscode.TreeItem[]) {
    items.sort((a, b) => {
        const aDir = a.collapsibleState !== vscode.TreeItemCollapsibleState.None;
        const bDir = b.collapsibleState !== vscode.TreeItemCollapsibleState.None;
        if (aDir !== bDir) return aDir ? -1 : 1;

        const la = getLabelText(a.label);
        const lb = getLabelText(b.label);

        const pa = parseChapterInfo(la);
        const pb = parseChapterInfo(lb);

        // 1) 两者都是章节型
        if (pa && pb) {
            if (pa.group !== pb.group) return pa.group - pb.group;
            if (pa.volume !== pb.volume) return pa.volume - pb.volume;
            if (pa.chapter !== pb.chapter) return pa.chapter - pb.chapter;
            if (pa.part !== pb.part) return pa.part - pb.part;

            // 同章下的“版本/修订”比较（可选）
            if (pa.revision !== pb.revision) return pa.revision - pb.revision;

            return fallbackNameCompare(la, lb);
        }
        // 2) 仅一方是章节型 → 章节型更靠前
        if (pa && !pb) return -1;
        if (!pa && pb) return 1;

        // 3) 普通自然排序（含中文数字、罗马、版本号的融合）
        return naturalCompare(la, lb);
    });
}

// —— 工具：取 TreeItem.label 的文本 —— //
function getLabelText(label: string | vscode.TreeItemLabel | undefined): string {
    if (!label) return '';
    return typeof label === 'string' ? label : (label.label ?? '');
}

// —— 自然排序（不依赖章节结构）：把中文数字/罗马/版本号统一映射后比较 —— //
function naturalCompare(a: string, b: string): number {
    const na = normalizeForCompare(a);
    const nb = normalizeForCompare(b);
    const c = collator.compare(na, nb);
    if (c !== 0) return c;
    // 同主体时，扩展名次序作为轻微 tiebreaker（md < txt < others）
    const [ab, ae] = splitExt(a);
    const [bb, be] = splitExt(b);
    if (ab === bb) {
        const extRank = (ext: string) =>
            ext === '.md' ? 0 :
                ext === '.txt' ? 1 :
                    2;
        const d = extRank(ae) - extRank(be);
        if (d !== 0) return d;
    }
    return collator.compare(a, b);
}

function fallbackNameCompare(a: string, b: string): number {
    const na = normalizeForCompare(a);
    const nb = normalizeForCompare(b);
    const c = collator.compare(na, nb);
    if (c !== 0) return c;
    return collator.compare(a, b);
}

function splitExt(name: string): [string, string] {
    const i = name.lastIndexOf('.');
    if (i <= 0) return [name, ''];
    return [name.slice(0, i), name.slice(i).toLowerCase()];
}

// —— 规范化：NFKC + 将中文数字/罗马/版本号替换为可比较的“等值串” —— //
function normalizeForCompare(s: string): string {
    let t = s.normalize('NFKC');

    // 版本号 -> 大数展开，保持 1.10 > 1.2；先替换 v1.2.3 / 1.2.3
    t = t.replace(/\bv?(\d+(?:\.\d+){1,3})(?:-[0-9A-Za-z.-]+)?\b/g, (_, ver: string) => {
        const w = semverWeight(ver);
        return `#SEM${w}#`;
    });

    // 罗马数字（独立词） -> 阿拉伯数字
    t = t.replace(/\b[MCDXLVI]+|\b[mcdxlvi]+\b/g, (m) => String(romanToInt(m)));

    // 中文数字词块 -> 阿拉伯数字
    t = t.replace(/[零〇一二两三四五六七八九十百千萬万亿億]+/g, (m) => {
        const n = chineseNumeralToNumber(m);
        return Number.isFinite(n) ? String(n) : m;
    });

    return t;
}

// —— 章节解析 —— //
type ChapterInfo = {
    group: number;   // -2 序章类 | 0 普通章 | 1 番外类 | 2 终章类
    volume: number;  // 卷号（无则 0）
    chapter: number; // 章号（无则 0）
    part: number;    // 上中下：1/2/3（无则 0）
    revision: number;// 同章下的修订/版本（无则 0）
};

function parseChapterInfo(nameInput: string): ChapterInfo | null {
    const name = nameInput.normalize('NFKC');

    // 1) 先解析卷号、章号（阿拉伯/中文/罗马/版本号；并按“锚点最近 & 阿拉伯优先”取值）
    const volAnchor = findAnchor(name, /(第\s*[零〇一二两三四五六七八九十百千萬万亿億\dMDCLXVImdclxvi\.v-]+?\s*卷)|(\b卷\b)/);
    const volume = pickNearestNumber(name, volAnchor?.index ?? -1) ?? 0;

    const chapAnchor = findAnchor(name, /(第\s*[零〇一二两三四五六七八九十百千萬万亿億\dMDCLXVImdclxvi\.v-]+?\s*(章|回|节|節))|(章|回|节|節)(?!名)/);
    let chapter = pickNearestNumber(name, chapAnchor?.index ?? -1);

    // 宽松：开头模式 “12.” / “十二、” / “XII.”
    if (chapter === null) {
        const loose = name.match(/^\s*([零〇一二两三四五六七八九十百千萬万亿億\dMDCLXVImdclxvi]+(?:\.\d+){0,3})[、\.\s]/);
        if (loose) chapter = parseSmartNumberToken(loose[1]);
    }

    // 2) 如果**已经拿到章号**，一律当普通章节处理（忽略“序/番外/终章/尾声”等关键词）
    if (chapter !== null) {
        return {
            group: 0,                          // 关键：不走特殊组
            volume,
            chapter,
            part: extractPart(name),
            revision: pickNearestVersionWeight(name, chapAnchor?.index ?? -1) ?? 0
        };
    }

    // 3) 没有章号时，再判断是否属于特殊组
    const isPrologue = /(序章?|序幕|楔子|引子|前言)/i.test(name);
    const isEpilogue = /(终章?|尾声|后记)/i.test(name);
    const isExtra = /(番外|外传|外篇|特典)/i.test(name);

    if (isPrologue) {
        return {
            group: -2,
            volume,
            chapter: -1,                // 给个很小的章节序，保证在最前
            part: extractPart(name),
            revision: 0
        };
    }
    if (isExtra) {
        return {
            group: 1,
            volume,
            chapter: Number.MAX_SAFE_INTEGER / 8,  // 普通章后面
            part: extractPart(name),
            revision: 0
        };
    }
    if (isEpilogue) {
        return {
            group: 2,
            volume,
            chapter: Number.MAX_SAFE_INTEGER / 4,  // 最后
            part: extractPart(name),
            revision: 0
        };
    }

    // 4) 既没有章号也不是特殊项 → 非章节型
    return null;
}


// 找到锚点（返回其在字符串中的索引）
function findAnchor(s: string, re: RegExp): { index: number } | null {
    const m = s.match(re);
    if (!m) return null;
    // 取匹配片段的末尾作为锚（更接近数字）
    const idx = m.index! + m[0].length - 1;
    return { index: idx };
}

// 在锚点附近选择最近的“数字记号”，并解析为整数
function pickNearestNumber(s: string, anchor: number): number | null {
    const tokens = scanNumberTokens(s);
    if (tokens.length === 0) return null;
    if (anchor < 0) {
        // 无锚点：取第一个较靠谱的
        return parseSmartNumberToken(tokens[0].text);
    }
    let best: { dist: number; value: number } | null = null;
    for (const t of tokens) {
        const v = parseSmartNumberToken(t.text);
        if (!Number.isFinite(v)) continue;
        const center = (t.start + t.end) / 2;
        const dist = Math.abs(center - anchor);
        if (!best || dist < best.dist) best = { dist, value: v as number };
    }
    return best ? best.value : null;
}

// 在锚点附近选择最近的“版本号”，用于同章的修订次序
function pickNearestVersionWeight(s: string, anchor: number): number | null {
    const vs = [...s.matchAll(/\bv?(\d+(?:\.\d+){1,3})(?:-[0-9A-Za-z.-]+)?\b/g)];
    if (vs.length === 0) return null;
    let best: { dist: number; w: number } | null = null;
    for (const m of vs) {
        const w = semverWeight(m[1]);
        const start = m.index!;
        const end = start + m[0].length;
        const center = (start + end) / 2;
        const dist = Math.abs(center - anchor);
        if (!best || dist < best.dist) best = { dist, w };
    }
    return best ? best.w : null;
}

// 扫描所有可能的数字 token：阿拉伯/中文/罗马/版本
function scanNumberTokens(s: string): Array<{ text: string; start: number; end: number }> {
    const out: Array<{ text: string; start: number; end: number }> = [];
    const push = (m: RegExpMatchArray) => out.push({ text: m[0], start: m.index!, end: m.index! + m[0].length });

    // 版本号（含 v1.2.3 / 1.2.3）
    for (const m of s.matchAll(/\bv?(\d+(?:\.\d+){1,3})(?:-[0-9A-Za-z.-]+)?\b/g)) push(m);
    // 阿拉伯数字
    for (const m of s.matchAll(/\b\d+\b/g)) push(m);
    // 罗马数字
    for (const m of s.matchAll(/\b[MCDXLVI]+|\b[mcdxlvi]+\b/g)) push(m);
    // 中文数字连续块
    for (const m of s.matchAll(/[零〇一二两三四五六七八九十百千萬万亿億]+/g)) push(m);

    // 去重/合并（可能重叠）
    out.sort((a, b) => a.start - b.start || b.end - a.end);
    return out;
}

// 将单个 token 解析为整数（版本号按大数展开）
function parseSmartNumberToken(tok: string): number {
    const v = tok.match(/^\bv?(\d+(?:\.\d+){1,3})(?:-[0-9A-Za-z.-]+)?\b$/);
    if (v) return semverWeight(v[1]);              // 版本号
    if (/^\d+$/.test(tok)) return parseInt(tok, 10); // 阿拉伯
    if (/^[MDCLXVI]+$/i.test(tok)) return romanToInt(tok); // 罗马
    const cn = chineseNumeralToNumber(tok);          // 中文
    return Number.isFinite(cn) ? cn : NaN;
}

// —— 上/中/下/前/后 —— //
function extractPart(s: string): number {
    if (/上(篇|部|卷)?/i.test(s) || /前(篇|部)?/i.test(s)) return 1;
    if (/中(篇|部|卷)?/i.test(s)) return 2;
    if (/(下(篇|部|卷)?|完)/i.test(s) || /后(篇|部)?/i.test(s)) return 3;
    return 0;
}

// —— 版本号权重：major*1e9 + minor*1e6 + patch*1e3 + build —— //
function semverWeight(ver: string): number {
    const parts = ver.split('.');
    const [a, b = '0', c = '0', d = '0'] = parts;
    const A = clamp(parseInt(a, 10), 0, 1e6);
    const B = clamp(parseInt(b, 10), 0, 1e6);
    const C = clamp(parseInt(c, 10), 0, 1e6);
    const D = clamp(parseInt(d, 10), 0, 1e6);
    return A * 1_000_000_000 + B * 1_000_000 + C * 1_000 + D;
}

function clamp(n: number, lo: number, hi: number): number {
    if (!Number.isFinite(n)) return 0;
    return Math.min(hi, Math.max(lo, n));
}

// —— 罗马数字 —— //
function romanToInt(s: string): number {
    const m: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
    const S = s.toUpperCase();
    let sum = 0, prev = 0;
    for (let i = S.length - 1; i >= 0; --i) {
        const cur = m[S[i]] || 0;
        if (cur < prev) sum -= cur; else sum += cur;
        prev = cur;
    }
    return sum;
}

// —— 中文数字到阿拉伯（到“亿”） —— //
function chineseNumeralToNumber(input: string): number {
    const digits: Record<string, number> = {
        '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '兩': 2, '三': 3, '四': 4,
        '五': 5, '六': 6, '七': 7, '八': 8, '九': 9
    };
    const smallUnits: Record<string, number> = { '十': 10, '百': 100, '千': 1000 };
    const bigUnits: Record<string, number> = { '万': 10000, '萬': 10000, '亿': 100000000, '億': 100000000 };

    if (/^\d+$/.test(input)) return parseInt(input, 10);

    function sectionToNumber(section: string): number {
        let total = 0, current = 0;
        for (const ch of section) {
            if (ch in digits) {
                current = (current || 0) * 10 + digits[ch];
            } else if (ch in smallUnits) {
                const unit = smallUnits[ch];
                if (current === 0) current = 1;
                total += current * unit;
                current = 0;
            } else if (ch === '零' || ch === '〇') {
                if (current !== 0) { total += current; current = 0; }
            } else {
                return NaN;
            }
        }
        return total + current;
    }

    let rest = input;
    let result = 0;

    let idx = Math.max(rest.lastIndexOf('亿'), rest.lastIndexOf('億'));
    if (idx !== -1) {
        const high = rest.slice(0, idx);
        const n = chineseNumeralToNumber(high);
        if (!Number.isFinite(n)) return NaN;
        result += (n as number) * 100000000;
        rest = rest.slice(idx + 1);
    }

    idx = Math.max(rest.lastIndexOf('万'), rest.lastIndexOf('萬'));
    if (idx !== -1) {
        const mid = rest.slice(0, idx);
        const n = chineseNumeralToNumber(mid);
        if (!Number.isFinite(n)) return NaN;
        result += (n as number) * 10000;
        rest = rest.slice(idx + 1);
    }

    const tail = sectionToNumber(rest);
    if (!Number.isFinite(tail)) return NaN;

    return result + tail;
}
