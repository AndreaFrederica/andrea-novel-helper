import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

let currentPanel: vscode.WebviewPanel | undefined;
let extensionPath: string = '';

export function registerGuidePage(context: vscode.ExtensionContext): void {
    extensionPath = context.extensionPath;

    context.subscriptions.push(
        vscode.commands.registerCommand('AndreaNovelHelper.showGuide', async () => {
            if (currentPanel) {
                currentPanel.reveal(vscode.ViewColumn.Active);
                return;
            }

            const panel = vscode.window.createWebviewPanel(
                'andrea.guide',
                '功能引导',
                vscode.ViewColumn.Active,
                { enableScripts: true, retainContextWhenHidden: true }
            );
            currentPanel = panel;
            panel.webview.html = getGuideHtml(panel.webview);
            panel.onDidDispose(() => { currentPanel = undefined; }, undefined, context.subscriptions);
            panel.webview.onDidReceiveMessage(async message => {
                if (message?.command === 'executeCommand' && message.id) {
                    try {
                        await vscode.commands.executeCommand(message.id);
                    } catch (err) {
                        const text = err instanceof Error ? err.message : String(err);
                        vscode.window.showErrorMessage(`执行命令失败: ${text}`);
                    }
                } else if (message?.command === 'openAnhSettings') {
                    await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:AndreaFrederica.andrea-novel-helper');
                } else if (message?.command === 'openVSCodeSettings') {
                    await vscode.commands.executeCommand('workbench.action.openSettings');
                }
            }, undefined, context.subscriptions);
        })
    );
}

function getGuideHtml(webview: vscode.Webview): string {
    const nonce = generateNonce();
    const mediaDir = vscode.Uri.file(path.join(extensionPath, 'media'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaDir, 'guide.js'));
    const htmlPath = path.join(extensionPath, 'media', 'guide.html');
    const template = fs.readFileSync(htmlPath, 'utf8');
    return template
        .replace(/__CSP_SOURCE__/g, webview.cspSource)
        .replace(/__NONCE__/g, nonce)
        .replace(/__SCRIPT_URI__/g, scriptUri.toString());
}

function generateNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < 32; i++) {
        out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
}
