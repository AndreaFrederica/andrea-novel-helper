// src/previewPane.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as fontList from 'font-list';
import { mdToPlainText, type MarkdownPlainBlock } from '../../utils/md_plain';
import { txtToPlainText } from '../../utils/txt_plain';
import { setActivePreview } from '../../context/previewRedirect';
import { getRoleLookupKeys } from '../../utils/roleLookupKeys';
import { collectRoleUsageRanges } from '../../utils/roleUsageCollector';
import { ahoCorasickManager } from '../../utils/AhoCorasick/ahoCorasickManager';
import { renderPlainTextWithProcessor, scriptExtensionRegistry } from '../../mcp/scriptExtensions';
import { setWebviewPanelIcon } from '../utils/webviewPanelIcon';

const PREVIEW_STATE_KEY = 'myPreview.primaryDoc';
const PREVIEW_TYPE_COLOR_MAP: Record<string, string> = {
    主角: '#FFD700',
    配角: '#ADD8E6',
    联动角色: '#90EE90',
    正则表达式: '#FFA500',
};

type Block = MarkdownPlainBlock;
type ImgCtx = { srcLines: string[]; docDir: string; webview: vscode.Webview };
type RoleTextStyle = {
    color?: string;
    backgroundColor?: string;
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    underline?: boolean;
};
const EPS = 0.02;     // 2% 死区
const MUTE_MS = 350;  // 与 webview 一致的“静音窗口”

export function registerPreviewPane(context: vscode.ExtensionContext) {
    const manager = new PreviewManager(context);
    context.subscriptions.push(
        vscode.window.registerWebviewPanelSerializer('myPreview', {
            deserializeWebviewPanel: async (panel, state) => {
                await manager.deserialize(panel, state).catch(() => {
                    try { panel.dispose(); } catch { }
                });
            }
        }),
        vscode.commands.registerCommand('myPreview.open', () => manager.openPreviewForActiveEditor()),
        vscode.commands.registerCommand('myPreview.exportTxt', () => manager.exportTxtOfActiveEditor()),
        vscode.commands.registerCommand('myPreview.ttsPlay', () => manager.sendTTSCommand('play')),
        vscode.commands.registerCommand('myPreview.ttsPause', () => manager.sendTTSCommand('pause')),
        vscode.commands.registerCommand('myPreview.ttsStop', () => manager.sendTTSCommand('stop')),
        vscode.commands.registerCommand('myPreview.copyPlainText', () => {
            try {
                const ed = vscode.window.activeTextEditor;
                if (!ed || !ed.document) { return; }
                const doc = ed.document;
                // Prefer selection
                const sel = ed.selection && !ed.selection.isEmpty ? doc.getText(ed.selection) : null;
                if (sel) {
                    // If selection exists, copy its plain text (use appropriate processor for markdown/plaintext)
                    let text: string;
                    if (doc.languageId === 'markdown') { text = mdToPlainText(sel).text; }
                    else if (doc.languageId === 'plaintext') { text = txtToPlainText(sel).text; }
                    else { text = sel; }
                    vscode.env.clipboard.writeText(text);
                    vscode.window.setStatusBarMessage('已复制纯文本（选区）', 1200);
                    return;
                }
                // No selection: render full document to plain text
                const mgr = manager;
                const { text } = mgr['renderToPlainText'](doc);
                vscode.env.clipboard.writeText(text);
                vscode.window.setStatusBarMessage('已复制纯文本（全文）', 1200);
            } catch (e) { /* ignore */ }
        }),

    );
    // 启动后尝试恢复上次的预览
    // setTimeout(() => manager.restorePrimaryPanel().catch(() => { }), 150);
    return manager;
}

export class PreviewManager {
    private panels = new Map<string, vscode.WebviewPanel>();
    // 防抖 / 节流：用 Map 持有 timer，保证同一文档跨事件共享状态
    private _updateTimers = new Map<string, NodeJS.Timeout>();
    private _updatePendingChanges = new Map<string, { start: number; end: number; text: string }[]>();
    private _scrollTimers = new Map<string, NodeJS.Timeout>();
    private _scrollLast = new Map<string, number>();
    private loopGuard = new Map<string, number>();
    private scrollState = new Map<string, { isScrolling: boolean; lastDirection: 'editor' | 'preview' }>();
    /** 当前被“跟随活动编辑器”复用的主预览面板（用户首次点击按钮后进入跟随模式） */
    private primaryPanel: vscode.WebviewPanel | undefined;
    private primaryDocUri: string | undefined;    // 角色列表 getter，由 activate.ts 注入
    private _getRoles: (() => any[]) | undefined;    // 记录“刚刚是预览端拉我”的状态，用于 sendEditorTop 抑制回传
    private lastAppliedFromPreview = new Map<string, { ratio: number, ts: number }>();

    // 记录每个文档上一次的 blocks 快照（做增量用）
    private lastBlocks = new Map<string, Block[]>();
    // （可选）记录预览端当前模式，来自 previewScroll；暂时不分支，供调试
    private previewMode = new Map<string, 'scroll' | 'paged'>();

    private makeHtmlFromBlocks(blocks: Block[], imgCtx?: ImgCtx): string {
        return blocks.map((b, idx) => {
            if (imgCtx) {
                const nextLine = idx + 1 < blocks.length ? blocks[idx + 1].srcLine : imgCtx.srcLines.length;
                return this.renderBlockHtml(b, nextLine, imgCtx);
            }
            return this.renderPlainBlockHtml(b);
        }).join('\n');
    }
    private postWholeHtml(panel: vscode.WebviewPanel, doc: vscode.TextDocument, htmlBody: string) {
        panel.webview.postMessage({ type: 'docRender', sameDoc: true, html: htmlBody });
    }

    // 计算每个 block 的 [start, end]（end 为“下一块起始行-1”，最后一块用一个很大的数）
    private computeBlockRanges(blocks: Block[]) {
        const ranges = blocks.map((b, i) => ({
            start: b.srcLine,
            end: (i + 1 < blocks.length) ? (blocks[i + 1].srcLine - 1) : Number.MAX_SAFE_INTEGER
        }));
        return ranges;
    }

    private applyIncrementalUpdate(
        panel: vscode.WebviewPanel,
        doc: vscode.TextDocument,
        changes: { start: number; end: number; text: string }[]
    ) {
        const key = doc.uri.toString();
        const oldBlocks = this.lastBlocks.get(key);
        const imgCtx: ImgCtx | undefined = (doc.uri.scheme === 'file' && (doc.languageId === 'markdown' || /\.md(i|own)?$/i.test(doc.fileName)))
            ? { srcLines: doc.getText().split(/\r?\n/), docDir: path.dirname(doc.uri.fsPath), webview: panel.webview }
            : undefined;
        if (!oldBlocks || changes.length === 0) {
            const { blocks: newBlocks } = this.renderToPlainText(doc);
            this.postWholeHtml(panel, doc, this.makeHtmlFromBlocks(newBlocks, imgCtx));
            this.lastBlocks.set(key, newBlocks);
            return;
        }

        // 合并修改区间（包含插入换行的影响）
        let fromLine = Number.POSITIVE_INFINITY;
        let toLine = -1;
        for (const c of changes) {
            const inserted = c.text ? (c.text.split('\n').length - 1) : 0;
            fromLine = Math.min(fromLine, c.start);
            toLine = Math.max(toLine, c.end + inserted);
        }
        if (!isFinite(fromLine)) { return; }

        // 新 blocks
        const { blocks: newBlocks } = this.renderToPlainText(doc);

        // 找到“受影响区间”在老/新块数组中的覆盖索引
        const oldRanges = this.computeBlockRanges(oldBlocks);
        const newRanges = this.computeBlockRanges(newBlocks);

        const findCoverStart = (ranges: { start: number, end: number }[]) =>
            Math.max(0, ranges.findIndex(r => r.end >= fromLine));
        const findCoverEnd = (ranges: { start: number, end: number }[]) => {
            let idx = -1;
            for (let i = 0; i < ranges.length; i++) { if (ranges[i].start <= toLine) { idx = i; } else { break; } }
            return Math.max(idx, 0);
        };

        const oldStartIdx = findCoverStart(oldRanges);
        const oldEndIdx = findCoverEnd(oldRanges);
        const newStartIdx = findCoverStart(newRanges);
        const newEndIdx = findCoverEnd(newRanges);

        // 取更稳的替换边界（两边并齐）
        const patchFrom = Math.min(
            fromLine,
            oldRanges[oldStartIdx]?.start ?? fromLine,
            newRanges[newStartIdx]?.start ?? fromLine
        );
        const patchTo = Math.max(
            toLine,
            oldRanges[oldEndIdx]?.end ?? toLine,
            newRanges[newEndIdx]?.end ?? toLine
        );

        // 生成新片段 HTML
        const slice = newBlocks.slice(newStartIdx, newEndIdx + 1);
        const html = this.makeHtmlFromBlocks(slice, imgCtx);

        // 若替换范围过大（例如全文件），直接回退整页渲染以免频繁多次 DOM 改动
        const totalLines = doc.lineCount;
        const span = patchTo - patchFrom + 1;
        if (span > Math.max(2000, totalLines * 0.6)) {
            this.postWholeHtml(panel, doc, this.makeHtmlFromBlocks(newBlocks, imgCtx));
            this.lastBlocks.set(key, newBlocks);
            return;
        }

        // 派发增量补丁（滚动 & 分页都走 docPatch；分页端会按“基于页”的策略处理）
        try {
            panel.webview.postMessage({
                type: 'docPatch',
                fromLine: Math.max(0, patchFrom),
                toLine: Math.max(patchFrom, patchTo),
                html
            });
            // 更新快照
            this.lastBlocks.set(key, newBlocks);
        } catch {
            // 出错兜底：整页刷新一次
            this.updatePanel(panel, doc);
            this.lastBlocks.set(key, newBlocks);
        }
    }



    constructor(private readonly context: vscode.ExtensionContext) {
        this.context.subscriptions.push(
            vscode.workspace.onDidChangeTextDocument(ev => {
                const key = ev.document.uri.toString();
                const panel = this.panels.get(key);
                if (!panel) { return; }
                // 把需要的信息提前拍扁，并累积当前防抖窗口内的所有变更行范围
                const incoming = ev.contentChanges.map(c => ({
                    start: c.range.start.line,
                    end: c.range.end.line,
                    text: c.text
                }));
                const accumulated = this._updatePendingChanges.get(key) ?? [];
                accumulated.push(...incoming);
                this._updatePendingChanges.set(key, accumulated);
                // 清除旧 timer，重新计时（真正的防抖）
                const old = this._updateTimers.get(key);
                if (old !== undefined) { clearTimeout(old); }
                const t = setTimeout(() => {
                    this._updateTimers.delete(key);
                    const changes = this._updatePendingChanges.get(key) ?? [];
                    this._updatePendingChanges.delete(key);
                    this.applyIncrementalUpdate(panel, ev.document, changes);
                }, 80);
                this._updateTimers.set(key, t);
            }),

            vscode.window.onDidChangeTextEditorVisibleRanges(ev => {
                const key = ev.textEditor.document.uri.toString();
                if (!this.panels.has(key)) { return; }
                this._throttledScroll(ev.textEditor.document, 100);
            }),
            vscode.window.onDidChangeTextEditorSelection(ev => {
                const key = ev.textEditor.document.uri.toString();
                if (!this.panels.has(key)) { return; }
                this._throttledScroll(ev.textEditor.document, 100);
            }),
            // 跟随活动编辑器：若已经打开过一个预览（primaryPanel），则切换文件时复用该面板显示新文件，并在切换前停止 TTS
            vscode.window.onDidChangeActiveTextEditor(ed => {
                if (!ed || !ed.document) { return; }
                this.handleActiveEditorChange(ed.document);
            })
        );
    }

    // —— 字体清单缓存（避免频繁枚举系统目录）
    private fontsCache?: { list: string[]; ts: number };

    private getTextStyleFromRole(role: any, defaultColor: string): RoleTextStyle {
        const rawStyle = role?.style && typeof role.style === 'object' ? role.style : undefined;
        const style: RoleTextStyle = rawStyle ? { ...rawStyle } : {};
        if (!rawStyle) {
            if (role?.color) { style.color = role.color; }
            if (role?.backgroundColor) { style.backgroundColor = role.backgroundColor; }
            if (role?.bold) { style.bold = true; }
            if (role?.italic) { style.italic = true; }
            if (role?.strikethrough) { style.strikethrough = true; }
            if (role?.underline) { style.underline = true; }
        }
        style.color = style.color ?? role?.color ?? PREVIEW_TYPE_COLOR_MAP[role?.type] ?? defaultColor;
        return style;
    }

    private buildRoleColorPayload(roles: any[]): any[] {
        const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
        const defaultColor = cfg.get<string>('defaultColor') || '#7aa2f7';
        return roles
            .filter((r: any) => r && typeof r.name === 'string' && r.name)
            .map((r: any) => {
                const style = this.getTextStyleFromRole(r, defaultColor);
                return {
                    name: r.name,
                    type: typeof r.type === 'string' && r.type ? r.type : '角色',
                    priority: typeof r.priority === 'number' ? r.priority : undefined,
                    aliases: Array.isArray(r.aliases) ? r.aliases.filter(Boolean) : [],
                    fixes: Array.isArray(r.fixes || r.fixs) ? (r.fixes || r.fixs).filter(Boolean) : [],
                    lookupKeys: getRoleLookupKeys(r).filter(Boolean),
                    regex: typeof r.regex === 'string' ? r.regex : undefined,
                    regexFlags: typeof r.regexFlags === 'string' ? r.regexFlags : undefined,
                    style,
                    color: style.color,
                    backgroundColor: style.backgroundColor,
                    bold: style.bold,
                    italic: style.italic,
                    strikethrough: style.strikethrough,
                    underline: style.underline,
                };
            });
    }

    private sendRoleColors(panel: vscode.WebviewPanel): void {
        try {
            const roles = this._getRoles ? this._getRoles() : [];
            panel.webview.postMessage({ type: 'roleColors', roles: this.buildRoleColorPayload(roles) });
        } catch { }
    }

    private createVirtualDocument(text: string, sourceUri: vscode.Uri): vscode.TextDocument {
        const lineStarts: number[] = [0];
        for (let i = 0; i < text.length; i++) {
            if (text.charCodeAt(i) === 10) {
                lineStarts.push(i + 1);
            }
        }
        const positionAt = (offset: number): vscode.Position => {
            const safeOffset = Math.max(0, Math.min(offset, text.length));
            let low = 0;
            let high = lineStarts.length - 1;
            while (low <= high) {
                const mid = (low + high) >> 1;
                if (lineStarts[mid] <= safeOffset) {
                    low = mid + 1;
                } else {
                    high = mid - 1;
                }
            }
            const line = Math.max(0, high);
            return new vscode.Position(line, safeOffset - lineStarts[line]);
        };
        const offsetAt = (position: vscode.Position): number => {
            const line = Math.max(0, Math.min(position.line, lineStarts.length - 1));
            const nextStart = line + 1 < lineStarts.length ? lineStarts[line + 1] : text.length + 1;
            return Math.max(lineStarts[line], Math.min(lineStarts[line] + position.character, nextStart - 1, text.length));
        };
        return {
            uri: sourceUri,
            fileName: sourceUri.fsPath,
            isUntitled: false,
            languageId: 'plaintext',
            version: 1,
            encoding: 'utf8',
            isDirty: false,
            isClosed: false,
            eol: vscode.EndOfLine.LF,
            lineCount: lineStarts.length,
            getText: () => text,
            positionAt,
            offsetAt,
            lineAt: (lineOrPosition: number | vscode.Position) => {
                const line = typeof lineOrPosition === 'number' ? lineOrPosition : lineOrPosition.line;
                const start = lineStarts[line] ?? text.length;
                const nextStart = line + 1 < lineStarts.length ? lineStarts[line + 1] : text.length;
                const end = text.charCodeAt(nextStart - 1) === 10 ? nextStart - 1 : nextStart;
                const lineText = text.slice(start, end);
                const range = new vscode.Range(line, 0, line, lineText.length);
                return {
                    lineNumber: line,
                    text: lineText,
                    range,
                    rangeIncludingLineBreak: new vscode.Range(line, 0, line, Math.max(lineText.length, nextStart - start)),
                    firstNonWhitespaceCharacterIndex: lineText.search(/\S|$/),
                    isEmptyOrWhitespace: /^\s*$/.test(lineText),
                } as vscode.TextLine;
            },
            getWordRangeAtPosition: () => undefined,
            validateRange: (range: vscode.Range) => range,
            validatePosition: (position: vscode.Position) => position,
            save: async () => false,
        } as vscode.TextDocument;
    }

    private async sendRoleHighlights(panel: vscode.WebviewPanel, doc: vscode.TextDocument, enabledTypes?: string[]): Promise<void> {
        const enabledTypeSet = Array.isArray(enabledTypes) && enabledTypes.length > 0 ? new Set(enabledTypes) : undefined;
        const { blocks } = this.renderToPlainText(doc);
        const highlights: any[] = [];
        for (const block of blocks) {
            if (!block.text) { continue; }
            const virtualDoc = this.createVirtualDocument(block.text, doc.uri);
            const rawHits = ahoCorasickManager.search(block.text);
            const hits = rawHits.map(([endIdx, pat]) => [endIdx, Array.isArray(pat) ? pat : [pat]] as [number, string[]]);
            const result = await collectRoleUsageRanges(virtualDoc, { fullText: block.text, hits });
            for (const entry of result.decorationEntries) {
                const roleType = typeof entry.role.type === 'string' && entry.role.type ? entry.role.type : '角色';
                if (enabledTypeSet && !enabledTypeSet.has(roleType)) { continue; }
                const style = this.getTextStyleFromRole(entry.role, vscode.workspace.getConfiguration('AndreaNovelHelper').get<string>('defaultColor') || '#7aa2f7');
                highlights.push({
                    srcLine: block.srcLine,
                    start: virtualDoc.offsetAt(entry.range.start),
                    end: virtualDoc.offsetAt(entry.range.end),
                    role: {
                        name: entry.role.name,
                        type: roleType,
                        style,
                    },
                    matchSource: entry.matchSource,
                    partial: entry.partial,
                });
            }
        }
        try { panel.webview.postMessage({ type: 'roleHighlights', highlights }); } catch { }
    }


    /** 把一个已存在的 panel 绑定到指定 doc（统一监听与渲染） */
    private attachPanelToDoc(panel: vscode.WebviewPanel, doc: vscode.TextDocument) {
        const key = doc.uri.toString();


        // 反序列化后需要明确设置 webview 选项（尤其 localResourceRoots）
        // ✅ 只设置 WebviewOptions 允许的字段
        const wsDirs = vscode.workspace.workspaceFolders?.map(f => f.uri) ?? [];
        panel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, 'media'),
                ...wsDirs,
                ...(doc.uri.scheme === 'file' ? [vscode.Uri.file(path.dirname(doc.uri.fsPath))] : [])
            ],
        };

        // 可选：如果你的 VS Code 类型存在该属性，也可以单独设置（不强求）
        // （很多版本不需要/不可设；如有类型错误就删除这行即可）
        // panel.retainContextWhenHidden = true;


        // 放入映射（一个文档对应一个 panel）
        this.panels.set(key, panel);

        // 消息：动态取 doc
        panel.webview.onDidReceiveMessage(msg => {
            const d = this.docOfPanel(panel);
            if (d) { this.onWebviewMessage(d, msg); }
        }, null, this.context.subscriptions);

        // 视图状态：激活标记
        panel.onDidChangeViewState(e => {
            try {
                const d = this.docOfPanel(e.webviewPanel);
                if (e.webviewPanel.active && d) { setActivePreview(d.uri.toString()); }
                else { setActivePreview(undefined); }
            } catch { /* ignore */ }
        }, null, this.context.subscriptions);

        // 关闭清理
        panel.onDidDispose(() => {
            try { this.panels.delete(key); } catch { }
            if (this.primaryPanel === panel) { this.primaryPanel = undefined; this.primaryDocUri = undefined; }
            this.persistPrimaryDoc(undefined);
            try { setActivePreview(undefined); } catch { }
        }, null, this.context.subscriptions);

        // 标题与内容
        panel.title = `Preview: ${path.basename(doc.fileName)}`;
        const { htmlBody, blocks } = this.render(doc, panel.webview);
        panel.webview.html = this.wrapHtml(panel, htmlBody);
        this.lastBlocks.set(key, blocks);

        // 如果此刻就是激活的 webview，把有效文档上报出去
        try {
            if (panel.active) {
                setActivePreview(doc.uri.toString());
            }
        } catch { /* ignore */ }

        // 通知 webview 当前绑定的文档与是否为主面板（用于 setState 持久化）
        try {
            panel.webview.postMessage({
                type: 'init',
                docUri: key,
                isPrimary: (this.primaryPanel === panel)
            });
        } catch { }
        // Webview 脚本加载完成后会主动 requestRoleColors；这里不抢先推送，避免消息在页面重建时丢失。
    }

    /** 供 WebviewPanelSerializer 调用：窗口重载后复活面板 */
    async deserialize(panel: vscode.WebviewPanel, state: any) {
        // 优先使用 webview setState 持久化的 docUri；没有则退化到 workspaceState 的主文档
        const savedPrimary = this.context.workspaceState.get<string | undefined>(PREVIEW_STATE_KEY);
        const docUriStr = (state && typeof state.docUri === 'string') ? state.docUri : savedPrimary;
        if (!docUriStr) { throw new Error('No persisted docUri'); }

        const uri = vscode.Uri.parse(docUriStr);
        if (uri.scheme !== 'file') { throw new Error('Unsupported scheme'); }

        const doc = await vscode.workspace.openTextDocument(uri);
        if (!(doc.languageId === 'markdown' || doc.languageId === 'plaintext')) {
            throw new Error('Unsupported language');
        }

        // 绑定/渲染
        this.attachPanelToDoc(panel, doc);

        // 恢复主面板引用
        if ((state && state.isPrimary) || docUriStr === savedPrimary) {
            this.primaryPanel = panel;
            this.primaryDocUri = docUriStr;
        }

        // 可选：恢复滚动位置
        if (typeof state?.scrollRatio === 'number' || Number.isInteger(state?.topLine)) {
            setTimeout(() => {
                try {
                    panel.webview.postMessage({
                        type: 'restoreScroll',
                        ratio: (typeof state.scrollRatio === 'number') ? state.scrollRatio : undefined,
                        topLine: Number.isInteger(state.topLine) ? state.topLine : undefined
                    });
                } catch { }
            }, 60);
        }
    }

    /** 扩展侧枚举本机字体并回发给 webview */
    private async sendFontFamilies(doc: vscode.TextDocument) {
        const key = doc.uri.toString();
        const panel = this.panels.get(key);
        if (!panel) { return; }

        try {
            let list: string[];
            const reuse = this.fontsCache && (Date.now() - this.fontsCache.ts < 5 * 60 * 1000); // 5 分钟缓存
            if (reuse) {
                list = this.fontsCache!.list;
            } else {
                const arr = await fontList.getFonts(); // ["Arial","Microsoft YaHei",...]
                const uniq = Array.from(new Set(arr.map(n => n.trim()).filter(Boolean)))
                    .sort((a, b) => a.localeCompare(b));
                this.fontsCache = { list: uniq, ts: Date.now() };
                list = uniq;
            }
            panel.webview.postMessage({ type: 'fontFamilies', list });
        } catch (e: any) {
            panel.webview.postMessage({ type: 'fontFamilies', list: [], error: String(e?.message || e) });
        }
    }


    openPreviewForActiveEditor() {
        const doc = vscode.window.activeTextEditor?.document;
        if (!doc) { return; }
        this.ensurePanelFor(doc).then(async panel => {
            try {
                panel.reveal(vscode.ViewColumn.Beside);
            } catch (e) {
                // panel might have been disposed concurrently; try to recreate
                try { this.panels.delete(doc.uri.toString()); } catch { }
                try { panel = await this.ensurePanelFor(doc); panel.reveal(vscode.ViewColumn.Beside); } catch { return; }
            }

            try {
                this.updatePanel(panel, doc);
            } catch (e) {
                try { this.panels.delete(doc.uri.toString()); } catch { }
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
        if (!doc) { return; }
        const processorId = vscode.workspace.getConfiguration('AndreaNovelHelper').get<string>('scripts.defaultPlainTextProcessor', 'internal');
        await scriptExtensionRegistry.emit('beforePlainTextExport', {
            uri: doc.uri.toString(),
            fileName: doc.fileName,
            processorId,
        });
        const rendered = this.renderToPlainText(doc);
        const text = await renderPlainTextWithProcessor(doc, rendered.text, processorId);
        const uri = await vscode.window.showSaveDialog({
            defaultUri: doc.uri.with({ path: doc.uri.path.replace(/\.[^/\\.]+$/, '') + '.txt' }),
            filters: { Text: ['txt'] },
        });
        if (!uri) { return; }
        await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
        await scriptExtensionRegistry.emit('afterPlainTextExport', {
            uri: doc.uri.toString(),
            fileName: doc.fileName,
            output: uri.toString(),
            outputPath: uri.fsPath,
            processorId,
        });
        vscode.window.showInformationMessage(`导出完成：${uri.fsPath}`);
    }

    sendTTSCommand(command: 'play' | 'pause' | 'stop') {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { return vscode.window.showWarningMessage('没有活动的编辑器'); }
        const panel = this.panels.get(editor.document.uri.toString());
        if (!panel) { return vscode.window.showWarningMessage('没有打开的预览面板'); }
        panel.webview.postMessage({ type: 'ttsControl', command });
    }

    /** 注入角色列表 getter（由 activate.ts 调用，避免循环依赖） */
    setRoleColorGetter(fn: () => any[]): void {
        this._getRoles = fn;
    }

    /** 通知所有打开的预览面板角色着色状态已变化，由 Webview 主动拉取最新数据 */
    broadcastRoleColors(): void {
        for (const panel of this.panels.values()) {
            try { panel.webview.postMessage({ type: 'roleColorsChanged' }); } catch { }
        }
    }

    private docOfPanel(panel: vscode.WebviewPanel): vscode.TextDocument | undefined {
        const entry = [...this.panels.entries()].find(([, p]) => p === panel);
        if (!entry) { return undefined; }
        const uriStr = entry[0];
        return vscode.workspace.textDocuments.find(d => d.uri.toString() === uriStr);
    }

    // [PREVIEW_PERSIST:A3] ensurePanelFor (refactor to use attachPanelToDoc)
    private async ensurePanelFor(doc: vscode.TextDocument): Promise<vscode.WebviewPanel> {
        const key = doc.uri.toString();
        let panel = this.panels.get(key);
        if (panel) { return panel; }

        const workspaceRoots = vscode.workspace.workspaceFolders?.map(f => f.uri) ?? [];
        panel = vscode.window.createWebviewPanel(
            'myPreview',
            `Preview: ${path.basename(doc.fileName)}`,
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(this.context.extensionUri, 'media'),
                    ...workspaceRoots,
                    ...(doc.uri.scheme === 'file' ? [vscode.Uri.file(path.dirname(doc.uri.fsPath))] : [])
                ],
            }
        );
        setWebviewPanelIcon(panel, this.context.extensionPath, 'book');


        this.attachPanelToDoc(panel, doc);
        return panel;
    }
    // [/PREVIEW_PERSIST:A3]


    /** 处理活动编辑器变化：复用 primaryPanel 展示新文档，切换前先停止旧文档的 TTS */
    private handleActiveEditorChange(newDoc: vscode.TextDocument) {
        if (!this.primaryPanel) { return; } // 用户尚未开启任何预览
        // 仅跟随 markdown / plaintext 且来自本地文件系统的文档
        if (!(newDoc.uri.scheme === 'file' && (newDoc.languageId === 'markdown' || newDoc.languageId === 'plaintext'))) { return; }
        const newKey = newDoc.uri.toString();
        if (this.primaryDocUri === newKey) { return; } // 同一个文档，无需切换

        // 1. 停止旧文档 TTS（发送停止命令即可，webview 内自行判断）
        try { this.primaryPanel.webview.postMessage({ type: 'ttsControl', command: 'stop' }); } catch (e) { /* ignore */ }

        // 2. 更新映射：移除旧 key，添加新 key 复用同一个 panel
        if (this.primaryDocUri) { try { this.panels.delete(this.primaryDocUri); } catch { } }
        try {
            this.panels.set(newKey, this.primaryPanel!);
            this.primaryDocUri = newKey;
            this.persistPrimaryDoc(this.primaryDocUri);

            // 3. 用新文档内容刷新 panel
            try {
                this.updatePanel(this.primaryPanel!, newDoc);
                try { setActivePreview(newDoc.uri.toString()); } catch { }
                setTimeout(() => this.sendEditorTop(newDoc), 50);
            } catch (e) {
                // primaryPanel 可能已失效，清理并创建新的 panel
                this.primaryPanel = undefined;
                this.primaryDocUri = undefined;
                try { this.panels.delete(newKey); } catch { }
                this.ensurePanelFor(newDoc).then(p => {
                    try { p.reveal(vscode.ViewColumn.Beside); } catch { }
                    this.primaryPanel = p;
                    this.primaryDocUri = newKey;
                    this.persistPrimaryDoc(this.primaryDocUri);
                    try { this.updatePanel(p, newDoc); } catch { }
                    setTimeout(() => this.sendEditorTop(newDoc), 50);
                }).catch(() => { });
                return;
            }

            // 4. 同步滚动定位（稍延迟等待渲染）
            setTimeout(() => this.sendEditorTop(newDoc), 50);
        } catch (e) {
            // 容错：尝试新建 panel
            this.primaryPanel = undefined; this.primaryDocUri = undefined;
            try { this.panels.delete(newKey); } catch { }
            this.ensurePanelFor(newDoc).then(p => {
                try { p.reveal(vscode.ViewColumn.Beside); } catch { }
                this.primaryPanel = p; this.primaryDocUri = newKey; this.persistPrimaryDoc(this.primaryDocUri);
                try { this.updatePanel(p, newDoc); } catch { }
                setTimeout(() => this.sendEditorTop(newDoc), 50);
            }).catch(() => { });
            return;
        }
    }

    /** 持久化当前主文档 URI */
    private persistPrimaryDoc(uri: string | undefined) {
        try { this.context.workspaceState.update(PREVIEW_STATE_KEY, uri); } catch { }
    }

    /** 启动时尝试恢复主预览面板 */
    async restorePrimaryPanel() {
        const saved = this.context.workspaceState.get<string | undefined>(PREVIEW_STATE_KEY);
        if (!saved) { return; }
        try {
            const uri = vscode.Uri.parse(saved);
            if (uri.scheme !== 'file') { return; }
            const doc = await vscode.workspace.openTextDocument(uri);
            // 仅限制于 markdown / plaintext
            if (!(doc.languageId === 'markdown' || doc.languageId === 'plaintext')) { return; }
            const panel = await this.ensurePanelFor(doc);
            this.primaryPanel = panel; this.primaryDocUri = doc.uri.toString();
            try { this.updatePanel(panel, doc); } catch { }
            try { panel.reveal(vscode.ViewColumn.Beside, true); } catch (e) {
                try { this.panels.delete(doc.uri.toString()); } catch { }
                return;
            }
            setTimeout(() => this.sendEditorTop(doc), 120);
        } catch { }
    }

    /** 停止所有预览中的 TTS（用于停用扩展） */
    stopAllTTS() {
        for (const p of this.panels.values()) {
            try { p.webview.postMessage({ type: 'ttsControl', command: 'stop' }); } catch { }
        }
    }
    private onWebviewMessage(doc: vscode.TextDocument, msg: any) {
        const key = doc.uri.toString();

        if (msg?.type === 'requestFonts') {
            this.sendFontFamilies(doc); // 异步列举并回发 { type:'fontFamilies', list:[...] }
            return;
        }
        if (msg?.type === 'requestRoleColors') {
            const panel = this.panels.get(key);
            if (panel) { this.sendRoleColors(panel); }
            return;
        }
        if (msg?.type === 'requestRoleHighlights') {
            const panel = this.panels.get(key);
            const enabledTypes = Array.isArray(msg.enabledTypes)
                ? msg.enabledTypes.filter((type: unknown): type is string => typeof type === 'string' && type.length > 0)
                : undefined;
            if (panel) { this.sendRoleHighlights(panel, doc, enabledTypes).catch(() => { }); }
            return;
        }
        if (msg?.type === 'previewScroll' && typeof msg.ratio === 'number') {
            this.previewMode.set(key, msg.mode === 'paged' ? 'paged' : 'scroll');
            // …后面原有逻辑不变
        }


        // Webview 在启动时可能会请求当前编辑器的 fontFamily，以便立即应用“跟随 VS Code”模式
        if (msg?.type === 'requestVscodeFontFamily') {
            const panel = this.panels.get(key);
            let editorFontFamily = '';
            try {
                const cfg = vscode.workspace.getConfiguration('editor', doc.uri);
                editorFontFamily = String(cfg.get<string>('fontFamily') || '');
            } catch (_) { editorFontFamily = ''; }
            try { panel?.webview.postMessage({ type: 'vscodeFontFamily', value: editorFontFamily }); } catch { }
            return;
        }

        if (msg?.type === 'previewScroll' && typeof msg.ratio === 'number') {
            const t = Date.now();
            const last = this.loopGuard.get(key) ?? 0;
            const state = this.scrollState.get(key);
            if (t - last < 500 || (state?.isScrolling && state.lastDirection === 'editor')) { return; }

            const editor = this.findEditor(doc);
            if (!editor) { return; }

            // 当前编辑器的可见顶行
            const vr = editor.visibleRanges[0];
            const curTop = vr ? vr.start.line : editor.selection.active.line;
            const total = Math.max(1, doc.lineCount - 1);
            const curRatio = total > 0 ? (curTop / total) : 0;

            // 死区判断：预览上报与当前编辑器视角差距很小，就不动编辑器
            if (Math.abs(curRatio - msg.ratio) <= EPS) {
                return;
            }

            this.scrollState.set(key, { isScrolling: true, lastDirection: 'preview' });

            // 目标：优先使用预览给的 topLine/bottomLine，否则按比例
            let targetLine = Number.isInteger(msg.topLine)
                ? this.clampInt(msg.topLine, 0, doc.lineCount - 1)
                : this.clampInt(Math.round(msg.ratio * Math.max(0, doc.lineCount - 1)), 0, doc.lineCount - 1);

            const pos = new vscode.Position(targetLine, 0);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.AtTop);

            // 记录“刚刚是预览驱动的”
            this.lastAppliedFromPreview.set(key, { ratio: +msg.ratio.toFixed(4), ts: Date.now() });

            setTimeout(() => {
                const st = this.scrollState.get(key);
                if (st?.lastDirection === 'preview') {
                    this.scrollState.set(key, { isScrolling: false, lastDirection: 'preview' });
                }
            }, 300);
            return;
        }


        if (msg?.type === 'previewTopLine' && Number.isInteger(msg.line)) {
            const t = Date.now();
            const last = this.loopGuard.get(key) ?? 0;
            const state = this.scrollState.get(key);
            if (t - last < 500 || (state?.isScrolling && state.lastDirection === 'editor')) { return; }

            const editor = this.findEditor(doc);
            if (!editor) { return; }

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
                if (st?.lastDirection === 'preview') { this.scrollState.set(key, { isScrolling: false, lastDirection: 'preview' }); }
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

        if (msg?.type === 'previewViewport'
            && Number.isInteger(msg.top) && Number.isInteger(msg.bottom)) {
            const t = Date.now();
            const last = this.loopGuard.get(key) ?? 0;
            const state = this.scrollState.get(key);
            if (t - last < 500 || (state?.isScrolling && state.lastDirection === 'editor')) { return; }

            const editor = this.findEditor(doc);
            if (!editor) { return; }

            this.scrollState.set(key, { isScrolling: true, lastDirection: 'preview' });

            // 估算可视行数，用来“向上滚”时贴底
            const metrics = this.estimateEditorPixels(doc, editor);
            const vr = editor.visibleRanges[0];
            const visibleCount =
                vr ? (vr.end.line - vr.start.line + 1)
                    : (metrics.viewportPx ? Math.max(1, Math.round(metrics.viewportPx / Math.max(1, metrics.lineHeight))) : 30);

            const dir: 'down' | 'up' = (msg.dir === 'up') ? 'up' : 'down';
            let targetTop = msg.top;
            if (dir === 'up') { targetTop = msg.bottom - (visibleCount - 1); }
            targetTop = this.clampInt(targetTop, 0, doc.lineCount - 1);

            const pos = new vscode.Position(targetTop, 0);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.AtTop);

            setTimeout(() => {
                const st = this.scrollState.get(key);
                if (st?.lastDirection === 'preview') {
                    this.scrollState.set(key, { isScrolling: false, lastDirection: 'preview' });
                }
            }, 300);
            return;
        }
    }

    private updatePanel(panel: vscode.WebviewPanel, doc: vscode.TextDocument) {
        panel.title = `Preview: ${path.basename(doc.fileName)}`;
        const { htmlBody, blocks } = this.render(doc, panel.webview);
        panel.webview.html = this.wrapHtml(panel, htmlBody);
        this.lastBlocks.set(doc.uri.toString(), blocks);
    }


    private render(doc: vscode.TextDocument, webview?: vscode.Webview): { htmlBody: string, blocks: Block[] } {
        if (doc.languageId === 'markdown' || /\.md(i|own)?$/i.test(doc.fileName)) {
            const { blocks } = this.renderToPlainText(doc);
            let imgCtx: ImgCtx | undefined;
            if (webview && doc.uri.scheme === 'file') {
                imgCtx = {
                    srcLines: doc.getText().split(/\r?\n/),
                    docDir: path.dirname(doc.uri.fsPath),
                    webview,
                };
            }
            const htmlBody = this.makeHtmlFromBlocks(blocks, imgCtx);
            return { htmlBody, blocks };
        } else {
            const text = doc.getText();
            const { blocks } = txtToPlainText(text);
            const htmlBody = blocks.map(b => this.renderPlainBlockHtml(b)).join('\n');
            return { htmlBody, blocks };
        }
    }


    private renderToPlainText(doc: vscode.TextDocument): { text: string; blocks: Block[] } {
        if (doc.languageId === 'markdown' || /\.md(i|own)?$/i.test(doc.fileName)) {
            const src = doc.getText();
            return mdToPlainText(src);
        }
        const text = doc.getText();
        const blocks = (doc.languageId === 'plaintext') ? txtToPlainText(text).blocks : [{ srcLine: 0, text }];
        const outText = (doc.languageId === 'plaintext') ? txtToPlainText(text).text : text;
        return { text: outText, blocks };
    }

    /** 渲染单个 Block 为 HTML，若包含图片则生成 <img> 标签 */
    private renderBlockHtml(block: Block, nextLine: number, imgCtx: ImgCtx): string {
        const { srcLines, docDir, webview } = imgCtx;
        // 快速判断：block 文本中是否包含图片占位符
        if (!block.text.includes('[image')) {
            return this.renderPlainBlockHtml(block);
        }
        // 收集本 block 原始源行中所有图片
        const blockEnd = Math.min(nextLine, srcLines.length);
        const images: Array<{ alt: string; src: string }> = [];
        const imgRe = /!\[([^\]]*)\]\(([^)]+)\)/g;
        for (let l = block.srcLine; l < blockEnd; l++) {
            let m: RegExpExecArray | null;
            imgRe.lastIndex = 0;
            while ((m = imgRe.exec(srcLines[l])) !== null) {
                images.push({ alt: m[1], src: m[2] });
            }
        }
        if (!images.length) {
            return this.renderPlainBlockHtml(block);
        }
        // 判断 block 是否为纯图片（文本仅包含 [image...] 占位）
        const trimmed = block.text.trim();
        const onlyImages = /^(\[image(?:: [^\]]+)?\]\n?)+$/.test(trimmed + '\n');
        if (onlyImages) {
            const figuresHtml = images.map(img => {
                const resolvedSrc = this.resolveImageSrc(img.src, docDir, webview);
                return `<figure style="margin:0.5em 0;text-align:center"><img src="${resolvedSrc}" alt="${this.escapeHtml(img.alt)}" style="max-width:100%;height:auto;" loading="lazy"></figure>`;
            }).join('\n');
            return this.wrapRenderedBlock(block, figuresHtml);
        }
        // 混合段落：在 pre 中内联替换占位为 <img>
        let html = this.escapeHtml(block.text);
        for (const img of images) {
            const escapedAlt = this.escapeHtml(img.alt);
            const placeholder = img.alt ? `[image: ${escapedAlt}]` : '[image]';
            const resolvedSrc = this.resolveImageSrc(img.src, docDir, webview);
            const imgTag = `<img src="${resolvedSrc}" alt="${escapedAlt}" style="max-width:100%;height:auto;vertical-align:middle;" loading="lazy">`;
            html = html.replace(placeholder, imgTag);
        }
        return this.wrapRenderedBlock(block, `<pre>${html}</pre>`);
    }

    private renderPlainBlockHtml(block: Block): string {
        if (block.kind === 'code') {
            return this.wrapRenderedBlock(block, `<pre>${this.escapeHtml(block.text)}</pre>`);
        }
        if (block.kind === 'list') {
            const lines = block.text.split('\n');
            const markers = block.listMarkers || [];
            let offset = 0;
            const inner = lines.map((line, index) => {
                const marker = markers[index] || '•';
                const start = offset;
                const end = start + line.length;
                offset = end + 1;
                const lineStyles = (block.inlineStyles || [])
                    .filter(style => style.start < end && start < style.end)
                    .map(style => ({
                        ...style,
                        start: Math.max(0, style.start - start),
                        end: Math.min(line.length, style.end - start),
                    }));
                return `<span class="md-list-line"><span class="md-list-marker" aria-hidden="true">${this.escapeHtml(marker)}</span><span class="md-list-text">${this.renderInlineHtml(line, lineStyles)}</span></span>`;
            }).join('\n');
            return this.wrapRenderedBlock(block, `<pre>${inner}</pre>`);
        }
        return this.wrapRenderedBlock(block, `<pre>${this.renderInlineHtml(block.text, block.inlineStyles || [])}</pre>`);
    }

    private renderInlineHtml(text: string, styles: NonNullable<Block['inlineStyles']>): string {
        if (!styles.length) { return this.escapeHtml(text); }
        type InlineKind = NonNullable<Block['inlineStyles']>[number]['kind'];
        const events: Array<{ offset: number; kind: InlineKind; close: boolean }> = [];
        for (const style of styles) {
            const start = Math.max(0, Math.min(style.start, text.length));
            const end = Math.max(start, Math.min(style.end, text.length));
            if (end <= start) { continue; }
            events.push({ offset: start, kind: style.kind, close: false });
            events.push({ offset: end, kind: style.kind, close: true });
        }
        events.sort((a, b) => a.offset - b.offset || Number(b.close) - Number(a.close));
        let cursor = 0;
        let html = '';
        const stack: InlineKind[] = [];
        const openTag = (kind: InlineKind) => {
            switch (kind) {
                case 'bold': return '<span class="md-inline-bold">';
                case 'italic': return '<span class="md-inline-italic">';
                case 'boldItalic': return '<span class="md-inline-bold-italic">';
                case 'strike': return '<span class="md-inline-strike">';
                case 'code': return '<span class="md-inline-code">';
            }
            return '';
        };
        for (const event of events) {
            if (event.offset > cursor) {
                html += this.escapeHtml(text.slice(cursor, event.offset));
                cursor = event.offset;
            }
            if (event.close) {
                const index = stack.lastIndexOf(event.kind);
                if (index >= 0) {
                    const reopen = stack.splice(index + 1);
                    const toReopen = [...reopen];
                    html += '</span>';
                    stack.splice(index, 1);
                    for (const _kind of [...toReopen].reverse()) { html += '</span>'; }
                    for (const kind of toReopen) { html += openTag(kind); stack.push(kind); }
                }
            } else {
                html += openTag(event.kind);
                stack.push(event.kind);
            }
        }
        if (cursor < text.length) { html += this.escapeHtml(text.slice(cursor)); }
        while (stack.length) { html += '</span>'; stack.pop(); }
        return html;
    }

    private wrapRenderedBlock(block: Block, innerHtml: string): string {
        const attrs = [`data-line="${block.srcLine}"`];
        if (block.kind) { attrs.push(`data-md-kind="${block.kind}"`); }
        if (block.level) { attrs.push(`data-md-level="${block.level}"`); }
        return `<div ${attrs.join(' ')}>${innerHtml}</div>`;
    }

    /** 将图片路径解析为 webview 可访问的 URI */
    private resolveImageSrc(src: string, docDir: string, webview: vscode.Webview): string {
        const trimmed = src.trim();
        if (/^https?:\/\//i.test(trimmed) || /^data:/i.test(trimmed)) {
            return this.escapeHtml(trimmed);
        }
        try {
            const decoded = decodeURIComponent(trimmed);
            const absPath = path.isAbsolute(decoded) ? decoded : path.resolve(docDir, decoded);
            return webview.asWebviewUri(vscode.Uri.file(absPath)).toString();
        } catch {
            return this.escapeHtml(trimmed);
        }
    }

    private sendEditorTop(doc: vscode.TextDocument) {
        const key = doc.uri.toString();
        const panel = this.panels.get(key);
        if (!panel) { return; }
        const editor = this.findEditor(doc);
        if (!editor) { return; }

        const state = this.scrollState.get(key);
        if (state?.isScrolling && state.lastDirection === 'preview') { return; }

        const vr = editor.visibleRanges[0];
        const topVisible = vr ? vr.start.line : editor.selection.active.line;
        const bottomVisible = vr ? vr.end.line : topVisible;

        const totalLines = doc.lineCount;
        const scrollRatio = Math.min(1, topVisible / Math.max(1, totalLines - 1));
        const ratio4 = +scrollRatio.toFixed(4);

        // 消回声：如果刚刚是预览驱动的，且在静音窗内 & 比例差在死区内，就不要回传
        const lastFromPreview = this.lastAppliedFromPreview.get(key);
        if (lastFromPreview && (Date.now() - lastFromPreview.ts <= MUTE_MS) &&
            Math.abs(lastFromPreview.ratio - ratio4) <= EPS) {
            return;
        }

        this.scrollState.set(key, { isScrolling: true, lastDirection: 'editor' });
        this.loopGuard.set(key, Date.now());

        const metrics = this.estimateEditorPixels(doc, editor);

        // 尝试读取编辑器字体设置，传递给 webview 以便“跟随 VS Code”模式使用
        let editorFontFamily = '';
        try {
            const cfg = vscode.workspace.getConfiguration('editor', doc.uri);
            editorFontFamily = String(cfg.get<string>('fontFamily') || '');
        } catch (_) { editorFontFamily = ''; }

        panel.webview.postMessage({
            type: 'editorScroll',
            ratio: ratio4,
            editorScrollHeight: metrics.scrollHeight,
            editorViewportPx: metrics.viewportPx,
            topLine: topVisible,
            bottomLine: bottomVisible,
            totalLines: totalLines,
            vscodeFontFamily: editorFontFamily
        });

        setTimeout(() => {
            const st = this.scrollState.get(key);
            if (st?.lastDirection === 'editor') {
                this.scrollState.set(key, { isScrolling: false, lastDirection: 'editor' });
            }
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
    private estimateEditorPixels(doc: vscode.TextDocument, editor: vscode.TextEditor) {
        const cfg = vscode.workspace.getConfiguration('editor', doc.uri);
        const fs = cfg.get<number>('fontSize') ?? 14;
        let lh = cfg.get<number>('lineHeight') ?? 0;
        if (lh <= 0) { lh = Math.round(fs * 1.5); } // VS Code 默认算法的近似

        const pad = cfg.get<{ top?: number; bottom?: number }>('padding') ?? {};
        const topPad = typeof pad.top === 'number' ? pad.top : 0;
        const bottomPad = typeof pad.bottom === 'number' ? pad.bottom : 0;

        const scrollHeight = lh * doc.lineCount + topPad + bottomPad;

        const vr = editor.visibleRanges[0];
        const visibleLines = vr ? (vr.end.line - vr.start.line + 1) : 0;
        const viewportPx = (visibleLines > 0) ? visibleLines * lh : undefined;

        return { lineHeight: lh, scrollHeight, viewportPx };
    }

    private clampInt(x: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, x)); }
    private escapeHtml(s: string) {
        return s.replace(/[&<>"']/g, c => c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;');
    }
    /** 节流版 sendEditorTop：每个文档独立持有 timer，跨事件正确节流 */
    private _throttledScroll(doc: vscode.TextDocument, ms: number) {
        const key = doc.uri.toString();
        const now = Date.now();
        const last = this._scrollLast.get(key) ?? 0;
        const remain = ms - (now - last);
        if (remain <= 0) {
            this._scrollLast.set(key, now);
            this.sendEditorTop(doc);
        } else if (!this._scrollTimers.has(key)) {
            const t = setTimeout(() => {
                this._scrollTimers.delete(key);
                this._scrollLast.set(key, Date.now());
                this.sendEditorTop(doc);
            }, remain);
            this._scrollTimers.set(key, t);
        }
    }
    private findEditor(doc: vscode.TextDocument) {
        return vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === doc.uri.toString());
    }
}

// 导出便于外部停用时调用
export function stopAllPreviewTTS(manager?: PreviewManager) {
    try { manager?.stopAllTTS(); } catch { }
}
