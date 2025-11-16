import * as vscode from 'vscode'
import { createRoleCompletionProvider } from '../../Provider/completionProvider'

export async function completion(
  document: vscode.TextDocument,
  position: vscode.Position,
  token: vscode.CancellationToken,
  context: vscode.CompletionContext
): Promise<vscode.CompletionList> {
  const provider = createRoleCompletionProvider()
  const res = await provider.provideCompletionItems(document, position, token, context)
  if (Array.isArray(res)) {
    return new vscode.CompletionList(res, false)
  }
  return (res as vscode.CompletionList) || new vscode.CompletionList([], false)
}