/**
 * TOML 文件解析器
 * 支持角色表、敏感词表、词汇表的 TOML 格式解析
 *
 * 格式约定：
 *   [[roles]]
 *   name = "角色名"
 *   type = "主角"
 *   ...
 */

import { Role } from '../../extension';
import { FIELD_ALIASES } from './markdownParser';

/**
 * 将中文别名或英文原名解析为标准字段名
 */
function resolveFieldName(raw: string): string {
    const lower = raw.toLowerCase().trim();
    // 英文原名（含原始大小写，如 regexFlags / wordSegmentFilter）
    for (const key of Object.keys(FIELD_ALIASES)) {
        if (key.toLowerCase() === lower) {
            return key;
        }
    }
    // 中文别名
    for (const [english, chinese] of Object.entries(FIELD_ALIASES)) {
        if (chinese === raw.trim()) {
            return english;
        }
    }
    return lower;
}

/**
 * 标量字段：TOML 中已是正确类型，无需额外转换
 */
const BOOLEAN_FIELDS = new Set([
    'bold', 'italic', 'strikethrough', 'underline', 'wordSegmentFilter'
]);

/**
 * 整数字段
 */
const INTEGER_FIELDS = new Set(['priority']);

/**
 * 将 TOML 值归一化为 Role 对应字段的值
 */
function normalizeFieldValue(fieldName: string, value: unknown): unknown {
    if (value === null || value === undefined) {
        return undefined;
    }

    if (BOOLEAN_FIELDS.has(fieldName)) {
        return Boolean(value);
    }

    if (fieldName === 'priority') {
        const n = Number(value);
        return Number.isNaN(n) ? undefined : n;
    }

    if (fieldName === 'aliases' || fieldName === 'fixes') {
        if (Array.isArray(value)) {
            return value.map(v => String(v));
        }
        if (typeof value === 'string') {
            return value.split(/[,，;；\n\r\t\s·、]+/).map(s => s.trim()).filter(Boolean);
        }
        return undefined;
    }

    // 其余字段作为字符串处理
    if (typeof value === 'string') {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(v => String(v));
    }
    return String(value);
}

// ─── Parse ───────────────────────────────────────────────────────────

/**
 * 简易 TOML 解析器，将 TOML 文本解析为 JS 对象。
 * 支持：基础类型、数组、[[table array]]（数组表）。
 * 不支持：内联表、日期、嵌套表数组内部的子表。
 * 对于本扩展的角色文件场景已足够。
 */
function parseTomlSimple(content: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const lines = content.split(/\r?\n/);
    let currentTable: Record<string, unknown> = result;
    let currentPath: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const trimmed = raw.trim();

        // 跳过空行和注释
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        // 数组表 [[key.sub]]
        const tableArrayMatch = trimmed.match(/^\[\[([^\]]+)\]\]\s*$/);
        if (tableArrayMatch) {
            const fullPath = tableArrayMatch[1].trim();
            const parts = fullPath.split('.').map(s => s.trim());
            // 在 result 中找到或创建路径
            let container: any = result;
            for (let p = 0; p < parts.length - 1; p++) {
                if (!(parts[p] in container)) {
                    container[parts[p]] = {};
                }
                container = container[parts[p]];
            }
            const lastKey = parts[parts.length - 1];
            if (!Array.isArray(container[lastKey])) {
                container[lastKey] = [];
            }
            const newObj: Record<string, unknown> = {};
            container[lastKey].push(newObj);
            currentTable = newObj;
            currentPath = [];
            continue;
        }

        // 普通表 [key.sub]
        const tableMatch = trimmed.match(/^\[([^\]]+)\]\s*$/);
        if (tableMatch) {
            const fullPath = tableMatch[1].trim();
            const parts = fullPath.split('.').map(s => s.trim());
            let container: any = result;
            for (const part of parts) {
                if (!(part in container)) {
                    container[part] = {};
                }
                container = container[part];
            }
            currentTable = container;
            currentPath = [];
            continue;
        }

        // key = value
        const kvMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/);
        if (kvMatch) {
            const key = kvMatch[1].trim();
            const rawValue = kvMatch[2].trim();
            currentTable[key] = parseTomlValue(rawValue, lines, i);
        }
    }

    return result;
}

/**
 * 解析 TOML 值（字符串、整数、浮点、布尔、数组）
 */
function parseTomlValue(rawValue: string, lines: string[], lineIndex: number): unknown {
    // 多行基本字符串 """
    if (rawValue.startsWith('"""')) {
        const parts: string[] = [];
        let current = rawValue.slice(3);
        if (current.endsWith('"""')) {
            return current.slice(0, -3);
        }
        parts.push(current);
        for (let j = lineIndex + 1; j < lines.length; j++) {
            const next = lines[j];
            if (next.trim().endsWith('"""')) {
                parts.push(next.trim().slice(0, -3));
                break;
            }
            parts.push(next);
        }
        return parts.join('\n').trim();
    }

    // 多行字面字符串 '''
    if (rawValue.startsWith("'''")) {
        const parts: string[] = [];
        let current = rawValue.slice(3);
        if (current.endsWith("'''")) {
            return current.slice(0, -3);
        }
        parts.push(current);
        for (let j = lineIndex + 1; j < lines.length; j++) {
            const next = lines[j];
            if (next.trim().endsWith("'''")) {
                parts.push(next.trim().slice(0, -3));
                break;
            }
            parts.push(next);
        }
        return parts.join('\n').trim();
    }

    // 基本字符串
    if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
        return rawValue.slice(1, -1)
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t')
            .replace(/\\\\/g, '\\')
            .replace(/\\"/g, '"');
    }

    // 字面字符串
    if (rawValue.startsWith("'") && rawValue.endsWith("'")) {
        return rawValue.slice(1, -1);
    }

    // 数组
    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
        const inner = rawValue.slice(1, -1).trim();
        if (!inner) {
            return [];
        }
        return parseTomlArray(inner);
    }

    // 布尔
    if (rawValue === 'true') return true;
    if (rawValue === 'false') return false;

    // 整数（含负数）
    if (/^-?\d+$/.test(rawValue)) {
        return parseInt(rawValue, 10);
    }

    // 浮点
    if (/^-?\d+\.\d+$/.test(rawValue)) {
        return parseFloat(rawValue);
    }

    // 无法识别，返回原始字符串
    return rawValue;
}

/**
 * 解析 TOML 数组内容（逗号分隔，支持字符串、整数、布尔）
 */
function parseTomlArray(inner: string): unknown[] {
    const items: unknown[] = [];
    let depth = 0;
    let inString = false;
    let stringChar = '';
    let current = '';

    for (const ch of inner) {
        if (inString) {
            current += ch;
            if (ch === stringChar) {
                inString = false;
            }
            continue;
        }
        if (ch === '"' || ch === "'") {
            inString = true;
            stringChar = ch;
            current += ch;
            continue;
        }
        if (ch === '[') {
            depth++;
            current += ch;
            continue;
        }
        if (ch === ']') {
            depth--;
            current += ch;
            continue;
        }
        if (ch === ',' && depth === 0) {
            items.push(parseTomlValue(current.trim(), [], 0));
            current = '';
            continue;
        }
        current += ch;
    }
    if (current.trim()) {
        items.push(parseTomlValue(current.trim(), [], 0));
    }
    return items;
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * 解析 TOML 角色文件内容
 * @param content   文件文本
 * @param filePath  文件绝对路径
 * @param packagePath 包路径（相对 novel-helper）
 * @param defaultType 默认角色类型（如 '角色'、'敏感词'、'词汇'）
 */
export function parseTomlRoles(
    content: string,
    filePath: string,
    packagePath: string,
    defaultType: string
): Role[] {
    const roles: Role[] = [];

    if (!content.trim()) {
        return roles;
    }

    let data: Record<string, unknown>;
    try {
        data = parseTomlSimple(content);
    } catch (err) {
        throw new Error(`TOML 解析失败: ${err}`);
    }

    // 提取 roles 数组
    let rolesArray: Record<string, unknown>[] = [];

    if (Array.isArray(data['roles'])) {
        rolesArray = data['roles'] as Record<string, unknown>[];
    } else if (Array.isArray(data['characters'])) {
        rolesArray = data['characters'] as Record<string, unknown>[];
    } else if (typeof data === 'object' && data !== null) {
        // 如果没有 roles 表，尝试将每个顶层键视为角色（对象格式）
        // 但排除元数据键
        const metaKeys = new Set(['roles', 'characters', 'metadata']);
        const roleEntries = Object.entries(data).filter(
            ([k, v]) => !metaKeys.has(k) && typeof v === 'object' && v !== null && !Array.isArray(v)
        );
        if (roleEntries.length > 0) {
            rolesArray = roleEntries.map(([name, obj]) => ({
                name,
                ...(obj as Record<string, unknown>),
            }));
        }
    }

    for (const raw of rolesArray) {
        const role: Role = {
            name: String(raw['name'] || ''),
            type: String(raw['type'] || defaultType),
            packagePath,
            sourcePath: filePath,
        };

        // 复制所有字段到角色对象
        for (const [key, value] of Object.entries(raw)) {
            if (key === 'name' || key === 'type') continue;
            const standardKey = resolveFieldName(key);
            const normalized = normalizeFieldValue(standardKey, value);
            if (normalized !== undefined) {
                (role as any)[standardKey] = normalized;
            }
        }

        if (role.name) {
            roles.push(role);
        }
    }

    return roles;
}

// ─── Stringify ───────────────────────────────────────────────────────

const STRING_ESCAPE_FIELDS = new Set([
    'name', 'description', 'type', 'uuid', 'color', 'backgroundColor',
    'affiliation', 'regex', 'regexFlags'
]);

/**
 * 转义 TOML 字符串值
 */
function escapeTomlString(s: string): string {
    return s
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\t/g, '\\t');
}

/**
 * 将单个值序列化为 TOML 值字符串
 */
function tomlValueString(value: unknown): string {
    if (value === null || value === undefined) {
        return '""';
    }
    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }
    if (typeof value === 'number') {
        return Number.isInteger(value) ? String(value) : String(value);
    }
    if (typeof value === 'string') {
        return `"${escapeTomlString(value)}"`;
    }
    if (Array.isArray(value)) {
        if (value.length === 0) return '[]';
        const items = value.map(v => tomlValueString(v));
        return `[${items.join(', ')}]`;
    }
    // 对象：跳过（TOML 不序列化嵌套对象到 inline table 在此简易场景中）
    return `"${escapeTomlString(String(value))}"`;
}

/**
 * 排除内部元数据字段
 */
const SKIP_FIELDS = new Set(['packagePath', 'sourcePath']);

/**
 * 将角色数组序列化为 TOML 文本
 */
export function stringifyRolesAsToml(roles: Role[]): string {
    const lines: string[] = ['# 角色库'];

    for (const role of roles) {
        lines.push('');
        lines.push('[[roles]]');
        lines.push(`name = ${tomlValueString(role.name)}`);

        // 有序输出已知字段
        const orderedKeys = ['type', 'uuid', 'color', 'backgroundColor', 'affiliation', 'aliases', 'description'];
        for (const key of orderedKeys) {
            const value = (role as any)[key];
            if (value === undefined || value === null) continue;
            if (Array.isArray(value) && value.length === 0) continue;
            if (typeof value === 'string' && !value.trim()) continue;
            lines.push(`${key} = ${tomlValueString(value)}`);
        }

        // 输出其他自定义字段
        const allKnown = new Set([...orderedKeys, 'name', ...SKIP_FIELDS]);
        for (const [key, value] of Object.entries(role)) {
            if (allKnown.has(key)) continue;
            if (value === undefined || value === null) continue;
            if (Array.isArray(value) && value.length === 0) continue;
            if (typeof value === 'string' && !value.trim()) continue;
            lines.push(`${key} = ${tomlValueString(value)}`);
        }
    }

    return lines.join('\n') + '\n';
}
