import * as vscode from 'vscode';

/**
 * 自动滚动提供器
 * 提供编辑器自动滚动到文档末尾的功能，支持自定义滚动比例
 */
export class AutoScrollProvider {
    private statusBarItem: vscode.StatusBarItem;
    private isAutoScrollEnabled: boolean = false;
    private scrollRatio: number = 1.0;
    private debounceTimer: NodeJS.Timeout | undefined;
    private debounceDelay: number = 500; // 防抖延迟（毫秒）
    private lastLineCount: number = 0; // 记录上次检查时的行数

    constructor() {
        // 创建状态栏项
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBarItem.command = 'andrea.autoScroll.toggleMenu';
        this.updateStatusBarItem();
    }

    /**
     * 激活自动滚动提供器
     */
    public activate(context: vscode.ExtensionContext): void {
        // 注册命令
        context.subscriptions.push(
            vscode.commands.registerCommand('andrea.autoScroll.toggleMenu', () => {
                this.showQuickMenu();
            }),
            vscode.commands.registerCommand('andrea.autoScroll.toggle', () => {
                this.toggleAutoScroll();
            }),
            vscode.commands.registerCommand('andrea.autoScroll.setRatio', () => {
                this.setScrollRatio();
            }),
            vscode.commands.registerCommand('andrea.autoScroll.scrollNow', () => {
                this.scrollToEndNow();
            }),
            vscode.commands.registerCommand('andrea.autoScroll.scrollToEnd', () => {
                this.scrollToEndNow();
            })
        );

        // 加载配置
        this.loadConfiguration();

        // 监听配置变化
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration('AndreaNovelHelper.autoScroll')) {
                    const oldDebounceDelay = this.debounceDelay;
                    this.loadConfiguration();
                    
                    // 如果防抖延迟发生变化，清除当前定时器
                    if (oldDebounceDelay !== this.debounceDelay && this.debounceTimer) {
                        clearTimeout(this.debounceTimer);
                        this.debounceTimer = undefined;
                        
                        // 如果新的防抖延迟为0且自动滚动已启用，立即执行一次滚动
                        if (this.debounceDelay <= 0 && this.isAutoScrollEnabled) {
                            this.scrollToEndNow();
                        }
                    }
                }
            })
        );

        // 监听文档变化
        context.subscriptions.push(
            vscode.workspace.onDidChangeTextDocument(event => {
                if (this.isAutoScrollEnabled) {
                    // 检查文档是否实际增加了内容（行数增加）
                    const currentLineCount = event.document.lineCount;
                    const lineCountIncreased = currentLineCount > this.lastLineCount;
                    
                    // 如果行数增加，或者行数没有变化但有内容变化（在同一行内编辑）
                    if (lineCountIncreased || (currentLineCount === this.lastLineCount && event.contentChanges.length > 0)) {
                        this.lastLineCount = currentLineCount;
                        this.scheduleScrollToEnd();
                    }
                }
            })
        );

        // 监听活动编辑器变化
        context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor(editor => {
                if (editor && this.isAutoScrollEnabled) {
                    // 初始化当前编辑器的行数
                    this.lastLineCount = editor.document.lineCount;
                    this.scheduleScrollToEnd();
                }
            })
        );

        // 显示状态栏项
        this.statusBarItem.show();
    }

    /**
     * 显示快速选择菜单
     */
    public async showQuickMenu(): Promise<void> {
        const enabledIcon = this.isAutoScrollEnabled ? '$(check)' : '$(circle-slash)';
        const currentRatioLabel = this.getCurrentRatioLabel();
        
        const options = [
            {
                label: `${enabledIcon} 自动滚动`,
                description: this.isAutoScrollEnabled ? '已启用' : '已禁用',
                action: 'toggle'
            },
            {
                label: '$(arrow-down) 滚动比例',
                description: `当前: ${currentRatioLabel}`,
                action: 'ratio'
            },
            {
                label: '$(arrow-down) 立即滚动到末尾',
                description: `使用当前比例 (${currentRatioLabel})`,
                action: 'scrollNow'
            }
        ];

        const choice = await vscode.window.showQuickPick(options, {
            placeHolder: '自动滚动设置'
        });

        if (choice) {
            switch (choice.action) {
                case 'toggle':
                    this.toggleAutoScroll();
                    break;
                case 'ratio':
                    this.setScrollRatio();
                    break;
                case 'scrollNow':
                    this.scrollToEndNow();
                    break;
            }
        }
    }

    /**
     * 切换自动滚动状态
     */
    public toggleAutoScroll(): void {
        this.isAutoScrollEnabled = !this.isAutoScrollEnabled;
        this.saveConfiguration();
        this.updateStatusBarItem();
        
        if (this.isAutoScrollEnabled) {
            // 初始化当前编辑器的行数
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                this.lastLineCount = activeEditor.document.lineCount;
            }
            this.scheduleScrollToEnd();
        }
    }

    /**
     * 设置滚动比例
     */
    public async setScrollRatio(): Promise<void> {
        const currentRatioLabel = this.getCurrentRatioLabel();
        
        const options = [
            { label: '下半部分 (70%)', value: 0.7 },
            { label: '中下方 (60%)', value: 0.6 },
            { label: '中间偏下 (50%)', value: 0.5 },
            { label: '中间 (40%)', value: 0.4 },
            { label: '中上方 (30%)', value: 0.3 },
            { label: '上半部分 (20%)', value: 0.2 },
            { label: '顶部 (10%)', value: 0.1 },
            { label: '自定义...', value: 'custom' }
        ];

        const choice = await vscode.window.showQuickPick(options, {
            placeHolder: `选择滚动比例 (当前: ${currentRatioLabel})`
        });

        if (choice) {
            if (choice.value === 'custom') {
                const input = await vscode.window.showInputBox({
                    prompt: '输入自定义滚动比例 (0.0-1.0)',
                    value: this.scrollRatio.toString(),
                    validateInput: (value) => {
                        const num = parseFloat(value);
                        if (isNaN(num) || num < 0.1 || num > 0.7) {
                            return '请输入 0.1 到 0.7 之间的数字';
                        }
                        return null;
                    }
                });
                
                if (input) {
                    this.scrollRatio = parseFloat(input);
                }
            } else {
                this.scrollRatio = choice.value as number;
            }
            
            this.saveConfiguration();
            this.updateStatusBarItem();
            
            if (this.isAutoScrollEnabled) {
                this.scheduleScrollToEnd();
            }
        }
    }

    /**
     * 立即滚动到末尾
     */
    public scrollToEndNow(): void {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        this.scrollToEndByRatio(editor, this.scrollRatio);
    }

    /**
     * 按比例滚动到文档末尾
     * @param editor 文本编辑器
     * @param ratio 滚动比例 (0.0-1.0)
     */
    private scrollToEndByRatio(editor: vscode.TextEditor, ratio: number): void {
        const document = editor.document;
        const lastLine = Math.max(0, document.lineCount - 1);

        // 获取可见行数近似值，考虑折行情况
        const visibleRanges = editor.visibleRanges;
        let visibleLines = 30; // 默认值
        
        if (visibleRanges && visibleRanges.length > 0) {
            const firstRange = visibleRanges[0];
            // 考虑折行的情况，使用行差作为可见行数的近似值
            visibleLines = Math.max(1, firstRange.end.line - firstRange.start.line);
            
            // 如果启用了折行，我们需要估算实际的可见行数
            const wordWrapConfig = vscode.workspace.getConfiguration('editor', document.uri);
            const wordWrap = wordWrapConfig.get<string>('wordWrap', 'off');
            
            if (wordWrap !== 'off') {
                // 对于折行模式，增加可见行数的估算值
                // 这只是一个粗略的估算，因为精确计算需要考虑每行的实际长度
                visibleLines = Math.round(visibleLines * 1.5);
            }
        }

        // 比例的定义：ratio 表示末尾行应该出现在视口中的相对位置
        // 0.0 = 末尾行在视口顶部
        // 0.5 = 末尾行在视口中间
        // 1.0 = 末尾行在视口底部
        
        // 比例的定义：ratio 表示末尾行应该出现在视口中的相对位置
        // 0.1 = 末尾行在视口顶部 10% 位置
        // 0.5 = 末尾行在视口中间
        // 0.7 = 末尾行在视口底部 30% 位置
        
        // 计算目标行：我们需要找到一个行，当它显示在视口顶部时，
        // 末尾行会出现在视口的指定比例位置
        const targetLine = Math.max(0, lastLine - Math.round(visibleLines * ratio));
        
        // 直接执行滚动，不做位置相近检查
        const targetPos = new vscode.Position(targetLine, 0);
        const targetRange = new vscode.Range(targetPos, targetPos);
        
        // 对于所有比例，都使用 AtTop，这样末尾行会自然地出现在比例位置
        editor.revealRange(targetRange, vscode.TextEditorRevealType.AtTop);
    }

    /**
     * 防抖处理滚动到末尾
     */
    private scheduleScrollToEnd(): void {
        // 清除之前的定时器
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        // 如果防抖延迟为0，立即执行
        if (this.debounceDelay <= 0) {
            this.scrollToEndNow();
            return;
        }

        // 否则使用防抖延迟
        this.debounceTimer = setTimeout(() => {
            this.scrollToEndNow();
        }, this.debounceDelay);
    }

    /**
     * 加载配置
     */
    private loadConfiguration(): void {
        const config = vscode.workspace.getConfiguration('AndreaNovelHelper.autoScroll');
        this.isAutoScrollEnabled = config.get<boolean>('enabled', false);
        this.scrollRatio = config.get<number>('ratio', 1.0);
        this.debounceDelay = config.get<number>('debounceDelay', 500);
        this.updateStatusBarItem();
    }

    /**
     * 保存配置
     */
    private saveConfiguration(): void {
        const config = vscode.workspace.getConfiguration('AndreaNovelHelper.autoScroll');
        config.update('enabled', this.isAutoScrollEnabled, vscode.ConfigurationTarget.Global);
        config.update('ratio', this.scrollRatio, vscode.ConfigurationTarget.Global);
        config.update('debounceDelay', this.debounceDelay, vscode.ConfigurationTarget.Global);
    }

    /**
     * 更新状态栏项
     */
    private updateStatusBarItem(): void {
        const enabledIcon = this.isAutoScrollEnabled ? '$(arrow-down)' : '$(arrow-circle-down)';
        const ratioLabel = this.getCurrentRatioLabel();
        this.statusBarItem.text = `${enabledIcon} 自动滚动 ${ratioLabel}`;
        this.statusBarItem.tooltip = `自动滚动: ${this.isAutoScrollEnabled ? '已启用' : '已禁用'}\n滚动比例: ${ratioLabel}\n点击设置`;
    }

    /**
     * 获取当前比例的标签
     */
    private getCurrentRatioLabel(): string {
        return `${Math.round(this.scrollRatio * 100)}%`;
    }

    /**
     * 释放资源
     */
    public dispose(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.statusBarItem.dispose();
    }
}