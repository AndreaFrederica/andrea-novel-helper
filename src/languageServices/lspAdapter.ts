import * as vscode from 'vscode'
import { LanguageFeaturesAdapter } from './types'
import * as handlers from '../lsp/server/handlers'
import { setContext } from '../lsp/server/context'
import { ContextSnapshot } from '../lsp/protocol'
import { getSupportedLanguages } from '../utils/utils'
import { roles as globalRoles } from '../activate'

export class LspAdapter implements LanguageFeaturesAdapter {
  registerCompletion(context: vscode.ExtensionContext): vscode.Disposable[] {
    const langs = Array.from(new Set([...getSupportedLanguages(), 'markdown']))
    const settings = vscode.workspace.getConfiguration('AndreaNovelHelper')
    const snapshot: ContextSnapshot = {
      languages: langs,
      settings: {
        supportedFileTypes: settings.get<string[]>('supportedFileTypes', ['markdown', 'plaintext', 'json5']),
        minChars: settings.get<number>('minChars', 1),
        defaultColor: settings.get<string>('defaultColor')
      },
      roles: (globalRoles || []).map(r => ({
        name: (r as any).name || '',
        type: (r as any).type,
        color: (r as any).color,
        aliases: (r as any).aliases,
        affiliation: (r as any).affiliation
      }))
    }
    setContext(snapshot)
    const selector: (string | vscode.DocumentFilter)[] = []
    for (const l of langs) {
      selector.push({ language: l, scheme: 'file' })
      selector.push({ language: l, scheme: 'untitled' })
    }
    const provider: vscode.CompletionItemProvider = {
      provideCompletionItems: async (document, position, token, contextArg) => {
        return handlers.completion(document, position, token, contextArg)
      }
    }
    const triggers = ['#', '!', '[', '(', '（', '【']
    const d = vscode.languages.registerCompletionItemProvider(selector, provider, ...triggers)
    return [d]
  }
  registerHover(context: vscode.ExtensionContext): vscode.Disposable[] {
    return []
  }
  registerDefinition(context: vscode.ExtensionContext): vscode.Disposable[] {
    return []
  }
  registerReferences(context: vscode.ExtensionContext): vscode.Disposable[] {
    return []
  }
  registerDocumentLink(context: vscode.ExtensionContext): vscode.Disposable[] {
    return []
  }
  registerCodeActions(context: vscode.ExtensionContext): vscode.Disposable[] {
    return []
  }
  registerDecorations(context: vscode.ExtensionContext): vscode.Disposable[] {
    return []
  }
}