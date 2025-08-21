// src/previewPane.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { mdToPlainText } from '../../utils/md_plain';
import { setActivePreview } from '../../context/previewRedirect';

const PREVIEW_STATE_KEY = 'myPreview.primaryDoc';

type Block = { srcLine: number; text: string };

export function registerPreviewPane(context: vscode.ExtensionContext) {
  const manager = new PreviewManager(context);
  context.subscriptions.push(
    vscode.commands.registerCommand('myPreview.open', () => manager.openPreviewForActiveEditor()),
    vscode.commands.registerCommand('myPreview.exportTxt', () => manager.exportTxtOfActiveEditor()),
    vscode.commands.registerCommand('myPreview.ttsPlay',  () => manager.sendTTSCommand('play')),
    vscode.commands.registerCommand('myPreview.ttsPause', () => manager.sendTTSCommand('pause')),
    vscode.commands.registerCommand('myPreview.ttsStop',  () => manager.sendTTSCommand('stop')),
  );
  // 启动后尝试恢复上次的预览
  setTimeout(() => manager.restorePrimaryPanel().catch(()=>{}), 150);
  return manager;
}

export class PreviewManager {
  private panels = new Map<string, vscode.WebviewPanel>();
  private loopGuard = new Map<string, number>();
  private scrollState = new Map<string, { isScrolling: boolean; lastDirection: 'editor'|'preview' }>();
  /** 当前被“跟随活动编辑器”复用的主预览面板（用户首次点击按钮后进入跟随模式） */
  private primaryPanel: vscode.WebviewPanel | undefined;
  private primaryDocUri: string | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument(ev => {
        const panel = this.panels.get(ev.document.uri.toString());
        if (panel) {this.debounce(() => this.updatePanel(panel!, ev.document), 80)();}
      }),
      vscode.window.onDidChangeTextEditorVisibleRanges(ev => {
        if (!this.panels.has(ev.textEditor.document.uri.toString())) {return;}
        this.throttle(() => this.sendEditorTop(ev.textEditor.document), 100)();
      }),
      vscode.window.onDidChangeTextEditorSelection(ev => {
        if (!this.panels.has(ev.textEditor.document.uri.toString())) {return;}
        this.throttle(() => this.sendEditorTop(ev.textEditor.document), 100)();
      }),
      // 跟随活动编辑器：若已经打开过一个预览（primaryPanel），则切换文件时复用该面板显示新文件，并在切换前停止 TTS
      vscode.window.onDidChangeActiveTextEditor(ed => {
        if (!ed || !ed.document) {return;}
        this.handleActiveEditorChange(ed.document);
      })
    );
  }

  openPreviewForActiveEditor() {
    const doc = vscode.window.activeTextEditor?.document;
    if (!doc) {return;}
    this.ensurePanelFor(doc).then(async panel => {
      try {
        panel.reveal(vscode.ViewColumn.Beside);
      } catch (e) {
        // panel might have been disposed concurrently; try to recreate
        try { this.panels.delete(doc.uri.toString()); } catch {}
        try { panel = await this.ensurePanelFor(doc); panel.reveal(vscode.ViewColumn.Beside); } catch { return; }
      }

      try {
        this.updatePanel(panel, doc);
      } catch (e) {
        try { this.panels.delete(doc.uri.toString()); } catch {}
        try { panel = await this.ensurePanelFor(doc); this.updatePanel(panel, doc); } catch { return; }
      }

      // 设置为主面板以启用后续自动跟随
      this.primaryPanel = panel;
      this.primaryDocUri = doc.uri.toString();
      this.persistPrimaryDoc(this.primaryDocUri);
    });
  }

  async exportTxtOfActiveEditor() {
    const doc = vscode.window.activeTextEditor?.document;
    if (!doc) {return;}
    const { text } = this.renderToPlainText(doc);
    const uri = await vscode.window.showSaveDialog({
      defaultUri: doc.uri.with({ path: doc.uri.path.replace(/\.[^/\\.]+$/, '') + '.txt' }),
      filters: { Text: ['txt'] },
    });
    if (!uri) {return;}
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
    vscode.window.showInformationMessage(`导出完成：${uri.fsPath}`);
  }

  sendTTSCommand(command: 'play'|'pause'|'stop') {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {return vscode.window.showWarningMessage('没有活动的编辑器');}
    const panel = this.panels.get(editor.document.uri.toString());
    if (!panel) {return vscode.window.showWarningMessage('没有打开的预览面板');}
    panel.webview.postMessage({ type: 'ttsControl', command });
  }

  private async ensurePanelFor(doc: vscode.TextDocument): Promise<vscode.WebviewPanel> {
    const key = doc.uri.toString();
    let panel = this.panels.get(key);
    if (panel) {return panel;}

    panel = vscode.window.createWebviewPanel(
      'myPreview',
      `Preview: ${path.basename(doc.fileName)}`,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
      }
    );
    this.panels.set(key, panel);

    panel.onDidDispose(() => this.panels.delete(key), null, this.context.subscriptions);
    panel.webview.onDidReceiveMessage(msg => this.onWebviewMessage(doc, msg), null, this.context.subscriptions);

    // track preview focus -> redirect effective document
    panel.onDidChangeViewState(e => {
      try {
        if (e.webviewPanel.active) { setActivePreview(doc.uri.toString()); }
        else { setActivePreview(undefined); }
      } catch { /* ignore */ }
    }, null, this.context.subscriptions);

    // 若这是 primaryPanel，被关闭后重置引用
    panel.onDidDispose(() => {
      if (this.primaryPanel === panel) { this.primaryPanel = undefined; this.primaryDocUri = undefined; }
      // 清除持久化状态
      this.persistPrimaryDoc(undefined);
      // 清理 active preview override 若它指向该文档
      try { setActivePreview(undefined); } catch {}
    });

    return panel;
  }

  /** 处理活动编辑器变化：复用 primaryPanel 展示新文档，切换前先停止旧文档的 TTS */
  private handleActiveEditorChange(newDoc: vscode.TextDocument) {
  if (!this.primaryPanel) {return;} // 用户尚未开启任何预览
  // 仅跟随 markdown / plaintext 且来自本地文件系统的文档
  if (!(newDoc.uri.scheme === 'file' && (newDoc.languageId === 'markdown' || newDoc.languageId === 'plaintext'))) {return;}
    const newKey = newDoc.uri.toString();
    if (this.primaryDocUri === newKey) {return;} // 同一个文档，无需切换

  // 1. 停止旧文档 TTS（发送停止命令即可，webview 内自行判断）
  try { this.primaryPanel.webview.postMessage({ type: 'ttsControl', command: 'stop' }); } catch (e) { /* ignore */ }

    // 2. 更新映射：移除旧 key，添加新 key 复用同一个 panel
    if (this.primaryDocUri) { try { this.panels.delete(this.primaryDocUri); } catch {} }
    try {
      this.panels.set(newKey, this.primaryPanel!);
      this.primaryDocUri = newKey;
      this.persistPrimaryDoc(this.primaryDocUri);

      // 3. 用新文档内容刷新 panel
      try {
        this.updatePanel(this.primaryPanel!, newDoc);
      } catch (e) {
        // primaryPanel 可能已失效，清理并创建新的 panel
        this.primaryPanel = undefined;
        this.primaryDocUri = undefined;
        try { this.panels.delete(newKey); } catch {}
        this.ensurePanelFor(newDoc).then(p => {
          try { p.reveal(vscode.ViewColumn.Beside); } catch {}
          this.primaryPanel = p;
          this.primaryDocUri = newKey;
          this.persistPrimaryDoc(this.primaryDocUri);
          try { this.updatePanel(p, newDoc); } catch {}
          setTimeout(() => this.sendEditorTop(newDoc), 50);
        }).catch(() => {});
        return;
      }

      // 4. 同步滚动定位（稍延迟等待渲染）
      setTimeout(() => this.sendEditorTop(newDoc), 50);
    } catch (e) {
      // 容错：尝试新建 panel
      this.primaryPanel = undefined; this.primaryDocUri = undefined;
      try { this.panels.delete(newKey); } catch {}
      this.ensurePanelFor(newDoc).then(p => {
        try { p.reveal(vscode.ViewColumn.Beside); } catch {}
        this.primaryPanel = p; this.primaryDocUri = newKey; this.persistPrimaryDoc(this.primaryDocUri);
        try { this.updatePanel(p, newDoc); } catch {}
        setTimeout(() => this.sendEditorTop(newDoc), 50);
      }).catch(() => {});
      return;
    }
  }

  /** 持久化当前主文档 URI */
  private persistPrimaryDoc(uri: string | undefined) {
    try { this.context.workspaceState.update(PREVIEW_STATE_KEY, uri); } catch {}
  }

  /** 启动时尝试恢复主预览面板 */
  async restorePrimaryPanel() {
    const saved = this.context.workspaceState.get<string | undefined>(PREVIEW_STATE_KEY);
    if (!saved) {return;}
    try {
      const uri = vscode.Uri.parse(saved);
      if (uri.scheme !== 'file') {return;}
      const doc = await vscode.workspace.openTextDocument(uri);
      // 仅限制于 markdown / plaintext
      if (!(doc.languageId === 'markdown' || doc.languageId === 'plaintext')) {return;}
      const panel = await this.ensurePanelFor(doc);
      this.primaryPanel = panel; this.primaryDocUri = doc.uri.toString();
      try { this.updatePanel(panel, doc); } catch {}
      try { panel.reveal(vscode.ViewColumn.Beside, true); } catch (e) {
        try { this.panels.delete(doc.uri.toString()); } catch {}
        return;
      }
      setTimeout(() => this.sendEditorTop(doc), 120);
    } catch {}
  }

  /** 停止所有预览中的 TTS（用于停用扩展） */
  stopAllTTS() {
    for (const p of this.panels.values()) {
      try { p.webview.postMessage({ type: 'ttsControl', command: 'stop' }); } catch {}
    }
  }
  private onWebviewMessage(doc: vscode.TextDocument, msg: any) {
    const key = doc.uri.toString();

    if (msg?.type === 'previewTopLine' && Number.isInteger(msg.line)) {
      const t = Date.now();
      const last = this.loopGuard.get(key) ?? 0;
      const state = this.scrollState.get(key);
      if (t - last < 500 || (state?.isScrolling && state.lastDirection === 'editor')) {return;}

      const editor = this.findEditor(doc);
      if (!editor) {return;}

      this.scrollState.set(key, { isScrolling: true, lastDirection: 'preview' });

      let targetLine = this.clampInt(msg.line, 0, doc.lineCount - 1);
      if (typeof msg.scrollRatio === 'number') {
        targetLine = Math.round(msg.scrollRatio * Math.max(0, doc.lineCount - 1));
        targetLine = this.clampInt(targetLine, 0, doc.lineCount - 1);
      }

      const pos = new vscode.Position(targetLine, 0);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);

      setTimeout(() => {
        const st = this.scrollState.get(key);
        if (st?.lastDirection === 'preview') {this.scrollState.set(key, { isScrolling: false, lastDirection: 'preview' });}
      }, 300);
      return;
    }

    if (msg?.type === 'copyPlainText') {
      const text: string = String(msg.text ?? '');
      vscode.env.clipboard.writeText(text);
      vscode.window.setStatusBarMessage('已复制纯文本', 1200);
      return;
    }

    if (msg?.type === 'jsError') {
      console.warn(`[Preview JS Error] ${msg.message || ''} @${msg.line || ''}:${msg.col || ''}`);
      vscode.window.setStatusBarMessage('预览脚本错误: ' + (msg.message || ''), 4000);
    }
  }

  private updatePanel(panel: vscode.WebviewPanel, doc: vscode.TextDocument) {
    panel.title = `Preview: ${path.basename(doc.fileName)}`;
    const { htmlBody } = this.render(doc);
    panel.webview.html = this.wrapHtml(panel, htmlBody);
  }

  private render(doc: vscode.TextDocument): { htmlBody: string } {
    if (doc.languageId === 'markdown' || /\.md(i|own)?$/i.test(doc.fileName)) {
      const { blocks } = this.renderToPlainText(doc);
      const htmlBody = blocks.map(b => `<div data-line="${b.srcLine}"><pre>${this.escapeHtml(b.text)}</pre></div>`).join('\n');
      return { htmlBody };
    } else {
      const text = doc.getText();
      const htmlBody = `<div data-line="0"><pre>${this.escapeHtml(text)}</pre></div>`;
      return { htmlBody };
    }
  }

  private renderToPlainText(doc: vscode.TextDocument): { text: string; blocks: Block[] } {
    if (doc.languageId === 'markdown' || /\.md(i|own)?$/i.test(doc.fileName)) {
      const src = doc.getText();
      return mdToPlainText(src);
    }
    const text = doc.getText();
    const blocks = [{ srcLine: 0, text }];
    return { text, blocks };
  }

  private sendEditorTop(doc: vscode.TextDocument) {
    const key = doc.uri.toString();
    const panel = this.panels.get(key);
    if (!panel) {return;}
    const editor = this.findEditor(doc);
    if (!editor) {return;}

    const state = this.scrollState.get(key);
    if (state?.isScrolling && state.lastDirection === 'preview') {return;}

    const topVisible = editor.visibleRanges[0]?.start.line ?? editor.selection.active.line;
    const totalLines = doc.lineCount;
    const scrollRatio = Math.min(1, topVisible / Math.max(1, totalLines - 1));

    this.scrollState.set(key, { isScrolling: true, lastDirection: 'editor' });
    this.loopGuard.set(key, Date.now());

    panel.webview.postMessage({
      type: 'scrollToLine',
      line: topVisible,
      scrollRatio,
      totalLines
    });

    setTimeout(() => {
      const st = this.scrollState.get(key);
      if (st?.lastDirection === 'editor') {this.scrollState.set(key, { isScrolling: false, lastDirection: 'editor' });}
    }, 300);
  }

  /** 从模板文件生成 HTML，并把脚本改成外链+nonce */
  private wrapHtml(panel: vscode.WebviewPanel, body: string) {
    const nonce = String(Math.random()).slice(2);
    const mediaDir = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    const htmlTplPath = vscode.Uri.joinPath(mediaDir, 'preview.html');

    // 外链脚本地址（由 preview.ts 编译出的 preview.js）
    const scriptUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaDir, 'preview.js'));

    // 读取模板
    const template = fs.readFileSync(htmlTplPath.fsPath, 'utf8');

    // 替换占位符
    const html = template
      .replace(/__BODY__/g, body)
      .replace(/__NONCE__/g, nonce)
      .replace(/__SCRIPT_URI__/g, scriptUri.toString())
      .replace(/__CSP_SOURCE__/g, panel.webview.cspSource);

    return html;
  }

  /* -------- 小工具 -------- */
  private clampInt(x: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, x)); }
  private escapeHtml(s: string) {
    return s.replace(/[&<>"']/g, c => c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;');
  }
  private debounce<F extends (...args:any[])=>void>(fn:F, ms:number){
    let t: NodeJS.Timeout|undefined; return (...args:Parameters<F>)=>{ if(t) {clearTimeout(t);} t=setTimeout(()=>fn(...args), ms); };
  }
  private throttle<F extends (...args:any[])=>void>(fn:F, ms:number){
    let t: NodeJS.Timeout|undefined, last=0;
    return (...args:Parameters<F>)=>{
      const now=Date.now(), remain=ms-(now-last);
      if(remain<=0){ last=now; fn(...args); }
      else if(!t){ t=setTimeout(()=>{ t=undefined; last=Date.now(); fn(...args); }, remain); }
    };
  }
  private findEditor(doc: vscode.TextDocument){
    return vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === doc.uri.toString());
  }
}

// 导出便于外部停用时调用
export function stopAllPreviewTTS(manager?: PreviewManager) {
  try { manager?.stopAllTTS(); } catch {}
}
