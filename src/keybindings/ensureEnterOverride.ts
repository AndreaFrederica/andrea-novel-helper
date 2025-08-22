import * as vscode from 'vscode';
import {
    readUserKeybindings,
    writeUserKeybindings,
    upsertRule,
    removeRule,
    KeybindingRule
} from './keybindingsIO';

const MAIO_ENTER_CMD = 'markdown.extension.onEnterKey';

const ANDREA_ENTER_RULE: KeybindingRule = {
    key: 'enter',
    command: 'andrea.smartEnter',
    // 你可以按需精简/加严 language 限定
    when:
        "editorTextFocus && andrea.typeset.smartEnterOn && !editorReadonly && " +
        "(!suggestWidgetVisible || config.editor.acceptSuggestionOnEnter == 'off') && " +
        "!inlineSuggestionVisible && !editorHasMultipleSelections && " +
        "vim.mode != 'Normal' && vim.mode != 'Visual' && vim.mode != 'VisualBlock' && " +
        "vim.mode != 'VisualLine' && vim.mode != 'SearchInProgressMode' && " +
        "vim.mode != 'CommandlineInProgress' && vim.mode != 'Replace' && " +
        "vim.mode != 'EasyMotionMode' && vim.mode != 'EasyMotionInputMode'"
};

/** 实际执行：移除 MAIO Enter，添加 Andrea Enter，写回保存 */
export async function ensureAndreaEnterOverridesCore(): Promise<void> {
    const { doc, rules } = await readUserKeybindings();

    // 1) 移除所有现存的 MAIO Enter 绑定
    let next = removeRule(rules, MAIO_ENTER_CMD);           // 删同 command 的全部
    next.push({ command: `-${MAIO_ENTER_CMD}`, key: 'enter' }); // 加“移除规则”一条（更显式）

    // 2) 添加/更新我们的 Enter 绑定
    next = upsertRule(next, ANDREA_ENTER_RULE);

    // 3) 写回 & 保存
    await writeUserKeybindings(doc, next);
}

/** 注册命令：andrea.ensureEnterOverrides */
export function registerEnsureEnterOverridesCommand(ctx: vscode.ExtensionContext) {
    ctx.subscriptions.push(
        vscode.commands.registerCommand('andrea.ensureEnterOverrides', async () => {
            const yes = '应用并保存';
            const show = '只打开 keybindings.json';
            const pick = await vscode.window.showInformationMessage(
                'Andrea 将覆盖 Enter：禁用 MAIO 的回车并启用 andrea.smartEnter。是否现在应用？',
                { modal: true },
                yes, show
            );
            if (!pick) { return; }

            if (pick === show) {
                // 只打开，不动内容
                await vscode.commands.executeCommand('workbench.action.openGlobalKeybindingsFile');
                return;
            }

            try {
                await ensureAndreaEnterOverridesCore();
                vscode.window.showInformationMessage('已更新 keybindings.json：Enter 现由 Andrea 接管。');
            } catch (err: any) {
                vscode.window.showErrorMessage(`写入 keybindings.json 失败：${String(err?.message || err)}`);
            }
        })
    );
}
