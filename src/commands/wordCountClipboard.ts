/* eslint-disable semi */
import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { WordCountProvider } from '../Provider/view/wordCountProvider'
import { setCutClipboard } from '../utils/WordCount/wordCountCutHelper'

type ClipEntry = { source: string; isDir: boolean }

function collectSelectedWordCountPaths(treeView: vscode.TreeView<any>): string[] {
  const sel = (treeView as any).selection as any[] || []
  const paths = sel.filter(s => s?.resourceUri?.fsPath).map(s => s.resourceUri.fsPath)
  return paths.length ? paths : []
}

function copyDirectoryRecursive(src: string, dest: string) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true })
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const e of entries) {
    const s = path.join(src, e.name)
    const d = path.join(dest, e.name)
    if (e.isDirectory()) copyDirectoryRecursive(s, d)
    else if (e.isFile()) fs.copyFileSync(s, d)
  }
}

export function registerWordCountClipboard(context: vscode.ExtensionContext, provider: WordCountProvider, treeView: vscode.TreeView<any>) {
  let clipboard: { entries: ClipEntry[]; cut: boolean } | null = null

  context.subscriptions.push(vscode.commands.registerCommand('AndreaNovelHelper.wordCount.copy', (node: any) => {
    const primary = node?.resourceUri?.fsPath
    const paths = new Set<string>(collectSelectedWordCountPaths(treeView))
    if (primary) paths.add(primary)
    const entries: ClipEntry[] = Array.from(paths).map(p => ({ source: p, isDir: fs.existsSync(p) && fs.statSync(p).isDirectory() }))
    clipboard = { entries, cut: false }
    try { setCutClipboard(null) } catch { }
    vscode.window.setStatusBarMessage(`已复制 ${entries.length} 项`, 2000)
  }))

  context.subscriptions.push(vscode.commands.registerCommand('AndreaNovelHelper.wordCount.cut', (node: any) => {
    const primary = node?.resourceUri?.fsPath
    const paths = new Set<string>(collectSelectedWordCountPaths(treeView))
    if (primary) paths.add(primary)
    const entries: ClipEntry[] = Array.from(paths).map(p => ({ source: p, isDir: fs.existsSync(p) && fs.statSync(p).isDirectory() }))
    clipboard = { entries, cut: true }
    try { setCutClipboard(entries.map(e => e.source)) } catch { }
    vscode.window.setStatusBarMessage(`已剪切 ${entries.length} 项`, 2000)
    provider.refresh()
  }))

  context.subscriptions.push(vscode.commands.registerCommand('AndreaNovelHelper.wordCount.paste', async (targetNode: any) => {
    if (!clipboard || clipboard.entries.length === 0) {
      vscode.window.showInformationMessage('剪贴板为空')
      return
    }
    let targetPath = targetNode?.resourceUri?.fsPath
    if (!targetPath) {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      if (!root) { vscode.window.showWarningMessage('没有工作区，无法粘贴'); return }
      targetPath = root
    }
    if (!fs.existsSync(targetPath)) { vscode.window.showWarningMessage('目标不存在'); return }
    if (!fs.statSync(targetPath).isDirectory()) targetPath = path.dirname(targetPath)

    const om = (provider as any).getOrderManager?.()
    const isManual = om ? om.isManual(targetPath) : false
    const step = (om as any)?.options?.step || 10
    let seqBase = step
    if (om && isManual) {
      const parentItem = provider.getItemById?.(targetPath) || { resourceUri: vscode.Uri.file(targetPath) }
      const children = await provider.getChildren(parentItem as any) as any[]
      const ordered = children.filter(c => c.resourceUri && fs.existsSync(c.resourceUri.fsPath) && !c.id?.includes('__new'))
      for (const c of ordered) {
        const idxVal = om.getIndex(c.resourceUri.fsPath)
        if (typeof idxVal === 'number' && idxVal >= seqBase) seqBase = idxVal + step
      }
    }

    const results: string[] = []
    for (const entry of clipboard.entries) {
      const baseName = path.basename(entry.source)
      let dest = path.join(targetPath, baseName)
      if (dest === entry.source) {
        const ext = path.extname(baseName)
        const stem = ext ? baseName.slice(0, -ext.length) : baseName
        let i = 1
        while (fs.existsSync(dest)) { dest = path.join(targetPath, `${stem}_copy${i}${ext}`); i++ }
      } else if (fs.existsSync(dest)) {
        const ext = path.extname(baseName)
        const stem = ext ? baseName.slice(0, -ext.length) : baseName
        let i = 1; let variant = dest
        while (fs.existsSync(variant)) { variant = path.join(targetPath, `${stem}_copy${i}${ext}`); i++ }
        dest = variant
      }
      try {
        if (clipboard.cut) fs.renameSync(entry.source, dest)
        else {
          if (entry.isDir) copyDirectoryRecursive(entry.source, dest)
          else fs.copyFileSync(entry.source, dest)
        }
        results.push(dest)
        if (om && isManual) { om.setIndex(dest, seqBase); seqBase += step }
      } catch (e) { vscode.window.showErrorMessage(`粘贴失败: ${e}`) }
    }
    if (clipboard.cut) { clipboard = null; try { setCutClipboard(null) } catch { } }
    provider.refresh()
    vscode.window.setStatusBarMessage(`粘贴完成: ${results.length} 项`, 3000)
  }))
}