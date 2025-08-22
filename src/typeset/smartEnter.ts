import * as vscode from 'vscode';
import { isSupportedDoc, getIndentUnit, trimTrailingSpacesIfNeeded } from './core/utils';
import { getPairsFromConfig } from './core/pairs';
import { matchesMaioEnterContext, forwardEnterToMaioOrNative } from './core/maioRoute';

function nextIsClosing(doc: vscode.TextDocument, pos: vscode.Position, closings: Set<string>): boolean {
    const ch = doc.getText(new vscode.Range(pos, pos.translate(0, 1)));
    return closings.has(ch);
}

export async function smartEnterImpl() {
    const ed = vscode.window.activeTextEditor;
    if (!ed) { return; }
    const doc = ed.document;

    if (!isSupportedDoc(doc)) {
        await forwardEnterToMaioOrNative();
        return;
    }

    const cfg = vscode.workspace.getConfiguration();
    const enableSmartEnter = cfg.get<boolean>('andrea.typeset.enableSmartEnter', true);
    const enableSmartExit  = cfg.get<boolean>('andrea.typeset.enableSmartExit', true);

    const N = Math.max(0, cfg.get<number>('andrea.typeset.blankLinesBetweenParas', 1) ?? 1);
    const indent = getIndentUnit(ed);

    const pairs = getPairsFromConfig();
    const closingSet = new Set(pairs.map(p => p.close));

    // 1) 智慧“跳出括号/引号”
    if (enableSmartExit) {
        const moved: vscode.Selection[] = [];
        let touched = false;
        for (const sel of ed.selections) {
            const p = sel.active;
            if (nextIsClosing(doc, p, closingSet)) {
                touched = true;
                const after = p.translate(0, 1);
                moved.push(new vscode.Selection(after, after));
            } else {
                moved.push(sel.isEmpty ? sel : new vscode.Selection(sel.active, sel.active));
            }
        }
        if (touched) {
            ed.selections = moved;
            return;
        }
    }

    // 2) MAIO 场景
    if (matchesMaioEnterContext(ed)) {
        await forwardEnterToMaioOrNative();
        return;
    }

    // 2.5) 行空白 / 行中间 / 光标前全是空白（且右边有字） → 原生回车
    if (ed.selections.some(sel => {
        const p = sel.active;
        const lineText = doc.lineAt(p.line).text;
        const left  = lineText.slice(0, p.character);
        const right = lineText.slice(p.character);

        const blankLine   = /^\s*$/.test(lineText);                 // 整行空白
        const middleLine  = /\S/.test(left) && /\S/.test(right);    // 左右都有文字
        const onlySpaces  = !/\S/.test(left) && /\S/.test(right);   // 光标前全是空白且右边有字

        return blankLine || middleLine || onlySpaces;
    })) {
        await vscode.commands.executeCommand('type', { text: '\n' });
        return;
    }

    // 3) 智慧切段（光标在 edit 之后再设置）
    if (enableSmartEnter) {
        // 先根据“原文档”计算每个光标应插入多少空行与新光标位置
        const plan = ed.selections.map(sel => {
            const p = sel.active;
            // 统计后续已有的空白行数（最多 N 行），避免重复插入
            let extra = N;
            // for (let i = 1; i <= N; i++) {
            //     const ln = p.line + i;
            //     if (ln < doc.lineCount) {
            //         const t = doc.lineAt(ln).text;
            //         if (/^\s*$/.test(t)) {
            //             extra--;            // 已有空白行就少插一行
            //         }
            //     }
            // }
            const insertText = '\n' + '\n'.repeat(extra) + indent;
            const newSel = new vscode.Selection(
                p.line + 1 + extra, indent.length,
                p.line + 1 + extra, indent.length
            );
            return { pos: p, insertText, newSel };
        });

        const ok = await ed.edit(edit => {
            for (const item of plan) {
                trimTrailingSpacesIfNeeded(edit, doc, item.pos.line);
                edit.insert(item.pos, item.insertText);
            }
        });

        if (ok) {
            // 重要：在编辑完成后再更新 selections，避免行号错位
            ed.selections = plan.map(x => x.newSel);
        }
        return;
    }

    // 4) 兜底：原生回车
    await vscode.commands.executeCommand('type', { text: '\n' });
}


export function registerSmartEnter(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('andrea.smartEnter', smartEnterImpl)
    );
}
