// src/keybindings/keybindingsIO.ts
import * as vscode from 'vscode';
import * as jsonc from 'jsonc-parser';

/** VS Code 用户 keybindings.json 的文档对象 */
export interface KeybindingsDoc {
    doc: vscode.TextDocument;
    uri: vscode.Uri;
    text: string;
}

/** 键位规则（与 keybindings.json 的元素一致，保留最常用字段） */
export interface KeybindingRule {
    key?: string;
    command: string;
    when?: string;
    args?: any;
}

/**
 * 打开“用户键位 JSON”（当前 Profile 的 keybindings.json），并返回 TextDocument。
 * - 通过命令 `workbench.action.openGlobalKeybindingsFile` 打开（官方内置）
 * - 返回的 URI 可能是 vscode-userdata:/...，不一定是 file:/...
 */
export async function openUserKeybindingsDoc(): Promise<KeybindingsDoc> {
    // 打开用户层 keybindings.json（而非默认只读）
    await vscode.commands.executeCommand('workbench.action.openGlobalKeybindingsFile'); // 打开/聚焦到该文件
    const ed = vscode.window.activeTextEditor;
    if (!ed) {
        throw new Error('未能获取到活动编辑器（keybindings.json）。');
    }
    const { document: doc } = ed;

    // 经验：这里可能是 vscode-userdata:/User/profiles/<id>/keybindings.json
    if (!/keybindings\.json$/i.test(doc.uri.path)) {
        throw new Error(`当前活动文档不是 keybindings.json：${doc.uri.toString(true)}`);
    }

    return { doc, uri: doc.uri, text: doc.getText() };
}

/** 解析 keybindings.json（JSONC，允许注释与尾逗号），返回规则数组 */
export function parseKeybindingsText(text: string): KeybindingRule[] {
    const errors: jsonc.ParseError[] = [];
    const data = jsonc.parse(text, errors);
    if (errors.length) {
        const msg = errors.map(e => `${jsonc.printParseErrorCode(e.error)} @${e.offset}`).join('; ');
        throw new Error(`keybindings.json 语法错误：${msg}`);
    }
    if (!Array.isArray(data)) {
        // 正常 keybindings.json 的根应为数组
        return [];
    }
    return data as KeybindingRule[];
}

/** 将规则数组序列化为 JSONC 文本，保持与当前文档一致的换行符风格 */
export function stringifyKeybindings(
    rules: KeybindingRule[],
    eol: vscode.EndOfLine = vscode.EndOfLine.LF
): string {
    const lineEnd = eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    // 使用 JSON.stringify 序列化，缩进 2 空格
    const text = JSON.stringify(rules, null, 2).replace(/\n/g, lineEnd);
    return text.endsWith(lineEnd) ? text : text + lineEnd;
}

/**
 * 读取当前 Profile 的 keybindings.json → 返回 { doc, rules, text }
 */
export async function readUserKeybindings(): Promise<{
    doc: vscode.TextDocument;
    rules: KeybindingRule[];
    text: string;
}> {
    const { doc, text } = await openUserKeybindingsDoc();
    const rules = parseKeybindingsText(text);
    return { doc, rules, text };
}

/**
 * 将新的规则数组写回到同一份 keybindings.json。
 * - 使用 WorkspaceEdit 覆盖整份文档内容，兼容 vscode-userdata:/ 与远程场景
 * - 写入后保存文档
 */
export async function writeUserKeybindings(
    doc: vscode.TextDocument,
    rules: KeybindingRule[]
): Promise<void> {
    const original = doc.getText();
    const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(original.length));
    const nextText = stringifyKeybindings(rules, doc.eol);

    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, fullRange, nextText);

    const ok = await vscode.workspace.applyEdit(edit);
    if (!ok) { throw new Error('applyEdit 失败：无法写入 keybindings.json。'); }

    await doc.save();
}

/* ===================== 示例：小工具函数 ===================== */

/**
 * 在规则数组尾部添加一条规则（如已存在同 key+command 的则替换）
 */
export function upsertRule(rules: KeybindingRule[], rule: KeybindingRule): KeybindingRule[] {
    const keyNorm = (rule.key ?? '').toLowerCase();
    const out: KeybindingRule[] = [];
    let replaced = false;

    for (const r of rules) {
        const same =
            (r.command === rule.command) &&
            ((r.key ?? '').toLowerCase() === keyNorm);
        if (same) {
            out.push(rule);
            replaced = true;
        } else {
            out.push(r);
        }
    }
    if (!replaced) { out.push(rule); }
    return out;
}

/**
 * 移除匹配 command（与可选 key）的规则（含 "-command" 这种“移除规则”也可由你自行添加）
 */
export function removeRule(
    rules: KeybindingRule[],
    command: string,
    key?: string
): KeybindingRule[] {
    const keyNorm = (key ?? '').toLowerCase();
    return rules.filter(r => {
        const sameCmd = r.command === command;
        if (!sameCmd) { return true; }
        if (!key) { return false; }
        return (r.key ?? '').toLowerCase() !== keyNorm;
    });
}


/* ===================== 示例：实际调用 ===================== */
/*
import { readUserKeybindings, writeUserKeybindings, upsertRule, removeRule } from './keybindingsIO';

export async function demoPatch() {
  const { doc, rules } = await readUserKeybindings();

  // 例：移除 MAIO 的 Enter
  const MAIO_ENTER = 'markdown.extension.onEnterKey';
  let next = removeRule(rules, MAIO_ENTER);            // 移除同 command 的所有按键
  next.push({ command: `-${MAIO_ENTER}`, key: 'enter' }); // 加一条“移除规则”

  // 例：添加我们的 Enter
  next = upsertRule(next, {
    key: 'enter',
    command: 'andrea.smartEnter',
    when: "editorTextFocus && !suggestWidgetVisible && !inlineSuggestionVisible"
  });

  await writeUserKeybindings(doc, next);
}
*/
