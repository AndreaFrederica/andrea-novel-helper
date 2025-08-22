import * as vscode from 'vscode';

const CTX = 'andrea.typeset.smartEnterOn';
const SUPPORTED = new Set(['markdown', 'plaintext']); // 仅支持 md / txt

function isMdOrText(doc: vscode.TextDocument | undefined): boolean {
    if (!doc) { return false; }
    // languageId 区分大小写，官方标识为小写 'markdown' / 'plaintext'
    return SUPPORTED.has(doc.languageId);
}

export function registerContextKeys(ctx: vscode.ExtensionContext) {
    const update = () => {
        const doc = vscode.window.activeTextEditor?.document;
        const cfg = vscode.workspace.getConfiguration();
        const enableEnter = cfg.get<boolean>('andrea.typeset.enableSmartEnter', true);
        const enableExit = cfg.get<boolean>('andrea.typeset.enableSmartExit', true);

        // 仅当：当前文档是 markdown / plaintext 且（任一功能开启）时，才接管 Enter
        const on = isMdOrText(doc) && (enableEnter || enableExit);
        void vscode.commands.executeCommand('setContext', CTX, on);
    };

    update();

    ctx.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(update),
        vscode.workspace.onDidOpenTextDocument(update),
        vscode.workspace.onDidCloseTextDocument(update),
        vscode.workspace.onDidChangeConfiguration(e => {
            if (
                e.affectsConfiguration('andrea.typeset.enableSmartEnter') ||
                e.affectsConfiguration('andrea.typeset.enableSmartExit')
            ) { update(); }
        })
    );
}
