import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

export function getBuildTempBase(): string {
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  if (ws) return path.join(ws, 'build', 'typst')
  return path.join(os.tmpdir(), 'anh-typst')
}

export function ensureBuildTempBase(): string {
  const base = getBuildTempBase()
  try { fs.mkdirSync(base, { recursive: true }) } catch {}
  return base
}