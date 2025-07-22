/* eslint-disable curly */
import * as vscode from 'vscode';
import { hoverRanges, roles, setHoverRanges } from './activate';
import { Role } from './extension';
import { getSupportedLanguages, rangesOverlap, typeColorMap } from './utils';
import * as path from 'path';
import AhoCorasick from 'ahocorasick';

// —— Diagnostics 集合 —— 
const diagnosticCollection = vscode.languages.createDiagnosticCollection('AndreaNovelHelper SensitiveWords');

// —— Aho–Corasick 自动机 & 模式映射 —— 
let ac: AhoCorasick;
const patternMap = new Map<string, Role>();

// —— 装饰器元数据：角色名 → { deco, propsHash } —— 
interface DecoMeta { deco: vscode.TextEditorDecorationType; propsHash: string; }
const decorationMeta = new Map<string, DecoMeta>();

/**
 * 初始化（或重建）Aho–Corasick 自动机，
 * 并在 patternMap 里记录每个模式对应的 Role。
 */
export function initAutomaton() {
    patternMap.clear();
    const patterns: string[] = [];
    for (const r of roles) {
        const key = r.name;
        patterns.push(key);
        patternMap.set(key, r);
        for (const alias of r.aliases || []) {
            patterns.push(alias);
            patternMap.set(alias, r);
        }
    }
    // @ts-ignore
    ac = new AhoCorasick(patterns);
}

/**
 * 更新全文装饰与诊断。可对任意角色属性变化作出响应：
 * 当某角色的 color/type/affiliation/description 有改动时，
 * 会在下次调用时重建该角色的 TextEditorDecorationType。
 */
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

    // —— 确保自动机已构建 —— 
    initAutomaton();

    const doc = active.document;
    const text = doc.getText();
    const defaultColor = cfg.get<string>('defaultColor')!;

    // —— 全文 Aho–Corasick 搜索 & 收集候选 —— 
    const hits = ac.search(text) as Array<[number, string]>;
    type Candidate = { role: Role; text: string; start: number; end: number };
    const candidates: Candidate[] = [];

    for (const [endIdx, rawPat] of hits) {
        const key = rawPat[0];
        const role = patternMap.get(key);
        if (!role) continue;
        const startIdx = endIdx - key.length + 1;
        candidates.push({ role, text: key, start: startIdx, end: endIdx + 1 });
    }

    // —— 长度降序 & 去重（最长优先） —— 
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

    // —— 1) 清空不再出现角色的装饰 —— 
    for (const [roleName, meta] of decorationMeta) {
        if (![...roleToRanges.keys()].some(r => r.name === roleName)) {
            active.setDecorations(meta.deco, []);
        }
    }

    // —— 2) 对出现角色：属性未变复用，属性变了重建 —— 
    for (const [role, ranges] of roleToRanges) {
        // 收集所有关键字段
        const props = {
            color: role.color ?? typeColorMap[role.type] ?? defaultColor,
            type: role.type,
            affiliation: (role as any).affiliation ?? null,
            description: role.description ?? null
        };
        const propsHash = JSON.stringify(props);

        let deco: vscode.TextEditorDecorationType;
        const meta = decorationMeta.get(role.name);
        if (!meta || meta.propsHash !== propsHash) {
            // 属性变动或首次：销毁旧的、创建新的
            if (meta) meta.deco.dispose();
            deco = vscode.window.createTextEditorDecorationType({ color: props.color });
            decorationMeta.set(role.name, { deco, propsHash });
        } else {
            // 复用现有
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
                    const msg = `发现敏感词：${role.name}` +
                        (role.description ? ` — ${role.description}` : '');
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

    if (diagnostics.length > 0) {
        diagnosticCollection.set(doc.uri, diagnostics);
    } else {
        diagnosticCollection.delete(doc.uri);
    }
}
