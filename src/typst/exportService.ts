/* eslint-disable curly */
/* eslint-disable semi */
import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { Liquid } from 'liquidjs'
import { spawn } from 'child_process'
import { parseSingleFileTemplate } from './singleFileTemplate'
import { templateRegistry } from './templateRegistry'
import { renderTypstWithRegisteredRenderer, scriptExtensionRegistry } from '../mcp/scriptExtensions'

// 全局typstFS引用（由activate.ts在初始化时设置）
let _typstFS: any = undefined

export function setTypstFS(fs: any): void {
  _typstFS = fs
}

export function getTypstFS(): any {
  return _typstFS
}

export type TypstOpts = { format: 'pdf'|'png'|'svg'|'html'; ppi: number; pages?: string; fontPaths: string[] }

/**
 * 将生成的Typst内容映射到内存盘，用于VSCode实时预览
 * @param typContent Typst文档内容
 * @param sourceUri 原始文档URI
 * @returns 内存盘中的URI，如果typstFS未初始化则返回undefined
 */
export function mapTypstToMemory(typContent: string, sourceUri?: vscode.Uri): vscode.Uri | undefined {
  try {
    const typstFS = getTypstFS()
    if (!typstFS) { return }
    
    const docUri = sourceUri || vscode.window.activeTextEditor?.document.uri
    if (!docUri) { return }
    
    return typstFS.mapDocumentToMemory(docUri, typContent)
  } catch (e) {
    console.warn('[TypstMemoryProvider] mapTypstToMemory failed:', e)
    return
  }
}

function mdToTypstInline(s: string): string {
  if (!s) return s
  return s
    .replace(/\*\*([^*]+)\*\*/g, '#text(lang: "zh", weight: "bold")[$1]')
    .replace(/__([^_]+)__/g, '#text(lang: "zh", weight: "bold")[$1]')
    .replace(/\*([^*]+)\*/g, '#text(lang: "zh", style: "italic")[$1]')
    .replace(/_([^_]+)_/g, '#text(lang: "zh", style: "italic")[$1]')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '#link("$2", [$1])')
}

function registerFilters(engine: Liquid) {
  try { engine.registerFilter('md2typst', (v: any) => mdToTypstInline(String(v ?? ''))) } catch {}
  try {
    engine.registerFilter('forum', (v: any) => {
      const s = String(v ?? '')
      return s.replace(/@([^\s\[\]@：:]+)/g, '#text(lang: "zh", fill: rgb(37, 99, 235))[\\@$1]')
    })
  } catch {}
  try {
    engine.registerFilter('imgpath', (src: any, baseDir: any, assetsDir?: any) => {
      const p = String(src ?? '').trim()
      if (!p) return p
      if (/^(https?:|data:)/i.test(p)) return p
      const base = String(baseDir ?? '')
      const abs = path.isAbsolute(p) ? p : path.join(base, p)
      let use = abs
      if (!fs.existsSync(use)) {
        const alt = path.join(base, 'images', p)
        if (fs.existsSync(alt)) use = alt
      }
      // 如果有 assets 目录，则复制到临时资源目录，并返回复制后的路径
      if (assetsDir) {
        try {
          const assets = String(assetsDir)
          fs.mkdirSync(assets, { recursive: true })
          const dest = path.join(assets, path.basename(use))
          if (!fs.existsSync(dest)) fs.copyFileSync(use, dest)
          return ('./assets/' + path.basename(use)).replace(/\\/g, '/')
        } catch { /* ignore */ }
      }
      return use.replace(/\\/g, '/')
    })
  } catch {}
}

export async function renderFromTemplate(templateName: string, fallbackTemplatesDir: string, ctx: any, channel?: vscode.OutputChannel): Promise<string> {
  await scriptExtensionRegistry.emit('beforeTypstRender', { templateName, fallbackTemplatesDir, ctx })
  const finish = async (typContent: string) => {
    const results = await scriptExtensionRegistry.emit('afterTypstRender', { templateName, fallbackTemplatesDir, ctx, typContent })
    for (const r of results) {
      if (typeof r === 'string') typContent = r
      else if (r && typeof r.typContent === 'string') typContent = r.typContent
    }
    return typContent
  }
  const registered = await renderTypstWithRegisteredRenderer(templateName, fallbackTemplatesDir, ctx)
  if (typeof registered === 'string') {
    if (channel) channel.appendLine(`rendered by registered typst renderer (${registered.length} chars)`)
    return finish(registered)
  }
  const pack = templateRegistry.resolve(templateName)
  if (pack) {
    if (channel) channel.appendLine(`template pack resolved: ${templateName}, singleFile=${!!pack.singleFile}`)
    if (pack.singleFile) {
      const rootDir = path.dirname(pack.root)
      const engine = new Liquid({ root: rootDir, extname: '.liquid' })
      registerFilters(engine)
      const full = fs.readFileSync(pack.root, 'utf8')
      if (channel) channel.appendLine(`render single-file: ${pack.root} (${full.length} chars)`) 
      const parts = parseSingleFileTemplate(full)
      const combined = [parts.prelude, parts.entry].filter(Boolean).join('\n')
      if (channel) channel.appendLine(`combined length: ${combined.length}`)
      try {
        const out = await engine.parseAndRender(combined, ctx)
        if (channel) channel.appendLine(`render result length: ${out?.length ?? 0}`)
        return finish(out)
      } catch (e) {
        if (channel) channel.appendLine(`render error: ${e instanceof Error ? e.message : String(e)}`)
        return finish('')
      }
    } else {
      const engine = new Liquid({ root: path.dirname(pack.root), extname: '.liquid' })
      registerFilters(engine)
      const entryRel = path.join(path.basename(pack.root), pack.entry)
      if (channel) channel.appendLine(`render package: root=${path.dirname(pack.root)}, entry=${entryRel}`)
      try {
        const out = await engine.renderFile(entryRel, ctx)
        if (channel) channel.appendLine(`render result length: ${out?.length ?? 0}`)
        return finish(out)
      } catch (e) {
        if (channel) channel.appendLine(`render error: ${e instanceof Error ? e.message : String(e)}`)
        return finish('')
      }
    }
  }
  const dirPath = path.join(fallbackTemplatesDir, templateName)
  const jsonPath = path.join(dirPath, 'template.json')
  if (fs.existsSync(jsonPath)) {
    const cfg = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
    const entry = path.join(templateName, cfg.entry)
    const engine = new Liquid({ root: fallbackTemplatesDir, extname: '.liquid' })
    registerFilters(engine)
    if (channel) channel.appendLine(`render fallback dir: ${dirPath}, entry=${entry}, singleFile=${cfg.singleFile===true}`)
    if (cfg.singleFile === true) {
      const full = fs.readFileSync(path.join(fallbackTemplatesDir, entry), 'utf8')
      const parts = parseSingleFileTemplate(full)
      const combined = [parts.prelude, parts.entry].filter(Boolean).join('\n')
      try {
        const out = await engine.parseAndRender(combined, ctx)
        if (channel) channel.appendLine(`render result length: ${out?.length ?? 0}`)
        return finish(out)
      } catch (e) {
        if (channel) channel.appendLine(`render error: ${e instanceof Error ? e.message : String(e)}`)
        return finish('')
      }
    }
    try {
      const out = await engine.renderFile(entry, ctx)
      if (channel) channel.appendLine(`render result length: ${out?.length ?? 0}`)
      return finish(out)
    } catch (e) {
      if (channel) channel.appendLine(`render error: ${e instanceof Error ? e.message : String(e)}`)
      return finish('')
    }
  }
  // direct single-file under dir
  let file = ''
  if (fs.existsSync(dirPath) && fs.statSync(dirPath).isFile()) file = dirPath
  else {
    const candidates = fs.existsSync(dirPath) ? fs.readdirSync(dirPath).filter(f => f.toLowerCase().endsWith('.typ.liquid')) : []
    if (candidates.length) file = path.join(dirPath, candidates[0])
  }
  if (file) {
    const engine = new Liquid({ root: path.dirname(file), extname: '.liquid' })
    registerFilters(engine)
    const full = fs.readFileSync(file, 'utf8')
    if (channel) channel.appendLine(`render fallback single-file: ${file} (${full.length} chars)`) 
    const parts = parseSingleFileTemplate(full)
    const combined = [parts.prelude, parts.entry].filter(Boolean).join('\n')
    if (channel) channel.appendLine(`combined length: ${combined.length}`)
    try {
      const out = await engine.parseAndRender(combined, ctx)
      if (channel) channel.appendLine(`render result length: ${out?.length ?? 0}`)
      return finish(out)
    } catch (e) {
      if (channel) channel.appendLine(`render error: ${e instanceof Error ? e.message : String(e)}`)
      return finish('')
    }
  }
  if (channel) channel.appendLine(`template not found: ${templateName} in ${fallbackTemplatesDir}`)
  return finish('')
}

export async function compileTypstWithLog(cli: string, typPath: string, out: vscode.Uri, opts: TypstOpts, channel: vscode.OutputChannel): Promise<{ ok: boolean; stderr?: string; stdout?: string }>{
  return await new Promise(resolve => {
    const args: string[] = []
    if (opts.format !== 'pdf') { args.push('-f', opts.format) }
    if (opts.format === 'html') { args.push('--features', 'html') }
    if (opts.format === 'png' && opts.ppi) { args.push('--ppi', String(opts.ppi)) }
    if (opts.pages && String(opts.pages).trim()) { args.push('--pages', String(opts.pages).trim()) }
    if (opts.fontPaths && opts.fontPaths.length) { args.push('--font-path', opts.fontPaths.join(path.delimiter)) }
    args.push(typPath)
    args.push(out.fsPath)
    const cmd = `${cli} compile ${args.map(a => /\s/.test(a) ? '"'+a+'"' : a).join(' ')}`
    channel.appendLine(`$ ${cmd}`)
    const proc = spawn(cli, ['compile', ...args], { cwd: path.dirname(typPath), shell: false })
    let err = ''
    let outBuf = ''
    proc.stdout.on('data', d => { const s = String(d); outBuf += s; channel.append(s) })
    proc.stderr.on('data', d => { err += String(d) })
    proc.on('close', code => { channel.appendLine(`exit ${code}`); resolve({ ok: code === 0, stderr: err, stdout: outBuf }) })
    proc.on('error', () => { resolve({ ok: false, stderr: 'failed to spawn typst' }) })
  })
}
