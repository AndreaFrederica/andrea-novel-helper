import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'

export type TemplatePack = { name: string; root: string; entry: string; singleFile?: boolean }

class TemplateRegistry {
  private internalRoot: string = ''
  private externalRoot: string = ''
  private packs = new Map<string, TemplatePack>()
  private watcher: vscode.FileSystemWatcher | null = null

  init(context: vscode.ExtensionContext) {
    this.internalRoot = vscode.Uri.joinPath(context.extensionUri, 'templates', 'typst').fsPath
    const cfg = vscode.workspace.getConfiguration('andrea.typst')
    const extDir = cfg.get<string>('externalTemplatesDir')
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || ''
    this.externalRoot = extDir ? extDir.replace('${workspaceFolder}', ws) : path.join(ws, 'novel-helper', 'templates', 'typst')
    this.scan()
    this.setupWatcher()
  }

  private setupWatcher() {
    if (!this.externalRoot) return
    try { this.watcher?.dispose() } catch {}
    const pat = new vscode.RelativePattern(vscode.Uri.file(this.externalRoot), '**/{template.json,*.liquid}')
    this.watcher = vscode.workspace.createFileSystemWatcher(pat)
    const refresh = () => this.scan()
    this.watcher.onDidCreate(refresh)
    this.watcher.onDidChange(refresh)
    this.watcher.onDidDelete(refresh)
  }

  refreshExternalRoot(dir: string) {
    this.externalRoot = dir
    this.scan()
    this.setupWatcher()
  }

  private collect(root: string) {
    if (!root || !fs.existsSync(root)) return
    const entries = fs.readdirSync(root, { withFileTypes: true })
    for (const e of entries) {
      const base = path.join(root, e.name)
      if (e.isDirectory()) {
        const cfgPath = path.join(base, 'template.json')
        if (fs.existsSync(cfgPath)) {
          try {
            const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
            const entry = typeof cfg.entry === 'string' ? cfg.entry : 'entry.typ.liquid'
            const pack: TemplatePack = { name: cfg.name || e.name, root: base, entry, singleFile: cfg.singleFile === true }
            this.packs.set(pack.name, pack)
          } catch {}
          continue
        }
        const files = fs.readdirSync(base)
        const single = files.find(f => f.toLowerCase().endsWith('.typ.liquid'))
        if (single) {
          const meta = this.readInlineMeta(path.join(base, single))
          const name = meta?.name || e.name
          const entryPart = meta?.entry || 'entry'
          const pack: TemplatePack = { name, root: path.join(base, single), entry: entryPart, singleFile: true }
          this.packs.set(name, pack)
        }
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.typ.liquid')) {
        const meta = this.readInlineMeta(base)
        const name = meta?.name || path.basename(base, '.typ.liquid')
        const entryPart = meta?.entry || 'entry'
        const pack: TemplatePack = { name, root: base, entry: entryPart, singleFile: true }
        this.packs.set(name, pack)
      }
    }
  }

  private readInlineMeta(file: string): any | null {
    try {
      const text = fs.readFileSync(file, 'utf8')
      const m = text.match(/---\s*meta\s*---[\s\S]*?\n([\s\S]*?)\n---\s*end\s*---/)
      if (!m) return null
      const json = m[1]
      return JSON.parse(json)
    } catch { return null }
  }

  private scan() {
    this.packs.clear()
    this.collect(this.internalRoot)
    this.collect(this.externalRoot)
  }

  list(): TemplatePack[] {
    return Array.from(this.packs.values())
  }

  resolve(name: string): TemplatePack | null {
    return this.packs.get(name) || null
  }
}

export const templateRegistry = new TemplateRegistry()
