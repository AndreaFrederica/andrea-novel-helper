/* eslint-disable curly */
// src/Provider/RoleJson5EditorProvider.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as JSON5 from 'json5';

/* =========================
   类型与模型（内置转换器用）
   ========================= */

export type BuiltinType = '主角' | '配角' | '联动角色' | '敏感词' | '词汇' | '正则表达式';
export type RoleType = BuiltinType | string;
export type JsonValue = string | number | boolean | null | string[];

export interface BaseFieldsCommon {
    name: string;
    type: RoleType;
    color?: string;
    priority?: number;
    description?: string;
    affiliation?: string;
    aliases?: string[] | undefined;
    fixes?: string[] | undefined;
    regex?: string | undefined;
    regexFlags?: string | undefined;
    // 词分段过滤开关，现在属于基础字段
    wordSegmentFilter?: boolean;
}
export type ExtendedFields = Record<string, JsonValue>;
export type CustomFields = Record<string, JsonValue>;
export interface RoleCardModel { base: BaseFieldsCommon; extended?: ExtendedFields; custom?: CustomFields }
export type RoleCardModelWithId = RoleCardModel & { id?: string };

export interface Role {
    name: string;
    type: BuiltinType | string;
    affiliation?: string;
    aliases?: string[];
    description?: string;
    color?: string;
    wordSegmentFilter?: boolean;
    regex?: string;
    regexFlags?: string;
    priority?: number;
    fixes?: string[];
    // 仅后端隐藏：packagePath/sourcePath（不外发、不写文件）
    packagePath?: string;
    sourcePath?: string;
}
// 平铺后的后端对象（允许动态键），并给运行期加上 id（仅内存）
// 允许动态键的值也可为 undefined，以免与可选属性冲突
export type RoleFlat = (Role & Record<string, JsonValue | undefined>) & { id?: string };

/* =========================
   规则与工具
   ========================= */

// 后端隐藏键（不外发、不写文件）
const HIDDEN_BACKEND_KEYS = new Set(['packagePath', 'sourcePath']);

// 基础键（动态键不允许覆盖）
const BASE_KEYS = new Set([
    'name', 'type', 'affiliation', 'description', 'aliases', 'color', 'regex', 'regexFlags', 'priority', 'fixes',
    'wordSegmentFilter',
    ...Array.from(HIDDEN_BACKEND_KEYS),
    'id', // 仅内存
]);

// 基础字段同义词（用于从动态键回填 base、以及发到前端时避免重复）
const BASE_SYNONYMS: Record<string, keyof BaseFieldsCommon | 'priority' | 'fixes'> = {
    'name': 'name', '名称': 'name', '名字': 'name',
    'type': 'type', '类型': 'type',
    'description': 'description', '描述': 'description',
    'color': 'color', '颜色': 'color',
    'affiliation': 'affiliation', '从属': 'affiliation',
    'alias': 'aliases', 'aliases': 'aliases', '别名': 'aliases',
    'priority': 'priority', '优先级': 'priority',
    'fixes': 'fixes', 'fixs': 'fixes',
    'wordsegmentfilter': 'wordSegmentFilter', '分词过滤': 'wordSegmentFilter',
};

// 扩展字段白名单（中英/单复数/中文同义词）——命中者在前端归类到 extended；其余进入 custom
const EXTENDED_WHITELIST = new Set([
    // 把 base 中的也纳入白名单用于分类，但最终不会进入 extended
    'name', '描述', 'description', 'type', '类型', 'color', '颜色', 'affiliation', '从属', 'alias', 'aliases', '别名',

    // 约定扩展字段
    'age', '年龄', 'gender', '性别', 'occupation', '职业', 'personality', '性格', 'appearance', '外貌', 'background', '背景',
    'relationship', 'relationships', '关系', 'skill', 'skills', '技能', 'weakness', 'weaknesses', '弱点',
    'goal', 'goals', '目标', 'motivation', '动机', 'fear', 'fears', '恐惧', 'secret', 'secrets', '秘密',
    'quote', 'quotes', '台词', 'note', 'notes', '备注', 'tag', 'tags', '标签', 'category', '分类', 'level', '等级',
    'status', '状态', 'location', '位置', 'origin', '出身', 'family', '家庭', 'education', '教育', 'hobby', 'hobbies', '爱好',
]);

const norm = (k: string) => k.trim().toLowerCase();

function isEmptyish(v: unknown): boolean {
    if (v === undefined || v === null) return true;
    if (typeof v === 'string') return v.trim().length === 0;
    if (typeof v === 'number') return Number.isNaN(v);
    if (Array.isArray(v)) return v.length === 0 || v.every(isEmptyish);
    if (typeof v === 'object') {
        const entries = Object.entries(v as Record<string, unknown>);
        return entries.length === 0 || entries.every(([, vv]) => isEmptyish(vv));
    }
    return false;
}

function toStringArray(v: unknown): string[] | undefined {
    if (isEmptyish(v)) return undefined;
    if (Array.isArray(v)) {
        const arr = v.map(x => String(x).trim()).filter(Boolean);
        return arr.length ? arr : undefined;
    }
    const s = String(v ?? '').trim();
    return s ? [s] : undefined;
}

// 收敛为 JsonValue；数组一律转 string[]
function toJsonValue(v: unknown): JsonValue {
    if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v as JsonValue;
    if (Array.isArray(v)) return v.map(x => String(x ?? '').trim()).filter(Boolean) as string[];
    try { return JSON.stringify(v); } catch { return String(v); }
}

/* =========================
   转换：RoleFlat <-> RoleCardModelWithId
   ========================= */

function roleToRoleCardModel(role: RoleFlat): RoleCardModelWithId {
    const base: BaseFieldsCommon = {
        name: role.name,
        type: role.type,
        color: role.color,
        priority: role.priority,
        description: role.description,
        affiliation: role.affiliation,
        aliases: role.aliases ? [...role.aliases] : undefined,
        fixes: role.fixes ? [...role.fixes] : undefined,
        regex: role.regex,
        regexFlags: role.regexFlags,
    wordSegmentFilter: typeof role.wordSegmentFilter === 'boolean' ? role.wordSegmentFilter : undefined,
    };

    const extended: ExtendedFields = {};
    const custom: CustomFields = {};

    for (const [k, raw] of Object.entries(role)) {
        if (BASE_KEYS.has(k)) continue;
        const nk = norm(k);
        const v = toJsonValue(raw);
        if (isEmptyish(v)) continue;

        const baseKey = BASE_SYNONYMS[nk as keyof typeof BASE_SYNONYMS];
        if (baseKey) {
            if (baseKey === 'aliases') {
                if (!base.aliases) base.aliases = toStringArray(v) ?? base.aliases;
            } else if (baseKey === 'priority') {
                if (typeof base.priority !== 'number') {
                    const n = Array.isArray(v) ? Number(v[0]) : Number(v as any);
                    if (!Number.isNaN(n)) base.priority = n;
                }
                    } else if (!base[baseKey as keyof BaseFieldsCommon]) {
                        (base as any)[baseKey] = Array.isArray(v) ? (v[0] as any) : (v as any);
            }
            continue;
        }

        if (EXTENDED_WHITELIST.has(nk)) extended[k] = v;
        else custom[k] = v;
    }

    return {
        id: role.id,
        base,
        extended: Object.keys(extended).length ? extended : undefined,
        custom: Object.keys(custom).length ? custom : undefined,
    };
}

function roleCardModelToRoleFlat(model: RoleCardModelWithId, existing?: RoleFlat): RoleFlat {
    const base = model.base;
    const out: RoleFlat = {
        ...(existing ?? ({} as RoleFlat)),
        id: model.id ?? existing?.id,
        name: !isEmptyish(base.name) ? base.name : (existing?.name ?? ''),
        type: !isEmptyish(base.type) ? base.type : (existing?.type ?? '词汇'),
    };

    const setIf = <K extends keyof RoleFlat>(key: K, val: unknown) => {
        if (!isEmptyish(val)) (out as any)[key] = val;
    };
    setIf('affiliation', base.affiliation);
    setIf('aliases', toStringArray(base.aliases));
    setIf('description', base.description);
    setIf('color', base.color);
    setIf('regex', base.regex);
    setIf('regexFlags', base.regexFlags);
    if (typeof base.priority === 'number' && !Number.isNaN(base.priority)) out.priority = base.priority;
    setIf('fixes', toStringArray(base.fixes));

    // 展平：extended -> custom（custom 覆盖 extended）；禁止覆盖基础/隐藏字段或其同义词
    const flatten = (bag?: Record<string, unknown>) => {
        if (!bag || typeof bag !== 'object') return;
        for (const [k, val] of Object.entries(bag)) {
            const nk = norm(k);
            if (BASE_KEYS.has(k) || BASE_SYNONYMS[nk as keyof typeof BASE_SYNONYMS]) continue;
            const v = toJsonValue(val);
            if (isEmptyish(v)) continue;
            out[k] = v;
        }
    };
    flatten(model.extended);
    flatten(model.custom);

    // 不要从前端接受或覆盖隐藏字段（packagePath/sourcePath）
    if (existing) {
        out.packagePath = existing.packagePath;
        out.sourcePath = existing.sourcePath;
    } else {
        delete out.packagePath;
        delete out.sourcePath;
    }

    return out;
}

function rolesToCardModels(list: RoleFlat[]): RoleCardModelWithId[] {
    return list.map(roleToRoleCardModel);
}
function cardModelsToRoles(list: RoleCardModelWithId[], existingById?: Map<string, RoleFlat>): RoleFlat[] {
    return list.map(m => {
        const keep = m.id && existingById ? existingById.get(m.id) : undefined;
        return roleCardModelToRoleFlat(m, keep);
    });
}

/* =========================
   JSON5 读写（文件 <-> RoleFlat[]）
   ========================= */

const BASE_KEY_ORDER = [
    'name', 'type', 'affiliation', 'description', 'aliases',
    'color', 'wordSegmentFilter', 'regex', 'regexFlags', 'priority', 'fixes',
];

function parseRolesFromText(text: string): RoleFlat[] {
    let data: any;
    try { data = JSON5.parse(text); } catch { return []; }
    if (!Array.isArray(data)) return [];

    const out: RoleFlat[] = [];
    for (const item of data) {
        if (!item || typeof item !== 'object') continue;
        const rec = item as Record<string, any>;
        const role: RoleFlat = {
            id: 'r_' + Math.random().toString(36).slice(2), // 仅内存
            name: String(rec.name ?? rec.名称 ?? '').trim(),
            type: rec.type ?? rec.类型 ?? '词汇',
            affiliation: rec.affiliation ?? rec.从属,
            description: rec.description ?? rec.描述,
            aliases: toStringArray(rec.aliases ?? rec.alias ?? rec.别名),
            color: rec.color ?? rec.颜色,
        wordSegmentFilter: (typeof rec.wordSegmentFilter === 'boolean') ? rec.wordSegmentFilter : (typeof rec['分词过滤'] === 'boolean' ? rec['分词过滤'] : undefined),
            regex: rec.regex,
            regexFlags: rec.regexFlags,
            priority: typeof rec.priority === 'number' ? rec.priority : undefined,
            fixes: toStringArray(rec.fixes ?? rec.fixs),
        };
        // 动态键并入（忽略隐藏键与已知基础键）
        for (const [k, v] of Object.entries(rec)) {
            if (HIDDEN_BACKEND_KEYS.has(k)) continue;
            if (k in role) continue;
            if (!isEmptyish(v)) role[k] = Array.isArray(v) ? v.map(x => String(x)) : v;
        }
        out.push(role);
    }
    return out;
}

function stringifyRolesToJson5(roles: RoleFlat[]): string {
    const arr = roles.map(r => {
        const rec: Record<string, any> = {};
        const put = (k: string, v: any) => { if (!isEmptyish(v)) rec[k] = v; };

        // 基础字段按顺序
        put('name', r.name);
        put('type', r.type);
        put('affiliation', r.affiliation);
        put('description', r.description);
        put('aliases', toStringArray(r.aliases));
        put('color', r.color);
    put('wordSegmentFilter', r.wordSegmentFilter);
        put('regex', r.regex);
        put('regexFlags', r.regexFlags);
        if (typeof r.priority === 'number' && !Number.isNaN(r.priority)) rec.priority = r.priority;
        put('fixes', toStringArray(r.fixes));

        // 其余动态键（展平后的扩展/自定义）
        for (const [k, v] of Object.entries(r)) {
            if (HIDDEN_BACKEND_KEYS.has(k)) continue;
            if (BASE_KEY_ORDER.includes(k)) continue;
            if (['name', 'type', 'affiliation', 'description', 'aliases', 'color', 'regex', 'regexFlags', 'priority', 'fixes', 'id'].includes(k)) continue;
            if (!isEmptyish(v)) rec[k] = Array.isArray(v) ? v.map(x => String(x)) : v;
        }
        return rec;
    });

    return JSON5.stringify(arr, null, 2) + '\n';
}

/* =========================
   Webview HTML（复用你面板里的构建逻辑，内置一份）
   ========================= */

function readFile(fp: string): string {
    return fs.readFileSync(fp, 'utf-8');
}
function normalizeRel(p: string): string {
    if (p.startsWith('/')) return p.slice(1);
    if (p.startsWith('./')) return p.replace(/^\.\/+/, '');
    return p;
}
function rewriteHtmlToWebviewUris(html: string, webview: vscode.Webview, spaRoot: vscode.Uri): string {
    type Attr = 'src' | 'href';
    const fixRelFromVscodeWebview = (u: string) => {
        const m = u.match(/^vscode-webview:\/\/[^/]+\/(.*)$/i);
        return m ? normalizeRel(m[1]) : normalizeRel(u);
    };
    const replaceAttr = (tag: string, attr: Attr) => {
        const re = new RegExp(`<${tag}\\b([^>]*?)\\s${attr}\\s*=\\s*(?:"([^"]+)"|'([^']+)'|([^\\s>]+))([^>]*)>`, 'gi');
        html = html.replace(re, (m, pre, g1, g2, g3, post) => {
            const raw = g1 ?? g2 ?? g3 ?? '';
            if (/^(data:|mailto:|javascript:|#|https?:)/i.test(raw)) return m;
            const rel = fixRelFromVscodeWebview(raw);
            const fileUri = vscode.Uri.joinPath(spaRoot, rel);
            const webUri = webview.asWebviewUri(fileUri).toString();
            const quoted = (g1 !== null && g1 !== undefined) ? `"${webUri}"` : ((g2 !== null && g2 !== undefined) ? `'${webUri}'` : webUri);
            return `<${tag}${pre} ${attr}=${quoted}${post}>`;
        });
    };
    replaceAttr('script', 'src');
    replaceAttr('link', 'href');
    replaceAttr('img', 'src');
    replaceAttr('source', 'src');
    replaceAttr('video', 'src');
    replaceAttr('audio', 'src');
    replaceAttr('iframe', 'src');
    return html;
}
function injectResourceMapper(html: string, webview: vscode.Webview, spaRoot: vscode.Uri, mapperScriptUri?: string): string {
    const baseUri = webview.asWebviewUri(spaRoot).toString().replace(/\/$/, '');
    const assetsPath = vscode.Uri.joinPath(spaRoot, 'assets').fsPath;
    const resourceMap: Record<string, string> = {};
    try {
        if (fs.existsSync(assetsPath)) {
            for (const file of fs.readdirSync(assetsPath)) {
                const key = `/assets/${file}`;
                const val = webview.asWebviewUri(vscode.Uri.joinPath(spaRoot, 'assets', file)).toString();
                resourceMap[key] = val;
            }
        }
    } catch (e) {
        console.warn('Failed to scan assets directory:', e);
    }
    const safeResourceMap = JSON.stringify(resourceMap).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
    const safeBaseUri = baseUri.replace(/"/g, '\\"');
    const injectedData = `<script>window.__vscode_resource_map__ = ${safeResourceMap}; window.__vscode_resource_baseUri__ = "${safeBaseUri}";</script>`;
    const injectedScript = injectedData + (mapperScriptUri ? `\n<script src="${mapperScriptUri}"></script>` : '');
    return html.replace(/<head([^>]*)>/i, `<head$1>\n${injectedScript}`);
}
function fixAllAssetUrls(html: string, webview: vscode.Webview, spaRoot: vscode.Uri): string {
    const base = webview.asWebviewUri(spaRoot).toString().replace(/\/$/, '');
    html = html.replace(/(\s(?:href|src)\s*=\s*)(["'])\/assets\//gi, (_m, p1, q) => `${p1}${q}${base}/assets/`);
    html = html.replace(/(\s(?:href|src)\s*=\s*)(["'])(?:\.\/)?assets\//gi, (_m, p1, q) => `${p1}${q}${base}/assets/`);
    html = html.replace(/(import\s*\(\s*)(["'`])([^"'`]*\/assets\/[^"'`]*)\2/g, (match, prefix, quote, path) => {
        const normalizedPath = path.replace(/^\.?\//, '');
        return `${prefix}${quote}${base}/${normalizedPath}${quote}`;
    });
    html = html.replace(/(["'`])\/assets\//g, `$1${base}/assets/`);
    html = html.replace(/(["'`])\.\/assets\//g, `$1${base}/assets/`);
    html = html.replace(/(['"`])assets\//g, `$1${base}/assets/`);
    return html;
}
function applyCsp(html: string, webview: vscode.Webview, connectSrcExtra: string[] = []): string {
    const connectSrc = [webview.cspSource, ...connectSrcExtra].join(' ');
    const csp = [
        `default-src 'none';`,
        `img-src ${webview.cspSource} https: data: blob:;`,
        `style-src ${webview.cspSource} 'unsafe-inline';`,
        `font-src ${webview.cspSource} data:;`,
        `script-src ${webview.cspSource} https: 'unsafe-inline';`,
        `connect-src ${connectSrc};`,
        `frame-src 'none';`,
        `worker-src ${webview.cspSource} blob:;`,
        `child-src ${webview.cspSource} blob:;`,
    ].join(' ');
    if (/<meta http-equiv="Content-Security-Policy"/i.test(html)) {
        return html.replace(
            /<meta http-equiv="Content-Security-Policy"[^>]*>/i,
            `<meta http-equiv="Content-Security-Policy" content="${csp}">`
        );
    }
    return html.replace(/<head([^>]*)>/i, `<head$1>\n  <meta http-equiv="Content-Security-Policy" content="${csp}">`);
}
function addBaseTag(html: string): string {
    return html.replace(/<base\s+[^>]*>/gi, '');
}
function buildHtml(webview: vscode.Webview, opts: { spaRoot: vscode.Uri; connectSrc?: string[]; resourceMapperScriptUri?: string }): string {
    const indexHtmlUri = vscode.Uri.joinPath(opts.spaRoot, 'index.html');
    const indexHtmlPath = indexHtmlUri.fsPath;
    if (!fs.existsSync(indexHtmlPath)) {
        return `<html><body><h3>角色 JSON5 编辑器</h3><p>未找到 index.html：<code>${indexHtmlPath}</code></p></body></html>`;
    }
    let html = readFile(indexHtmlPath);
    html = rewriteHtmlToWebviewUris(html, webview, opts.spaRoot);
    html = fixAllAssetUrls(html, webview, opts.spaRoot);
    html = injectResourceMapper(html, webview, opts.spaRoot, opts.resourceMapperScriptUri);
    html = addBaseTag(html);
    html = applyCsp(html, webview, opts.connectSrc ?? ['https:', 'http:']);
    return html;
}

/* =========================
   提供器实现
   ========================= */

export interface RoleJson5EditorOptions {
    spaRoot: vscode.Uri;
    connectSrc?: string[];
    retainContextWhenHidden?: boolean;
    title?: string;
    resourceMapperScriptUri?: string;
}

export class RoleJson5EditorProvider implements vscode.CustomTextEditorProvider {
    public static register(context: vscode.ExtensionContext, opts: RoleJson5EditorOptions): vscode.Disposable {
        const provider = new RoleJson5EditorProvider(context, opts);
        return vscode.window.registerCustomEditorProvider(
            'andrea.roleJson5Editor',
            provider,
            {
                webviewOptions: { retainContextWhenHidden: opts.retainContextWhenHidden ?? true },
                supportsMultipleEditorsPerDocument: true,
            }
        );
    }

    private readonly ctx: vscode.ExtensionContext;
    private readonly opts: RoleJson5EditorOptions;
    private readonly existingById = new Map<string, RoleFlat>(); // 用于保留隐藏字段（packagePath/sourcePath）

    constructor(ctx: vscode.ExtensionContext, opts: RoleJson5EditorOptions) {
        this.ctx = ctx;
        this.opts = opts;
    }

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        panel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        panel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this.opts.spaRoot,
                vscode.Uri.joinPath(this.ctx.extensionUri, 'src', 'Provider', 'view'),
            ],
        };
        // 生成 Webview HTML
        panel.webview.html = buildHtml(panel.webview, {
            spaRoot: this.opts.spaRoot,
            connectSrc: this.opts.connectSrc ?? ['https:', 'http:'],
            resourceMapperScriptUri: this.getMapperScriptUri(panel.webview),
        });

        const updateWebview = async () => {
            try {
                const roles = parseRolesFromText(document.getText());
                this.existingById.clear();
                for (const r of roles) if (r.id) this.existingById.set(r.id, r);
                const payload = rolesToCardModels(roles);
                panel.webview.postMessage({ type: 'roleCards', list: payload });
            } catch (e) {
                panel.webview.postMessage({ type: 'roleCards', list: [] });
                console.error('[RoleJson5Editor] parse error:', e);
            }
        };

        await updateWebview();

        // 文档变化 -> 刷新 webview
        const changeSub = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString()) {
                void updateWebview();
            }
        });

        // webview 消息
        panel.webview.onDidReceiveMessage(async (msg: any) => {
            if (!msg || typeof msg.type !== 'string') return;
            try {
                if (msg.type === 'requestRoleCards') {
                    await updateWebview();
                } else if (msg.type === 'saveRoleCards') {
                    const list: RoleCardModelWithId[] = Array.isArray(msg.list) ? msg.list : [];
                    const merged = cardModelsToRoles(list, this.existingById);
                    const text = stringifyRolesToJson5(merged);
                    await this.replaceWholeDocument(document, text);
                    // 更新 existing
                    this.existingById.clear();
                    for (const r of merged) if (r.id) this.existingById.set(r.id, r);
                    panel.webview.postMessage({ type: 'saveAck', ok: true });
                }
            } catch (e) {
                panel.webview.postMessage({ type: 'saveAck', ok: false, error: String(e) });
            }
        }, undefined, this.ctx.subscriptions);

        panel.onDidDispose(() => changeSub.dispose());
    }

    /* ---------------- helpers ---------------- */

    private getMapperScriptUri(webview: vscode.Webview): string | undefined {
        try {
            const mapperFile = vscode.Uri.joinPath(this.ctx.extensionUri, 'src', 'Provider', 'view', 'resource-mapper.js');
            return webview.asWebviewUri(mapperFile).toString();
        } catch {
            return undefined;
        }
    }

    private async replaceWholeDocument(document: vscode.TextDocument, text: string): Promise<void> {
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(0, 0, document.lineCount, 0);
        edit.replace(document.uri, fullRange, text);
        await vscode.workspace.applyEdit(edit);
    }
}

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        RoleJson5EditorProvider.register(context, {
            spaRoot: vscode.Uri.joinPath(context.extensionUri, "packages", "webview", "dist", "spa"),
            retainContextWhenHidden: true
        })
    );
}