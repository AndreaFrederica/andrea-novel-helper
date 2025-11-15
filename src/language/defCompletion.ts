import * as vscode from 'vscode'

export function registerDefCompletions(context: vscode.ExtensionContext) {
  const provider = vscode.languages.registerCompletionItemProvider(['markdown','plaintext'], {
    provideCompletionItems(document, position) {
      const items: vscode.CompletionItem[] = []
      const mk = (label: string, insert: string, detail: string) => {
        const it = new vscode.CompletionItem(label, vscode.CompletionItemKind.Snippet)
        it.insertText = new vscode.SnippetString(insert)
        it.detail = detail
        return it
      }
      items.push(mk('&Def Title', '&Def Title = ${1}', '定义主标题'))
      items.push(mk('&Def Subtitle', '&Def Subtitle = ${1}', '定义副标题'))
      items.push(mk('&Def Category', '&Def Category = ${1}', '定义分类'))
      items.push(mk('&Def 主标题', '&Def 主标题 = ${1}', '定义主标题'))
      items.push(mk('&Def 副标题', '&Def 副标题 = ${1}', '定义副标题'))
      items.push(mk('&Def 分类', '&Def 分类 = ${1}', '定义分类'))
      return items
    }
  }, '&', 'D', '主', '副', '分')
  context.subscriptions.push(provider)
}