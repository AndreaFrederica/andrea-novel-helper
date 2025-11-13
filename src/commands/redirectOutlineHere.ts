import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import { outlineFS, dir_outline_url, file_outline_url } from '../activate'
import { ensureOutlineFileExists } from '../utils/outline'
import { WcignoreManager, WcignoreRule } from '../utils/wcignoreManager'

function listDir(abs: string) {
    const entries = fs.existsSync(abs) ? fs.readdirSync(abs, { withFileTypes: true }) : []
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name)
    const files = entries.filter(e => e.isFile() && e.name.toLowerCase().endsWith('.md')).map(e => e.name)
    return { dirs, files }
}

function makeItem(kind: 'act'|'dir'|'file', label: string, value: string, description?: string): vscode.QuickPickItem {
    return { label, description, detail: `${kind}|${value}` }
}

function shouldIgnore(rel: string, isDir: boolean, rules: WcignoreRule[]): boolean {
    const posix = rel.replace(/\\/g, '/').replace(/^\/+/, '')
    const bn = posix.split('/').pop() || ''
    for (const r of rules) {
        if (!r.enabled) continue
        let pat = r.pattern.trim().replace(/\\/g, '/').replace(/^\/+/, '')
        if (!pat) continue
        if (pat.endsWith('/')) {
            const pre = pat.slice(0, -1)
            if (posix.startsWith(pre) || bn === pre) return true
            continue
        }
        const hasWildcard = /[\*\?]/.test(pat)
        if (pat.includes('/')) {
            if (hasWildcard) {
                const re = new RegExp('^' + pat.split('').map(c=>c==='*'? '[^/]*': c==='?'? '[^/]': c.replace(/[.+^${}()|\[\]\\]/g,'\\$&')).join('') + '$')
                if (re.test(posix)) return true
            } else {
                if (posix === pat || posix.endsWith('/'+pat)) return true
            }
        } else {
            if (hasWildcard) {
                const re = new RegExp('^' + pat.split('').map(c=>c==='*'? '.*': c==='?'? '.': c.replace(/[.+^${}()|\[\]\\]/g,'\\$&')).join('') + '$')
                if (re.test(bn)) return true
            } else {
                if (bn === pat) return true
            }
        }
    }
    return false
}

function encodeSegments(rel: string): string {
    const segs = rel.replace(/\\/g, '/').split('/').filter(s => s.length > 0)
    return segs.map(s => encodeURIComponent(s)).join('/')
}

async function pickDir(wsRoot: string, rules: WcignoreRule[]): Promise<string | undefined> {
    let curRel = ''
    while (true) {
        const abs = path.join(wsRoot, curRel)
        const { dirs } = listDir(abs)
        const fDirs = dirs.filter(d => !shouldIgnore(curRel ? `${curRel}/${d}` : d, true, rules))
        const items: vscode.QuickPickItem[] = []
        if (curRel) { items.push(makeItem('act', '$(arrow-left) 返回上级', '..')) }
        items.push(makeItem('act', '$(new-file) 选择此目录', '.', curRel || '/'))
        for (const d of fDirs) { items.push(makeItem('dir', `$(folder) ${d}/`, d)) }
        const pick = await vscode.window.showQuickPick(items, { placeHolder: `选择目录（当前：${curRel || '/' }）` })
        if (!pick) { return undefined }
        const detail = pick.detail ?? ''
        const [kind, value] = detail.split('|')
        if (kind === 'act' && value === '..') {
            curRel = curRel ? path.posix.dirname(curRel) : ''
            if (curRel === '.' || curRel === '/') { curRel = '' }
            continue
        }
        if (kind === 'act' && value === '.') {
            return curRel
        }
        if (kind === 'dir') {
            curRel = curRel ? `${curRel}/${value}` : value
            continue
        }
    }
}

async function pickFile(wsRoot: string, rules: WcignoreRule[]): Promise<{ relDir: string, fileName: string } | undefined> {
    let curRel = ''
    while (true) {
        const abs = path.join(wsRoot, curRel)
        const { dirs, files } = listDir(abs)
        const fDirs = dirs.filter(d => !shouldIgnore(curRel ? `${curRel}/${d}` : d, true, rules))
        const fFiles = files.filter(f => !shouldIgnore(curRel ? `${curRel}/${f}` : f, false, rules))
        const items: vscode.QuickPickItem[] = []
        if (curRel) { items.push(makeItem('act', '$(arrow-left) 返回上级', '..')) }
        for (const d of fDirs) { items.push(makeItem('dir', `$(folder) ${d}/`, d)) }
        for (const f of fFiles) { items.push(makeItem('file', `$(file) ${f}`, f)) }
        const pick = await vscode.window.showQuickPick(items, { placeHolder: `选择文件（当前：${curRel || '/' }）` })
        if (!pick) { return undefined }
        const detail = pick.detail ?? ''
        const [kind, value] = detail.split('|')
        if (kind === 'act' && value === '..') {
            curRel = curRel ? path.posix.dirname(curRel) : ''
            if (curRel === '.' || curRel === '/') { curRel = '' }
            continue
        }
        if (kind === 'dir') {
            curRel = curRel ? `${curRel}/${value}` : value
            continue
        }
        if (kind === 'file') {
            return { relDir: curRel, fileName: value }
        }
    }
}

async function browseRedirect(wsRoot: string, outlineRoot: string, rules: WcignoreRule[], viewColumn: vscode.ViewColumn) {
    let curRel = ''
    while (true) {
        const abs = path.join(wsRoot, curRel)
        const { dirs, files } = listDir(abs)
        const fDirs = dirs.filter(d => !shouldIgnore(curRel ? `${curRel}/${d}` : d, true, rules))
        const fFiles = files.filter(f => !shouldIgnore(curRel ? `${curRel}/${f}` : f, false, rules))
        const items: vscode.QuickPickItem[] = []
        if (curRel) { items.push(makeItem('act', '$(arrow-left) 返回上级', '..')) }
        items.push(makeItem('act', '$(new-file) 打开此目录大纲', '.', curRel || '/'))
        for (const d of fDirs) { items.push(makeItem('dir', `$(folder) ${d}/`, d)) }
        for (const f of fFiles) { items.push(makeItem('file', `$(file) ${f}`, f)) }
        const pick = await vscode.window.showQuickPick(items, { placeHolder: `选择目标（当前：${curRel || '/' }）` })
        if (!pick) { return }
        const detail = pick.detail ?? ''
        const [kind, value] = detail.split('|')
        if (kind === 'act' && value === '..') {
            curRel = curRel ? path.posix.dirname(curRel) : ''
            if (curRel === '.' || curRel === '/') { curRel = '' }
            continue
        }
        if (kind === 'act' && value === '.') {
            const key = (curRel.split('/').filter(Boolean).pop()) || 'root'
            const rel = curRel ? `${curRel}/${key}_dir_outline.md` : `root_dir_outline.md`
            ensureOutlineFileExists(path.join(outlineRoot, rel), '📁目录大纲', `目录：${key}`)
            const enc = encodeSegments(rel)
            const uri = vscode.Uri.parse(`andrea-outline://outline/direct/${enc}`)
            await vscode.commands.executeCommand('vscode.open', uri, { preview: false, viewColumn })
            return
        }
        if (kind === 'dir') {
            curRel = curRel ? `${curRel}/${value}` : value
            continue
        }
        if (kind === 'file') {
            const base = path.basename(value, '.md')
            const rel = curRel ? `${curRel}/${base}_outline.md` : `${base}_outline.md`
            ensureOutlineFileExists(path.join(outlineRoot, rel), '📄文件大纲', `文件：${value}`)
            const enc = encodeSegments(rel)
            const uri = vscode.Uri.parse(`andrea-outline://outline/direct/${enc}`)
            await vscode.commands.executeCommand('vscode.open', uri, { preview: false, viewColumn })
            return
        }
    }
}

export async function redirectOutlineHere() {
    const ed = vscode.window.activeTextEditor
    if (!ed || ed.document.uri.scheme !== 'andrea-outline') { return }
    const ws = vscode.workspace.workspaceFolders
    if (!ws || ws.length === 0) { return }
    const wsRoot = ws[0].uri.fsPath
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper')
    const outlineRootRel = cfg.get<string>('outlinePath', 'novel-helper/outline')
    const outlineRoot = path.join(wsRoot, outlineRootRel)
    const mgr = new WcignoreManager(wsRoot)
    const rules = mgr.parseCurrentRules()

    const pathStr = ed.document.uri.path
    const isDirAlias = ['/目录大纲.md', '/outline_dir.md'].includes(pathStr)
    const isFileAlias = ['/文件大纲.md', '/outline_file.md'].includes(pathStr)
    const isDirect = pathStr.startsWith('/direct/')

    const options = [
        { label: '打开当前文件大纲', value: 'rt-file' },
        { label: '打开当前目录大纲', value: 'rt-dir' },
        { label: '打开指定大纲…', value: 'pick-any' }
    ]
    const pickType = await vscode.window.showQuickPick(options, { placeHolder: '选择要打开的大纲' })
    if (!pickType) { return }

    if (pickType.value === 'rt-dir') {
        const uri = vscode.Uri.parse(dir_outline_url)
        await vscode.commands.executeCommand('vscode.open', uri, { preview: false, viewColumn: ed.viewColumn })
        return
    }
    if (pickType.value === 'rt-file') {
        const uri = vscode.Uri.parse(file_outline_url)
        await vscode.commands.executeCommand('vscode.open', uri, { preview: false, viewColumn: ed.viewColumn })
        return
    }
    if (pickType.value === 'pick-any') {
        await browseRedirect(wsRoot, outlineRoot, rules, ed.viewColumn!)
        return
    }
}