import * as vscode from 'vscode';
import { readUserKeybindings, writeUserKeybindings, upsertRule, removeRule } from '../keybindings/keybindingsIO';

export function registerQuickSettings(context: vscode.ExtensionContext, onRefreshStatus: () => void) {
    const toggle = async (key: string) => {
        const cfg = vscode.workspace.getConfiguration();
        const cur = cfg.get<boolean>(key, true);
        await cfg.update(key, !cur, vscode.ConfigurationTarget.Workspace);
        onRefreshStatus();
    };

    // 段间空行数
    async function changeBlankLines() {
        const cfg = vscode.workspace.getConfiguration();
        const cur = cfg.get<number>('andrea.typeset.blankLinesBetweenParas', 1) ?? 1;
        const choices = ['0', '1', '2', '3', '4', '5', '6'];
        const pick = await vscode.window.showQuickPick(
            choices.map(v => ({ label: v + (v === String(cur) ? '  (当前)' : ''), value: Number(v) })),
            { placeHolder: '选择段落之间的空行数' }
        );
        if (!pick) { return; }
        await cfg.update('andrea.typeset.blankLinesBetweenParas', pick.value, vscode.ConfigurationTarget.Workspace);
        onRefreshStatus();
    }

    // 缩进宽度（同步工作区 + 当前编辑器；关闭 detectIndentation）
    async function changeIndentSize() {
        const items = [
            { label: '使用空格：2', insertSpaces: true, tabSize: 2 },
            { label: '使用空格：4', insertSpaces: true, tabSize: 4 },
            { label: '使用空格：8', insertSpaces: true, tabSize: 8 },
            { label: '使用制表符（Tab）', insertSpaces: false, tabSize: 4 },
        ];
        const pick = await vscode.window.showQuickPick(items, { placeHolder: '选择缩进宽度（写入 editor.insertSpaces / tabSize）' });
        if (!pick) { return; }

        const editorCfg = vscode.workspace.getConfiguration('editor');
        // 1) 关闭“从内容中检测缩进”
        await editorCfg.update('detectIndentation', false, vscode.ConfigurationTarget.Workspace);

        // 2) 写入 Workspace 配置
        await editorCfg.update('insertSpaces', pick.insertSpaces, vscode.ConfigurationTarget.Workspace);
        await editorCfg.update('tabSize', pick.tabSize, vscode.ConfigurationTarget.Workspace);

        // 2.1 可选：对常用语言作用域写入，避免被语言级覆盖
        for (const lang of ['markdown', 'plaintext']) {
            const langCfg = vscode.workspace.getConfiguration('editor', { languageId: lang });
            await langCfg.update('insertSpaces', pick.insertSpaces, vscode.ConfigurationTarget.Workspace, true);
            await langCfg.update('tabSize', pick.tabSize, vscode.ConfigurationTarget.Workspace, true);
        }

        // 3) 立即同步当前编辑器实例（状态栏立刻更新）
        const ed = vscode.window.activeTextEditor;
        if (ed) {
            ed.options = {
                ...ed.options,
                insertSpaces: pick.insertSpaces,
                tabSize: pick.tabSize,
            };
        }

        onRefreshStatus();
        vscode.window.showInformationMessage(
            `缩进已设置为：${pick.insertSpaces ? '空格' : 'Tab'}（宽度 ${pick.tabSize}）。已关闭“从内容检测缩进”。`
        );
    }

    // ★ 开关：Word Wrap（on/off）
    async function toggleWordWrap() {
        const cfg = vscode.workspace.getConfiguration('editor');
        const cur = cfg.get<string>('wordWrap', 'off');
        const next = (cur === 'off') ? 'on' : 'off';
        await cfg.update('wordWrap', next, vscode.ConfigurationTarget.Workspace);
        onRefreshStatus();
        vscode.window.showInformationMessage(`自动换行已${next === 'on' ? '开启' : '关闭'}（editor.wordWrap = ${next}）。`);
    }

    // ★ 选择：Word Wrap 模式（off / on / wordWrapColumn / bounded）
    async function changeWordWrap() {
        const cfg = vscode.workspace.getConfiguration('editor');
        const cur = cfg.get<string>('wordWrap', 'off');

        const items = [
            { label: `${cur === 'off' ? '$(check) ' : ''}off  —— 不自动换行`, value: 'off' },
            { label: `${cur === 'on' ? '$(check) ' : ''}on   —— 按窗口宽度换行`, value: 'on' },
            { label: `${cur === 'wordWrapColumn' ? '$(check) ' : ''}wordWrapColumn —— 在 wordWrapColumn 换行`, value: 'wordWrapColumn' },
            { label: `${cur === 'bounded' ? '$(check) ' : ''}bounded —— 在窗口和 column 之间换行`, value: 'bounded' },
        ];

        const pick = await vscode.window.showQuickPick(items, { placeHolder: '选择自动换行模式 (editor.wordWrap)' });
        if (!pick) { return; }

        await cfg.update('wordWrap', pick.value, vscode.ConfigurationTarget.Workspace);
        onRefreshStatus();
        vscode.window.showInformationMessage(`自动换行已设置为：${pick.value}`);
    }

    // 编辑器字体大小（workspace 级别 + 可对常用语言作用域写入）
    async function changeEditorFontSize() {
        const editorCfg = vscode.workspace.getConfiguration('editor');
        const cur = editorCfg.get<number>('fontSize', 14) ?? 14;
        const presets = [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 32];
        const items = presets.map(n => ({ label: `${n}${n === cur ? '  (当前)' : ''}`, value: n }));
        items.push({ label: '自定义...', value: 'custom' as any });

        const pick = await vscode.window.showQuickPick(items as any[], { placeHolder: '选择编辑器字体大小 (editor.fontSize)' });
    if (!pick) { return; }

        let newSize: number | undefined;
        if (pick.value === 'custom') {
            const input = await vscode.window.showInputBox({ prompt: '输入字体大小（数字，例如 14）', value: String(cur) });
            if (!input) { return; }
            const n = Number(input.trim());
            if (!Number.isFinite(n) || n <= 0) {
                vscode.window.showErrorMessage('请输入有效的正数字体大小');
                return;
            }
            newSize = Math.floor(n);
        } else {
            newSize = pick.value as number;
        }

    if (newSize === undefined) { return; }

        // 写入全局（与字体家族管理一致，直接更新用户设置）
        await editorCfg.update('fontSize', newSize, vscode.ConfigurationTarget.Global);

        // 对常用文本/Markdown 语言也写入全局作用域，避免被语言配置覆盖
        for (const lang of ['markdown', 'plaintext']) {
            const langCfg = vscode.workspace.getConfiguration('editor', { languageId: lang });
            await langCfg.update('fontSize', newSize, vscode.ConfigurationTarget.Global, true);
        }

        onRefreshStatus();
        vscode.window.showInformationMessage(`编辑器字体大小已设置为 ${newSize}（全局用户设置）`);
    }

    //! 一键注入：把 Enter 路由给 Andrea，并禁用 MAIO 的 Enter（带已注入检测）
    async function injectEnterKeybindings() {
        const MAIO_ENTER = 'markdown.extension.onEnterKey';
        const OUR_CMD = 'andrea.smartEnter';

        // 当前使用的 when 条件（保持一致，避免重复更新）
        const expectedWhen =
            "editorTextFocus && andrea.typeset.smartEnterOn && !editorReadonly && " +
            "(!suggestWidgetVisible || config.editor.acceptSuggestionOnEnter == 'off') && " +
            "!inlineSuggestionVisible && !editorHasMultipleSelections && " +
            "vim.mode != 'Normal' && vim.mode != 'Visual' && vim.mode != 'VisualBlock' && " +
            "vim.mode != 'VisualLine' && vim.mode != 'SearchInProgressMode' && " +
            "vim.mode != 'CommandlineInProgress' && vim.mode != 'Replace' && " +
            "vim.mode != 'EasyMotionMode' && vim.mode != 'EasyMotionInputMode'";

        const keyIsEnter = (k?: string) => (k ?? '').toLowerCase() === 'enter';
        const norm = (s?: string) => (s ?? '').replace(/\s+/g, ' ').trim(); // 归一化空白，避免无意义差异

        try {
            const { doc, rules } = await readUserKeybindings();

            // 现状检测
            const hasMaioBindings = rules.some(r => r.command === MAIO_ENTER); // 仍存在需要移除的 MAIO 绑定
            const hasRemovalRule = rules.some(r => r.command === `-${MAIO_ENTER}` && keyIsEnter(r.key));
            const ourRule = rules.find(r => r.command === OUR_CMD && keyIsEnter(r.key));
            const ourWhenSame = ourRule ? norm(ourRule.when) === norm(expectedWhen) : false;

            let changed = false;
            let next = rules;

            // 1) 移除 MAIO 的所有 Enter 绑定
            if (hasMaioBindings) {
                next = removeRule(next, MAIO_ENTER);
                changed = true;
            }

            // 2) 确保存在一条“移除规则”：{ key: 'enter', command: `-markdown.extension.onEnterKey` }
            if (!hasRemovalRule) {
                next = next.concat([{ key: 'enter', command: `-${MAIO_ENTER}` }]);
                changed = true;
            }

            // 3) 确保我们的 Enter 绑定存在且 when 一致（不一致则更新）
            if (!ourRule || !ourWhenSame) {
                next = upsertRule(next, { key: 'enter', command: OUR_CMD, when: expectedWhen });
                changed = true;
            }

            if (!changed) {
                vscode.window.showInformationMessage('已检测到“Enter → Andrea（覆盖 MAIO）”按键绑定，无需再次注入。');
                return;
            }

            await writeUserKeybindings(doc, next);
            vscode.window.showInformationMessage('已注入/更新按键绑定：Enter 将交给 Andrea 处理（覆盖 MAIO）。请关闭并重新打开目标文档以生效。');
        } catch (err: any) {
            vscode.window.showErrorMessage(`注入按键绑定失败：${String(err?.message || err)}`);
        }
    }


    // 主面板
    async function quickSettings() {
        const cfg = vscode.workspace.getConfiguration();
        const on = cfg.get<boolean>('andrea.typeset.indentFirstTwoSpaces', true);
        const blank = cfg.get<number>('andrea.typeset.blankLinesBetweenParas', 1) ?? 1;
        const trim = cfg.get<boolean>('andrea.typeset.trimTrailingSpaces', true);
        const ap = cfg.get<boolean>('andrea.typeset.enableAutoPairs', true);
        const se = cfg.get<boolean>('andrea.typeset.enableSmartEnter', true);
        const sx = cfg.get<boolean>('andrea.typeset.enableSmartExit', true);

        const editorCfg = vscode.workspace.getConfiguration('editor');
        const wrap = editorCfg.get<string>('wordWrap', 'off'); // off | on | wordWrapColumn | bounded

        const pick = await vscode.window.showQuickPick(
            [
                { label: `${wrap !== 'off' ? '$(check)' : '$(circle-slash)'} 切换：自动换行（当前 ${wrap}）`, cmd: 'andrea.toggleWordWrap' },
                { label: '$(settings) 设置：自动换行模式', cmd: 'andrea.changeWordWrap' },

                { label: `${ap ? '$(check)' : '$(circle-slash)'} 切换：智慧补齐括号`, cmd: 'andrea.toggleAutoPairs' },
                { label: `${sx ? '$(check)' : '$(circle-slash)'} 切换：智慧跳出括号/引号`, cmd: 'andrea.toggleSmartExit' },
                { label: `${se ? '$(check)' : '$(circle-slash)'} 切换：智慧切段（Enter）`, cmd: 'andrea.toggleSmartEnter' },

                { label: `${on ? '$(check)' : '$(circle-slash)'} 切换：段首缩进`, cmd: 'andrea.toggleIndentFirst' },
                { label: `$(list-unordered) 设置：段间空行数（当前 ${blank}）`, cmd: 'andrea.changeBlankLines' },
                { label: `${trim ? '$(check)' : '$(circle-slash)'} 切换：去尾空格`, cmd: 'andrea.toggleTrimTrailing' },

                { label: '$(settings) 设置：缩进宽度（editor.insertSpaces / tabSize）', cmd: 'andrea.changeIndentSize' },

                { label: '$(symbol-text) 管理：编辑器字体家族（图形化）', cmd: 'andrea.manageEditorFontFamily' },
                { label: '$(zoom-in) 设置：编辑器字体大小', cmd: 'andrea.changeEditorFontSize' },
                { label: '$(paintcan) 立即排版全文', cmd: 'andrea.formatDocument' },

                { label: '$(keyboard) [仅需执行一次｜智能回车失效时使用] 一键注入：Enter → Andrea（覆盖 MAIO）', cmd: 'andrea.injectEnterKeybindings' },
            ],
            { placeHolder: '小说版式：快速设置', canPickMany: false }
        );

        if (pick?.cmd) { await vscode.commands.executeCommand(pick.cmd); }
    }

    // 命令注册
    context.subscriptions.push(
        vscode.commands.registerCommand('andrea.quickSettings', quickSettings),

        vscode.commands.registerCommand('andrea.injectEnterKeybindings', injectEnterKeybindings),

        vscode.commands.registerCommand('andrea.toggleWordWrap', toggleWordWrap),
        vscode.commands.registerCommand('andrea.changeWordWrap', changeWordWrap),

        vscode.commands.registerCommand('andrea.toggleIndentFirst', () => toggle('andrea.typeset.indentFirstTwoSpaces')),
        vscode.commands.registerCommand('andrea.toggleTrimTrailing', () => toggle('andrea.typeset.trimTrailingSpaces')),

        vscode.commands.registerCommand('andrea.changeBlankLines', changeBlankLines),
        vscode.commands.registerCommand('andrea.changeIndentSize', changeIndentSize),

    vscode.commands.registerCommand('andrea.changeEditorFontSize', changeEditorFontSize),

        vscode.commands.registerCommand('andrea.toggleAutoPairs', () => toggle('andrea.typeset.enableAutoPairs')),
        vscode.commands.registerCommand('andrea.toggleSmartEnter', () => toggle('andrea.typeset.enableSmartEnter')),
        vscode.commands.registerCommand('andrea.toggleSmartExit', () => toggle('andrea.typeset.enableSmartExit')),
    );
}
