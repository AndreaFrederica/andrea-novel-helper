/* eslint-disable semi */
import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { pathToFileURL } from 'url'
import { buildRuntimeContext, getScriptOutputChannel } from './runtimeEnhanced'

export type ScriptHookName =
  | 'extensionActivated'
  | 'documentSaved'
  | 'beforePlainTextExport'
  | 'afterPlainTextExport'
  | 'beforeTypstRender'
  | 'afterTypstRender'

export type ScriptHookHandler = (payload: any, ctx: any) => any | Promise<any>

export interface PlainTextProcessor {
  id: string
  label: string
  description?: string
  extension?: string
  scriptPath?: string
  handler: (input: PlainTextProcessorInput, ctx: any) => string | { text: string } | Promise<string | { text: string }>
}

export interface PlainTextProcessorInput {
  raw: string
  fallbackText: string
  languageId: string
  fileName: string
  uri: string
  doc: vscode.TextDocument
}

export interface TypstRenderer {
  id: string
  label: string
  description?: string
  /** 模板处理方式：post-process(基于Liquid渲染结果后处理) / source(自主读取模板源文件) / none(不需要模板) */
  templateMode?: TypstTemplateMode
  scriptPath?: string
  handler: (input: TypstRendererInput, ctx: any) => string | { typContent: string } | undefined | Promise<string | { typContent: string } | undefined>
}

export type TypstTemplateMode = 'post-process' | 'source' | 'none'

export interface TypstRendererInput {
  templateName: string
  fallbackTemplatesDir: string
  renderContext: any
  /** Liquid 模板预渲染后的 Typst 内容，适用于 templateMode='post-process' */
  liquidOutput?: string
  /** 模板源文件原始内容，适用于 templateMode='source' */
  templateSource?: string
}

class ScriptExtensionRegistry {
  private hooks = new Map<ScriptHookName, Array<{ scriptPath?: string; handler: ScriptHookHandler }>>()
  private plainTextProcessors = new Map<string, PlainTextProcessor>()
  private typstRenderers = new Map<string, TypstRenderer>()

  clearScriptContributions() {
    this.hooks.clear()
    this.plainTextProcessors.clear()
    this.typstRenderers.clear()
  }

  on(name: ScriptHookName, handler: ScriptHookHandler, scriptPath?: string) {
    const list = this.hooks.get(name) || []
    list.push({ scriptPath, handler })
    this.hooks.set(name, list)
  }

  async emit(name: ScriptHookName, payload: any = {}) {
    const list = this.hooks.get(name) || []
    if (!list.length) return []
    const out = getScriptOutputChannel()
    const results: any[] = []
    for (const item of list) {
      try {
        const { ctx, disconnect } = await buildRuntimeContext({ label: `hook:${name}` })
        try {
          results.push(await item.handler(payload, ctx))
        } finally {
          await disconnect()
        }
      } catch (e: any) {
        out.appendLine(`[hook:${name}] ${item.scriptPath || ''} failed: ${e?.message || String(e)}`)
      }
    }
    return results
  }

  registerPlainTextProcessor(processor: PlainTextProcessor) {
    if (!processor?.id || typeof processor.handler !== 'function') {
      throw new Error('plain text processor requires id and handler')
    }
    this.plainTextProcessors.set(processor.id, processor)
  }

  listPlainTextProcessors(): PlainTextProcessor[] {
    return Array.from(this.plainTextProcessors.values()).sort((a, b) => a.label.localeCompare(b.label))
  }

  getPlainTextProcessor(id: string): PlainTextProcessor | undefined {
    return this.plainTextProcessors.get(id)
  }

  registerTypstRenderer(renderer: TypstRenderer) {
    if (!renderer?.id || typeof renderer.handler !== 'function') {
      throw new Error('typst renderer requires id and handler')
    }
    this.typstRenderers.set(renderer.id, renderer)
  }

  getTypstRendererTemplateMode(id: string): TypstTemplateMode | undefined {
    return this.typstRenderers.get(id)?.templateMode
  }

  listTypstRenderers(): TypstRenderer[] {
    return Array.from(this.typstRenderers.values()).sort((a, b) => a.label.localeCompare(b.label))
  }

  getTypstRenderer(id: string): TypstRenderer | undefined {
    return this.typstRenderers.get(id)
  }
}

export const scriptExtensionRegistry = new ScriptExtensionRegistry()

export function createScriptExtensionApi(scriptPath?: string) {
  return {
    hooks: {
      on: (name: ScriptHookName, handler: ScriptHookHandler) => scriptExtensionRegistry.on(name, handler, scriptPath)
    },
    processors: {
      registerPlainText: (
        meta: { id: string; label?: string; description?: string; extension?: string },
        handler: PlainTextProcessor['handler']
      ) => {
        scriptExtensionRegistry.registerPlainTextProcessor({
          id: meta.id,
          label: meta.label || meta.id,
          description: meta.description,
          extension: meta.extension || 'txt',
          scriptPath,
          handler
        })
      },
      registerTypst: (
        meta: { id: string; label?: string; description?: string },
        handler: TypstRenderer['handler']
      ) => {
        scriptExtensionRegistry.registerTypstRenderer({
          id: meta.id,
          label: meta.label || meta.id,
          description: meta.description,
          scriptPath,
          handler
        })
      }
    },
    renderers: {
      registerTypst: (
        meta: { id: string; label?: string; description?: string; templateMode?: TypstTemplateMode },
        handler: TypstRenderer['handler']
      ) => {
        scriptExtensionRegistry.registerTypstRenderer({
          id: meta.id,
          label: meta.label || meta.id,
          description: meta.description,
          templateMode: meta.templateMode,
          scriptPath,
          handler
        })
      }
    }
  }
}

function toModuleUrl(file: string) {
  try {
    const code = fs.readFileSync(file, 'utf8')
    const withSource = `${code}\n//# sourceURL=${file}`
    return `data:text/javascript;base64,${Buffer.from(withSource, 'utf8').toString('base64')}`
  } catch {
    return pathToFileURL(file).href
  }
}

function walkScripts(root: string): string[] {
  if (!root || !fs.existsSync(root)) return []
  const out: string[] = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (/\.(js|ts)$/i.test(e.name)) out.push(full)
    }
  }
  walk(root)
  return out
}

export async function loadScriptExtensions(rootDir: string) {
  scriptExtensionRegistry.clearScriptContributions()
  const out = getScriptOutputChannel()
  const scripts = walkScripts(rootDir)
  let loaded = 0
  for (const file of scripts) {
    try {
      // eslint-disable-next-line no-restricted-syntax
      const mod = await import(toModuleUrl(file))
      const register = mod?.activate || mod?.register
      if (typeof register !== 'function') continue
      const { ctx, disconnect } = await buildRuntimeContext({ label: 'script-extension' })
      try {
        await register(Object.assign(ctx, createScriptExtensionApi(file)))
        loaded++
      } finally {
        await disconnect()
      }
    } catch (e: any) {
      out.appendLine(`[script-extension] load failed ${file}: ${e?.message || String(e)}`)
    }
  }
  out.appendLine(`[script-extension] loaded ${loaded} script extension(s) from ${rootDir}`)
  await scriptExtensionRegistry.emit('extensionActivated', { rootDir, count: loaded })
}

export async function renderPlainTextWithProcessor(
  doc: vscode.TextDocument,
  fallbackText: string,
  processorId?: string
): Promise<string> {
  const id = processorId || vscode.workspace.getConfiguration('AndreaNovelHelper').get<string>('scripts.defaultPlainTextProcessor', 'internal')
  if (!id || id === 'internal') return fallbackText
  const processor = scriptExtensionRegistry.getPlainTextProcessor(id)
  if (!processor) {
    vscode.window.showWarningMessage(`未找到纯文本处理器：${id}，已使用内置导出。`)
    return fallbackText
  }
  const { ctx, disconnect } = await buildRuntimeContext({ label: `processor:${id}` })
  try {
    const result = await processor.handler({
      raw: doc.getText(),
      fallbackText,
      languageId: doc.languageId,
      fileName: doc.fileName,
      uri: doc.uri.toString(),
      doc
    }, ctx)
    return typeof result === 'string' ? result : String(result?.text ?? fallbackText)
  } finally {
    await disconnect()
  }
}

export async function pickPlainTextProcessor(includeInternal = true): Promise<string | undefined> {
  const items = [
    ...(includeInternal ? [{ label: '内置纯文本导出', description: 'internal', id: 'internal' }] : []),
    ...scriptExtensionRegistry.listPlainTextProcessors().map(p => ({
      label: p.label,
      description: p.id,
      detail: p.description,
      id: p.id
    }))
  ]
  const picked = await vscode.window.showQuickPick(items, { title: '选择纯文本处理器' })
  return picked?.id
}

export async function renderTypstWithRegisteredRenderer(
  input: TypstRendererInput,
  rendererId?: string
): Promise<string | undefined> {
  const id = rendererId || vscode.workspace.getConfiguration('andrea.typst').get<string>('defaultRenderer', 'internal')
  if (!id || id === 'internal' || id === 'liquid') return undefined
  const renderer = scriptExtensionRegistry.getTypstRenderer(id)
  if (!renderer) {
    vscode.window.showWarningMessage(`未找到 Typst 渲染器：${id}，已使用内置 Liquid 模板渲染。`)
    return undefined
  }
  const { ctx, disconnect } = await buildRuntimeContext({ label: `typst-renderer:${id}` })
  try {
    const result = await renderer.handler(input, ctx)
    if (typeof result === 'string') return result
    if (result && typeof result.typContent === 'string') return result.typContent
    return undefined
  } finally {
    await disconnect()
  }
}

export async function pickTypstRenderer(includeInternal = true): Promise<string | undefined> {
  const items = [
    ...(includeInternal ? [{ label: '内置 Liquid 模板渲染器', description: 'internal', id: 'internal' }] : []),
    ...scriptExtensionRegistry.listTypstRenderers().map(r => ({
      label: r.label,
      description: r.id,
      detail: r.description,
      id: r.id
    }))
  ]
  const picked = await vscode.window.showQuickPick(items, { title: '选择 Typst 渲染器' })
  return picked?.id
}
