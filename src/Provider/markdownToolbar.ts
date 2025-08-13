/* eslint-disable curly */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

let inset: any | undefined;
let insetLine = -1;
let disposables: vscode.Disposable[] = [];
let statusBarItem: vscode.StatusBarItem | undefined;
let lastNotificationTime = 0;
const NOTIFICATION_COOLDOWN = 3000; // 3秒冷却时间

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
        actions.push(this.createFormatAction('$(bold) 将选中文本设为粗体', 'bold', range, '**'));
        actions.push(this.createFormatAction('$(italic) 将选中文本设为斜体', 'italic', range, '*'));
        actions.push(this.createFormatAction('$(strikethrough) 将选中文本设为删除线', 'strike', range, '~~'));
        actions.push(this.createFormatAction('$(code) 将选中文本设为行内代码', 'code', range, '`'));
        actions.push(this.createLinkAction('$(link) 将选中文本转换为链接', range));

        // 标题操作（总是显示，因为可以应用于单行或多行）
        actions.push(this.createBlockAction('$(heading) 转换为 H1 标题', 'h1', range));
        actions.push(this.createBlockAction('$(heading) 转换为 H2 标题', 'h2', range));
        actions.push(this.createBlockAction('$(heading) 转换为 H3 标题', 'h3', range));
        actions.push(this.createBlockAction('$(heading) 转换为 H4 标题', 'h4', range));

        // 列表和其他块级格式化操作
        actions.push(this.createBlockAction('$(list-unordered) 转换为无序列表', 'ul', range));
        actions.push(this.createBlockAction('$(list-ordered) 转换为有序列表', 'ol', range));
        actions.push(this.createBlockAction('$(tasklist) 转换为任务列表', 'task', range));
        actions.push(this.createBlockAction('$(quote) 转换为引用', 'quote', range));

        // 清除格式操作
        if (this.hasMarkdownFormatting(selectedText)) {
            actions.push(this.createClearAction('$(clear-all) 清除 Markdown 格式', range));
        }

        // 添加打开完整菜单的选项
        actions.push(this.createMenuAction('$(menu) 打开完整格式化菜单...', range));

        return actions;
    }

    private createFormatAction(title: string, action: string, range: vscode.Range, marker: string): vscode.CodeAction {
        const codeAction = new vscode.CodeAction(title, vscode.CodeActionKind.Refactor);
        codeAction.command = {
            command: 'AndreaNovelHelper.applyMarkdownFormat',
            title: title,
            arguments: [action, range]
        };
        return codeAction;
    }

    private createLinkAction(title: string, range: vscode.Range): vscode.CodeAction {
        const codeAction = new vscode.CodeAction(title, vscode.CodeActionKind.Refactor);
        codeAction.command = {
            command: 'AndreaNovelHelper.applyMarkdownFormat',
            title: title,
            arguments: ['link', range]
        };
        return codeAction;
    }

    private createBlockAction(title: string, action: string, range: vscode.Range): vscode.CodeAction {
        const codeAction = new vscode.CodeAction(title, vscode.CodeActionKind.Refactor);
        codeAction.command = {
            command: 'AndreaNovelHelper.applyMarkdownFormat',
            title: title,
            arguments: [action, range]
        };
        return codeAction;
    }

    private createClearAction(title: string, range: vscode.Range): vscode.CodeAction {
        const codeAction = new vscode.CodeAction(title, vscode.CodeActionKind.Refactor);
        codeAction.command = {
            command: 'AndreaNovelHelper.applyMarkdownFormat',
            title: title,
            arguments: ['clear', range]
        };
        return codeAction;
    }

    private createMenuAction(title: string, range: vscode.Range): vscode.CodeAction {
        const codeAction = new vscode.CodeAction(title, vscode.CodeActionKind.Refactor);
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
            providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.Refactor]
        }
    );

    const showForSelection = (editor: vscode.TextEditor) => {
        // 仅对 markdown 和 plaintext 生效
        if (!['markdown', 'plaintext'].includes(editor.document.languageId)) {
            hideInset();
            return;
        }

        // 从配置中检查是否启用了工具条
        const config = vscode.workspace.getConfiguration('AndreaNovelHelper');
        const toolbarEnabled = config.get<boolean>('markdownToolbarEnabled', true);
        if (!toolbarEnabled) {
            hideInset();
            return;
        }

        const sel = editor.selection;
        if (!sel || sel.isEmpty) {
            hideInset();
            return;
        }

        // 从配置中获取工具条高度
        const toolbarHeight = config.get<number>('markdownToolbarHeight', 28);

        // 将工具条锚定到选区的起始行
        const line = sel.start.line;
        // 若同一行已存在就不重复创建，仅更新内容
        if (!inset || insetLine !== line) {
            hideInset();
            insetLine = line;
            // 尝试使用实验性 API，如果不可用则显示状态栏消息
            try {
                const createInset = (vscode.window as any).createWebviewTextEditorInset;
                if (createInset) {
                    inset = createInset(editor, line, toolbarHeight);
                    inset.webview.options = { enableScripts: true };
                    inset.webview.html = getToolbarHtml(context);
                    inset.webview.onDidReceiveMessage((msg: any) => handleMessage(msg, editor));
                } else {
                    // 如果实验性 API 不可用，显示状态栏消息作为替代
                    showStatusBarToolbar(editor, sel);
                    return;
                }
            } catch (error) {
                console.error('WebviewTextEditorInset API error:', error);
                // 回退到状态栏显示
                showStatusBarToolbar(editor, sel);
                return;
            }
        } else if (inset) {
            // 已存在时同步刷新（主题变化等）
            inset.webview.html = getToolbarHtml(context);
        }
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
                    hideInset();
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
    hideInset();
    statusBarItem?.dispose();
    statusBarItem = undefined;
    disposables.forEach(d => d.dispose());
    disposables = [];
}

function hideInset() {
    inset?.dispose();
    inset = undefined;
    insetLine = -1;
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

function getToolbarHtml(context: vscode.ExtensionContext): string {
    // 读取HTML文件
    const htmlPath = path.join(__dirname, 'markdown-toolbar.html');
    try {
        return fs.readFileSync(htmlPath, 'utf8');
    } catch (error) {
        // 如果文件不存在，返回基本的HTML
        return getFallbackHtml();
    }
}

function getFallbackHtml(): string {
    return /* html */ `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          :root { color-scheme: light dark; }
          body { margin: 0; padding: 0; background: transparent; }
          .container {
            display: inline-flex; gap: 6px; align-items: center; padding: 2px 6px;
            border-radius: 6px; background: var(--vscode-editorWidget-background);
            color: var(--vscode-editor-foreground); border: 1px solid var(--vscode-editorWidget-border);
            box-shadow: 0 2px 8px rgba(0,0,0,.2); font: 12px/1 system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, 'Helvetica Neue', Arial;
          }
          button { border: none; background: transparent; color: inherit; padding: 3px 6px; border-radius: 4px; cursor: pointer; font-size: 11px; }
          button:hover { background: var(--vscode-toolbar-hoverBackground); }
          .sep { width: 1px; height: 14px; background: var(--vscode-editorWidget-border); margin: 0 2px; }
          .icon-btn { font-weight: bold; min-width: 20px; text-align: center; }
        </style>
      </head>
      <body>
        <div class="container">
          <button class="icon-btn" data-action="bold" title="粗体"><b>B</b></button>
          <button class="icon-btn" data-action="italic" title="斜体"><i>I</i></button>
          <button class="icon-btn" data-action="strike" title="删除线"><s>S</s></button>
          <button data-action="code" title="行内代码">code</button>
          <button data-action="link" title="链接">🔗</button>
          <div class="sep"></div>
          <button data-action="h1" title="一级标题">H1</button>
          <button data-action="h2" title="二级标题">H2</button>
          <button data-action="h3" title="三级标题">H3</button>
          <div class="sep"></div>
          <button data-action="ul" title="无序列表">• List</button>
          <button data-action="ol" title="有序列表">1. List</button>
          <button data-action="quote" title="引用">❝ Quote</button>
          <button data-action="task" title="任务列表">☐ Task</button>
          <div class="sep"></div>
          <button data-action="clear" title="清除格式">✕ Clear</button>
        </div>
        <script>
          const vscode = acquireVsCodeApi();
          document.body.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action]');
            if (!btn) return;
            vscode.postMessage({ type: 'format', action: btn.dataset.action });
          });
        </script>
      </body>
    </html>`;
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
