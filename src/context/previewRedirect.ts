import * as vscode from 'vscode';

const _emitter = new vscode.EventEmitter<string | undefined>();
let activePreviewSourceUri: string | undefined;

/**
 * 同步 getter：仅在源文档已在内存中打开时返回 TextDocument，避免把调用方变为 async
 */
export function getEffectiveDocumentSync(): vscode.TextDocument | undefined {
  if (activePreviewSourceUri) {
    const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === activePreviewSourceUri);
    if (doc) { return doc; }
  }
  return vscode.window.activeTextEditor?.document;
}

/**
 * 异步 getter：若源文档未打开则尝试打开并返回
 */
export async function getEffectiveDocument(): Promise<vscode.TextDocument | undefined> {
  if (activePreviewSourceUri) {
    try {
      const uri = vscode.Uri.parse(activePreviewSourceUri);
      const opened = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
      if (opened) { return opened; }
      return await vscode.workspace.openTextDocument(uri);
    } catch { /* ignore */ }
  }
  return vscode.window.activeTextEditor?.document;
}

/**
 * 设置当前 active preview 的源文档（传 undefined 表示清除）
 */
export function setActivePreview(sourceUri?: string) {
  const prev = activePreviewSourceUri;
  activePreviewSourceUri = sourceUri;
  if (prev !== activePreviewSourceUri) {
    _emitter.fire(activePreviewSourceUri);
  }
}

/**
 * 事件订阅：当 effective document 改变时触发 listener(uri?)
 */
export function onDidChangeEffectiveDocument(listener: (uri?: string) => void): vscode.Disposable {
  return _emitter.event(listener);
}
