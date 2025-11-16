export type MethodName =
  | 'textDocument/completion'
  | 'textDocument/hover'
  | 'textDocument/definition'
  | 'textDocument/references'
  | 'textDocument/documentLink'
  | 'textDocument/codeAction'
  | 'andrea/decorations/ranges'
  | 'andrea/context/init'

export interface LspPosition { line: number; character: number }
export interface LspRange { start: LspPosition; end: LspPosition }

export interface CompletionParams {
  uri: string
  position: LspPosition
  triggerKind?: number
  triggerCharacter?: string
}

export interface CompletionItemData { id?: string; kind?: string }
export interface CompletionItemLite {
  label: string
  insertText?: string
  sortText?: string
  detail?: string
  documentation?: string
  data?: CompletionItemData
}
export interface CompletionResultLite {
  items: CompletionItemLite[]
  isIncomplete?: boolean
}

export interface RoleSummary {
  name: string
  type?: string
  color?: string
  aliases?: string[]
  affiliation?: string
}

export interface ContextSettings {
  supportedFileTypes: string[]
  minChars: number
  defaultColor?: string
}

export interface ContextSnapshot {
  languages: string[]
  settings: ContextSettings
  roles: RoleSummary[]
  version?: number
}