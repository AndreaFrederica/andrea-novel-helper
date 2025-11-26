/* eslint-disable curly */
/* eslint-disable semi */
import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'

// 配置变更监听器
let _configChangeEmitter: vscode.EventEmitter<void> | undefined

export function getConfigChangeEmitter() {
  if (!_configChangeEmitter) {
    _configChangeEmitter = new vscode.EventEmitter<void>()
  }
  return _configChangeEmitter
}

const DEFAULT_JSON = JSON.stringify({
  mcpServers: {
    'chrome-mcp-server': { type: 'streamableHttp', url: 'http://127.0.0.1:12306/mcp', enabled: true }
  },
  defaultServer: 'chrome-mcp-server'
}, null, 2)

function getWorkspaceRoot() {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || ''
}

export function getMcpConfigPath() {
  const ws = getWorkspaceRoot()
  return path.join(ws, 'novel-helper', 'mcp.json')
}

export function ensureMcpConfigFile() {
  const p = getMcpConfigPath()
  const dir = path.dirname(p)
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }) } catch {}
  if (!fs.existsSync(p)) { try { fs.writeFileSync(p, DEFAULT_JSON) } catch {} }
  return p
}

export async function openMcpConfig() {
  const p = ensureMcpConfigFile()
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(p))
  await vscode.window.showTextDocument(doc)

  // 创建文件监听器来检测配置变更
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(p, '*'), false, false, false)
  const changeHandler = () => {
    // 延迟触发以确保文件写入完成
    setTimeout(() => {
      getConfigChangeEmitter().fire()
    }, 300)
  }

  watcher.onDidChange(changeHandler)
  watcher.onDidCreate(changeHandler)

  // 返回监听器以便清理（如果需要）
  return watcher
}

export function readMcpConfig(): any {
  const p = ensureMcpConfigFile()
  try {
    const txt = fs.readFileSync(p, 'utf-8')
    return JSON.parse(txt)
  } catch { return {} }
}

export function listServers(): string[] {
  const cfg = readMcpConfig()
  const servers = cfg?.mcpServers || {}
  return Object.keys(servers)
}

export function setDefaultServer(name: string) {
  const p = ensureMcpConfigFile()
  let data: any = {}
  try { data = JSON.parse(fs.readFileSync(p, 'utf-8')) } catch {}
  data = data || {}
  data.defaultServer = name
  fs.writeFileSync(p, JSON.stringify(data, null, 2))
}

export function setServersEnabled(enables: Record<string, boolean>) {
  const p = ensureMcpConfigFile()
  let data: any = {}
  try { data = JSON.parse(fs.readFileSync(p, 'utf-8')) } catch {}
  data = data || {}
  const servers = data.mcpServers || {}
  for (const k of Object.keys(enables)) {
    if (!servers[k]) continue
    servers[k].enabled = !!enables[k]
  }
  data.mcpServers = servers
  fs.writeFileSync(p, JSON.stringify(data, null, 2))

  // 触发配置变更事件
  getConfigChangeEmitter().fire()
}

export function listServerStatuses(): Array<{ name: string, enabled: boolean }> {
  const cfg = readMcpConfig()
  const servers = cfg?.mcpServers || {}
  return Object.keys(servers).map(name => ({ name, enabled: !!servers[name].enabled }))
}

export function getEnabledServerNames(): string[] {
  const statuses = listServerStatuses()
  return statuses.filter(s => s.enabled).map(s => s.name)
}

export function getClientOptionsFromConfig() {
  const cfg = readMcpConfig()
  const servers = cfg?.mcpServers || {}

  // 找到第一个启用的服务器
  const enabledServers = Object.keys(servers).filter(name => servers[name].enabled)
  if (enabledServers.length === 0) return {}

  // 优先使用默认服务器（如果启用），否则使用第一个启用的服务器
  const preferred = cfg?.defaultServer && servers[cfg.defaultServer] && servers[cfg.defaultServer].enabled
    ? cfg.defaultServer
    : enabledServers[0]

  const sel = servers[preferred]
  if (!sel) return {}

  const t = String(sel.type || '').toLowerCase()
  if ((t === 'streamablehttp' || t === 'streamable-http') && sel.url) return { httpUrl: String(sel.url) }
  if (t === 'stdio' || sel.command) return { command: String(sel.command), args: Array.isArray(sel.args) ? sel.args.map(String) : [] }
  return {}
}

export function getClientOptionsByName(name: string) {
  const cfg = readMcpConfig()
  const servers = cfg?.mcpServers || {}
  const sel = servers[name]
  if (!sel || !sel.enabled) return {}
  const t = String(sel.type || '').toLowerCase()
  if ((t === 'streamablehttp' || t === 'streamable-http') && sel.url) return { httpUrl: String(sel.url) }
  if (t === 'stdio' || sel.command) return { command: String(sel.command), args: Array.isArray(sel.args) ? sel.args.map(String) : [] }
  return {}
}