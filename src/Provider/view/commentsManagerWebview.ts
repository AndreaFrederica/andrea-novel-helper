import * as vscode from 'vscode';
import * as path from 'path';
import {
    listAllCommentDocUuids,
    loadComments,
    updateThreadStatus,
    updateThreadTags,
} from '../../comments/storage';
import { CommentStatus, CommentThreadData } from '../../comments/types';
import { getFileByUuidAsync } from '../../utils/tracker/globalFileTracking';

type CommentManagerMessage =
    | { command: 'commentsManager.ready' }
    | { command: 'commentsManager.refresh' }
    | { command: 'commentsManager.updateTags'; threadId?: unknown; tags?: unknown }
    | { command: 'commentsManager.updateStatus'; threadId?: unknown; status?: unknown }
    | { command: 'commentsManager.jumpToComment'; threadId?: unknown; docUuid?: unknown; line?: unknown };

type FlatCommentThread = {
    id: string;
    docUuid: string;
    filePath: string;
    relativePath: string;
    line: number;
    status: CommentStatus;
    createdAt: number;
    updatedAt: number;
    tags: string[];
    messages: Array<{
        id: string;
        author: string;
        body: string;
        createdAt: number;
    }>;
};

export class CommentsManagerWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'andrea.commentsManagerView';
    private view?: vscode.WebviewView;

    constructor(private readonly extensionUri: vscode.Uri) { }

    public resolveWebviewView(webviewView: vscode.WebviewView): void {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.extensionUri, 'media'),
            ],
        };

        webviewView.webview.html = this.renderHtml(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(message => {
            void this.handleMessage(message as CommentManagerMessage);
        });
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                void this.postData();
            }
        });
        webviewView.onDidDispose(() => {
            if (this.view === webviewView) {
                this.view = undefined;
            }
        });
    }

    private renderHtml(webview: vscode.Webview): string {
        const nonce = String(Math.random()).slice(2);
        return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: blob:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <style>
    :root{color-scheme:dark light}
    body{margin:0;height:100vh;overflow:hidden;background:var(--vscode-sideBar-background);color:var(--vscode-sideBar-foreground);font:12px/1.5 var(--vscode-font-family, system-ui, sans-serif)}
    *{box-sizing:border-box}
    .app{height:100vh;display:flex;flex-direction:column;min-width:0}
    .toolbar{display:grid;grid-template-columns:minmax(120px,1fr) 88px 104px 104px 30px;gap:6px;align-items:center;padding:8px;border-bottom:1px solid var(--vscode-sideBar-border, rgba(127,127,127,.25))}
    input,select,button{font:inherit;color:inherit}
    input,select{min-width:0;height:28px;border:1px solid var(--vscode-input-border, rgba(127,127,127,.35));border-radius:4px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);padding:0 7px}
    button{border:0;background:transparent;color:inherit;cursor:pointer;border-radius:4px}
    button:hover{background:var(--vscode-list-hoverBackground, rgba(127,127,127,.14))}
    .icon-btn{width:28px;height:28px;display:grid;place-items:center}
    .mode{display:grid;grid-template-columns:1fr 1fr;height:28px;border:1px solid var(--vscode-input-border, rgba(127,127,127,.35));border-radius:4px;overflow:hidden}
    .mode button{border-radius:0}
    .mode button.active{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
    .content{flex:1;overflow:auto;padding:8px}
    .notice{padding:18px 8px;text-align:center;color:var(--vscode-descriptionForeground)}
    .notice.error{color:var(--vscode-errorForeground)}
    .doc-group{border-bottom:1px solid var(--vscode-sideBar-border, rgba(127,127,127,.18))}
    .doc-header{width:100%;min-height:34px;display:grid;grid-template-columns:18px 18px minmax(0,1fr) auto;gap:6px;align-items:center;padding:6px 2px;text-align:left}
    .doc-title,.path{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700}
    .doc-count,.meta{color:var(--vscode-descriptionForeground);font-size:11px;white-space:nowrap}
    .doc-comments{padding-left:22px}
    .comment-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(140px,34%);gap:10px;padding:10px 0;border-bottom:1px solid var(--vscode-sideBar-border, rgba(127,127,127,.14))}
    .comment-row.resolved{opacity:.65}
    .row-main,.row-side{min-width:0}
    .row-title{display:flex;align-items:center;gap:4px;min-width:0;flex-wrap:wrap}
    .chip{display:inline-flex;align-items:center;min-height:18px;padding:0 6px;border-radius:3px;border:1px solid var(--vscode-badge-background);font-size:11px;line-height:18px}
    .chip.open{background:rgba(245,158,11,.16);border-color:rgba(245,158,11,.5)}
    .chip.resolved{background:rgba(34,197,94,.14);border-color:rgba(34,197,94,.45)}
    .chip.tag{background:transparent;color:var(--vscode-textLink-foreground);border-color:var(--vscode-textLink-foreground)}
    .meta{margin-top:4px}
    .message{margin-top:6px;white-space:pre-wrap;word-break:break-word}
    .tag-editor{width:100%;height:28px}
    .actions{display:flex;justify-content:flex-end;gap:4px;margin-top:6px}
    .small-btn{height:24px;min-width:24px;padding:0 7px;border:1px solid var(--vscode-button-border, transparent);background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
    @media(max-width:560px){.toolbar{grid-template-columns:1fr 78px 30px}.tag-filter,.mode{grid-column:span 1}.comment-row{grid-template-columns:1fr}.doc-comments{padding-left:12px}}
  </style>
</head>
<body>
  <div class="app">
    <div class="toolbar">
      <input id="search" placeholder="搜索批注、文件或标签">
      <select id="status">
        <option value="all">全部</option>
        <option value="open">未解决</option>
        <option value="resolved">已解决</option>
      </select>
      <select id="tag" class="tag-filter"><option value="">全部标签</option></select>
      <div class="mode">
        <button id="modeGrouped" class="active" type="button">文档</button>
        <button id="modeFlat" type="button">扁平</button>
      </div>
      <button id="refresh" class="icon-btn" type="button" title="刷新">↻</button>
    </div>
    <main id="content" class="content"><div class="notice">加载批注...</div></main>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const state = { comments: [], tags: [], query: '', status: 'all', tag: '', mode: 'grouped', collapsed: new Set(), loading: true, error: '' };
    const el = {
      search: document.getElementById('search'),
      status: document.getElementById('status'),
      tag: document.getElementById('tag'),
      content: document.getElementById('content'),
      refresh: document.getElementById('refresh'),
      grouped: document.getElementById('modeGrouped'),
      flat: document.getElementById('modeFlat')
    };
    function post(message){ vscode.postMessage(message); }
    function escapeHtml(value){ return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
    function normalizeTags(value){ return Array.isArray(value) ? Array.from(new Set(value.map(v => String(v || '').trim()).filter(Boolean))).sort((a,b)=>a.localeCompare(b,'zh-CN')) : []; }
    function normalizeComment(comment){
      return { ...comment, tags: normalizeTags(comment.tags), messages: Array.isArray(comment.messages) ? comment.messages : [], line: Math.max(0, Number(comment.line) || 0), status: comment.status === 'resolved' ? 'resolved' : 'open' };
    }
    function formatDate(value){ const n = Number(value); return Number.isFinite(n) && n > 0 ? new Date(n).toLocaleString() : ''; }
    function preview(comment){ const body = String(comment.messages?.[0]?.body || '').trim(); return body ? (body.length > 160 ? body.slice(0,157) + '...' : body) : '无批注内容'; }
    function filtered(){
      const q = state.query.trim().toLowerCase();
      return state.comments.filter(comment => {
        if (state.status !== 'all' && comment.status !== state.status) return false;
        if (state.tag && !comment.tags.includes(state.tag)) return false;
        if (!q) return true;
        const haystack = [comment.relativePath, comment.filePath, comment.docUuid, ...comment.tags, ...comment.messages.flatMap(m => [m.author, m.body])].join('\\n').toLowerCase();
        return haystack.includes(q);
      });
    }
    function groupedRows(rows){
      const map = new Map();
      for (const comment of rows) {
        const key = comment.docUuid || comment.filePath || comment.relativePath;
        const group = map.get(key) || { key, title: comment.relativePath || comment.filePath || comment.docUuid, filePath: comment.filePath, comments: [], total: 0, openCount: 0 };
        group.comments.push(comment); group.total += 1; if (comment.status === 'open') group.openCount += 1; map.set(key, group);
      }
      return Array.from(map.values()).sort((a,b) => b.openCount - a.openCount || a.title.localeCompare(b.title, 'zh-CN'));
    }
    function updateTagOptions(){
      el.tag.innerHTML = '<option value="">全部标签</option>' + state.tags.map(tag => '<option value="' + escapeHtml(tag) + '">' + escapeHtml(tag) + '</option>').join('');
      el.tag.value = state.tag;
    }
    function renderComment(comment, showPath){
      return '<article class="comment-row ' + (comment.status === 'resolved' ? 'resolved' : '') + '" data-id="' + escapeHtml(comment.id) + '">' +
        '<div class="row-main"><div class="row-title">' +
        '<span class="chip ' + (comment.status === 'resolved' ? 'resolved' : 'open') + '">' + (comment.status === 'resolved' ? '已解决' : '未解决') + '</span>' +
        comment.tags.map(tag => '<span class="chip tag">' + escapeHtml(tag) + '</span>').join('') +
        (showPath ? '<span class="path" title="' + escapeHtml(comment.filePath || comment.docUuid) + '">' + escapeHtml(comment.relativePath) + '</span>' : '') +
        '</div><div class="meta">第 ' + (comment.line + 1) + ' 行 · ' + escapeHtml(formatDate(comment.updatedAt || comment.createdAt)) + '</div>' +
        '<div class="message">' + escapeHtml(preview(comment)) + '</div></div>' +
        '<div class="row-side"><input class="tag-editor" data-action="tags" value="' + escapeHtml(comment.tags.join(', ')) + '" placeholder="标签，逗号分隔">' +
        '<div class="actions"><button class="small-btn" data-action="jump" type="button">跳转</button><button class="small-btn" data-action="status" type="button">' + (comment.status === 'resolved' ? '重开' : '解决') + '</button></div></div></article>';
    }
    function render(){
      el.grouped.classList.toggle('active', state.mode === 'grouped');
      el.flat.classList.toggle('active', state.mode === 'flat');
      if (state.error) { el.content.innerHTML = '<div class="notice error">' + escapeHtml(state.error) + '</div>'; return; }
      if (state.loading) { el.content.innerHTML = '<div class="notice">加载批注...</div>'; return; }
      const rows = filtered();
      if (!rows.length) { el.content.innerHTML = '<div class="notice">没有匹配的批注</div>'; return; }
      if (state.mode === 'flat') { el.content.innerHTML = rows.map(row => renderComment(row, true)).join(''); bindRows(); return; }
      el.content.innerHTML = groupedRows(rows).map(group => {
        const collapsed = state.collapsed.has(group.key);
        return '<section class="doc-group" data-group="' + escapeHtml(group.key) + '">' +
          '<button class="doc-header" data-action="toggle-group" type="button"><span>' + (collapsed ? '›' : '⌄') + '</span><span>▤</span><span class="doc-title" title="' + escapeHtml(group.filePath || group.key) + '">' + escapeHtml(group.title) + '</span><span class="doc-count">' + group.openCount + '/' + group.total + ' 未解决</span></button>' +
          (collapsed ? '' : '<div class="doc-comments">' + group.comments.map(row => renderComment(row, false)).join('') + '</div>') +
          '</section>';
      }).join('');
      bindRows();
    }
    function findComment(node){ const row = node.closest('.comment-row'); return row ? state.comments.find(item => item.id === row.dataset.id) : undefined; }
    function bindRows(){
      el.content.querySelectorAll('[data-action="toggle-group"]').forEach(btn => btn.addEventListener('click', () => {
        const key = btn.closest('.doc-group')?.dataset.group; if (!key) return;
        state.collapsed.has(key) ? state.collapsed.delete(key) : state.collapsed.add(key); render();
      }));
      el.content.querySelectorAll('[data-action="jump"]').forEach(btn => btn.addEventListener('click', () => {
        const comment = findComment(btn); if (comment) post({ command:'commentsManager.jumpToComment', threadId:comment.id, docUuid:comment.docUuid, line:comment.line });
      }));
      el.content.querySelectorAll('[data-action="status"]').forEach(btn => btn.addEventListener('click', () => {
        const comment = findComment(btn); if (!comment) return; const status = comment.status === 'resolved' ? 'open' : 'resolved'; comment.status = status; post({ command:'commentsManager.updateStatus', threadId:comment.id, status }); render();
      }));
      el.content.querySelectorAll('[data-action="tags"]').forEach(input => input.addEventListener('change', () => {
        const comment = findComment(input); if (!comment) return; const tags = normalizeTags(input.value.split(',')); comment.tags = tags; state.tags = normalizeTags([...state.tags, ...tags]); updateTagOptions(); post({ command:'commentsManager.updateTags', threadId:comment.id, tags }); render();
      }));
    }
    el.search.addEventListener('input', () => { state.query = el.search.value; render(); });
    el.status.addEventListener('change', () => { state.status = el.status.value; render(); });
    el.tag.addEventListener('change', () => { state.tag = el.tag.value; render(); });
    el.grouped.addEventListener('click', () => { state.mode = 'grouped'; render(); });
    el.flat.addEventListener('click', () => { state.mode = 'flat'; render(); });
    el.refresh.addEventListener('click', () => { state.loading = true; render(); post({ command:'commentsManager.refresh' }); });
    window.addEventListener('message', event => {
      const message = event.data;
      if (message?.command === 'commentsManager.data') {
        state.comments = Array.isArray(message.comments) ? message.comments.map(normalizeComment) : [];
        state.tags = normalizeTags(message.tags);
        state.error = ''; state.loading = false; updateTagOptions(); render(); return;
      }
      if (message?.command === 'commentsManager.error') {
        state.error = message.message || '加载批注失败'; state.loading = false; render();
      }
    });
    window.addEventListener('error', event => { state.error = event.message || '批注总览脚本错误'; state.loading = false; render(); });
    post({ command:'commentsManager.ready' });
  </script>
</body>
</html>`;
    }

    private async handleMessage(message: CommentManagerMessage): Promise<void> {
        switch (message?.command) {
            case 'commentsManager.ready':
            case 'commentsManager.refresh':
                await this.postData();
                break;
            case 'commentsManager.updateTags':
                await this.updateTags(message.threadId, message.tags);
                break;
            case 'commentsManager.updateStatus':
                await this.updateStatus(message.threadId, message.status);
                break;
            case 'commentsManager.jumpToComment':
                await this.jumpToComment(message);
                break;
        }
    }

    private async updateTags(threadId: unknown, value: unknown): Promise<void> {
        if (typeof threadId !== 'string') { return; }
        await updateThreadTags(threadId, normalizeTags(value));
        await this.postData();
    }

    private async updateStatus(threadId: unknown, value: unknown): Promise<void> {
        if (typeof threadId !== 'string') { return; }
        const status = value === 'resolved' ? 'resolved' : value === 'open' ? 'open' : undefined;
        if (!status) { return; }
        await updateThreadStatus(threadId, status);
        await this.postData();
    }

    private async jumpToComment(message: Extract<CommentManagerMessage, { command: 'commentsManager.jumpToComment' }>): Promise<void> {
        const docUuid = typeof message.docUuid === 'string' ? message.docUuid : '';
        if (!docUuid) { return; }
        const meta = await getFileByUuidAsync(docUuid).catch(() => undefined);
        if (!meta?.filePath) {
            vscode.window.showWarningMessage('无法定位批注文档，文件追踪数据中没有对应路径。');
            return;
        }

        const line = Math.max(0, Number(message.line) || 0);
        const uri = vscode.Uri.file(meta.filePath);
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.Active);
        const target = new vscode.Position(Math.min(line, Math.max(0, doc.lineCount - 1)), 0);
        editor.selection = new vscode.Selection(target, target);
        editor.revealRange(new vscode.Range(target, target), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }

    private async postData(): Promise<void> {
        if (!this.view) { return; }
        try {
            const comments = await loadFlatComments();
            await this.view.webview.postMessage({
                command: 'commentsManager.data',
                comments,
                tags: collectAllTags(comments),
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await this.view.webview.postMessage({ command: 'commentsManager.error', message });
        }
    }
}

export function registerCommentsManagerWebview(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new CommentsManagerWebviewProvider(context.extensionUri);
    const disposable = vscode.window.registerWebviewViewProvider(CommentsManagerWebviewProvider.viewType, provider);
    context.subscriptions.push(disposable);
    return disposable;
}

async function loadFlatComments(): Promise<FlatCommentThread[]> {
    const docUuids = listAllCommentDocUuids();
    const rows: FlatCommentThread[] = [];

    for (const docUuid of docUuids) {
        const [threads, fileMeta] = await Promise.all([
            loadComments(docUuid).catch(() => []),
            getFileByUuidAsync(docUuid).catch(() => undefined),
        ]);
        for (const thread of threads) {
            rows.push(toFlatComment(thread, fileMeta?.filePath || ''));
        }
    }

    return rows.sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
}

function toFlatComment(thread: CommentThreadData, filePath: string): FlatCommentThread {
    const firstRange = thread.anchor?.ranges?.[0];
    const line = Math.max(0, Number(firstRange?.start?.line) || 0);
    return {
        id: thread.id,
        docUuid: thread.docUuid,
        filePath,
        relativePath: getRelativePath(filePath, thread.docUuid),
        line,
        status: thread.status,
        createdAt: Number(thread.createdAt) || 0,
        updatedAt: Number(thread.updatedAt) || Number(thread.createdAt) || 0,
        tags: normalizeTags(thread.tags),
        messages: Array.isArray(thread.messages) ? thread.messages.map(message => ({
            id: message.id,
            author: message.author,
            body: message.body,
            createdAt: Number(message.createdAt) || 0,
        })) : [],
    };
}

function getRelativePath(filePath: string, fallback: string): string {
    if (!filePath) {
        return fallback;
    }
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        return path.basename(filePath);
    }
    const relative = path.relative(workspaceRoot, filePath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        return path.basename(filePath);
    }
    return relative.replace(/\\/g, '/');
}

function normalizeTags(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return Array.from(new Set(
        value
            .map(item => typeof item === 'string' ? item.trim() : '')
            .filter(Boolean)
    ));
}

function collectAllTags(comments: FlatCommentThread[]): string[] {
    return Array.from(new Set(comments.flatMap(comment => comment.tags))).sort((a, b) => a.localeCompare(b, 'zh-CN'));
}
