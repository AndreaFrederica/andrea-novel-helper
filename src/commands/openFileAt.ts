import * as vscode from 'vscode';

/**
 * 注册并导出打开文件并定位的命令：andrea.openFileAt
 * 支持三种参数格式：
 *  - Array: [fsPath, line, char]
 *  - (fsPath, line, char)
 *  - Object: { fsPath, line, character }
 */
export async function ensureRegisterOpenFileAt(context: vscode.ExtensionContext) {
    const cmds = await vscode.commands.getCommands(true);
    if (cmds.includes('andrea.openFileAt')) { return; }

    context.subscriptions.push(
        vscode.commands.registerCommand('andrea.openFileAt', async (pathOrArgs: any, line?: any, char?: any) => {
            // Debug: log raw received parameters to help diagnose incoming URI/args
            try {
                console.log('[andrea.openFileAt] raw args:', JSON.stringify({ pathOrArgs, line, char }));
            } catch (e) {
                console.log('[andrea.openFileAt] raw args (non-serializable):', pathOrArgs, line, char);
            }
            let fsPath: string | undefined;
            let ln = 0, ch = 0;

            if (Array.isArray(pathOrArgs)) {
                fsPath = String(pathOrArgs[0]);
                ln = Number(pathOrArgs[1] ?? 0);
                ch = Number(pathOrArgs[2] ?? 0);
            } else if (typeof pathOrArgs === 'string') {
                fsPath = pathOrArgs;
                ln = Number(line ?? 0);
                ch = Number(char ?? 0);
            } else if (pathOrArgs && typeof pathOrArgs === 'object') {
                fsPath = String(pathOrArgs.fsPath || pathOrArgs.path || pathOrArgs.uri || pathOrArgs[0]);
                ln = Number(pathOrArgs.line ?? pathOrArgs.lineNumber ?? 0);
                ch = Number(pathOrArgs.character ?? pathOrArgs.char ?? 0);
            }

            if (!fsPath) {
                vscode.window.showErrorMessage('[andrea.openFileAt] 缺少 fsPath');
                return;
            }

            try {
                const target = vscode.Uri.file(fsPath);
                const doc = await vscode.workspace.openTextDocument(target);
                const editor = await vscode.window.showTextDocument(doc, { preview: false });
                const pos = new vscode.Position(Math.max(0, ln || 0), Math.max(0, ch || 0));
                editor.selection = new vscode.Selection(pos, pos);
                editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
            } catch (e) {
                console.error('[andrea.openFileAt] 打开并定位失败', e);
                vscode.window.showErrorMessage('[andrea.openFileAt] 打开并定位失败');
            }
        })
    );
}

export default ensureRegisterOpenFileAt;
