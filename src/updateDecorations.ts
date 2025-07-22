/* eslint-disable curly */
import * as vscode from 'vscode';
import { decorationTypes, hoverRanges, roles, setHoverRanges } from './activate';
import { Role } from './extension';
import { escapeRegExp, getSupportedLanguages, rangesOverlap, typeColorMap } from './utils';
import * as path from 'path';
import AhoCorasick from 'ahocorasick';

// Diagnostics 集合
const diagnosticCollection = vscode.languages.createDiagnosticCollection('AndreaNovelHelper SensitiveWords');

// 自动机实例
let ac: AhoCorasick;

let patternMap = new Map<string, Role>();

export function initAutomaton() {
    // 每次重建前先清空
    patternMap.clear();

    // 把所有 name + aliases 都加入到自动机模式列表里，
    // 同时在一个 map 里记录：patternString → Role
    const patterns: string[] = [];
    for (const r of roles) {
        patterns.push(r.name);
        patternMap.set(r.name, r);

        for (const alias of r.aliases || []) {
            patterns.push(alias);
            patternMap.set(alias, r);
        }
    }

    // @ts-ignore
    ac = new AhoCorasick(patterns);
}

// 主更新函数
export function updateDecorations(editor?: vscode.TextEditor) {
    const active = editor || vscode.window.activeTextEditor;
    if (!active) return;

    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    const folders = vscode.workspace.workspaceFolders;

    // —— 跳过 敏感词/词汇库 文件（JSON5 & TXT） —— 
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

    // —— 清理旧的 hoverRanges & diagnostics —— 
    setHoverRanges([]);
    diagnosticCollection.delete(active.document.uri);

    // 确保自动机已构建
    initAutomaton();

    const doc = active.document;
    const text = doc.getText();
    const defaultColor = cfg.get<string>('defaultColor')!;


    // —— 全文 Aho–Corasick 搜索 & 安全收集 candidates —— 
    const hits = ac.search(text) as Array<[number, string]>;
    type Candidate = { role: Role; text: string; start: number; end: number };
    const candidates: Candidate[] = [];
    for (const [endIdx, pat] of hits) {
        // 1) 先 trim 一下，去掉左右空白
        const key = pat[0];
        // 2) O(1) 查表
        const role = patternMap.get(key);
        if (!role) {
            console.warn(`[AndreaNovelHelper] Unmatched pattern "${pat}"`);
            continue;
        }
        const startIdx = endIdx - key.length + 1;
        candidates.push({ role, text: key, start: startIdx, end: endIdx + 1 });
    }


    // —— 按长度降序 & 去重（最长优先） —— 
    candidates.sort((a, b) => b.text.length - a.text.length);
    const selected: Candidate[] = [];
    for (const c of candidates) {
        if (selected.some(s => rangesOverlap(s.start, s.end, c.start, c.end))) continue;
        selected.push(c);
    }

    // —— 分组 ranges & 收集 hoverRanges —— 
    const roleToRanges = new Map<Role, vscode.Range[]>();
    for (const c of selected) {
        const range = new vscode.Range(doc.positionAt(c.start), doc.positionAt(c.end));
        hoverRanges.push({ range, role: c.role });
        if (!roleToRanges.has(c.role)) roleToRanges.set(c.role, []);
        roleToRanges.get(c.role)!.push(range);
    }

    // 1) 对于之前创建过但这次没出现的角色，仅清空它的 ranges
    for (const [roleName, deco] of decorationTypes) {
        // 如果 roleToRanges 里没有这个角色名，说明它不再出现在文档里
        const stillHas = Array.from(roleToRanges.keys()).some(r => r.name === roleName);
        if (!stillHas) {
            active.setDecorations(deco, []);
        }
    }

    // 2) 对于文档里出现的角色，复用或创建 decorationType，更新 ranges
    for (const [role, ranges] of roleToRanges) {
        let deco = decorationTypes.get(role.name);
        if (!deco) {
            const color = role.color || typeColorMap[role.type] || defaultColor;
            deco = vscode.window.createTextEditorDecorationType({ color });
            decorationTypes.set(role.name, deco);
        }
        active.setDecorations(deco, ranges);
    }

    // —— 绘制装饰 & 敏感词诊断 —— 
    const diagnostics: vscode.Diagnostic[] = [];
    for (const [role, ranges] of roleToRanges) {
        // DecorationType 缓存 & 复用
        let deco = decorationTypes.get(role.name);
        if (!deco) {
            const color = role.color || typeColorMap[role.type] || defaultColor;
            deco = vscode.window.createTextEditorDecorationType({ color });
            decorationTypes.set(role.name, deco);
        }
        active.setDecorations(deco, ranges);

        // 敏感词诊断（跳过 .vscode/cspell-roles.txt）
        if (role.type === '敏感词' && folders?.length) {
            const root = folders[0].uri.fsPath;
            const cspellTxt = path.join(root, '.vscode', 'cspell-roles.txt');
            if (doc.uri.fsPath !== cspellTxt) {
                for (const range of ranges) {
                    const msg = `发现敏感词：${role.name}` + (role.description ? ` — ${role.description}` : '');
                    const diag = new vscode.Diagnostic(range, msg, vscode.DiagnosticSeverity.Warning);
                    diag.source = 'AndreaNovelHelper';
                    diagnostics.push(diag);
                }
            }
        }
    }

    if (diagnostics.length) {
        diagnosticCollection.set(doc.uri, diagnostics);
    } else {
        diagnosticCollection.delete(doc.uri);
    }
}
