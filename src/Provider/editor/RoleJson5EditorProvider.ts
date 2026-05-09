/* eslint-disable curly */
// src/Provider/RoleJson5EditorProvider.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as JSON5 from 'json5';
import { hoverRangesMap } from '../hoverProvider';
import {
    applyGeneratedLookupKeys,
    getRequestedLookupKeyCandidates,
    type LookupKeyGenerationKind,
} from '../../utils/roleLookupKeyGeneration';
import { nameGeneratorService } from '../../services/nameGeneratorService';
import type { GeneratedName, NameGenerationOptions } from '../../types/names';
import { generateRoleNameHash } from '../../utils/uuidUtils';
import { uniqueRoleKeys } from '../../utils/roleLookupKeys';

/* =========================
   类型与模型（内置转换器用）
   ========================= */

export type BuiltinType = '主角' | '配角' | '联动角色' | '敏感词' | '词汇' | '正则表达式';
export type RoleType = BuiltinType | string;
export type JsonValue = string | number | boolean | null | string[] | TextStyleOptions | Record<string, any>;

/** 文本样式配置 */
export interface TextStyleOptions {
    /** 前景色 */
    color?: string;
    /** 背景色 */
    backgroundColor?: string;
    /** 是否粗体 */
    bold?: boolean;
    /** 是否斜体 */
    italic?: boolean;
    /** 是否删除线 */
    strikethrough?: boolean;
    /** 是否下划线 */
    underline?: boolean;
}

export interface BaseFieldsCommon {
    name: string;
    type: RoleType;
    uuid?: string; // 角色唯一标识符 (UUID v7)
    /** 前景色（旧字段，保持兼容） */
    color?: string;
    /** 文本样式（新字段，支持多种样式） */
    style?: TextStyleOptions;
    priority?: number;
    description?: string;
    affiliation?: string;
    aliases?: string[] | undefined;
    lookupKeys_pinyin?: string[] | undefined;
    lookupKeys_romanized?: string[] | undefined;
    lookupKeys_spelling?: string[] | undefined;
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
    uuid?: string; // 角色唯一标识符 (UUID v7)
    affiliation?: string;
    aliases?: string[];
    description?: string;
    color?: string;
    /** 文本样式（新字段） */
    style?: TextStyleOptions;
    /** 背景色（兼容旧格式） */
    backgroundColor?: string;
    /** 是否粗体（兼容旧格式） */
    bold?: boolean;
    /** 是否斜体（兼容旧格式） */
    italic?: boolean;
    /** 是否删除线（兼容旧格式） */
    strikethrough?: boolean;
    /** 是否下划线（兼容旧格式） */
    underline?: boolean;
    wordSegmentFilter?: boolean;
    regex?: string;
    regexFlags?: string;
    priority?: number;
    fixes?: string[];
    lookupKeys_pinyin?: string[];
    lookupKeys_romanized?: string[];
    lookupKeys_spelling?: string[];
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
    'name', 'type', 'uuid', 'affiliation', 'description', 'aliases', 'lookupKeys_pinyin', 'lookupKeys_romanized', 'lookupKeys_spelling', 'color', 'regex', 'regexFlags', 'priority', 'fixes',
    'wordSegmentFilter',
    'style', 'backgroundColor', 'bold', 'italic', 'strikethrough', 'underline', // 样式字段
    ...Array.from(HIDDEN_BACKEND_KEYS),
    'id', // 仅内存
]);

// 基础字段同义词（用于从动态键回填 base、以及发到前端时避免重复）
const BASE_SYNONYMS: Record<string, keyof BaseFieldsCommon | 'priority' | 'fixes' | 'style'> = {
    'name': 'name', '名称': 'name', '名字': 'name',
    'type': 'type', '类型': 'type',
    'description': 'description', '描述': 'description',
    'color': 'color', '颜色': 'color',
    'affiliation': 'affiliation', '从属': 'affiliation',
    'alias': 'aliases', 'aliases': 'aliases', '别名': 'aliases',
    'lookupkeys_pinyin': 'lookupKeys_pinyin', '拼音查询键': 'lookupKeys_pinyin', '拼音检索键': 'lookupKeys_pinyin',
    'lookupkeys_romanized': 'lookupKeys_romanized', '罗马字查询键': 'lookupKeys_romanized', '罗马字检索键': 'lookupKeys_romanized',
    'lookupkeys_spelling': 'lookupKeys_spelling', '拼写查询键': 'lookupKeys_spelling', '拼写检索键': 'lookupKeys_spelling',
    'priority': 'priority', '优先级': 'priority',
    'fixes': 'fixes', 'fixs': 'fixes',
    'wordsegmentfilter': 'wordSegmentFilter', '分词过滤': 'wordSegmentFilter',
    'style': 'style', '样式': 'style',
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
        uuid: role.uuid,
        // 兼容：若仅存在 style.color，也回填到 base.color 供前端颜色输入框编辑
        color: role.color ?? ((role.style && typeof role.style === 'object') ? (role.style as TextStyleOptions).color : undefined),
        priority: role.priority,
        description: role.description,
        affiliation: role.affiliation,
        aliases: role.aliases ? [...role.aliases] : undefined,
        lookupKeys_pinyin: role.lookupKeys_pinyin ? [...role.lookupKeys_pinyin] : undefined,
        lookupKeys_romanized: role.lookupKeys_romanized ? [...role.lookupKeys_romanized] : undefined,
        lookupKeys_spelling: role.lookupKeys_spelling ? [...role.lookupKeys_spelling] : undefined,
        fixes: role.fixes ? [...role.fixes] : undefined,
        regex: role.regex,
        regexFlags: role.regexFlags,
        wordSegmentFilter: typeof role.wordSegmentFilter === 'boolean' ? role.wordSegmentFilter : undefined,
    };

    // 处理 style 字段（优先使用 style 对象，否则从单独字段构建）
    const styleObj: TextStyleOptions = {};
    if (role.style && typeof role.style === 'object') {
        Object.assign(styleObj, role.style);
    }
    // 兼容旧格式：补齐 style 缺失字段
    if (!styleObj.color && role.color) styleObj.color = role.color;
    if (!styleObj.backgroundColor && role.backgroundColor) styleObj.backgroundColor = role.backgroundColor;
    if (styleObj.bold === undefined && role.bold) styleObj.bold = true;
    if (styleObj.italic === undefined && role.italic) styleObj.italic = true;
    if (styleObj.strikethrough === undefined && role.strikethrough) styleObj.strikethrough = true;
    if (styleObj.underline === undefined && role.underline) styleObj.underline = true;
    if (Object.keys(styleObj).length > 0) {
        base.style = styleObj;
    }

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
            } else if (baseKey === 'style') {
                // style 是特殊字段，需要解析 JSON
                if (!base.style) {
                    try {
                        base.style = typeof v === 'string' ? JSON.parse(v) : v;
                    } catch { /* ignore */ }
                }
            } else if (!(base as any)[baseKey]) {
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

    // 清理旧样式残留，后续按当前前端状态重新生成。
    delete (out as any).style;
    delete (out as any).color;
    delete (out as any).backgroundColor;
    delete (out as any).bold;
    delete (out as any).italic;
    delete (out as any).strikethrough;
    delete (out as any).underline;

    setIf('affiliation', base.affiliation);
    setIf('uuid', base.uuid);
    setIf('aliases', toStringArray(base.aliases));
    setIf('lookupKeys_pinyin', toStringArray(base.lookupKeys_pinyin));
    setIf('lookupKeys_romanized', toStringArray(base.lookupKeys_romanized));
    setIf('lookupKeys_spelling', toStringArray(base.lookupKeys_spelling));
    setIf('description', base.description);

    const normalizedStyle: TextStyleOptions = {};
    if (base.style && typeof base.style === 'object') {
        Object.assign(normalizedStyle, base.style as TextStyleOptions);
    }
    // 前端颜色输入框编辑的是 base.color，这里统一覆盖到 style.color，避免旧值回写。
    if (!isEmptyish(base.color)) {
        normalizedStyle.color = String(base.color);
    } else {
        delete normalizedStyle.color;
    }

    setIf('regex', base.regex);
    setIf('regexFlags', base.regexFlags);
    if (typeof base.priority === 'number' && !Number.isNaN(base.priority)) out.priority = base.priority;
    setIf('fixes', toStringArray(base.fixes));

    // 保留顶层 color 兼容旧渲染逻辑，同时以 style 为主。
    setIf('color', base.color);

    // 仅保存 style 对象，不展开到单独字段。
    if (normalizedStyle.color || normalizedStyle.backgroundColor || normalizedStyle.bold || normalizedStyle.italic || normalizedStyle.strikethrough || normalizedStyle.underline) {
        setIf('style', normalizedStyle);
    }

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

function buildSpellingLookupVariants(values: Array<string | undefined | null>): string[] {
    const variants: string[] = [];
    for (const value of values) {
        const trimmed = value?.trim();
        if (!trimmed || !/[A-Za-z\u00C0-\u024F]/.test(trimmed)) continue;

        const noDots = trimmed.replace(/[·・]/g, ' ');
        const noDiacritics = noDots.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
        const collapsed = noDiacritics.replace(/[\s\-_'’]+/g, '');
        const hyphenless = noDiacritics.replace(/[\-_'’]+/g, ' ');

        variants.push(trimmed, noDots, noDiacritics, hyphenless, collapsed);
        variants.push(trimmed.toLowerCase(), noDots.toLowerCase(), noDiacritics.toLowerCase(), hyphenless.toLowerCase(), collapsed.toLowerCase());
    }
    return uniqueRoleKeys(variants.filter(Boolean));
}

function shouldPopulatePinyinLookup(candidate: GeneratedName): boolean {
    const signals = [
        candidate.origin,
        candidate.culture,
    ].filter(Boolean).join(' ').toLowerCase();
    return /(chinese|china|mandarin|pinyin|zhong|han|zh_cn|zh_tw)/.test(signals);
}

function buildGeneratedRoleCard(candidate: GeneratedName, options: NameGenerationOptions & { roleType?: string; affiliation?: string; color?: string }): RoleCardModelWithId {
    const aliases = uniqueRoleKeys([
        candidate.translation,
        candidate.alternativeFullName,
        candidate.original,
    ].filter((value): value is string => Boolean(value?.trim() && value.trim() !== candidate.fullName)));
    const spellingLookupKeys = buildSpellingLookupVariants([
        candidate.fullName,
        candidate.translation,
        candidate.alternativeFullName,
        candidate.original,
        ...aliases,
    ]);
    const base: BaseFieldsCommon = {
        uuid: generateRoleNameHash(candidate.fullName),
        name: candidate.fullName,
        type: options.roleType || '配角',
        description: `${candidate.fullName} - ${candidate.origin}`,
        aliases: aliases.length ? aliases : undefined,
        lookupKeys_spelling: spellingLookupKeys.length ? spellingLookupKeys : undefined,
        lookupKeys_romanized: spellingLookupKeys.length ? spellingLookupKeys : undefined,
        lookupKeys_pinyin: shouldPopulatePinyinLookup(candidate) && spellingLookupKeys.length ? spellingLookupKeys : undefined,
        affiliation: options.affiliation || undefined,
        color: options.color || undefined,
    };
    return {
        id: `generated_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        base,
        custom: {
            origin: 'Andrea Novel Helper - 随机生成',
            generation_culture: candidate.culture,
            generation_gender: candidate.gender,
            generation_style: candidate.style,
            generation_origin: candidate.origin,
        },
    };
}

/* =========================
   JSON5 读写（文件 <-> RoleFlat[]）
   ========================= */

const BASE_KEY_ORDER = [
    'name', 'type', 'affiliation', 'description', 'aliases', 'lookupKeys_pinyin', 'lookupKeys_romanized', 'lookupKeys_spelling',
    'color', 'style', 'backgroundColor', 'bold', 'italic', 'strikethrough', 'underline',
    'wordSegmentFilter', 'regex', 'regexFlags', 'priority', 'fixes',
];

function parseRolesFromText(text: string, resourcePath?: string): RoleFlat[] {
    const trimmed = (text || '').trim();
    if (!trimmed) {
        return [];
    }

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
            lookupKeys_pinyin: toStringArray(rec.lookupKeys_pinyin ?? rec['拼音查询键'] ?? rec['拼音检索键']),
            lookupKeys_romanized: toStringArray(rec.lookupKeys_romanized ?? rec['罗马字查询键'] ?? rec['罗马字检索键']),
            lookupKeys_spelling: toStringArray(rec.lookupKeys_spelling ?? rec['拼写查询键'] ?? rec['拼写检索键']),
            color: rec.color ?? rec.颜色,
            style: rec.style,
            backgroundColor: rec.backgroundColor,
            bold: typeof rec.bold === 'boolean' ? rec.bold : undefined,
            italic: typeof rec.italic === 'boolean' ? rec.italic : undefined,
            strikethrough: typeof rec.strikethrough === 'boolean' ? rec.strikethrough : undefined,
            underline: typeof rec.underline === 'boolean' ? rec.underline : undefined,
            wordSegmentFilter: (typeof rec.wordSegmentFilter === 'boolean') ? rec.wordSegmentFilter : (typeof rec['分词过滤'] === 'boolean' ? rec['分词过滤'] : undefined),
            regex: rec.regex,
            regexFlags: rec.regexFlags,
            priority: typeof rec.priority === 'number' ? rec.priority : undefined,
            fixes: toStringArray(rec.fixes ?? rec.fixs),
        };
        // 动态键并入（忽略隐藏键与已知基础键）
        for (const [k, v] of Object.entries(rec)) {
            if (HIDDEN_BACKEND_KEYS.has(k)) continue;
            if ((role as any)[k] !== undefined) continue;
            if (!isEmptyish(v)) (role as any)[k] = Array.isArray(v) ? v.map(x => String(x)) : v;
        }
        out.push(applyGeneratedLookupKeys(role, resourcePath));
    }
    return out;
}

function validateRoleJson5Text(text: string): { ok: boolean; reason?: string } {
    const trimmed = (text || '').trim();
    if (!trimmed) {
        return { ok: true };
    }

    let data: any;
    try {
        data = JSON5.parse(text);
    } catch (e: any) {
        return { ok: false, reason: `JSON5 解析失败: ${e?.message ?? String(e)}` };
    }

    return { ok: true };
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
        put('lookupKeys_pinyin', toStringArray(r.lookupKeys_pinyin));
        put('lookupKeys_romanized', toStringArray(r.lookupKeys_romanized));
        put('lookupKeys_spelling', toStringArray(r.lookupKeys_spelling));
        put('color', r.color);
        put('style', r.style);
        put('backgroundColor', r.backgroundColor);
        put('bold', r.bold);
        put('italic', r.italic);
        put('strikethrough', r.strikethrough);
        put('underline', r.underline);
        put('wordSegmentFilter', r.wordSegmentFilter);
        put('regex', r.regex);
        put('regexFlags', r.regexFlags);
        if (typeof r.priority === 'number' && !Number.isNaN(r.priority)) rec.priority = r.priority;
        put('fixes', toStringArray(r.fixes));

        // 其余动态键（展平后的扩展/自定义）
        for (const [k, v] of Object.entries(r)) {
            if (HIDDEN_BACKEND_KEYS.has(k)) continue;
            if (BASE_KEY_ORDER.includes(k)) continue;
            if (['name', 'type', 'affiliation', 'description', 'aliases', 'lookupKeys_pinyin', 'lookupKeys_romanized', 'lookupKeys_spelling', 'color', 'style', 'backgroundColor', 'bold', 'italic', 'strikethrough', 'underline', 'regex', 'regexFlags', 'priority', 'fixes', 'id'].includes(k)) continue;
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
function injectVscodeLanguage(html: string): string {
    const language = JSON.stringify(vscode.env.language || 'en');
    const script = `<script>window.__vscode_language__=${language};document.documentElement.lang=${language};</script>`;
    return html.replace(/<head([^>]*)>/i, `<head$1>\n  ${script}`);
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
    html = injectVscodeLanguage(html);
    html = applyCsp(html, webview, opts.connectSrc ?? ['https:', 'http:']);
    return html;
}

const ROLE_EDITOR_LOCALIZED_KEY_LABELS = 'roleEditor.localizedKeyLabels';

function getRoleEditorSettings(resource?: vscode.Uri) {
    return {
        type: 'roleEditorSettings',
        localizedKeyLabels: vscode.workspace
            .getConfiguration('AndreaNovelHelper', resource)
            .get<boolean>(ROLE_EDITOR_LOCALIZED_KEY_LABELS, true),
        displayLanguage: vscode.env.language || 'en',
    };
}

async function updateRoleEditorSettings(msg: any, resource?: vscode.Uri): Promise<void> {
    if (typeof msg?.localizedKeyLabels !== 'boolean') return;
    await vscode.workspace
        .getConfiguration('AndreaNovelHelper', resource)
        .update(ROLE_EDITOR_LOCALIZED_KEY_LABELS, msg.localizedKeyLabels, vscode.ConfigurationTarget.Global);
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

    // 文档刷新静音窗口：在我们自己写入后的短时间内，忽略 doc-change → updateWebview
    private readonly refreshMuteUntil = new Map<string, number>();


    public static register(context: vscode.ExtensionContext, opts: RoleJson5EditorOptions): vscode.Disposable {
        const provider = new RoleJson5EditorProvider(context, opts);

        const reg = vscode.window.registerCustomEditorProvider(
            'andrea.roleJson5Editor',
            provider,
            {
                webviewOptions: { retainContextWhenHidden: opts.retainContextWhenHidden ?? true },
                supportsMultipleEditorsPerDocument: true,
            }
        );

        // 新增：对外开放的 def 事件命令
        const defCmd = vscode.commands.registerCommand('andrea.roleJson5Editor.def', async (...args: any[]) => {
            // Debug: log raw received arguments for diagnostics
            try {
                console.log('[andrea.roleJson5Editor.def] raw args:', JSON.stringify(args));
            } catch (e) {
                console.log('[andrea.roleJson5Editor.def] raw args (non-serializable):', args);
            }
            let name: string | undefined;
            let filePath: string | undefined;

            if (args.length >= 2 && typeof args[0] === 'string' && typeof args[1] === 'string') {
                [name, filePath] = args as [string, string];               // ← 推荐路径（二元组）
            } else if (args.length === 1 && args[0]) {
                const a0 = typeof args[0] === 'string' ? (() => { try { return JSON.parse(args[0]); } catch { return undefined; } })() : args[0];
                if (a0 && typeof a0 === 'object') {
                    name = a0.name ?? a0.roleName;
                    filePath = a0.path ?? a0.filePath;
                }
            }

            // ===== 在这里插入兜底 START =====
            if (!name || !filePath) {
                const ed = vscode.window.activeTextEditor;
                if (ed) {
                    const key = ed.document.uri.toString();
                    const pos = ed.selection.active;
                    // 从 hoverRangesMap 反查命中角色
                    const hit = (hoverRangesMap.get(key) || []).find(h => h.range.contains(pos));
                    const r = hit?.role as Role | undefined;
                    if (r?.sourcePath && (r.sourcePath.toLowerCase().endsWith('.json5') || r.sourcePath.toLowerCase().endsWith('.ojson5'))) {
                        name = r.name;
                        // 用 fsPath 更稳（Windows 也 OK）
                        filePath = vscode.Uri.file(r.sourcePath).fsPath;
                    }
                }
            }
            // ===== 在这里插入兜底 END =====

            if (!name || !filePath) {
                vscode.window.showErrorMessage('[andrea.roleJson5Editor.def] 参数缺失：需要 name 与 path');
                return;
            }
            await provider.openDef({ name, path: filePath });
        });


        return vscode.Disposable.from(reg, defCmd);
    }
    private readonly ctx: vscode.ExtensionContext;
    private readonly opts: RoleJson5EditorOptions;
    private readonly existingById = new Map<string, RoleFlat>(); // 用于保留隐藏字段（packagePath/sourcePath）

    constructor(ctx: vscode.ExtensionContext, opts: RoleJson5EditorOptions) {
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
    // 文档URI -> 待转发的 def 名字队列（面板未就绪时暂存）
    private readonly pendingDefByDoc = new Map<string, string[]>();

    /** 打开指定 JSON5 文件的自定义编辑器，并向其 webview 转发 {type:'def', name} */
    public async openDef(payload: { name: string; path: string }): Promise<void> {
        const uri = vscode.Uri.file(payload.path);
        const key = uri.toString();

        const existing = this.panelsByDoc.get(key);
        if (existing) {
            try {
                existing.reveal(existing.viewColumn ?? vscode.ViewColumn.Active);
                existing.webview.postMessage({ type: 'def', name: payload.name });
                return;
            } catch {
                // 若面板异常，走排队逻辑
            }
        }

        // 面板未就绪：先排队，待 resolve 后统一下发
        const q = this.pendingDefByDoc.get(key) ?? [];
        q.push(payload.name);
        this.pendingDefByDoc.set(key, q);

        // 打开自定义编辑器
        await vscode.commands.executeCommand('vscode.openWith', uri, 'andrea.roleJson5Editor', vscode.ViewColumn.Active);
    }



    private getAutoSaveMode(doc: vscode.TextDocument): 'off' | 'afterDelay' | 'onFocusChange' | 'onWindowChange' {
        return vscode.workspace.getConfiguration('files', doc).get<'off' | 'afterDelay' | 'onFocusChange' | 'onWindowChange'>('autoSave', 'off');
    }

    private getAutoSaveDelay(doc: vscode.TextDocument): number {
        const n = vscode.workspace.getConfiguration('files', doc).get<number>('autoSaveDelay', 1000);
        return Number.isFinite(n) ? Math.max(0, n!) : 1000;
    }

    private async scheduleWrite(document: vscode.TextDocument, text: string): Promise<void> {
        const key = document.uri.toString();
        this.pendingText.set(key, text); // 总是先缓存

        const mode = this.getAutoSaveMode(document);
        // autoSave=off: 立即写入 TextDocument 形成 dirty（不自动落盘）。
        if (mode === 'off') {
            const old = this.saveTimers.get(key);
            if (old) {
                clearTimeout(old);
                this.saveTimers.delete(key);
            }
            this.refreshMuteUntil.set(key, Date.now() + 600);
            if (document.getText() !== text) {
                await this.replaceWholeDocument(document, text);
            }
            return;
        }

        const delay = (mode === 'afterDelay') ? this.getAutoSaveDelay(document) : 200;

        // —— 新增：预先开启静音窗口 ——
        // 给 doc-change 留个缓冲，避免我们写入引起的回灌打断 webview
        {
            const key = document.uri.toString();
            const muteMs = Math.max(400, Math.min(2000, delay + 200)); // 保守范围 400~2000ms
            this.refreshMuteUntil.set(key, Date.now() + muteMs);
        }
        const old = this.saveTimers.get(key);
        if (old) clearTimeout(old);

        this.saveTimers.set(key, setTimeout(async () => {
            this.saveTimers.delete(key);
            if (document.getText() === text) return; // 无变化不写
            await this.replaceWholeDocument(document, text); // 内含 skipOneEcho 标记
        }, delay));
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
                vscode.Uri.joinPath(this.ctx.extensionUri, 'media'),
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
                panel.webview.postMessage(getRoleEditorSettings(document.uri));
                const validation = validateRoleJson5Text(document.getText());
                if (!validation.ok) {
                    this.existingById.clear();
                    panel.webview.postMessage({ type: 'roleCards', list: [] });
                    panel.webview.postMessage({ type: 'parseError', error: validation.reason ?? '角色文件格式无效' });
                    return;
                }

                const roles = parseRolesFromText(document.getText(), document.uri.fsPath);
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

        const docKey = document.uri.toString();
        this.panelsByDoc.set(docKey, panel);

        // 文档变化 -> 刷新 webview（带节流 + 跳过自写）
        let refreshTimer: NodeJS.Timeout | undefined;
        const scheduleUpdate = () => {
            if (refreshTimer) clearTimeout(refreshTimer);
            refreshTimer = setTimeout(() => void updateWebview(), 150);
        };

        const changeSub = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() !== document.uri.toString()) return;
            const key = e.document.uri.toString();

            // 我们自己触发的一次回推，直接跳过
            if (this.skipOneEchoFor.delete(key)) {
                return;
            }

            // —— 新增：静音窗口 —— //
            const muteUntil = this.refreshMuteUntil.get(key) ?? 0;
            if (Date.now() < muteUntil) {
                // 在静音窗口内，忽略这次刷新，避免打断 webview 正在编辑的表单
                return;
            }

            scheduleUpdate();
        });


        // 保存前：autosave=off 时把 pendingText 写入 TextDocument，再让 VS Code 落盘
        const willSaveSub = vscode.workspace.onWillSaveTextDocument(e => {
            if (e.document.uri.toString() !== document.uri.toString()) return;

            const key = e.document.uri.toString();
            const pending = this.pendingText.get(key);
            if (!pending || pending === e.document.getText()) return;

            // 这次变更来自我们，后续 onDidChange 要跳过
            this.skipOneEchoFor.add(key);

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
        panel.webview.onDidReceiveMessage(async (msg: any) => {
            if (!msg || typeof msg.type !== 'string') return;
            try {
                if (msg.type === 'requestRoleCards') {
                    await updateWebview();
                } else if (msg.type === 'requestRoleEditorSettings') {
                    panel.webview.postMessage(getRoleEditorSettings(document.uri));
                } else if (msg.type === 'updateRoleEditorSettings') {
                    await updateRoleEditorSettings(msg, document.uri);
                    panel.webview.postMessage(getRoleEditorSettings(document.uri));
                } else if (msg.type === 'requestNameGeneratorOptions') {
                    const cultures = nameGeneratorService.getSupportedCultures().map(culture => ({
                        code: culture.code,
                        displayName: culture.displayName,
                        supportedGenders: culture.supportedGenders,
                        supportedStyles: culture.supportedStyles,
                    }));
                    panel.webview.postMessage({
                        type: 'nameGeneratorOptions',
                        cultures,
                    });
                } else if (msg.type === 'generateRandomRoleCandidates') {
                    const requestId = typeof msg.requestId === 'string' ? msg.requestId : '';
                    const raw = msg.options && typeof msg.options === 'object' ? msg.options : {};
                    const count = Math.max(1, Math.min(20, Number(raw.count) || 5));
                    const gender = ['male', 'female', 'neutral', 'any'].includes(raw.gender) ? raw.gender : 'any';
                    const options: NameGenerationOptions & { roleType?: string; affiliation?: string; color?: string } = {
                        culture: typeof raw.culture === 'string' ? raw.culture : 'zh_CN',
                        gender,
                        style: typeof raw.style === 'string' ? raw.style : 'modern',
                        count,
                        includeSurname: true,
                        roleType: typeof raw.roleType === 'string' ? raw.roleType : '配角',
                        affiliation: typeof raw.affiliation === 'string' ? raw.affiliation.trim() : '',
                        color: typeof raw.color === 'string' ? raw.color.trim() : '',
                    };
                    const names = await nameGeneratorService.generateNames(options);
                    panel.webview.postMessage({
                        type: 'randomRoleCandidates',
                        requestId,
                        candidates: names.map(name => buildGeneratedRoleCard(name, options)),
                    });
                } else if (msg.type === 'requestLookupKeyCandidates') {
                    const requestId = typeof msg.requestId === 'string' ? msg.requestId : '';
                    const kind = msg.kind === 'pinyin' || msg.kind === 'romanized'
                        ? msg.kind as LookupKeyGenerationKind
                        : undefined;
                    const base = msg.role?.base;

                    if (!requestId || !kind || !base || typeof base !== 'object') {
                        panel.webview.postMessage({
                            type: 'lookupKeyCandidates',
                            requestId,
                            kind,
                            candidates: [],
                            error: '候选请求参数无效',
                        });
                        return;
                    }

                    const candidates = await getRequestedLookupKeyCandidates({
                        name: typeof base.name === 'string' ? base.name : '',
                        aliases: toStringArray(base.aliases),
                    }, kind, document.uri.fsPath);

                    panel.webview.postMessage({
                        type: 'lookupKeyCandidates',
                        requestId,
                        kind,
                        candidates,
                    });
                } else if (msg.type === 'saveRoleCards') {
                    const validation = validateRoleJson5Text(document.getText());
                    if (!validation.ok) {
                        const choice = await vscode.window.showWarningMessage(
                            `当前文件格式异常（${validation.reason ?? '未知原因'}）。是否覆盖为角色数组格式并继续保存？`,
                            { modal: true },
                            '覆盖并保存',
                            '取消'
                        );
                        if (choice !== '覆盖并保存') {
                            panel.webview.postMessage({ type: 'saveAck', ok: false, error: '已取消保存' });
                            return;
                        }
                    }

                    const list: RoleCardModelWithId[] = Array.isArray(msg.list) ? msg.list : [];
                    const merged = cardModelsToRoles(list, this.existingById).map(role => applyGeneratedLookupKeys(role, document.uri.fsPath));
                    const text = stringifyRolesToJson5(merged);

                    // 更新 existingById（即便 off 也要更新，用于后续合并）
                    this.existingById.clear();
                    for (const r of merged) if (r.id) this.existingById.set(r.id, r);

                    // 关键：按 autosave 策略写入/排队。
                    // autoSave=off: 写入 TextDocument 形成 dirty，不自动保存到磁盘。
                    await this.scheduleWrite(document, text);

                    const queued = this.getAutoSaveMode(document) === 'off';
                    panel.webview.postMessage({ type: 'saveAck', ok: true, queued });
                }

                // —— 认为已就绪：把等待中的 def 消息全部转发（仅传 name）
                const key = document.uri.toString();
                const pend = this.pendingDefByDoc.get(key);
                if (pend && pend.length) {
                    for (const nm of pend) {
                        panel.webview.postMessage({ type: 'def', name: nm });
                    }
                    this.pendingDefByDoc.delete(key); // 清队列，避免重复发送
                }
            } catch (e) {
                if (msg.type === 'requestLookupKeyCandidates') {
                    panel.webview.postMessage({
                        type: 'lookupKeyCandidates',
                        requestId: typeof msg.requestId === 'string' ? msg.requestId : '',
                        kind: msg.kind,
                        candidates: [],
                        error: String(e),
                    });
                } else if (msg.type === 'generateRandomRoleCandidates') {
                    panel.webview.postMessage({
                        type: 'randomRoleCandidates',
                        requestId: typeof msg.requestId === 'string' ? msg.requestId : '',
                        candidates: [],
                        error: String(e),
                    });
                } else {
                    panel.webview.postMessage({ type: 'saveAck', ok: false, error: String(e) });
                }
            }
        }, undefined, this.ctx.subscriptions);

        panel.onDidDispose(() => {
            changeSub.dispose();
            willSaveSub.dispose();
            didSaveSub.dispose();
            const key = document.uri.toString();
            const t = this.saveTimers.get(key);
            if (t) clearTimeout(t);
            this.saveTimers.delete(key);
            this.panelsByDoc.delete(document.uri.toString());
            this.pendingDefByDoc.delete(document.uri.toString());
        });
    }

    /* ---------------- helpers ---------------- */

    private getMapperScriptUri(webview: vscode.Webview): string | undefined {
        try {
            const mapperFile = vscode.Uri.joinPath(this.ctx.extensionUri, 'media', 'resource-mapper.js');
            return webview.asWebviewUri(mapperFile).toString();
        } catch {
            return undefined;
        }
    }

    private async replaceWholeDocument(document: vscode.TextDocument, text: string): Promise<void> {
        // 无变化不写，避免回声与撤销栈污染
        if (document.getText() === text) return;

        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(document.getText().length)
        );

        // 打标：下一次来自该文档的变更由我们触发，onDidChange 里应忽略
        const key = document.uri.toString();
        this.skipOneEchoFor.add(key);

        edit.replace(document.uri, fullRange, text);
        await vscode.workspace.applyEdit(edit);

        // 写入后，再给一个显式静音窗口，双保险防抖
        this.refreshMuteUntil.set(key, Date.now() + 800);

        // 兜底：极端情况下若没有触发 change 事件，避免标记卡死（保守一些，别 0ms）
        setTimeout(() => this.skipOneEchoFor.delete(key), 1000);

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
