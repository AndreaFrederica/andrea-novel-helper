import * as vscode from 'vscode';
import * as path from 'path';
import { CommentThreadData, rangeToVSCodeRange } from './types';
import { addThread, addSingleThread, getDocUuidForDocument, loadComments, paragraphIndexOfRange, updateThreadsByDoc, loadCommentContent, saveCommentContent } from './storage';
import { registerCommentDefinitionProvider, CommentDefinitionProvider } from './definitionProvider';

// 创建诊断集合用于在问题面板显示批注信息
const commentDiagnosticCollection = vscode.languages.createDiagnosticCollection('AndreaNovelHelper Comments');

/**
 * CommentsController: 独立批注面板 + 编辑器装饰 + 同步滚动
 */

export function registerCommentsFeature(context: vscode.ExtensionContext) {
  const controller = new CommentsController(context);
  controller.register();
  
  // 注册批注定义跳转提供器
  const definitionProvider = registerCommentDefinitionProvider(context);
  controller.setDefinitionProvider(definitionProvider);
  
  return controller;
}

class CommentsController {
  private panel: vscode.WebviewPanel | undefined;
  private activeDocUri: string | undefined;
  private threadsByDoc = new Map<string, CommentThreadData[]>();
  private decorationUnderline?: vscode.TextEditorDecorationType;
  private decorationHighlight?: vscode.TextEditorDecorationType;
  private decorationGutter?: vscode.TextEditorDecorationType;
  private disposables: vscode.Disposable[] = [];
  private scheduledRelink = new Map<string, NodeJS.Timeout>();
  private static readonly STATE_KEY = 'andrea.comments.primaryDoc';
  private heartbeat?: NodeJS.Timeout;
  private lastTick?: { docUri?: string; topLine?: number };
  private definitionProvider?: CommentDefinitionProvider;

  constructor(private readonly context: vscode.ExtensionContext) {}

  register() {
    // Persisted restore
    this.disposables.push(
      vscode.window.registerWebviewPanelSerializer('andreaComments', {
        deserializeWebviewPanel: async (panel, state) => {
          await this.deserialize(panel, state).catch(() => { try { panel.dispose(); } catch {} });
        }
      })
    );

    // Commands
    this.disposables.push(
      vscode.commands.registerCommand('andrea.comments.open', () => this.openForActiveEditor()),
      vscode.commands.registerCommand('andrea.comments.add', () => this.addForSelection()),
      vscode.commands.registerCommand('andrea.comments.resolve', (id?: string) => this.updateStatusSelected('resolved', id)),
      vscode.commands.registerCommand('andrea.comments.reopen', (id?: string) => this.updateStatusSelected('open', id)),
    );

    // Listeners for scrolling & changes
    this.disposables.push(
      vscode.window.onDidChangeTextEditorVisibleRanges(e => {
        if (!this.panel) return; if (!e.textEditor.document) return; if (this.activeDocUri !== e.textEditor.document.uri.toString()) return;
        this.postEditorScroll(e.textEditor.document);
      }),
      vscode.window.onDidChangeActiveTextEditor(ed => {
        if (!ed?.document) return;
        if (!this.isSupportedDoc(ed.document)) return;
        // 始终为当前文档确保加载装饰
        this.ensureCommentsLoaded(ed.document);
        // 若面板存在，同步绑定
        if (this.panel) { this.bindPanelToDoc(ed.document); }
      }),
      vscode.workspace.onDidOpenTextDocument(doc => { if (this.isSupportedDoc(doc)) { this.ensureCommentsLoaded(doc); } }),
      vscode.workspace.onDidChangeTextDocument(e => {
        const doc = e.document; if (!this.isSupportedDoc(doc)) return;
        const key = doc.uri.toString();
        const tid = this.scheduledRelink.get(key);
        if (tid) clearTimeout(tid);
        const t = setTimeout(() => { this.relinkAllAnchors(doc); }, 250);
        this.scheduledRelink.set(key, t);
      }),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('AndreaNovelHelper.comments')) {
          this.refreshDecorations();
        }
      }),
      vscode.window.onDidChangeActiveColorTheme(() => { this.refreshDecorations(); })
    );

    // Init deco
    this.refreshDecorations();
    // 激活时为当前可见编辑器加载一次
    const ed = vscode.window.activeTextEditor; if (ed && this.isSupportedDoc(ed.document)) { this.ensureCommentsLoaded(ed.document); }

    // 保底心跳：避免错过事件导致不同步（700ms）
    this.heartbeat = setInterval(() => this.tickActiveEditor(), 700);
    this.disposables.push({ dispose: () => { if (this.heartbeat) clearInterval(this.heartbeat); this.heartbeat = undefined; } });
  }

  dispose() { this.disposables.forEach(d => d.dispose()); this.disposeDecorations(); commentDiagnosticCollection.dispose(); }

  setDefinitionProvider(provider: CommentDefinitionProvider) {
    this.definitionProvider = provider;
    // 立即将当前已缓存的线程推送给定义提供器，避免首次注册后无数据
    try {
      for (const [key, threads] of this.threadsByDoc) {
        this.definitionProvider.updateThreads(key, threads || []);
      }
      // 若当前活动编辑器存在，确保其也被覆盖（冗余保险）
      const ed = vscode.window.activeTextEditor;
      if (ed) {
        const key = ed.document.uri.toString();
        const threads = this.threadsByDoc.get(key);
        if (threads) this.definitionProvider.updateThreads(key, threads);
      }
    } catch { /* ignore */ }
  }

  private updateDiagnostics(doc: vscode.TextDocument, threads: CommentThreadData[]) {
    const diagnostics: vscode.Diagnostic[] = [];
    
    for (const thread of threads) {
      if (thread.status === 'open' && thread.anchor.ranges.length > 0) {
        const range = rangeToVSCodeRange(thread.anchor.ranges[0]);
        const messageCount = thread.messages ? thread.messages.length : 0;
        const firstMessage = thread.messages && thread.messages.length > 0 ? thread.messages[0].body : '无内容';
        const preview = firstMessage.length > 50 ? firstMessage.slice(0, 47) + '...' : firstMessage;
        
        const diagnostic = new vscode.Diagnostic(
          range,
          `批注: ${preview} (${messageCount} 条消息)`,
          vscode.DiagnosticSeverity.Information
        );
        diagnostic.source = 'AndreaNovelHelper';
        diagnostic.code = 'comment';
        diagnostics.push(diagnostic);
      }
    }
    
    commentDiagnosticCollection.set(doc.uri, diagnostics);
  }

  private isSupportedDoc(doc?: vscode.TextDocument) {
    if (!doc) return false;
    return doc.uri.scheme === 'file' && (doc.languageId === 'markdown' || doc.languageId === 'plaintext');
  }

  private ensurePanel(): vscode.WebviewPanel {
    // 若已有有效面板（关闭时会在 onDidDispose 中置为 undefined），直接复用
    if (this.panel) return this.panel;
    const panel = vscode.window.createWebviewPanel(
      'andreaComments',
      '批注',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
        retainContextWhenHidden: true,
      }
    );
    panel.iconPath = {
      light: vscode.Uri.joinPath(this.context.extensionUri, 'images', 'comments_light.svg'),
      dark: vscode.Uri.joinPath(this.context.extensionUri, 'images', 'comments_dark.svg'),
    };
    panel.onDidDispose(() => { this.panel = undefined; }, null, this.disposables);
    panel.webview.onDidReceiveMessage(msg => this.onMessage(msg));
    panel.webview.html = this.wrapHtml(panel.webview);
    this.panel = panel;
    return panel;
  }

  private async deserialize(panel: vscode.WebviewPanel, state: any) {
    // Re-setup panel and bind saved doc
    this.panel = panel;
    panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')], retainContextWhenHidden: true } as any;
    panel.iconPath = {
      light: vscode.Uri.joinPath(this.context.extensionUri, 'images', 'comments_light.svg'),
      dark: vscode.Uri.joinPath(this.context.extensionUri, 'images', 'comments_dark.svg'),
    };
    panel.webview.onDidReceiveMessage(msg => this.onMessage(msg));
    panel.onDidDispose(() => { this.panel = undefined; });
    panel.webview.html = this.wrapHtml(panel.webview);

    // Resolve doc to bind
    const saved = (state && typeof state.docUri === 'string') ? state.docUri : this.context.workspaceState.get<string>(CommentsController.STATE_KEY);
    let targetDoc: vscode.TextDocument | undefined;
    if (saved) {
      try { const uri = vscode.Uri.parse(saved); targetDoc = await vscode.workspace.openTextDocument(uri); } catch { /* ignore */ }
    }
    if (!targetDoc || !(targetDoc.languageId === 'markdown' || targetDoc.languageId === 'plaintext')) {
      const ed = vscode.window.activeTextEditor; if (ed && (ed.document.languageId === 'markdown' || ed.document.languageId === 'plaintext')) targetDoc = ed.document;
    }
    if (targetDoc) await this.bindPanelToDoc(targetDoc);
  }

  private wrapHtml(webview: vscode.Webview): string {
    const nonce = String(Math.random()).slice(2);
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'comments.js'));
    const style = `body{margin:0;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font:13px/1.6 system-ui,-apple-system,'Segoe UI',Roboto,Arial}
      .toolbar{display:flex;gap:8px;align-items:center;padding:8px;border-bottom:1px solid #0002;position:sticky;top:0;background:inherit;z-index:10}
      .toolbar input[type=text]{flex:1;min-width:120px;padding:4px 6px;border-radius:6px;border:1px solid #5557;background:#0003;color:inherit}
      .toolbar select{padding:4px 6px;border-radius:6px;border:1px solid #5557;background:#0003;color:inherit}
      .root{position:relative;height:calc(100vh - 42px);overflow:auto}
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
        </div>
        <div class="root" id="root"><div id="track" class="track"></div></div>
      <script nonce="${nonce}" src="${scriptUri}"></script>
      </body></html>`;
  }

  private async openForActiveEditor() {
    const ed = vscode.window.activeTextEditor;
    if (!ed || !this.isSupportedDoc(ed.document)) { vscode.window.showInformationMessage('请选择 Markdown/纯文本文件'); return; }
    const panel = this.ensurePanel();
    await this.bindPanelToDoc(ed.document);
    panel.reveal(undefined, true);
  }

  private async bindPanelToDoc(doc: vscode.TextDocument) {
    const panel = this.ensurePanel();
    this.activeDocUri = doc.uri.toString();
    try { await this.context.workspaceState.update(CommentsController.STATE_KEY, this.activeDocUri); } catch {}
    const docUuid = getDocUuidForDocument(doc);
    const data = docUuid ? await loadComments(docUuid) : [];
    this.threadsByDoc.set(doc.uri.toString(), data);
    this.postInit(doc, data);
    this.applyDecorations(doc);
    this.postEditorScroll(doc);
  }

  private async addForSelection() {
    const ed = vscode.window.activeTextEditor; 
    if (!ed || !this.isSupportedDoc(ed.document)) return;
    
    // 支持多选择范围
    const selections = ed.selections.filter(sel => !sel.isEmpty);
    if (selections.length === 0) { 
      vscode.window.showWarningMessage('请先选择要批注的文本'); 
      return; 
    }
    
    const author = this.getAuthorName();
    const body = await vscode.window.showInputBox({ 
      prompt: `输入批注内容（将应用到 ${selections.length} 个选择范围）` 
    });
    if (body === undefined) return;
    
    // 获取文档UUID并使用addThread函数支持多选择
    const docUuid = getDocUuidForDocument(ed.document);
    if (!docUuid) return;
    const thread = await addThread(ed.document, selections, body, author);
    if (!thread) return;
    
    const key = ed.document.uri.toString();
    const arr = this.threadsByDoc.get(key) || [];
    arr.push(thread); 
    this.threadsByDoc.set(key, arr);
    
    // 更新定义跳转提供器的线程数据
    if (this.definitionProvider) {
      this.definitionProvider.updateThreads(key, arr);
    }
    
    this.applyDecorations(ed.document);
    this.postThreads(ed.document, arr);
  }

  private async updateStatusSelected(status: 'open' | 'resolved', id?: string) {
    const ed = vscode.window.activeTextEditor; if (!ed) return; const docUuid = getDocUuidForDocument(ed.document); if (!docUuid) return;
    const key = ed.document.uri.toString();
    const list = this.threadsByDoc.get(key) || [];
    let targetId = id;
    if (!targetId && list.length) {
      targetId = list[list.length - 1].id; // fallback: last created
    }
    if (!targetId) return;
    const updated = await updateThreadsByDoc(docUuid, (threads: CommentThreadData[]) => {
      const it = threads.find((t: CommentThreadData) => t.id === targetId);
      if (it) { it.status = status; it.updatedAt = Date.now(); }
    });
    this.threadsByDoc.set(key, updated);
    this.applyDecorations(ed.document);
    this.postThreads(ed.document, updated);
  }

  private getAuthorName(): string {
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper.comments');
    const custom = cfg.get<string>('authorName');
    if (custom && custom.trim()) return custom.trim();
    try { return process.env['USERNAME'] || process.env['USER'] || 'User'; } catch { return 'User'; }
  }

  private refreshDecorations() {
    this.disposeDecorations();
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper.comments');
    const mode = cfg.get<'underline' | 'highlight'>('style.mode', 'underline');
    const underlineStyle = cfg.get<string>('style.underlineStyle', 'solid');
    const underlineColor = cfg.get<string>('style.underlineColor', '#0e639c');
    const offset = cfg.get<number>('style.highlightOffset', 0.06);
    const ruler = cfg.get<boolean>('showInOverviewRuler', true);
    const showGutter = cfg.get<boolean>('showGutterInfo', true);

    if (mode === 'underline') {
      this.decorationUnderline = vscode.window.createTextEditorDecorationType({
        textDecoration: `underline ${underlineStyle} ${underlineColor}`,
        overviewRulerLane: vscode.OverviewRulerLane.Full,
        overviewRulerColor: ruler ? underlineColor : undefined,
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
      });
    } else {
      const theme = vscode.window.activeColorTheme?.kind;
      const alpha = Math.min(0.5, Math.max(0, offset ?? 0.06));
      const bg = (theme === vscode.ColorThemeKind.Dark || theme === vscode.ColorThemeKind.HighContrast)
        ? `rgba(255,255,255,${alpha})`
        : `rgba(0,0,0,${alpha})`;
      this.decorationHighlight = vscode.window.createTextEditorDecorationType({
        backgroundColor: bg,
        overviewRulerLane: vscode.OverviewRulerLane.Full,
        overviewRulerColor: ruler ? bg : undefined,
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
      });
    }

    if (showGutter) {
      const theme = vscode.window.activeColorTheme?.kind;
      const icon = (theme === vscode.ColorThemeKind.Dark || theme === vscode.ColorThemeKind.HighContrast)
        ? vscode.Uri.joinPath(this.context.extensionUri, 'images', 'comments_dark.svg')
        : vscode.Uri.joinPath(this.context.extensionUri, 'images', 'comments_light.svg');
      this.decorationGutter = vscode.window.createTextEditorDecorationType({
        gutterIconPath: icon,
        gutterIconSize: '16px',
      });
    }

    const ed = vscode.window.activeTextEditor;
    if (ed && this.isSupportedDoc(ed.document)) this.applyDecorations(ed.document);
  }

  private disposeDecorations() {
    try { this.decorationUnderline?.dispose(); } catch { }
    try { this.decorationHighlight?.dispose(); } catch { }
    try { this.decorationGutter?.dispose(); } catch { }
    this.decorationUnderline = undefined; this.decorationHighlight = undefined;
    this.decorationGutter = undefined;
  }

  private applyDecorations(doc: vscode.TextDocument) {
    const ed = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === doc.uri.toString());
    if (!ed) return;
    const list = this.threadsByDoc.get(doc.uri.toString()) || [];
    const hoverOn = vscode.workspace.getConfiguration('AndreaNovelHelper.comments').get<boolean>('hoverEnabled', true);
    
    // 支持多范围装饰
    const decoOpts: vscode.DecorationOptions[] = [];
    for (const t of list.filter(t => t.status === 'open')) {
      // 为每个范围创建装饰选项
      for (const range of t.anchor.ranges) {
        decoOpts.push({
          range: rangeToVSCodeRange(range),
          hoverMessage: hoverOn ? this.makeHoverMarkdown(t) : undefined,
        });
      }
    }
    
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper.comments');
    const mode = cfg.get<'underline' | 'highlight'>('style.mode', 'underline');
    if (mode === 'underline' && this.decorationUnderline) {
      ed.setDecorations(this.decorationUnderline, decoOpts);
      if (this.decorationHighlight) ed.setDecorations(this.decorationHighlight, []);
    } else if (mode === 'highlight' && this.decorationHighlight) {
      ed.setDecorations(this.decorationHighlight, decoOpts);
      if (this.decorationUnderline) ed.setDecorations(this.decorationUnderline, []);
    }

    // Gutter info markers
    const showGutter = cfg.get<boolean>('showGutterInfo', true);
    if (this.decorationGutter) {
      if (showGutter) {
        const gopts: vscode.DecorationOptions[] = list.map(t => ({
          range: new vscode.Range(new vscode.Position(t.anchor.ranges[0].start.line, 0), new vscode.Position(t.anchor.ranges[0].start.line, 0)),
          hoverMessage: hoverOn ? this.makeHoverMarkdown(t) : undefined,
        }));
        ed.setDecorations(this.decorationGutter, gopts);
      } else {
        ed.setDecorations(this.decorationGutter, []);
      }
    }
  }

  private makeHoverMarkdown(t: CommentThreadData): vscode.MarkdownString {
    const status = t.status === 'open' ? '未解决' : '已解决';
    const messages = t.messages || [];
    
    const md = new vscode.MarkdownString('', true);
    md.isTrusted = true;
    md.supportThemeIcons = true;
    
    md.appendMarkdown(`$(comment) 批注 · ${status}`);
    
    if (messages.length === 0) {
      md.appendMarkdown('\n\n*暂无消息*');
      return md;
    }
    
    // 显示完整对话记录
    md.appendMarkdown('\n\n**完整对话记录：**\n');
    
    messages.forEach((message, index) => {
      const author = message.author || '未知用户';
      const timestamp = message.createdAt ? new Date(message.createdAt).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit', 
        hour: '2-digit',
        minute: '2-digit'
      }) : '';
      const body = message.body || '';
      
      // 限制每条消息的长度以避免hover过长
      const displayBody = body.length > 100 ? body.slice(0, 97) + '…' : body;
      
      md.appendMarkdown(`\n**${index + 1}.** ${author}`);
      if (timestamp) md.appendMarkdown(` *(${timestamp})*`);
      md.appendMarkdown(`\n\n${displayBody}`);
      
      if (index < messages.length - 1) {
        md.appendMarkdown('\n\n---\n');
      }
    });
    
    if (messages.length > 3) {
      md.appendMarkdown(`\n\n$(info) 共 ${messages.length} 条消息`);
    }
    
    return md;
  }

  private postInit(doc: vscode.TextDocument, threads: CommentThreadData[]) {
    if (!this.panel) return;
    this.panel.webview.postMessage({ type: 'init', docUri: doc.uri.toString() });
    this.postThreads(doc, threads);
    this.postEditorScroll(doc);
  }

  private postThreads(doc: vscode.TextDocument, threads: CommentThreadData[]) {
    if (!this.panel) return;
    const metrics = this.estimateEditorPixels(doc);
    const items = threads.map(t => ({
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
    this.panel.webview.postMessage({ type: 'threads', lineHeight: metrics.lineHeight, items, totalLines: doc.lineCount, topPad: metrics.topPad || 0 });
  }

  private postEditorScroll(doc: vscode.TextDocument) {
    if (!this.panel) return;
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
    this.panel.webview.postMessage({ type: 'editorScroll', ratio, meta: { top, maxTop, total, visibleApprox: vis, beyond }, lineHeight: metrics.lineHeight });
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

  private getScrollBeyondLastLine(editor: vscode.TextEditor) {
    const conf = vscode.workspace.getConfiguration('editor', editor.document.uri);
    return !!conf.get<boolean>('scrollBeyondLastLine', true);
  }

  private computeMaxTop(lineCount: number, visibleApprox: number, beyond: boolean) {
    if (lineCount <= 1) return 0;
    return beyond ? Math.max(0, lineCount - 1) : Math.max(0, lineCount - Math.max(1, visibleApprox));
  }

  /** 确保为指定文档加载批注并应用装饰，即使面板未打开 */
  private async ensureCommentsLoaded(doc: vscode.TextDocument) {
    const key = doc.uri.toString();
    if (this.threadsByDoc.has(key)) { this.applyDecorations(doc); return; }
    const uuid = getDocUuidForDocument(doc);
    if (!uuid) { this.threadsByDoc.set(key, []); this.applyDecorations(doc); return; }
    const threads = await loadComments(uuid);
    this.threadsByDoc.set(key, threads || []);
    
    // 更新定义跳转提供器的线程数据
    if (this.definitionProvider) {
      this.definitionProvider.updateThreads(key, threads || []);
    }
    
    this.applyDecorations(doc);
  }

  /** 心跳检测：兜底同步当前活动编辑器与面板/滚动 */
  private tickActiveEditor() {
    const ed = vscode.window.activeTextEditor;
    if (!ed || !this.isSupportedDoc(ed.document)) { this.lastTick = undefined; return; }
    const doc = ed.document;
    const docUri = doc.uri.toString();
    // 确保装饰
    if (!this.threadsByDoc.has(docUri)) { this.ensureCommentsLoaded(doc); }
    // 面板绑定
    if (this.panel && this.activeDocUri !== docUri) { this.bindPanelToDoc(doc); }
    // 滚动同步（若面板已开且顶行变化）
    const vr = ed.visibleRanges[0];
    const top = vr ? vr.start.line : 0;
    if (this.panel) {
      const changed = (!this.lastTick || this.lastTick.docUri !== docUri || this.lastTick.topLine !== top);
      if (changed) { this.postEditorScroll(doc); }
    }
    this.lastTick = { docUri, topLine: top };
  }

  private async relinkAllAnchors(doc: vscode.TextDocument) {
    const key = doc.uri.toString();
    const list = this.threadsByDoc.get(key); if (!list || list.length === 0) return;
    const text = doc.getText();
    const updated: CommentThreadData[] = [];
    
    for (const t of list) {
      const newRanges = [];
      const newSelTexts = [];
      const newContexts = [];
      const newParas = [];
      
      // 处理每个范围的重定位
      for (let i = 0; i < t.anchor.ranges.length; i++) {
        const range = t.anchor.ranges[i];
        const selText = t.anchor.selTexts[i];
        const context = t.anchor.contexts[i];
        const para = t.anchor.para?.[i];
        
        const prevStart = doc.offsetAt(new vscode.Position(range.start.line, range.start.ch));

        // 1) 精确匹配：原选中文本
        const exact = this.findBestOccurrence(text, selText, prevStart);
        if (exact !== undefined) {
          const start = doc.positionAt(exact);
          const end = doc.positionAt(exact + selText.length);
          newRanges.push({ start: { line: start.line, ch: start.character }, end: { line: end.line, ch: end.character } });
          newSelTexts.push(selText);
          newContexts.push(context);
          newParas.push(paragraphIndexOfRange(doc, new vscode.Selection(start, end)));
          continue;
        }

        // 2) 上下文重定位（删除/移动中间段落时）
        const ctxPos = this.rebindByContextMulti(text, selText, context, prevStart);
        if (ctxPos !== undefined) {
          const start = doc.positionAt(ctxPos);
          const end = doc.positionAt(Math.min(text.length, ctxPos + Math.max(1, selText.length)));
          newRanges.push({ start: { line: start.line, ch: start.character }, end: { line: end.line, ch: end.character } });
          newSelTexts.push(selText);
          newContexts.push(context);
          newParas.push(paragraphIndexOfRange(doc, new vscode.Selection(start, end)));
          continue;
        }

        // 3) 段落索引兜底：找原段落编号附近的起始行
        if (para && typeof para.startIndex === 'number') {
          const approx = this.approxStartOfParagraph(doc, para.startIndex);
          const start = approx;
          const end = doc.positionAt(Math.min(text.length, doc.offsetAt(start) + Math.max(1, selText.length)));
          newRanges.push({ start: { line: start.line, ch: start.character }, end: { line: end.line, ch: end.character } });
          newSelTexts.push(selText);
          newContexts.push(context);
          newParas.push(para);
        } else {
          // 保持原范围
          newRanges.push(range);
          newSelTexts.push(selText);
          newContexts.push(context);
          newParas.push(para || { startIndex: 0, endIndex: 0 });
        }
      }
      
      // 更新锚点信息
      t.anchor.ranges = newRanges;
      t.anchor.selTexts = newSelTexts;
      t.anchor.contexts = newContexts;
      t.anchor.para = newParas;
      t.updatedAt = Date.now();
      updated.push(t);
    }
    const docUuid = getDocUuidForDocument(doc);
    if (docUuid) {
      // 使用updateThreadsByDoc保存更新后的线程数据
      await updateThreadsByDoc(docUuid, () => updated);
    }
    this.threadsByDoc.set(key, updated);
    this.applyDecorations(doc);
    this.postThreads(doc, updated);
  }

  private findBestOccurrence(haystack: string, needle: string, preferOffset: number): number | undefined {
    if (!needle) return undefined;
    const occ: number[] = [];
    let i = haystack.indexOf(needle);
    while (i !== -1) { occ.push(i); i = haystack.indexOf(needle, i + 1); }
    if (!occ.length) return undefined;
    // choose nearest to preferOffset
    let best = occ[0], bestDist = Math.abs(best - preferOffset);
    for (const o of occ) { const d = Math.abs(o - preferOffset); if (d < bestDist) { best = o; bestDist = d; } }
    return best;
  }

  private rebindByContext(text: string, t: CommentThreadData, prevStart: number): number | undefined {
    const beforeRaw = (t.anchor.contexts[0]?.before || '').slice(-24);
    const afterRaw = (t.anchor.contexts[0]?.after || '').slice(0, 24);
    const WINDOW = 8000; // 限定搜索窗口，提升速度与稳定性
    const from = Math.max(0, prevStart - WINDOW);
    const to = Math.min(text.length, prevStart + WINDOW);
    const windowText = text.slice(from, to);

    let beforeIdx = -1, afterIdx = -1;
    if (beforeRaw) beforeIdx = windowText.lastIndexOf(beforeRaw);
    if (afterRaw) afterIdx = windowText.indexOf(afterRaw);

    if (beforeIdx >= 0 && afterIdx >= 0 && beforeIdx < afterIdx) {
      const start = from + beforeIdx + beforeRaw.length;
      return start;
    }
    if (beforeIdx >= 0) { return from + beforeIdx + beforeRaw.length; }
    if (afterIdx >= 0) { return Math.max(from, from + afterIdx - Math.floor((t.anchor.selTexts[0] || '').length / 2)); }

    // 简易关键词回钩：取最长 token 搜索
    const tokens = String(t.anchor.selTexts[0] || '').split(/\s+/).filter(s => s.length >= 2).sort((a,b)=>b.length-a.length);
    if (tokens.length) {
      const tok = tokens[0];
      const ti = windowText.indexOf(tok);
      if (ti >= 0) return from + ti;
    }
    return undefined;
  }

  private rebindByContextMulti(text: string, selText: string, context: any, prevStart: number): number | undefined {
    const beforeRaw = (context?.before || '').slice(-24);
    const afterRaw = (context?.after || '').slice(0, 24);
    const WINDOW = 8000; // 限定搜索窗口，提升速度与稳定性
    const from = Math.max(0, prevStart - WINDOW);
    const to = Math.min(text.length, prevStart + WINDOW);
    const windowText = text.slice(from, to);

    let beforeIdx = -1, afterIdx = -1;
    if (beforeRaw) beforeIdx = windowText.lastIndexOf(beforeRaw);
    if (afterRaw) afterIdx = windowText.indexOf(afterRaw);

    if (beforeIdx >= 0 && afterIdx >= 0 && beforeIdx < afterIdx) {
      const start = from + beforeIdx + beforeRaw.length;
      return start;
    }
    if (beforeIdx >= 0) { return from + beforeIdx + beforeRaw.length; }
    if (afterIdx >= 0) { return Math.max(from, from + afterIdx - Math.floor((selText || '').length / 2)); }

    // 简易关键词回钩：取最长 token 搜索
    const tokens = String(selText || '').split(/\s+/).filter(s => s.length >= 2).sort((a,b)=>b.length-a.length);
    if (tokens.length) {
      const tok = tokens[0];
      const ti = windowText.indexOf(tok);
      if (ti >= 0) return from + ti;
    }
    return undefined;
  }

  private approxStartOfParagraph(doc: vscode.TextDocument, paraIndex: number): vscode.Position {
    // 遍历到指定段落编号的第一行
    let idx = 0;
    for (let ln = 0; ln < doc.lineCount; ln++) {
      if (ln === 0) { if (idx === paraIndex) return new vscode.Position(0, 0); continue; }
      const prevEmpty = /^[\s\t]*$/.test(doc.lineAt(ln - 1).text);
      if (prevEmpty) idx++;
      if (idx === paraIndex) return new vscode.Position(ln, 0);
    }
    return new vscode.Position(Math.max(0, doc.lineCount - 1), 0);
  }

  private async onMessage(msg: any) {
    console.log('[Controller] Received message:', msg);
    if (!msg) return;
    if (msg.type === 'requestRefresh') {
      const ed = vscode.window.activeTextEditor; if (!ed || !this.isSupportedDoc(ed.document)) return;
      const list = this.threadsByDoc.get(ed.document.uri.toString()) || [];
      this.postThreads(ed.document, list);
      return;
    }
    if (msg.type === 'setStateDocUri' && typeof msg.docUri === 'string') {
      try { this.context.workspaceState.update(CommentsController.STATE_KEY, String(msg.docUri)); } catch {}
      return;
    }
    if (msg.type === 'reveal' && typeof msg.id === 'string') {
      const ed = vscode.window.activeTextEditor; if (!ed) return; const list = this.threadsByDoc.get(ed.document.uri.toString()) || [];
      const t = list.find(x => x.id === msg.id); if (!t || !t.anchor.ranges || t.anchor.ranges.length === 0) return;
      const r = rangeToVSCodeRange(t.anchor.ranges[0]); // 使用第一个范围进行reveal
      ed.revealRange(r, vscode.TextEditorRevealType.InCenter);
      ed.selection = new vscode.Selection(r.start, r.end);
      return;
    }
    if (msg.type === 'reply' && typeof msg.id === 'string' && typeof msg.body === 'string') {
      console.log('[Controller] Processing reply:', { id: msg.id, body: msg.body });
      
      // 使用绑定的文档而不是activeTextEditor，因为焦点可能在批注面板上
      if (!this.activeDocUri) {
        console.log('[Controller] No active document URI for reply');
        return;
      }
      
      let targetDoc: vscode.TextDocument | undefined;
      try {
        const uri = vscode.Uri.parse(this.activeDocUri);
        targetDoc = await vscode.workspace.openTextDocument(uri);
      } catch (err) {
        console.log('[Controller] Failed to open document for reply:', err);
        return;
      }
      
      const docUuid = getDocUuidForDocument(targetDoc); 
      if (!docUuid) {
        console.log('[Controller] No docUuid for document in reply');
        return;
      }
      const author = this.getAuthorName();
      console.log('[Controller] Adding reply with author:', author);
      const updated = await updateThreadsByDoc(docUuid, (threads) => {
        const it = threads.find(t => t.id === msg.id);
        if (it) { 
          console.log('[Controller] Found thread for reply, adding message');
          it.messages.push({ id: `${Date.now()}`, author, body: msg.body, createdAt: Date.now() }); 
          it.updatedAt = Date.now(); 
        } else {
          console.log('[Controller] Thread not found for reply:', msg.id);
        }
      });
      const key = targetDoc.uri.toString(); 
      this.threadsByDoc.set(key, updated);
      console.log('[Controller] Updated threadsByDoc for reply, key:', key);
      
      // 更新定义跳转提供器的线程数据
      if (this.definitionProvider) {
        this.definitionProvider.updateThreads(key, updated);
      }
      
      this.applyDecorations(targetDoc); 
      this.postThreads(targetDoc, updated);
      console.log('[Controller] reply processing completed');
      return;
    }
    if (msg.type === 'editThread' && typeof msg.id === 'string' && typeof msg.body === 'string') {
      console.log('[Controller] Processing editThread:', { id: msg.id, body: msg.body });
      
      // 使用绑定的文档而不是activeTextEditor，因为焦点可能在批注面板上
      if (!this.activeDocUri) {
        console.log('[Controller] No active document URI');
        return;
      }
      
      let targetDoc: vscode.TextDocument | undefined;
      try {
        const uri = vscode.Uri.parse(this.activeDocUri);
        targetDoc = await vscode.workspace.openTextDocument(uri);
      } catch (err) {
        console.log('[Controller] Failed to open document:', err);
        return;
      }
      
      const docUuid = getDocUuidForDocument(targetDoc); 
      if (!docUuid) {
        console.log('[Controller] No docUuid for document');
        return;
      }
      console.log('[Controller] Updating thread with docUuid:', docUuid);
      const updated = await updateThreadsByDoc(docUuid, (threads) => {
        const it = threads.find(t => t.id === msg.id);
        if (it && it.messages && it.messages[0]) { 
          console.log('[Controller] Found thread, updating body from:', it.messages[0].body, 'to:', msg.body);
          it.messages[0].body = msg.body; 
          it.updatedAt = Date.now(); 
        } else {
          console.log('[Controller] Thread not found or no messages:', it);
        }
      });
      const key = targetDoc.uri.toString(); 
      this.threadsByDoc.set(key, updated);
      console.log('[Controller] Updated threadsByDoc for key:', key);
      
      // 更新定义跳转提供器的线程数据
      if (this.definitionProvider) {
        this.definitionProvider.updateThreads(key, updated);
      }
      
      this.applyDecorations(targetDoc); 
      this.postThreads(targetDoc, updated);
      console.log('[Controller] editThread processing completed');
      return;
    }
    if (msg.type === 'editMessage' && typeof msg.threadId === 'string' && typeof msg.messageId === 'string' && typeof msg.body === 'string') {
      console.log('[Controller] Processing editMessage:', { threadId: msg.threadId, messageId: msg.messageId, body: msg.body });
      
      // 使用绑定的文档而不是activeTextEditor，因为焦点可能在批注面板上
      if (!this.activeDocUri) {
        console.log('[Controller] No active document URI');
        return;
      }
      
      let targetDoc: vscode.TextDocument | undefined;
      try {
        const uri = vscode.Uri.parse(this.activeDocUri);
        targetDoc = await vscode.workspace.openTextDocument(uri);
      } catch (err) {
        console.log('[Controller] Failed to open document:', err);
        return;
      }
      
      const docUuid = getDocUuidForDocument(targetDoc); 
      if (!docUuid) {
        console.log('[Controller] No docUuid for document');
        return;
      }
      console.log('[Controller] Updating message with docUuid:', docUuid);
      const updated = await updateThreadsByDoc(docUuid, (threads) => {
        const thread = threads.find(t => t.id === msg.threadId);
        if (thread && thread.messages) {
          const message = thread.messages.find(m => m.id === msg.messageId);
          if (message) {
            console.log('[Controller] Found message, updating body from:', message.body, 'to:', msg.body);
            message.body = msg.body;
            thread.updatedAt = Date.now();
          } else {
            console.log('[Controller] Message not found:', msg.messageId);
          }
        } else {
          console.log('[Controller] Thread not found or no messages:', thread);
        }
      });
      const key = targetDoc.uri.toString(); 
      this.threadsByDoc.set(key, updated);
      console.log('[Controller] Updated threadsByDoc for key:', key);
      
      // 更新定义跳转提供器的线程数据
      if (this.definitionProvider) {
        this.definitionProvider.updateThreads(key, updated);
      }
      
      this.applyDecorations(targetDoc); 
      this.postThreads(targetDoc, updated);
      console.log('[Controller] editMessage processing completed');
      return;
    }
    if (msg.type === 'delete' && typeof msg.id === 'string') {
      const ed = vscode.window.activeTextEditor; if (!ed) return; const docUuid = getDocUuidForDocument(ed.document); if (!docUuid) return;
      const updated = await updateThreadsByDoc(docUuid, (threads) => {
        const i = threads.findIndex(t => t.id === msg.id); if (i >= 0) threads.splice(i, 1);
      });
      const key = ed.document.uri.toString(); this.threadsByDoc.set(key, updated);
      
      // 更新定义跳转提供器的线程数据
      if (this.definitionProvider) {
        this.definitionProvider.updateThreads(key, updated);
      }
      this.applyDecorations(ed.document); this.postThreads(ed.document, updated);
      return;
    }
    if (msg.type === 'toggleStatus' && typeof msg.id === 'string') {
      const ed = vscode.window.activeTextEditor; if (!ed) return; const docUuid = getDocUuidForDocument(ed.document); if (!docUuid) return;
      const updated = await updateThreadsByDoc(docUuid, (threads) => {
        const it = threads.find(t => t.id === msg.id); if (it) { it.status = (it.status === 'open' ? 'resolved' : 'open'); it.updatedAt = Date.now(); }
      });
      const key = ed.document.uri.toString(); this.threadsByDoc.set(key, updated);
      
      // 更新定义跳转提供器的线程数据
      if (this.definitionProvider) {
        this.definitionProvider.updateThreads(key, updated);
      }
      
      this.applyDecorations(ed.document); this.postThreads(ed.document, updated);
      return;
    }
    // Webview 主动滚动：按比例 reveal 到对应顶部行
    if (msg.type === 'panelScroll') {
      const ed = vscode.window.activeTextEditor; if (!ed) return;
      const doc = ed.document; if (!this.isSupportedDoc(doc)) return;
      const vr = ed.visibleRanges[0];
      const vis = vr ? Math.max(1, vr.end.line - vr.start.line) : 1;
      const total = doc.lineCount;
      const beyond = this.getScrollBeyondLastLine(ed);
      const maxTop = this.computeMaxTop(total, vis, beyond);
      const clamped = Math.max(0, Math.min(1, Number(msg.ratio) || 0));
      const targetTop = Math.round(clamped * maxTop);
      const line = Math.min(Math.max(0, targetTop), Math.max(0, total - 1));
      ed.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.AtTop);
      return;
    }
  }
}
