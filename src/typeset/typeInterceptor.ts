import * as vscode from 'vscode';

// 仅在 markdown / plaintext 且（智慧切段或智慧跳出）任一开启时拦截
function shouldInterceptNewline(): boolean {
    const ed = vscode.window.activeTextEditor;
    if (!ed) { return false; }
    const id = ed.document.languageId;
    if (id !== 'markdown' && id !== 'plaintext') { return false; }

    const cfg = vscode.workspace.getConfiguration();
    const enableEnter = cfg.get<boolean>('andrea.typeset.enableSmartEnter', true);
    const enableExit = cfg.get<boolean>('andrea.typeset.enableSmartExit', true);
    return enableEnter || enableExit;
}

export function registerTypeInterceptor(ctx: vscode.ExtensionContext) {
    ctx.subscriptions.push(
        vscode.commands.registerCommand('type', async (args: { text: string }) => {
            // 仅拦截“换行”；其它字符全部回放到默认输入
            if (!args || args.text !== '\n' || !shouldInterceptNewline()) {
                await vscode.commands.executeCommand('default:type', args);
                return;
            }

            const ed = vscode.window.activeTextEditor;
            const doc = ed?.document;
            const beforeVersion = doc?.version;

            // 1) 先尝试“接受建议 / 接受内联建议”
            try {
                await vscode.commands.executeCommand('acceptSelectedSuggestion');
                await vscode.commands.executeCommand('editor.action.inlineSuggest.commit');
            } catch { /* ignore */ }

            // 若有建议被接受，文档 version 会变化；直接返回，不再处理换行
            if (doc && beforeVersion !== undefined && doc.version !== beforeVersion) {
                return;
            }

            // 2) 调用我们的智慧 Enter（其中已含 SmartExit / MAIO 路由 / 智慧切段）
            try {
                await vscode.commands.executeCommand('andrea.smartEnter');
                return;
            } catch { /* ignore */ }

            // 3) 兜底：回放默认换行
            await vscode.commands.executeCommand('default:type', args);
        })
    );
}
