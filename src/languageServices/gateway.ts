import * as vscode from 'vscode'
import { LocalAdapter } from './localAdapter'
import { LspAdapter } from './lspAdapter'
import { LanguageFeaturesAdapter } from './types'

export function registerLanguageFeatures(context: vscode.ExtensionContext): void {
  const mode = vscode.workspace.getConfiguration('AndreaNovelHelper.language').get<string>('mode', 'local')
  let adapter: LanguageFeaturesAdapter
  if (mode === 'lsp') {
    adapter = new LspAdapter()
  } else {
    adapter = new LocalAdapter()
  }
  const disposables: vscode.Disposable[] = []
  disposables.push(...adapter.registerCompletion(context))
  disposables.push(...adapter.registerHover(context))
  disposables.push(...adapter.registerDefinition(context))
  disposables.push(...adapter.registerReferences(context))
  disposables.push(...adapter.registerDocumentLink(context))
  disposables.push(...adapter.registerCodeActions(context))
  disposables.push(...adapter.registerDecorations(context))
  for (const d of disposables) {
    context.subscriptions.push(d)
  }
}