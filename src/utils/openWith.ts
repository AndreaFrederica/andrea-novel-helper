import * as vscode from 'vscode';
import * as path from 'path';

/** 执行具体的打开动作 */
export async function executeOpenAction(action: string, uri: vscode.Uri): Promise<void> {
    switch (action) {
        case 'vscode':
            await vscode.window.showTextDocument(uri);
            break;
        case 'vscode-new':
            try {
                await vscode.commands.executeCommand('vscode.openWith', uri, 'default', vscode.ViewColumn.Beside);
            } catch {
                await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.Beside });
            }
            break;
        case 'system-default':
            await vscode.env.openExternal(uri);
            break;
        case 'explorer':
            await vscode.commands.executeCommand('revealFileInOS', uri);
            break;
        default:
            await vscode.window.showTextDocument(uri);
            break;
    }
}

/** 调用 VS Code 内置 openWith，失败时回退到自定义 QuickPick */
export async function showOpenWith(uri: vscode.Uri) : Promise<void> {
    try {
        await vscode.commands.executeCommand('explorer.openWith', uri);
    } catch (error) {
        const fileName = path.basename(uri.fsPath);
        const options = [
            { label: 'VS Code 编辑器', description: '在当前编辑器中打开', action: 'vscode' },
            { label: 'VS Code 新窗口', description: '在新的 VS Code 窗口中打开', action: 'vscode-new' },
            { label: '系统默认程序', description: '使用系统默认关联程序打开', action: 'system-default' },
            { label: '文件资源管理器', description: '在文件资源管理器中显示', action: 'explorer' }
        ];
        const selected = await vscode.window.showQuickPick(options, {
            placeHolder: `选择打开 ${fileName} 的方式`,
            title: '打开方式'
        });
        if (selected) {
            await executeOpenAction(selected.action, uri);
        }
    }
}

/** 只注册一次 openWith 命令（若已注册则跳过） */
export async function ensureRegisterOpenWith(context: vscode.ExtensionContext) {
    const cmds = await vscode.commands.getCommands(true);
    if (cmds.includes('AndreaNovelHelper.openWith')) { return; }
    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.openWith', async (node: any) => {
            const uri: vscode.Uri = node?.resourceUri || node?.uri || node;
            if (!(uri instanceof vscode.Uri)) { return; }
            await showOpenWith(uri);
        })
    );
}
