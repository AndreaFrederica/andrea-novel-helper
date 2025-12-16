/* eslint-disable semi */
import * as vscode from 'vscode'
import { getSupportedLanguages } from '../../utils/utils'
import { createRoleCompletionProvider } from '../../Provider/completionProvider'

export function registerCompletion(context: vscode.ExtensionContext): vscode.Disposable[] {
  let completionDisposable: vscode.Disposable | undefined
  const defaultSymbolPrefixes = ['@']
  const register = () => {
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper')
    const symbolPrefixes = cfg.get<string[]>('completion.symbolPrefixes', defaultSymbolPrefixes) || defaultSymbolPrefixes
    const wordTriggers = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'.split('')
    const langs = Array.from(new Set([...getSupportedLanguages(), 'markdown']))
    const selector: (string | vscode.DocumentFilter)[] = []
    for (const l of langs) {
      selector.push({ language: l, scheme: 'file' })
      selector.push({ language: l, scheme: 'untitled' })
    }
    if (completionDisposable) {
      completionDisposable.dispose()
    }
    const provider = createRoleCompletionProvider()
    const triggerChars = (symbolPrefixes || []).filter((c): c is string => typeof c === 'string' && c.length === 1)
    const triggers = Array.from(new Set([...(triggerChars.length ? triggerChars : defaultSymbolPrefixes), ...wordTriggers]))
    completionDisposable = vscode.languages.registerCompletionItemProvider(selector, provider, ...triggers)
  }
  register()
  const watcher = vscode.workspace.onDidChangeConfiguration(e => {
    if (
      e.affectsConfiguration('AndreaNovelHelper.supportedFileTypes') ||
      e.affectsConfiguration('AndreaNovelHelper.completion.triggerMode') ||
      e.affectsConfiguration('AndreaNovelHelper.completion.symbolPrefixes')
    ) {
      register()
    }
  })
  const disposables: vscode.Disposable[] = []
  if (completionDisposable) disposables.push(completionDisposable)
  disposables.push(watcher)
  return disposables
}
