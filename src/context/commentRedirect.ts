import * as vscode from 'vscode';

const _emitter = new vscode.EventEmitter<string | undefined>();
let activeCommentPanelSourceUri: string | undefined;

/**
 * 同步 getter：检测是否有活跃的批注面板
 */
export function isAnyCommentPanelActive(): boolean {
  return !!activeCommentPanelSourceUri;
}

/**
 * 获取当前活跃批注面板对应的文档
 */
export function getEffectiveCommentDocumentSync(): vscode.TextDocument | undefined {
  if (activeCommentPanelSourceUri) {
    const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === activeCommentPanelSourceUri);
    if (doc) { return doc; }
  }
  return vscode.window.activeTextEditor?.document;
}

/**
 * 异步 getter：若源文档未打开则尝试打开并返回
 */
export async function getEffectiveCommentDocument(): Promise<vscode.TextDocument | undefined> {
  if (activeCommentPanelSourceUri) {
    try {
      const uri = vscode.Uri.parse(activeCommentPanelSourceUri);
      const opened = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
      if (opened) { return opened; }
      return await vscode.workspace.openTextDocument(uri);
    } catch { /* ignore */ }
  }
  return vscode.window.activeTextEditor?.document;
}

/**
 * 设置当前活跃批注面板的源文档（传 undefined 表示清除）
 */
export function setActiveCommentPanel(sourceUri?: string) {
  const prev = activeCommentPanelSourceUri;
  activeCommentPanelSourceUri = sourceUri;
  if (prev !== activeCommentPanelSourceUri) {
    _emitter.fire(activeCommentPanelSourceUri);
  }
}

/**
 * 事件订阅：当活跃批注面板改变时触发 listener(uri?)
 */
export function onDidChangeActiveCommentPanel(listener: (uri?: string) => void): vscode.Disposable {
  return _emitter.event(listener);
}