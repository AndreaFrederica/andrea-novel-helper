/* eslint-disable curly */
import * as vscode from 'vscode';
import { getSupportedLanguages, typeColorMap, rangesOverlap } from '../utils/utils';
import { roles, onDidChangeRoles } from '../activate';
import AhoCorasick from 'ahocorasick';
import { Role } from '../extension';

// 存储每个文档的 Hover 信息
interface HoverInfo {
    range: vscode.Range;
    role: Role;
}
export const hoverRangesMap = new Map<string, HoverInfo[]>();

// —— Aho–Corasick 自动机 & 模式映射 ——
let ac: AhoCorasick;
const patternMap = new Map<string, Role>();

/**
 * 初始化（或重建）自动机 & patternMap
 */
function initAutomaton() {
    patternMap.clear();
    const patterns: string[] = [];
    for (const r of roles) {
        const key = r.name.trim().normalize('NFC');
        patterns.push(key);
        patternMap.set(key, r);
        if (r.aliases) for (const alias of r.aliases) {
            const a = alias.trim().normalize('NFC');
            patterns.push(a);
            patternMap.set(a, r);
        }
    }
    // @ts-ignore
    ac = new AhoCorasick(patterns);
}

/**
 * 扫描文档，生成 Hover 信息列表
 */
function scanDocumentForHover(doc: vscode.TextDocument): HoverInfo[] {
    initAutomaton();
    const text = doc.getText();
    const rawHits = ac.search(text) as Array<[number, string | string[]]>;
    type Candidate = { role: Role; start: number; end: number };
    const candidates: Candidate[] = [];
    for (const [endIdx, patOrArr] of rawHits) {
        const patterns = Array.isArray(patOrArr) ? patOrArr : [patOrArr];
        for (const raw of patterns) {
            const pat = raw.trim().normalize('NFC');
            const role = patternMap.get(pat);
            if (!role) continue;
            const start = endIdx - pat.length + 1;
            candidates.push({ role, start, end: endIdx + 1 });
        }
    }
    candidates.sort((a, b) => (b.end - b.start) - (a.end - a.start));
    const selected: Candidate[] = [];
    for (const c of candidates) {
        if (selected.some(s => rangesOverlap(s.start, s.end, c.start, c.end))) continue;
        selected.push(c);
    }
    return selected.map(c => ({ range: new vscode.Range(doc.positionAt(c.start), doc.positionAt(c.end)), role: c.role }));
}

/**
 * 比较两组 HoverInfo 是否完全一致
 */
function hoverInfoEqual(a: HoverInfo[], b: HoverInfo[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        const ai = a[i], bi = b[i];
        if (!ai.range.isEqual(bi.range) || ai.role.name !== bi.role.name) return false;
    }
    return true;
}

/**
 * 全量刷新：使用 diff 策略，仅在变更时更新 hoverRangesMap
 */
function refreshAll() {
    // 仅处理可见编辑器，以增量方式更新
    const currentKeys = new Set<string>();
    for (const editor of vscode.window.visibleTextEditors) {
        const key = editor.document.uri.toString();
        currentKeys.add(key);
        const newInfos = scanDocumentForHover(editor.document);
        const oldInfos = hoverRangesMap.get(key) || [];
        if (!hoverInfoEqual(oldInfos, newInfos)) {
            hoverRangesMap.set(key, newInfos);
            console.log(
                `【HoverProvider】文档 ${key} Hover 信息更新，从 ${oldInfos.length} 条到 ${newInfos.length} 条`
            );
        }
    }
    // 删除不再可见的文档缓存
    for (const key of Array.from(hoverRangesMap.keys())) {
        if (!currentKeys.has(key)) {
            hoverRangesMap.delete(key);
            console.log(
                `【HoverProvider】文档 ${key} Hover 信息已移除`
            );
        }
    }

}
export function activateHover(context: vscode.ExtensionContext) {
    // 初始扫描
    refreshAll();

    // 监听数据源变化
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(() => refreshAll()),
        vscode.workspace.onDidChangeTextDocument(() => refreshAll()),
        vscode.workspace.onDidCloseTextDocument(() => refreshAll()),
        vscode.window.onDidChangeVisibleTextEditors(() => refreshAll()),
        onDidChangeRoles(() => refreshAll())
    );

    // 注册 Hover 提供器
    const hoverProv = vscode.languages.registerHoverProvider(
        getSupportedLanguages(),
        {
            provideHover(doc, pos) {
                const key = doc.uri.toString();
                const ranges = hoverRangesMap.get(key) || [];
                const hit = ranges.find(h => h.range.contains(pos));
                if (!hit) return;
                const r = hit.role;
                const md = new vscode.MarkdownString('', true);
                md.isTrusted = true;
                md.appendMarkdown(`**${r.name}**\n\n`);
                if (r.description) md.appendMarkdown(`${r.description}\n\n`);
                md.appendMarkdown(`**类型**: ${r.type}\n\n`);
                if (r.affiliation) md.appendMarkdown(`**从属**: ${r.affiliation}\n\n`);
                const defaultColor = vscode.workspace.getConfiguration('AndreaNovelHelper').get<string>('defaultColor')!;
                const c = r.color || typeColorMap[r.type] || defaultColor;
                const svg = `<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\"><rect width=\"16\" height=\"16\" fill=\"${c}\"/></svg>`;
                const b64 = Buffer.from(svg).toString('base64');
                const uri = `data:image/svg+xml;base64,${b64}`;
                md.appendMarkdown(`**颜色**: ![](${uri}) \`${c}\``);
                return new vscode.Hover(md, hit.range);
            }
        }
    );
    context.subscriptions.push(hoverProv);
}
