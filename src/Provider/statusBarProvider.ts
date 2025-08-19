import * as vscode from 'vscode';
import * as path from 'path';
import { getFileByPath } from '../utils/tracker/globalFileTracking';
import { WordCountProvider } from './view/wordCountProvider';

/**
 * 状态栏提供器 - 显示当前文档的写作统计
 */
export class StatusBarProvider {
    private statusBarItem: vscode.StatusBarItem;
    private currentFilePath: string | undefined;
    private wordCountProvider: WordCountProvider;

    constructor(wordCountProvider: WordCountProvider) {
        this.wordCountProvider = wordCountProvider;
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left, 
            100 // 优先级，数字越大越靠左
        );
        this.statusBarItem.command = 'AndreaNovelHelper.showCurrentFileStats';
        this.statusBarItem.tooltip = '点击查看详细写作统计';
    }

    /**
     * 激活状态栏
     */
    activate(context: vscode.ExtensionContext): void {
        context.subscriptions.push(this.statusBarItem);
        
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

        // 初始更新
        this.updateStatusBar(vscode.window.activeTextEditor);
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

            // 获取当前文档字数（使用WordCountProvider的逻辑）
            const wordCount = await this.getFileWordCount(filePath);
            
            // 计算实际CPM（基于文档当前字数和写作时间）
            let realCPM = 0;
            if (stats.totalMillis > 0 && wordCount > 0) {
                const totalMinutesFloat = stats.totalMillis / 60000;
                realCPM = Math.round(wordCount / totalMinutesFloat);
            }

            // 获取峰值CPM（基于buckets的最高值）
            const peakCPM = stats.averageCPM || 0;

            // 构建状态栏文本
            this.statusBarItem.text = `$(edit) ${timeText} | ${wordCount}字 | 速度:${realCPM}/${peakCPM}`;
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

        // 计算真实速度
        let realCPM = 0;
        if (stats.totalMillis > 0 && wordCount > 0) {
            const totalMinutesFloat = stats.totalMillis / 60000;
            realCPM = Math.round(wordCount / totalMinutesFloat);
        }

    const fileName = path.basename(this.currentFilePath);
        
        const message = [
            `文档：${fileName}`,
            ``,
            `📝 当前字数：${wordCount} 字`,
            `⏱️ 写作时间：${timeText}`,
            `🏃 平均速度：${realCPM} 字/分钟`,
            `🚀 峰值速度：${stats.averageCPM} 字/分钟`,
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
     * 手动刷新状态栏
     */
    public refresh(): void {
        this.updateStatusBar(vscode.window.activeTextEditor);
    }

    /**
     * 释放资源
     */
    dispose(): void {
        this.statusBarItem.dispose();
    }
}
