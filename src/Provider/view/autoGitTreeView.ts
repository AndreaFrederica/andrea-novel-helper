import * as vscode from 'vscode';
import * as path from 'path';

export interface AutoGitStatus {
    enabled: boolean;
    repositoryPath?: string;
    currentBranch?: string;
    hasChanges: boolean;
    lastCommit?: string;
    lastCheck?: Date;
    remoteStatus?: 'ahead' | 'behind' | 'up-to-date' | 'diverged' | 'unknown';
    pendingFiles?: string[];
}

export interface AutoGitItem {
    id: string;
    label: string;
    type: 'status' | 'action' | 'config' | 'file';
    description?: string;
    tooltip?: string;
    icon?: vscode.ThemeIcon;
    command?: vscode.Command;
    contextValue?: string;
}

export class AutoGitTreeItem extends vscode.TreeItem {
    constructor(
        public readonly item: AutoGitItem,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
    ) {
        super(item.label, collapsibleState);
        
        this.description = item.description;
        this.tooltip = item.tooltip || item.label;
        this.contextValue = item.contextValue || item.type;
        this.iconPath = item.icon;
        this.command = item.command;
    }
}

export class AutoGitTreeDataProvider implements vscode.TreeDataProvider<AutoGitTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<AutoGitTreeItem | undefined | null | void> = new vscode.EventEmitter<AutoGitTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<AutoGitTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private _context: vscode.ExtensionContext;
    private _status: AutoGitStatus = {
        enabled: false,
        hasChanges: false
    };

    constructor(context: vscode.ExtensionContext) {
        this._context = context;
        this._loadStatus();
    }

    refresh(): void {
        this._loadStatus();
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: AutoGitTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: AutoGitTreeItem): Promise<AutoGitTreeItem[]> {
        if (!element) {
            return this._getRootItems();
        }
        return [];
    }

    private _getRootItems(): AutoGitTreeItem[] {
        const items: AutoGitItem[] = [];

        // 状态显示
        items.push({
            id: 'status',
            label: this._status.enabled ? 'AutoGit 已启用' : 'AutoGit 已禁用',
            type: 'status',
            description: this._getStatusDescription(),
            icon: new vscode.ThemeIcon(this._status.enabled ? 'check' : 'x'),
            tooltip: this._getStatusTooltip()
        });

        // 仓库信息
        if (this._status.repositoryPath) {
            items.push({
                id: 'repo',
                label: '仓库',
                type: 'status',
                description: path.basename(this._status.repositoryPath),
                icon: new vscode.ThemeIcon('repo'),
                tooltip: this._status.repositoryPath
            });

            if (this._status.currentBranch) {
                items.push({
                    id: 'branch',
                    label: '分支',
                    type: 'status',
                    description: this._status.currentBranch,
                    icon: new vscode.ThemeIcon('git-branch'),
                    tooltip: `当前分支: ${this._status.currentBranch}`
                });
            }

            // 远程状态
            if (this._status.remoteStatus) {
                const remoteIcon = this._getRemoteStatusIcon(this._status.remoteStatus);
                items.push({
                    id: 'remote',
                    label: '远程状态',
                    type: 'status',
                    description: this._getRemoteStatusText(this._status.remoteStatus),
                    icon: new vscode.ThemeIcon(remoteIcon),
                    tooltip: `远程仓库状态: ${this._getRemoteStatusText(this._status.remoteStatus)}`
                });
            }
        }

        // 操作按钮
        items.push({
            id: 'toggle',
            label: this._status.enabled ? '禁用 AutoGit' : '启用 AutoGit',
            type: 'action',
            icon: new vscode.ThemeIcon(this._status.enabled ? 'stop' : 'play'),
            command: {
                command: 'andrea.autoGit.toggleEnabled',
                title: this._status.enabled ? '禁用 AutoGit' : '启用 AutoGit'
            },
            contextValue: 'toggleAction'
        });

        if (this._status.enabled && this._status.repositoryPath) {
            items.push({
                id: 'manualCommit',
                label: '立即提交',
                type: 'action',
                icon: new vscode.ThemeIcon('git-commit'),
                command: {
                    command: 'andrea.autoGit.manualCommit',
                    title: '立即提交'
                },
                contextValue: 'commitAction'
            });

            items.push({
                id: 'manualSync',
                label: '立即同步',
                type: 'action',
                icon: new vscode.ThemeIcon('sync'),
                command: {
                    command: 'andrea.autoGit.manualSync',
                    title: '立即同步'
                },
                contextValue: 'syncAction'
            });
        }

        // 远程仓库设置
        items.push({
            id: 'setupRemote',
            label: '设置远程仓库',
            type: 'action',
            icon: new vscode.ThemeIcon('cloud-upload'),
            command: {
                command: 'andrea.autoGit.setupRemote',
                title: '设置远程仓库'
            },
            contextValue: 'remoteAction',
            tooltip: '快速设置Git远程仓库地址'
        });

        // 配置按钮
        items.push({
            id: 'settings',
            label: '配置设置',
            type: 'config',
            icon: new vscode.ThemeIcon('settings-gear'),
            command: {
                command: 'workbench.action.openSettings',
                title: '打开设置',
                arguments: ['@ext:andreafrederica.andrea-novel-helper AutoGit']
            },
            contextValue: 'configAction'
        });

        // 待提交文件
        if (this._status.pendingFiles && this._status.pendingFiles.length > 0) {
            items.push({
                id: 'pendingFiles',
                label: `待提交文件 (${this._status.pendingFiles.length})`,
                type: 'status',
                icon: new vscode.ThemeIcon('file-code'),
                tooltip: `${this._status.pendingFiles.length} 个文件待提交`
            });
        }

        return items.map(item => new AutoGitTreeItem(item));
    }

    private _loadStatus(): void {
        const config = vscode.workspace.getConfiguration('AndreaNovelHelper.autoGit');
        this._status.enabled = config.get('enabled', false);
        
        // 这里应该从Git服务获取实际状态
        // 暂时使用模拟数据
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            this._status.repositoryPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
        }
    }

    private _getStatusDescription(): string {
        if (!this._status.enabled) {
            return '点击启用';
        }
        
        if (this._status.lastCheck) {
            const now = new Date();
            const diff = Math.floor((now.getTime() - this._status.lastCheck.getTime()) / 1000);
            if (diff < 60) {
                return `${diff}秒前检查`;
            } else if (diff < 3600) {
                return `${Math.floor(diff / 60)}分钟前检查`;
            } else {
                return `${Math.floor(diff / 3600)}小时前检查`;
            }
        }
        
        return '运行中';
    }

    private _getStatusTooltip(): string {
        if (!this._status.enabled) {
            return 'AutoGit功能已禁用，点击启用自动Git管理';
        }
        
        let tooltip = 'AutoGit功能已启用\n';
        if (this._status.lastCheck) {
            tooltip += `最后检查: ${this._status.lastCheck.toLocaleString()}\n`;
        }
        if (this._status.hasChanges) {
            tooltip += '检测到文件变更';
        } else {
            tooltip += '没有待提交的变更';
        }
        
        return tooltip;
    }

    private _getRemoteStatusIcon(status: string): string {
        switch (status) {
            case 'ahead': return 'arrow-up';
            case 'behind': return 'arrow-down';
            case 'up-to-date': return 'check';
            case 'diverged': return 'git-merge';
            default: return 'question';
        }
    }

    private _getRemoteStatusText(status: string): string {
        switch (status) {
            case 'ahead': return '领先远程';
            case 'behind': return '落后远程';
            case 'up-to-date': return '已同步';
            case 'diverged': return '分叉';
            default: return '未知';
        }
    }

    public updateStatus(status: Partial<AutoGitStatus>): void {
        this._status = { ...this._status, ...status };
        this.refresh();
    }
}

export function registerAutoGitTreeView(context: vscode.ExtensionContext): AutoGitTreeDataProvider {
    const provider = new AutoGitTreeDataProvider(context);
    
    const treeView = vscode.window.createTreeView('andrea.autoGitPanel', {
        treeDataProvider: provider,
        showCollapseAll: false
    });

    // 注册命令
    context.subscriptions.push(
        vscode.commands.registerCommand('andrea.autoGit.refresh', () => {
            provider.refresh();
        })
    );

    context.subscriptions.push(treeView);
    
    return provider;
}