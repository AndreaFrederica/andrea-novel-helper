/* eslint-disable curly */
// src/Provider/RelationshipJson5EditorProvider.ts
import * as vscode from 'vscode';
import * as JSON5 from 'json5';
import { 
    RGJsonData,
    RGNode,
    RGLine
} from './relationship-types';
import { buildHtml } from '../utils/html-builder';

/* =========================
   规则与工具
   ========================= */

/* =========================
   JSON5 读写（文件 <-> RGJsonData）
   ========================= */

function parseRGJsonDataFromText(text: string): RGJsonData {
    let data: any;
    try { 
        data = JSON5.parse(text); 
    } catch { 
        return { nodes: [], lines: [] }; 
    }
    
    // 只接受图形格式 (RGJsonData)
    if (data && typeof data === 'object' && !Array.isArray(data) && 
        Array.isArray(data.nodes) && Array.isArray(data.lines)) {
        console.log('[parseRGJsonDataFromText] Detected RGJsonData format');
        return data as RGJsonData;
    }
    
    console.log('[parseRGJsonDataFromText] Invalid format, returning empty data');
    return { nodes: [], lines: [] };
}

function stringifyRGJsonDataToJson5(data: RGJsonData): string {
    return JSON5.stringify(data, null, 2) + '\n';
}

/* =========================
   提供器实现
   ========================= */

export interface RelationshipJson5EditorOptions {
    spaRoot: vscode.Uri;
    connectSrc?: string[];
    retainContextWhenHidden?: boolean;
    title?: string;
    resourceMapperScriptUri?: string;
}

export class RelationshipJson5EditorProvider implements vscode.CustomTextEditorProvider {

    // 文档刷新静音窗口：在我们自己写入后的短时间内，忽略 doc-change → updateWebview
    private readonly refreshMuteUntil = new Map<string, number>();

    public static register(context: vscode.ExtensionContext, opts: RelationshipJson5EditorOptions): vscode.Disposable {
        const provider = new RelationshipJson5EditorProvider(context, opts);

        const reg = vscode.window.registerCustomEditorProvider(
            'andrea.relationshipJson5Editor',
            provider,
            {
                webviewOptions: { retainContextWhenHidden: opts.retainContextWhenHidden ?? true },
                supportsMultipleEditorsPerDocument: false,
            }
        );

        return vscode.Disposable.from(reg);
    }

    private readonly ctx: vscode.ExtensionContext;
    private readonly opts: RelationshipJson5EditorOptions;

    constructor(ctx: vscode.ExtensionContext, opts: RelationshipJson5EditorOptions) {
        this.ctx = ctx;
        this.opts = opts;
    }

    // 跳过我们自己触发的那次文档变更，防止回推打断前端
    private readonly skipOneEchoFor = new Set<string>();

    // autosave=off 时，先把待写入文本缓存到内存
    private readonly pendingText = new Map<string, string>();

    // autosave 定时器（afterDelay / 其它模式的轻节流）
    private readonly saveTimers = new Map<string, NodeJS.Timeout>();

    // 文档URI -> WebviewPanel（用于直接 postMessage）
    private readonly panelsByDoc = new Map<string, vscode.WebviewPanel>();

    private getAutoSaveMode(document: vscode.TextDocument): string {
        return vscode.workspace.getConfiguration('files', document.uri).get<string>('autoSave') ?? 'off';
    }

    private scheduleWrite(document: vscode.TextDocument, text: string): void {
        const key = document.uri.toString();
        const autoSaveMode = this.getAutoSaveMode(document);
        console.log(`[scheduleWrite] Auto save mode: ${autoSaveMode}`);

        // 设置静音时间，防止文档变更触发updateWebview
        const muteTime = Date.now() + (autoSaveMode === 'off' ? 1500 : 800);
        console.log(`[scheduleWrite] Set refresh mute until: ${muteTime}`);
        this.refreshMuteUntil.set(key, muteTime);

        const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(document.getText().length)
        );
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, fullRange, text);
        
        if (autoSaveMode === 'off') {
            // 手动保存模式：立即应用编辑以触发未保存状态，同时缓存文本
            console.log(`[scheduleWrite] Applying edit for manual save to trigger dirty state (${text.length} chars)`);
            this.pendingText.set(key, text);
        } else {
            // 自动保存模式：直接应用编辑
            console.log(`[scheduleWrite] Applying edit for autosave (${text.length} chars)`);
        }
        
        const applyEditPromise = vscode.workspace.applyEdit(edit);
        applyEditPromise.then(success => {
            if (success) {
                console.log(`[scheduleWrite] WorkspaceEdit applied successfully`);
            } else {
                console.error(`[scheduleWrite] WorkspaceEdit failed`);
            }
            // 清理静音设置
            setTimeout(() => {
                console.log(`[scheduleWrite] Clearing refresh mute for ${key}`);
                this.refreshMuteUntil.delete(key);
            }, 100);
        }, (error: any) => {
            console.error(`[scheduleWrite] WorkspaceEdit error:`, error);
            // 清理静音设置
            setTimeout(() => {
                console.log(`[scheduleWrite] Clearing refresh mute for ${key} (error)`);
                this.refreshMuteUntil.delete(key);
            }, 100);
        });

        // 清理旧的保存定时器
        const existingTimer = this.saveTimers.get(key);
        if (existingTimer) {
            console.log(`[scheduleWrite] Clearing existing save timer`);
            clearTimeout(existingTimer);
            this.saveTimers.delete(key);
        }
    }

    async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        const key = document.uri.toString();
        this.panelsByDoc.set(key, webviewPanel);

        // 配置 webview
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.opts.spaRoot, vscode.Uri.joinPath(this.ctx.extensionUri, 'media')],
        };

        // 设置 resourceMapperScriptUri
        try {
            const mapperFile = vscode.Uri.joinPath(this.ctx.extensionUri, 'media', 'resource-mapper.js');
            this.opts.resourceMapperScriptUri = webviewPanel.webview.asWebviewUri(mapperFile).toString();
        } catch (_) { }

        // 设置 HTML 内容
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

        // 更新 webview 内容
        const updateWebview = async () => {
            try {
                const text = document.getText();
                console.log('[RelationshipJson5EditorProvider] Document text length:', text.length);
                console.log('[RelationshipJson5EditorProvider] Document text preview:', text.substring(0, 200));
                
                // 直接解析为RGJsonData格式，移除旧格式兼容
                const rgJsonData = parseRGJsonDataFromText(text);
                
                console.log('[RelationshipJson5EditorProvider] RG data nodes count:', rgJsonData.nodes.length);
                console.log('[RelationshipJson5EditorProvider] RG data lines count:', rgJsonData.lines.length);
                console.log('[RelationshipJson5EditorProvider] RG data:', rgJsonData);
                
                webviewPanel.webview.postMessage({ type: 'relationshipData', data: rgJsonData });
                console.log('[RelationshipJson5EditorProvider] Posted message to webview');
            } catch (e) {
                // 发送空的RGJsonData
                const emptyData: RGJsonData = { nodes: [], lines: [] };
                webviewPanel.webview.postMessage({ type: 'relationshipData', data: emptyData });
                console.error('[RelationshipJson5Editor] parse error:', e);
            }
        };

        // 文档变更监听
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() !== document.uri.toString()) return;
            const key = e.document.uri.toString();
            console.log(`[onDidChangeTextDocument] Document changed: ${key}`);
            
            if (this.skipOneEchoFor.has(key)) {
                console.log(`[onDidChangeTextDocument] Skipping echo for ${key}`);
                this.skipOneEchoFor.delete(key);
                return;
            }
            
            const muteUntil = this.refreshMuteUntil.get(key) ?? 0;
            const now = Date.now();
            console.log(`[onDidChangeTextDocument] Current time: ${now}, mute until: ${muteUntil}`);
            
            if (now < muteUntil) {
                console.log(`[onDidChangeTextDocument] Muted, skipping updateWebview`);
                return;
            }
            
            console.log(`[onDidChangeTextDocument] Calling updateWebview`);
            updateWebview();
        });

        // 保存前处理
        const willSaveSub = vscode.workspace.onWillSaveTextDocument(e => {
            if (e.document.uri.toString() !== document.uri.toString()) return;
            const key = e.document.uri.toString();
            const pending = this.pendingText.get(key);
            console.log(`[onWillSaveTextDocument] Document: ${key}`);
            console.log(`[onWillSaveTextDocument] Has pending text: ${!!pending}`);
            if (!pending) return;

            // 检查是否已有静音设置，避免重叠
            const existingMute = this.refreshMuteUntil.get(key) ?? 0;
            const now = Date.now();
            const newMuteTime = now + 1200; // 手动保存用较长的静音时间
            
            if (existingMute > now) {
                // 如果已有静音设置且未过期，延长静音时间
                console.log(`[onWillSaveTextDocument] Extending existing mute from ${existingMute} to ${newMuteTime}`);
                this.refreshMuteUntil.set(key, Math.max(existingMute, newMuteTime));
            } else {
                // 设置新的静音时间
                console.log(`[onWillSaveTextDocument] Set refresh mute until: ${newMuteTime} (for manual save)`);
                this.refreshMuteUntil.set(key, newMuteTime);
            }

            console.log(`[onWillSaveTextDocument] Applying pending text (${pending.length} chars)`);
            const fullRange = new vscode.Range(
                e.document.positionAt(0),
                e.document.positionAt(e.document.getText().length)
            );
            e.waitUntil(Promise.resolve([vscode.TextEdit.replace(fullRange, pending)]));

            const t = this.saveTimers.get(key);
            if (t) { 
                console.log(`[onWillSaveTextDocument] Clearing save timer`);
                clearTimeout(t); 
                this.saveTimers.delete(key); 
            }
        });

        // 保存后：清理 pending
        const didSaveSub = vscode.workspace.onDidSaveTextDocument(d => {
            if (d.uri.toString() !== document.uri.toString()) return;
            const key = d.uri.toString();
            console.log(`[onDidSaveTextDocument] Document saved: ${key}`);
            console.log(`[onDidSaveTextDocument] Clearing pending text`);
            this.pendingText.delete(key);
            
            // 保存完成后，延迟清除静音设置，确保所有相关的文档变更事件都被静音
            setTimeout(() => {
                console.log(`[onDidSaveTextDocument] Clearing refresh mute for ${key}`);
                this.refreshMuteUntil.delete(key);
            }, 200); // 短暂延迟确保所有事件处理完毕
        });

        // webview 消息
        webviewPanel.webview.onDidReceiveMessage(async (msg: any) => {
            if (!msg || typeof msg.type !== 'string') return;
            try {
                if (msg.type === 'requestRelationshipData') {
                    await updateWebview();
                } else if (msg.type === 'saveRelationshipData') {
                    // 接收前端的RGJsonData格式数据
                    const rgData: RGJsonData = msg.data || { nodes: [], lines: [] };
                    
                    // 确保坐标数据完整性
                    console.log('[RelationshipJson5EditorProvider] Saving RGJsonData with nodes:', rgData.nodes.length);
                    console.log('[RelationshipJson5EditorProvider] Node coordinates check:', 
                        rgData.nodes.map(n => ({ id: n.id, x: n.x, y: n.y })));
                    
                    // 直接保存图形格式，确保前端数据完全覆盖后端
                    const text = JSON5.stringify(rgData, null, 2) + '\n';

                    // 按 autosave 策略写入/排队
                    this.scheduleWrite(document, text);

                    // 立即 ACK，若 autosave=off，提示已排队等待用户保存
                    const queued = this.getAutoSaveMode(document) === 'off';
                    webviewPanel.webview.postMessage({ type: 'saveAck', ok: true, queued });
                }
            } catch (e) {
                console.error('[RelationshipJson5Editor] message error:', e);
                webviewPanel.webview.postMessage({ type: 'saveError', error: e instanceof Error ? e.message : String(e) });
            }
        });

        // 清理
        webviewPanel.onDidDispose(() => {
            this.panelsByDoc.delete(key);
            this.pendingText.delete(key);
            const timer = this.saveTimers.get(key);
            if (timer) {
                clearTimeout(timer);
                this.saveTimers.delete(key);
            }
            changeDocumentSubscription.dispose();
            willSaveSub.dispose();
            didSaveSub.dispose();
        });

        // 初始加载
        updateWebview();
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        return buildHtml(webview, {
            spaRoot: this.opts.spaRoot,
            connectSrc: this.opts.connectSrc,
            resourceMapperScriptUri: this.opts.resourceMapperScriptUri,
            route: '/relation-graph'  // 指向关系图页面
        });
    }
}

// 导出激活函数
export function activate(context: vscode.ExtensionContext) {
    RelationshipJson5EditorProvider.register(context, {
        spaRoot: vscode.Uri.joinPath(context.extensionUri, 'packages', 'webview', 'dist', 'spa'),
        connectSrc: ['https:', 'http:', 'ws:', 'wss:'],
        retainContextWhenHidden: true,
        title: '角色关系编辑器',
        resourceMapperScriptUri: undefined // 让 html-builder 自动处理
    });
}