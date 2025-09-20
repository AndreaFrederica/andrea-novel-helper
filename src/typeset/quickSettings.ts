import * as vscode from 'vscode';
import { readUserKeybindings, writeUserKeybindings, upsertRule, removeRule } from '../keybindings/keybindingsIO';
import { WcignoreManager, WcignoreRule } from '../utils/wcignoreManager';

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
        const items = choices.map(v => ({ label: v + (v === String(cur) ? '  (当前)' : ''), value: Number(v) }));
        items.push({ label: '$(arrow-left) 返回主设置', value: -1 });
        
        const pick = await vscode.window.showQuickPick(
            items,
            { placeHolder: '选择段落之间的空行数' }
        );
        if (!pick) { return; }
        
        if (pick.value === -1) {
            await quickSettings();
            return;
        }
        
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
            { label: '$(arrow-left) 返回主设置', insertSpaces: null as any, tabSize: null as any },
        ];
        const pick = await vscode.window.showQuickPick(items, { placeHolder: '选择缩进宽度（写入 editor.insertSpaces / tabSize）' });
        if (!pick) { return; }

        if (pick.insertSpaces === null) {
            await quickSettings();
            return;
        }

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
            { label: '$(arrow-left) 返回主设置', value: 'back' },
        ];

        const pick = await vscode.window.showQuickPick(items, { placeHolder: '选择自动换行模式 (editor.wordWrap)' });
        if (!pick) { return; }

        if (pick.value === 'back') {
            await quickSettings();
            return;
        }

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
        items.push({ label: '$(arrow-left) 返回主设置', value: 'back' as any });

        const pick = await vscode.window.showQuickPick(items as any[], { placeHolder: '选择编辑器字体大小 (editor.fontSize)' });
        if (!pick) { return; }

        if (pick.value === 'back') {
            await quickSettings();
            return;
        }

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

    // 管理 .wcignore 常用忽略规则（首屏：预制+自定义；顶部按钮：更多/添加/打开；更多页可返回首屏；支持增删自定义）
    async function manageWcignore() {
        const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!ws) {
            vscode.window.showErrorMessage('未检测到工作区，无法管理 .wcignore');
            return;
        }

        const mgr = new WcignoreManager(ws);
        const currentRules = mgr.parseCurrentRules();
        const { primary, secondary } = mgr.classifyBuiltins(currentRules);
        let customs = currentRules.filter(r => r.category === 'custom' && r.enabled);

        // 保存初始状态用于判断是否改变
        const initialPrimary = primary.map(r => ({ pattern: r.pattern, enabled: r.enabled }));
        const initialSecondary = secondary.map(r => ({ pattern: r.pattern, enabled: r.enabled }));
        const initialCustoms = customs.map(c => c.pattern);

        type Item = vscode.QuickPickItem & { pattern?: string; tag?: 'primary' | 'secondary' | 'custom' };
        const qp = vscode.window.createQuickPick<Item>();
        qp.canSelectMany = true;
        qp.title = '写作资源忽略 (.wcignore)';

        const BTN_MORE: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('list-flat'), tooltip: '展开更多规则（不常用/低频）' };
        const BTN_ADD: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('add'), tooltip: '添加自定义规则' };
        const BTN_OPEN: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('go-to-file'), tooltip: '打开 .wcignore' };
        const BTN_BACK: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('arrow-left'), tooltip: '返回首屏' };
        const BTN_BACK_TO_SETTINGS: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('home'), tooltip: '返回快速设置' };

        let page: 'main' | 'more' = 'main';

        const buildMain = () => {
            const items: Item[] = [];
            for (const r of primary) {
                items.push({ label: r.pattern, description: r.description, pattern: r.pattern, tag: 'primary' });
            }
            if (customs.length > 0) {
                items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
                for (const c of customs) {
                    items.push({ label: c.pattern, description: '自定义', pattern: c.pattern, tag: 'custom' });
                }
            }
            qp.items = items;
            qp.selectedItems = items.filter(i =>
                (i.tag === 'primary' && primary.find(p => p.pattern === i.pattern)?.enabled) ||
                (i.tag === 'custom') // 自定义默认选中（存在即启用）
            );
            qp.buttons = [BTN_MORE, BTN_ADD, BTN_OPEN, BTN_BACK_TO_SETTINGS];
            qp.title = '写作资源忽略 (.wcignore)：常用规则与自定义';
        };

        const buildMore = () => {
            const items: Item[] = [];
            for (const r of secondary) {
                items.push({ label: r.pattern, description: r.description, pattern: r.pattern, tag: 'secondary' });
            }
            qp.items = items;
            qp.selectedItems = items.filter(i => secondary.find(s => s.pattern === i.pattern)?.enabled);
            qp.buttons = [BTN_BACK, BTN_ADD, BTN_OPEN, BTN_BACK_TO_SETTINGS];
            qp.title = '写作资源忽略 (.wcignore)：更多规则（不常用/低频）';
        };

        // 根据当前页面刷新
        const refresh = () => {
            if (page === 'main') {
                buildMain();
            } else {
                buildMore();
            }
        };

        // 选择变化时，更新当前页对应规则 enabled
        qp.onDidChangeSelection(sel => {
            const selected = new Set(sel.map(s => s.pattern).filter(Boolean) as string[]);
            if (page === 'main') {
                for (const r of primary) {
                    r.enabled = selected.has(r.pattern);
                }
                // 自定义：未选中的视为移除（不保存）
                customs = customs.filter(c => selected.has(c.pattern));
            } else {
                for (const r of secondary) {
                    r.enabled = selected.has(r.pattern);
                }
            }
        });

        // 顶部按钮处理
        qp.onDidTriggerButton(async (btn) => {
            if (btn === BTN_OPEN) {
                qp.hide();
                await vscode.commands.executeCommand('andrea.openWcignore');
                return;
            }
            if (btn === BTN_BACK_TO_SETTINGS) {
                qp.hide();
                await quickSettings();
                return;
            }
            if (btn === BTN_ADD) {
                const input = await vscode.window.showInputBox({ prompt: '输入要新增的忽略模式（与 .gitignore 语法一致）', ignoreFocusOut: true });
                if (input && input.trim()) {
                    const pattern = input.trim();
                    if (mgr.isDuplicate(pattern, [...primary, ...secondary, ...customs])) {
                        vscode.window.showInformationMessage('该规则已存在且启用');
                    } else {
                        customs.push({ pattern, description: '自定义规则', category: 'custom', enabled: true });
                        // 回到主屏并刷新，确保新自定义显示在预制下方
                        page = 'main';
                        refresh();
                    }
                }
                return;
            }
            if (btn === BTN_MORE) {
                page = 'more';
                refresh();
                return;
            }
            if (btn === BTN_BACK) {
                page = 'main';
                refresh();
                return;
            }
        });

        const closeAndApply = async () => {
            qp.hide();

            // 判断是否有改动
            const changedPrimary = primary.some(r => initialPrimary.find(i => i.pattern === r.pattern)?.enabled !== r.enabled);
            const changedSecondary = secondary.some(r => initialSecondary.find(i => i.pattern === r.pattern)?.enabled !== r.enabled);
            const changedCustoms = (() => {
                const now = new Set(customs.map(c => c.pattern));
                if (now.size !== initialCustoms.length) {
                    return true;
                }
                return initialCustoms.some(p => !now.has(p));
            })();
            const changed = changedPrimary || changedSecondary || changedCustoms;

            if (!changed) {
                const openOnly = await vscode.window.showInformationMessage('未更改任何规则。是否打开 .wcignore 查看？', '打开', '取消');
                if (openOnly === '打开') {
                    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(mgr.getWcignorePath()));
                    await vscode.window.showTextDocument(doc, { preview: false });
                }
                return;
            }

            // 汇总写入
            const nextAll = [...primary, ...secondary, ...customs];
            mgr.ensureExists();
            try {
                mgr.batchUpdateRules(nextAll);
                vscode.window.showInformationMessage('.wcignore 已更新（将自动刷新字数树）');
            } catch (e: any) {
                vscode.window.showErrorMessage(`更新 .wcignore 失败：${String(e?.message || e)}`);
            }

            const open = await vscode.window.showInformationMessage('是否打开 .wcignore 查看？', '打开', '取消');
            if (open === '打开') {
                const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(mgr.getWcignorePath()));
                await vscode.window.showTextDocument(doc, { preview: false });
            }
        };

        qp.onDidAccept(closeAndApply);
        qp.onDidHide(() => qp.dispose());
        refresh();
        qp.show();
    }

    // 快速打开 .wcignore（不存在则创建默认模板）
    async function openWcignore() {
        const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!ws) {
            vscode.window.showErrorMessage('未检测到工作区，无法打开 .wcignore');
            return;
        }
        const mgr = new WcignoreManager(ws);
        if (!mgr.exists()) {
            try { mgr.createDefault(); } catch { /* ignore */ }
        }
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(mgr.getWcignorePath()));
        await vscode.window.showTextDocument(doc, { preview: false });
    }

    // 配置当前文章角色显示
    async function configureDocRoles() {
        while (true) {
            const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
            const groupBy = cfg.get<string>('docRoles.groupBy', 'affiliation');
            const respectAffiliation = cfg.get<boolean>('docRoles.respectAffiliation', true);
            const respectType = cfg.get<boolean>('docRoles.respectType', true);
            const primaryGroup = cfg.get<string>('docRoles.primaryGroup', 'affiliation');
            const useCustomGroups = cfg.get<boolean>('docRoles.useCustomGroups', false);
            const wrapColumn = cfg.get<number>('roles.details.wrapColumn', 20) || 20;
            const enableRoleExpansion = cfg.get<boolean>('roles.details.enableRoleExpansion', true);
            const useRoleSvgIfPresent = cfg.get<boolean>('docRoles.display.useRoleSvgIfPresent', false);
            const colorizeRoleName = cfg.get<boolean>('docRoles.display.colorizeRoleName', false);

            const choices = [
                {
                    label: '$(symbol-class) 分组依据',
                    description: groupBy === 'affiliation' ? '当前：按归属分组' : 
                               groupBy === 'type' ? '当前：按类型分组' : '当前：不分组',
                    action: 'groupBy'
                },
                {
                    label: `${respectAffiliation ? '$(check)' : '$(circle-slash)'} 遵循归属`,
                    description: respectAffiliation ? '当前已启用，会根据角色归属字段分组' : '当前已禁用，忽略归属字段',
                    action: 'respectAffiliation'
                },
                {
                    label: `${respectType ? '$(check)' : '$(circle-slash)'} 遵循类型`,
                    description: respectType ? '当前已启用，会根据角色类型字段分组' : '当前已禁用，忽略类型字段',
                    action: 'respectType'
                },
                {
                    label: '$(list-tree) 第一级别分组',
                    description: primaryGroup === 'affiliation' ? '当前：归属优先' : '当前：类型优先',
                    action: 'primaryGroup'
                },
                {
                    label: `${useCustomGroups ? '$(check)' : '$(circle-slash)'} 自定义分组`,
                    description: useCustomGroups ? '当前：使用自定义分组规则' : '当前：使用标准分组',
                    action: 'useCustomGroups'
                },
                {
                    label: '$(word-wrap) 详情折行列数',
                    description: `当前：${wrapColumn} 列（5-200）`,
                    action: 'wrapColumn'
                },
                {
                    label: `${enableRoleExpansion ? '$(check)' : '$(circle-slash)'} 允许角色展开详情`,
                    description: enableRoleExpansion ? '开启：角色节点可展开查看属性' : '关闭：角色节点不可展开',
                    action: 'toggleRoleExpansion'
                },
                {
                    label: `${useRoleSvgIfPresent ? '$(check)' : '$(circle-slash)'} 使用角色自带 svg 作为图标`,
                    description: useRoleSvgIfPresent ? '开启：若角色对象含 svg 字段则优先使用' : '关闭：继续使用默认/文件图标',
                    action: 'toggleUseRoleSvg'
                },
                {
                    label: `${colorizeRoleName ? '$(check)' : '$(circle-slash)'} 用角色颜色标记名称`,
                    description: colorizeRoleName ? '开启：名称前显示角色颜色方块' : '关闭：不显示颜色方块',
                    action: 'toggleColorizeName'
                },
                {
                    label: '$(edit) 管理自定义分组规则',
                    description: '添加、编辑或删除自定义分组规则',
                    action: 'manageCustomGroups'
                },
                {
                    label: '$(arrow-left) 返回主设置',
                    description: '返回快速设置主面板',
                    action: 'back'
                }
            ];

            const pick = await vscode.window.showQuickPick(choices, {
                placeHolder: '配置当前文章角色显示效果'
            });

            if (!pick) { return; }

            try {
                switch (pick.action) {
                    case 'groupBy': {
                        const groupByChoices = [
                            { label: '$(symbol-namespace) 按归属分组', value: 'affiliation', description: '根据角色的归属字段进行分组' },
                            { label: '$(symbol-class) 按类型分组', value: 'type', description: '根据角色的类型字段进行分组' },
                            { label: '$(list-flat) 不分组', value: 'none', description: '所有角色平铺显示，不进行分组' },
                            { label: '$(arrow-left) 返回', value: 'back' }
                        ];
                        const currentChoice = groupByChoices.find(c => c.value === groupBy);
                        if (currentChoice) {
                            currentChoice.label = `$(check) ${currentChoice.label.substring(currentChoice.label.indexOf(' ') + 1)}`;
                        }
                        
                        const groupByPick = await vscode.window.showQuickPick(groupByChoices, {
                            placeHolder: '选择角色分组依据'
                        });
                        
                        if (groupByPick?.value && groupByPick.value !== 'back') {
                            await cfg.update('docRoles.groupBy', groupByPick.value, vscode.ConfigurationTarget.Workspace);
                            vscode.window.showInformationMessage(`角色分组已设置为：${groupByPick.description}`);
                            // 刷新角色视图
                            vscode.commands.executeCommand('AndreaNovelHelper.refreshRoles');
                        }
                        break;
                    }
                    case 'respectAffiliation': {
                        await cfg.update('docRoles.respectAffiliation', !respectAffiliation, vscode.ConfigurationTarget.Workspace);
                        vscode.window.showInformationMessage(`归属遵循已${!respectAffiliation ? '启用' : '禁用'}`);
                        // 刷新角色视图
                        vscode.commands.executeCommand('AndreaNovelHelper.refreshRoles');
                        break;
                    }
                    case 'respectType': {
                        await cfg.update('docRoles.respectType', !respectType, vscode.ConfigurationTarget.Workspace);
                        vscode.window.showInformationMessage(`类型遵循已${!respectType ? '启用' : '禁用'}`);
                        // 刷新角色视图
                        vscode.commands.executeCommand('AndreaNovelHelper.refreshRoles');
                        break;
                    }
                    case 'primaryGroup': {
                        const primaryChoices = [
                            { label: '$(symbol-namespace) 归属优先', value: 'affiliation', description: '第一级分组使用归属，第二级使用类型' },
                            { label: '$(symbol-class) 类型优先', value: 'type', description: '第一级分组使用类型，第二级使用归属' },
                            { label: '$(arrow-left) 返回', value: 'back' }
                        ];
                        const currentChoice = primaryChoices.find(c => c.value === primaryGroup);
                        if (currentChoice) {
                            currentChoice.label = `$(check) ${currentChoice.label.substring(currentChoice.label.indexOf(' ') + 1)}`;
                        }
                        
                        const primaryPick = await vscode.window.showQuickPick(primaryChoices, {
                            placeHolder: '选择第一级别分组依据'
                        });
                        
                        if (primaryPick?.value && primaryPick.value !== 'back') {
                            await cfg.update('docRoles.primaryGroup', primaryPick.value, vscode.ConfigurationTarget.Workspace);
                            vscode.window.showInformationMessage(`第一级分组已设置为：${primaryPick.description}`);
                            // 刷新角色视图
                            vscode.commands.executeCommand('AndreaNovelHelper.refreshRoles');
                        }
                        break;
                    }
                    case 'useCustomGroups': {
                        await cfg.update('docRoles.useCustomGroups', !useCustomGroups, vscode.ConfigurationTarget.Workspace);
                        vscode.window.showInformationMessage(`自定义分组已${!useCustomGroups ? '启用' : '禁用'}`);
                        // 刷新角色视图
                        vscode.commands.executeCommand('AndreaNovelHelper.refreshRoles');
                        break;
                    }
                    case 'wrapColumn': {
                        const cur = wrapColumn;
                        const val = await vscode.window.showInputBox({
                            prompt: '设置角色属性详情的折行列数（5-200）',
                            value: String(cur),
                            validateInput: (text) => {
                                const n = Number(text);
                                if (!Number.isFinite(n)) { return '请输入数字'; }
                                if (n < 5 || n > 200) { return '范围为 5 到 200'; }
                                return undefined;
                            }
                        });
                        if (val) {
                            const n = Math.max(5, Math.min(200, Number(val)));
                            await cfg.update('roles.details.wrapColumn', n, vscode.ConfigurationTarget.Workspace);
                            vscode.window.showInformationMessage(`折行列数已设置为 ${n}`);
                            vscode.commands.executeCommand('AndreaNovelHelper.refreshRoles');
                        }
                        break;
                    }
                    case 'toggleRoleExpansion': {
                        await cfg.update('roles.details.enableRoleExpansion', !enableRoleExpansion, vscode.ConfigurationTarget.Workspace);
                        vscode.window.showInformationMessage(`角色展开已${!enableRoleExpansion ? '启用' : '禁用'}`);
                        vscode.commands.executeCommand('AndreaNovelHelper.refreshRoles');
                        break;
                    }
                    case 'toggleUseRoleSvg': {
                        await cfg.update('docRoles.display.useRoleSvgIfPresent', !useRoleSvgIfPresent, vscode.ConfigurationTarget.Workspace);
                        vscode.window.showInformationMessage(`当前文章角色：使用角色 svg 图标已${!useRoleSvgIfPresent ? '启用' : '禁用'}`);
                        vscode.commands.executeCommand('AndreaNovelHelper.refreshRoles');
                        break;
                    }
                    case 'toggleColorizeName': {
                        await cfg.update('docRoles.display.colorizeRoleName', !colorizeRoleName, vscode.ConfigurationTarget.Workspace);
                        vscode.window.showInformationMessage(`当前文章角色：名称颜色标记已${!colorizeRoleName ? '启用' : '禁用'}`);
                        vscode.commands.executeCommand('AndreaNovelHelper.refreshRoles');
                        break;
                    }
                    case 'manageCustomGroups': {
                        await manageCustomGroups();
                        break;
                    }
                    case 'back':
                        await quickSettings();
                        return;
                }
            } catch (error: any) {
                vscode.window.showErrorMessage(`配置角色显示失败：${error?.message || error}`);
            }
        }
    }

    // 配置全部角色显示（roleHierarchyView）
    async function configureAllRoles() {
        while (true) {
            const root = vscode.workspace.getConfiguration('AndreaNovelHelper');
            const sync = root.get<boolean>('allRoles.syncWithDocRoles', true);
            const base = sync ? 'docRoles' : 'allRoles';
            const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
            const groupBy = cfg.get<string>(`${base}.groupBy`, 'affiliation');
            const respectAffiliation = cfg.get<boolean>(`${base}.respectAffiliation`, true);
            const respectType = cfg.get<boolean>(`${base}.respectType`, true);
            const primaryGroup = cfg.get<string>(`${base}.primaryGroup`, 'affiliation');
            const useCustomGroups = cfg.get<boolean>(`${base}.useCustomGroups`, false);
            const wrapColumn = cfg.get<number>('roles.details.wrapColumn', 20) || 20;
            const enableRoleExpansion = cfg.get<boolean>('roles.details.enableRoleExpansion', true);
            const colorizeRoleName = cfg.get<boolean>(`${base}.display.colorizeRoleName`, false);

            const choices = [
                {
                    label: `${sync ? '$(check)' : '$(circle-slash)'} 同步“当前文章角色”的显示设置`,
                    description: sync ? '开启：读取 docRoles.*' : '关闭：使用 allRoles.* 独立配置',
                    action: 'toggleSync'
                },
                { label: '$(symbol-class) 分组依据', description: groupBy === 'affiliation' ? '当前：按归属分组' : groupBy === 'type' ? '当前：按类型分组' : '当前：不分组', action: 'groupBy' },
                { label: `${respectAffiliation ? '$(check)' : '$(circle-slash)'} 遵循归属`, description: respectAffiliation ? '已启用' : '已禁用', action: 'respectAffiliation' },
                { label: `${respectType ? '$(check)' : '$(circle-slash)'} 遵循类型`, description: respectType ? '已启用' : '已禁用', action: 'respectType' },
                { label: '$(list-tree) 第一级别分组', description: primaryGroup === 'affiliation' ? '当前：归属优先' : '当前：类型优先', action: 'primaryGroup' },
                { label: `${useCustomGroups ? '$(check)' : '$(circle-slash)'} 自定义分组`, description: useCustomGroups ? '使用自定义规则' : '使用标准分组', action: 'useCustomGroups' },
                { label: '$(word-wrap) 详情折行列数', description: `当前：${wrapColumn} 列（5-200）`, action: 'wrapColumn' },
                { label: `${enableRoleExpansion ? '$(check)' : '$(circle-slash)'} 允许角色展开详情`, description: enableRoleExpansion ? '开启：角色节点可展开查看属性' : '关闭：角色节点不可展开', action: 'toggleRoleExpansion' },
                { label: `${colorizeRoleName ? '$(check)' : '$(circle-slash)'} 用角色颜色标记名称`, description: colorizeRoleName ? '开启：名称前显示角色颜色方块' : '关闭：不显示颜色方块', action: 'toggleColorizeName' },
                { label: '$(edit) 管理自定义分组规则', description: '添加、编辑或删除规则（针对 allRoles.* 或 docRoles.*，取决于同步开关）', action: 'manageCustomGroups' },
                { label: '$(arrow-left) 返回主设置', action: 'back' }
            ];

            const pick = await vscode.window.showQuickPick(choices, { placeHolder: '配置全部角色（roleHierarchyView）显示' });
            if (!pick) { return; }
            try {
                if (pick.action === 'toggleSync') {
                    await root.update('allRoles.syncWithDocRoles', !sync, vscode.ConfigurationTarget.Workspace);
                    vscode.commands.executeCommand('AndreaNovelHelper.refreshRoles');
                    continue; // 重新读取配置
                }
                // 若同步开启，则直接跳转到当前文章角色配置，以保持单一事实来源
                if (sync) {
                    await configureDocRoles();
                    return;
                }

                switch (pick.action) {
                    case 'groupBy': {
                        const items = [
                            { label: '$(symbol-namespace) 按归属分组', value: 'affiliation' },
                            { label: '$(symbol-class) 按类型分组', value: 'type' },
                            { label: '$(list-flat) 不分组', value: 'none' },
                            { label: '$(arrow-left) 返回', value: 'back' }
                        ];
                        const sel = await vscode.window.showQuickPick(items, { placeHolder: '选择分组依据' });
                        if (sel?.value && sel.value !== 'back') {
                            await cfg.update('allRoles.groupBy', sel.value, vscode.ConfigurationTarget.Workspace);
                            vscode.commands.executeCommand('AndreaNovelHelper.refreshRoles');
                        }
                        break;
                    }
                    case 'respectAffiliation': {
                        await cfg.update('allRoles.respectAffiliation', !respectAffiliation, vscode.ConfigurationTarget.Workspace);
                        vscode.commands.executeCommand('AndreaNovelHelper.refreshRoles');
                        break;
                    }
                    case 'respectType': {
                        await cfg.update('allRoles.respectType', !respectType, vscode.ConfigurationTarget.Workspace);
                        vscode.commands.executeCommand('AndreaNovelHelper.refreshRoles');
                        break;
                    }
                    case 'primaryGroup': {
                        const items = [
                            { label: '$(symbol-namespace) 归属优先', value: 'affiliation' },
                            { label: '$(symbol-class) 类型优先', value: 'type' },
                            { label: '$(arrow-left) 返回', value: 'back' }
                        ];
                        const sel = await vscode.window.showQuickPick(items, { placeHolder: '选择第一级别分组' });
                        if (sel?.value && sel.value !== 'back') {
                            await cfg.update('allRoles.primaryGroup', sel.value, vscode.ConfigurationTarget.Workspace);
                            vscode.commands.executeCommand('AndreaNovelHelper.refreshRoles');
                        }
                        break;
                    }
                    case 'useCustomGroups': {
                        await cfg.update('allRoles.useCustomGroups', !useCustomGroups, vscode.ConfigurationTarget.Workspace);
                        vscode.commands.executeCommand('AndreaNovelHelper.refreshRoles');
                        break;
                    }
                    case 'wrapColumn': {
                        const cur = wrapColumn;
                        const val = await vscode.window.showInputBox({
                            prompt: '设置角色属性详情的折行列数（5-200）',
                            value: String(cur),
                            validateInput: (text) => {
                                const n = Number(text);
                                if (!Number.isFinite(n)) { return '请输入数字'; }
                                if (n < 5 || n > 200) { return '范围为 5 到 200'; }
                                return undefined;
                            }
                        });
                        if (val) {
                            const n = Math.max(5, Math.min(200, Number(val)));
                            await cfg.update('roles.details.wrapColumn', n, vscode.ConfigurationTarget.Workspace);
                            vscode.window.showInformationMessage(`折行列数已设置为 ${n}`);
                        }
                        break;
                    }
                    case 'toggleRoleExpansion': {
                        await cfg.update('roles.details.enableRoleExpansion', !enableRoleExpansion, vscode.ConfigurationTarget.Workspace);
                        vscode.window.showInformationMessage(`角色展开已${!enableRoleExpansion ? '启用' : '禁用'}`);
                        break;
                    }
                    case 'toggleColorizeName': {
                        if (sync) { await configureDocRoles(); return; }
                        await cfg.update('allRoles.display.colorizeRoleName', !colorizeRoleName, vscode.ConfigurationTarget.Workspace);
                        vscode.window.showInformationMessage(`全部角色：名称颜色标记已${!colorizeRoleName ? '启用' : '禁用'}`);
                        break;
                    }
                    case 'manageCustomGroups': {
                        // 复用相同的编辑器，但作用到 allRoles.customGroups
                        const prev = cfg.get<any[]>('allRoles.customGroups', []);
                        await cfg.update('docRoles.customGroups', prev, vscode.ConfigurationTarget.Workspace);
                        await manageCustomGroups();
                        const next = cfg.get<any[]>('docRoles.customGroups', []);
                        await cfg.update('allRoles.customGroups', next, vscode.ConfigurationTarget.Workspace);
                        vscode.commands.executeCommand('AndreaNovelHelper.refreshRoles');
                        break;
                    }
                    case 'back':
                        await quickSettings();
                        return;
                }
            } catch (e:any) {
                vscode.window.showErrorMessage(`配置全部角色失败：${e?.message || e}`);
            }
        }
    }

    // 管理自定义分组规则
    async function manageCustomGroups() {
        const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
        
        while (true) {
            const customGroups = cfg.get<any[]>('docRoles.customGroups', []);
            
            interface GroupChoice extends vscode.QuickPickItem {
                action: string;
                index?: number;
            }
            
            const choices: GroupChoice[] = [
                ...customGroups.map((group, index) => ({
                    label: `$(organization) ${group.name}`,
                    description: `${group.matchType} 匹配: ${group.patterns?.join(', ') || '无'}`,
                    action: 'edit',
                    index
                })),
                {
                    label: '$(add) 添加新的分组规则',
                    description: '创建一个新的自定义分组',
                    action: 'add'
                },
                {
                    label: '$(trash) 重置为默认规则',
                    description: '恢复到默认的自定义分组配置',
                    action: 'reset'
                },
                {
                    label: '$(arrow-left) 返回角色配置',
                    description: '返回角色显示配置',
                    action: 'back'
                }
            ];

            const pick = await vscode.window.showQuickPick(choices, {
                placeHolder: '管理自定义分组规则'
            });

            if (!pick) { return; }

            try {
                switch (pick.action) {
                    case 'add': {
                        await addCustomGroup();
                        break;
                    }
                    case 'edit': {
                        if (typeof pick.index === 'number') {
                            await editCustomGroup(pick.index);
                        }
                        break;
                    }
                    case 'reset': {
                        const confirm = await vscode.window.showWarningMessage(
                            '确定要重置自定义分组规则吗？这将删除所有当前的自定义规则并恢复默认配置。',
                            { modal: true },
                            '确定重置'
                        );
                        if (confirm) {
                            const defaultGroups = [
                                {
                                    name: "词汇敏感词",
                                    matchType: "type",
                                    patterns: ["词汇", "敏感词", "正则表达式"]
                                },
                                {
                                    name: "主要角色",
                                    matchType: "affiliation",
                                    patterns: ["主角", "重要", "主要"]
                                },
                                {
                                    name: "配角",
                                    matchType: "affiliation", 
                                    patterns: ["配角", "次要", "其他"]
                                }
                            ];
                            await cfg.update('docRoles.customGroups', defaultGroups, vscode.ConfigurationTarget.Workspace);
                            vscode.window.showInformationMessage('自定义分组规则已重置为默认配置');
                            vscode.commands.executeCommand('AndreaNovelHelper.refreshRoles');
                        }
                        break;
                    }
                    case 'back':
                        return;
                }
            } catch (error: any) {
                vscode.window.showErrorMessage(`管理自定义分组失败：${error?.message || error}`);
            }
        }
    }

    // 添加自定义分组
    async function addCustomGroup() {
        const name = await vscode.window.showInputBox({
            prompt: '请输入分组名称',
            placeHolder: '例如：主要角色、反派角色等'
        });
        if (!name) { return; }

        const matchType = await vscode.window.showQuickPick([
            { label: '$(symbol-namespace) 归属字段', value: 'affiliation' },
            { label: '$(symbol-class) 类型字段', value: 'type' }
        ], {
            placeHolder: '选择匹配字段类型'
        });
        if (!matchType) { return; }

        const patternsInput = await vscode.window.showInputBox({
            prompt: '请输入匹配模式（用逗号分隔多个模式）',
            placeHolder: '例如：主角,重要 或 人类,动物'
        });
        if (!patternsInput) { return; }

        const patterns = patternsInput.split(',').map(p => p.trim()).filter(p => p);
        
        const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
        const customGroups = cfg.get<any[]>('docRoles.customGroups', []);
        
        customGroups.push({
            name,
            matchType: matchType.value,
            patterns
        });

        await cfg.update('docRoles.customGroups', customGroups, vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage(`自定义分组 "${name}" 已添加`);
        vscode.commands.executeCommand('AndreaNovelHelper.refreshRoles');
    }

    // 编辑自定义分组
    async function editCustomGroup(index: number) {
        const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
        const customGroups = cfg.get<any[]>('docRoles.customGroups', []);
        
        if (index < 0 || index >= customGroups.length) { return; }
        
        const group = customGroups[index];
        
        const choices = [
            {
                label: `$(edit) 修改名称: ${group.name}`,
                action: 'name'
            },
            {
                label: `$(symbol-field) 修改匹配类型: ${group.matchType === 'affiliation' ? '归属' : '类型'}`,
                action: 'matchType'
            },
            {
                label: `$(list-ordered) 修改匹配模式: ${group.patterns?.join(', ') || '无'}`,
                action: 'patterns'
            },
            {
                label: '$(trash) 删除此分组',
                action: 'delete'
            },
            {
                label: '$(arrow-left) 返回',
                action: 'back'
            }
        ];

        const pick = await vscode.window.showQuickPick(choices, {
            placeHolder: `编辑分组: ${group.name}`
        });

        if (!pick) { return; }

        try {
            switch (pick.action) {
                case 'name': {
                    const newName = await vscode.window.showInputBox({
                        prompt: '请输入新的分组名称',
                        value: group.name
                    });
                    if (newName && newName !== group.name) {
                        customGroups[index].name = newName;
                        await cfg.update('docRoles.customGroups', customGroups, vscode.ConfigurationTarget.Workspace);
                        vscode.window.showInformationMessage(`分组名称已更新为 "${newName}"`);
                        vscode.commands.executeCommand('AndreaNovelHelper.refreshRoles');
                    }
                    break;
                }
                case 'matchType': {
                    const newMatchType = await vscode.window.showQuickPick([
                        { label: '$(symbol-namespace) 归属字段', value: 'affiliation' },
                        { label: '$(symbol-class) 类型字段', value: 'type' }
                    ], {
                        placeHolder: '选择新的匹配字段类型'
                    });
                    if (newMatchType && newMatchType.value !== group.matchType) {
                        customGroups[index].matchType = newMatchType.value;
                        await cfg.update('docRoles.customGroups', customGroups, vscode.ConfigurationTarget.Workspace);
                        vscode.window.showInformationMessage(`匹配类型已更新为 "${newMatchType.label}"`);
                        vscode.commands.executeCommand('AndreaNovelHelper.refreshRoles');
                    }
                    break;
                }
                case 'patterns': {
                    const currentPatterns = group.patterns?.join(', ') || '';
                    const newPatternsInput = await vscode.window.showInputBox({
                        prompt: '请输入新的匹配模式（用逗号分隔）',
                        value: currentPatterns
                    });
                    if (newPatternsInput !== undefined) {
                        const newPatterns = newPatternsInput.split(',').map(p => p.trim()).filter(p => p);
                        customGroups[index].patterns = newPatterns;
                        await cfg.update('docRoles.customGroups', customGroups, vscode.ConfigurationTarget.Workspace);
                        vscode.window.showInformationMessage('匹配模式已更新');
                        vscode.commands.executeCommand('AndreaNovelHelper.refreshRoles');
                    }
                    break;
                }
                case 'delete': {
                    const confirm = await vscode.window.showWarningMessage(
                        `确定要删除分组 "${group.name}" 吗？`,
                        { modal: true },
                        '确定删除'
                    );
                    if (confirm) {
                        customGroups.splice(index, 1);
                        await cfg.update('docRoles.customGroups', customGroups, vscode.ConfigurationTarget.Workspace);
                        vscode.window.showInformationMessage(`分组 "${group.name}" 已删除`);
                        vscode.commands.executeCommand('AndreaNovelHelper.refreshRoles');
                        return; // 删除后返回分组列表
                    }
                    break;
                }
                case 'back':
                    return;
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`编辑分组失败：${error?.message || error}`);
        }
        
        // 递归调用以继续编辑
        await editCustomGroup(index);
    }


    // 主面板
    async function quickSettings() {
        const cfg = vscode.workspace.getConfiguration();
        const compact = cfg.get<boolean>('andrea.typeset.statusBar.compact', false);
        const on = cfg.get<boolean>('andrea.typeset.indentFirstTwoSpaces', true);
        const blank = cfg.get<number>('andrea.typeset.blankLinesBetweenParas', 1) ?? 1;
        const trim = cfg.get<boolean>('andrea.typeset.trimTrailingSpaces', true);
        const ap = cfg.get<boolean>('andrea.typeset.enableAutoPairs', true);
        const se = cfg.get<boolean>('andrea.typeset.enableSmartEnter', true);
        const sx = cfg.get<boolean>('andrea.typeset.enableSmartExit', true);

        const editorCfg = vscode.workspace.getConfiguration('editor');
        const wrap = editorCfg.get<string>('wordWrap', 'off'); // off | on | wordWrapColumn | bounded
        const minimap = editorCfg.get<boolean>('minimap.enabled', true);
        const wheelZoom = editorCfg.get<boolean>('mouseWheelZoom', false);
        
        // 智能分组锁配置
        const smartTabGroupLockEnabled = cfg.get<boolean>('AndreaNovelHelper.smartTabGroupLock.enabled', true);


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
                { label: '$(filter) 管理：写作资源忽略 (.wcignore)', cmd: 'andrea.manageWcignore' },
                { label: '$(go-to-file) 打开 .wcignore', cmd: 'andrea.openWcignore' },
                { label: '$(milestone) 配置：字数里程碑提醒', cmd: 'andrea.configureMilestones' },
                { label: '$(organization) 配置：当前文章角色显示', cmd: 'andrea.configureDocRoles' },
                { label: '$(organization) 配置：全部角色显示', cmd: 'andrea.configureAllRoles' },
                { label: '$(search-fuzzy) 错别字识别快速设置', cmd: 'andrea.typo.quickSettings' },
                { label: `${minimap ? '$(check)' : '$(circle-slash)'} 切换：Minimap（小地图）`, cmd: 'andrea.toggleMinimap' },
                { label: `${wheelZoom ? '$(check)' : '$(circle-slash)'} 切换：Ctrl+滚轮快速缩放字体`, cmd: 'andrea.toggleMouseWheelZoom' },

                { label: `${smartTabGroupLockEnabled ? '$(check)' : '$(circle-slash)'} 切换：智能分组锁`, cmd: 'andrea.toggleSmartTabGroupLock' },

                { label: `${compact ? '$(check)' : '$(circle-slash)'} 切换：状态栏显示（当前 ${compact ? '简略' : '详细'}）`, cmd: 'andrea.toggleStatusBarCompact' },
                { label: `${vscode.workspace.getConfiguration('AndreaNovelHelper.autoGit').get('compactStatus', false) ? '$(check)' : '$(circle-slash)'} 切换：ANH:Sync 简洁模式（仅显示 ANH:Sync）`, cmd: 'andrea.toggleAutoGitCompact' },
                { label: '$(paintcan) 立即排版全文', cmd: 'andrea.formatDocument' },

                { label: '$(keyboard) [仅需执行一次｜智能回车失效时使用] 一键注入：Enter → Andrea（覆盖 MAIO）', cmd: 'andrea.injectEnterKeybindings' },
            ],
            { placeHolder: '小说版式和快速设置', canPickMany: false }
        );

        if (pick?.cmd) { await vscode.commands.executeCommand(pick.cmd); }
    }

    // 配置字数里程碑
    async function configureMilestones() {
        while (true) {
            const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper.timeStats');
            const enabled = cfg.get<boolean>('milestone.enabled', true);
            const targets = cfg.get<number[]>('milestone.targets', [1000, 5000, 10000, 20000, 50000, 100000]);
            const notificationType = cfg.get<string>('milestone.notificationType', 'information');

            const choices = [
                { 
                    label: `${enabled ? '$(check)' : '$(circle-slash)'} 启用字数里程碑提醒`, 
                    description: enabled ? '当前已启用' : '当前已禁用',
                    action: 'toggle' 
                },
                { 
                    label: '$(edit) 编辑里程碑目标', 
                    description: `当前目标：${targets.join(', ')} 字`,
                    action: 'edit' 
                },
                { 
                    label: '$(bell) 配置提醒类型', 
                    description: notificationType === 'modal' ? '当前：模态对话框（阻塞）' : '当前：右下角提示（非阻塞）',
                    action: 'notification' 
                },
                { 
                    label: '$(arrow-left) 返回主设置', 
                    description: '返回快速设置主面板',
                    action: 'back' 
                }
            ];

            const pick = await vscode.window.showQuickPick(choices, { 
                placeHolder: '配置字数里程碑提醒功能'
            });

            if (!pick || pick.action === 'back') { 
                if (pick?.action === 'back') {
                    await quickSettings(); // 返回主设置面板
                }
                return; 
            }

            if (pick.action === 'toggle') {
                await cfg.update('milestone.enabled', !enabled, vscode.ConfigurationTarget.Workspace);
                vscode.window.showInformationMessage(`字数里程碑提醒已${!enabled ? '启用' : '禁用'}`);
                onRefreshStatus();
                // 继续循环，保持在当前面板
            } else if (pick.action === 'edit') {
                const input = await vscode.window.showInputBox({
                    prompt: '输入里程碑目标字数，用逗号分隔',
                    value: targets.join(', '),
                    placeHolder: '例如：1000, 5000, 10000, 50000, 100000'
                });

                if (input !== undefined) {
                    try {
                        const newTargets = input.split(',')
                            .map(s => parseInt(s.trim()))
                            .filter(n => !isNaN(n) && n > 0)
                            .sort((a, b) => a - b);
                        
                        if (newTargets.length > 0) {
                            await cfg.update('milestone.targets', newTargets, vscode.ConfigurationTarget.Workspace);
                            vscode.window.showInformationMessage(`里程碑目标已更新：${newTargets.join(', ')} 字`);
                        } else {
                            vscode.window.showErrorMessage('请输入有效的数字');
                        }
                    } catch (error) {
                        vscode.window.showErrorMessage('格式不正确，请使用逗号分隔的数字');
                    }
                }
                onRefreshStatus();
                // 继续循环，保持在当前面板
            } else if (pick.action === 'notification') {
                const typeChoices = [
                    { 
                        label: '$(info) 右下角提示', 
                        description: '非阻塞，不影响写作流程',
                        value: 'information' 
                    },
                    { 
                        label: '$(comment-discussion) 模态对话框', 
                        description: '阻塞操作，需要用户确认',
                        value: 'modal' 
                    }
                ];

                const typePick = await vscode.window.showQuickPick(typeChoices, { 
                    placeHolder: '选择里程碑提醒的弹窗类型'
                });

                if (typePick) {
                    await cfg.update('milestone.notificationType', typePick.value, vscode.ConfigurationTarget.Workspace);
                    vscode.window.showInformationMessage(`提醒类型已更新为：${typePick.label}`);
                }
                onRefreshStatus();
                // 继续循环，保持在当前面板
            }
        }
    }

    // 命令注册
    context.subscriptions.push(
        vscode.commands.registerCommand('andrea.toggleMinimap', () => toggle('editor.minimap.enabled')),
        vscode.commands.registerCommand('andrea.toggleMouseWheelZoom', () => toggle('editor.mouseWheelZoom')),
        vscode.commands.registerCommand('andrea.toggleStatusBarCompact', () => toggle('andrea.typeset.statusBar.compact')),
        vscode.commands.registerCommand('andrea.toggleSmartTabGroupLock', () => toggle('AndreaNovelHelper.smartTabGroupLock.enabled')),
        vscode.commands.registerCommand('andrea.quickSettings', quickSettings),
    vscode.commands.registerCommand('andrea.configureMilestones', configureMilestones),
    vscode.commands.registerCommand('andrea.manageWcignore', manageWcignore),
    vscode.commands.registerCommand('andrea.openWcignore', openWcignore),
    vscode.commands.registerCommand('andrea.configureDocRoles', configureDocRoles),
    vscode.commands.registerCommand('andrea.configureAllRoles', configureAllRoles),

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
