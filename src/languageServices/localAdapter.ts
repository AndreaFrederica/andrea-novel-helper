import * as vscode from 'vscode'
import { LanguageFeaturesAdapter } from './types'
import { registerCompletion } from './registrations/completion'
import { activateHover } from '../Provider/hoverProvider'
import { activateDef } from '../Provider/defProv'
import { registerRoleReferenceProvider } from '../Provider/roleReferenceProvider'
import { activateDefLinks } from '../Provider/defLinksProvider'
import { registerFixsCodeAction } from '../Provider/fixsCodeActionProvider'
import { registerDecorationWatchers } from '../events/updateDecorations'

export class LocalAdapter implements LanguageFeaturesAdapter {
  registerCompletion(context: vscode.ExtensionContext): vscode.Disposable[] {
    return registerCompletion(context)
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