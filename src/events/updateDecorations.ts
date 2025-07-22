/* eslint-disable curly */
import * as vscode from 'vscode';
import { hoverRanges, roles, setHoverRanges } from '../activate';
import { Role } from '../extension';
import { getSupportedLanguages, rangesOverlap, typeColorMap } from '../utils/utils';
import * as path from 'path';
import AhoCorasick from 'ahocorasick';

// —— Diagnostics 集合 —— 
const diagnosticCollection = vscode.languages.createDiagnosticCollection('AndreaNovelHelper SensitiveWords');

// uri.fsPath -> 上次的 Diagnostic 数组
const prevDiagnostics = new Map<string, vscode.Diagnostic[]>();


// —— Aho–Corasick 自动机 & 模式映射 —— 
let ac: AhoCorasick;
const patternMap = new Map<string, Role>();

// —— 装饰器元数据：角色名 → { deco, propsHash, prevRanges } —— 
interface DecoMeta {
    deco: vscode.TextEditorDecorationType;
    propsHash: string;
    prevRanges: vscode.Range[];
}
const decorationMeta = new Map<string, DecoMeta>();

/** 初始化（或重建）自动机 & patternMap */
export function initAutomaton() {
    patternMap.clear();
    const patterns: string[] = [];
    for (const r of roles) {
        const nameKey = r.name.trim().normalize('NFC');
        patterns.push(nameKey);
        patternMap.set(nameKey, r);
        for (const alias of r.aliases || []) {
            const a = alias.trim().normalize('NFC');
            patterns.push(a);
            patternMap.set(a, r);
        }
    }
    // @ts-ignore
    ac = new AhoCorasick(patterns);
}

/** 比较两个 Range 数组是否相同 */
function rangesEqual(a: vscode.Range[], b: vscode.Range[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (!a[i].isEqual(b[i])) return false;
    }
    return true;
}

/** 主更新函数 */
export function updateDecorations(editor?: vscode.TextEditor) {
    const active = editor || vscode.window.activeTextEditor;
    if (!active) return;

    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    const folders = vscode.workspace.workspaceFolders;

    // —— 跳过词库文件 —— 
    if (folders?.length) {
        const root = folders[0].uri.fsPath;
        const fileB = path.join(root, cfg.get<string>('sensitiveWordsFile')!);
        const fileV = path.join(root, cfg.get<string>('vocabularyFile')!);
        const txtB = fileB.replace(/\.[^/.]+$/, '.txt');
        const txtV = fileV.replace(/\.[^/.]+$/, '.txt');
        const docPath = active.document.uri.fsPath;
        if ([fileB, fileV, txtB, txtV].includes(docPath)) return;
    }

    // —— 语言过滤 —— 
    if (!getSupportedLanguages().includes(active.document.languageId)) return;

    // —— 清理 hoverRanges & diagnostics —— 
    setHoverRanges([]);
    // diagnosticCollection.delete(active.document.uri);

    // —— 构建自动机 —— 
    initAutomaton();

    const doc = active.document;
    const text = doc.getText();
    const defaultColor = cfg.get<string>('defaultColor')!;

    // —— 搜索并统一 matchedPatterns 为 string[] —— 
    // 原生返回可能是 [number, string] 或 [number, string[]]
    const rawHits = ac.search(text) as unknown as Array<[number, string | string[]]>;
    const hits: Array<[number, string[]]> = rawHits.map(([endIdx, pat]) => [
        endIdx,
        Array.isArray(pat) ? pat : [pat]
    ]);

    type Candidate = { role: Role; text: string; start: number; end: number };
    const candidates: Candidate[] = [];

    // —— 收集所有匹配候选 —— 
    for (const [endIdx, matchedArray] of hits) {
        for (const raw of matchedArray) {
            const pat = raw.trim().normalize('NFC');
            const role = patternMap.get(pat);
            if (!role) continue;
            const startIdx = endIdx - pat.length + 1;
            candidates.push({ role, text: pat, start: startIdx, end: endIdx + 1 });
        }
    }

    // —— 长度降序 & 去重 —— 
    candidates.sort((a, b) => b.text.length - a.text.length);
    const selected: Candidate[] = [];
    for (const c of candidates) {
        if (selected.some(s => rangesOverlap(s.start, s.end, c.start, c.end))) continue;
        selected.push(c);
    }

    // —— 分组 ranges & 收集 hoverRanges —— 
    const roleToRanges = new Map<Role, vscode.Range[]>();
    for (const c of selected) {
        const range = new vscode.Range(
            doc.positionAt(c.start),
            doc.positionAt(c.end)
        );
        hoverRanges.push({ range, role: c.role });
        if (!roleToRanges.has(c.role)) roleToRanges.set(c.role, []);
        roleToRanges.get(c.role)!.push(range);
    }

    // —— 1) 清空已消失角色的装饰 —— 
    for (const [roleName, meta] of decorationMeta) {
        if (![...roleToRanges.keys()].some(r => r.name === roleName)) {
            if (meta.prevRanges.length) {
                active.setDecorations(meta.deco, []);
                meta.prevRanges = [];
            }
        }
    }

    // —— 2) 出现角色：属性 或 范围 变动时才更新装饰 —— 
    for (const [role, ranges] of roleToRanges) {
        const props = {
            color: role.color ?? typeColorMap[role.type] ?? defaultColor,
            type: role.type,
            affiliation: (role as any).affiliation ?? null,
            description: role.description ?? null
        };
        const propsHash = JSON.stringify(props);

        let deco: vscode.TextEditorDecorationType;
        const meta = decorationMeta.get(role.name);
        const need = !meta ||
            meta.propsHash !== propsHash ||
            !rangesEqual(ranges, meta.prevRanges);

        if (need) {
            if (meta) meta.deco.dispose();
            deco = vscode.window.createTextEditorDecorationType({ color: props.color });
            decorationMeta.set(role.name, {
                deco,
                propsHash,
                prevRanges: ranges.slice()
            });
        } else {
            deco = meta.deco;
        }

        active.setDecorations(deco, ranges);
    }

    // —— 敏感词诊断 —— 
    const diagnostics: vscode.Diagnostic[] = [];
    for (const [role, ranges] of roleToRanges) {
        if (role.type === '敏感词' && folders?.length) {
            const root = folders[0].uri.fsPath;
            const cspellTxt = path.join(root, '.vscode', 'cspell-roles.txt');
            if (doc.uri.fsPath !== cspellTxt) {
                for (const range of ranges) {
                    const base = `发现敏感词：${role.name}\n` +
                        (role.description ? ` ${role.description}` : '');
                    const lineNum = range.start.line + 1;
                    const lineText = doc.lineAt(range.start.line).text.trim();
                    const msg = `${base}\n第 ${lineNum} 行: ${lineText}`;
                    const diag = new vscode.Diagnostic(
                        range,
                        msg,
                        vscode.DiagnosticSeverity.Warning
                    );
                    diag.source = 'AndreaNovelHelper';
                    diagnostics.push(diag);
                }
            }
        }
    }
    const key = doc.uri.fsPath;
    const old = prevDiagnostics.get(key) || [];
    // 简单对比：长度和每个 message + range 串联起来都一样
    const equal = old.length === diagnostics.length
        && old.every((d, i) =>
            d.message === diagnostics[i].message
            && d.range.isEqual(diagnostics[i].range)
            && d.severity === diagnostics[i].severity
        );

    if (!equal) {
        if (diagnostics.length) {
            diagnosticCollection.set(doc.uri, diagnostics);
        } else {
            diagnosticCollection.delete(doc.uri);
        }
        // 更新缓存
        prevDiagnostics.set(key, diagnostics.map(d => d));
    }

}
