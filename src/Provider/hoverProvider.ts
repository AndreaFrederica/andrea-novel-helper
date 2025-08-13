/* eslint-disable curly */
import * as vscode from 'vscode';
import { getSupportedLanguages, typeColorMap, rangesOverlap } from '../utils/utils';
import { roles, onDidChangeRoles } from '../activate';
import { ahoCorasickManager } from '../utils/ahoCorasickManager';
import { Role } from '../extension';

// 存储每个文档的 Hover 信息
interface HoverInfo {
    range: vscode.Range;
    role: Role;
}
export const hoverRangesMap = new Map<string, HoverInfo[]>();

/**
 * 扫描文档，生成 Hover 信息列表
 */
function scanDocumentForHover(doc: vscode.TextDocument): HoverInfo[] {
    const text = doc.getText();
    const rawHits = ahoCorasickManager.search(text);
    type Candidate = { role: Role; start: number; end: number };
    const candidates: Candidate[] = [];
    for (const [endIdx, patOrArr] of rawHits) {
        const patterns = Array.isArray(patOrArr) ? patOrArr : [patOrArr];
        for (const raw of patterns) {
            const pat = raw.trim().normalize('NFC');
            const role = ahoCorasickManager.getRole(pat);
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
    return selected.map(c => ({
        range: new vscode.Range(doc.positionAt(c.start), doc.positionAt(c.end)),
        role: c.role
    }));
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
 * 增量刷新：仅在变更时更新 hoverRangesMap，并打印日志
 */
function refreshAll() {
    console.log('【HoverProvider】开始增量刷新 Hover 信息');
    const currentKeys = new Set<string>();
    for (const editor of vscode.window.visibleTextEditors) {
        const key = editor.document.uri.toString();
        currentKeys.add(key);
        const newInfos = scanDocumentForHover(editor.document);
        const oldInfos = hoverRangesMap.get(key) || [];
        // if (!hoverInfoEqual(oldInfos, newInfos))
        // if (!hoverInfoEqual(oldInfos, newInfos))
        // if (!hoverInfoEqual(oldInfos, newInfos)) {
        //TODO 这里的Diff有问题 以后修
        if (true) {
            hoverRangesMap.set(key, newInfos);
            console.log(
                `【HoverProvider】文档 ${key} Hover 信息更新：${oldInfos.length} → ${newInfos.length}`
            );
        }
    }
    for (const key of Array.from(hoverRangesMap.keys())) {
        if (!currentKeys.has(key)) {
            hoverRangesMap.delete(key);
            console.log(`【HoverProvider】文档 ${key} Hover 缓存已移除`);
        }
    }
}

export function activateHover(context: vscode.ExtensionContext) {
    // 初始扫描
    refreshAll();

    // 监听各类事件触发增量刷新
    context.subscriptions.push(
        // 文档操作：会触发更新对应文档
        vscode.workspace.onDidOpenTextDocument(refreshAll),
        vscode.workspace.onDidChangeTextDocument(() => refreshAll()),
        vscode.workspace.onDidCloseTextDocument(refreshAll),
        // 切换/分屏：增量刷新可见编辑器
        vscode.window.onDidChangeVisibleTextEditors(refreshAll),
        // 角色库改变：触发全量重建 AhoCorasick 与重新扫描
        onDidChangeRoles(refreshAll)
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
