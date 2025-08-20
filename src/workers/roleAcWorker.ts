// Worker: 构建与搜索 Aho-Corasick 自动机（与主线程隔离）
import { parentPort } from "worker_threads";
// @ts-ignore
import AhoCorasick from "ahocorasick";

interface RoleMini {
    name: string;
    aliases?: string[];
    fixes?: string[];
    wordSegmentFilter?: any;
}
interface SegConfig {
    enableWordSegmentFilter: boolean;
    autoFilterMaxLength: number;
}
let ac: any = null;
let roleMap = new Map<string, RoleMini>();
let segConfig: SegConfig = {
    enableWordSegmentFilter: true,
    autoFilterMaxLength: 1,
};

// 独立的分词实现（不依赖主线程 segmenter），避免 worker require 主线程模块失败
let _segmenter: Intl.Segmenter | null = null;
function getSegmenter(): Intl.Segmenter | null {
    if (_segmenter) {
        return _segmenter;
    }
    // 优先中文，其次英文作为兜底
    const locales = ["zh", "zh-Hans", "zh-Hant", "en"];
    for (const loc of locales) {
        try {
            _segmenter = new Intl.Segmenter(loc, { granularity: "word" });
            break;
        } catch {
            /* try next */
        }
    }
    return _segmenter;
}
function findCompleteWords(
    text: string,
    target: string
): Array<{ start: number; end: number }> {
    const res: Array<{ start: number; end: number }> = [];
    if (!target) {
        return res;
    }
    const seg = getSegmenter();
    if (!seg) {
        // 退化：直接线性搜索全部精确子串（可能导致内嵌匹配，与旧逻辑差异但保证不崩）
        let idx = text.indexOf(target);
        while (idx !== -1) {
            res.push({ start: idx, end: idx + target.length });
            idx = text.indexOf(target, idx + 1);
        }
        return res;
    }
    const it = (seg as any).segment(text); // segment() 迭代器
    let offset = 0;
    for (const { segment, isWordLike } of it) {
        if (isWordLike && segment === target) {
            res.push({ start: offset, end: offset + segment.length });
        }
        offset += segment.length;
    }
    return res;
}

parentPort?.on("message", (msg: any) => {
    if (!msg || typeof msg !== "object") {
        return;
    }
    switch (msg.type) {
        case "build": {
            const patterns: string[] = [];
            roleMap.clear();
            segConfig = msg.config || segConfig;
            for (const r of msg.roles as RoleMini[]) {
                const base = r.name.trim().normalize("NFC");
                patterns.push(base);
                roleMap.set(base, r);
                if (r.aliases) {
                    for (const al of r.aliases) {
                        const a = al.trim().normalize("NFC");
                        patterns.push(a);
                        roleMap.set(a, r);
                    }
                }
                if (r.fixes) {
                    for (const fix of r.fixes) {
                        const f = fix.trim().normalize("NFC");
                        patterns.push(f);
                        roleMap.set(f, r);
                    }
                }
            }
            // @ts-ignore
            ac = new AhoCorasick(patterns);
            parentPort?.postMessage({ type: "built" });
            break;
        }
        case "search": {
            if (!ac) {
                parentPort?.postMessage({ type: "result", id: msg.id, matches: [] });
                break;
            }
            const text: string = msg.text || "";
            try {
                const raw = ac.search(text) as Array<[number, string | string[]]>;
                const out: Array<{ end: number; pats: string[] }> = [];
                for (const [endIdx, patOrArr] of raw) {
                    const pats = Array.isArray(patOrArr) ? patOrArr : [patOrArr];
                    const valid: string[] = [];
                    for (const p of pats) {
                        const norm = p.trim().normalize("NFC");
                        const role = roleMap.get(norm);
                        if (!role) {
                            continue;
                        }
                        // 老版本语义：是否使用分词过滤 = 全局开关 && (角色覆盖 ? 覆盖 : 长度 <= 阈值)
                        let useSeg = false;
                        if (segConfig.enableWordSegmentFilter) {
                            if (role.wordSegmentFilter !== undefined) {
                                useSeg = !!role.wordSegmentFilter;
                            } else {
                                useSeg =
                                    norm.length <=
                                    Math.max(1, segConfig.autoFilterMaxLength || 1);
                            }
                        }
                        if (useSeg) {
                            const matches = findCompleteWords(text, norm);
                            const end = endIdx + 1;
                            const start = end - norm.length;
                            if (matches.some((m) => m.start === start && m.end === end)) {
                                valid.push(norm);
                            }
                        } else {
                            valid.push(norm);
                        }
                    }
                    if (valid.length) {
                        out.push({ end: endIdx, pats: valid });
                    }
                }
                parentPort?.postMessage({ type: "result", id: msg.id, matches: out });
            } catch (e) {
                parentPort?.postMessage({
                    type: "result",
                    id: msg.id,
                    matches: [],
                    error: String(e),
                });
            }
            break;
        }
    }
});

parentPort?.postMessage({ type: "ready" });
