/* eslint-disable curly */
import * as vscode from 'vscode';
import * as path from 'path';
import { CommentThreadData, rangeToVSCodeRange } from './types';
import { addThread, addSingleThread, getDocUuidForDocument, loadComments, paragraphIndexOfRange, updateThreadsByDoc, loadCommentContent, saveCommentContent, garbageCollectDeletedComments, restoreDeletedThread, deleteThread } from './storage';
import { registerCommentDefinitionProvider, CommentDefinitionProvider } from './definitionProvider';
import { setActiveCommentPanel } from '../context/commentRedirect';

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

export class CommentsController {
  private panel: vscode.WebviewPanel | undefined;
  private sidebarView?: vscode.WebviewView;
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
  private scrollDebounceTimeout?: NodeJS.Timeout;
  private lastScrollSent?: { docUri: string; topLine: number; timestamp: number };
  private lastRevealedLine?: { docUri: string; line: number; timestamp: number }; // 缓存最后reveal的行
  private editorHasFocus: boolean = true; // 默认编辑器有焦点
  private lastEditorInteraction: number = Date.now();
  private focusCheckInterval?: NodeJS.Timeout;
  private suppressEditorToPanelUntil?: number; // 面板驱动reveal后，抑制编辑器->面板滚动上报的时间点（时间戳）

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
        if (!this.hasAnyHost()) return; if (!e.textEditor.document) return; if (this.activeDocUri !== e.textEditor.document.uri.toString()) return;
        this.postEditorScroll(e.textEditor.document);
      }),
      vscode.window.onDidChangeActiveTextEditor(ed => {
        if (!ed?.document) return;
        if (!this.isSupportedDoc(ed.document)) return;
        // 编辑器焦点变化时更新状态
        this.editorHasFocus = true;
        this.lastEditorInteraction = Date.now();
        // 始终为当前文档确保加载装饰
        this.ensureCommentsLoaded(ed.document);
        // 若面板存在，同步绑定
        if (this.hasAnyHost()) { this.bindToDoc(ed.document); }
      }),
      // 监听编辑器选择变化（光标移动、文本选择等）
      vscode.window.onDidChangeTextEditorSelection(e => {
        this.editorHasFocus = true;
        this.lastEditorInteraction = Date.now();
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

  dispose() {
    this.disposables.forEach(d => d.dispose());
    this.sidebarView = undefined;
    this.panel = undefined;
    setActiveCommentPanel(undefined);
    this.disposeDecorations();
    commentDiagnosticCollection.dispose();
  }

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
      // 跳过已软删除的批注
      if ((thread as any).deleted) {
        continue;
      }
      
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

  private getWebviews(): vscode.Webview[] {
    const views: vscode.Webview[] = [];
    if (this.panel) views.push(this.panel.webview);
    if (this.sidebarView) views.push(this.sidebarView.webview);
    return views;
  }

  private hasAnyHost(): boolean {
    return this.panel !== undefined || this.sidebarView !== undefined;
  }

  private postMessage(message: any) {
    for (const webview of this.getWebviews()) {
      try { webview.postMessage(message); } catch { /* ignore */ }
    }
  }

  private ensurePanel(): vscode.WebviewPanel {
    if (this.panel) {
      if (this.activeDocUri) {
        setActiveCommentPanel(this.activeDocUri);
      }
      return this.panel;
    }
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
    this.initializePanel(panel);
    return panel;
  }

  private initializePanel(panel: vscode.WebviewPanel) {
    panel.iconPath = {
      light: vscode.Uri.joinPath(this.context.extensionUri, 'images', 'comments_light.svg'),
      dark: vscode.Uri.joinPath(this.context.extensionUri, 'images', 'comments_dark.svg'),
    };
    panel.onDidDispose(() => {
      if (this.panel === panel) {
        this.panel = undefined;
        if (!this.sidebarView) {
          setActiveCommentPanel(undefined);
        }
      }
    }, null, this.disposables);
    panel.onDidChangeViewState(e => {
      if (e.webviewPanel.active) {
        if (this.activeDocUri) {
          setActiveCommentPanel(this.activeDocUri);
        }
      } else if (!this.sidebarView) {
        setActiveCommentPanel(undefined);
      }
    }, null, this.disposables);
    panel.webview.onDidReceiveMessage(msg => this.onMessage(msg));
    panel.webview.html = this.wrapHtml(panel.webview);
    this.panel = panel;
    if (this.activeDocUri) {
      setActiveCommentPanel(this.activeDocUri);
    }
  }

  public async attachSidebarView(view: vscode.WebviewView) {
    this.sidebarView = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
      retainContextWhenHidden: true,
    } as any;
    view.webview.onDidReceiveMessage(msg => this.onMessage(msg));
    view.onDidDispose(() => {
      if (this.sidebarView === view) {
        this.sidebarView = undefined;
        if (!this.panel) {
          setActiveCommentPanel(undefined);
        }
      }
    });
    view.onDidChangeVisibility(() => {
      if (view.visible) {
        if (this.activeDocUri) {
          setActiveCommentPanel(this.activeDocUri);
        }
        this.refreshCurrentHost();
      } else if (!this.panel) {
        setActiveCommentPanel(undefined);
      }
    });
    view.webview.html = this.wrapHtml(view.webview);
    if (view.visible && this.activeDocUri) {
      setActiveCommentPanel(this.activeDocUri);
    }

    const targetDoc = await this.pickDocument();
    if (targetDoc) {
      await this.bindToDoc(targetDoc);
    } else {
      const disposable = vscode.window.onDidChangeActiveTextEditor(async editor => {
        if (editor && this.isSupportedDoc(editor.document)) {
          await this.bindToDoc(editor.document);
          disposable.dispose();
        }
      });
      setTimeout(() => disposable.dispose(), 5000);
    }
  }

  private async deserialize(panel: vscode.WebviewPanel, state: any) {
    // Re-setup panel and bind saved doc
    panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')], retainContextWhenHidden: true } as any;
    this.initializePanel(panel);

    // Resolve doc to bind
    const saved = state && typeof state.docUri === 'string' ? state.docUri : undefined;
    let targetDoc = await this.pickDocument(saved);

    if (targetDoc) {
      await this.bindToDoc(targetDoc);
    } else {
      const disposable = vscode.window.onDidChangeActiveTextEditor(async (editor) => {
        if (editor && this.isSupportedDoc(editor.document)) {
          await this.bindToDoc(editor.document);
          disposable.dispose();
        }
      });
      setTimeout(() => disposable.dispose(), 5000);
    }
  }


  private async refreshCurrentHost() {
    if (!this.hasAnyHost()) { return; }
    if (!this.activeDocUri) {
      return;
    }
    try {
      const uri = vscode.Uri.parse(this.activeDocUri);
      const doc = await vscode.workspace.openTextDocument(uri);
      if (!this.isSupportedDoc(doc)) { return; }
      const threads = this.threadsByDoc.get(doc.uri.toString()) || [];
      this.postInit(doc, threads);
    } catch { /* ignore */ }
  }
  private wrapHtml(webview: vscode.Webview): string {
    const nonce = String(Math.random()).slice(2);
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'comments.js'));
    const style = `body{margin:0;padding:0;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font:13px/1.6 system-ui,-apple-system,'Segoe UI',Roboto,Arial;overflow:hidden;height:100vh}
      .toolbar{display:flex;gap:8px;align-items:center;padding:8px;border-bottom:1px solid #0002;background:inherit;z-index:10;flex-shrink:0}
      .toolbar input[type=text]{flex:1;min-width:120px;padding:4px 6px;border-radius:6px;border:1px solid #5557;background:#0003;color:inherit}
      .toolbar select{padding:4px 6px;border-radius:6px;border:1px solid #5557;background:#0003;color:inherit}
      .toolbar-btn{padding:4px 8px;border-radius:6px;border:1px solid #5557;background:var(--vscode-button-background);color:var(--vscode-button-foreground);cursor:pointer;font-size:12px;white-space:nowrap}
      .toolbar-btn:hover{background:var(--vscode-button-hoverBackground)}
      .toolbar-btn:active{background:var(--vscode-button-activeBackground)}
      .root{position:relative;flex:1;overflow-y:auto;overflow-x:hidden}
      .track{position:relative;margin:0;min-height:100%;padding:0 8px;box-sizing:border-box}
      .card{position:absolute;left:8px;right:8px;min-width:220px;max-width:calc(100% - 16px);padding:10px 12px;border-radius:8px;border:1px solid var(--vscode-editorWidget-border);
            background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); box-shadow: 0 2px 6px rgba(0,0,0,.12);box-sizing:border-box}
      .card .actions{display:flex;flex-wrap:wrap;gap:8px}
      .vbtn{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:1px solid var(--vscode-button-border);border-radius:6px;padding:4px 10px;cursor:pointer}
      .vbtn:hover{background:var(--vscode-button-hoverBackground)}
      .card[data-status="resolved"]{opacity:.6}
      .empty{padding:16px;color:#888}
      .header{display:flex;align-items:center;gap:6px;font-weight:600;margin-bottom:4px}
      .caret{cursor:pointer;user-select:none;opacity:.9}
      .meta{opacity:.8;font-size:12px;margin-bottom:6px}
      .messages-container{margin-bottom:6px}
      .message{border-left:3px solid var(--vscode-editorWidget-border);padding-left:8px;margin-bottom:6px}
      .message:last-child{margin-bottom:0}
      .message-header{font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:4px}
      .message-body{line-height:1.5;word-wrap:break-word}
      .message-body code{background:var(--vscode-textCodeBlock-background);padding:2px 4px;border-radius:3px;font-size:12px}
      .message-body strong{font-weight:600}
      .message-body em{font-style:italic}
      .message-body del{text-decoration:line-through;opacity:0.7}
      .reply{margin-top:6px}
      textarea{width:100%;min-height:48px;background:#0003;border:1px solid #5557;border-radius:6px;color:inherit;padding:6px;box-sizing:border-box;resize:vertical}
      .card.collapsed .messages-container,.card.collapsed .actions,.card.collapsed .reply{display:none}
      .card.collapsed{padding:6px 8px}
    `;
    return `<!doctype html><html><head>
      <meta charset="UTF-8"/><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}';">
      <style>${style}</style></head>
      <body style="display:flex;flex-direction:column">
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

  private async openForActiveEditor() {
    const ed = vscode.window.activeTextEditor;
    if (!ed || !this.isSupportedDoc(ed.document)) { vscode.window.showInformationMessage('请选择 Markdown/纯文本文件'); return; }
    const panel = this.ensurePanel();
    await this.bindToDoc(ed.document);
    panel.reveal(undefined, true);
  }

  private async bindPanelToDoc(doc: vscode.TextDocument) {
    this.ensurePanel();
    await this.bindToDoc(doc);
  }

  private async bindToDoc(doc: vscode.TextDocument) {
    if (!this.isSupportedDoc(doc)) return;
    this.activeDocUri = doc.uri.toString();
    // 设置活跃批注面板状态（无论面板是否当前活跃）
    setActiveCommentPanel(this.activeDocUri);
    try { await this.context.workspaceState.update(CommentsController.STATE_KEY, this.activeDocUri); } catch {}
    
    const docUuid = getDocUuidForDocument(doc);
    const data = docUuid ? await loadComments(docUuid) : [];
    
    this.threadsByDoc.set(doc.uri.toString(), data);
    this.postInit(doc, data);
    this.applyDecorations(doc);
    this.postEditorScroll(doc);
  }

  private async pickDocument(preferred?: string): Promise<vscode.TextDocument | undefined> {
    const candidates: string[] = [];
    if (this.activeDocUri) candidates.push(this.activeDocUri);
    if (preferred) candidates.push(preferred);
    const stored = this.context.workspaceState.get<string>(CommentsController.STATE_KEY);
    if (stored) candidates.push(stored);

    for (const cand of candidates) {
      if (!cand) continue;
      try {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(cand));
        if (this.isSupportedDoc(doc)) return doc;
      } catch { /* ignore */ }
    }

    const editorDoc = vscode.window.activeTextEditor?.document;
    if (editorDoc && this.isSupportedDoc(editorDoc)) {
      return editorDoc;
    }
    return undefined;
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
    
    // 支持多范围装饰，过滤掉已软删除的批注
    const decoOpts: vscode.DecorationOptions[] = [];
    for (const t of list.filter(t => t.status === 'open' && !(t as any).deleted)) {
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

    // Gutter info markers，过滤掉已软删除的批注
    const showGutter = cfg.get<boolean>('showGutterInfo', true);
    if (this.decorationGutter) {
      if (showGutter) {
        const gopts: vscode.DecorationOptions[] = list
          .filter(t => !(t as any).deleted)
          .map(t => ({
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
    if (!this.hasAnyHost()) return;
    this.postMessage({ type: 'init', docUri: doc.uri.toString() });
    this.postThreads(doc, threads);
    this.postEditorScroll(doc);
  }

  private postThreads(doc: vscode.TextDocument, threads: CommentThreadData[]) {
    if (!this.hasAnyHost()) return;
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
    this.postMessage({ type: 'threads', lineHeight: metrics.lineHeight, items, totalLines: doc.lineCount, topPad: metrics.topPad || 0 });
  }

  private debouncedPostEditorScroll(doc: vscode.TextDocument, topLine: number) {
    const docUri = doc.uri.toString();
    const now = Date.now();
    
    // 优化防抖逻辑：减少延迟，提高响应性
    const shouldDebounce = this.lastScrollSent && 
      this.lastScrollSent.docUri === docUri && 
      Math.abs(this.lastScrollSent.topLine - topLine) < 2 && // 减少阈值，更精确的滚动
      (now - this.lastScrollSent.timestamp) < 100; // 减少到100ms内的连续滚动
    
    if (this.scrollDebounceTimeout) {
      clearTimeout(this.scrollDebounceTimeout);
    }
    
    const doScroll = () => {
      this.postEditorScroll(doc);
      this.lastScrollSent = { docUri, topLine, timestamp: Date.now() };
    };
    
    if (shouldDebounce) {
      // 防抖：减少延迟（从100ms减少到30ms）
      this.scrollDebounceTimeout = setTimeout(doScroll, 0);
    } else {
      // 立即发送
      doScroll();
    }
  }

  private postEditorScroll(doc: vscode.TextDocument) {
    if (!this.hasAnyHost()) return;

    // 在面板驱动的 reveal 窗口内，抑制编辑器 -> 面板的滚动上报，避免回环导致“抽搐”
    if (this.suppressEditorToPanelUntil && Date.now() < this.suppressEditorToPanelUntil) {
      console.log('Skipping editor->panel scroll: suppressed until', this.suppressEditorToPanelUntil);
      return;
    }
    
    // 焦点感知：仅在编辑器有焦点或最近交互时上报；
    // 同时允许在极短时间（<150ms）内的 reveal 后补一次上报用于对齐
    const hasRecentInteraction = Date.now() - this.lastEditorInteraction < 3000; // 放宽到3秒
    const revealRecent = !!(this.lastRevealedLine && (Date.now() - this.lastRevealedLine.timestamp) < 150);
    const shouldSync = this.editorHasFocus || hasRecentInteraction || revealRecent;
    
    if (!shouldSync) return;
    
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
    console.log('Sending editor scroll:', { ratio, top, docUri: doc.uri.toString() });
    this.postMessage({ type: 'editorScroll', ratio, meta: { top, maxTop, total, visibleApprox: vis, beyond }, lineHeight: metrics.lineHeight });
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
    if (this.hasAnyHost() && this.activeDocUri !== docUri) { this.bindToDoc(doc); }
    // 滚动同步（若面板已开且顶行变化）
    const vr = ed.visibleRanges[0];
    const top = vr ? vr.start.line : 0;
    if (this.hasAnyHost()) {
      const changed = (!this.lastTick || this.lastTick.docUri !== docUri || this.lastTick.topLine !== top);
      if (changed) { this.debouncedPostEditorScroll(doc, top); }
    }
    this.lastTick = { docUri, topLine: top };
  }

  private async relinkAllAnchors(doc: vscode.TextDocument) {
    const key = doc.uri.toString();
    const list = this.threadsByDoc.get(key); if (!list || list.length === 0) return;
    const text = doc.getText();
    const updated: CommentThreadData[] = [];
    const deletions: string[] = [];
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper.comments');
    const strictRelink = cfg.get<boolean>('relink.strict', true);
    const cleanupMode = cfg.get<'delete-thread'|'delete-range'|'mark-resolved'|'none'>('cleanup.mode', 'delete-thread');
    const DIST_LIMIT = 2000;
    
    for (const t of list) {
      const newRanges: { start: { line: number; ch: number }; end: { line: number; ch: number } }[] = [];
      const newSelTexts: string[] = [];
      const newContexts: { before: string; after: string }[] = [];
      const newParas: { startIndex: number; endIndex: number }[] = [];
      
      // 处理每个范围的重定位
      for (let i = 0; i < t.anchor.ranges.length; i++) {
        const range = t.anchor.ranges[i];
        const selText = t.anchor.selTexts[i];
        const context = t.anchor.contexts[i];
        const para = t.anchor.para?.[i];
        const prevStart = doc.offsetAt(new vscode.Position(range.start.line, range.start.ch));

        let accepted = false;
        let startPos: vscode.Position | undefined;
        let endPos: vscode.Position | undefined;

        if (selText && text.indexOf(selText) !== -1) {
          const exact = this.findBestOccurrence(text, selText, prevStart);
          if (exact !== undefined) {
            const distOk = Math.abs(exact - prevStart) <= DIST_LIMIT;
            const beforeRaw = String(context?.before || '').slice(-24);
            const afterRaw = String(context?.after || '').slice(0, 24);
            const ctxOk = (() => {
              const from = Math.max(0, exact - 64);
              const to = Math.min(text.length, exact + selText.length + 64);
              const windowText = text.slice(from, to);
              const b = beforeRaw ? windowText.includes(beforeRaw) : true;
              const a = afterRaw ? windowText.includes(afterRaw) : true;
              return b && a;
            })();
            if (!strictRelink || distOk || ctxOk) {
              const s = doc.positionAt(exact);
              const e = doc.positionAt(exact + selText.length);
              startPos = s; endPos = e; accepted = true;
            }
          }
        }

        if (!accepted) {
          const ctxPos = this.rebindByContextMulti(text, selText, context, prevStart);
          if (ctxPos !== undefined) {
            const s = doc.positionAt(ctxPos);
            const e = doc.positionAt(Math.min(text.length, ctxPos + Math.max(1, selText.length)));
            startPos = s; endPos = e; accepted = true;
          }
        }

        if (!accepted) {
          if (!strictRelink) {
            if (para && typeof para.startIndex === 'number') {
              const approx = this.approxStartOfParagraph(doc, para.startIndex);
              const s = approx;
              const e = doc.positionAt(Math.min(text.length, doc.offsetAt(s) + Math.max(1, selText.length)));
              startPos = s; endPos = e; accepted = true;
            }
          }
        }

        if (accepted && startPos && endPos) {
          newRanges.push({ start: { line: startPos.line, ch: startPos.character }, end: { line: endPos.line, ch: endPos.character } });
          newSelTexts.push(selText);
          newContexts.push(context);
          newParas.push(paragraphIndexOfRange(doc, new vscode.Selection(startPos, endPos)));
        }
      }
      
      if (newRanges.length === 0) {
        if (cleanupMode === 'delete-thread') {
          deletions.push(t.id);
        } else if (cleanupMode === 'mark-resolved') {
          t.status = 'resolved';
          t.updatedAt = Date.now();
          updated.push(t);
        } else if (cleanupMode === 'delete-range') {
          t.anchor.ranges = [];
          t.anchor.selTexts = [];
          t.anchor.contexts = [];
          t.anchor.para = [] as any;
          t.updatedAt = Date.now();
          updated.push(t);
        } else {
          t.updatedAt = Date.now();
          updated.push(t);
        }
      } else {
        t.anchor.ranges = newRanges;
        t.anchor.selTexts = newSelTexts;
        t.anchor.contexts = newContexts;
        t.anchor.para = newParas;
        t.updatedAt = Date.now();
        updated.push(t);
      }
    }
    const docUuid = getDocUuidForDocument(doc);
    if (docUuid) {
      for (const id of deletions) { try { await deleteThread(id); } catch { } }
      const finalList = await updateThreadsByDoc(docUuid, (threads: CommentThreadData[]) => {
        for (const it of threads) {
          const newer = updated.find(u => u.id === it.id);
          if (newer) {
            it.status = newer.status;
            it.updatedAt = newer.updatedAt;
            it.messages = newer.messages;
            it.anchor = newer.anchor;
          }
        }
      });
      this.threadsByDoc.set(key, finalList);
    } else {
      this.threadsByDoc.set(key, updated);
    }
    this.applyDecorations(doc);
    const postList = this.threadsByDoc.get(key) || updated;
    this.postThreads(doc, postList);
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
      console.log('[Controller] Processing delete:', { threadId: msg.id });
      
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
      
      console.log('[Controller] Deleting thread with docUuid:', docUuid);
      
      // 执行软删除操作
      await deleteThread(msg.id);
      
      // 重新加载批注列表以反映软删除状态
      const updated = await loadComments(docUuid);
      
      const key = targetDoc.uri.toString();
      this.threadsByDoc.set(key, updated);
      console.log('[Controller] Updated threadsByDoc for key:', key);
      
      // 更新定义跳转提供器的线程数据
      if (this.definitionProvider) {
        this.definitionProvider.updateThreads(key, updated);
      }
      
      this.applyDecorations(targetDoc);
      this.postThreads(targetDoc, updated);
      console.log('[Controller] delete processing completed');
      return;
    }
    if (msg.type === 'toggleStatus' && typeof msg.id === 'string') {
      console.log('[Controller] Processing toggleStatus:', { threadId: msg.id });
      
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
      
      console.log('[Controller] Toggling status for thread with docUuid:', docUuid);
      const updated = await updateThreadsByDoc(docUuid, (threads) => {
        const it = threads.find(t => t.id === msg.id);
        if (it) {
          const oldStatus = it.status;
          it.status = (it.status === 'open' ? 'resolved' : 'open');
          it.updatedAt = Date.now();
          console.log('[Controller] Status changed from', oldStatus, 'to', it.status);
        } else {
          console.log('[Controller] Thread not found for status toggle:', msg.id);
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
      console.log('[Controller] toggleStatus processing completed');
      return;
    }
    // Webview 主动滚动：按比例 reveal 到对应顶部行
    if (msg.type === 'panelScroll') {
      // 优先使用绑定的文档（当焦点在面板上时，activeTextEditor 可能为 undefined）
      let ed = vscode.window.activeTextEditor as vscode.TextEditor | undefined;
      let doc: vscode.TextDocument | undefined;

      if (this.activeDocUri) {
        try {
          doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(this.activeDocUri));
        } catch (err) {
          console.log('[Controller] Failed to open activeDocUri for panelScroll:', err);
        }
      }
      if (!doc && ed) {
        doc = ed.document;
      }
      if (!doc) {
        console.log('[Controller] No target document for panelScroll');
        return;
      }
      if (!this.isSupportedDoc(doc)) return;

      // 如果当前活动编辑器不匹配目标文档，尝试在可见编辑器中查找
      if (!ed || ed.document.uri.toString() !== doc.uri.toString()) {
        const visible = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === doc!.uri.toString());
        if (visible) {
          ed = visible;
        } else {
          // 打开但不抢占焦点
          try {
            ed = await vscode.window.showTextDocument(doc, { preserveFocus: true, preview: true });
          } catch (err) {
            console.log('[Controller] showTextDocument failed for panelScroll:', err);
            return;
          }
        }
      }
      
      // 焦点感知：检查面板焦点状态和编辑器焦点状态
      const panelHasFocus = msg.panelHasFocus || false;
      const panelRecentInteraction = msg.lastInteraction && (Date.now() - msg.lastInteraction < 3000); // 放宽到3秒
      const editorRecentInteraction = Date.now() - this.lastEditorInteraction < 3000; // 放宽到3秒
      
      // 优先级判断：面板有焦点或最近交互 > 编辑器最近交互
      const panelShouldControl = panelHasFocus || panelRecentInteraction;
      const editorShouldControl = this.editorHasFocus || editorRecentInteraction;
      
      console.log('Panel scroll priority check:', {
        panelHasFocus,
        panelRecentInteraction,
        editorRecentInteraction,
        panelShouldControl,
        editorShouldControl,
        editorHasFocus: this.editorHasFocus
      });
      
      // 若面板近期有交互，则允许面板主导；仅在编辑器显式聚焦且面板完全无交互时才跳过
      if (this.editorHasFocus && !panelShouldControl && !panelRecentInteraction) {
        console.log('Skipping panel scroll - editor has explicit focus and panel has no recent interaction');
        return;
      }
      
      // 清除任何待处理的编辑器滚动防抖
      if (this.scrollDebounceTimeout) {
        clearTimeout(this.scrollDebounceTimeout);
        this.scrollDebounceTimeout = undefined;
      }
      
      const vr = ed.visibleRanges[0];
      const vis = vr ? Math.max(1, vr.end.line - vr.start.line) : 1;
      const total = doc.lineCount;
      const beyond = this.getScrollBeyondLastLine(ed);
      const maxTop = this.computeMaxTop(total, vis, beyond);
      const clamped = Math.max(0, Math.min(1, Number(msg.ratio) || 0));
      const targetTop = Math.round(clamped * maxTop);
      const line = Math.min(Math.max(0, targetTop), Math.max(0, total - 1));
      
      console.log('Panel scroll received:', { ratio: msg.ratio, targetLine: line, currentTop: vr?.start.line });
      
      // 检查是否需要滚动（避免不必要的操作）
      const currentTop = vr?.start.line || 0;
      const scrollThreshold = 1; // 缩小阈值到1行，提升连续性，减少跳变
      const docUri = doc.uri.toString();
      const now = Date.now();
      
      // 检查是否刚刚reveal过相同的行（避免重复操作）
      const recentlyRevealed = this.lastRevealedLine && 
        this.lastRevealedLine.docUri === docUri && 
        Math.abs(this.lastRevealedLine.line - line) <= 1 && 
        (now - this.lastRevealedLine.timestamp) < 100;
      
      if (recentlyRevealed) {
        console.log('Skipping scroll - recently revealed similar line:', { line, lastRevealed: this.lastRevealedLine?.line });
        return;
      }
      
      if (Math.abs(currentTop - line) > scrollThreshold) {
        // 暂时禁用心跳检测，避免立即触发反向同步
        const originalLastTick = this.lastTick;
        this.lastTick = { docUri, topLine: line };
        
        // 使用更智能的reveal策略
        const lineDiff = Math.abs(currentTop - line);
        let revealType: vscode.TextEditorRevealType;
        
        if (lineDiff > vis * 2) {
          // 仅在非常大的跨越时使用 AtTop，避免顶部“吸附感”
          revealType = vscode.TextEditorRevealType.AtTop;
        } else {
          // 其他情况尽量使用 InCenterIfOutsideViewport，减少来回小幅修正
          revealType = vscode.TextEditorRevealType.InCenterIfOutsideViewport;
        }
        
        ed.revealRange(new vscode.Range(line, 0, line, 0), revealType);
        
        // 记录reveal操作
        this.lastRevealedLine = { docUri, line, timestamp: now };
        
        // 移除延迟，立即恢复心跳检测
        setTimeout(() => {
          if (this.lastTick && this.lastTick.topLine === line) {
            // 如果位置没有再次改变，保持当前状态
          } else {
            this.lastTick = originalLastTick;
          }
        }, 0);
      } else {
        console.log('Skipping scroll - target line within threshold:', { currentTop, targetLine: line, threshold: scrollThreshold });
      }
      
      return;
    }
    
    // 垃圾回收命令：清理已删除的批注
    if (msg.type === 'garbageCollect') {
      console.log('[Controller] Processing garbageCollect');
      
      if (!this.activeDocUri) {
        console.log('[Controller] No active document URI for garbage collection');
        return;
      }
      
      let targetDoc: vscode.TextDocument | undefined;
      try {
        const uri = vscode.Uri.parse(this.activeDocUri);
        targetDoc = await vscode.workspace.openTextDocument(uri);
      } catch (err) {
        console.log('[Controller] Failed to open document for garbage collection:', err);
        return;
      }
      
      const docUuid = getDocUuidForDocument(targetDoc);
      if (!docUuid) {
        console.log('[Controller] No docUuid for document in garbage collection');
        return;
      }
      
      try {
        const result = await garbageCollectDeletedComments(docUuid);
        console.log('[Controller] Garbage collection completed:', result);
        
        // 刷新批注列表
        const updated = await loadComments(docUuid);
        const key = targetDoc.uri.toString();
        this.threadsByDoc.set(key, updated);
        
        if (this.definitionProvider) {
          this.definitionProvider.updateThreads(key, updated);
        }
        
        this.applyDecorations(targetDoc);
        this.postThreads(targetDoc, updated);
        
        // 向面板发送垃圾回收结果
        this.postMessage({
          type: 'garbageCollectResult',
          deletedCount: result.deletedCount,
          commentIds: result.commentIds
        });
      } catch (err) {
        console.error('[Controller] Garbage collection failed:', err);
      }
      
      return;
    }
    
    // 恢复已删除的批注
    if (msg.type === 'restoreComment' && typeof msg.id === 'string') {
      console.log('[Controller] Processing restoreComment:', { id: msg.id });
      
      try {
        const success = await restoreDeletedThread(msg.id);
        console.log('[Controller] Restore comment result:', success);
        
        if (success && this.activeDocUri) {
          // 刷新批注列表
          const uri = vscode.Uri.parse(this.activeDocUri);
          const targetDoc = await vscode.workspace.openTextDocument(uri);
          const docUuid = getDocUuidForDocument(targetDoc);
          
          if (docUuid) {
            const updated = await loadComments(docUuid);
            const key = targetDoc.uri.toString();
            this.threadsByDoc.set(key, updated);
            
            if (this.definitionProvider) {
              this.definitionProvider.updateThreads(key, updated);
            }
            
            this.applyDecorations(targetDoc);
            this.postThreads(targetDoc, updated);
          }
        }
        
        // 向面板发送恢复结果
        this.postMessage({
          type: 'restoreCommentResult',
          success,
          commentId: msg.id
        });
      } catch (err) {
        console.error('[Controller] Restore comment failed:', err);
      }
      
      return;
    }
  }
}
