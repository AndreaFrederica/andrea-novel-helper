/* eslint-disable semi */
import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { templateRegistry } from '../typst/templateRegistry'
import { renderFromTemplate, compileTypstWithLog } from '../typst/exportService'
import { ensureBuildTempBase } from '../typst/tempPaths'
import { parseMarkdownDoc, firstH1, firstHeading, Block } from '../typst/mdParser'

function parseMarkdownLight(text: string): { meta: Record<string, any>; blocks: Block[] } {
    const doc = parseMarkdownDoc(text)
    return { meta: doc.meta, blocks: doc.blocks as Block[] }
}

function renderTypstDirect(ctx: { meta: Record<string, any>; blocks: Block[] }): string {
    const out: string[] = []
    out.push('#set page(width: 21cm, height: 29.7cm, margin: 2cm)')
    for (const b of ctx.blocks) {
        if (b.type === 'heading') {
            out.push(`#heading(level: ${b.level}, [${b.text}])`)
        } else if (b.type === 'paragraph') {
            out.push(`${b.text}`)
        } else if (b.type === 'list') {
            if (b.ordered) {
                for (let i = 0; i < b.items.length; i++) { out.push(`${i + 1}. ${b.items[i]}`) }
            } else {
                for (const it of b.items) { out.push(`• ${it}`) }
            }
        } else if (b.type === 'code') {
            out.push(`[${b.code}]`)
        } else if (b.type === 'blockquote') {
            out.push(`[${b.text}]`)
        } else if (b.type === 'image') {
            out.push(`#image("${b.src}")`)
        } else if (b.type === 'hr') {
            out.push('---')
        }
        out.push('')
    }
    return out.join('\n')
}

async function renderTypstWithLiquid(templatesDir: string, templateName: string, ctx: any): Promise<string> {
    try {
        const tpl = await renderFromTemplate(templateName, templatesDir, ctx)
        return tpl || renderTypstDirect(ctx)
    } catch (e) {
        return renderTypstDirect(ctx)
    }
}


function getConfig() {
    const cfg = vscode.workspace.getConfiguration('andrea.typst')
    const cliPath = cfg.get<string>('cliPath') || 'typst'
    const templatesDir = cfg.get<string>('templatesDir') || path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', 'templates', 'typst')
    const defaultTemplate = cfg.get<string>('defaultTemplate') || 'sample'
    const format = cfg.get<'pdf'|'png'|'svg'>('output.format') || 'pdf'
    const ppi = cfg.get<number>('output.ppi') || 144
    const pages = cfg.get<string>('pages') || ''
    const fontPaths = cfg.get<string[]>('font.paths') || []
    return { cliPath, templatesDir, defaultTemplate, format, ppi, pages, fontPaths }
}

async function pickOutputUri(doc: vscode.TextDocument, format: 'pdf'|'png'|'svg') {
    const base = doc.uri.with({ path: doc.uri.path.replace(/\.[^/\\.]+$/, '') })
    if (format === 'pdf') {
        return await vscode.window.showSaveDialog({ defaultUri: base.with({ path: base.path + '.pdf' }), filters: { PDF: ['pdf'] } })
    }
    const dir = path.dirname(doc.uri.fsPath)
    const name = path.basename(doc.uri.fsPath).replace(/\.[^\.]+$/, '')
    const pattern = vscode.Uri.file(path.join(dir, `${name}-{p}.${format}`))
    return pattern
}


export function registerTypstExport(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.commands.registerCommand('andrea.typst.exportCurrent', async () => {
        const channel = vscode.window.createOutputChannel('ANH: Typst')
        channel.show(true)
        const ed = vscode.window.activeTextEditor
        if (!ed) { return }
        const doc = ed.document
        const { cliPath, templatesDir, defaultTemplate, format, ppi, pages, fontPaths } = getConfig()
        const md = doc.getText()
        const docParsed = parseMarkdownDoc(md)
        const ctx = { meta: docParsed.meta, blocks: docParsed.blocks as Block[] }
        const filename = path.basename(doc.uri.fsPath).replace(/\.[^\.]+$/, '')
        const h1 = firstH1(ctx.blocks)
        const anyHeading = firstHeading(ctx.blocks)
        if (ctx.meta.defTitle) {
            ctx.meta.title = ctx.meta.defTitle
        } else {
            const titlePick = await vscode.window.showQuickPick([
                { label: '提取主标题（第一个一级标题）', value: 'h1' },
                { label: '首个标题（任意级别）', value: 'any' },
                { label: '文件名（无扩展名）', value: 'file' },
                { label: '不提取主标题（不渲染）', value: 'none' }
            ], { placeHolder: '选择主标题来源' })
            const mode = titlePick?.value || 'h1'
            if (mode === 'none') {
                ctx.meta.title = ''
            } else {
                let chosen = filename
                if (mode === 'h1' && h1) chosen = h1.text
                else if (mode === 'any' && anyHeading) chosen = anyHeading.text
                ctx.meta.title = chosen
                if (h1) { (ctx.meta as any).main_title_text = h1.text; (ctx.meta as any).main_title_level = 1 }
            }
        }
        ;(ctx.meta as any).filename = filename
        const typ = await renderFromTemplate(defaultTemplate, templatesDir, ctx, channel)
        channel.appendLine(`rendered typ to temp memory`)
        const tmpBase = ensureBuildTempBase()
        const tmpDir = fs.mkdtempSync(path.join(tmpBase, 'tmp-'))
        const typPath = path.join(tmpDir, 'doc.typ')
        fs.writeFileSync(typPath, typ, 'utf8')
        channel.appendLine(`typ content length: ${typ?.length ?? 0}`)
        if (!typ || typ.trim().length === 0) channel.appendLine('warning: rendered typ is empty')
        channel.appendLine(`typ file: ${typPath}`)
        const outUri = await pickOutputUri(doc, format)
        if (!outUri) { try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {} ; return }
        try {
            const res = await compileTypstWithLog(cliPath, typPath, outUri, { format, ppi, pages, fontPaths }, channel)
            if (!res.ok) {
                if (res.stderr) channel.appendLine(res.stderr)
                vscode.window.showErrorMessage('Typst 编译失败')
                return
            }
            if (res.stdout) channel.appendLine(res.stdout)
            if (format === 'pdf') { await vscode.commands.executeCommand('vscode.open', outUri) }
            vscode.window.showInformationMessage('导出完成')
        } finally {
            try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
        }
    }))
}