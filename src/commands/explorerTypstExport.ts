/* eslint-disable semi */
import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { ensureBuildTempBase } from '../typst/tempPaths'
import { renderFromTemplate, compileTypstWithLog } from '../typst/exportService'
import { templateRegistry } from '../typst/templateRegistry'
import { parseMarkdownDoc, firstH1, firstHeading, Block } from '../typst/mdParser'

function listSupported(dir: string): string[] {
  const out: string[] = []
  const st = fs.statSync(dir)
  if (st.isFile()) {
    const ext = (dir.split('.').pop() || '').toLowerCase()
    if (ext === 'md' || ext === 'txt') out.push(dir)
    return out
  }
  const ents = fs.readdirSync(dir)
  for (const e of ents) {
    const p = path.join(dir, e)
    const s = fs.statSync(p)
    if (s.isDirectory()) out.push(...listSupported(p))
    else { const ext = (p.split('.').pop() || '').toLowerCase(); if (ext === 'md' || ext === 'txt') out.push(p) }
  }
  return out
}

export async function exportFromExplorer(uri?: vscode.Uri, uris?: vscode.Uri[]) {
  const channel = vscode.window.createOutputChannel('ANH: Typst')
  channel.show(true)
  const cfg = vscode.workspace.getConfiguration('andrea.typst')
  const defTpl = cfg.get<string>('defaultTemplate','sample')
  const ppi = cfg.get<number>('output.ppi',144)
  const pages = cfg.get<string>('pages','')
  const fontPaths = cfg.get<string[]>('font.paths',[])
  const cliPath = cfg.get<string>('cliPath','typst')
  const templatesDir = cfg.get<string>('templatesDir') || (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ? path.join(vscode.workspace.workspaceFolders![0]!.uri.fsPath, 'templates','typst') : '')
  const cleanupTemp = cfg.get<boolean>('cleanupTemp') ?? false
  const inputs: string[] = []
  const renderer = cfg.get<string>('defaultRenderer', 'internal')
  const useInternalRenderer = !renderer || renderer === 'internal' || renderer === 'liquid'
  const picks = useInternalRenderer ? templateRegistry.list().map(p => ({ label: p.name, description: p.root })) : []
  const tplPick = picks.length > 0 ? await vscode.window.showQuickPick(picks, { placeHolder: '选择Typst模板', canPickMany: false }) : undefined
  const tplName = tplPick?.label || defTpl
  const formatPick = await vscode.window.showQuickPick([{ label: 'PDF', value: 'pdf' as const },{ label: 'PNG', value: 'png' as const },{ label: 'SVG', value: 'svg' as const },{ label: 'HTML', value: 'html' as const }], { placeHolder: '选择导出格式' })
  const format = (formatPick?.value || cfg.get<'pdf'|'png'|'svg'>('output.format','pdf')) as 'pdf'|'png'|'svg'|'html'
  const where = await vscode.window.showQuickPick([{ label: '导出到源目录' },{ label: '选择导出目录' }], { placeHolder: '选择导出位置' })
  if (!where) return
  let outDir: string | undefined
  if (where.label === '选择导出目录') { const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false }); if (!picked || picked.length === 0) return; outDir = picked[0].fsPath }
  const collect = (u: vscode.Uri) => { const p = u.fsPath; inputs.push(...listSupported(p)) }
  if (Array.isArray(uris) && uris.length) { for (const u of uris) collect(u) }
  else if (uri) collect(uri)
  else {
    const ed = vscode.window.activeTextEditor
    if (ed) inputs.push(ed.document.fileName)
  }
  const supported = inputs.filter(f => ['md','txt'].includes((f.split('.').pop()||'').toLowerCase()))
  if (supported.length === 0) return
  for (const f of supported) {
    try {
      const text = fs.readFileSync(f, 'utf8')
      const docParsed = parseMarkdownDoc(text)
      const blocks = docParsed.blocks as Block[]
      const baseTitle = path.basename(f).replace(/\.[^\.]+$/, '')
      const h1 = firstH1(blocks)
      const anyH = firstHeading(blocks)
      const titlePick = await vscode.window.showQuickPick([{ label: '提取主标题（第一个一级标题）', value: 'h1' },{ label: '首个标题（任意级别）', value: 'any' },{ label: '文件名（无扩展名）', value: 'file' },{ label: '不提取主标题（不渲染）', value: 'none' }], { placeHolder: '主标题来源' })
      const mode = (titlePick?.value as 'h1'|'any'|'file'|'none') || 'h1'
      let chosen = baseTitle
      if (docParsed.meta.defTitle) chosen = docParsed.meta.defTitle
      else { if (mode === 'none') chosen = ''; else if (mode === 'h1' && h1) chosen = h1.text; else if (mode === 'any' && anyH) chosen = anyH.text }
      const tmpBase = ensureBuildTempBase()
      const tmpDir = fs.mkdtempSync(path.join(tmpBase, 'tmp-'))
      const ctx = { meta: { title: chosen, subtitle: docParsed.meta.subtitle, category: docParsed.meta.category, filename: baseTitle, doc_dir: path.dirname(f), assets_dir: path.join(tmpDir, 'assets'), auto_time: new Date().toLocaleString(), main_title_text: h1 ? h1.text : undefined, main_title_level: h1 ? 1 : undefined }, blocks }
      const typ = await renderFromTemplate(tplName, templatesDir, ctx, channel)
      channel.appendLine(`typ content length: ${typ?.length ?? 0}`)
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
        if (cleanupTemp) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); channel.appendLine(`temp cleaned: ${tmpDir}`) } catch {} } else { channel.appendLine(`temp kept: ${tmpDir}`) }
      }
    } catch { vscode.window.showErrorMessage(`导出失败：${f}`) }
  }
  vscode.window.showInformationMessage(`Typst 导出完成：${supported.length} 个文档`)
}

export function registerExplorerTypstExport(context: vscode.ExtensionContext) {
  context.subscriptions.push(vscode.commands.registerCommand('andrea.typst.exportFromExplorer', async (uri?: vscode.Uri, uris?: vscode.Uri[]) => { await exportFromExplorer(uri, uris) }))
}
