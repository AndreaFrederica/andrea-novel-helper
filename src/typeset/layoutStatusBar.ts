import * as vscode from 'vscode';
import { isSupportedDoc } from './core/utils';

export function registerLayoutStatusBar(context: vscode.ExtensionContext) {
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    item.command = 'andrea.quickSettings';
    context.subscriptions.push(item);

    const update = () => {
        const cfg = vscode.workspace.getConfiguration();
        const compact = cfg.get<boolean>('andrea.typeset.statusBar.compact', false);
        const alwaysShow = cfg.get<boolean>('andrea.typeset.statusBar.alwaysShow', true);
        const on = cfg.get<boolean>('andrea.typeset.indentFirstTwoSpaces', true);
        const blank = cfg.get<number>('andrea.typeset.blankLinesBetweenParas', 1) ?? 1;
        const trim = cfg.get<boolean>('andrea.typeset.trimTrailingSpaces', true);
        const ap = cfg.get<boolean>('andrea.typeset.enableAutoPairs', true);
        const se = cfg.get<boolean>('andrea.typeset.enableSmartEnter', true);
        const sx = cfg.get<boolean>('andrea.typeset.enableSmartExit', true);

        const e = vscode.window.activeTextEditor;
        let indentDesc = '';
        if (e) {
            const insertSpaces = e.options.insertSpaces === 'auto' ? true : !!e.options.insertSpaces;
            const tabSize = typeof e.options.tabSize === 'number' ? e.options.tabSize : 2;
            indentDesc = insertSpaces ? `${tabSize}` : 'Tab';
        }

        item.text = compact
            ? `$(edit) 版式和快速设置`
            : `$(edit) 版式  缩进:${indentDesc}  首行:${on ? '开' : '关'}  段距:${blank}  去尾:${trim ? '✓' : '×'}  补齐:${ap ? '开' : '关'}  跳出:${sx ? '开' : '关'}  切段:${se ? '开' : '关'}`;
        item.tooltip = '点击打开“小说版式：快速设置”';

        if (alwaysShow) {
            item.show();
        } else {
            const visible = vscode.window.activeTextEditor && isSupportedDoc(vscode.window.activeTextEditor.document);
            if (visible) { item.show(); } else { item.hide(); }
        }
    };

    const refresh = () => update();

    update();

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(update),
        vscode.workspace.onDidOpenTextDocument(update as any),
        vscode.workspace.onDidChangeConfiguration(e => {
            if (
                e.affectsConfiguration('andrea.typeset') ||
                e.affectsConfiguration('andrea.typeset.statusBar.compact') ||
                e.affectsConfiguration('editor.insertSpaces') ||
                e.affectsConfiguration('editor.tabSize') ||
                e.affectsConfiguration('AndreaNovelHelper.supportedFileTypes') ||
                e.affectsConfiguration('editor.fontFamily')
            ) { update(); }
        })
    );

    return { refresh };
}
