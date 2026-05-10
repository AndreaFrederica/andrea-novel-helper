import * as vscode from 'vscode';
import { cleanAbsolutePathEntries, repairDirtyPathKeys, repairWritingStatsSummary } from '../utils/tracker/globalFileTracking';

export function registerFileTrackingMaintenance(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('AndreaNovelHelper.fileTracking.repairPathKeys', async () => {
      const confirm = await vscode.window.showWarningMessage(
        '这会重建文件追踪路径索引，把可识别的脏 key 修复为工作区规范路径，并重写索引/快照。继续吗？',
        { modal: true },
        '开始修复',
        '取消'
      );
      if (confirm !== '开始修复') { return; }

      const result = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: '修复文件追踪路径索引',
        cancellable: false
      }, async () => {
        return await repairDirtyPathKeys();
      });

      if (!result) {
        vscode.window.showWarningMessage('文件追踪尚未初始化，无法修复路径索引。');
        return;
      }

      vscode.window.showInformationMessage(
        `路径索引修复完成：扫描 ${result.scanned} 项，修复 ${result.repaired} 项，移除 ${result.removed} 项，冲突 ${result.conflicts} 项，当前规范映射 ${result.canonicalMappings} 项。`
      );
    }),
    vscode.commands.registerCommand('AndreaNovelHelper.fileTracking.cleanAbsolutePaths', async () => {
      const count = await cleanAbsolutePathEntries();
      vscode.window.showInformationMessage(`文件追踪绝对路径清理完成，共处理 ${count} 个路径条目。`);
    }),
    vscode.commands.registerCommand('AndreaNovelHelper.timeStats.repairSummary', async () => {
      const confirm = await vscode.window.showWarningMessage(
        '这会读取整个写作统计数据库，重建项目级汇总和单文件轻量索引。适合累计用时/热力图异常时使用。继续吗？',
        { modal: true },
        '开始修复',
        '取消'
      );
      if (confirm !== '开始修复') { return; }

      const summary = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: '修复写作统计汇总',
        cancellable: false
      }, async () => {
        return await repairWritingStatsSummary();
      });

      if (!summary) {
        vscode.window.showWarningMessage('文件追踪尚未初始化，无法修复写作统计汇总。');
        return;
      }

      const minutes = Math.floor((summary.totalMillisAll || 0) / 60000);
      vscode.window.showInformationMessage(
        `写作统计汇总修复完成：${summary.filesWithWritingStats} 个文件，累计 ${minutes} 分钟，今日 ${summary.today.chars} 字。`
      );
    })
  );
}
