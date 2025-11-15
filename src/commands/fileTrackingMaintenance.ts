import * as vscode from 'vscode'
import { cleanAbsolutePathEntries } from '../utils/tracker/globalFileTracking'

export function registerFileTrackingMaintenance(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('AndreaNovelHelper.fileTracking.cleanAbsolutePaths', async () => {
      const count = await cleanAbsolutePathEntries()
      vscode.window.showInformationMessage(`已清理 ${count} 个绝对路径条目。`)
    })
  )
}