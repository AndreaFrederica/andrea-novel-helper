import * as vscode from 'vscode'
import { createRoleUsageIndexer } from '../roleUsage/roleUsageIndexer'
import { clearRoleUsageIndex } from '../context/roleUsageStore'
import { Role } from '../extension'

export function registerRoleUsageIndexCommands(context: vscode.ExtensionContext, roles: Role[]) {
  context.subscriptions.push(
    vscode.commands.registerCommand('AndreaNovelHelper.roleUsage.rebuildIndex', async () => {
      const indexer = createRoleUsageIndexer(roles)
      await indexer.rebuildIndex()
    }),
    vscode.commands.registerCommand('AndreaNovelHelper.roleUsage.clearIndex', async () => {
      clearRoleUsageIndex()
      vscode.window.showInformationMessage('角色引用索引已清空。')
    })
  )
}