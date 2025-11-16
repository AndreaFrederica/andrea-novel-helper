import * as vscode from 'vscode'

export type DecorSeverity = 'none' | 'info' | 'warning' | 'error' | 'critical'

export interface DecorStyle {
  underline?: boolean
  bold?: boolean
  gutterIcon?: string
}

export interface DecorRange {
  category: string
  range: vscode.Range
  severity?: DecorSeverity
  style?: DecorStyle
  color?: string
  tooltip?: string
  source?: string
  version?: number
}

export interface LanguageFeaturesAdapter {
  registerCompletion(context: vscode.ExtensionContext): vscode.Disposable[]
  registerHover(context: vscode.ExtensionContext): vscode.Disposable[]
  registerDefinition(context: vscode.ExtensionContext): vscode.Disposable[]
  registerReferences(context: vscode.ExtensionContext): vscode.Disposable[]
  registerDocumentLink(context: vscode.ExtensionContext): vscode.Disposable[]
  registerCodeActions(context: vscode.ExtensionContext): vscode.Disposable[]
  registerDecorations(context: vscode.ExtensionContext): vscode.Disposable[]
}