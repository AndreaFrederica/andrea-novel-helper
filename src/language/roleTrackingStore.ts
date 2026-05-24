import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const ROLE_TRACKING_FILE = path.join('novel-helper', '.anh-fsdb', 'role-tracking.json');
const DEFAULT_GROUP_ID = 'default';

export interface RoleTrackingGroup {
    id: string;
    name: string;
    order: number;
    roleUuids: string[];
}

interface RoleTrackingData {
    version: 1;
    groups: RoleTrackingGroup[];
}

let cachedData: RoleTrackingData | undefined;

export function getRoleTrackingFilePath(): string | undefined {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return root ? path.join(root, ROLE_TRACKING_FILE) : undefined;
}

export function refreshRoleTrackingStore(): void {
    cachedData = undefined;
}

export function loadRoleTrackingData(): RoleTrackingData {
    if (cachedData) return cachedData;
    const filePath = getRoleTrackingFilePath();
    if (!filePath || !fs.existsSync(filePath)) {
        cachedData = defaultData();
        return cachedData;
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<RoleTrackingData>;
        const groups = Array.isArray(parsed.groups) ? parsed.groups.map(normalizeGroup).filter(Boolean) as RoleTrackingGroup[] : [];
        cachedData = { version: 1, groups: groups.length ? groups.sort(compareGroups) : defaultData().groups };
    } catch (error) {
        console.warn('[RoleTrackingStore] Failed to load role tracking data', error);
        cachedData = defaultData();
    }
    return cachedData;
}

export function saveRoleTrackingData(data: RoleTrackingData): void {
    const filePath = getRoleTrackingFilePath();
    if (!filePath) throw new Error('没有打开的工作区');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    data.groups = data.groups.map(normalizeGroup).filter(Boolean) as RoleTrackingGroup[];
    if (!data.groups.length) data.groups = defaultData().groups;
    data.groups.sort(compareGroups);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
    cachedData = data;
}

export function getRoleTrackingGroups(): RoleTrackingGroup[] {
    return loadRoleTrackingData().groups.map(group => ({ ...group, roleUuids: [...group.roleUuids] }));
}

export function createRoleTrackingGroup(name: string): RoleTrackingGroup {
    const data = loadRoleTrackingData();
    const maxOrder = data.groups.reduce((max, group) => Math.max(max, group.order), 0);
    const group: RoleTrackingGroup = {
        id: generateGroupId(),
        name: name.trim(),
        order: maxOrder + 100,
        roleUuids: [],
    };
    data.groups.push(group);
    saveRoleTrackingData(data);
    return group;
}

export function renameRoleTrackingGroup(groupId: string, name: string): boolean {
    const data = loadRoleTrackingData();
    const group = data.groups.find(item => item.id === groupId);
    if (!group) return false;
    group.name = name.trim();
    saveRoleTrackingData(data);
    return true;
}

export function deleteRoleTrackingGroup(groupId: string): boolean {
    if (groupId === DEFAULT_GROUP_ID) return false;
    const data = loadRoleTrackingData();
    const before = data.groups.length;
    data.groups = data.groups.filter(group => group.id !== groupId);
    if (data.groups.length === before) return false;
    saveRoleTrackingData(data);
    return true;
}

export function addRoleToTrackingGroup(groupId: string, roleUuid: string): boolean {
    const data = loadRoleTrackingData();
    const group = data.groups.find(item => item.id === groupId) || ensureDefaultGroup(data);
    if (group.roleUuids.includes(roleUuid)) return false;
    group.roleUuids.push(roleUuid);
    saveRoleTrackingData(data);
    return true;
}

export function removeRoleFromTrackingGroup(groupId: string, roleUuid: string): boolean {
    const data = loadRoleTrackingData();
    const group = data.groups.find(item => item.id === groupId);
    if (!group) return false;
    const before = group.roleUuids.length;
    group.roleUuids = group.roleUuids.filter(uuid => uuid !== roleUuid);
    if (group.roleUuids.length === before) return false;
    saveRoleTrackingData(data);
    return true;
}

export function moveRoleBetweenTrackingGroups(fromGroupId: string, toGroupId: string, roleUuid: string): boolean {
    const data = loadRoleTrackingData();
    const from = data.groups.find(item => item.id === fromGroupId);
    const to = data.groups.find(item => item.id === toGroupId) || ensureDefaultGroup(data);
    if (!from || !to || from.id === to.id) return false;
    from.roleUuids = from.roleUuids.filter(uuid => uuid !== roleUuid);
    if (!to.roleUuids.includes(roleUuid)) to.roleUuids.push(roleUuid);
    saveRoleTrackingData(data);
    return true;
}

export function getDefaultRoleTrackingGroupId(): string {
    ensureDefaultGroup(loadRoleTrackingData());
    return DEFAULT_GROUP_ID;
}

function defaultData(): RoleTrackingData {
    return { version: 1, groups: [{ id: DEFAULT_GROUP_ID, name: '默认追踪', order: 0, roleUuids: [] }] };
}

function ensureDefaultGroup(data: RoleTrackingData): RoleTrackingGroup {
    let group = data.groups.find(item => item.id === DEFAULT_GROUP_ID);
    if (!group) {
        group = { id: DEFAULT_GROUP_ID, name: '默认追踪', order: 0, roleUuids: [] };
        data.groups.unshift(group);
    }
    return group;
}

function normalizeGroup(input: any): RoleTrackingGroup | undefined {
    const id = typeof input?.id === 'string' && input.id.trim() ? input.id.trim() : undefined;
    const name = typeof input?.name === 'string' && input.name.trim() ? input.name.trim() : undefined;
    if (!id || !name) return undefined;
    return {
        id,
        name,
        order: Number.isFinite(Number(input.order)) ? Number(input.order) : 0,
        roleUuids: Array.isArray(input.roleUuids) ? Array.from(new Set(input.roleUuids.map((uuid: unknown) => String(uuid || '').trim()).filter(Boolean))) : [],
    };
}

function compareGroups(left: RoleTrackingGroup, right: RoleTrackingGroup): number {
    return left.order - right.order || left.name.localeCompare(right.name, 'zh-CN');
}

function generateGroupId(): string {
    return `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
