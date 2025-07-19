/* eslint-disable curly */
import * as vscode from 'vscode';
import { decorationTypes, hoverRanges, roles, setHoverRanges } from "./activate";
import { Role } from "./extension";
import { escapeRegExp, getSupportedLanguages, rangesOverlap, typeColorMap } from "./utils";

export function updateDecorations(editor?: vscode.TextEditor) {
    const active = editor || vscode.window.activeTextEditor;
    if (!active) return;
    if (!getSupportedLanguages().includes(active.document.languageId)) return;

    const docText = active.document.getText();
    const defaultColor = vscode.workspace
        .getConfiguration('AndreaNovelHelper')
        .get<string>('defaultColor')!;

    // 1. 构建所有「模式」列表：包括主名和所有别名
    type Candidate = { role: Role; text: string; start: number; end: number };
    const candidates: Candidate[] = [];
    for (const r of roles) {
        const patterns = [r.name, ...(r.aliases || [])];
        for (const txt of patterns) {
            // 用前面讲过的 escapeRegExp 保证特殊字符安全
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

    // 2. 按「词条长度」降序排序
    candidates.sort((a, b) => b.text.length - a.text.length);

    // 3. 选出不重叠的匹配：越长的先入选，短的若与已选区间重叠就跳过
    const selected: Candidate[] = [];
    for (const c of candidates) {
        if (selected.some(s => rangesOverlap(s.start, s.end, c.start, c.end))) {
            continue;
        }
        selected.push(c);
    }

    // 4. 按角色收集范围 & 清理旧装饰
    decorationTypes.forEach(d => d.dispose());
    decorationTypes.clear();
    // 使用 setter 方法重置 hoverRanges
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

    // 5. 最后画装饰
    for (const [role, ranges] of roleToRanges) {
        const color = role.color || typeColorMap[role.type] || defaultColor;
        const deco = vscode.window.createTextEditorDecorationType({ color });
        active.setDecorations(deco, ranges);
        decorationTypes.set(role.name, deco);
    }
}