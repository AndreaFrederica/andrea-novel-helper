/* eslint-disable semi */
import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { mdToPlainText } from '../utils/md_plain'
import { txtToPlainText } from '../utils/txt_plain'
import { createMcpClient } from './clientFactory'
import * as util from 'util'
import { AsyncLocalStorage } from 'async_hooks'

export interface RuntimeBuildOptions {
  client?: { httpUrl?: string; command?: string; args?: string[]; name?: string; version?: string }
  label?: string
}

let outputChannel: vscode.OutputChannel | undefined
const als = new AsyncLocalStorage<{ label?: string; ch: vscode.OutputChannel }>()

function installConsoleRedirect() {
  const flag = (globalThis as any).__ANH_console_installed
  if (flag) return
  const original = console
  const write = (level: 'log' | 'info' | 'warn' | 'error', parts: any[]) => {
    const store = als.getStore()
    if (!store) { ;(original as any)[level](...parts); return }
    const prefix = store.label ? `[${store.label}] ` : ''
    const formatted = parts.map(x => typeof x === 'string' ? x : util.inspect(x, { depth: 3, colors: false })).join(' ')
    store.ch.appendLine(prefix + formatted)
  }
  const wrapped = {
    log: (...parts: any[]) => write('log', parts),
    info: (...parts: any[]) => write('info', parts),
    warn: (...parts: any[]) => write('warn', parts),
    error: (...parts: any[]) => write('error', parts)
  } as Console
  ;(globalThis as any).console = Object.assign({}, original, wrapped)
  ;(globalThis as any).__ANH_console_installed = true
}

export function getScriptOutputChannel() {
  if (!outputChannel) outputChannel = vscode.window.createOutputChannel('ANH Scripts')
  return outputChannel
}

export async function buildRuntimeContext(opts?: RuntimeBuildOptions) {
  const pickDoc = (): vscode.TextDocument | undefined => {
    const ae = vscode.window.activeTextEditor?.document
    const candidates: vscode.TextDocument[] = []
    if (ae) candidates.push(ae)
    for (const ed of vscode.window.visibleTextEditors) {
      if (ed.document) candidates.push(ed.document)
    }
    const preferred = candidates.find(d => d.uri.scheme === 'file' && (d.languageId === 'markdown' || d.languageId === 'plaintext'))
    const anyFile = candidates.find(d => d.uri.scheme === 'file')
    return preferred || anyFile || ae
  }
  const doc = pickDoc()
  let raw = ''
  let processed = ''
  let uri: string | undefined = undefined
  let filePath: string | undefined = undefined
  let name: string | undefined = undefined
  if (doc) {
    raw = doc.getText()
    uri = doc.uri.toString()
    filePath = doc.fileName
    try { name = path.basename(doc.fileName) } catch {}
    if (doc.languageId === 'markdown' || /\.md(i|own)?$/i.test(doc.fileName)) {
      processed = mdToPlainText(raw).text
    } else if (doc.languageId === 'plaintext') {
      processed = txtToPlainText(raw).text
    } else {
      processed = raw
    }
  }
  const { client, disconnect } = await createMcpClient(opts?.client || {})
  const ch = getScriptOutputChannel()
  const ctx = {
    os,
    fs,
    path,
    env: process.env,
    mcp: client,
    activeDoc: { uri, raw, processed, filePath, name, title: name, path: filePath, fullPath: filePath },
    output: {
      clear: () => ch.clear(),
      append: (s: string) => ch.append((opts?.label ? `[${opts.label}] ` : '') + s),
      appendLine: (s: string) => ch.appendLine((opts?.label ? `[${opts.label}] ` : '') + s),
      show: () => ch.show(true)
    }
  }
  return { ctx, disconnect }
}

export async function runScriptWithContext(scriptPath: string, args?: any, opts?: RuntimeBuildOptions) {
  const { ctx, disconnect } = await buildRuntimeContext(opts)
  const ch = getScriptOutputChannel()
  try {
    installConsoleRedirect()
    ch.show(true)
    ch.appendLine(`${opts?.label ? `[${opts.label}] ` : ''}Run ${scriptPath}`)
    // eslint-disable-next-line no-restricted-syntax
    const mod = await import(pathToDataUrl(scriptPath))
    const fn = (mod && (mod.default || mod.run)) as ((c: any, a?: any) => Promise<any> | any)
    if (typeof fn !== 'function') throw new Error('script must export default or run(context, args)')
    const result = await als.run({ label: opts?.label, ch }, async () => {
      return await fn(ctx, args || {})
    })
    ch.appendLine(`${opts?.label ? `[${opts.label}] ` : ''}Done ${scriptPath}`)
    return result
  } finally {
    await disconnect()
  }
}

function pathToUrl(p: string) {
  const u = path.resolve(p)
  const isWin = process.platform === 'win32'
  const pref = isWin ? 'file:///' : 'file://'
  return pref + u.replace(/\\/g, '/')
}

function pathToDataUrl(p: string) {
  try {
    const code = fs.readFileSync(p, 'utf-8')
    const withSource = `${code}\n//# sourceURL=${p}`
    const b64 = Buffer.from(withSource, 'utf-8').toString('base64')
    return `data:text/javascript;base64,${b64}`
  } catch {
    return pathToUrl(p)
  }
}