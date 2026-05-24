import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Role } from '../extension';

const TAG_ROLE_BINDINGS_FILE = path.join('novel-helper', '.anh-fsdb', 'tag-role-bindings.json');

export interface TagRoleBinding {
    tag: string;
    roleUuid: string;
    roleNameSnapshot?: string;
    createdAt: number;
    updatedAt: number;
}

interface TagRoleBindingData {
    version: 1;
    bindings: Record<string, TagRoleBinding>;
}

export interface ResolvedTagRole {
    role?: Role;
    binding?: TagRoleBinding;
    matchKind?: 'binding' | 'name' | 'alias';
    candidates: string[];
}

let cachedBindings: TagRoleBindingData | undefined;

export function normalizeTagKey(tag: string): string {
    return cleanTag(tag).toLocaleLowerCase();
}

export function cleanTag(tag: string): string {
    return tag.replace(/^#/, '').trim();
}

export function tagToRoleNameCandidates(tag: string): string[] {
    const clean = cleanTag(tag);
    const parts = clean.split('/').map(part => part.trim()).filter(Boolean);
    const candidates = [parts[parts.length - 1] || clean, clean].filter(Boolean);
    return Array.from(new Set(candidates));
}

export function tagToAffiliation(tag: string): string | undefined {
    const parts = cleanTag(tag).split('/').map(part => part.trim()).filter(Boolean);
    if (parts.length <= 1) return undefined;
    return parts.slice(0, -1).join('/');
}

export function getTagRoleBindingsFilePath(): string | undefined {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return root ? path.join(root, TAG_ROLE_BINDINGS_FILE) : undefined;
}

export function refreshTagRoleBindings(): void {
    cachedBindings = undefined;
}

export function loadTagRoleBindings(): TagRoleBindingData {
    if (cachedBindings) return cachedBindings;
    const filePath = getTagRoleBindingsFilePath();
    if (!filePath || !fs.existsSync(filePath)) {
        cachedBindings = { version: 1, bindings: {} };
        return cachedBindings;
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<TagRoleBindingData>;
        cachedBindings = {
            version: 1,
            bindings: parsed.bindings && typeof parsed.bindings === 'object' ? parsed.bindings : {},
        };
    } catch (error) {
        console.warn('[TagRoleBridge] Failed to load tag-role bindings', error);
        cachedBindings = { version: 1, bindings: {} };
    }
    return cachedBindings;
}

export function saveTagRoleBindings(data: TagRoleBindingData): void {
    const filePath = getTagRoleBindingsFilePath();
    if (!filePath) throw new Error('没有打开的工作区');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
    cachedBindings = data;
}

export function bindTagToRole(tag: string, role: Pick<Role, 'uuid' | 'name'>): TagRoleBinding {
    if (!role.uuid) throw new Error('目标角色缺少 UUID，无法建立稳定绑定');
    const data = loadTagRoleBindings();
    const key = normalizeTagKey(tag);
    const now = Date.now();
    const previous = data.bindings[key];
    const binding: TagRoleBinding = {
        tag,
        roleUuid: role.uuid,
        roleNameSnapshot: role.name,
        createdAt: previous?.createdAt || now,
        updatedAt: now,
    };
    data.bindings[key] = binding;
    saveTagRoleBindings(data);
    return binding;
}

export function unbindTagRole(tag: string): boolean {
    const data = loadTagRoleBindings();
    const key = normalizeTagKey(tag);
    if (!data.bindings[key]) return false;
    delete data.bindings[key];
    saveTagRoleBindings(data);
    return true;
}

export function getTagRoleBindingsForRole(role: Pick<Role, 'uuid'>): TagRoleBinding[] {
    if (!role.uuid) return [];
    return Object.values(loadTagRoleBindings().bindings)
        .filter(binding => binding.roleUuid === role.uuid)
        .sort((left, right) => left.tag.localeCompare(right.tag, 'zh-CN'));
}

export function getTagsForRoleUuid(roleUuid: string | undefined): string[] {
    if (!roleUuid) return [];
    return Object.values(loadTagRoleBindings().bindings)
        .filter(binding => binding.roleUuid === roleUuid)
        .map(binding => binding.tag)
        .sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

export function resolveTagRole(tag: string, roles: Role[]): ResolvedTagRole {
    const candidates = tagToRoleNameCandidates(tag);
    const data = loadTagRoleBindings();
    const binding = data.bindings[normalizeTagKey(tag)];
    if (binding) {
        const role = roles.find(item => item.uuid === binding.roleUuid);
        return { role, binding, matchKind: role ? 'binding' : undefined, candidates };
    }

    const roleByName = roles.find(role => candidates.some(candidate => sameTagToken(role.name, candidate)));
    if (roleByName) return { role: roleByName, matchKind: 'name', candidates };

    const roleByAlias = roles.find(role => Array.isArray(role.aliases) && role.aliases.some(alias => candidates.some(candidate => sameTagToken(alias, candidate))));
    if (roleByAlias) return { role: roleByAlias, matchKind: 'alias', candidates };

    return { candidates };
}

function sameTagToken(left: string | undefined, right: string | undefined): boolean {
    return !!left && !!right && left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}
