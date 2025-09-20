import * as vscode from 'vscode';
import { SmartTabGroupLockManager } from './smartTabGroupLock';

/**
 * 智能分组锁状态栏管理器
 * 在状态栏右侧显示分组锁状态：禁用/启用/运行中
 */
export class SmartTabGroupLockStatusBar {
    private statusBarItem: vscode.StatusBarItem;
    private lockManager: SmartTabGroupLockManager | undefined;
    private disposables: vscode.Disposable[] = [];

    constructor() {
        // 创建状态栏项目，放在右侧
        // 优先级：数值越大越靠左；为了尽可能靠最右侧显示，使用一个很小的负值
        // 注意：如果其他扩展或项目也使用更小的值，仍可能略微靠左，因此这不是绝对保证。
        const RIGHT_MOST_PRIORITY = -100000;
        this.statusBarItem = vscode.window.createStatusBarItem(
            'andrea.smartTabGroupLock', // 唯一ID
            vscode.StatusBarAlignment.Right,
            RIGHT_MOST_PRIORITY
        );
        this.statusBarItem.name = '智能分组锁';
        this.statusBarItem.command = 'andrea.toggleSmartTabGroupLock';
        this.statusBarItem.tooltip = '点击切换智能分组锁状态';
    }

    /**
     * 激活状态栏
     */
    activate(context: vscode.ExtensionContext, lockManager: SmartTabGroupLockManager): void {
        this.lockManager = lockManager;
        context.subscriptions.push(this.statusBarItem);

        // 监听配置变化
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('AndreaNovelHelper.smartTabGroupLock.enabled')) {
                    this.updateStatusBar();
                }
            })
        );

        // 监听标签组变化，用于检测运行状态
        this.disposables.push(
            vscode.window.tabGroups.onDidChangeTabs(() => {
                this.updateStatusBar();
            })
        );

        // 监听活动标签组变化
        this.disposables.push(
            vscode.window.tabGroups.onDidChangeTabGroups(() => {
                this.updateStatusBar();
            })
        );

        // 初始更新
        this.updateStatusBar();
    }

    /**
     * 更新状态栏显示
     */
    private updateStatusBar(): void {
        if (!this.lockManager) {
            return;
        }

        const isEnabled = this.lockManager.isEnabled;
        
        if (!isEnabled) {
            // 禁用状态
            this.statusBarItem.text = '$(unlock) 分组锁';
            this.statusBarItem.tooltip = '智能分组锁已禁用 - 点击启用';
            this.statusBarItem.backgroundColor = undefined;
            this.statusBarItem.color = undefined;
        } else {
            // 启用状态 - 检查是否正在运行
            const isRunning = this.isLockRunning();
            
            if (isRunning) {
                // 运行中状态 - 显示绿色
                this.statusBarItem.text = '$(lock) 分组锁';
                this.statusBarItem.tooltip = '智能分组锁运行中 - 当前有标签组被锁定';
                this.statusBarItem.backgroundColor = undefined;
                this.statusBarItem.color = new vscode.ThemeColor('charts.green');
            } else {
                // 启用但未运行状态
                this.statusBarItem.text = '$(unlock) 分组锁';
                this.statusBarItem.tooltip = '智能分组锁已启用 - 等待符合条件的标签组';
                this.statusBarItem.backgroundColor = undefined;
                this.statusBarItem.color = undefined;
            }
        }

        this.statusBarItem.show();
    }

    /**
     * 检查锁定是否正在运行
     * 从智能分组锁管理器获取全局运行状态
     */
    private isLockRunning(): boolean {
        return this.lockManager ? this.lockManager.hasActiveLocks : false;
    }

    /**
     * 释放资源
     */
    dispose(): void {
        this.statusBarItem.dispose();
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }
}