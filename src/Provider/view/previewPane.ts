// src/previewPane.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { mdToPlainText } from '../../utils/md_plain';

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
  return manager;
}

export class PreviewManager {
  private panels = new Map<string, vscode.WebviewPanel>();
  private loopGuard = new Map<string, number>();
  private scrollState = new Map<string, { isScrolling: boolean; lastDirection: 'editor'|'preview' }>();

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
    );
  }

  openPreviewForActiveEditor() {
    const doc = vscode.window.activeTextEditor?.document;
    if (!doc) {return;}
    this.ensurePanelFor(doc).then(panel => {
      panel.reveal(vscode.ViewColumn.Beside);
      this.updatePanel(panel, doc);
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

    return panel;
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
