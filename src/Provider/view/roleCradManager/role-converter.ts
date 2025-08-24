/**
 * Role <-> RoleCardModel 转换器
 * 规则摘要：
 * - 保存回后端：extended → custom 顺序展平合入 Role（同键后者覆盖先者），空值忽略。
 * - 后端专用字段：wordSegmentFilter/packagePath/sourcePath 仅保留 existing，不外发且不接受覆盖。
 * - 发到前端：动态键按扩展字段白名单分类 -> extended；其余 -> custom。
 * - 基础字段同义词（name/type/description/color/affiliation/aliases/priority/fixes 等）：
 *   若出现在动态键：
 *     - base 未设置：回填 base；
 *     - base 已存在：不再进入 extended/custom，避免重复展示。
 */

export type BuiltinType = '主角' | '配角' | '联动角色' | '敏感词' | '词汇' | '正则表达式';
export type RoleType = BuiltinType | string;
export type JsonValue = string | number | boolean | null | string[];

/** ==== 前端模型 ==== */
export interface BaseFieldsCommon {
    name: string;
    type: RoleType;
    color?: string;
    priority?: number;
    description?: string;
    affiliation?: string;
    aliases?: string[] | undefined; // 基础字段
    fixes?: string[] | undefined;   // 基础字段（仅敏感词可编辑）
    regex?: string | undefined;     // 正则专用
    regexFlags?: string | undefined;// 正则专用
}

export type ExtendedFields = Record<string, JsonValue>;
export type CustomFields = Record<string, JsonValue>;

export interface RoleCardModel {
    base: BaseFieldsCommon;
    extended?: ExtendedFields;
    custom?: CustomFields;
}

export type RoleCardModelWithId = RoleCardModel & { id?: string };

/** ==== 后端模型（可含动态键） ==== */
export interface Role {
    name: string;
    type: BuiltinType | string;
    affiliation?: string;
    aliases?: string[];
    description?: string;
    color?: string;
    wordSegmentFilter?: boolean; // 后端专用（不外发）
    packagePath?: string;        // 后端专用（不外发）
    sourcePath?: string;         // 后端专用（不外发）
    regex?: string;
    regexFlags?: string;
    priority?: number;
    fixes?: string[];            // 兼容旧字段 fixs -> fixes
}
export type RoleWithId = Role & { id?: string };

// 允许动态键：展平后塞入（例如 age/性格/标签等）
export type RoleFlat = RoleWithId & Record<string, JsonValue>;

/* ---------------- 约束与同义词表 ---------------- */

// 后端专用/基础键：不能被动态键覆盖，也不应出现在 extended/custom
const BACKEND_ONLY_KEYS = new Set(['wordSegmentFilter', 'packagePath', 'sourcePath']);
const BASE_KEYS = new Set([
    'id', 'name', 'type', 'description', 'color', 'affiliation', 'aliases',
    'regex', 'regexFlags', 'priority', 'fixes', 'fixs',
    ...BACKEND_ONLY_KEYS,
]);

// 基础字段同义词（用于“从动态键回填 base”与“发前端时避免重复”）
const BASE_SYNONYMS: Record<string, keyof BaseFieldsCommon | 'priority' | 'fixes'> = {
    // name
    'name': 'name', '名称': 'name', '名字': 'name',
    // type
    'type': 'type', '类型': 'type',
    // description
    'description': 'description', '描述': 'description',
    // color
    'color': 'color', '颜色': 'color',
    // affiliation
    'affiliation': 'affiliation', '从属': 'affiliation',
    // aliases
    'alias': 'aliases', 'aliases': 'aliases', '别名': 'aliases',
    // priority（虽是基础字段，这里当作同义词回填）
    'priority': 'priority', '优先级': 'priority',
    // fixes（敏感词专用）
    'fixes': 'fixes', 'fixs': 'fixes',
};

// 扩展字段白名单（中英/单复数/中文同义词）
const EXTENDED_WHITELIST = new Set([
    // 已在 base 的也加入白名单用于分类（实际不会进入 extended）
    'name', '描述', 'description', 'type', '类型', 'color', '颜色', 'affiliation', '从属', 'alias', 'aliases', '别名',

    // 约定扩展字段
    'age', '年龄',
    'gender', '性别',
    'occupation', '职业',
    'personality', '性格',
    'appearance', '外貌',
    'background', '背景',
    'relationship', 'relationships', '关系',
    'skill', 'skills', '技能',
    'weakness', 'weaknesses', '弱点',
    'goal', 'goals', '目标',
    'motivation', '动机',
    'fear', 'fears', '恐惧',
    'secret', 'secrets', '秘密',
    'quote', 'quotes', '台词',
    'note', 'notes', '备注',
    'tag', 'tags', '标签',
    'category', '分类',
    'level', '等级',
    'status', '状态',
    'location', '位置',
    'origin', '出身',
    'family', '家庭',
    'education', '教育',
    'hobby', 'hobbies', '爱好',
]);

const norm = (k: string) => k.trim().toLowerCase();

/* ---------------- 工具 ---------------- */

function isEmptyish(v: unknown): boolean {
    if (v === undefined || v === null) {return true;}
    if (typeof v === 'string') {return v.trim().length === 0;}
    if (typeof v === 'number') {return Number.isNaN(v);}
    if (Array.isArray(v)) {return v.length === 0 || v.every(isEmptyish);}
    if (typeof v === 'object') {
        const entries = Object.entries(v as Record<string, unknown>);
        return entries.length === 0 || entries.every(([, vv]) => isEmptyish(vv));
    }
    return false;
}

function toStringArray(v: unknown): string[] | undefined {
    if (isEmptyish(v)) {return undefined;}
    if (Array.isArray(v)) {
        const arr = v.map(x => String(x).trim()).filter(s => s.length > 0);
        return arr.length ? arr : undefined;
    }
    const s = String(v).trim();
    return s ? [s] : undefined;
}

// 收敛到 JsonValue；数组一律为 string[]
function toJsonValue(v: unknown): JsonValue {
    if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        return v as JsonValue;
    }
    if (Array.isArray(v)) {
        const arr = v.map(x => String(x ?? '').trim()).filter(Boolean);
        return arr as JsonValue;
    }
    // 对象/函数等兜底：转字符串
    try {
        return JSON.stringify(v);
    } catch {
        return String(v);
    }
}

/* ---------------- 发给前端：RoleFlat -> RoleCardModelWithId ---------------- */

export function roleToRoleCardModel(role: RoleFlat): RoleCardModelWithId {
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
    };

    const extended: ExtendedFields = {};
    const custom: CustomFields = {};

    for (const [k, rawV] of Object.entries(role)) {
        if (BASE_KEYS.has(k)) {continue;} // 基础/后端专用跳过
        const nk = norm(k);
        const v = toJsonValue(rawV);
        if (isEmptyish(v)) {continue;}

        // 如果是“基础字段同义词”，且 base 未设置 -> 回填 base；否则忽略（避免重复）
        const baseKey = BASE_SYNONYMS[nk as keyof typeof BASE_SYNONYMS];
        if (baseKey) {
            if (baseKey === 'aliases') {
                if (!base.aliases) {base.aliases = toStringArray(v) ?? base.aliases;}
            } else if (baseKey === 'priority') {
                if (typeof base.priority !== 'number') {
                    const n = Array.isArray(v) ? Number(v[0]) : Number(v as any);
                    if (!Number.isNaN(n)) {base.priority = n;}
                }
            } else if (!base[baseKey as keyof BaseFieldsCommon]) {
                base[baseKey] = Array.isArray(v) ? (v[0] as any) : (v as any);
            }
            continue;
        }

        // 分类：命中扩展白名单 -> extended；否则 -> custom
        if (EXTENDED_WHITELIST.has(nk)) {extended[k] = v;}
        else {custom[k] = v;}
    }

    return {
        id: role.id,
        base,
        extended: Object.keys(extended).length ? extended : undefined,
        custom: Object.keys(custom).length ? custom : undefined,
    };
}

/* ---------------- 回传到后端：RoleCardModelWithId -> RoleFlat ---------------- */

export function roleCardModelToRoleFlat(model: RoleCardModelWithId, existing?: RoleFlat): RoleFlat {
    const base = model.base;

    // 从 existing 起步，保留后端专用
    const out: RoleFlat = {
        ...(existing ?? ({} as RoleFlat)),
        ...(model.id ?? existing?.id ? { id: model.id ?? existing?.id } : {}),
        name: !isEmptyish(base.name) ? base.name : (existing?.name ?? ''),
        type: !isEmptyish(base.type) ? base.type : (existing?.type ?? '词汇'),
    };

    const setIf = <K extends keyof RoleFlat>(key: K, val: unknown) => {
        if (!isEmptyish(val)) {(out as any)[key] = val;}
    };
    setIf('affiliation', base.affiliation);
    setIf('aliases', toStringArray(base.aliases));
    setIf('description', base.description);
    setIf('color', base.color);
    setIf('regex', base.regex);
    setIf('regexFlags', base.regexFlags);
    if (typeof base.priority === 'number' && !Number.isNaN(base.priority)) {out.priority = base.priority;}
    setIf('fixes', toStringArray(base.fixes));

    // 后端专用只保留 existing（无视前端）
    if (existing) {
        out.wordSegmentFilter = existing.wordSegmentFilter;
        out.packagePath = existing.packagePath;
        out.sourcePath = existing.sourcePath;
    } else {
        delete out.wordSegmentFilter;
        delete out.packagePath;
        delete out.sourcePath;
    }

    // 展平：extended -> custom（custom 覆盖 extended）
    const flatten = (bag?: Record<string, unknown>) => {
        if (!bag || typeof bag !== 'object') {return;}
        for (const [k, val] of Object.entries(bag)) {
            const nk = norm(k);
            // 禁止用动态键覆盖基础/后端字段或其同义词
            if (BASE_KEYS.has(k) || BASE_SYNONYMS[nk as keyof typeof BASE_SYNONYMS]) {continue;}

            const v = toJsonValue(val);
            if (isEmptyish(v)) {continue;} // 空值当作没看到
            out[k] = v;                  // 动态键直接并入 Role
        }
    };
    flatten(model.extended); // extended 先写
    flatten(model.custom);   // custom 覆盖 extended

    return out;
}

/* ---------------- 批量 API ---------------- */

export function rolesToCardModels(list: RoleFlat[]): RoleCardModelWithId[] {
    return list.map(roleToRoleCardModel);
}

export function cardModelsToRoles(
    list: RoleCardModelWithId[],
    existingById?: Map<string, RoleFlat>,
): RoleFlat[] {
    return list.map(m => {
        const keep = m.id && existingById ? existingById.get(m.id) : undefined;
        return roleCardModelToRoleFlat(m, keep);
    });
}
