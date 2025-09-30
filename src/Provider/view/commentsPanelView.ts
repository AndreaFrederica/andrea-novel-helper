import * as vscode from 'vscode';
import * as path from 'path';
import { CommentThreadData } from '../../comments/types';
import { getDocUuidForDocument, loadComments, addThread, updateThreadsByDoc, garbageCollectDeletedComments, restoreDeletedThread, deleteThread, saveCommentContent } from '../../comments/storage';

export class CommentsPanelViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'andrea.commentsPanel';

  private view: vscode.WebviewView | undefined;
  private disposables: vscode.Disposable[] = [];
  private activeDocUri: string | undefined;
  private scrollDebounceTimeout?: NodeJS.Timeout;
  private lastScrollSent?: { docUri: string; topLine: number; timestamp: number };
  private suppressEditorToPanelUntil?: number; // 面板驱动reveal后，抑制编辑器->面板滚动上报的时间点

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void | Thenable<void> {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
      retainContextWhenHidden: true
    } as any;
    webviewView.webview.html = this.wrapHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(msg => this.onMessage(msg));

    // 初始化：绑定活动编辑器
    const ed = vscode.window.activeTextEditor;
    if (ed && this.isSupportedDoc(ed.document)) {
      this.bindToDoc(ed.document).catch(() => {});
    }

    // 编辑器事件用于同步滚动与文档切换
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(ed => {
        if (!ed || !this.isSupportedDoc(ed.document)) {
          // 如果切换到不支持的文档，清空面板显示
          if (this.view) {
            this.activeDocUri = undefined;
            this.view.webview.postMessage({ type: 'clear' });
          }
          return;
        }
        void this.bindToDoc(ed.document);
      }),
      vscode.window.onDidChangeTextEditorVisibleRanges(e => {
        if (!this.view) return; if (!e.textEditor?.document) return;
        if (!this.activeDocUri || e.textEditor.document.uri.toString() !== this.activeDocUri) return;
        this.postEditorScroll(e.textEditor.document);
      }),
      vscode.workspace.onDidChangeTextDocument(e => {
        const doc = e.document; if (!this.isSupportedDoc(doc)) return;
        if (this.activeDocUri && doc.uri.toString() === this.activeDocUri) {
          // 文档变化后刷新一次批注列表
          void this.refreshThreads(doc);
        }
      })
    );
  }

  dispose() { 
    // 清理防抖定时器
    if (this.scrollDebounceTimeout) {
      clearTimeout(this.scrollDebounceTimeout);
    }
    this.disposables.forEach(d => d.dispose()); 
  }

  private isSupportedDoc(doc: vscode.TextDocument) {
    return doc.languageId === 'markdown' || doc.languageId === 'plaintext';
  }

  private async bindToDoc(doc: vscode.TextDocument) {
    this.activeDocUri = doc.uri.toString();
    // 初始化
    this.view?.webview.postMessage({ type: 'init', docUri: this.activeDocUri });
    await this.refreshThreads(doc);
    this.postEditorScroll(doc);
  }

  private async refreshThreads(doc: vscode.TextDocument) {
    if (!this.view) return;
    try {
      const docUuid = await getDocUuidForDocument(doc);
      const list: CommentThreadData[] = docUuid ? await loadComments(docUuid) : [];
      const metrics = this.estimateEditorPixels(doc);
      const items = (list || []).map(t => ({
        id: t.id,
        status: t.status,
        start: t.anchor.ranges[0]?.start?.line ?? 0,
        end: t.anchor.ranges[0]?.end?.line ?? 0,
        body: t.messages && t.messages.length > 0 ? t.messages[0].body : '',
        messages: t.messages || [],
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        messageCount: t.messages ? t.messages.length : 0
      }));
      this.view.webview.postMessage({ type: 'threads', lineHeight: metrics.lineHeight, items, totalLines: doc.lineCount, topPad: metrics.topPad || 0 });
    } catch (e) {
      // ignore
    }
  }

  private estimateEditorPixels(doc: vscode.TextDocument) {
    const cfg = vscode.workspace.getConfiguration('editor', doc.uri);
    const fs = cfg.get<number>('fontSize') ?? 14;
    let lh = cfg.get<number>('lineHeight') ?? 0; if (lh <= 0) lh = Math.round(fs * 1.5);
    const pad = cfg.get<{ top?: number; bottom?: number }>('padding') ?? {};
    const topPad = typeof pad.top === 'number' ? pad.top : 0;
    const bottomPad = typeof pad.bottom === 'number' ? pad.bottom : 0;
    return { lineHeight: lh, topPad, bottomPad };
  }

  private computeMaxTop(lineCount: number, visibleApprox: number, beyond: boolean) {
    if (lineCount <= 1) return 0;
    return beyond ? Math.max(0, lineCount - 1) : Math.max(0, lineCount - Math.max(1, visibleApprox));
  }

  private getScrollBeyondLastLine(editor: vscode.TextEditor) {
    const conf = vscode.workspace.getConfiguration('editor', editor.document.uri);
    return !!conf.get<boolean>('scrollBeyondLastLine', true);
  }

  private postEditorScroll(doc: vscode.TextDocument) {
    if (!this.view) return;
    const ed = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === doc.uri.toString());
    if (!ed) return;
    const vr = ed.visibleRanges[0];
    const top = vr ? vr.start.line : 0;
    const vis = vr ? Math.max(1, vr.end.line - vr.start.line) : 1;
    const total = doc.lineCount;
    const beyond = this.getScrollBeyondLastLine(ed);
    const maxTop = this.computeMaxTop(total, vis, beyond);
    const ratio = maxTop > 0 ? Math.min(1, top / maxTop) : 0;
    const metrics = this.estimateEditorPixels(doc);
    
    // 防抖处理，避免频繁发送滚动消息
    this.debouncedPostEditorScroll(doc, top, ratio, metrics);
  }

  private debouncedPostEditorScroll(doc: vscode.TextDocument, topLine: number, ratio: number, metrics: any) {
    const docUri = doc.uri.toString();
    
    // 如果面板刚刚驱动了编辑器滚动，暂时抑制编辑器->面板的滚动同步
    if (this.suppressEditorToPanelUntil && Date.now() < this.suppressEditorToPanelUntil) {
      return;
    }
    
    // 检查是否真的需要发送（避免重复发送相同的滚动位置）
    if (this.lastScrollSent && 
        this.lastScrollSent.docUri === docUri && 
        this.lastScrollSent.topLine === topLine &&
        Date.now() - this.lastScrollSent.timestamp < 100) {
      return;
    }
    
    // 清除之前的防抖定时器
    if (this.scrollDebounceTimeout) {
      clearTimeout(this.scrollDebounceTimeout);
    }
    
    // 设置新的防抖定时器
    this.scrollDebounceTimeout = setTimeout(() => {
      if (!this.view) return;
      
      const vr = vscode.window.activeTextEditor?.visibleRanges[0];
      const currentTop = vr ? vr.start.line : 0;
      const vis = vr ? Math.max(1, vr.end.line - vr.start.line) : 1;
      const total = doc.lineCount;
      const beyond = this.getScrollBeyondLastLine(vscode.window.activeTextEditor!);
      const maxTop = this.computeMaxTop(total, vis, beyond);
      const currentRatio = maxTop > 0 ? Math.min(1, currentTop / maxTop) : 0;
      
      this.view!.webview.postMessage({ 
        type: 'editorScroll', 
        ratio: currentRatio, 
        meta: { 
          top: currentTop, 
          maxTop, 
          total, 
          visibleApprox: vis, 
          beyond 
        }, 
        lineHeight: metrics.lineHeight 
      });
      
      // 记录最后发送的滚动位置
      this.lastScrollSent = { docUri, topLine: currentTop, timestamp: Date.now() };
    }, 50); // 50ms 防抖延迟
  }

  private async onMessage(msg: any) {
    try {
      if (!this.view) return;
      // 选择目标文档：优先已绑定
      let targetDoc: vscode.TextDocument | undefined;
      if (this.activeDocUri) {
        const uri = vscode.Uri.parse(this.activeDocUri);
        try { targetDoc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString()) || await vscode.workspace.openTextDocument(uri); } catch {}
      }
      if (!targetDoc) {
        targetDoc = vscode.window.activeTextEditor?.document;
      }
      if (!targetDoc || !this.isSupportedDoc(targetDoc)) return;

      // 请求刷新
      if (msg.type === 'requestRefresh') {
        await this.refreshThreads(targetDoc);
        return;
      }
      if (msg.type === 'setStateDocUri' && typeof msg.docUri === 'string') {
        this.activeDocUri = msg.docUri;
        return;
      }
      // 定位
      if (msg.type === 'reveal' && typeof msg.id === 'string') {
        const ed = await vscode.window.showTextDocument(targetDoc, { preserveFocus: false });
        // 简单 reveal：按线程起始行居中
        const docUuid = await getDocUuidForDocument(targetDoc);
        const list: CommentThreadData[] = docUuid ? await loadComments(docUuid) : [];
        const it = (list || []).find(t => t.id === msg.id);
        const line = it?.anchor?.ranges?.[0]?.start?.line ?? 0;
        ed.revealRange(new vscode.Range(line, 0, Math.max(line, 0), 0), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        return;
      }
      if (msg.type === 'reply' && typeof msg.id === 'string' && typeof msg.body === 'string') {
        const ed = vscode.window.activeTextEditor;
        const author = this.getAuthorName();
        const docUuid = await getDocUuidForDocument(targetDoc);
        if (!docUuid) return;
        // 复用 storage 逻辑：以“单条回复”方式为对应线程追加消息
        await updateThreadsByDoc(docUuid, (threads) => {
          const it = threads.find(t => t.id === msg.id);
          if (it) {
            const id = String(Date.now());
            const now = Date.now();
            it.messages = it.messages || [];
            it.messages.push({ id, author, body: msg.body, createdAt: now });
            it.updatedAt = now;
          }
        });
        await this.refreshThreads(targetDoc);
        return;
      }
      if (msg.type === 'toggleStatus' && typeof msg.id === 'string') {
        const docUuid = await getDocUuidForDocument(targetDoc);
        if (!docUuid) return;
        await updateThreadsByDoc(docUuid, (threads) => {
          const it = threads.find(t => t.id === msg.id);
          if (it) { it.status = it.status === 'open' ? 'resolved' : 'open'; it }
        });
        await this.refreshThreads(targetDoc);
        return;
      }
      if (msg.type === 'editThread' && typeof msg.id === 'string' && typeof msg.body === 'string') {
        const docUuid = await getDocUuidForDocument(targetDoc);
        if (!docUuid) return;
        await updateThreadsByDoc(docUuid, (threads) => {
          const it = threads.find(t => t.id === msg.id);
          if (it) {
            // 兼容旧格式（单消息）
            if (!it.messages || it.messages.length === 0) {
              it.messages = [{ id: String(Date.now()), author: this.getAuthorName(), body: msg.body, createdAt: Date.now(), updatedAt: Date.now() } as any];
            } else {
              it.messages[0].body = msg.body;
              it.messages[0]
            }
            it
          }
        });
        await this.refreshThreads(targetDoc);
        return;
      }
      if (msg.type === 'editMessage' && typeof msg.threadId === 'string' && typeof msg.messageId === 'string' && typeof msg.body === 'string') {
        const docUuid = await getDocUuidForDocument(targetDoc);
        if (!docUuid) return;
        await updateThreadsByDoc(docUuid, (threads) => {
          const it = threads.find(t => t.id === msg.threadId);
          if (it && it.messages) {
            const m = it.messages.find(mm => String((mm as any).id) === String(msg.messageId));
            if (m) { (m as any).body = msg.body; it.updatedAt = Date.now(); }
          }
        });
        await this.refreshThreads(targetDoc);
        return;
      }
      if (msg.type === 'delete' && typeof msg.id === 'string') {
        await deleteThread(msg.id);
        await this.refreshThreads(targetDoc);
        return;
      }
      if (msg.type === 'garbageCollect') {
        const docUuid = await getDocUuidForDocument(targetDoc);
        if (!docUuid) return;
        const result = await garbageCollectDeletedComments(docUuid);
        await this.refreshThreads(targetDoc);
        this.view?.webview.postMessage({ type: 'garbageCollectResult', deletedCount: result.deletedCount, commentIds: result.commentIds });
        return;
      }
      if (msg.type === 'restoreComment' && typeof msg.id === 'string') {
        const success = await restoreDeletedThread(msg.id);
        await this.refreshThreads(targetDoc);
        this.view?.webview.postMessage({ type: 'restoreCommentResult', success, commentId: msg.id });
        return;
      }
      if (msg.type === 'panelScroll') {
        // 面板滚动 -> 编辑器滚动
        let ed = vscode.window.activeTextEditor as vscode.TextEditor | undefined;
        if (!ed || ed.document.uri.toString() !== targetDoc.uri.toString()) {
          const visible = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === targetDoc!.uri.toString());
          if (visible) { ed = visible; } else { ed = await vscode.window.showTextDocument(targetDoc, { preserveFocus: true, preview: true }); }
        }
        if (!ed) return;
        
        // 设置抑制时间，防止编辑器滚动立即触发面板滚动
        this.suppressEditorToPanelUntil = Date.now() + 200; // 200ms 抑制时间
        
        const vr = ed.visibleRanges[0];
        const vis = vr ? Math.max(1, vr.end.line - vr.start.line) : 1;
        const beyond = this.getScrollBeyondLastLine(ed);
        const maxTop = this.computeMaxTop(targetDoc.lineCount, vis, beyond);
        const ratio = Math.max(0, Math.min(1, Number(msg.ratio || 0)));
        const topLine = Math.round(ratio * maxTop);
        
        ed.revealRange(new vscode.Range(topLine, 0, topLine, 0), vscode.TextEditorRevealType.AtTop);
        return;
      }
    } catch { /* ignore */ }
  }

  private getAuthorName(): string {
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper.comments');
    const custom = cfg.get<string>('authorName');
    if (custom && custom.trim()) return custom.trim();
    try { return process.env['USERNAME'] || process.env['USER'] || 'User'; } catch { return 'User'; }
  }

  private wrapHtml(webview: vscode.Webview): string {
    const nonce = String(Math.random()).slice(2);
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'comments.js'));
    const style = `body{margin:0;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font:13px/1.6 system-ui,-apple-system,'Segoe UI',Roboto,Arial}
      .toolbar{display:flex;gap:8px;align-items:center;padding:8px;border-bottom:1px solid #0002;position:sticky;top:0;background:inherit;z-index:10}
      .toolbar input[type=text]{flex:1;min-width:120px;padding:4px 6px;border-radius:6px;border:1px solid #5557;background:#0003;color:inherit}
      .toolbar select{padding:4px 6px;border-radius:6px;border:1px solid #5557;background:#0003;color:inherit}
      .toolbar-btn{padding:4px 8px;border-radius:6px;border:1px solid #5557;background:var(--vscode-button-background);color:var(--vscode-button-foreground);cursor:pointer;font-size:12px;white-space:nowrap}
      .toolbar-btn:hover{background:var(--vscode-button-hoverBackground)}
      .toolbar-btn:active{background:var(--vscode-button-activeBackground)}
      .root{position:relative;height:100%;overflow:auto}
      .track{position:relative;margin:0;height:100%;padding:0 8px;box-sizing:border-box}
      .card{position:absolute;left:8px;right:8px;min-width:220px;max-width:calc(100% - 16px);padding:10px 12px;border-radius:8px;border:1px solid var(--vscode-editorWidget-border);
            background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); box-shadow: 0 2px 6px rgba(0,0,0,.12)}
      .card .actions{display:flex;flex-wrap:wrap;gap:8px}
      .vbtn{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:1px solid var(--vscode-button-border);border-radius:6px;padding:4px 10px;cursor:pointer}
      .vbtn:hover{background:var(--vscode-button-hoverBackground)}
      .card[data-status="resolved"]{opacity:.6}
      .empty{padding:16px;color:#888}
      .header{display:flex;align-items:center;gap:6px;font-weight:600;margin-bottom:4px}
      .caret{cursor:pointer;user-select:none;opacity:.9}
      .meta{opacity:.8;font-size:12px;margin-bottom:6px}
      .messages-container{margin-bottom:6px}
      .message{border-left:3px solid var(--vscode-editorWidget-border);padding-left:8px}
      .message-header{font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:4px}
      .message-body{line-height:1.5}
      .message-body code{background:var(--vscode-textCodeBlock-background);padding:2px 4px;border-radius:3px;font-size:12px}
      .message-body strong{font-weight:600}
      .message-body em{font-style:italic}
      .message-body del{text-decoration:line-through;opacity:0.7}
      .reply{margin-top:6px}
      textarea{width:100%;min-height:48px;background:#0003;border:1px solid #5557;border-radius:6px;color:inherit;padding:6px}
      .card.collapsed .messages-container,.card.collapsed .actions,.card.collapsed .reply{display:none}
      .card.collapsed{padding:6px 8px}
    `;
    return `<!doctype html><html><head>
      <meta charset="UTF-8"/><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}';">
      <style>${style}</style></head>
      <body>
        <div class="toolbar">
          <input id="search" type="text" placeholder="搜索批注..."/>
          <select id="filter">
            <option value="all">全部</option>
            <option value="open">未解决</option>
            <option value="resolved">已解决</option>
          </select>
          <button id="garbageCollectBtn" class="toolbar-btn" title="清理已删除的批注">🗑️ 清理</button>
        </div>
        <div class="root" id="root"><div id="track" class="track"></div></div>
      <script nonce="${nonce}" src="${scriptUri}"></script>
      </body></html>`;
  }
}

export function registerCommentsPanelView(context: vscode.ExtensionContext) {
  const provider = new CommentsPanelViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CommentsPanelViewProvider.viewType, provider)
  );
  return provider;
}




