/* eslint-disable semi */
import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { ensureBuildTempBase } from '../typst/tempPaths'
import { WordCountProvider } from '../Provider/view/wordCountProvider'
import { templateRegistry } from '../typst/templateRegistry'
import { renderFromTemplate, compileTypstWithLog } from '../typst/exportService'
import { parseMarkdownDoc, firstH1, firstHeading, Block } from '../typst/mdParser'
import { scriptExtensionRegistry } from '../mcp/scriptExtensions'

function parseBlocks(text: string): { blocks: Block[] } {
  const doc = parseMarkdownDoc(text)
  return { blocks: doc.blocks as Block[] }
}

export async function exportFromWordCount(provider: WordCountProvider, treeView: vscode.TreeView<any>) {
  const resolveUri = (n: any): vscode.Uri | undefined => {
    if (!n) return undefined
    if (n instanceof vscode.Uri) return n as vscode.Uri
    if (n.resourceUri && n.resourceUri instanceof vscode.Uri) return n.resourceUri as vscode.Uri
    if (typeof n === 'string') return vscode.Uri.file(n)
    if (n.fsPath) return vscode.Uri.file(n.fsPath)
    return undefined
  }
  const selection = (treeView as any).selection as any[]
  const nodes: any[] = Array.isArray(selection) && selection.length ? [...selection] : []
  const files: string[] = []
  const supported = new Set<string>(['md','txt'])
  for (const n of nodes) {
    const uri = resolveUri(n)
    if (!uri) continue
    const isDir = n?.contextValue === 'wordCountFolder' || n?.collapsibleState !== vscode.TreeItemCollapsibleState.None
    if (isDir) {
      try {
        const list = await (provider as any).collectSupportedFiles?.(uri.fsPath)
        for (const f of list || []) { const ext = (f.split('.').pop() || '').toLowerCase(); if (supported.has(ext)) files.push(f) }
      } catch {}
    } else {
      const ext = (uri.fsPath.split('.').pop() || '').toLowerCase(); if (supported.has(ext)) files.push(uri.fsPath)
    }
  }
  if (files.length === 0) {
    const ed = vscode.window.activeTextEditor
    if (ed) { const ext = (ed.document.fileName.split('.').pop() || '').toLowerCase(); if (supported.has(ext)) files.push(ed.document.fileName) }
  }
  if (files.length === 0) return
  const packs = templateRegistry.list()
  const cfg = vscode.workspace.getConfiguration('andrea.typst')
  const defTpl = cfg.get<string>('defaultTemplate','sample')
  const renderer = cfg.get<string>('defaultRenderer', 'internal')
  const isExternalRenderer = renderer && renderer !== 'internal' && renderer !== 'liquid'
  const needsTemplate = !isExternalRenderer || scriptExtensionRegistry.getTypstRendererTemplateMode(renderer) !== 'none'
  const pick = needsTemplate && packs.length > 0
    ? await vscode.window.showQuickPick(packs.map(p => ({ label: p.name, description: p.root })), { placeHolder: '选择Typst模板', canPickMany: false })
    : undefined
  const tplName = pick?.label || defTpl
  const where = await vscode.window.showQuickPick([{ label: '导出到源目录' },{ label: '选择导出目录' }], { placeHolder: '选择导出位置' })
  let outDir: string | undefined
  if (!where) return
  if (where.label === '选择导出目录') { const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false }); if (!picked || picked.length === 0) return; outDir = picked[0].fsPath }
  const formatPick = await vscode.window.showQuickPick([{ label: 'PDF', value: 'pdf' as const },{ label: 'PNG', value: 'png' as const },{ label: 'SVG', value: 'svg' as const },{ label: 'HTML', value: 'html' as const }], { placeHolder: '选择导出格式' })
  const format = (formatPick?.value || cfg.get<'pdf'|'png'|'svg'>('output.format','pdf')) as 'pdf'|'png'|'svg'|'html'
  const titlePick = await vscode.window.showQuickPick([{ label: '提取主标题（第一个一级标题）', value: 'h1' },{ label: '首个标题（任意级别）', value: 'any' },{ label: '文件名（无扩展名）', value: 'file' },{ label: '不提取主标题（不渲染）', value: 'none' }], { placeHolder: '主标题来源' })
  const titleMode = (titlePick?.value as 'h1'|'any'|'file'|'none') || 'h1'
  const ppi = cfg.get<number>('output.ppi',144)
  const pages = cfg.get<string>('pages','')
  const fontPaths = cfg.get<string[]>('font.paths',[])
  const cliPath = cfg.get<string>('cliPath','typst')
  const templatesDir = cfg.get<string>('templatesDir') || (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ? path.join(vscode.workspace.workspaceFolders![0]!.uri.fsPath, 'templates','typst') : '')
  const channel = vscode.window.createOutputChannel('ANH: Typst')
  channel.show(true)
  const cleanupTemp = cfg.get<boolean>('cleanupTemp') ?? false
  for (const f of files) {
    try {
      const text = fs.readFileSync(f, 'utf8')
      const docParsed = parseMarkdownDoc(text)
      const blocks = docParsed.blocks as Block[]
      const baseTitle = path.basename(f).replace(/\.[^\.]+$/, '')
      const h1 = firstH1(blocks)
      const anyH = firstHeading(blocks)
      let chosen = baseTitle
      if (docParsed.meta.defTitle) {
        chosen = docParsed.meta.defTitle
      } else {
        if (titleMode === 'none') chosen = ''
        else if (titleMode === 'h1' && h1) chosen = h1.text
        else if (titleMode === 'any' && anyH) chosen = anyH.text
      }
      const tmpBase = ensureBuildTempBase()
      const tmpDir = fs.mkdtempSync(path.join(tmpBase, 'tmp-'))
      const ctx = { meta: { title: chosen, subtitle: docParsed.meta.subtitle, category: docParsed.meta.category, filename: baseTitle, doc_dir: path.dirname(f), assets_dir: path.join(tmpDir, 'assets'), auto_time: new Date().toLocaleString(), main_title_text: h1 ? h1.text : undefined, main_title_level: h1 ? 1 : undefined }, blocks }
      const typ = await renderFromTemplate(tplName, templatesDir, ctx, channel)
      channel.appendLine(`typ content length: ${typ?.length ?? 0}`)
      if (!typ || typ.trim().length === 0) channel.appendLine('warning: rendered typ is empty')
      const typPath = path.join(tmpDir, 'doc.typ')
      fs.writeFileSync(typPath, typ || '', 'utf8')
      channel.appendLine(`typ file: ${typPath}`)
      const dir = outDir || path.dirname(f)
      const base = path.basename(f).replace(/\.[^\.]+$/, '')
      let outPath: string
      if (format === 'pdf') outPath = path.join(dir, `${base}.pdf`)
      else if (format === 'html') outPath = path.join(dir, `${base}.html`)
      else outPath = path.join(dir, `${base}-{p}.${format}`)
      try {
        const res = await compileTypstWithLog(cliPath, typPath, vscode.Uri.file(outPath), { format, ppi, pages, fontPaths }, channel)
        if (res.stderr) channel.appendLine(res.stderr)
        if (res.stdout) channel.appendLine(res.stdout)
        if (!res.ok && (format !== 'pdf' && format !== 'html')) {
          const single = path.join(dir, `${base}.${format}`)
          const retry = await compileTypstWithLog(cliPath, typPath, vscode.Uri.file(single), { format, ppi, pages: '1', fontPaths }, channel)
          if (retry.stderr) channel.appendLine(retry.stderr)
          if (retry.stdout) channel.appendLine(retry.stdout)
          if (!retry.ok) { vscode.window.showErrorMessage(`导出失败：${f}`); continue }
        }
      } finally {
        if (cleanupTemp) {
          try { fs.rmSync(tmpDir, { recursive: true, force: true }); channel.appendLine(`temp cleaned: ${tmpDir}`) } catch {}
        } else {
          channel.appendLine(`temp kept: ${tmpDir}`)
        }
      }
    } catch { vscode.window.showErrorMessage(`导出失败：${f}`) }
  }
  vscode.window.showInformationMessage(`Typst 导出完成：${files.length} 个文档`)
}

export function registerWordCountTypstExport(context: vscode.ExtensionContext, provider: WordCountProvider, treeView: vscode.TreeView<any>) {
  context.subscriptions.push(vscode.commands.registerCommand('AndreaNovelHelper.wordCount.exportTypst', async () => { await exportFromWordCount(provider, treeView) }))
}
