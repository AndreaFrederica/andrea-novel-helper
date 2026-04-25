import * as vscode from 'vscode'
import { cleanAbsolutePathEntries, repairDirtyPathKeys } from '../utils/tracker/globalFileTracking'

export function registerFileTrackingMaintenance(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('AndreaNovelHelper.fileTracking.repairPathKeys', async () => {
      const confirm = await vscode.window.showWarningMessage(
        '这会重建文件追踪路径索引，把可识别的脏 key 修复为工作区规范路径，并重写索引/快照。继续吗？',
        { modal: true },
        '开始修复',
        '取消'
      )
      if (confirm !== '开始修复') { return }

      const result = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: '修复文件追踪路径索引',
        cancellable: false
      }, async () => {
        return await repairDirtyPathKeys()
      })

      if (!result) {
        vscode.window.showWarningMessage('文件追踪尚未初始化，无法修复路径索引。')
        return
      }

      vscode.window.showInformationMessage(
        `路径索引修复完成：扫描 ${result.scanned} 项，修复 ${result.repaired} 项，移除 ${result.removed} 项，冲突 ${result.conflicts} 项，当前规范映射 ${result.canonicalMappings} 项。`
      )
    }),
    vscode.commands.registerCommand('AndreaNovelHelper.fileTracking.cleanAbsolutePaths', async () => {
      const count = await cleanAbsolutePathEntries()
      vscode.window.showInformationMessage(`旧版清理入口已执行，共处理 ${count} 个路径条目。`)
    })
  )
}
