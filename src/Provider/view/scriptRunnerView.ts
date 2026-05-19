/* eslint-disable semi */
/* eslint-disable curly */
import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { runScriptWithContext, getScriptOutputChannel } from '../../mcp/runtimeEnhanced'
import { getClientOptionsFromConfig, getClientOptionsByName, openMcpConfig, listServerStatuses, setServersEnabled, getEnabledServerNames, getConfigChangeEmitter, readMcpConfig, getMcpConfigPath } from '../../mcp/config'
import { loadScriptExtensions, pickPlainTextProcessor, pickTypstRenderer, renderPlainTextWithProcessor, scriptExtensionRegistry } from '../../mcp/scriptExtensions'
import { mdToPlainText } from '../../utils/md_plain'
import { txtToPlainText } from '../../utils/txt_plain'

type ScriptFileKind = 'runnable' | 'extension' | 'hybrid' | 'plain'

interface ScriptFileMeta {
  kind: ScriptFileKind
  tags: string[]
}

const scriptMetaCache = new Map<string, { mtimeMs: number; size: number; meta: ScriptFileMeta }>()

function detectScriptFileMeta(fullPath: string): ScriptFileMeta {
  try {
    const stat = fs.statSync(fullPath)
    const cached = scriptMetaCache.get(fullPath)
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.meta

    const code = fs.readFileSync(fullPath, 'utf8')
    const hasRun = /export\s+(?:async\s+)?function\s+run\b|export\s+default\s+(?:async\s+)?function\b|export\s+(?:const|let|var)\s+run\s*=|module\.exports\s*=|exports\.run\s*=/.test(code)
    const hasActivateOrRegister = /export\s+(?:async\s+)?function\s+(?:activate|register)\b/.test(code)

    const tags: string[] = []
    if (/hooks\s*\.\s*on\s*\(/.test(code)) tags.push('hook')
    if (/registerPlainText\s*\(/.test(code)) tags.push('plaintext')
    if (/renderers\s*\.\s*registerTypst\s*\(|processors\s*\.\s*registerTypst\s*\(|registerTypst\s*\(/.test(code)) tags.push('typst')

    let kind: ScriptFileKind = 'plain'
    if (hasRun && hasActivateOrRegister) kind = 'hybrid'
    else if (hasRun) kind = 'runnable'
    else if (hasActivateOrRegister) kind = 'extension'

    const meta: ScriptFileMeta = { kind, tags }
    scriptMetaCache.set(fullPath, { mtimeMs: stat.mtimeMs, size: stat.size, meta })
    return meta
  } catch {
    return { kind: 'plain', tags: [] }
  }
}

function getScriptKindLabel(kind: ScriptFileKind): string {
  if (kind === 'runnable') return '可执行脚本'
  if (kind === 'extension') return '扩展脚本'
  if (kind === 'hybrid') return '混合脚本'
  return '普通脚本'
}

const TAG_ICON: Record<string, string> = {
  hook: '⚡',
  plaintext: '⌨',
  typst: 'Σ',
}

const TAG_LABEL: Record<string, string> = {
  hook: 'Hook',
  plaintext: '纯文本处理器',
  typst: 'Typst 渲染器',
}

function getScriptKindIcon(kind: ScriptFileKind): vscode.ThemeIcon {
  if (kind === 'runnable') return new vscode.ThemeIcon('play-circle')
  if (kind === 'extension') return new vscode.ThemeIcon('extensions')
  if (kind === 'hybrid') return new vscode.ThemeIcon('tools')
  return new vscode.ThemeIcon('file-code')
}

class ScriptItem extends vscode.TreeItem {
  constructor(public fullPath: string, label: string, collapsibleState: vscode.TreeItemCollapsibleState) {
    super(label, collapsibleState)
    this.resourceUri = vscode.Uri.file(fullPath)
    const isDir = fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()
    if (isDir) {
      this.contextValue = 'andrea.script.dir'
      this.iconPath = new vscode.ThemeIcon('folder')
    } else {
      const meta = detectScriptFileMeta(fullPath)
      this.contextValue = `andrea.script.file.${meta.kind}`
      this.iconPath = getScriptKindIcon(meta.kind)
      const tagIcons = meta.tags.map(t => TAG_ICON[t] ?? t).join(' ')
      const tagLabels = meta.tags.map(t => TAG_LABEL[t] ?? t).join(' / ')
      this.description = meta.tags.length ? `${getScriptKindLabel(meta.kind)} ${tagIcons}` : getScriptKindLabel(meta.kind)
      this.tooltip = `${label}\n${getScriptKindLabel(meta.kind)}${meta.tags.length ? `\n能力: ${tagLabels}` : ''}\n${fullPath}`
    }
    // 文件可以点击打开，目录可以右键新建脚本
    if (!isDir) {
      this.command = { command: 'andrea.scripts.open', title: 'Open', arguments: [this] }
    }
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
  public fullPath: string  // 添加 fullPath 属性以兼容 ScriptItem 类型
  constructor(public baseDir: string) {
    super('MCP 服务器', vscode.TreeItemCollapsibleState.Collapsed)
    this.fullPath = baseDir  // 设置 fullPath
    // 指向 MCP 配置文件而不是脚本目录
    const mcpConfigPath = getMcpConfigPath()
    this.resourceUri = vscode.Uri.file(mcpConfigPath)
    this.contextValue = 'andrea.mcp.servers.root'
    this.iconPath = new vscode.ThemeIcon('plug')
  }
}

class ServerItem extends vscode.TreeItem {
  constructor(public name: string, public enabled: boolean, public serverUrl?: string) {
    super(name, vscode.TreeItemCollapsibleState.None)
    this.contextValue = enabled ? 'andrea.mcp.server.enabled' : 'andrea.mcp.server.disabled'
    this.iconPath = new vscode.ThemeIcon(enabled ? 'check' : 'circle-slash')
    this.command = { command: 'andrea.scripts.toggleSingleServer', title: 'Toggle', arguments: [this] }
    // 使用实际的MCP服务器URL，如果没有URL则使用默认格式
    this.resourceUri = serverUrl ? vscode.Uri.parse(serverUrl) : vscode.Uri.parse(`mcp-server://${name}`)
  }
}

export class ScriptTreeProvider implements vscode.TreeDataProvider<ScriptItem> {
  constructor(private rootDir: string) {}
  private _onDidChangeTreeData = new vscode.EventEmitter<ScriptItem | undefined | null | void>()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event
  refresh() { this._onDidChangeTreeData.fire() }
  getTreeItem(e: ScriptItem) { return e }
  async getChildren(element?: ScriptItem): Promise<ScriptItem[]> {
    // 处理 MCP 服务器根节点
    if (element && (element as any).contextValue === 'andrea.mcp.servers.root') {
      const statuses = listServerStatuses()
      const config = readMcpConfig()
      const servers = statuses.map(s => {
        const serverConfig = config?.mcpServers?.[s.name]
        const serverUrl = serverConfig?.url || serverConfig?.command
        return new ServerItem(s.name, s.enabled, serverUrl)
      })
      return servers as unknown as ScriptItem[]
    }

    const dir = element ? element.fullPath : this.rootDir
    if (!fs.existsSync(dir)) return []
    const entries = fs.readdirSync(dir)
    const out: ScriptItem[] = []

    // 根节点：先添加 MCP 服务器部分，再添加新建脚本
    if (!element) {
      out.push(new ServersRootItem(this.rootDir) as unknown as ScriptItem)
      out.push(new NewScriptItem(this.rootDir) as unknown as ScriptItem)
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
  void loadScriptExtensions(abs)

  // 监听 MCP 配置变更并刷新树视图
  const configChangeEmitter = getConfigChangeEmitter()
  context.subscriptions.push(
    configChangeEmitter.event(() => {
      console.log('MCP config changed, refreshing tree view')
      provider.refresh()
    })
  )

  let t: NodeJS.Timeout | undefined
  const schedule = () => {
    if (t) clearTimeout(t)
    t = setTimeout(() => {
      scriptMetaCache.clear()
      provider.refresh()
      void loadScriptExtensions(abs)
    }, 200)
  }
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(abs, '**/*'))
  context.subscriptions.push(
    watcher.onDidCreate(schedule),
    watcher.onDidChange(schedule),
    watcher.onDidDelete(schedule),
    watcher
  )

  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(doc => {
    void scriptExtensionRegistry.emit('documentSaved', {
      uri: doc.uri.toString(),
      fileName: doc.fileName,
      languageId: doc.languageId,
      text: doc.getText()
    })
  }))

  context.subscriptions.push(
    vscode.commands.registerCommand('andrea.scripts.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('andrea.scripts.reloadExtensions', async () => {
      await loadScriptExtensions(abs)
      provider.refresh()
      vscode.window.showInformationMessage('脚本扩展已重新加载')
    }),
    vscode.commands.registerCommand('andrea.scripts.selectPlainTextProcessor', async () => {
      const id = await pickPlainTextProcessor(true)
      if (!id) return
      await vscode.workspace.getConfiguration('AndreaNovelHelper').update('scripts.defaultPlainTextProcessor', id, vscode.ConfigurationTarget.Workspace)
      vscode.window.showInformationMessage(`默认纯文本处理器已设为：${id}`)
    }),
    vscode.commands.registerCommand('andrea.scripts.selectTypstRenderer', async () => {
      const id = await pickTypstRenderer(true)
      if (!id) return
      await vscode.workspace.getConfiguration('andrea.typst').update('defaultRenderer', id, vscode.ConfigurationTarget.Workspace)
      vscode.window.showInformationMessage(`默认 Typst 渲染器已设为：${id}`)
    }),
    vscode.commands.registerCommand('andrea.scripts.runPlainTextProcessor', async () => {
      const ed = vscode.window.activeTextEditor
      if (!ed) return
      const id = await pickPlainTextProcessor(true)
      if (!id) return
      const raw = ed.document.getText()
      const fallback = ed.document.languageId === 'markdown' || /\.md(i|own)?$/i.test(ed.document.fileName)
        ? mdToPlainText(raw).text
        : ed.document.languageId === 'plaintext'
          ? txtToPlainText(raw).text
          : raw
      const text = await renderPlainTextWithProcessor(ed.document, fallback, id)
      const doc = await vscode.workspace.openTextDocument({ content: text, language: 'plaintext' })
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside)
    }),
    vscode.commands.registerCommand('andrea.scripts.debugMcpServers', async () => {
      const statuses = listServerStatuses()
      const msg = statuses.length === 0 
        ? '未找到 MCP 服务器配置' 
        : `找到 ${statuses.length} 个服务器:\n${statuses.map(s => `- ${s.name} (${s.enabled ? '已启用' : '已禁用'})`).join('\n')}`
      vscode.window.showInformationMessage(msg, { modal: true })
      console.log('MCP Servers Debug:', statuses)
    }),
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

      // 强制刷新树视图，确保显示最新的服务器状态
      provider.refresh()
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
      vscode.window.showInformationMessage(`已${current.enabled ? '禁用' : '启用'}: ${name}。下次脚本运行时生效。`)
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
      const names = enabledNames
      const out = getScriptOutputChannel()

      if (names.length === 0) {
        // 没有启用的MCP服务器时，直接运行脚本（不使用MCP）
        try {
          const result = await runScriptWithContext(item.fullPath, {}, { client: {}, label: 'no-mcp' })
          out.appendLine(`[无MCP] Result ${item.fullPath}`)
          out.appendLine(typeof result === 'string' ? result : JSON.stringify(result))
        } catch (e: any) {
          out.appendLine(`[无MCP] 运行失败: ${e?.message || String(e)}`)
        }
      } else {
        // 有启用的MCP服务器时，同时运行（每个服务器一个实例）
        const runs = names.map(async name => {
          const clientOpts = getClientOptionsByName(name)
          try {
            const result = await runScriptWithContext(item.fullPath, {}, { client: clientOpts, label: name })
            out.appendLine(`[${name}] Result ${item.fullPath}`)
            out.appendLine(typeof result === 'string' ? result : JSON.stringify(result))
          } catch (e: any) {
            out.appendLine(`[${name}] 运行失败: ${e?.message || String(e)}`)
          }
        })
        await Promise.all(runs)
      }

      out.show(true)
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
