import * as vscode from 'vscode';
import { hoverRanges } from '../activate';

/**
 * CodeActionProvider: 为敏感词诊断 (带 anhFixs) 提供替换 Quick Fix
 * 同时为所有具有 fixes 的角色提供替换选项（不依赖诊断）
 */
export class FixsCodeActionProvider implements vscode.CodeActionProvider {
    static readonly metadata: vscode.CodeActionProviderMetadata = {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.Refactor]
    };

    provideCodeActions(document: vscode.TextDocument, range: vscode.Range, context: vscode.CodeActionContext): vscode.ProviderResult<vscode.CodeAction[]> {
        const actions: vscode.CodeAction[] = [];
        
        // 1. 处理基于诊断的修复（敏感词警告）
        for (const diag of context.diagnostics) {
            const anyDiag = diag as any;
            if (!Array.isArray(anyDiag.anhFixs)) { continue; }
            if (!diag.range.intersection(range)) { continue; }
            const fixs: string[] = anyDiag.anhFixs; // 诊断仍使用 anhFixs 元数据键名保持兼容
            const word = anyDiag.anhSensitiveWord || document.getText(diag.range);

            // 单项直接替换
            for (const f of fixs) {
                const act = new vscode.CodeAction(`🔧 替换为: ${f}`, vscode.CodeActionKind.QuickFix);
                act.diagnostics = [diag];
                act.edit = new vscode.WorkspaceEdit();
                act.edit.replace(document.uri, diag.range, f);
                act.isPreferred = false;
                actions.push(act);
            }

            // 聚合 QuickPick（避免太多 action 展开过长）
            if (fixs.length > 2) {
                const pickAct = new vscode.CodeAction('🔧 选择其它替换…', vscode.CodeActionKind.QuickFix);
                pickAct.diagnostics = [diag];
                pickAct.command = {
                    title: '选择替换',
                    command: 'andreaNovelHelper.pickFixReplacement',
                    arguments: [document.uri, diag.range, fixs, word]
                };
                actions.push(pickAct);
            }
        }

        // 2. 处理非诊断的角色替换（所有具有 fixes 的角色）
        for (const hoverRange of hoverRanges) {
            if (!hoverRange.range.intersection(range)) { continue; }
            
            const role = hoverRange.role;
            const fixesArr: string[] | undefined = (role as any).fixes || (role as any).fixs;
            if (!Array.isArray(fixesArr) || fixesArr.length === 0) { continue; }

            const currentText = document.getText(hoverRange.range);
            
            // 过滤掉当前已经是的选项（避免重复）
            const availableFixes = fixesArr.filter(fix => fix !== currentText);
            if (availableFixes.length === 0) { continue; }

            // 为每个可用的替换选项创建 CodeAction
            for (const fix of availableFixes) {
                const act = new vscode.CodeAction(`💡 替换为: ${fix}`, vscode.CodeActionKind.Refactor);
                act.edit = new vscode.WorkspaceEdit();
                act.edit.replace(document.uri, hoverRange.range, fix);
                act.isPreferred = false;
                actions.push(act);
            }

            // 如果有多个选项，提供聚合选择
            if (availableFixes.length > 2) {
                const pickAct = new vscode.CodeAction('💡 选择替换选项…', vscode.CodeActionKind.Refactor);
                pickAct.command = {
                    title: '选择替换',
                    command: 'andreaNovelHelper.pickFixReplacement',
                    arguments: [document.uri, hoverRange.range, availableFixes, role.name]
                };
                actions.push(pickAct);
            }
        }

        // 3. 处理别名替换（为所有角色提供主名/别名之间的切换）
        for (const hoverRange of hoverRanges) {
            if (!hoverRange.range.intersection(range)) { continue; }
            
            const role = hoverRange.role;
            const aliases = role.aliases || [];
            if (aliases.length === 0) { continue; } // 没有别名则跳过

            const currentText = document.getText(hoverRange.range);
            
            // 构建所有可用的替换选项：主名 + 别名
            const allOptions = [role.name, ...aliases];
            const availableAliases = allOptions.filter(option => option !== currentText);
            if (availableAliases.length === 0) { continue; }

            // 为每个可用的别名选项创建 CodeAction
            for (const alias of availableAliases) {
                const act = new vscode.CodeAction(`🔄 替换为: ${alias}`, vscode.CodeActionKind.Refactor);
                act.edit = new vscode.WorkspaceEdit();
                act.edit.replace(document.uri, hoverRange.range, alias);
                act.isPreferred = false;
                actions.push(act);
            }

            // 如果有多个别名选项，提供聚合选择
            if (availableAliases.length > 2) {
                const pickAct = new vscode.CodeAction('🔄 选择别名…', vscode.CodeActionKind.Refactor);
                pickAct.command = {
                    title: '选择别名',
                    command: 'andreaNovelHelper.pickFixReplacement',
                    arguments: [document.uri, hoverRange.range, availableAliases, `${role.name} 别名`]
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
