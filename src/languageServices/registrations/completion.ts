/* eslint-disable semi */
import * as vscode from 'vscode'
import { getSupportedLanguages } from '../../utils/utils'
import { createRoleCompletionProvider } from '../../Provider/completionProvider'

export function registerCompletion(context: vscode.ExtensionContext): vscode.Disposable[] {
  let completionDisposable: vscode.Disposable | undefined
  const register = () => {
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
    const triggers = ['#', '!', '[', '(', '（', '【']
    completionDisposable = vscode.languages.registerCompletionItemProvider(selector, provider, ...triggers)
  }
  register()
  const watcher = vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('AndreaNovelHelper.supportedFileTypes')) {
      register()
    }
  })
  const disposables: vscode.Disposable[] = []
  if (completionDisposable) disposables.push(completionDisposable)
  disposables.push(watcher)
  return disposables
}