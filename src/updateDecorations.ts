/* eslint-disable curly */
import * as vscode from 'vscode';
import { decorationTypes, hoverRanges, roles, setHoverRanges } from "./activate";
import { Role } from "./extension";
import { escapeRegExp, getSupportedLanguages, rangesOverlap, typeColorMap } from "./utils";
import * as path from 'path';

// 新增：模块级 DiagnosticCollection，用于存放敏感词的错误信息
const diagnosticCollection = vscode.languages.createDiagnosticCollection('AndreaNovelHelper SensitiveWords');

export function updateDecorations(editor?: vscode.TextEditor) {
    const active = editor || vscode.window.activeTextEditor;
    if (!active) return;

    // 判断当前文档是否为敏感词库/词汇库文件（JSON5 和 TXT 版），如果是，则不执行 updateDecorations
    const docPath = active.document.uri.fsPath;
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length) {
        const root = folders[0].uri.fsPath;
        const sensitiveWordsFile = path.join(root, cfg.get<string>('sensitiveWordsFile')!);
        const vocabularyFile = path.join(root, cfg.get<string>('vocabularyFile')!);
        const sensitiveWordsTxt = sensitiveWordsFile.replace(/\.[^/.]+$/, ".txt");
        const vocabularyTxt = vocabularyFile.replace(/\.[^/.]+$/, ".txt");
        if (docPath === sensitiveWordsFile || docPath === vocabularyFile ||
            docPath === sensitiveWordsTxt || docPath === vocabularyTxt) {
            // console.log(`updateDecorations: 当前文档 [${docPath}] 属于敏感词/词汇库，不执行装饰更新`);
            return;
        }
    }

    if (!getSupportedLanguages().includes(active.document.languageId)) return;

    const docText = active.document.getText();
    const defaultColor = cfg.get<string>('defaultColor')!;

    // 1. 构建所有「模式」列表：包括主名和所有别名
    type Candidate = { role: Role; text: string; start: number; end: number };
    const candidates: Candidate[] = [];
    for (const r of roles) {
        const patterns = [r.name, ...(r.aliases || [])];
        for (const txt of patterns) {
            const regex = new RegExp(escapeRegExp(txt), 'g');
            let m: RegExpExecArray | null;
            while ((m = regex.exec(docText))) {
                candidates.push({
                    role: r,
                    text: txt,
                    start: m.index,
                    end: m.index + m[0].length
                });
            }
        }
    }

    candidates.sort((a, b) => b.text.length - a.text.length);
    const selected: Candidate[] = [];
    for (const c of candidates) {
        if (selected.some(s => rangesOverlap(s.start, s.end, c.start, c.end))) {
            continue;
        }
        selected.push(c);
    }

    decorationTypes.forEach(d => d.dispose());
    decorationTypes.clear();
    setHoverRanges([]);

    const roleToRanges = new Map<Role, vscode.Range[]>();
    for (const c of selected) {
        const range = new vscode.Range(
            active.document.positionAt(c.start),
            active.document.positionAt(c.end)
        );
        hoverRanges.push({ range, role: c.role });
        if (!roleToRanges.has(c.role)) roleToRanges.set(c.role, []);
        roleToRanges.get(c.role)!.push(range);
    }

    const diagnostics: vscode.Diagnostic[] = [];
    for (const [role, ranges] of roleToRanges) {
        const color = role.color || typeColorMap[role.type] || defaultColor;
        const deco = vscode.window.createTextEditorDecorationType({ color });
        active.setDecorations(deco, ranges);
        decorationTypes.set(role.name, deco);
        if (role.type === "敏感词") {

            const rootPath = folders?.[0]?.uri.fsPath;
            if (!rootPath) return;
            const vscodeDir = path.join(rootPath, '.vscode');
            const cspeelPath = path.join(vscodeDir, 'cspell-roles.txt');
            const docPath = active.document.uri.fsPath;
            if (docPath !== cspeelPath) {
                // 只在非 cSpell 字典文件中添加敏感词诊断
                if (folders && folders.length) {
                    const root = folders[0].uri.fsPath;
                    const sensitiveWordsFile = path.join(root, cfg.get<string>('sensitiveWordsFile')!);
                    const vocabularyFile = path.join(root, cfg.get<string>('vocabularyFile')!);
                    for (const range of ranges) {
                        const msg = `发现了敏感词 ${role.name}` + (role.description ? `: ${role.description}` : '');
                        const diagnostic = new vscode.Diagnostic(range, msg, vscode.DiagnosticSeverity.Warning);
                        diagnostic.source = 'AndreaNovelHelper';
                        diagnostics.push(diagnostic);
                    }
                }
            }
        }
        diagnosticCollection.set(active.document.uri, diagnostics);
    }
}