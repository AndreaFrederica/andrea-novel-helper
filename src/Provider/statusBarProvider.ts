import * as vscode from 'vscode';
import * as path from 'path';
import { getFileByPath } from '../utils/tracker/globalFileTracking';
import { WordCountProvider } from './view/wordCountProvider';
import { WebDAVSyncStatusManager, WebDAVSyncStatusChangeEvent } from '../sync/webdavSyncStatusManager';

/**
 * 状态栏提供器 - 显示当前文档的写作统计
 */
export class StatusBarProvider {
    private statusBarItem: vscode.StatusBarItem;
    private webdavStatusBarItem: vscode.StatusBarItem;
    private currentFilePath: string | undefined;
    private wordCountProvider: WordCountProvider;
    private webdavSyncStatusManager: WebDAVSyncStatusManager;
    private syncStatusDisposable: vscode.Disposable | undefined;

    constructor(wordCountProvider: WordCountProvider) {
        this.wordCountProvider = wordCountProvider;
        this.statusBarItem = vscode.window.createStatusBarItem(
            'andrea.writingStats', // 唯一ID
            vscode.StatusBarAlignment.Left, 
            100 // 优先级，数字越大越靠左
        );
        this.statusBarItem.name = '写作统计';
        this.statusBarItem.command = 'AndreaNovelHelper.showCurrentFileStats';
        this.statusBarItem.tooltip = '点击查看详细写作统计';
        
        // 创建WebDAV同步状态栏项
        this.webdavStatusBarItem = vscode.window.createStatusBarItem(
            'andrea.webdavSync', // 唯一ID
            vscode.StatusBarAlignment.Left,
            99 // 优先级比写作统计稍低
        );
        this.webdavStatusBarItem.name = 'WebDAV同步';
        this.webdavStatusBarItem.command = 'andrea.webdav.syncNow';
        this.webdavStatusBarItem.tooltip = '点击开始WebDAV同步';
        
        // 获取同步状态管理器实例
        this.webdavSyncStatusManager = WebDAVSyncStatusManager.getInstance();
    }

    /**
     * 激活状态栏
     */
    activate(context: vscode.ExtensionContext): void {
        context.subscriptions.push(this.statusBarItem);
        context.subscriptions.push(this.webdavStatusBarItem);
        
        // 监听编辑器切换
        context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor(editor => {
                this.updateStatusBar(editor);
            })
        );

        // 定期更新状态栏（用于显示实时写作时间）
        const updateInterval = setInterval(() => {
            this.updateStatusBar(vscode.window.activeTextEditor);
        }, 5000); // 每5秒更新一次

        context.subscriptions.push({
            dispose: () => clearInterval(updateInterval)
        });

        // 注册命令
        context.subscriptions.push(
            vscode.commands.registerCommand('AndreaNovelHelper.showCurrentFileStats', () => {
                this.showDetailedStats();
            })
        );
        
        // 监听WebDAV同步状态变化
        this.syncStatusDisposable = this.webdavSyncStatusManager.onDidChangeStatus(
            (event: WebDAVSyncStatusChangeEvent) => {
                this.updateWebDAVStatusBar(event);
            }
        );
        context.subscriptions.push(this.syncStatusDisposable);

        // 初始更新
        this.updateStatusBar(vscode.window.activeTextEditor);
        this.updateWebDAVStatusBar({ status: this.webdavSyncStatusManager.status });
    }

    /**
     * 更新状态栏
     */
    private async updateStatusBar(editor?: vscode.TextEditor): Promise<void> {
        if (!editor || editor.document.uri.scheme !== 'file') {
            this.statusBarItem.hide();
            this.currentFilePath = undefined;
            return;
        }

        const filePath = editor.document.uri.fsPath;
        this.currentFilePath = filePath;

        // 检查是否是支持的文件类型
        const supportedLanguages = ['markdown', 'plaintext'];
        if (!supportedLanguages.includes(editor.document.languageId)) {
            this.statusBarItem.hide();
            return;
        }

        try {
            // 获取文件追踪数据
            const fileMetadata = getFileByPath(filePath);
            
            if (!fileMetadata?.writingStats) {
                this.statusBarItem.text = '$(edit) 新文档';
                this.statusBarItem.show();
                return;
            }

            const stats = fileMetadata.writingStats;
            
            // 计算显示数据
            const totalMinutes = Math.round(stats.totalMillis / 60000);
            const totalHours = Math.floor(totalMinutes / 60);
            const remainingMinutes = totalMinutes % 60;
            
            // 格式化时间显示
            let timeText = '';
            if (totalHours > 0) {
                timeText = `${totalHours}h${remainingMinutes}m`;
            } else if (totalMinutes > 0) {
                timeText = `${totalMinutes}m`;
            } else {
                timeText = '<1m';
            }

            const textStats = await this.wordCountProvider.getFileStats(filePath);
            const wcExclude = textStats?.total ?? 0;
            const wcInclude = textStats?.nonWSChars ?? 0;
            const primaryUnit = vscode.workspace.getConfiguration('AndreaNovelHelper.wordCount').get<string>('primaryUnit', 'excludePunct');
            const wordCount = primaryUnit === 'includePunct' ? wcInclude : wcExclude;
            
            // 计算“平均速度”（基于计入速度的新增字符和总时长）
            let realCPM = 0;
            if (stats.totalMillis > 0) {
                const totalMinutesFloat = stats.totalMillis / 60000;
                const added = typeof stats.charsAdded === 'number' ? stats.charsAdded : 0;
                realCPM = Math.round(added / totalMinutesFloat);
            }
            const bucketSizeMs = vscode.workspace.getConfiguration('AndreaNovelHelper.timeStats').get<number>('bucketSizeMs', 60000) ?? 60000;
            let peakCPM = 0;
            if (Array.isArray(stats.buckets) && stats.buckets.length) {
                for (const b of stats.buckets) {
                    const cpm = Math.round((b.charsAdded * 60000) / bucketSizeMs);
                    if (cpm > peakCPM) { peakCPM = cpm; }
                }
            }
            const realCPH = realCPM * 60;
            const peakCPH = peakCPM * 60;

            // 构建状态栏文本
            const md = new vscode.MarkdownString(undefined, true);
            md.isTrusted = true;
            md.appendMarkdown([
                `**当前字数（不计标点）**：${wcExclude}`,
                `**当前字数（含标点）**：${wcInclude}`,
                `**写作时间**：${timeText}`,
                `**平均速度**：${realCPM} 字/分钟 | ${realCPH} 字/小时`,
                `**峰值速度**：${peakCPM} 字/分钟 | ${peakCPH} 字/小时`
            ].join('\n\n'));
            this.statusBarItem.tooltip = md;
            const wcCfg = vscode.workspace.getConfiguration('AndreaNovelHelper.wordCount');
            const speedUnit = wcCfg.get<string>('statusBar.speedUnit', 'cpm');
            const modeRaw = wcCfg.get<string>('statusBar.mode', 'detailed');
            const compactFallback = wcCfg.get<boolean>('statusBar.compact', false) ?? false;
            const mode = modeRaw || (compactFallback ? 'compact' : 'detailed');
            const speedText = speedUnit === 'cph' ? `${realCPH}/h` : `${realCPM}/m`;
            if (mode === 'compact') {
                this.statusBarItem.text = `$(edit) ${wordCount}字`;
            } else if (mode === 'semi') {
                this.statusBarItem.text = `$(edit) ${wordCount}字 | 速度:${speedText}`;
            } else {
                this.statusBarItem.text = `$(edit) ${timeText} | ${wordCount}字 | 速度:${speedText}`;
            }
            this.statusBarItem.show();

        } catch (error) {
            console.error('Failed to update status bar:', error);
            this.statusBarItem.text = '$(edit) 统计错误';
            this.statusBarItem.show();
        }
    }

    /**
     * 获取文件字数（使用WordCountProvider的逻辑）
     */
    private async getFileWordCount(filePath: string): Promise<number> {
        try {
            return await this.wordCountProvider.getFileWordCount(filePath);
        } catch (error) {
            console.error('Failed to get word count:', error);
            return 0;
        }
    }

    /**
     * 显示详细统计信息
     */
    private async showDetailedStats(): Promise<void> {
        if (!this.currentFilePath) {
            vscode.window.showInformationMessage('没有活动的文档');
            return;
        }

        const fileMetadata = getFileByPath(this.currentFilePath);
        
        if (!fileMetadata?.writingStats) {
            vscode.window.showInformationMessage('此文档暂无写作统计数据');
            return;
        }

        const stats = fileMetadata.writingStats;
        const wordCount = await this.getFileWordCount(this.currentFilePath);
        
        // 计算详细统计
        const totalMinutes = Math.round(stats.totalMillis / 60000);
        const totalHours = Math.floor(totalMinutes / 60);
        const remainingMinutes = totalMinutes % 60;
        
        let timeText = '';
        if (totalHours > 0) {
            timeText = `${totalHours}小时${remainingMinutes}分钟`;
        } else {
            timeText = `${totalMinutes}分钟`;
        }

        let realCPM = 0;
        if (stats.totalMillis > 0) {
            const totalMinutesFloat = stats.totalMillis / 60000;
            const added = typeof stats.charsAdded === 'number' ? stats.charsAdded : 0;
            realCPM = Math.round(added / totalMinutesFloat);
        }
        const bucketSizeMs = vscode.workspace.getConfiguration('AndreaNovelHelper.timeStats').get<number>('bucketSizeMs', 60000) ?? 60000;
        let peakCPM = 0;
        if (Array.isArray(stats.buckets) && stats.buckets.length) {
            for (const b of stats.buckets) {
                const cpm = Math.round((b.charsAdded * 60000) / bucketSizeMs);
                if (cpm > peakCPM) { peakCPM = cpm; }
            }
        }
        const realCPH = realCPM * 60;
        const peakCPH = peakCPM * 60;

    const fileName = path.basename(this.currentFilePath);
        
        const message = [
            `文档：${fileName}`,
            ``,
            `📝 当前字数：${wordCount} 字`,
            `⏱️ 写作时间：${timeText}`,
            `🏃 平均速度：${realCPM} 字/分钟 | ${realCPH} 字/小时`,
            `🚀 峰值速度：${peakCPM} 字/分钟 | ${peakCPH} 字/小时`,
            `📊 写作会话：${stats.sessionsCount} 次`,
            ``,
            `📈 编辑统计：`,
            `  新增字符：${stats.charsAdded}`,
            `  删除字符：${stats.charsDeleted}`,
            `  净增字符：${stats.charsAdded - stats.charsDeleted}`
        ].join('\n');

        vscode.window.showInformationMessage(message, { modal: true });
    }

    /**
     * 更新WebDAV同步状态栏
     */
    private updateWebDAVStatusBar(event: WebDAVSyncStatusChangeEvent): void {
        if (event.status === 'syncing') {
            // 显示转圈动画和同步状态
            this.webdavStatusBarItem.text = '$(sync~spin) WebDAV同步中';
            this.webdavStatusBarItem.tooltip = event.message || '正在同步WebDAV文件...';
            
            // 如果有进度信息，显示进度
            if (event.progress) {
                const percentage = Math.round((event.progress.current / event.progress.total) * 100);
                this.webdavStatusBarItem.text = `$(sync~spin) WebDAV同步中 ${percentage}%`;
                this.webdavStatusBarItem.tooltip = `${event.message || '正在同步WebDAV文件...'} (${event.progress.current}/${event.progress.total})`;
            }
        } else {
            // 空闲状态，显示静态图标
            this.webdavStatusBarItem.text = '$(cloud) WebDAV';
            this.webdavStatusBarItem.tooltip = '点击开始WebDAV同步';
        }
        
        this.webdavStatusBarItem.show();
    }

    /**
     * 手动刷新状态栏
     */
    public refresh(): void {
        this.updateStatusBar(vscode.window.activeTextEditor);
        this.updateWebDAVStatusBar({ status: this.webdavSyncStatusManager.status });
    }

    /**
     * 释放资源
     */
    dispose(): void {
        this.statusBarItem.dispose();
        this.webdavStatusBarItem.dispose();
        this.syncStatusDisposable?.dispose();
    }
}
