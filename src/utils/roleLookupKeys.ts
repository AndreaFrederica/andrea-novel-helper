import type { Role } from '../extension';
import { getTagsForRoleUuid } from '../language/tagRoleBridge';

export const LOOKUP_KEY_PREFIXES = [
    'lookupkeys',
    'lookupkey',
    'searchkeys',
    'searchkey',
    'querykeys',
    'querykey',
    'indexkeys',
    'indexkey',
    'matchkeys',
    'matchkey',
    'keywords',
    'keyword',
    '查询键',
    '查询词',
    '检索键',
    '检索词',
    '索引键',
    '索引词',
    '反查键',
    '反查词',
    '关键词',
    '关键字',
] as const;

export type LookupKeyKind = 'generic' | 'pinyin' | 'romanized' | 'spelling';

let EXTENDED_LOOKUP_KEY_PREFIXES: string[] = [];

export function setExtendedLookupKeyPrefixes(prefixes: string[]): void {
    EXTENDED_LOOKUP_KEY_PREFIXES = uniqueRoleKeys(prefixes.map(p => normalizeLookupKeyName(p)));
}

export function normalizeLookupKeyName(key: string): string {
    return key.trim().toLowerCase();
}

export function normalizeLookupToken(token: string): string {
    return token
        .trim()
        .replace(/^[-*+]\t*\s*/, '')
        .replace(/^\d+[\.、]\s*/, '')
        .replace(/^[（(]\d+[）)]\s*/, '')
        .trim();
}

export function isLookupKeyFamily(key: string): boolean {
    const normalized = normalizeLookupKeyName(key);
    return LOOKUP_KEY_PREFIXES.some(prefix => normalized === prefix || normalized.startsWith(prefix)) ||
        EXTENDED_LOOKUP_KEY_PREFIXES.some(prefix => normalized === prefix || normalized.startsWith(prefix));
}

export function getLookupKeyKind(key: string): LookupKeyKind {
    const normalized = normalizeLookupKeyName(key);
    if (/(pinyin|拼音)/.test(normalized)) {
        return 'pinyin';
    }
    if (/(romanized|romaji|roma|罗马字|罗马拼写|罗马音|罗马)/.test(normalized)) {
        return 'romanized';
    }
    if (/(spelling|spell|拼写)/.test(normalized)) {
        return 'spelling';
    }
    return 'generic';
}

export function splitLookupValues(value: unknown): string[] {
    if (value === undefined || value === null) {
        return [];
    }

    if (Array.isArray(value)) {
        return value
            .flatMap(item => String(item ?? '').split(/[\r\n\t,，;；、]+/))
            .map(item => normalizeLookupToken(item))
            .filter(Boolean);
    }

    if (typeof value === 'string') {
        return value
            .split(/[\r\n\t,，;；、]+/)
            .map(item => normalizeLookupToken(item))
            .filter(Boolean);
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
        return [String(value)];
    }

    return [];
}

export function uniqueRoleKeys(values: readonly string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        const trimmed = value.trim();
        if (!trimmed) {
            continue;
        }
        const normalized = trimmed.normalize('NFC');
        if (seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        result.push(trimmed);
    }
    return result;
}

export function getRoleDisplayNames(role: Role, aliasLikeKinds: readonly LookupKeyKind[] = []): string[] {
    return uniqueRoleKeys([
        role.name,
        ...(role.aliases || []),
        ...getRoleBoundTagKeys(role),
        ...getRoleLookupKeysByKinds(role, aliasLikeKinds),
    ]);
}

export function getRoleBoundTagKeys(role: Role): string[] {
    return uniqueRoleKeys(getTagsForRoleUuid(role.uuid));
}

export function getRoleLookupKeyEntries(role: Role): Array<{ key: string; values: string[]; kind: LookupKeyKind }> {
    const entries: Array<{ key: string; values: string[]; kind: LookupKeyKind }> = [];

    for (const [rawKey, rawValue] of Object.entries(role)) {
        if (!isLookupKeyFamily(rawKey)) {
            continue;
        }
        const values = uniqueRoleKeys(splitLookupValues(rawValue));
        if (values.length === 0) {
            continue;
        }
        entries.push({ key: rawKey, values, kind: getLookupKeyKind(rawKey) });
    }

    return entries;
}

export function getRoleLookupKeysByKinds(role: Role, kinds: readonly LookupKeyKind[]): string[] {
    if (kinds.length === 0) {
        return [];
    }

    const kindSet = new Set(kinds);
    return uniqueRoleKeys(
        getRoleLookupKeyEntries(role)
            .filter(entry => kindSet.has(entry.kind))
            .flatMap(entry => entry.values)
    );
}

export function getRoleLookupKeys(role: Role): string[] {
    return uniqueRoleKeys([
        ...getRoleLookupKeyEntries(role).flatMap(entry => entry.values),
        ...getRoleBoundTagKeys(role),
    ]);
}

export function getRoleMatchKeys(role: Role): string[] {
    return uniqueRoleKeys([...getRoleDisplayNames(role), ...getRoleLookupKeys(role)]);
}

export function roleMatchesKey(role: Role, key: string): boolean {
    const normalized = key.trim().normalize('NFC');
    return getRoleMatchKeys(role).some(item => item.normalize('NFC') === normalized) ||
        (role.fixes || []).some(item => item.trim().normalize('NFC') === normalized);
}