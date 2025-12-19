import * as vscode from 'vscode';
import { getConfig } from './proxyLanguageEditorConfig';

const SCHEME = 'andrea-proxy';

type PositionPayload = { line: number; character: number };

type WebviewMessage =
    | { type: 'sync'; text: string; version: number }
    | { type: 'setLanguage'; languageId: string }
    | { type: 'hover'; requestId: string; version: number } & PositionPayload
    | { type: 'completion'; requestId: string; version: number; triggerCharacter?: string } & PositionPayload
    | { type: 'definition'; requestId: string; version: number } & PositionPayload
    | { type: 'symbols'; requestId: string; version: number }
    | { type: 'semanticTokens'; requestId: string; version: number }
    | { type: 'diagnostics'; requestId: string; version: number };

type WebviewResponse =
    | { type: 'init'; text: string; version: number; languageId: string }
    | { type: 'externalSync'; text: string; version: number }
    | { type: 'languageChanged'; languageId: string }
    | { type: 'hoverResult'; requestId: string; version: number; hovers: SerializedHover[] }
    | { type: 'completionResult'; requestId: string; version: number; items: SerializedCompletionItem[] }
    | { type: 'definitionResult'; requestId: string; version: number; locations: Array<SerializedLocation | SerializedLocationLink> }
    | { type: 'symbolsResult'; requestId: string; version: number; symbols: SerializedSymbolResult }
    | { type: 'semanticTokensResult'; requestId: string; version: number; tokens: SerializedSemanticTokens | null }
    | { type: 'diagnosticsResult'; requestId: string; version: number; diagnostics: SerializedDiagnostic[] }
    | { type: 'diagnosticsUpdate'; version: number; diagnostics: SerializedDiagnostic[] }
    | { type: 'error'; requestId?: string; version?: number; message: string };

type SerializedRange = {
    start: PositionPayload;
    end: PositionPayload;
};

type SerializedHover = {
    contents: string;
    range?: SerializedRange;
};

type SerializedCompletionItem = {
    label: string;
    kind?: number;
    detail?: string;
    documentation?: string;
    sortText?: string;
    filterText?: string;
    insertText?: string;
};

type SerializedLocation = {
    uri: string;
    range: SerializedRange;
};

type SerializedLocationLink = {
    targetUri: string;
    targetRange: SerializedRange;
    targetSelectionRange?: SerializedRange;
    originSelectionRange?: SerializedRange;
};

type SerializedDocumentSymbol = {
    name: string;
    kind: number;
    range: SerializedRange;
    selectionRange: SerializedRange;
    children?: SerializedDocumentSymbol[];
};

type SerializedSymbolInformation = {
    name: string;
    kind: number;
    location: SerializedLocation;
    containerName?: string;
};

type SerializedSymbolResult =
    | { kind: 'document'; symbols: SerializedDocumentSymbol[] }
    | { kind: 'information'; symbols: SerializedSymbolInformation[] };

type SerializedSemanticTokens = {
    resultId?: string;
    data: number[];
};

type SerializedDiagnostic = {
    message: string;
    severity: number;
    range: SerializedRange;
    source?: string;
    code?: string | number;
};

class VirtualDocProvider implements vscode.TextDocumentContentProvider {
    private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    public readonly onDidChange = this.onDidChangeEmitter.event;
    private readonly contentByUri = new Map<string, string>();

    public setContent(uri: vscode.Uri, text: string): void {
        this.contentByUri.set(uri.toString(), text);
        this.onDidChangeEmitter.fire(uri);
    }

    public provideTextDocumentContent(uri: vscode.Uri): string {
        return this.contentByUri.get(uri.toString()) ?? '';
    }
}

export class ProxyLanguageEditorProvider implements vscode.CustomTextEditorProvider, vscode.Disposable {
    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new ProxyLanguageEditorProvider(context);
        const reg = vscode.window.registerCustomEditorProvider(
            'andrea.proxyLanguageEditor',
            provider,
            {
                webviewOptions: { retainContextWhenHidden: true },
                supportsMultipleEditorsPerDocument: false,
            }
        );
        const vdocReg = vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider.vdocProvider);
        return vscode.Disposable.from(reg, vdocReg, provider);
    }

    private readonly ctx: vscode.ExtensionContext;
    private readonly vdocProvider = new VirtualDocProvider();
    private readonly panelByDoc = new Map<string, vscode.WebviewPanel>();
    private readonly vdocByDoc = new Map<string, vscode.Uri>();
    private readonly docByVdoc = new Map<string, string>();
    private readonly lastVersionByDoc = new Map<string, number>();
    private readonly languageByDoc = new Map<string, string>();
    private readonly skipNextDocChange = new Set<string>();
    private readonly semanticTokenTimers = new Map<string, NodeJS.Timeout>();
    private readonly diagSub: vscode.Disposable;
    
    // 配置选项：是否使用真实文件 URI 进行语言服务查询
    private useRealFileUri: boolean = true;

    constructor(ctx: vscode.ExtensionContext) {
        this.ctx = ctx;
        this.diagSub = vscode.languages.onDidChangeDiagnostics((e) => this.onDiagnosticsChanged(e));
        
        // 从配置中读取设置
        const config = getConfig();
        this.useRealFileUri = config.useRealFileUri;
        
        // 监听配置变化
        const configWatcher = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('andrea.proxyLanguageEditor.useRealFileUri')) {
                const newConfig = getConfig();
                const oldUseRealFileUri = this.useRealFileUri;
                this.useRealFileUri = newConfig.useRealFileUri;
                
                // 如果切换到真实文件 URI 模式，同步所有打开的编辑器
                if (newConfig.useRealFileUri && !oldUseRealFileUri) {
                    this.syncAllOpenEditorsToRealFile();
                }
            }
        });
        ctx.subscriptions.push(configWatcher);
    }
    
    private syncAllOpenEditorsToRealFile(): void {
        for (const [docKey, panel] of this.panelByDoc.entries()) {
            const vdocUri = this.vdocByDoc.get(docKey);
            if (vdocUri) {
                const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === docKey);
                if (document) {
                    const documentText = document.getText();
                    this.vdocProvider.setContent(vdocUri, documentText);
                }
            }
        }
    }

    public dispose(): void {
        this.diagSub.dispose();
    }

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        panel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        panel.webview.options = {
            enableScripts: true,
        };

        panel.webview.html = this.getHtml(panel.webview);

        const docKey = document.uri.toString();
        this.panelByDoc.set(docKey, panel);

        const langId = this.languageByDoc.get(docKey) ?? document.languageId ?? 'plaintext';
        this.languageByDoc.set(docKey, langId);

        const vdocUri = this.getOrCreateVdocUri(document.uri);
        const documentText = document.getText();
        
        // 确保虚拟文档有正确的内容
        this.vdocProvider.setContent(vdocUri, documentText);
        await this.ensureVdocOpenAndLanguage(vdocUri, langId);

        const version = this.lastVersionByDoc.get(docKey) ?? 1;
        this.lastVersionByDoc.set(docKey, version);
        
        // 等待更长时间确保虚拟文档完全初始化
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // 确保在发送消息前，虚拟文档已经设置了正确的内容
        try {
            this.post(panel, { type: 'init', text: documentText, version, languageId: langId });
            // 在真实文件模式下，使用真实文件 URI 进行语义标记查询
            this.scheduleSemanticTokens(docKey, this.useRealFileUri ? document.uri : vdocUri, panel);
        } catch (e) {
            console.error('Error posting init message:', e);
            // 延迟重试
            setTimeout(() => {
                try {
                    this.post(panel, { type: 'init', text: documentText, version, languageId: langId });
                    this.scheduleSemanticTokens(docKey, this.useRealFileUri ? document.uri : vdocUri, panel);
                } catch (retryError) {
                    console.error('Error retrying init message:', retryError);
                }
            }, 100);
        }

        const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
            if (e.document.uri.toString() !== docKey) return;
            if (this.skipNextDocChange.delete(docKey)) return;

            const nextText = e.document.getText();
            // 始终保持虚拟文档与真实文件同步
            this.vdocProvider.setContent(vdocUri, nextText);

            const nextVersion = (this.lastVersionByDoc.get(docKey) ?? 1) + 1;
            this.lastVersionByDoc.set(docKey, nextVersion);
            this.post(panel, { type: 'externalSync', text: nextText, version: nextVersion });
            this.scheduleSemanticTokens(docKey, document.uri, panel);
        });

        const messageSub = panel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
            if (!msg || typeof msg.type !== 'string') return;
            try {
                await this.handleMessage(document, panel, vdocUri, msg);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                this.post(panel, { type: 'error', message });
            }
        });

        panel.onDidDispose(() => {
            changeSub.dispose();
            messageSub.dispose();
            this.panelByDoc.delete(docKey);
            this.vdocByDoc.delete(docKey);
            const vdocKey = vdocUri.toString();
            this.docByVdoc.delete(vdocKey);
            this.lastVersionByDoc.delete(docKey);
            this.languageByDoc.delete(docKey);
            this.skipNextDocChange.delete(docKey);
            const timer = this.semanticTokenTimers.get(docKey);
            if (timer) clearTimeout(timer);
            this.semanticTokenTimers.delete(docKey);
        });
    }

    private async handleMessage(
        document: vscode.TextDocument,
        panel: vscode.WebviewPanel,
        vdocUri: vscode.Uri,
        msg: WebviewMessage
    ): Promise<void> {
        const docKey = document.uri.toString();
        const currentVersion = this.lastVersionByDoc.get(docKey) ?? 1;
        
        // 根据配置决定使用哪个 URI
        const targetUri = this.useRealFileUri ? document.uri : vdocUri;

        switch (msg.type) {
            case 'sync': {
                if (msg.version < currentVersion) return;
                this.lastVersionByDoc.set(docKey, msg.version);
                this.vdocProvider.setContent(vdocUri, msg.text);
                await this.applyDocumentText(document, msg.text);
                this.scheduleSemanticTokens(docKey, targetUri, panel);
                return;
            }
            case 'setLanguage': {
                const languageId = msg.languageId.trim() || 'plaintext';
                this.languageByDoc.set(docKey, languageId);
                await this.ensureVdocOpenAndLanguage(vdocUri, languageId);
                this.post(panel, { type: 'languageChanged', languageId });
                return;
            }
            case 'hover': {
                // 检查版本是否过期
                if (msg.version < currentVersion) return;
                
                const pos = new vscode.Position(msg.line, msg.character);
                const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
                    'vscode.executeHoverProvider',
                    targetUri,
                    pos
                );
                const payload: WebviewResponse = {
                    type: 'hoverResult',
                    requestId: msg.requestId,
                    version: msg.version,
                    hovers: serializeHovers(hovers ?? []),
                };
                this.post(panel, payload);
                return;
            }
            case 'completion': {
                // 检查版本是否过期
                if (msg.version < currentVersion) return;
                
                const pos = new vscode.Position(msg.line, msg.character);
                const list = await vscode.commands.executeCommand<vscode.CompletionList>(
                    'vscode.executeCompletionItemProvider',
                    targetUri,
                    pos,
                    msg.triggerCharacter
                );
                const items = list?.items ?? [];
                const payload: WebviewResponse = {
                    type: 'completionResult',
                    requestId: msg.requestId,
                    version: msg.version,
                    items: serializeCompletions(items),
                };
                this.post(panel, payload);
                return;
            }
            case 'definition': {
                // 检查版本是否过期
                if (msg.version < currentVersion) return;
                
                const pos = new vscode.Position(msg.line, msg.character);
                const defs = await vscode.commands.executeCommand<
                    vscode.Location | vscode.Location[] | vscode.LocationLink[]
                >('vscode.executeDefinitionProvider', targetUri, pos);
                const locations = serializeDefinitions(defs);
                const payload: WebviewResponse = {
                    type: 'definitionResult',
                    requestId: msg.requestId,
                    version: msg.version,
                    locations,
                };
                this.post(panel, payload);
                return;
            }
            case 'symbols': {
                // 检查版本是否过期
                if (msg.version < currentVersion) return;
                
                const symbols = await vscode.commands.executeCommand<
                    Array<vscode.DocumentSymbol | vscode.SymbolInformation>
                >('vscode.executeDocumentSymbolProvider', targetUri);
                const payload: WebviewResponse = {
                    type: 'symbolsResult',
                    requestId: msg.requestId,
                    version: msg.version,
                    symbols: serializeSymbols(symbols ?? []),
                };
                this.post(panel, payload);
                return;
            }
            case 'semanticTokens': {
                // 检查版本是否过期
                if (msg.version < currentVersion) return;
                
                const tokens = await vscode.commands.executeCommand<vscode.SemanticTokens>(
                    'vscode.executeDocumentSemanticTokensProvider',
                    targetUri
                );
                const payload: WebviewResponse = {
                    type: 'semanticTokensResult',
                    requestId: msg.requestId,
                    version: msg.version,
                    tokens: serializeSemanticTokens(tokens),
                };
                this.post(panel, payload);
                return;
            }
            case 'diagnostics': {
                // 检查版本是否过期
                if (msg.version < currentVersion) return;
                
                const diagnostics = vscode.languages.getDiagnostics(targetUri);
                const payload: WebviewResponse = {
                    type: 'diagnosticsResult',
                    requestId: msg.requestId,
                    version: msg.version,
                    diagnostics: serializeDiagnostics(diagnostics),
                };
                this.post(panel, payload);
                return;
            }
            default:
                return;
        }
    }

    private getOrCreateVdocUri(docUri: vscode.Uri): vscode.Uri {
        const key = docUri.toString();
        const existing = this.vdocByDoc.get(key);
        if (existing) return existing;
        
        // 保留原始扩展名：/virtual/<hash>/name.ext
        const path = docUri.path;
        const fileName = path.split('/').pop() || 'virtual.txt';
        const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
        
        const vdocUri = vscode.Uri.from({
            scheme: SCHEME,
            path: `/virtual/${safeName}`,
            query: encodeURIComponent(key), // 用 query 保存真实 doc key
        });
        
        this.vdocByDoc.set(key, vdocUri);
        this.docByVdoc.set(vdocUri.toString(), key);
        return vdocUri;
    }

    private async ensureVdocOpenAndLanguage(uri: vscode.Uri, languageId: string): Promise<vscode.TextDocument> {
        const doc = await vscode.workspace.openTextDocument(uri);
        if (doc.languageId !== languageId) {
            return await vscode.languages.setTextDocumentLanguage(doc, languageId);
        }
        return doc;
    }

    private async applyDocumentText(document: vscode.TextDocument, text: string): Promise<void> {
        if (document.getText() === text) return;
        const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(document.getText().length)
        );
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, fullRange, text);
        this.skipNextDocChange.add(document.uri.toString());
        await vscode.workspace.applyEdit(edit);
    }

    private scheduleSemanticTokens(docKey: string, documentUri: vscode.Uri, panel: vscode.WebviewPanel): void {
        const existing = this.semanticTokenTimers.get(docKey);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(async () => {
            this.semanticTokenTimers.delete(docKey);
            try {
                const tokens = await vscode.commands.executeCommand<vscode.SemanticTokens>(
                    'vscode.executeDocumentSemanticTokensProvider',
                    documentUri
                );
                const version = this.lastVersionByDoc.get(docKey) ?? 1;
                this.post(panel, {
                    type: 'semanticTokensResult',
                    requestId: 'auto',
                    version,
                    tokens: serializeSemanticTokens(tokens),
                });
            } catch {
                // ignore
            }
        }, 200);
        this.semanticTokenTimers.set(docKey, timer);
    }

    private onDiagnosticsChanged(e: vscode.DiagnosticChangeEvent): void {
        for (const uri of e.uris) {
            // 检查是否是真实文档的 URI
            if (uri.scheme === SCHEME) continue;
            
            const docKey = uri.toString();
            const panel = this.panelByDoc.get(docKey);
            if (!panel) continue;
            
            const diagnostics = vscode.languages.getDiagnostics(uri);
            const version = this.lastVersionByDoc.get(docKey) ?? 1;
            this.post(panel, {
                type: 'diagnosticsUpdate',
                version,
                diagnostics: serializeDiagnostics(diagnostics),
            });
        }
    }

    private post(panel: vscode.WebviewPanel, msg: WebviewResponse): void {
        try {
            void panel.webview.postMessage(msg);
        } catch {
            // ignore
        }
    }

    private getHtml(webview: vscode.Webview): string {
        const nonce = getNonce();
        const csp = [
            `default-src 'none'`,
            `style-src ${webview.cspSource} 'unsafe-inline'`,
            `script-src 'nonce-${nonce}'`,
            `connect-src ${webview.cspSource}`,
        ].join('; ');

        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Proxy Language Editor</title>
  <style>
    :root {
      --bg: #0f1115;
      --panel: #171a21;
      --border: #2a2f3a;
      --text: #e6e6e6;
      --muted: #9aa4b2;
      --accent: #5ad1a6;
      --accent-2: #4aa3ff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Segoe UI, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .toolbar {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
      background: var(--panel);
      flex-wrap: wrap;
    }
    .toolbar label { color: var(--muted); }
    .toolbar input, .toolbar button {
      height: 28px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: #10131a;
      color: var(--text);
      padding: 0 8px;
    }
    .toolbar button {
      cursor: pointer;
      background: #1d222b;
    }
    .toolbar button.primary {
      border-color: var(--accent);
      color: var(--accent);
    }
    .toolbar button.secondary {
      border-color: var(--accent-2);
      color: var(--accent-2);
    }
    .content {
      display: flex;
      flex: 1;
      min-height: 0;
    }
    #editor {
      flex: 1;
      resize: none;
      border: none;
      outline: none;
      padding: 12px;
      font-family: Consolas, 'Courier New', monospace;
      font-size: 13px;
      background: #0c0f14;
      color: var(--text);
      line-height: 1.45;
    }
    .side {
      width: 38%;
      border-left: 1px solid var(--border);
      background: #0b0e13;
      display: flex;
      flex-direction: column;
    }
    .status {
      padding: 8px 10px;
      border-bottom: 1px solid var(--border);
      color: var(--muted);
      font-size: 12px;
    }
    .debug {
      overflow: auto;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      flex: 1;
    }
    .block {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: #10131a;
      overflow: hidden;
    }
    .block header {
      padding: 6px 10px;
      border-bottom: 1px solid var(--border);
      font-size: 12px;
      color: var(--muted);
      display: flex;
      justify-content: space-between;
      gap: 8px;
    }
    .block pre {
      margin: 0;
      padding: 8px 10px;
      white-space: pre-wrap;
      font-family: Consolas, 'Courier New', monospace;
      font-size: 12px;
      line-height: 1.4;
      color: #cfd8e3;
      max-height: 220px;
      overflow: auto;
    }
    @media (max-width: 900px) {
      .content { flex-direction: column; }
      .side { width: 100%; border-left: none; border-top: 1px solid var(--border); height: 40%; }
      #editor { height: 60%; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <label for="languageId">Language ID</label>
    <input id="languageId" type="text" spellcheck="false" value="plaintext" />
    <button id="applyLang" class="primary">Apply</button>
    <button id="hoverBtn">Hover</button>
    <button id="completionBtn">Completion</button>
    <button id="definitionBtn">Definition</button>
    <button id="symbolsBtn">Symbols</button>
    <button id="tokensBtn" class="secondary">Semantic Tokens</button>
    <button id="diagnosticsBtn">Diagnostics</button>
  </div>
  <div class="content">
    <textarea id="editor" spellcheck="false"></textarea>
    <div class="side">
      <div class="status" id="status">Waiting for init...</div>
      <div class="debug">
        <section class="block">
          <header><span>Hover</span><span id="hoverCount">0</span></header>
          <pre id="hoverOutput">No hover data yet.</pre>
        </section>
        <section class="block">
          <header><span>Semantic Tokens</span><span id="tokensCount">0</span></header>
          <pre id="tokensOutput">No semantic tokens yet.</pre>
        </section>
        <section class="block">
          <header><span>Diagnostics</span><span id="diagnosticsCount">0</span></header>
          <pre id="diagnosticsOutput">No diagnostics yet.</pre>
        </section>
        <section class="block">
          <header><span>Other</span><span id="otherCount">0</span></header>
          <pre id="otherOutput">No extra payloads yet.</pre>
        </section>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    const editor = document.getElementById('editor');
    const hoverOutput = document.getElementById('hoverOutput');
    const hoverCount = document.getElementById('hoverCount');
    const tokensOutput = document.getElementById('tokensOutput');
    const tokensCount = document.getElementById('tokensCount');
    const diagnosticsOutput = document.getElementById('diagnosticsOutput');
    const diagnosticsCount = document.getElementById('diagnosticsCount');
    const otherOutput = document.getElementById('otherOutput');
    const otherCount = document.getElementById('otherCount');
    const status = document.getElementById('status');
    const languageInput = document.getElementById('languageId');

    let version = 1;
    let isApplyingExternal = false;
    let syncTimer = null;

    function logOther(title, payload) {
      const header = title ? title + '\\n' : '';
      try {
        otherOutput.textContent = header + JSON.stringify(payload, null, 2);
        otherCount.textContent = Array.isArray(payload) ? String(payload.length) : '1';
      } catch (e) {
        console.error('Error logging other payload:', e);
        otherOutput.textContent = header + 'Error serializing payload';
        otherCount.textContent = '0';
      }
    }

    function rangeToString(r) {
      if (!r || !r.start || !r.end) return '';
      return '[' + (r.start.line + 1) + ':' + (r.start.character + 1) + ' - ' + (r.end.line + 1) + ':' + (r.end.character + 1) + ']';
    }

    function renderHovers(hovers) {
      if (!Array.isArray(hovers) || hovers.length === 0) {
        hoverOutput.textContent = 'No hover data.';
        hoverCount.textContent = '0';
        return;
      }
      const lines = hovers.map((h, idx) => {
        const range = h.range ? rangeToString(h.range) : '';
        const prefix = range ? 'Range ' + range + '\\n' : '';
        return 'Hover #' + (idx + 1) + '\\n' + prefix + String(h.contents || '').trim();
      });
      try {
        hoverOutput.textContent = lines.join('\\n\\n');
        hoverCount.textContent = String(hovers.length);
      } catch (e) {
        console.error('Error rendering hovers:', e);
        hoverOutput.textContent = 'Error rendering hovers';
        hoverCount.textContent = '0';
      }
      hoverCount.textContent = String(hovers.length);
    }

    function renderTokens(tokens) {
      if (!tokens || !Array.isArray(tokens.data) || tokens.data.length === 0) {
        tokensOutput.textContent = 'No semantic tokens.';
        tokensCount.textContent = '0';
        return;
      }
      const count = Math.floor(tokens.data.length / 5);
      const previewCount = Math.min(count, 20);
      const preview = tokens.data.slice(0, previewCount * 5);
      try {
        tokensOutput.textContent =
          'Tokens: ' + count + '\\n' +
          'ResultId: ' + (tokens.resultId || '-') + '\\n' +
          'Preview (' + previewCount + '):\\n' + preview.join(', ');
        tokensCount.textContent = String(count);
      } catch (e) {
        console.error('Error rendering tokens:', e);
        tokensOutput.textContent = 'Error rendering tokens';
        tokensCount.textContent = '0';
      }
    }

    function severityLabel(sev) {
      switch (sev) {
        case 0: return 'Error';
        case 1: return 'Warning';
        case 2: return 'Info';
        case 3: return 'Hint';
        default: return String(sev);
      }
    }

    function renderDiagnostics(diags) {
      if (!Array.isArray(diags) || diags.length === 0) {
        diagnosticsOutput.textContent = 'No diagnostics.';
        diagnosticsCount.textContent = '0';
        return;
      }
      const lines = diags.map((d, idx) => {
        const sev = severityLabel(d.severity);
        const range = rangeToString(d.range);
        const src = d.source ? ' (' + d.source + ')' : '';
        const code = d.code !== undefined ? ' code=' + d.code : '';
        return '#' + (idx + 1) + ' ' + sev + src + ' ' + range + code + '\\n' + String(d.message || '').trim();
      });
      try {
        diagnosticsOutput.textContent = lines.join('\\n\\n');
        diagnosticsCount.textContent = String(diags.length);
      } catch (e) {
        console.error('Error rendering diagnostics:', e);
        diagnosticsOutput.textContent = 'Error rendering diagnostics';
        diagnosticsCount.textContent = '0';
      }
    }

    function updateStatus(extra) {
      const pos = getCursorPosition();
      status.textContent = 'v' + version + ' | line ' + (pos.line + 1) + ', col ' + (pos.character + 1) + (extra ? ' | ' + extra : '');
    }

    function scheduleSync() {
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        vscode.postMessage({ type: 'sync', text: editor.value, version });
      }, 120);
    }

    function getCursorPosition() {
      const index = editor.selectionStart || 0;
      const text = editor.value;
      let line = 0;
      let lastLineStart = 0;
      for (let i = 0; i < index; i++) {
        if (text.charCodeAt(i) === 10) {
          line++;
          lastLineStart = i + 1;
        }
      }
      return { line, character: index - lastLineStart };
    }

    function newRequestId() {
      return Math.random().toString(36).slice(2);
    }

    function sendWithPosition(type) {
      const pos = getCursorPosition();
      const requestId = newRequestId();
      
      // 对于 completion，检查触发字符
      if (type === 'completion') {
        const text = editor.value;
        const index = editor.selectionStart || 0;
        let triggerChar = undefined;
        
        // 检查光标前的字符是否是常见的触发字符
        if (index > 0) {
          const charBefore = text.charAt(index - 1);
          if (['.', ':', '(', '[', '"', "'", '/', '@', '#', ' ', '\n'].includes(charBefore)) {
            triggerChar = charBefore;
          }
        }
        
        vscode.postMessage({
          type,
          requestId,
          version,
          line: pos.line,
          character: pos.character,
          triggerCharacter: triggerChar
        });
      } else {
        vscode.postMessage({ type, requestId, version, line: pos.line, character: pos.character });
      }
      
      updateStatus('sent ' + type);
    }

    function sendSimple(type) {
      const requestId = newRequestId();
      vscode.postMessage({ type, requestId, version });
      updateStatus('sent ' + type);
    }

    editor.addEventListener('input', () => {
      if (isApplyingExternal) return;
      version += 1;
      scheduleSync();
      updateStatus('editing');
    });

    editor.addEventListener('click', () => updateStatus());
    editor.addEventListener('keyup', () => updateStatus());

    document.getElementById('applyLang').addEventListener('click', () => {
      const lang = languageInput.value.trim() || 'plaintext';
      vscode.postMessage({ type: 'setLanguage', languageId: lang });
      updateStatus('set language');
    });

    document.getElementById('hoverBtn').addEventListener('click', () => sendWithPosition('hover'));
    document.getElementById('completionBtn').addEventListener('click', () => sendWithPosition('completion'));
    document.getElementById('definitionBtn').addEventListener('click', () => sendWithPosition('definition'));
    document.getElementById('symbolsBtn').addEventListener('click', () => sendSimple('symbols'));
    document.getElementById('tokensBtn').addEventListener('click', () => sendSimple('semanticTokens'));
    document.getElementById('diagnosticsBtn').addEventListener('click', () => sendSimple('diagnostics'));

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg || typeof msg.type !== 'string') return;

      switch (msg.type) {
        case 'init':
          isApplyingExternal = true;
          try {
            editor.value = msg.text || '';
            version = msg.version || 1;
            languageInput.value = msg.languageId || 'plaintext';
            updateStatus('init');
          } catch (e) {
            console.error('Error initializing editor:', e);
            // 使用更安全的方式设置内容
            if (msg.text) {
              editor.textContent = msg.text;
            }
          } finally {
            isApplyingExternal = false;
          }
          return;
        case 'externalSync':
          isApplyingExternal = true;
          try {
            editor.value = msg.text || '';
            version = msg.version || version;
            updateStatus('external sync');
          } catch (e) {
            console.error('Error syncing editor:', e);
            // 使用更安全的方式设置内容
            if (msg.text) {
              editor.textContent = msg.text;
            }
          } finally {
            isApplyingExternal = false;
          }
          return;
        case 'languageChanged':
          languageInput.value = msg.languageId || languageInput.value;
          updateStatus('language updated');
          return;
        case 'hoverResult':
          renderHovers(msg.hovers || []);
          updateStatus('hover result');
          return;
        case 'completionResult':
          logOther('completionResult', msg.items || []);
          updateStatus('completion result');
          return;
        case 'definitionResult':
          logOther('definitionResult', msg.locations || []);
          updateStatus('definition result');
          return;
        case 'symbolsResult':
          logOther('symbolsResult', msg.symbols || []);
          updateStatus('symbols result');
          return;
        case 'semanticTokensResult':
          renderTokens(msg.tokens || null);
          updateStatus('semantic tokens');
          return;
        case 'diagnosticsResult':
          renderDiagnostics(msg.diagnostics || []);
          updateStatus('diagnostics result');
          return;
        case 'diagnosticsUpdate':
          renderDiagnostics(msg.diagnostics || []);
          updateStatus('diagnostics update');
          return;
        case 'error':
          logOther('error', msg.message || 'unknown error');
          updateStatus('error');
          return;
        default:
          return;
      }
    });
  </script>
</body>
</html>`;
    }
}

function serializeRange(range: vscode.Range): SerializedRange {
    return {
        start: { line: range.start.line, character: range.start.character },
        end: { line: range.end.line, character: range.end.character },
    };
}

function stringifyMarkdown(input: vscode.MarkedString | vscode.MarkdownString): string {
    try {
        if (typeof input === 'string') return input;
        if (input && typeof input === 'object' && 'value' in input) return (input as any).value || '';
        return String(input || '');
    } catch (e) {
        console.error('Error stringifying markdown:', e);
        return String(input || '');
    }
}

function serializeHovers(hovers: vscode.Hover[]): SerializedHover[] {
    if (!Array.isArray(hovers)) return [];
    return hovers.map((h) => {
        try {
            const contents = Array.isArray(h.contents) ? h.contents : [h.contents];
            return {
                contents: contents.map(stringifyMarkdown).join('\n\n'),
                range: h.range ? serializeRange(h.range) : undefined,
            };
        } catch (e) {
            console.error('Error serializing hover:', e);
            return {
                contents: 'Error serializing hover',
                range: undefined,
            };
        }
    });
}

function serializeCompletions(items: vscode.CompletionItem[]): SerializedCompletionItem[] {
    if (!Array.isArray(items)) return [];
    return items.map((item) => {
        try {
            const label = typeof item.label === 'string' ? item.label : (item.label?.label || '');
            let documentation: string | undefined;
            if (typeof item.documentation === 'string') documentation = item.documentation;
            else if (item.documentation && typeof item.documentation === 'object') documentation = (item.documentation as any).value || '';
            return {
                label,
                kind: item.kind,
                detail: item.detail,
                documentation,
                sortText: item.sortText,
                filterText: item.filterText,
                insertText: typeof item.insertText === 'string' ? item.insertText : undefined,
            };
        } catch (e) {
            console.error('Error serializing completion:', e);
            return {
                label: String(item.label || ''),
                kind: item.kind,
                detail: item.detail,
                documentation: '',
                sortText: item.sortText,
                filterText: item.filterText,
                insertText: typeof item.insertText === 'string' ? item.insertText : undefined,
            };
        }
    });
}

function serializeLocation(loc: vscode.Location): SerializedLocation {
    return {
        uri: loc.uri.toString(),
        range: serializeRange(loc.range),
    };
}

function serializeLocationLink(link: vscode.LocationLink): SerializedLocationLink {
    return {
        targetUri: link.targetUri.toString(),
        targetRange: serializeRange(link.targetRange),
        targetSelectionRange: link.targetSelectionRange ? serializeRange(link.targetSelectionRange) : undefined,
        originSelectionRange: link.originSelectionRange ? serializeRange(link.originSelectionRange) : undefined,
    };
}

function serializeDefinitions(
    defs: vscode.Location | vscode.Location[] | vscode.LocationLink[] | undefined
): Array<SerializedLocation | SerializedLocationLink> {
    if (!defs) return [];
    try {
        const list = Array.isArray(defs) ? defs : [defs];
        return list.map((loc) => {
            try {
                return ('targetUri' in loc ? serializeLocationLink(loc) : serializeLocation(loc as vscode.Location));
            } catch (e) {
                console.error('Error serializing location:', e);
                return {
                    uri: '',
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }
                };
            }
        });
    } catch (e) {
        console.error('Error serializing definitions:', e);
        return [];
    }
}

function serializeDocumentSymbol(symbol: vscode.DocumentSymbol): SerializedDocumentSymbol {
    try {
        return {
            name: symbol.name || '',
            kind: symbol.kind,
            range: serializeRange(symbol.range),
            selectionRange: serializeRange(symbol.selectionRange),
            children: symbol.children?.length ? symbol.children.map(serializeDocumentSymbol) : undefined,
        };
    } catch (e) {
        console.error('Error serializing document symbol:', e);
        return {
            name: String(symbol.name || ''),
            kind: symbol.kind,
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            children: undefined,
        };
    }
}

function serializeSymbols(
    symbols: Array<vscode.DocumentSymbol | vscode.SymbolInformation>
): SerializedSymbolResult {
    if (symbols.length === 0) {
        return { kind: 'document', symbols: [] };
    }
    if ('location' in symbols[0]) {
        return {
            kind: 'information',
            symbols: (symbols as vscode.SymbolInformation[]).map((sym) => ({
                name: sym.name,
                kind: sym.kind,
                location: serializeLocation(sym.location),
                containerName: sym.containerName,
            })),
        };
    }
    return {
        kind: 'document',
        symbols: (symbols as vscode.DocumentSymbol[]).map(serializeDocumentSymbol),
    };
}

function serializeSemanticTokens(tokens: vscode.SemanticTokens | undefined): SerializedSemanticTokens | null {
    if (!tokens) return null;
    try {
        return {
            resultId: tokens.resultId,
            data: Array.from(tokens.data ?? []),
        };
    } catch (e) {
        console.error('Error serializing semantic tokens:', e);
        return {
            resultId: tokens.resultId,
            data: [],
        };
    }
}

function serializeDiagnostics(diagnostics: readonly vscode.Diagnostic[]): SerializedDiagnostic[] {
    if (!Array.isArray(diagnostics)) return [];
    return diagnostics.map((d) => {
        try {
            return {
                message: d.message || '',
                severity: d.severity,
                range: serializeRange(d.range),
                source: d.source,
                code: typeof d.code === 'string' || typeof d.code === 'number' ? d.code : undefined,
            };
        } catch (e) {
            console.error('Error serializing diagnostic:', e);
            return {
                message: 'Error serializing diagnostic',
                severity: 0,
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                source: 'error',
                code: undefined,
            };
        }
    });
}

function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
        nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
}

export function activate(context: vscode.ExtensionContext): void {
    context.subscriptions.push(ProxyLanguageEditorProvider.register(context));
}
