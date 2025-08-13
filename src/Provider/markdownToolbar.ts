/* eslint-disable curly */
import * as vscode from 'vscode';

let disposables: vscode.Disposable[] = [];
let statusBarItem: vscode.StatusBarItem | undefined;

const MD_KIND_ROOT = vscode.CodeActionKind.Refactor.append('markdown');

class MarkdownCodeActionProvider implements vscode.CodeActionProvider {
    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken
    ): vscode.CodeAction[] {
        // 检查配置是否启用
        const config = vscode.workspace.getConfiguration('AndreaNovelHelper');
        const toolbarEnabled = config.get<boolean>('markdownToolbarEnabled', true);
        if (!toolbarEnabled) return [];

        // 只在有选中文本时提供操作
        if (range.isEmpty) return [];

        // 只在 markdown 和 plaintext 文件中提供操作
        if (!['markdown', 'plaintext'].includes(document.languageId)) return [];

        const selectedText = document.getText(range);
        if (!selectedText.trim()) return [];

        const actions: vscode.CodeAction[] = [];

        // 内联格式化操作
        actions.push(this.createFormatAction('$(text-size) 粗体', 'bold', range));
        actions.push(this.createFormatAction('$(italic) 斜体', 'italic', range));
        actions.push(this.createFormatAction('$(edit) 删除线', 'strike', range));
        actions.push(this.createFormatAction('$(symbol-string) 行内代码', 'code', range));
        actions.push(this.createLinkAction('$(link-external) 转换为链接', range));

        // 标题操作
        actions.push(this.createBlockAction('$(symbol-text) H1 标题', 'h1', range));
        actions.push(this.createBlockAction('$(symbol-text) H2 标题', 'h2', range));
        actions.push(this.createBlockAction('$(symbol-text) H3 标题', 'h3', range));
        actions.push(this.createBlockAction('$(symbol-text) H4 标题', 'h4', range));

        // 列表和其他块级格式化操作
        actions.push(this.createBlockAction('$(list-flat) 无序列表', 'ul', range));
        actions.push(this.createBlockAction('$(list-ordered) 有序列表', 'ol', range));
        actions.push(this.createBlockAction('$(checklist) 任务列表', 'task', range));
        actions.push(this.createBlockAction('$(quote) 引用', 'quote', range));

        // 清除格式操作
        if (this.hasMarkdownFormatting(selectedText)) {
            actions.push(this.createClearAction('$(clear-all) 清除格式', range));
        }

        // 添加打开完整菜单的选项
        actions.push(this.createMenuAction('$(tools) 更多格式选项...', range));

        return actions;
    }

    // private createFormatAction(title: string, action: string, range: vscode.Range): vscode.CodeAction {
    //     const codeAction = new vscode.CodeAction(title, vscode.CodeActionKind.Empty.append('markdown.format'));
    //     codeAction.command = {
    //         command: 'AndreaNovelHelper.applyMarkdownFormat',
    //         title: title,
    //         arguments: [action, range]
    //     };
    //     return codeAction;
    // }
    private createFormatAction(title: string, action: string, range: vscode.Range) {
        const kind = vscode.CodeActionKind.Source.append('markdown').append('format');
        const codeAction = new vscode.CodeAction(title, kind);
        codeAction.command = {
            command: 'AndreaNovelHelper.applyMarkdownFormat',
            title,
            arguments: [action, range]
        };
        return codeAction;
    }


    private createLinkAction(title: string, range: vscode.Range): vscode.CodeAction {
        const codeAction = new vscode.CodeAction(title, vscode.CodeActionKind.Empty.append('markdown.format'));
        codeAction.command = {
            command: 'AndreaNovelHelper.applyMarkdownFormat',
            title: title,
            arguments: ['link', range]
        };
        return codeAction;
    }

    private createBlockAction(title: string, action: string, range: vscode.Range): vscode.CodeAction {
        const codeAction = new vscode.CodeAction(title, vscode.CodeActionKind.Empty.append('markdown.format'));
        codeAction.command = {
            command: 'AndreaNovelHelper.applyMarkdownFormat',
            title: title,
            arguments: [action, range]
        };
        return codeAction;
    }

    private createClearAction(title: string, range: vscode.Range): vscode.CodeAction {
        const codeAction = new vscode.CodeAction(title, vscode.CodeActionKind.Empty.append('markdown.format'));
        codeAction.command = {
            command: 'AndreaNovelHelper.applyMarkdownFormat',
            title: title,
            arguments: ['clear', range]
        };
        return codeAction;
    }

    private createMenuAction(title: string, range: vscode.Range): vscode.CodeAction {
        const codeAction = new vscode.CodeAction(title, vscode.CodeActionKind.Empty.append('markdown.format'));
        codeAction.command = {
            command: 'AndreaNovelHelper.showMarkdownFormatMenu',
            title: title,
            arguments: []
        };
        return codeAction;
    }

    private isMultilineSelection(range: vscode.Range): boolean {
        return range.start.line !== range.end.line;
    }

    private hasMarkdownFormatting(text: string): boolean {
        return /(\*\*.*?\*\*|\*.*?\*|`.*?`|~~.*?~~|\[.*?\]\(.*?\)|^#+\s|^>\s|^[-*+]\s|^\d+\.\s)/m.test(text);
    }
}

export function activateMarkdownToolbar(context: vscode.ExtensionContext) {
    // 注册代码操作提供器
    const codeActionProvider = new MarkdownCodeActionProvider();
    const codeActionDisposable = vscode.languages.registerCodeActionsProvider(
        ['markdown', 'plaintext'],
        codeActionProvider,
        {
            providedCodeActionKinds: [MD_KIND_ROOT]
        }
    );

    const showForSelection = (editor: vscode.TextEditor) => {
        // 仅对 markdown 和 plaintext 生效
        if (!['markdown', 'plaintext'].includes(editor.document.languageId)) {
            hideStatusBar();
            return;
        }

        // 从配置中检查是否启用了工具条
        const config = vscode.workspace.getConfiguration('AndreaNovelHelper');
        const toolbarEnabled = config.get<boolean>('markdownToolbarEnabled', true);
        if (!toolbarEnabled) {
            hideStatusBar();
            return;
        }

        const sel = editor.selection;
        if (!sel || sel.isEmpty) {
            hideStatusBar();
            return;
        }

        // 显示状态栏工具条
        showStatusBarToolbar(editor, sel);
    };

    // 监听：选区变化、可见范围变化、活动编辑器变化、配置变化
    disposables.push(
        codeActionDisposable,
        vscode.window.onDidChangeTextEditorSelection(e => e.textEditor && showForSelection(e.textEditor)),
        vscode.window.onDidChangeActiveTextEditor(ed => ed && showForSelection(ed)),
        vscode.window.onDidChangeTextEditorVisibleRanges(e => e.textEditor && showForSelection(e.textEditor)),
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('AndreaNovelHelper.markdownToolbar')) {
                const ed = vscode.window.activeTextEditor;
                if (ed) showForSelection(ed);
            }
        }),
        vscode.commands.registerCommand('AndreaNovelHelper.applyMarkdownFormat', async (action: string, range: vscode.Range) => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            // 临时设置选区，然后处理格式化
            const originalSelection = editor.selection;
            const selection = new vscode.Selection(range.start, range.end);
            editor.selection = selection;

            const msg = { type: 'format', action: action };
            await handleMessage(msg, editor);

            // 恢复原始选区
            editor.selection = originalSelection;
        }),
        vscode.commands.registerCommand('AndreaNovelHelper.toggleMarkdownToolbar', () => {
            const config = vscode.workspace.getConfiguration('AndreaNovelHelper');
            const currentEnabled = config.get<boolean>('markdownToolbarEnabled', true);
            const newEnabled = !currentEnabled;

            config.update('markdownToolbarEnabled', newEnabled, vscode.ConfigurationTarget.Global).then(() => {
                const ed = vscode.window.activeTextEditor;
                if (!ed) return;
                if (newEnabled) {
                    showForSelection(ed);
                    vscode.window.showInformationMessage('Markdown 工具条已启用');
                } else {
                    hideStatusBar();
                    vscode.window.showInformationMessage('Markdown 工具条已禁用');
                }
            });
        }),
        vscode.commands.registerCommand('AndreaNovelHelper.showMarkdownFormatMenu', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            const selection = editor.selection;
            if (!selection || selection.isEmpty) return;

            const items = [
                { label: '$(bold) 粗体', action: 'bold' },
                { label: '$(italic) 斜体', action: 'italic' },
                { label: '$(strikethrough) 删除线', action: 'strike' },
                { label: '$(code) 行内代码', action: 'code' },
                { label: '$(link) 链接', action: 'link' },
                { label: '$(heading) H1 标题', action: 'h1' },
                { label: '$(heading) H2 标题', action: 'h2' },
                { label: '$(heading) H3 标题', action: 'h3' },
                { label: '$(heading) H4 标题', action: 'h4' },
                { label: '$(list-unordered) 无序列表', action: 'ul' },
                { label: '$(list-ordered) 有序列表', action: 'ol' },
                { label: '$(quote) 引用', action: 'quote' },
                { label: '$(tasklist) 任务列表', action: 'task' },
                { label: '$(clear-all) 清除格式', action: 'clear' }
            ];

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: '选择 Markdown 格式化选项'
            });

            if (selected) {
                const msg = { type: 'format', action: selected.action };
                await handleMessage(msg, editor);
            }
        })
    );

    // 初始显示
    if (vscode.window.activeTextEditor) {
        showForSelection(vscode.window.activeTextEditor);
    }

    // 注册到 context
    context.subscriptions.push(...disposables);
}

export function deactivateMarkdownToolbar() {
    hideStatusBar();
    disposables.forEach(d => d.dispose());
    disposables = [];
}

function hideStatusBar() {
    statusBarItem?.hide();
}

function showStatusBarToolbar(editor: vscode.TextEditor, selection: vscode.Selection) {
    if (!statusBarItem) {
        // 保留在右下角，避免干扰其他功能
        statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    }

    const selectedText = editor.document.getText(selection);
    const truncatedText = selectedText.length > 15 ? selectedText.substring(0, 15) + '...' : selectedText;

    // 使用更醒目的图标和文字
    statusBarItem.text = `$(tools) MD格式: "${truncatedText}"`;
    statusBarItem.tooltip = 'Markdown 格式化工具 - 点击打开选项';
    statusBarItem.command = 'AndreaNovelHelper.showMarkdownFormatMenu';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
    statusBarItem.show();

    // 状态栏作为备用方案，主要依赖代码操作
}

async function showQuickFormatOptions(editor: vscode.TextEditor, selection: vscode.Selection) {
    const commonFormats = [
        { label: '$(bold) 粗体 **文本**', action: 'bold', description: '将选中文本设为粗体' },
        { label: '$(italic) 斜体 *文本*', action: 'italic', description: '将选中文本设为斜体' },
        { label: '$(strikethrough) 删除线 ~~文本~~', action: 'strike', description: '将选中文本设为删除线' },
        { label: '$(code) 代码 `文本`', action: 'code', description: '将选中文本设为行内代码' },
        { label: '$(link) 链接 [文本](url)', action: 'link', description: '将选中文本转换为链接' },
        { label: '$(heading) H1 标题 # 文本', action: 'h1', description: '将选中文本转换为一级标题' },
        { label: '$(heading) H2 标题 ## 文本', action: 'h2', description: '将选中文本转换为二级标题' },
        { label: '$(list-unordered) 无序列表 - 文本', action: 'ul', description: '将选中文本转换为无序列表' },
        { label: '$(clear-all) 清除格式', action: 'clear', description: '移除所有 Markdown 格式' }
    ];

    const selected = await vscode.window.showQuickPick(commonFormats, {
        placeHolder: '选择常用的 Markdown 格式',
        matchOnDescription: true
    });

    if (selected) {
        const msg = { type: 'format', action: selected.action };
        await handleMessage(msg, editor);

        // 格式化完成后显示成功提示
        const selectedText = editor.document.getText(selection);
        const truncatedText = selectedText.length > 15 ? selectedText.substring(0, 15) + '...' : selectedText;
        vscode.window.showInformationMessage(
            `✅ 已应用${selected.label.split(' ')[1]}格式到："${truncatedText}"`
        );
    }
}

async function handleMessage(msg: any, editor: vscode.TextEditor) {
    if (msg?.type !== 'format') return;

    const action = msg.action as string;
    // 取最新选区（用户可能点按钮前又调整了选区）
    const sel = editor.selection;
    if (!sel) return;

    if (['bold', 'italic', 'strike', 'code', 'link'].includes(action)) {
        await inlineFormat(editor, sel, action as any);
    } else if (['clear'].includes(action)) {
        await clearFormat(editor, sel);
    } else {
        await blockFormat(editor, sel, action as any);
    }
}

// —— 内联格式 —— //
async function inlineFormat(
    editor: vscode.TextEditor,
    sel: vscode.Selection,
    action: 'bold' | 'italic' | 'strike' | 'code' | 'link'
) {
    const doc = editor.document;
    const text = doc.getText(sel);
    let left = '', right = '';

    if (action === 'bold') { left = right = '**'; }
    if (action === 'italic') { left = right = '*'; }
    if (action === 'strike') { left = right = '~~'; }
    if (action === 'code') { left = right = '`'; }
    if (action === 'link') {
        const url = await vscode.window.showInputBox({
            prompt: '输入链接 URL',
            value: 'https://',
            placeHolder: '请输入完整的链接地址'
        });
        if (!url) return;
        const linkText = text.trim() ? text : '链接文本';
        const replaced = `[${linkText}](${url})`;
        await editor.edit(ed => ed.replace(sel, replaced), {
            undoStopAfter: true,
            undoStopBefore: true
        });
        return;
    }

    const replaced = `${left}${text}${right}`;
    await editor.edit(ed => ed.replace(sel, replaced), {
        undoStopAfter: true,
        undoStopBefore: true
    });
}

// —— 块级格式（多行） —— //
async function blockFormat(
    editor: vscode.TextEditor,
    sel: vscode.Selection,
    action: 'h1' | 'h2' | 'h3' | 'h4' | 'ul' | 'ol' | 'quote' | 'task'
) {
    const doc = editor.document;
    const start = sel.start.line;
    const end = sel.end.line + (sel.end.character === 0 ? 0 : 1); // 选到行中间也算到该行
    const edits: { range: vscode.Range, text: string }[] = [];

    for (let line = start; line < end; line++) {
        const r = new vscode.Range(
            new vscode.Position(line, 0),
            new vscode.Position(line, Number.MAX_SAFE_INTEGER)
        );
        const lineText = doc.getText(r).replace(/\r?\n?$/, '');

        let newText = lineText;
        if (action === 'h1') newText = prefixOnce(lineText, '# ');
        if (action === 'h2') newText = prefixOnce(lineText, '## ');
        if (action === 'h3') newText = prefixOnce(lineText, '### ');
        if (action === 'h4') newText = prefixOnce(lineText, '#### ');
        if (action === 'ul') newText = prefixOnce(lineText, lineText.match(/^\s*[-*+]\s+/) ? '' : '- ');
        if (action === 'ol') newText = numbered(lineText);
        if (action === 'quote') newText = prefixOnce(lineText, '> ');
        if (action === 'task') newText = prefixOnce(lineText, lineText.match(/^\s*[-*+]\s*\[[ x]\]\s+/) ? '' : '- [ ] ');

        if (newText !== lineText) {
            edits.push({ range: r, text: newText });
        }
    }

    if (edits.length) {
        await editor.edit(ed => edits.forEach(e => ed.replace(e.range, e.text)), {
            undoStopAfter: true,
            undoStopBefore: true
        });
    }

    // 简单的有序列表：保持用户原缩进，统一成 "1. "
    function numbered(s: string): string {
        const m = s.match(/^(\s*)(?:\d+\.\s+)?(.*)$/);
        if (!m) return s;
        return `${m[1]}1. ${m[2]}`;
    }

    function prefixOnce(s: string, p: string): string {
        if (!p) return s;
        const re = new RegExp('^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        return re.test(s) ? s : p + s;
    }
}

// —— 清除格式 —— //
async function clearFormat(editor: vscode.TextEditor, sel: vscode.Selection) {
    const doc = editor.document;
    const text = doc.getText(sel);

    // 移除各种 Markdown 格式
    let cleaned = text
        // 移除粗体
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/__(.*?)__/g, '$1')
        // 移除斜体
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/_(.*?)_/g, '$1')
        // 移除删除线
        .replace(/~~(.*?)~~/g, '$1')
        // 移除行内代码
        .replace(/`(.*?)`/g, '$1')
        // 移除链接（保留文本）
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        // 移除图片（保留alt文本）
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');

    // 如果是多行选择，还要处理块级格式
    if (sel.start.line !== sel.end.line) {
        const lines = cleaned.split('\n');
        const cleanedLines = lines.map(line => {
            return line
                // 移除标题
                .replace(/^#+\s*/, '')
                // 移除列表标记
                .replace(/^(\s*)[-*+]\s*(\[[ x]\]\s*)?/, '$1')
                .replace(/^(\s*)\d+\.\s*/, '$1')
                // 移除引用
                .replace(/^>\s*/, '');
        });
        cleaned = cleanedLines.join('\n');
    }

    await editor.edit(ed => ed.replace(sel, cleaned), {
        undoStopAfter: true,
        undoStopBefore: true
    });
}
