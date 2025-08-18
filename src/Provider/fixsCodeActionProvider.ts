import * as vscode from 'vscode';

/**
 * CodeActionProvider: 为敏感词诊断 (带 anhFixs) 提供替换 Quick Fix
 */
export class FixsCodeActionProvider implements vscode.CodeActionProvider {
    static readonly metadata: vscode.CodeActionProviderMetadata = {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
    };

    provideCodeActions(document: vscode.TextDocument, range: vscode.Range, context: vscode.CodeActionContext): vscode.ProviderResult<vscode.CodeAction[]> {
        const actions: vscode.CodeAction[] = [];
        for (const diag of context.diagnostics) {
            const anyDiag = diag as any;
            if (!Array.isArray(anyDiag.anhFixs)) { continue; }
            if (!diag.range.intersection(range)) { continue; }
            const fixs: string[] = anyDiag.anhFixs; // 诊断仍使用 anhFixs 元数据键名保持兼容
            const word = anyDiag.anhSensitiveWord || document.getText(diag.range);

            // 单项直接替换
            for (const f of fixs) {
                const act = new vscode.CodeAction(`替换为: ${f}`, vscode.CodeActionKind.QuickFix);
                act.diagnostics = [diag];
                act.edit = new vscode.WorkspaceEdit();
                act.edit.replace(document.uri, diag.range, f);
                act.isPreferred = false;
                actions.push(act);
            }

            // 聚合 QuickPick（避免太多 action 展开过长）
            if (fixs.length > 2) {
                const pickAct = new vscode.CodeAction('选择其它替换…', vscode.CodeActionKind.QuickFix);
                pickAct.diagnostics = [diag];
                pickAct.command = {
                    title: '选择替换',
                    command: 'andreaNovelHelper.pickFixReplacement',
                    arguments: [document.uri, diag.range, fixs, word]
                };
                actions.push(pickAct);
            }
        }
        return actions;
    }
}

export function registerFixsCodeAction(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider({ scheme: 'file' }, new FixsCodeActionProvider(), FixsCodeActionProvider.metadata)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('andreaNovelHelper.pickFixReplacement', async (uri: vscode.Uri, range: vscode.Range, fixs: string[], word: string) => {
            const picked = await vscode.window.showQuickPick(fixs, { placeHolder: `替换敏感词 “${word}”` });
            if (!picked) { return; }
            const doc = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(doc, { preserveFocus: true, preview: false });
            await editor.edit(edit => edit.replace(range, picked));
        })
    );
}
