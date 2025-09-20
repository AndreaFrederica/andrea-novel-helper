import * as vscode from 'vscode';

function normalizeViewType(vt?: string): string {
    if (!vt) { return ''; }
    return vt.replace(/^mainThread(WebviewView|Webview|CustomEditor)-/, '');
}


/**
 * 智能标签组锁定管理器
 * 当分屏仅包含ANH扩展提供的各种窗体时，自动锁定该分屏
 */
export class SmartTabGroupLockManager {
    private _isEnabled: boolean = false;
    private _disposables: vscode.Disposable[] = [];
    private _context: vscode.ExtensionContext;
    private _managedGroups: Set<number> = new Set(); // 跟踪由智能锁管理的组
    
    /**
     * 获取当前是否有智能锁正在运行（全局状态）
     */
    public get hasActiveLocks(): boolean {
        return this._isEnabled && this._managedGroups.size > 0;
    }

    constructor(context: vscode.ExtensionContext) {
        this._context = context;
        this._isEnabled = this.getConfiguration();
        this.activate();
    }

    /**
     * 清理资源
     */
    dispose(): void {
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
        // 清理所有由智能锁管理的组的锁定状态
        this.cleanupAllManagedLocks();
        this._managedGroups.clear();
    }

    /**
     * 清理所有由智能锁管理的组的锁定状态
     */
    private cleanupAllManagedLocks(): void {
        // 在扩展卸载时，解锁所有由智能锁管理的组
        for (const groupId of this._managedGroups) {
            const group = vscode.window.tabGroups.all[groupId];
            if (group) {
                // 切换到该组并解锁
                vscode.commands.executeCommand('workbench.action.focusGroup', groupId + 1)
                    .then(() => {
                        vscode.commands.executeCommand('workbench.action.unlockEditorGroup');
                    });
            }
        }
    }

    /**
     * 激活智能锁定功能
     */
    public activate(): void {
        if (this._disposables.length > 0) {
            this.deactivate();
        }

        // 监听配置变化
        this._disposables.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('AndreaNovelHelper.smartTabGroupLock.enabled')) {
                    this._isEnabled = this.getConfiguration();
                    if (this._isEnabled) {
                        this.ensureSmartLock();
                    }
                }
            })
        );

        if (this._isEnabled) {
            // 初始检查
            this.ensureSmartLock();

            // 监听标签组变化事件
            this._disposables.push(
                vscode.window.tabGroups.onDidChangeTabs(() => this.ensureSmartLock()),
                vscode.window.tabGroups.onDidChangeTabGroups(() => {
                    // 清理已不存在的组的跟踪记录
                    this.cleanupManagedGroups();
                    this.ensureSmartLock();
                }),
                vscode.window.onDidChangeActiveTextEditor(() => this.ensureSmartLock())
            );
        }
    }

    /**
     * 停用智能锁定功能
     */
    public deactivate(): void {
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
    }

    /**
     * 获取配置
     */
    private getConfiguration(): boolean {
        return vscode.workspace.getConfiguration('AndreaNovelHelper.smartTabGroupLock').get('enabled', false);
    }

    /**
     * 判断标签是否为智能锁定的特殊窗体
     */
    private isAnhSpecialTab(tab: vscode.Tab): boolean {
        const input = tab.input;

        // 获取自定义配置的窗体类型
        const customViewTypes = this.getCustomViewTypes();

        // WebView类型 (支持内置和自定义类型)
        if (input instanceof vscode.TabInputWebview) {
            // ---- Webview / CustomEditor：按 viewType（去前缀）匹配 ----
            const rawVt = typeof input?.viewType === 'string' ? input.viewType : '';
            const viewType = normalizeViewType(rawVt);

            // 检查是否启用内置类型
            const enableBuiltinTypes = vscode.workspace.getConfiguration('AndreaNovelHelper.smartTabGroupLock').get('enableBuiltinTypes', true);

            // ANH的WebView类型
            const anhWebviewTypes = [
                'andreaComments',
                // 以下可能有问题




                'andrea.webdavPanel',
                'myPreview',  // 预览面板
                'andrea.commentsPanel',  // 批注面板
                'timeStatsDashboard',
                '写作统计仪表板',
                // Markdown相关插件
                'markdown.preview',
                'markdown.preview.side',
                'markdown-preview-enhanced.preview',
                'markdown.preview.enhanced',  // shd101wyy.markdown-preview-enhanced
                'markmap.preview',
                'marp-vscode.preview',
                // 其他常见预览插件
                'vscode.markdown.preview.editor',
                'vscode-markdown-preview-enhanced.preview'
            ];

            // 检查是否在ANH类型或自定义类型中
            const isBuiltinType = enableBuiltinTypes && anhWebviewTypes.includes(viewType);
            const isCustomType = customViewTypes.webview.includes(viewType);
            return isBuiltinType || isCustomType;
        }

        // 自定义编辑器 (支持配置排除特定编辑器)
        if (input instanceof vscode.TabInputCustom) {
            const viewType = (input as any).viewType;
            const config = vscode.workspace.getConfiguration('AndreaNovelHelper.smartTabGroupLock');

            // 检查是否需要排除特定编辑器类型
            const excludeRoleEditor = config.get('excludeRoleEditor', true);
            const excludeDiffEditor = config.get('excludeDiffEditor', true);
            const excludeNotesDiff = config.get('excludeNotesDiff', true);

            // 根据配置决定是否排除
            if (viewType === 'andrea.roleEditor' && excludeRoleEditor) {
                return false;
            }
            if (viewType === 'vscode.diff-editor' && excludeDiffEditor) {
                return false;
            }
            if (viewType === 'notes.diff' && excludeNotesDiff) {
                return false;
            }

            // 检查是否在自定义配置中
            return customViewTypes.custom.includes(viewType);
        }

        // TreeView 和其他特殊视图
        if (input instanceof vscode.TabInputText) {
            const uri = input.uri;

            // 检查是否启用内置类型
            const enableBuiltinTypes = vscode.workspace.getConfiguration('AndreaNovelHelper.smartTabGroupLock').get('enableBuiltinTypes', true);

            // ANH相关的特殊URI scheme
            const anhSchemes = [
                'andrea-outline',
                // 可以添加其他ANH相关的scheme
            ];

            // 检查是否在ANH scheme或自定义scheme中
            const isBuiltinScheme = enableBuiltinTypes && anhSchemes.includes(uri.scheme);
            const isCustomScheme = customViewTypes.schemes.includes(uri.scheme);
            return isBuiltinScheme || isCustomScheme;
        }

        // 笔记本类型
        if (input instanceof vscode.TabInputNotebook) {
            // 检查是否在自定义笔记本类型中
            const notebookType = (input as any).notebookType;
            return customViewTypes.notebook.includes(notebookType);
        }

        // Diff视图 (明确排除，作为普通窗体)
        if (input instanceof vscode.TabInputTextDiff) {
            // Diff视图被视为普通窗体，不参与智能锁定
            return false;
        }

        return false;
    }

    /**
     * 获取自定义配置的窗体类型
     */
    private getCustomViewTypes(): {
        webview: string[];
        custom: string[];
        schemes: string[];
        notebook: string[];
    } {
        const config = vscode.workspace.getConfiguration('AndreaNovelHelper.smartTabGroupLock');
        return {
            webview: config.get('customWebviewTypes', []),
            custom: config.get('customEditorTypes', []),
            schemes: config.get('customUriSchemes', []),
            notebook: config.get('customNotebookTypes', [])
        };
    }

    /**
     * 确保智能锁定逻辑
     */
    private ensureSmartLock(): void {
        if (!this._isEnabled) {
            return;
        }

        const group = vscode.window.tabGroups.activeTabGroup;
        if (!group) {
            return;
        }

        const groupId = this.getGroupId(group);
        const onlyAnhSpecial = group.tabs.length > 0 && group.tabs.every(tab => this.isAnhSpecialTab(tab));

        if (onlyAnhSpecial) {
            // 当只有ANH特殊标签时，锁定编辑器组并标记为由智能锁管理
            if (!this._managedGroups.has(groupId)) {
                vscode.commands.executeCommand('workbench.action.lockEditorGroup');
                this._managedGroups.add(groupId);
            }
        } else {
            // 当有其他标签时，只解锁由智能锁管理的组
            if (this._managedGroups.has(groupId)) {
                vscode.commands.executeCommand('workbench.action.unlockEditorGroup');
                this._managedGroups.delete(groupId);
            }
            // 如果组不是由智能锁管理的，不进行任何操作，保持用户手动设置的锁定状态
        }
    }

    /**
     * 获取标签组的唯一标识符
     * 由于VS Code API没有直接的组ID，我们使用组的索引作为标识
     */
    private getGroupId(group: vscode.TabGroup): number {
        return vscode.window.tabGroups.all.indexOf(group);
    }

    /**
     * 清理已不存在的组的跟踪记录
     */
    private cleanupManagedGroups(): void {
        const currentGroupIds = new Set(
            vscode.window.tabGroups.all.map((group, index) => index)
        );
        
        // 移除已不存在的组ID
        for (const groupId of this._managedGroups) {
            if (!currentGroupIds.has(groupId)) {
                this._managedGroups.delete(groupId);
            }
        }
    }

    /**
     * 手动触发智能锁定检查
     */
    public triggerSmartLock(): void {
        this.ensureSmartLock();
    }

    /**
     * 切换智能锁定功能
     */
    public async toggleSmartLock(): Promise<void> {
        const config = vscode.workspace.getConfiguration('AndreaNovelHelper.smartTabGroupLock');
        const currentValue = config.get('enabled', false);
        await config.update('enabled', !currentValue, vscode.ConfigurationTarget.Global);

        // 立即更新内部状态
        this._isEnabled = !currentValue;

        // 如果禁用了智能锁，清理所有由智能锁管理的锁定
        if (!this._isEnabled) {
            this.cleanupAllManagedLocks();
            this._managedGroups.clear();
        } else {
            // 如果启用了智能锁，立即检查当前状态
            this.ensureSmartLock();
        }

        vscode.window.showInformationMessage(
            `智能标签组锁定已${!currentValue ? '启用' : '禁用'}`
        );
    }

    /**
     * 获取当前启用状态
     */
    public get isEnabled(): boolean {
        return this._isEnabled;
    }
}