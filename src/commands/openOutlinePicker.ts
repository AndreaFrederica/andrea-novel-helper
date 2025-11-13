import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import { outlineFS } from '../activate'
import { WcignoreManager, WcignoreRule } from '../utils/wcignoreManager'

function encodeSegments(rel: string): string {
    const segs = rel.replace(/\\/g, '/').split('/').filter(s => s.length > 0)
    return segs.map(s => encodeURIComponent(s)).join('/')
}

async function ensureExists(fsRoot: string, rel: string, title: string, second: string) {
    const p = path.join(fsRoot, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    if (!fs.existsSync(p)) {
        fs.writeFileSync(p, `# ${title}
> ${second}
`, 'utf8')
    }
}

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
        let pat = r.pattern.trim()
        pat = pat.replace(/\\/g, '/').replace(/^\/+/, '')
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

async function browse(wsRoot: string, outlineRoot: string, baseRel: string, mode: 'any'|'file'|'dir', rules: WcignoreRule[]) {
    let curRel = baseRel
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
        const pick = await vscode.window.showQuickPick(items, { placeHolder: `选择目标（当前：${curRel || '/'}）` })
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
            await ensureExists(outlineRoot, rel, '📁目录大纲', `目录：${key}`)
            const enc = encodeSegments(rel)
            await vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(`andrea-outline://outline/direct/${enc}`), { preview: false })
            return
        }
        if (kind === 'dir') {
            curRel = curRel ? `${curRel}/${value}` : value
            continue
        }
        if (kind === 'file') {
            const base = path.basename(value, '.md')
            const rel = curRel ? `${curRel}/${base}_outline.md` : `${base}_outline.md`
            await ensureExists(outlineRoot, rel, '📄文件大纲', `文件：${value}`)
            const enc = encodeSegments(rel)
            await vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(`andrea-outline://outline/direct/${enc}`), { preview: false })
            return
        }
    }
}

export async function openOutlinePicker() {
    const ws = vscode.workspace.workspaceFolders
    if (!ws || ws.length === 0) { return }
    const wsRoot = ws[0].uri.fsPath
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper')
    const outlineRootRel = cfg.get<string>('outlinePath', 'novel-helper/outline')
    const outlineRoot = path.join(wsRoot, outlineRootRel)
    const mgr = new WcignoreManager(wsRoot)
    const rules = mgr.parseCurrentRules()

    const items = [
        { label: '打开当前文件大纲', value: 'cur-file' },
        { label: '打开当前目录大纲', value: 'cur-dir' },
        { label: '打开指定大纲…', value: 'pick-any' }
    ]
    const pick = await vscode.window.showQuickPick(items, { placeHolder: '选择要打开的大纲' })
    if (!pick) { return }

    const editor = vscode.window.activeTextEditor
    if (!editor) { return }
    const fileUri = editor.document.uri
    const relFile = path.relative(wsRoot, fileUri.fsPath)
    const parts = relFile.split(path.sep)
    const dirParts = parts.slice(0, -1)
    const fileBase = path.basename(parts[parts.length - 1], '.md')
    const folderKey = dirParts.length ? dirParts[dirParts.length - 1] : 'root'
    const outlineDirRel = dirParts.join('/')
    const folderOutlineRel = outlineDirRel ? `${outlineDirRel}/${folderKey}_dir_outline.md` : `root_dir_outline.md`
    const fileOutlineRel = outlineDirRel ? `${outlineDirRel}/${fileBase}_outline.md` : `${fileBase}_outline.md`

    if (pick.value === 'cur-file') {
        if (!outlineFS) { return }
        await ensureExists(outlineRoot, fileOutlineRel, '📄文件大纲', `文件：${path.basename(fileUri.fsPath)}`)
        outlineFS.refreshByTraditionalRel(fileOutlineRel)
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.parse('andrea-outline://outline/文件大纲.md'), { preview: false })
        return
    }
    if (pick.value === 'cur-dir') {
        if (!outlineFS) { return }
        await ensureExists(outlineRoot, folderOutlineRel, '📁目录大纲', `目录：${folderKey}`)
        outlineFS.refreshByTraditionalRel(folderOutlineRel)
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.parse('andrea-outline://outline/目录大纲.md'), { preview: false })
        return
    }
    if (pick.value === 'pick-any') {
        await browse(wsRoot, outlineRoot, '', 'any', rules)
        return
    }
}