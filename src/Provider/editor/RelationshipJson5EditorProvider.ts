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
import { roles } from '../../activate';

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

    // 当前JSON数据的缓存，用于比较变化
    private readonly currentJsonData = new Map<string, string>();

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

    /**
     * 实时同步JSON数据变化到文档，触发VSCode的dirty状态
     */
    private syncJsonDataChange(document: vscode.TextDocument, rgData: RGJsonData): void {
        const key = document.uri.toString();
        const newJsonText = JSON5.stringify(rgData, null, 2) + '\n';
        
        // 检查数据是否真的发生了变化
        const currentData = this.currentJsonData.get(key);
        if (currentData === newJsonText) {
            console.log(`[syncJsonDataChange] No change detected, skipping sync`);
            return;
        }
        
        console.log(`[syncJsonDataChange] JSON data changed, syncing to document`);
        this.currentJsonData.set(key, newJsonText);
        
        // 立即应用到文档以触发dirty状态
        const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(document.getText().length)
        );
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, fullRange, newJsonText);
        
        // 设置短暂的静音时间，防止触发updateWebview
        const muteTime = Date.now() + 300;
        this.refreshMuteUntil.set(key, muteTime);
        
        // 应用编辑
        vscode.workspace.applyEdit(edit).then(success => {
            if (success) {
                console.log(`[syncJsonDataChange] Document synced successfully, dirty state should be visible`);
            } else {
                console.error(`[syncJsonDataChange] Failed to sync document`);
            }
            
            // 清理静音设置
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
                } else if (msg.type === 'requestRoleList') {
                    // 处理角色列表请求
                    // 过滤敏感词类型的角色
                    const filteredRoles = roles.filter((role: any) => role.type !== '敏感词');
                    
                    // 按包来源分类
                    const rolesByPackage = new Map<string, any[]>();
                    for (const role of filteredRoles) {
                        const packagePath = role.packagePath || '默认包';
                        if (!rolesByPackage.has(packagePath)) {
                            rolesByPackage.set(packagePath, []);
                        }
                        rolesByPackage.get(packagePath)!.push(role);
                    }
                    
                    // 转换为前端需要的格式
                    const roleList = Array.from(rolesByPackage.entries()).map(([packagePath, packageRoles]) => ({
                        packagePath,
                        roles: packageRoles.map((role: any) => ({
                            uuid: role.uuid,
                            name: role.name,
                            type: role.type,
                            affiliation: role.affiliation,
                            color: role.color,
                            description: role.description
                        }))
                    }));
                    
                    console.log('[RelationshipJson5EditorProvider] Sending role list:', roleList.length, 'packages');
                    webviewPanel.webview.postMessage({ type: 'roleList', data: roleList });
                } else if (msg.type === 'jumpToRoleDefinition') {
                    // 处理跳转到角色定义的请求
                    const roleUuid = msg.roleUuid;
                    console.log('[RelationshipJson5EditorProvider] Received jumpToRoleDefinition request for roleUuid:', roleUuid);
                    
                    if (!roleUuid) {
                        console.warn('[RelationshipJson5EditorProvider] No roleUuid provided for jumpToRoleDefinition');
                        return;
                    }
                    
                    // 查找对应的角色
                    const targetRole = roles.find((role: any) => role.uuid === roleUuid);
                    if (!targetRole) {
                        console.warn('[RelationshipJson5EditorProvider] Role not found for uuid:', roleUuid);
                        vscode.window.showWarningMessage(`未找到UUID为 ${roleUuid} 的角色定义`);
                        return;
                    }
                    
                    console.log('[RelationshipJson5EditorProvider] Found role:', targetRole.name, 'at', targetRole.sourcePath);
                    
                    // 使用AndreaNovelHelper.openRoleSource命令处理跳转，支持自动选择角色卡编辑器
                    try {
                        if (targetRole.sourcePath) {
                            // 调用智能跳转命令，会自动检查配置决定是否使用角色卡管理器
                            await vscode.commands.executeCommand('AndreaNovelHelper.openRoleSource', targetRole);
                            console.log('[RelationshipJson5EditorProvider] Successfully executed AndreaNovelHelper.openRoleSource command');
                        } else {
                            console.warn('[RelationshipJson5EditorProvider] Role has no sourcePath:', targetRole.name);
                            vscode.window.showWarningMessage(`角色 "${targetRole.name}" 没有源文件路径信息`);
                        }
                    } catch (error) {
                        console.error('[RelationshipJson5EditorProvider] Failed to execute AndreaNovelHelper.openRoleSource command:', error);
                        vscode.window.showErrorMessage(`跳转到角色定义失败: ${error}`);
                    }
                } else if (msg.type === 'getRoleFilePath') {
                    // 处理获取角色文件路径的请求
                    const roleUuid = msg.roleUuid;
                    console.log('[RelationshipJson5EditorProvider] Received getRoleFilePath request for roleUuid:', roleUuid);
                    
                    if (!roleUuid) {
                        console.warn('[RelationshipJson5EditorProvider] No roleUuid provided for getRoleFilePath');
                        webviewPanel.webview.postMessage({ 
                            type: 'roleFilePathError', 
                            error: 'No roleUuid provided' 
                        });
                        return;
                    }
                    
                    // 查找对应的角色
                    const targetRole = roles.find((role: any) => role.uuid === roleUuid);
                    if (!targetRole) {
                        console.warn('[RelationshipJson5EditorProvider] Role not found for uuid:', roleUuid);
                        webviewPanel.webview.postMessage({ 
                            type: 'roleFilePathError', 
                            error: `未找到UUID为 ${roleUuid} 的角色定义` 
                        });
                        return;
                    }
                    
                    if (!targetRole.sourcePath) {
                        console.warn('[RelationshipJson5EditorProvider] Role has no sourcePath:', targetRole.name);
                        webviewPanel.webview.postMessage({ 
                            type: 'roleFilePathError', 
                            error: `角色 "${targetRole.name}" 没有源文件路径信息` 
                        });
                        return;
                    }
                    
                    console.log('[RelationshipJson5EditorProvider] Found role file path:', targetRole.sourcePath);
                    
                    // 返回角色文件路径信息
                    webviewPanel.webview.postMessage({ 
                        type: 'roleFilePath', 
                        filePath: targetRole.sourcePath,
                        roleName: targetRole.name,
                        roleUuid: targetRole.uuid
                    });
                } else if (msg.type === 'loadFileContent') {
                    // 处理加载文件内容的请求
                    const filePath = msg.filePath;
                    console.log('[RelationshipJson5EditorProvider] Received loadFileContent request for:', filePath);
                    
                    if (!filePath) {
                        console.warn('[RelationshipJson5EditorProvider] No filePath provided for loadFileContent');
                        webviewPanel.webview.postMessage({ 
                            type: 'fileContentError', 
                            error: 'No filePath provided' 
                        });
                        return;
                    }
                    
                    try {
                        // 读取文件内容
                        const fileUri = vscode.Uri.file(filePath);
                        const document = await vscode.workspace.openTextDocument(fileUri);
                        const content = document.getText();
                        
                        console.log('[RelationshipJson5EditorProvider] Successfully loaded file content, length:', content.length);
                        
                        // 返回文件内容
                        webviewPanel.webview.postMessage({ 
                            type: 'fileContent', 
                            filePath: filePath,
                            content: content
                        });
                    } catch (error) {
                        console.error('[RelationshipJson5EditorProvider] Failed to load file content:', error);
                        webviewPanel.webview.postMessage({ 
                            type: 'fileContentError', 
                            error: `加载文件失败: ${error instanceof Error ? error.message : String(error)}` 
                        });
                    }
                } else if (msg.type === 'saveFileContent') {
                    // 处理保存文件内容的请求
                    const { filePath, content } = msg;
                    console.log('[RelationshipJson5EditorProvider] Received saveFileContent request for:', filePath);
                    
                    if (!filePath || content === undefined) {
                        console.warn('[RelationshipJson5EditorProvider] Missing filePath or content for saveFileContent');
                        webviewPanel.webview.postMessage({ 
                            type: 'fileSaveError', 
                            error: 'Missing filePath or content' 
                        });
                        return;
                    }
                    
                    try {
                        // 保存文件内容
                        const fileUri = vscode.Uri.file(filePath);
                        const edit = new vscode.WorkspaceEdit();
                        
                        // 检查文件是否存在
                        try {
                            const document = await vscode.workspace.openTextDocument(fileUri);
                            // 文件存在，替换全部内容
                            const fullRange = new vscode.Range(
                                document.positionAt(0),
                                document.positionAt(document.getText().length)
                            );
                            edit.replace(fileUri, fullRange, content);
                        } catch {
                            // 文件不存在，创建新文件
                            edit.createFile(fileUri, { ignoreIfExists: true });
                            edit.insert(fileUri, new vscode.Position(0, 0), content);
                        }
                        
                        // 应用编辑
                        const success = await vscode.workspace.applyEdit(edit);
                        
                        if (success) {
                            console.log('[RelationshipJson5EditorProvider] Successfully saved file content');
                            
                            // 保存文档
                            try {
                                const document = await vscode.workspace.openTextDocument(fileUri);
                                await document.save();
                            } catch (saveError) {
                                console.warn('[RelationshipJson5EditorProvider] Failed to save document:', saveError);
                            }
                            
                            // 返回保存成功消息
                            webviewPanel.webview.postMessage({ 
                                type: 'fileSaveSuccess', 
                                filePath: filePath
                            });
                        } else {
                            throw new Error('Failed to apply workspace edit');
                        }
                    } catch (error) {
                        console.error('[RelationshipJson5EditorProvider] Failed to save file content:', error);
                        webviewPanel.webview.postMessage({ 
                            type: 'fileSaveError', 
                            error: `保存文件失败: ${error instanceof Error ? error.message : String(error)}` 
                        });
                    }
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
                } else if (msg.type === 'dataChanged') {
                    // 新增：处理实时数据变化通知
                    const rgData: RGJsonData = msg.data || { nodes: [], lines: [] };
                    
                    console.log('[RelationshipJson5EditorProvider] Received dataChanged notification');
                    console.log('[RelationshipJson5EditorProvider] Data change - nodes:', rgData.nodes.length, 'lines:', rgData.lines.length);
                    
                    // 实时同步数据变化到文档，触发dirty状态
                    this.syncJsonDataChange(document, rgData);
                    
                    // 发送确认消息
                    webviewPanel.webview.postMessage({ type: 'dataChangeAck', ok: true });
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
            this.currentJsonData.delete(key); // 清理JSON数据缓存
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