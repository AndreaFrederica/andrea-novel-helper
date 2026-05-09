import * as vscode from 'vscode';

export const DEFAULT_ROLE_TYPE_ORDER = [
    '主角',
    '主要角色',
    '反派',
    '配角',
    '联动角色',
    '词汇',
    '敏感词',
    '正则表达式',
    'unknown',
];

const COLLATOR_OPTIONS: Intl.CollatorOptions = {
    numeric: true,
    sensitivity: 'base',
};

export function normalizeRoleTypeOrder(value: unknown): string[] {
    const raw = Array.isArray(value) ? value : DEFAULT_ROLE_TYPE_ORDER;
    const seen = new Set<string>();
    const result: string[] = [];

    for (const item of raw) {
        const text = String(item ?? '').trim();
        if (!text || seen.has(text)) {
            continue;
        }
        seen.add(text);
        result.push(text);
    }

    return result.length ? result : [...DEFAULT_ROLE_TYPE_ORDER];
}

export function getRoleTypeOrder(scope: 'docRoles' | 'allRoles'): string[] {
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    const effectiveScope = scope === 'allRoles' && cfg.get<boolean>('allRoles.syncWithDocRoles', true)
        ? 'docRoles'
        : scope;
    return normalizeRoleTypeOrder(cfg.get<string[]>(`${effectiveScope}.typeOrder`, DEFAULT_ROLE_TYPE_ORDER));
}

export function compareRoleType(a: string, b: string, order: readonly string[]): number {
    const ar = roleTypeRank(a, order);
    const br = roleTypeRank(b, order);

    if (ar !== br) {
        return ar - br;
    }

    return a.localeCompare(b, 'zh-Hans', COLLATOR_OPTIONS);
}

function roleTypeRank(value: string, order: readonly string[]): number {
    const text = String(value || '').trim();
    const exactIndex = order.indexOf(text);
    if (exactIndex >= 0) {
        return exactIndex;
    }

    const lower = text.toLocaleLowerCase();
    const partialIndex = order.findIndex((item) => {
        const token = item.toLocaleLowerCase();
        return Boolean(token && lower.includes(token));
    });

    return partialIndex >= 0 ? partialIndex : order.length;
}
