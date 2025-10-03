// src/Provider/editor/TimelineJson5EditorProvider.ts
import * as vscode from 'vscode';
import * as JSON5 from 'json5';
import { buildHtml } from '../utils/html-builder';

/* =========================
   时间线数据类型定义
   ========================= */

export interface TimelineEvent {
    id: string;
    title: string;
    group: string;
    type: 'main' | 'side';
    date: string;
    description: string;
    timeless?: boolean;
    position?: { x: number; y: number };
    bindings?: Array<{
        uuid: string;
        type: 'character' | 'article' | 'location' | 'item' | 'other';
        label?: string;
    }>;
    data?: {
        type: 'main' | 'side';
    };
}

export interface TimelineConnection {
    id: string;
    source: string;
    target: string;
    label?: string;
    connectionType?: 'normal' | 'time-travel' | 'reincarnation' | 'parallel' | 'dream' | 'flashback' | 'other';
}

export interface TimelineJsonData {
    events: TimelineEvent[];
    connections: TimelineConnection[];
}

/* =========================
   JSON5 读写
   ========================= */

function parseTimelineJsonDataFromText(text: string): TimelineJsonData {
    let data: any;
    try { 
        data = JSON5.parse(text); 
    } catch { 
        return { events: [], connections: [] }; 
    }
    
    // 只接受时间线格式
    if (data && typeof data === 'object' && !Array.isArray(data) && 
        Array.isArray(data.events) && Array.isArray(data.connections)) {
        console.log('[parseTimelineJsonDataFromText] Detected TimelineJsonData format');
        return data as TimelineJsonData;
    }
    
    console.log('[parseTimelineJsonDataFromText] Invalid format, returning empty data');
    return { events: [], connections: [] };
}

function stringifyTimelineJsonDataToJson5(data: TimelineJsonData): string {
    return JSON5.stringify(data, null, 2) + '\n';
}

/* =========================
   提供器实现
   ========================= */

export interface TimelineJson5EditorOptions {
    spaRoot: vscode.Uri;
    connectSrc?: string[];
    retainContextWhenHidden?: boolean;
    title?: string;
    resourceMapperScriptUri?: string;
}

export class TimelineJson5EditorProvider implements vscode.CustomTextEditorProvider {

    // 文档刷新静音窗口
    private readonly refreshMuteUntil = new Map<string, number>();

    public static register(context: vscode.ExtensionContext, opts: TimelineJson5EditorOptions): vscode.Disposable {
        const provider = new TimelineJson5EditorProvider(context, opts);

        const reg = vscode.window.registerCustomEditorProvider(
            'andrea.timelineJson5Editor',
            provider,
            {
                webviewOptions: { retainContextWhenHidden: opts.retainContextWhenHidden ?? true },
                supportsMultipleEditorsPerDocument: false,
            }
        );

        return vscode.Disposable.from(reg);
    }

    private readonly ctx: vscode.ExtensionContext;
    private readonly opts: TimelineJson5EditorOptions;

    constructor(ctx: vscode.ExtensionContext, opts: TimelineJson5EditorOptions) {
        this.ctx = ctx;
        this.opts = opts;
    }

    private readonly skipOneEchoFor = new Set<string>();
    private readonly pendingText = new Map<string, string>();
    private readonly saveTimers = new Map<string, NodeJS.Timeout>();
    private readonly panelsByDoc = new Map<string, vscode.WebviewPanel>();
    private readonly currentJsonData = new Map<string, string>();

    private getAutoSaveMode(document: vscode.TextDocument): string {
        return vscode.workspace.getConfiguration('files', document.uri).get<string>('autoSave') ?? 'off';
    }

    /**
     * 按自动保存策略写入/排队
     */
    private scheduleWrite(document: vscode.TextDocument, text: string): void {
        const key = document.uri.toString();
        const autoSaveMode = this.getAutoSaveMode(document);

        const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(document.getText().length)
        );
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, fullRange, text);

        // 设置静音窗口
        const muteTime = Date.now() + 300;
        this.refreshMuteUntil.set(key, muteTime);

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

    /**
     * 实时同步JSON数据变化到文档，触发VSCode的dirty状态
     */
    private syncJsonDataChange(document: vscode.TextDocument, timelineData: TimelineJsonData): void {
        const key = document.uri.toString();
        const newJsonText = JSON5.stringify(timelineData, null, 2) + '\n';
        
        // 检查数据是否真的发生了变化
        const currentData = this.currentJsonData.get(key);
        if (currentData === newJsonText) {
            console.log(`[syncJsonDataChange] No change detected, skipping sync`);
            return;
        }
        
        console.log(`[syncJsonDataChange] Timeline data changed, syncing to document`);
        this.currentJsonData.set(key, newJsonText);
        
        // 立即应用到文档以触发dirty状态
        const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(document.getText().length)
        );
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, fullRange, newJsonText);
        
        // 设置短暂的静音时间
        const muteTime = Date.now() + 300;
        this.refreshMuteUntil.set(key, muteTime);
        
        // 应用编辑
        vscode.workspace.applyEdit(edit).then(success => {
            if (success) {
                console.log(`[syncJsonDataChange] Document synced successfully`);
            } else {
                console.error(`[syncJsonDataChange] Failed to sync document`);
            }
            
            setTimeout(() => {
                this.refreshMuteUntil.delete(key);
            }, 50);
        });
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
                console.log('[TimelineJson5EditorProvider] Document text length:', text.length);
                
                const timelineData = parseTimelineJsonDataFromText(text);
                
                console.log('[TimelineJson5EditorProvider] Timeline data events count:', timelineData.events.length);
                console.log('[TimelineJson5EditorProvider] Timeline data connections count:', timelineData.connections.length);
                
                webviewPanel.webview.postMessage({ type: 'timelineData', data: timelineData });
                console.log('[TimelineJson5EditorProvider] Posted message to webview');
            } catch (e) {
                const emptyData: TimelineJsonData = { events: [], connections: [] };
                webviewPanel.webview.postMessage({ type: 'timelineData', data: emptyData });
                console.error('[TimelineJson5Editor] parse error:', e);
            }
        };

        // 文档变更监听
        const changeListener = vscode.workspace.onDidChangeTextDocument(async e => {
            if (e.document.uri.toString() !== document.uri.toString()) {
                return;
            }

            const key = e.document.uri.toString();
            
            // 检查是否在静音窗口内
            const muteUntil = this.refreshMuteUntil.get(key);
            if (muteUntil && Date.now() < muteUntil) {
                console.log('[onDidChangeTextDocument] Inside mute window, skipping updateWebview');
                return;
            }

            if (this.skipOneEchoFor.has(key)) {
                console.log('[onDidChangeTextDocument] Skipping one echo');
                this.skipOneEchoFor.delete(key);
                return;
            }

            console.log('[onDidChangeTextDocument] External change detected, updating webview');
            await updateWebview();
        });

        // 保存前：应用缓存的文本
        const willSaveSub = vscode.workspace.onWillSaveTextDocument(e => {
            if (e.document.uri.toString() !== document.uri.toString()) {
                return;
            }
            const pending = this.pendingText.get(key);
            if (!pending) {
                return;
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
            if (d.uri.toString() !== document.uri.toString()) {
                return;
            }
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

        // 接收 webview 消息
        const messageListener = webviewPanel.webview.onDidReceiveMessage(async (message) => {
            const key = document.uri.toString();
            
            if (!message || typeof message.type !== 'string') {
                return;
            }
            
            try {
                switch (message.type) {
                    case 'requestTimelineData': {
                        // 前端请求时间线数据
                        console.log('[TimelineJson5EditorProvider] Received requestTimelineData');
                        await updateWebview();
                        break;
                    }
                    
                    case 'dataChanged': {
                        // 实时数据变化通知
                        const timelineData: TimelineJsonData = message.data || { events: [], connections: [] };
                        
                        console.log('[TimelineJson5EditorProvider] Received dataChanged notification');
                        console.log('[TimelineJson5EditorProvider] Data change - events:', timelineData.events.length, 'connections:', timelineData.connections.length);
                        
                        // 实时同步数据变化到文档，触发dirty状态
                        this.syncJsonDataChange(document, timelineData);
                        
                        // 发送确认消息
                        webviewPanel.webview.postMessage({ type: 'dataChangeAck', ok: true });
                        break;
                    }
                    
                    case 'saveTimelineData': {
                        // 保存时间线数据
                        const timelineData: TimelineJsonData = message.data || { events: [], connections: [] };
                        
                        console.log('[TimelineJson5EditorProvider] Saving TimelineJsonData with events:', timelineData.events.length);
                        
                        // 直接保存数据格式，确保前端数据完全覆盖后端
                        const text = JSON5.stringify(timelineData, null, 2) + '\n';

                        // 按 autosave 策略写入/排队
                        this.scheduleWrite(document, text);

                        // 立即 ACK，若 autosave=off，提示已排队等待用户保存
                        const queued = this.getAutoSaveMode(document) === 'off';
                        webviewPanel.webview.postMessage({ type: 'saveAck', ok: true, queued });
                        break;
                    }
                    
                    default:
                        console.log('[Message] Unknown message type:', message.type);
                }
            } catch (error) {
                console.error('[TimelineJson5EditorProvider] Error handling message:', error);
            }
        });

        // 初始化
        await updateWebview();

        // 清理
        webviewPanel.onDidDispose(() => {
            changeListener.dispose();
            messageListener.dispose();
            willSaveSub.dispose();
            didSaveSub.dispose();
            this.panelsByDoc.delete(key);
            this.currentJsonData.delete(key);
            this.refreshMuteUntil.delete(key);
            this.skipOneEchoFor.delete(key);
            this.pendingText.delete(key);
            
            const timer = this.saveTimers.get(key);
            if (timer) {
                clearTimeout(timer);
                this.saveTimers.delete(key);
            }
        });
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        return buildHtml(webview, {
            spaRoot: this.opts.spaRoot,
            connectSrc: this.opts.connectSrc,
            resourceMapperScriptUri: this.opts.resourceMapperScriptUri,
            route: '/timeline',
            editorTitle: this.opts.title || '时间线编辑器',
        });
    }
}

// 导出激活函数
export function activate(context: vscode.ExtensionContext) {
    TimelineJson5EditorProvider.register(context, {
        spaRoot: vscode.Uri.joinPath(context.extensionUri, 'packages', 'webview', 'dist', 'spa'),
        connectSrc: ['https:', 'http:', 'ws:', 'wss:'],
        retainContextWhenHidden: true,
        title: '时间线编辑器',
        resourceMapperScriptUri: undefined
    });
}

