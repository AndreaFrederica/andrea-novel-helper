import * as vscode from 'vscode'
import { LanguageFeaturesAdapter } from './types'
import { getSupportedLanguages } from '../utils/utils'
import { createRoleCompletionProvider } from '../Provider/completionProvider'
import { activateHover } from '../Provider/hoverProvider'
import { activateDef } from '../Provider/defProv'
import { registerRoleReferenceProvider } from '../Provider/roleReferenceProvider'
import { activateDefLinks } from '../Provider/defLinksProvider'
import { registerFixsCodeAction } from '../Provider/fixsCodeActionProvider'
import { registerDecorationWatchers } from '../events/updateDecorations'

export class LocalAdapter implements LanguageFeaturesAdapter {
  registerCompletion(context: vscode.ExtensionContext): vscode.Disposable[] {
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

  registerHover(context: vscode.ExtensionContext): vscode.Disposable[] {
    activateHover(context)
    return []
  }

  registerDefinition(context: vscode.ExtensionContext): vscode.Disposable[] {
    activateDef(context)
    return []
  }

  registerReferences(context: vscode.ExtensionContext): vscode.Disposable[] {
    registerRoleReferenceProvider(context)
    return []
  }

  registerDocumentLink(context: vscode.ExtensionContext): vscode.Disposable[] {
    activateDefLinks(context)
    return []
  }

  registerCodeActions(context: vscode.ExtensionContext): vscode.Disposable[] {
    registerFixsCodeAction(context)
    return []
  }

  registerDecorations(context: vscode.ExtensionContext): vscode.Disposable[] {
    registerDecorationWatchers(context)
    return []
  }
}