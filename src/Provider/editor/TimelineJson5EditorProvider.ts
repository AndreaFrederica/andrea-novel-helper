// src/Provider/editor/TimelineJson5EditorProvider.ts
import * as vscode from 'vscode';
import * as JSON5 from 'json5';
import { buildHtml } from '../utils/html-builder';
import { loadRoles } from '../../utils/utils';
import { roles } from '../../activate';
import { getAllTrackedFiles } from '../../utils/tracker/globalFileTracking';
import * as path from 'path';

/* =========================
   时间线数据类型定义
   ========================= */

export interface TimelineEvent {
    id: string;
    title: string;
    group: string;
    type: 'main' | 'side';
    date: string;
    endDate?: string; // 结束日期 (可选，用于时间区间)
    description: string;
    timeless?: boolean;
    position?: { x: number; y: number };
    bindings?: Array<{
        uuid: string;
        type: 'character' | 'article' | 'location' | 'item' | 'other';
        label?: string;
    }>;
    color?: string; // 自定义节点颜色 (支持 hex、rgb、rgba 等 CSS 颜色格式)
    data?: {
        type: 'main' | 'side' | 'condition'; // 支持条件节点类型
    };
    // 嵌套节点支持
    parentNode?: string; // 父节点ID
    width?: number; // 节点宽度 (仅对父节点有效)
    height?: number; // 节点高度 (仅对父节点有效)
    extent?: 'parent'; // 限制子节点在父节点内移动
    expandParent?: boolean; // 拖动子节点时自动扩展父节点
}

export interface TimelineConnection {
    id: string;
    source: string;
    target: string;
    sourceHandle?: string; // 源节点手柄 ID (例如条件节点的 'true' 或 'false')
    targetHandle?: string; // 目标节点手柄 ID
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
                    const jumpToRoleByUuid = async (roleUuid: string) => {
                        console.log('[TimelineJson5EditorProvider] jumpToRoleByUuid invoked:', roleUuid);

                        loadRoles(false);
                        const allRoles = Array.from(roles.values());
                        const targetRole = allRoles.find((role: any) => role.uuid === roleUuid);

                        if (!targetRole) {
                            console.warn('[TimelineJson5EditorProvider] Role not found for uuid:', roleUuid);
                            vscode.window.showWarningMessage(`未找到UUID为 ${roleUuid} 的角色定义`);
                            return;
                        }

                        console.log('[TimelineJson5EditorProvider] Found role:', (targetRole as any).name);

                        if ((targetRole as any).sourcePath) {
                            await vscode.commands.executeCommand('AndreaNovelHelper.openRoleSource', targetRole);
                            console.log('[TimelineJson5EditorProvider] Successfully executed openRoleSource command');
                        } else {
                            console.warn('[TimelineJson5EditorProvider] Role has no sourcePath:', (targetRole as any).name);
                            vscode.window.showWarningMessage(`角色 "${(targetRole as any).name}" 没有源文件路径信息`);
                        }
                    };

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
                    
                    case 'requestRolesAndArticles': {
                        // 请求角色和文章列表
                        console.log('[TimelineJson5EditorProvider] Received requestRolesAndArticles');
                        
                        try {
                            // 确保角色数据已加载
                            loadRoles(false);
                            
                            // 获取所有角色
                            const allRoles = Array.from(roles.values());
                            
                            // 格式化角色列表
                            const roleList = allRoles.map((role: any) => ({
                                uuid: role.uuid,
                                name: role.name,
                                type: role.type || '未分类',
                                color: role.color
                            }));
                            
                            // 获取文章列表 - 从文件追踪系统获取所有 markdown 和文本文件
                            const allFiles = getAllTrackedFiles();
                            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                            
                            const articleList = allFiles
                                .filter(file => {
                                    // 只包含 markdown 和纯文本文件
                                    const ext = path.extname(file.filePath).toLowerCase();
                                    if (ext !== '.md' && ext !== '.txt') {
                                        return false;
                                    }
                                    
                                    // 排除大纲文件
                                    if (file.filePath.endsWith('_outline.md')) {
                                        return false;
                                    }
                                    
                                    // 排除 novel-helper 目录下的配置文件
                                    if (workspaceRoot && file.filePath.includes(path.join(workspaceRoot, 'novel-helper'))) {
                                        return false;
                                    }
                                    
                                    return true;
                                })
                                .map(file => {
                                    const fileName = path.basename(file.filePath);
                                    const relativePath = workspaceRoot 
                                        ? path.relative(workspaceRoot, file.filePath)
                                        : file.filePath;
                                    
                                    return {
                                        uuid: file.uuid,
                                        title: fileName,
                                        path: relativePath,
                                        fullPath: file.filePath
                                    };
                                })
                                // 按文件名排序
                                .sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
                            
                            console.log(`[TimelineJson5EditorProvider] Sending ${roleList.length} roles and ${articleList.length} articles`);
                            
                            webviewPanel.webview.postMessage({
                                type: 'rolesAndArticlesData',
                                roles: roleList,
                                articles: articleList
                            });
                        } catch (error) {
                            console.error('[TimelineJson5EditorProvider] Error loading roles and articles:', error);
                            webviewPanel.webview.postMessage({
                                type: 'rolesAndArticlesData',
                                roles: [],
                                articles: []
                            });
                        }
                        break;
                    }

                    case 'jumpToRoleDefinition': {
                        const roleUuid = message.roleUuid;
                        console.log('[TimelineJson5EditorProvider] Received jumpToRoleDefinition request:', roleUuid);

                        if (!roleUuid) {
                            console.warn('[TimelineJson5EditorProvider] Missing roleUuid');
                            return;
                        }

                        try {
                            await jumpToRoleByUuid(roleUuid);
                        } catch (error) {
                            console.error('[TimelineJson5EditorProvider] Error jumping to role definition:', error);
                            vscode.window.showErrorMessage(`跳转失败: ${error}`);
                        }
                        break;
                    }

                    case 'jumpToDefinition': {
                        // 处理转跳到定义的请求（保留角色兼容，同时支持文章）
                        const resourceType = message.resourceType;
                        const resourceUuid = message.resourceUuid;
                        console.log('[TimelineJson5EditorProvider] Received jumpToDefinition request:', resourceType, resourceUuid);

                        if (!resourceType || !resourceUuid) {
                            console.warn('[TimelineJson5EditorProvider] Missing resourceType or resourceUuid');
                            return;
                        }

                        try {
                            if (resourceType === 'character') {
                                // 向后兼容旧消息格式，转发到角色跳转逻辑
                                await jumpToRoleByUuid(resourceUuid);
                            } else if (resourceType === 'article') {
                                // 跳转到文章定义
                                const allFiles = getAllTrackedFiles();
                                const targetFile = allFiles.find(file => file.uuid === resourceUuid);

                                if (!targetFile) {
                                    console.warn('[TimelineJson5EditorProvider] Article not found for uuid:', resourceUuid);
                                    vscode.window.showWarningMessage(`未找到UUID为 ${resourceUuid} 的文章`);
                                    return;
                                }

                                console.log('[TimelineJson5EditorProvider] Found article:', targetFile.filePath);

                                // 打开文档
                                const doc = await vscode.workspace.openTextDocument(targetFile.filePath);
                                await vscode.window.showTextDocument(doc, { preview: false });
                                console.log('[TimelineJson5EditorProvider] Successfully opened article');
                            }
                        } catch (error) {
                            console.error('[TimelineJson5EditorProvider] Error jumping to definition:', error);
                            vscode.window.showErrorMessage(`跳转失败: ${error}`);
                        }
                        break;
                    }
                    
                    default:
                        console.log('[Message] Unknown message type:', message.type);
                }
            } catch (error) {
                console.error('[TimelineJson5EditorProvider] Error handling message:', error);
            }
        });

        // 不再自动发送初始数据,等待前端主动请求
        console.log('[TimelineJson5EditorProvider] Editor initialized, waiting for frontend requests...');

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

