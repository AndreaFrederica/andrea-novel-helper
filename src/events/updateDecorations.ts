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

// —— 装饰器元数据：角色名 → { deco, propsHash } —— 
interface DecoMeta {
    deco: vscode.TextEditorDecorationType;
    propsHash: string;
}
const decorationMeta = new Map<string, DecoMeta>();

/** 初始化（或重建）自动机 & patternMap */
export function initAutomaton() {
    patternMap.clear();
    const patterns: string[] = [];
    for (const r of roles) {
        const nameKey = r.name.trim().normalize('NFC');
        patterns.push(nameKey); patternMap.set(nameKey, r);
        for (const alias of r.aliases || []) {
            const a = alias.trim().normalize('NFC');
            patterns.push(a); patternMap.set(a, r);
        }
    }
    // @ts-ignore
    ac = new AhoCorasick(patterns);
}

/** 比较两个 Range 数组是否相同 */
function rangesEqual(a: vscode.Range[], b: vscode.Range[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++)
        if (!a[i].isEqual(b[i])) return false;
    return true;
}

/** 仅在 color/type 变化时（或新增/删除角色时）更新所有 DecorationType */
function ensureDecorationTypes() {
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    const defaultColor = cfg.get<string>('defaultColor')!;
    // 1) 计算每个角色当前应有的 propsHash
    const newHashMap = new Map<string, string>();
    for (const r of roles) {
        const color = r.color ?? typeColorMap[r.type] ?? defaultColor;
        const props = JSON.stringify({ color, type: r.type });
        newHashMap.set(r.name, props);
    }

    // 2) 更新已有的 & 新增缺失的
    for (const [roleName, propsHash] of newHashMap) {
        const prev = decorationMeta.get(roleName);
        if (!prev || prev.propsHash !== propsHash) {
            prev?.deco.dispose();
            const color = JSON.parse(propsHash).color as string;
            const deco = vscode.window.createTextEditorDecorationType({ color });
            decorationMeta.set(roleName, { deco, propsHash });
        }
    }

    // 3) 删除多余的
    for (const oldName of Array.from(decorationMeta.keys())) {
        if (!newHashMap.has(oldName)) {
            decorationMeta.get(oldName)!.deco.dispose();
            decorationMeta.delete(oldName);
        }
    }
}

/** 遍历所有可见编辑器，更新装饰 & 诊断 */
export function updateDecorations() {
    // 先确保 DecorationType 同步最新
    ensureDecorationTypes();

    // 每个可见编辑器单独处理
    for (const editor of vscode.window.visibleTextEditors) {
        const doc = editor.document;
        // 过滤语言 & 词库文件
        if (!getSupportedLanguages().includes(doc.languageId)) continue;
        const folders = vscode.workspace.workspaceFolders;
        if (folders?.length) {
            const root = folders[0].uri.fsPath;
            const fileB = path.join(root, vscode.workspace
                .getConfiguration('AndreaNovelHelper')
                .get<string>('sensitiveWordsFile')!);
            const fileV = path.join(root, vscode.workspace
                .getConfiguration('AndreaNovelHelper')
                .get<string>('vocabularyFile')!);
            const txtB = fileB.replace(/\.[^/.]+$/, '.txt');
            const txtV = fileV.replace(/\.[^/.]+$/, '.txt');
            if ([fileB, fileV, txtB, txtV].includes(doc.uri.fsPath)) continue;
        }

        // 重置 hoverRanges
        setHoverRanges([]);

        // 重建自动机并搜索
        initAutomaton();
        const text = doc.getText();
        const rawHits = ac.search(text) as unknown as Array<[number, string | string[]]>;
        const hits: Array<[number, string[]]> = rawHits.map(([endIdx, pat]) => [
            endIdx, Array.isArray(pat) ? pat : [pat]
        ]);

        // 收集并去重 Candidate
        type Candidate = { role: Role; text: string; start: number; end: number };
        const candidates: Candidate[] = [];
        for (const [endIdx, arr] of hits) {
            for (const raw of arr) {
                const pat = raw.trim().normalize('NFC');
                const role = patternMap.get(pat);
                if (!role) continue;
                candidates.push({ role, text: pat, start: endIdx - pat.length + 1, end: endIdx + 1 });
            }
        }
        candidates.sort((a, b) => b.text.length - a.text.length);
        const selected: Candidate[] = [];
        for (const c of candidates) {
            if (selected.some(s => rangesOverlap(s.start, s.end, c.start, c.end))) continue;
            selected.push(c);
        }

        // 生成 role → ranges
        const roleToRanges = new Map<Role, vscode.Range[]>();
        for (const c of selected) {
            const range = new vscode.Range(doc.positionAt(c.start), doc.positionAt(c.end));
            hoverRanges.push({ range, role: c.role });
            if (!roleToRanges.has(c.role)) roleToRanges.set(c.role, []);
            roleToRanges.get(c.role)!.push(range);
        }

        // 1) 给出现的角色 setRanges
        for (const [role, ranges] of roleToRanges) {
            const meta = decorationMeta.get(role.name)!;
            editor.setDecorations(meta.deco, ranges);
        }
        // 2) 给没出现的角色 clear
        for (const [roleName, { deco }] of decorationMeta) {
            const appeared = [...roleToRanges.keys()].some(r => r.name === roleName);
            if (!appeared) editor.setDecorations(deco, []);
        }

        // —— 敏感词诊断 —— 
        const diagnostics: vscode.Diagnostic[] = [];
        const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
        for (const [role, ranges] of roleToRanges) {
            if (role.type === '敏感词' && folders?.length) {
                const root = folders![0].uri.fsPath;
                const cspellTxt = path.join(root, '.vscode', 'cspell-roles.txt');
                if (doc.uri.fsPath !== cspellTxt) {
                    for (const range of ranges) {
                        const base = `发现敏感词：${role.name}` +
                            (role.description ? ` ${role.description}` : '');
                        const lineNum = range.start.line + 1;
                        const lineText = doc.lineAt(range.start.line).text.trim();
                        const msg = `${base}\n第 ${lineNum} 行: ${lineText}`;
                        const diag = new vscode.Diagnostic(range, msg, vscode.DiagnosticSeverity.Warning);
                        diag.source = 'AndreaNovelHelper';
                        diagnostics.push(diag);
                    }
                }
            }
        }
        const key = doc.uri.fsPath;
        const old = prevDiagnostics.get(key) || [];
        const equal = old.length === diagnostics.length
            && old.every((d, i) =>
                d.message === diagnostics[i].message
                && d.range.isEqual(diagnostics[i].range)
                && d.severity === diagnostics[i].severity
            );
        if (!equal) {
            diagnostics.length
                ? diagnosticCollection.set(doc.uri, diagnostics)
                : diagnosticCollection.delete(doc.uri);
            prevDiagnostics.set(key, diagnostics.map(d => d));
        }
    }
}
