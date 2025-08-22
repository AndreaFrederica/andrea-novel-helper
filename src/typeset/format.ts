import * as vscode from 'vscode';
import { isSupportedDoc, normalizeBlankRuns } from './core/utils';

/**
 * 按设置应用“段首缩进”
 * - 以空行分段：非空行且上一行是空行/文件开头 → 段首
 * - 避开常见 Markdown 结构（标题/引用/列表/代码块/表格）
 * - 若已存在段首空格/Tab，先移除再按配置插入，避免叠加
 */
function applyFirstLineIndent(
    text: string,
    indentUnit: string,
    trimTrailing: boolean
): string {
    if (indentUnit.length === 0 && !trimTrailing) {
        return text;
    }

    const lines = text.split(/\r?\n/);
    const out: string[] = [];

    let inFencedCodeBlock = false;

    const isMdStructuralLine = (s: string): boolean => {
        const t = s.trim();
        if (!t) { return false; }
        if (/^```/.test(t)) { return true; }                        // 代码栅栏
        if (/^(#{1,6}\s+|>+\s+|\|)/.test(t)) { return true; }       // 标题/引用/表格
        if (/^(-|\*|\+)\s+/.test(t)) { return true; }               // 无序列表
        if (/^\d+(\.|\))\s+/.test(t)) { return true; }              // 有序列表
        return false;
    };

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];

        // 进入/退出 fenced code block
        if (/^\s*```/.test(line)) {
            inFencedCodeBlock = !inFencedCodeBlock;
        }

        // 去尾空格
        if (trimTrailing) {
            line = line.replace(/[ \t]+$/g, '');
        }

        const prev = i > 0 ? lines[i - 1] : '';
        const isParaFirst =
            !inFencedCodeBlock &&
            line.trim().length > 0 &&
            (i === 0 || prev.trim().length === 0);

        if (isParaFirst) {
            if (!isMdStructuralLine(line)) {
                // 去掉已有段首空白，避免累加
                line = line.replace(/^[ \t]+/, '');
                if (indentUnit.length > 0) {
                    line = indentUnit + line;
                }
            }
        }

        out.push(line);
    }

    return out.join('\n');
}

async function formatWholeDocument() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }

    const doc = editor.document;
    if (!isSupportedDoc(doc)) { return; }

    const cfg = vscode.workspace.getConfiguration();
    const blankLines = Math.max(0, cfg.get<number>('andrea.typeset.blankLinesBetweenParas', 1) ?? 1);
    const trimTrailing = cfg.get<boolean>('andrea.typeset.trimTrailingSpaces', true);

    // 优先取扩展配置 firstLineIndentSpaces
    const rawSpaces = cfg.get<number | string>('andrea.typeset.firstLineIndentSpaces');
    const nSpaces = rawSpaces === undefined ? NaN : Number(rawSpaces);

    let indentUnit = '';
    if (Number.isFinite(nSpaces)) {
        indentUnit = ' '.repeat(Math.max(0, nSpaces));
    } else {
        // 回退到编辑器缩进设置
        const opts = editor.options;
        const insertSpaces = opts.insertSpaces === true;
        const tabSize = typeof opts.tabSize === 'number' ? opts.tabSize : 4;
        indentUnit = insertSpaces ? ' '.repeat(tabSize) : '\t';
    }

    const fullRange = new vscode.Range(0, 0, doc.lineCount, 0);
    const original = doc.getText(fullRange);

    // 1) 规范段间空行 + 去尾空格
    const step1 = normalizeBlankRuns(original, blankLines, trimTrailing);

    // 2) 应用段首缩进
    const step2 = applyFirstLineIndent(step1, indentUnit, trimTrailing);

    if (step2 !== original) {
        await editor.edit(edit => edit.replace(fullRange, step2));
    }
}

export function registerFormat(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('andrea.formatDocument', formatWholeDocument)
    );
}
