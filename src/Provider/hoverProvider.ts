/* eslint-disable curly */
import * as vscode from 'vscode';
import { getSupportedLanguages, typeColorMap, rangesOverlap } from '../utils/utils';
import { Role } from '../extension';
import AhoCorasick from 'ahocorasick';
import { roles } from '../activate';

// 存储每个文档的 Hover 信息
interface HoverInfo {
    range: vscode.Range;
    role: Role;
}
const hoverRangesMap = new Map<string, HoverInfo[]>();

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
        if (r.aliases) {
            for (const alias of r.aliases) {
                const a = alias.trim().normalize('NFC');
                patterns.push(a);
                patternMap.set(a, r);
            }
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
    // 转为统一格式
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
    // 按长度降序，优先匹配长模式
    candidates.sort((a, b) => (b.end - b.start) - (a.end - a.start));
    const selected: Candidate[] = [];
    for (const c of candidates) {
        if (selected.some(s => rangesOverlap(s.start, s.end, c.start, c.end))) continue;
        selected.push(c);
    }
    // 构造 HoverInfo
    return selected.map(c => ({
        range: new vscode.Range(doc.positionAt(c.start), doc.positionAt(c.end)),
        role: c.role
    }));
}

/**
 * 更新对应 doc 的 Hover 信息
 */
function updateHoverRangesForDocument(doc: vscode.TextDocument) {
    const key = doc.uri.toString();
    const infos = scanDocumentForHover(doc);
    hoverRangesMap.set(key, infos);
}

/**
 * 移除缓存
 */
function removeHoverRangesForDocument(doc: vscode.TextDocument) {
    hoverRangesMap.delete(doc.uri.toString());
}

export function activateHover(context: vscode.ExtensionContext) {
    // 扫描当前所有可见编辑器
    vscode.window.visibleTextEditors.forEach(editor => {
        updateHoverRangesForDocument(editor.document);
    });

    // 监听文档打开、变更与关闭
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(doc => updateHoverRangesForDocument(doc)),
        vscode.workspace.onDidChangeTextDocument(e => updateHoverRangesForDocument(e.document)),
        vscode.workspace.onDidCloseTextDocument(doc => removeHoverRangesForDocument(doc)),
        vscode.window.onDidChangeVisibleTextEditors(editors => {
            editors.forEach(editor => {
                const key = editor.document.uri.toString();
                if (!hoverRangesMap.has(key)) updateHoverRangesForDocument(editor.document);
            });
        })
    );

    // 注册提供者，将结果保存为变量
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

                const defaultColor = vscode.workspace
                    .getConfiguration('AndreaNovelHelper')
                    .get<string>('defaultColor')!;
                const c = r.color || typeColorMap[r.type] || defaultColor;
                const svg = `<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\">` +
                    `<rect width=\"16\" height=\"16\" fill=\"${c}\" /></svg>`;
                const b64 = Buffer.from(svg).toString('base64');
                const uri = `data:image/svg+xml;base64,${b64}`;

                md.appendMarkdown(`**颜色**: ![](${uri}) \`${c}\``);
                md.isTrusted = true;
                return new vscode.Hover(md, hit.range);
            }
        }
    );

    // 如果有 Definition Provider，类似：
    // const defProv = vscode.languages.registerDefinitionProvider(getSupportedLanguages(), defProvider);

    // 将所有 provider 一起注册到 subscriptions
    context.subscriptions.push(
        hoverProv,
        // defProv
    );
}
