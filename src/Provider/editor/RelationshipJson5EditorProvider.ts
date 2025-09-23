/* eslint-disable curly */
// src/Provider/RelationshipJson5EditorProvider.ts
import * as vscode from 'vscode';
import * as JSON5 from 'json5';
import { 
    RelationshipType, 
    JsonValue, 
    BaseRelationshipFields, 
    ExtendedRelationshipFields, 
    CustomRelationshipFields, 
    RelationshipCardModel, 
    RelationshipCardModelWithId, 
    Relationship, 
    RelationshipFlat,
    BUILTIN_RELATIONSHIP_TYPES
} from './relationship-types';
import { buildHtml } from '../utils/html-builder';

/* =========================
   规则与工具
   ========================= */

// 后端隐藏键（不外发、不写文件）
const HIDDEN_BACKEND_KEYS = new Set(['packagePath', 'sourcePath']);

// 基础键（动态键不允许覆盖）
const BASE_KEYS = new Set([
    'id', 'uuid', 'fromRoleId', 'toRoleId', 'relationshipType', 'description', 
    'strength', 'isDirectional', 'startTime', 'endTime', 'status', 'tags', 'notes',
    ...Array.from(HIDDEN_BACKEND_KEYS)
]);

// 基础字段同义词（用于从动态键回填 base、以及发到前端时避免重复）
const BASE_SYNONYMS: Record<string, keyof BaseRelationshipFields> = {
    'fromRoleId': 'fromRoleId', '源角色': 'fromRoleId', '来源角色': 'fromRoleId',
    'toRoleId': 'toRoleId', '目标角色': 'toRoleId', '目的角色': 'toRoleId',
    'relationshipType': 'relationshipType', '关系类型': 'relationshipType', '类型': 'relationshipType',
    'description': 'description', '描述': 'description', '说明': 'description',
    'strength': 'strength', '强度': 'strength', '关系强度': 'strength',
    'isDirectional': 'isDirectional', '单向': 'isDirectional', '是否单向': 'isDirectional',
    'startTime': 'startTime', '开始时间': 'startTime', '起始时间': 'startTime',
    'endTime': 'endTime', '结束时间': 'endTime', '终止时间': 'endTime',
    'status': 'status', '状态': 'status', '关系状态': 'status',
    'tags': 'tags', '标签': 'tags', '标记': 'tags',
    'notes': 'notes', '备注': 'notes', '注释': 'notes'
};

// 扩展字段白名单（这些动态键会进入 extended，其余进入 custom）
const EXTENDED_WHITELIST = new Set([
    'priority', '优先级', 'weight', '权重', 'category', '分类', 'group', '组别'
]);

/* =========================
   工具函数
   ========================= */

function norm(s: string): string {
    return s.trim().toLowerCase();
}

function isEmptyish(v: any): boolean {
    return v === undefined || v === null || v === '' || 
           (Array.isArray(v) && v.length === 0) ||
           (typeof v === 'object' && Object.keys(v).length === 0);
}

function toJsonValue(raw: any): JsonValue | undefined {
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') return raw;
    if (Array.isArray(raw)) return raw.map(x => String(x));
    return String(raw);
}

function toStringArray(v: any): string[] | undefined {
    if (!v) return undefined;
    if (Array.isArray(v)) return v.map(x => String(x));
    return [String(v)];
}

/* =========================
   转换：RelationshipFlat <-> RelationshipCardModelWithId
   ========================= */

function relationshipToRelationshipCardModel(relationship: RelationshipFlat): RelationshipCardModelWithId {
    const base: BaseRelationshipFields = {
        id: relationship.id,
        uuid: relationship.uuid,
        fromRoleId: relationship.fromRoleId,
        toRoleId: relationship.toRoleId,
        relationshipType: relationship.relationshipType,
        description: relationship.description,
        strength: relationship.strength,
        isDirectional: relationship.isDirectional,
        startTime: relationship.startTime,
        endTime: relationship.endTime,
        status: relationship.status,
        tags: relationship.tags ? [...relationship.tags] : undefined,
        notes: relationship.notes
    };

    const extended: ExtendedRelationshipFields = {};
    const custom: CustomRelationshipFields = {};

    for (const [k, raw] of Object.entries(relationship)) {
        if (BASE_KEYS.has(k)) continue;
        const nk = norm(k);
        const v = toJsonValue(raw);
        if (isEmptyish(v)) continue;

        const baseKey = BASE_SYNONYMS[nk as keyof typeof BASE_SYNONYMS];
        if (baseKey) {
            if (baseKey === 'tags') {
                if (!base.tags) base.tags = toStringArray(v) ?? base.tags;
            } else if (baseKey === 'strength') {
                if (typeof base.strength !== 'number') {
                    const n = Array.isArray(v) ? Number(v[0]) : Number(v as any);
                    if (!Number.isNaN(n)) base.strength = n;
                }
            } else if (!(base as any)[baseKey]) {
                (base as any)[baseKey] = Array.isArray(v) ? (v[0] as any) : (v as any);
            }
            continue;
        }

        if (EXTENDED_WHITELIST.has(nk)) {
            const jsonValue = toJsonValue(v);
            if (jsonValue !== undefined) extended[k] = jsonValue;
        } else {
            const jsonValue = toJsonValue(v);
            if (jsonValue !== undefined) custom[k] = jsonValue;
        }
    }

    return {
        id: relationship.id,
        base,
        extended: Object.keys(extended).length ? extended : undefined,
        custom: Object.keys(custom).length ? custom : undefined,
    };
}

function relationshipCardModelToRelationshipFlat(model: RelationshipCardModelWithId, existing?: RelationshipFlat): RelationshipFlat {
    const result: RelationshipFlat = {
        id: model.id || existing?.id,
        uuid: model.base.uuid || existing?.uuid,
        fromRoleId: model.base.fromRoleId,
        toRoleId: model.base.toRoleId,
        relationshipType: model.base.relationshipType,
        description: model.base.description,
        strength: model.base.strength,
        isDirectional: model.base.isDirectional,
        startTime: model.base.startTime,
        endTime: model.base.endTime,
        status: model.base.status,
        tags: model.base.tags ? [...model.base.tags] : undefined,
        notes: model.base.notes,
        // 保留隐藏字段
        packagePath: existing?.packagePath,
        sourcePath: existing?.sourcePath,
    };

    // 合并 extended 和 custom 字段
    if (model.extended) {
        for (const [k, v] of Object.entries(model.extended)) {
            if (!isEmptyish(v)) (result as any)[k] = v;
        }
    }
    if (model.custom) {
        for (const [k, v] of Object.entries(model.custom)) {
            if (!isEmptyish(v)) (result as any)[k] = v;
        }
    }

    return result;
}

function relationshipsToCardModels(list: RelationshipFlat[]): RelationshipCardModelWithId[] {
    return list.map(relationshipToRelationshipCardModel);
}

function cardModelsToRelationships(list: RelationshipCardModelWithId[], existingById?: Map<string, RelationshipFlat>): RelationshipFlat[] {
    return list.map(m => {
        const keep = m.id && existingById ? existingById.get(m.id) : undefined;
        return relationshipCardModelToRelationshipFlat(m, keep);
    });
}

/* =========================
   JSON5 读写（文件 <-> RelationshipFlat[]）
   ========================= */

const BASE_KEY_ORDER = [
    'fromRoleId', 'toRoleId', 'relationshipType', 'description', 'strength',
    'isDirectional', 'startTime', 'endTime', 'status', 'tags', 'notes'
];

function parseRelationshipsFromText(text: string): RelationshipFlat[] {
    let data: any;
    try { data = JSON5.parse(text); } catch { return []; }
    if (!Array.isArray(data)) return [];

    const out: RelationshipFlat[] = [];
    for (const item of data) {
        if (!item || typeof item !== 'object') continue;
        const rec = item as Record<string, any>;
        const relationship: RelationshipFlat = {
            id: 'rel_' + Math.random().toString(36).slice(2), // 仅内存
            uuid: rec.uuid,
            fromRoleId: String(rec.fromRoleId ?? rec.源角色 ?? rec.来源角色 ?? '').trim(),
            toRoleId: String(rec.toRoleId ?? rec.目标角色 ?? rec.目的角色 ?? '').trim(),
            relationshipType: rec.relationshipType ?? rec.关系类型 ?? rec.类型 ?? '朋友',
            description: rec.description ?? rec.描述 ?? rec.说明,
            strength: typeof rec.strength === 'number' ? rec.strength : (typeof rec.强度 === 'number' ? rec.强度 : undefined),
            isDirectional: typeof rec.isDirectional === 'boolean' ? rec.isDirectional : (typeof rec.单向 === 'boolean' ? rec.单向 : undefined),
            startTime: rec.startTime ?? rec.开始时间 ?? rec.起始时间,
            endTime: rec.endTime ?? rec.结束时间 ?? rec.终止时间,
            status: rec.status ?? rec.状态 ?? rec.关系状态,
            tags: toStringArray(rec.tags ?? rec.标签 ?? rec.标记),
            notes: rec.notes ?? rec.备注 ?? rec.注释
        };

        // 动态键并入（忽略隐藏键与已知基础键）
        for (const [k, v] of Object.entries(rec)) {
            if (HIDDEN_BACKEND_KEYS.has(k)) continue;
            if ((relationship as any)[k] !== undefined) continue;
            if (!isEmptyish(v)) (relationship as any)[k] = Array.isArray(v) ? v.map(x => String(x)) : v;
        }
        out.push(relationship);
    }
    return out;
}

function stringifyRelationshipsToJson5(relationships: RelationshipFlat[]): string {
    const arr = relationships.map(r => {
        const rec: Record<string, any> = {};
        const put = (k: string, v: any) => { if (!isEmptyish(v)) rec[k] = v; };

        // 基础字段按顺序
        put('fromRoleId', r.fromRoleId);
        put('toRoleId', r.toRoleId);
        put('relationshipType', r.relationshipType);
        put('description', r.description);
        if (typeof r.strength === 'number' && !Number.isNaN(r.strength)) rec.strength = r.strength;
        put('isDirectional', r.isDirectional);
        put('startTime', r.startTime);
        put('endTime', r.endTime);
        put('status', r.status);
        put('tags', toStringArray(r.tags));
        put('notes', r.notes);

        // 其余动态键（展平后的扩展/自定义）
        for (const [k, v] of Object.entries(r)) {
            if (HIDDEN_BACKEND_KEYS.has(k)) continue;
            if (BASE_KEY_ORDER.includes(k)) continue;
            if (['id', 'uuid', 'fromRoleId', 'toRoleId', 'relationshipType', 'description', 'strength', 'isDirectional', 'startTime', 'endTime', 'status', 'tags', 'notes'].includes(k)) continue;
            if (!isEmptyish(v)) rec[k] = Array.isArray(v) ? v.map(x => String(x)) : v;
        }
        return rec;
    });

    return JSON5.stringify(arr, null, 2) + '\n';
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
                supportsMultipleEditorsPerDocument: true,
            }
        );

        return vscode.Disposable.from(reg);
    }

    private readonly ctx: vscode.ExtensionContext;
    private readonly opts: RelationshipJson5EditorOptions;
    private readonly existingById = new Map<string, RelationshipFlat>(); // 用于保留隐藏字段

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
                const relationships = parseRelationshipsFromText(document.getText());
                this.existingById.clear();
                for (const r of relationships) if (r.id) this.existingById.set(r.id, r);
                const payload = relationshipsToCardModels(relationships);
                webviewPanel.webview.postMessage({ type: 'relationshipCards', list: payload });
            } catch (e) {
                webviewPanel.webview.postMessage({ type: 'relationshipCards', list: [] });
                console.error('[RelationshipJson5Editor] parse error:', e);
            }
        };

        // 文档变更监听
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() !== document.uri.toString()) return;
            const key = e.document.uri.toString();
            if (this.skipOneEchoFor.has(key)) {
                this.skipOneEchoFor.delete(key);
                return;
            }
            const muteUntil = this.refreshMuteUntil.get(key) ?? 0;
            if (Date.now() < muteUntil) return;
            updateWebview();
        });

        // 保存前处理
        const willSaveSub = vscode.workspace.onWillSaveTextDocument(e => {
            if (e.document.uri.toString() !== document.uri.toString()) return;
            const key = e.document.uri.toString();
            const pending = this.pendingText.get(key);
            if (!pending) return;

            const fullRange = new vscode.Range(
                e.document.positionAt(0),
                e.document.positionAt(e.document.getText().length)
            );
            e.waitUntil(Promise.resolve([vscode.TextEdit.replace(fullRange, pending)]));

            const t = this.saveTimers.get(key);
            if (t) { clearTimeout(t); this.saveTimers.delete(key); }
            // 写入前后各给一点静音时间，避免刚保存就被回灌打断
            {
                const key = e.document.uri.toString();
                this.refreshMuteUntil.set(key, Date.now() + 800);
            }
        });

        // 保存后：清理 pending
        const didSaveSub = vscode.workspace.onDidSaveTextDocument(d => {
            if (d.uri.toString() !== document.uri.toString()) return;
            this.pendingText.delete(d.uri.toString());
        });

        // webview 消息
        webviewPanel.webview.onDidReceiveMessage(async (msg: any) => {
            if (!msg || typeof msg.type !== 'string') return;
            try {
                if (msg.type === 'requestRelationshipCards') {
                    await updateWebview();
                } else if (msg.type === 'saveRelationshipCards') {
                    const list: RelationshipCardModelWithId[] = Array.isArray(msg.list) ? msg.list : [];
                    const merged = cardModelsToRelationships(list, this.existingById);
                    const text = stringifyRelationshipsToJson5(merged);

                    // 更新 existingById（即便 off 也要更新，用于后续合并）
                    this.existingById.clear();
                    for (const r of merged) if (r.id) this.existingById.set(r.id, r);

                    // 根据 autosave 设置决定写入策略
                    const autosave = vscode.workspace.getConfiguration('files').get<string>('autoSave');
                    if (autosave === 'off') {
                        // 缓存到内存，等待手动保存
                        this.pendingText.set(key, text);
                    } else {
                        // 直接写入文档
                        this.skipOneEchoFor.add(key);
                        const edit = new vscode.WorkspaceEdit();
                        const fullRange = new vscode.Range(
                            document.positionAt(0),
                            document.positionAt(document.getText().length)
                        );
                        edit.replace(document.uri, fullRange, text);
                        await vscode.workspace.applyEdit(edit);

                        // 节流保存
                        const existingTimer = this.saveTimers.get(key);
                        if (existingTimer) clearTimeout(existingTimer);

                        if (autosave === 'afterDelay') {
                            const delay = vscode.workspace.getConfiguration('files').get<number>('autoSaveDelay') ?? 1000;
                            this.saveTimers.set(key, setTimeout(() => {
                                document.save();
                                this.saveTimers.delete(key);
                            }, delay));
                        } else {
                            // onFocusChange, onWindowChange 等：立即保存
                            this.saveTimers.set(key, setTimeout(() => {
                                document.save();
                                this.saveTimers.delete(key);
                            }, 100));
                        }
                    }
                }
            } catch (e) {
                console.error('[RelationshipJson5Editor] message error:', e);
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