/* eslint-disable semi */
import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { runScriptWithContext, getScriptOutputChannel } from '../../mcp/runtimeEnhanced'
import { getClientOptionsFromConfig, getClientOptionsByName, openMcpConfig, listServers, listServerStatuses, setServersEnabled, getEnabledServerNames } from '../../mcp/config'

class ScriptItem extends vscode.TreeItem {
  constructor(public fullPath: string, label: string, collapsibleState: vscode.TreeItemCollapsibleState) {
    super(label, collapsibleState)
    this.resourceUri = vscode.Uri.file(fullPath)
    const isDir = fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()
    this.contextValue = isDir ? 'andrea.script.dir' : 'andrea.script.file'
    this.iconPath = isDir ? new vscode.ThemeIcon('folder') : new vscode.ThemeIcon('file-code')
    if (!isDir) this.command = { command: 'andrea.scripts.open', title: 'Open', arguments: [this] }
  }
}

class NewScriptItem extends vscode.TreeItem {
  constructor(public baseDir: string) {
    super('新建脚本...', vscode.TreeItemCollapsibleState.None)
    this.contextValue = 'andrea.script.newItem'
    this.iconPath = new vscode.ThemeIcon('new-file')
    this.command = { command: 'andrea.scripts.newScript', title: '新建脚本', arguments: [new ScriptItem(baseDir, baseDir, vscode.TreeItemCollapsibleState.None)] }
  }
}

class ServersRootItem extends vscode.TreeItem {
  constructor(public baseDir: string) {
    super('MCP 服务器', vscode.TreeItemCollapsibleState.Collapsed)
    this.contextValue = 'andrea.mcp.servers.root'
    this.iconPath = new vscode.ThemeIcon('plug')
  }
}

class ServerItem extends vscode.TreeItem {
  constructor(public name: string, public enabled: boolean) {
    super(name, vscode.TreeItemCollapsibleState.None)
    this.contextValue = enabled ? 'andrea.mcp.server.enabled' : 'andrea.mcp.server.disabled'
    this.iconPath = new vscode.ThemeIcon(enabled ? 'check' : 'circle-slash')
    this.command = { command: 'andrea.scripts.toggleSingleServer', title: 'Toggle', arguments: [this] }
  }
}

export class ScriptTreeProvider implements vscode.TreeDataProvider<ScriptItem> {
  constructor(private rootDir: string) {}
  private _onDidChangeTreeData = new vscode.EventEmitter<ScriptItem | undefined | null | void>()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event
  refresh() { this._onDidChangeTreeData.fire() }
  getTreeItem(e: ScriptItem) { return e }
  async getChildren(element?: ScriptItem): Promise<ScriptItem[]> {
    const dir = element ? element.fullPath : this.rootDir
    if (!fs.existsSync(dir)) return []
    const entries = fs.readdirSync(dir)
    const out: ScriptItem[] = []
    if (!element) {
      out.push(new NewScriptItem(this.rootDir) as unknown as ScriptItem)
      out.push(new ServersRootItem(this.rootDir) as unknown as ScriptItem)
    }
    if (element && (element as any).contextValue === 'andrea.mcp.servers.root') {
      const statuses = listServerStatuses()
      const servers = statuses.map(s => new ServerItem(s.name, s.enabled))
      return servers as unknown as ScriptItem[]
    }
    for (const n of entries) {
      const p = path.join(dir, n)
      const stat = fs.statSync(p)
      if (stat.isDirectory()) {
        out.push(new ScriptItem(p, n, vscode.TreeItemCollapsibleState.Collapsed))
      } else if (/\.(js|ts)$/i.test(n)) {
        out.push(new ScriptItem(p, n, vscode.TreeItemCollapsibleState.None))
      }
    }
    const getLabel = (x: ScriptItem) => typeof x.label === 'string' ? x.label : (x.label?.label || '')
    out.sort((a, b) => getLabel(a).localeCompare(getLabel(b)))
    return out
  }
}

export function registerScriptRunnerView(context: vscode.ExtensionContext) {
  const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper')
  const root = cfg.get<string>('scripts.root', 'novel-helper/scripts')
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || ''
  const abs = path.join(ws, root)
  if (!fs.existsSync(abs)) { try { fs.mkdirSync(abs, { recursive: true }) } catch {} }
  const provider = new ScriptTreeProvider(abs)
  const view = vscode.window.createTreeView('andrea.scriptsView', { treeDataProvider: provider, showCollapseAll: true })
  context.subscriptions.push(view)

  let t: NodeJS.Timeout | undefined
  const schedule = () => { if (t) clearTimeout(t); t = setTimeout(() => provider.refresh(), 200) }
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(abs, '**/*'))
  context.subscriptions.push(
    watcher.onDidCreate(schedule),
    watcher.onDidChange(schedule),
    watcher.onDidDelete(schedule),
    watcher
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('andrea.scripts.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('andrea.scripts.openFolder', async () => {
      try {
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(abs))
      } catch (e: any) {
        vscode.window.showErrorMessage('打开脚本文件夹失败: ' + (e?.message || String(e)))
      }
    }),
    vscode.commands.registerCommand('andrea.scripts.openMcpConfig', async () => {
      await openMcpConfig()
    }),
    // removed: select default server – we rely on enabled set and default in config file
    vscode.commands.registerCommand('andrea.scripts.toggleMcpServers', async () => {
      const statuses = listServerStatuses()
      if (!statuses.length) { await openMcpConfig(); return }
      const items = statuses.map(s => ({ label: s.name, picked: s.enabled }))
      const selected = await vscode.window.showQuickPick(items, { title: '启用/禁用 MCP 服务器', canPickMany: true })
      if (!selected) return
      const enables: Record<string, boolean> = {}
      for (const s of statuses) enables[s.name] = !!selected.find(it => it.label === s.name)
      setServersEnabled(enables)
      vscode.window.showInformationMessage('已更新 MCP 服务器启用状态')
    }),
    vscode.commands.registerCommand('andrea.scripts.toggleSingleServer', async (item: any) => {
      const name = item?.name
      if (!name) return
      const statuses = listServerStatuses()
      const current = statuses.find(s => s.name === name)
      if (!current) return
      const enables: Record<string, boolean> = {}
      for (const s of statuses) enables[s.name] = s.name === name ? !current.enabled : s.enabled
      setServersEnabled(enables)
      vscode.window.showInformationMessage(`已${current.enabled ? '禁用' : '启用'}: ${name}`)
      provider.refresh()
    }),
    vscode.commands.registerCommand('andrea.scripts.open', async (item: ScriptItem) => { await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(item.fullPath)) }),
    vscode.commands.registerCommand('andrea.scripts.run', async (item: ScriptItem) => {
      const httpEnv = process.env.MCP_CHROME_HTTP_URL || process.env.MCP_HTTP_URL
      const enabledNames = getEnabledServerNames()
      if (httpEnv) {
        // 环境变量强制使用一个 HTTP 端点
        try {
          const result = await runScriptWithContext(item.fullPath, {}, { client: { httpUrl: httpEnv }, label: 'env' })
          const out = getScriptOutputChannel()
          out.appendLine('[env] Result ' + item.fullPath)
          out.appendLine(typeof result === 'string' ? result : JSON.stringify(result))
          out.show(true)
        } catch (e: any) {
          const msg = e?.message || String(e)
          const chosen = await vscode.window.showErrorMessage('脚本运行失败: ' + msg, '打开 MCP 配置', '选择 MCP 服务器', '查看输出')
          if (chosen === '打开 MCP 配置') await vscode.commands.executeCommand('andrea.scripts.openMcpConfig')
          else if (chosen === '选择 MCP 服务器') await vscode.commands.executeCommand('andrea.scripts.selectMcpServer')
          else if (chosen === '查看输出') getScriptOutputChannel().show(true)
        }
        return
      }
      const names = enabledNames.length ? enabledNames : listServers()
      if (!names.length) { await openMcpConfig(); return }
      const runs = names.map(async name => {
        const clientOpts = getClientOptionsByName(name)
        try {
          const result = await runScriptWithContext(item.fullPath, {}, { client: clientOpts, label: name })
          const out = getScriptOutputChannel()
          out.appendLine(`[${name}] Result ${item.fullPath}`)
          out.appendLine(typeof result === 'string' ? result : JSON.stringify(result))
        } catch (e: any) {
          getScriptOutputChannel().appendLine(`[${name}] 运行失败: ${e?.message || String(e)}`)
        }
      })
      await Promise.all(runs)
      getScriptOutputChannel().show(true)
    }),
    // removed: runWithServers – normal run already uses all enabled servers
    vscode.commands.registerCommand('andrea.scripts.newScript', async (node?: ScriptItem) => {
      const base = node && fs.existsSync(node.fullPath) && fs.statSync(node.fullPath).isDirectory() ? node.fullPath : abs
      const name = await vscode.window.showInputBox({ prompt: '输入脚本文件名', value: 'new-script.js' })
      if (!name) return
      const full = path.join(base, name)
      if (fs.existsSync(full)) { vscode.window.showErrorMessage('文件已存在'); return }
      fs.writeFileSync(full, 'export async function run(ctx, args) { return { ok: true, activeDoc: ctx.activeDoc } }')
      provider.refresh()
      const doc = await vscode.workspace.openTextDocument(full)
      await vscode.window.showTextDocument(doc)
    }),
    vscode.commands.registerCommand('andrea.scripts.deleteScript', async (item: ScriptItem) => {
      const p = item.fullPath
      const isDir = fs.statSync(p).isDirectory()
      const confirm = await vscode.window.showWarningMessage(`确定删除${isDir ? '文件夹' : '文件'} ${path.basename(p)}?`, { modal: true }, '确定')
      if (confirm !== '确定') return
      try { if (isDir) fs.rmSync(p, { recursive: true, force: true }); else fs.unlinkSync(p) } catch (e) { vscode.window.showErrorMessage('删除失败: ' + e); return }
      provider.refresh()
    }),
    vscode.commands.registerCommand('andrea.scripts.renameScript', async (item: ScriptItem) => {
      const old = path.basename(item.fullPath)
      const input = await vscode.window.showInputBox({ prompt: '重命名脚本', value: old })
      if (!input || input === old) return
      const dest = path.join(path.dirname(item.fullPath), input)
      if (fs.existsSync(dest)) { vscode.window.showErrorMessage('目标已存在'); return }
      try { fs.renameSync(item.fullPath, dest) } catch (e) { vscode.window.showErrorMessage('重命名失败: ' + e); return }
      provider.refresh()
    })
  )
}