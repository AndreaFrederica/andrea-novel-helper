/* eslint-disable curly */
import * as vscode from 'vscode';
import { decorationTypes, hoverRanges, roles, setHoverRanges } from "./activate";
import { Role } from "./extension";
import { escapeRegExp, getSupportedLanguages, rangesOverlap, typeColorMap } from "./utils";
import * as path from 'path';

// 模块级 DiagnosticCollection，用于存放敏感词的警告
const diagnosticCollection = vscode.languages.createDiagnosticCollection('AndreaNovelHelper SensitiveWords');

export function updateDecorations(editor?: vscode.TextEditor) {
    const active = editor || vscode.window.activeTextEditor;
    if (!active) return;

    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    const folders = vscode.workspace.workspaceFolders;

    // —— 跳过对敏感词/词汇库文件（JSON5 & TXT）的装饰与诊断 —— 
    if (folders && folders.length) {
        const root = folders[0].uri.fsPath;
        const sensitiveWordsFile = path.join(root, cfg.get<string>('sensitiveWordsFile')!);
        const vocabularyFile = path.join(root, cfg.get<string>('vocabularyFile')!);
        const sensitiveWordsTxt = sensitiveWordsFile.replace(/\.[^/.]+$/, ".txt");
        const vocabularyTxt = vocabularyFile.replace(/\.[^/.]+$/, ".txt");
        const docPath = active.document.uri.fsPath;
        if (
            docPath === sensitiveWordsFile ||
            docPath === vocabularyFile ||
            docPath === sensitiveWordsTxt ||
            docPath === vocabularyTxt
        ) {
            return;
        }
    }

    if (!getSupportedLanguages().includes(active.document.languageId)) return;

    // —— 0. 每次先清空旧的 diagnostics —— 
    diagnosticCollection.delete(active.document.uri);

    const docText = active.document.getText();
    const defaultColor = cfg.get<string>('defaultColor')!;

    // —— 1. 构建所有匹配候选项 —— 
    type Candidate = { role: Role; text: string; start: number; end: number };
    const candidates: Candidate[] = [];
    for (const r of roles) {
        const patterns = [r.name, ...(r.aliases || [])];
        for (const txt of patterns) {
            const re = new RegExp(escapeRegExp(txt), 'g');
            let m: RegExpExecArray | null;
            while (m = re.exec(docText)) {
                candidates.push({
                    role: r,
                    text: txt,
                    start: m.index,
                    end: m.index + m[0].length
                });
            }
        }
    }

    // —— 2. 按文本长度降序 & 去重（最长优先） —— 
    candidates.sort((a, b) => b.text.length - a.text.length);
    const selected: Candidate[] = [];
    for (const c of candidates) {
        if (selected.some(s => rangesOverlap(s.start, s.end, c.start, c.end))) continue;
        selected.push(c);
    }

    // —— 3. 清理旧装饰 & hoverRanges —— 
    decorationTypes.forEach(d => d.dispose());
    decorationTypes.clear();
    setHoverRanges([]);

    // —— 4. 按角色分组 ranges —— 
    const roleToRanges = new Map<Role, vscode.Range[]>();
    for (const c of selected) {
        const startPos = active.document.positionAt(c.start);
        const endPos = active.document.positionAt(c.end);
        const range = new vscode.Range(startPos, endPos);
        hoverRanges.push({ range, role: c.role });
        if (!roleToRanges.has(c.role)) roleToRanges.set(c.role, []);
        roleToRanges.get(c.role)!.push(range);
    }

    // —— 5. 绘制装饰 & 收集敏感词 diagnostics —— 
    const diagnostics: vscode.Diagnostic[] = [];
    for (const [role, ranges] of roleToRanges) {
        // 普通装饰
        const color = role.color || typeColorMap[role.type] || defaultColor;
        const deco = vscode.window.createTextEditorDecorationType({ color });
        active.setDecorations(deco, ranges);
        decorationTypes.set(role.name, deco);

        // 敏感词专属诊断
        if (role.type === "敏感词") {
            // 只在非 cSpell 字典文件中添加敏感词诊断
            if (folders && folders.length) {
                const root = folders[0].uri.fsPath;
                const sensitiveWordsFile = path.join(root, cfg.get<string>('sensitiveWordsFile')!);
                const vocabularyFile = path.join(root, cfg.get<string>('vocabularyFile')!);
                const vscodeDir = path.join(root, '.vscode');
                const cspellPath = path.join(vscodeDir, 'cspell-roles.txt');
                const currentDoc = active.document.uri.fsPath;

                if (currentDoc !== cspellPath) {
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
    }

    // —— 6. 最后一次性更新或清除 diagnostics —— 
    if (diagnostics.length > 0) {
        diagnosticCollection.set(active.document.uri, diagnostics);
    } else {
        diagnosticCollection.delete(active.document.uri);
    }
}
