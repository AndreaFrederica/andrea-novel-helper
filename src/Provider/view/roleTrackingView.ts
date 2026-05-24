/* eslint-disable curly */
import * as path from 'path';
import * as vscode from 'vscode';
import { roles, onDidChangeRoles, loadRoles } from '../../activate';
import { Role } from '../../extension';
import { ensureRoleUUIDs } from '../../utils/roleUuidManager';
import { buildRoleMarkdown } from '../hoverProvider';
import { findDefinitionInFile } from '../defProv';
import { getRoleReferenceLocations } from '../roleReferenceProvider';
import {
    addRoleToTrackingGroup,
    createRoleTrackingGroup,
    deleteRoleTrackingGroup,
    getDefaultRoleTrackingGroupId,
    getRoleTrackingGroups,
    moveRoleBetweenTrackingGroups,
    refreshRoleTrackingStore,
    removeRoleFromTrackingGroup,
    renameRoleTrackingGroup,
    RoleTrackingGroup,
} from '../../language/roleTrackingStore';

type RoleTrackingNodeKind = 'group' | 'role' | 'file' | 'reference' | 'missing' | 'info';

interface ReferenceFileBucket {
    uri: vscode.Uri;
    locations: vscode.Location[];
}

class RoleTrackingTreeItem extends vscode.TreeItem {
    constructor(
        public readonly kind: RoleTrackingNodeKind,
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly group?: RoleTrackingGroup,
        public readonly role?: Role,
        public readonly roleUuid?: string,
        public readonly fileBucket?: ReferenceFileBucket,
        public readonly location?: vscode.Location,
    ) {
        super(label, collapsibleState);

        if (kind === 'group' && group) {
            this.id = `roleTracking.group.${group.id}`;
            this.contextValue = group.id === getDefaultRoleTrackingGroupId() ? 'roleTrackingDefaultGroup' : 'roleTrackingGroup';
            this.description = `${group.roleUuids.length}`;
            this.tooltip = `角色追踪分组: ${group.name}`;
            this.iconPath = new vscode.ThemeIcon('folder');
            return;
        }

        if (kind === 'role' && role && group) {
            const locations = getRoleReferenceLocations(role) || [];
            this.id = `roleTracking.role.${group.id}.${role.uuid || role.name}`;
            this.contextValue = 'roleTrackingRole';
            this.description = `${role.type || '角色'} · ${locations.length} 处`;
            this.tooltip = buildRoleMarkdown(role);
            this.iconPath = roleIcon(role);
            if (role.sourcePath) this.resourceUri = vscode.Uri.file(role.sourcePath);
            this.command = {
                command: 'andrea.roleTracking.openRole',
                title: '打开角色定义',
                arguments: [this],
            };
            return;
        }

        if (kind === 'missing' && group && roleUuid) {
            this.id = `roleTracking.missing.${group.id}.${roleUuid}`;
            this.contextValue = 'roleTrackingMissingRole';
            this.description = roleUuid;
            this.tooltip = `未找到 UUID 为 ${roleUuid} 的角色`;
            this.iconPath = new vscode.ThemeIcon('warning');
            return;
        }

        if (kind === 'file' && fileBucket) {
            this.id = `roleTracking.file.${fileBucket.uri.toString()}.${role?.uuid || ''}`;
            this.contextValue = 'roleTrackingFile';
            this.resourceUri = fileBucket.uri;
            this.description = `${fileBucket.locations.length} 处`;
            this.tooltip = vscode.workspace.asRelativePath(fileBucket.uri);
            this.iconPath = vscode.ThemeIcon.File;
            return;
        }

        if (kind === 'reference' && location) {
            this.contextValue = 'roleTrackingReference';
            this.description = vscode.workspace.asRelativePath(location.uri);
            this.tooltip = `${vscode.workspace.asRelativePath(location.uri)}:${location.range.start.line + 1}:${location.range.start.character + 1}`;
            this.iconPath = new vscode.ThemeIcon('references');
            this.command = {
                command: 'andrea.roleTracking.openReference',
                title: '打开引用位置',
                arguments: [this],
            };
            return;
        }

        this.contextValue = 'roleTrackingInfo';
        this.iconPath = new vscode.ThemeIcon('info');
    }
}

class RoleTrackingTreeProvider implements vscode.TreeDataProvider<RoleTrackingTreeItem> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<RoleTrackingTreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: RoleTrackingTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: RoleTrackingTreeItem): Promise<RoleTrackingTreeItem[]> {
        if (!vscode.workspace.workspaceFolders?.length) {
            return [new RoleTrackingTreeItem('info', '未打开工作区', vscode.TreeItemCollapsibleState.None)];
        }

        if (!element) {
            const groups = getRoleTrackingGroups();
            return groups.map(group => new RoleTrackingTreeItem('group', group.name, vscode.TreeItemCollapsibleState.Expanded, group));
        }

        if (element.kind === 'group' && element.group) {
            if (!element.group.roleUuids.length) {
                return [new RoleTrackingTreeItem('info', '暂无追踪角色', vscode.TreeItemCollapsibleState.None)];
            }
            return element.group.roleUuids.map(roleUuid => {
                const role = findRoleByUuid(roleUuid);
                if (!role) return new RoleTrackingTreeItem('missing', '已丢失的角色', vscode.TreeItemCollapsibleState.None, element.group, undefined, roleUuid);
                return new RoleTrackingTreeItem('role', role.name, vscode.TreeItemCollapsibleState.Collapsed, element.group, role, roleUuid);
            });
        }

        if (element.kind === 'role' && element.role) {
            const locations = getRoleReferenceLocations(element.role) || [];
            if (!locations.length) {
                return [new RoleTrackingTreeItem('info', '暂无引用', vscode.TreeItemCollapsibleState.None)];
            }
            return groupLocationsByFile(locations).map(bucket => new RoleTrackingTreeItem('file', vscode.workspace.asRelativePath(bucket.uri), vscode.TreeItemCollapsibleState.Collapsed, element.group, element.role, element.roleUuid, bucket));
        }

        if (element.kind === 'file' && element.fileBucket) {
            return element.fileBucket.locations.map(location => {
                const label = `第 ${location.range.start.line + 1} 行，第 ${location.range.start.character + 1} 列`;
                return new RoleTrackingTreeItem('reference', label, vscode.TreeItemCollapsibleState.None, element.group, element.role, element.roleUuid, undefined, location);
            });
        }

        return [];
    }
}

export function registerRoleTrackingView(context: vscode.ExtensionContext): void {
    const provider = new RoleTrackingTreeProvider();
    const treeView = vscode.window.createTreeView('andrea.roleTrackingView', {
        treeDataProvider: provider,
        showCollapseAll: true,
    });

    context.subscriptions.push(
        treeView,
        onDidChangeRoles(() => provider.refresh()),
        vscode.commands.registerCommand('andrea.roleTracking.refresh', () => {
            refreshRoleTrackingStore();
            provider.refresh();
        }),
        vscode.commands.registerCommand('andrea.roleTracking.addGroup', async () => addGroup(provider)),
        vscode.commands.registerCommand('andrea.roleTracking.renameGroup', async (node?: RoleTrackingTreeItem) => renameGroup(node, provider)),
        vscode.commands.registerCommand('andrea.roleTracking.deleteGroup', async (node?: RoleTrackingTreeItem) => deleteGroup(node, provider)),
        vscode.commands.registerCommand('andrea.roleTracking.addRole', async (node?: RoleTrackingTreeItem) => addRole(node, provider)),
        vscode.commands.registerCommand('andrea.roleTracking.removeRole', async (node?: RoleTrackingTreeItem) => removeRole(node, provider)),
        vscode.commands.registerCommand('andrea.roleTracking.moveRole', async (node?: RoleTrackingTreeItem) => moveRole(node, provider)),
        vscode.commands.registerCommand('andrea.roleTracking.openRole', async (node?: RoleTrackingTreeItem) => {
            if (node?.role) await openRole(node.role);
        }),
        vscode.commands.registerCommand('andrea.roleTracking.showReferences', async (node?: RoleTrackingTreeItem) => showRoleReferences(node)),
        vscode.commands.registerCommand('andrea.roleTracking.openReference', async (node?: RoleTrackingTreeItem) => {
            if (node?.location) await openLocation(node.location);
        }),
    );
}

async function addGroup(provider: RoleTrackingTreeProvider): Promise<void> {
    const name = await vscode.window.showInputBox({
        title: '新建角色追踪分组',
        prompt: '用于手动整理需要追踪的角色',
        validateInput: value => value.trim() ? null : '分组名称不能为空',
    });
    if (!name) return;
    createRoleTrackingGroup(name);
    provider.refresh();
}

async function renameGroup(node: RoleTrackingTreeItem | undefined, provider: RoleTrackingTreeProvider): Promise<void> {
    if (!node?.group) return;
    const name = await vscode.window.showInputBox({
        title: '重命名角色追踪分组',
        value: node.group.name,
        validateInput: value => value.trim() ? null : '分组名称不能为空',
    });
    if (!name) return;
    renameRoleTrackingGroup(node.group.id, name);
    provider.refresh();
}

async function deleteGroup(node: RoleTrackingTreeItem | undefined, provider: RoleTrackingTreeProvider): Promise<void> {
    if (!node?.group) return;
    const confirmed = await vscode.window.showWarningMessage(`删除追踪分组“${node.group.name}”？分组内角色只会从追踪列表移除，不会删除角色文件。`, { modal: true }, '删除');
    if (confirmed !== '删除') return;
    if (!deleteRoleTrackingGroup(node.group.id)) {
        vscode.window.showWarningMessage('默认追踪分组不能删除。');
        return;
    }
    provider.refresh();
}

async function addRole(node: RoleTrackingTreeItem | undefined, provider: RoleTrackingTreeProvider): Promise<void> {
    const group = node?.group || await pickGroup();
    if (!group) return;
    if (!roles.length) {
        vscode.window.showWarningMessage('当前还没有加载到角色。');
        return;
    }

    const existing = new Set(group.roleUuids);
    const candidates = roles.filter(role => !role.uuid || !existing.has(role.uuid));
    const selected = await vscode.window.showQuickPick(candidates.map(role => ({
        label: role.name,
        description: role.type || '角色',
        detail: `${role.affiliation ? `${role.affiliation} · ` : ''}${role.uuid ? `UUID: ${role.uuid}` : '缺少 UUID，将自动补齐'}${role.sourcePath ? ` · ${vscode.workspace.asRelativePath(role.sourcePath)}` : ''}`,
        role,
    })), { title: `添加角色到“${group.name}”`, matchOnDescription: true, matchOnDetail: true });
    if (!selected) return;

    const role = selected.role;
    if (!role.uuid) {
        await ensureRoleUUIDs([role], true);
        if (role.sourcePath) loadRoles(false, [role.sourcePath]);
    }
    if (!role.uuid) {
        vscode.window.showErrorMessage(`角色“${role.name}”仍缺少 UUID，无法加入追踪。`);
        return;
    }

    addRoleToTrackingGroup(group.id, role.uuid);
    provider.refresh();
}

async function removeRole(node: RoleTrackingTreeItem | undefined, provider: RoleTrackingTreeProvider): Promise<void> {
    if (!node?.group || !node.roleUuid) return;
    removeRoleFromTrackingGroup(node.group.id, node.roleUuid);
    provider.refresh();
}

async function moveRole(node: RoleTrackingTreeItem | undefined, provider: RoleTrackingTreeProvider): Promise<void> {
    if (!node?.group || !node.roleUuid) return;
    const groups = getRoleTrackingGroups().filter(group => group.id !== node.group?.id);
    if (!groups.length) {
        vscode.window.showInformationMessage('还没有其他角色追踪分组。');
        return;
    }
    const selected = await vscode.window.showQuickPick(groups.map(group => ({ label: group.name, description: `${group.roleUuids.length} 个角色`, group })), { title: '移动追踪角色到分组' });
    if (!selected) return;
    moveRoleBetweenTrackingGroups(node.group.id, selected.group.id, node.roleUuid);
    provider.refresh();
}

async function showRoleReferences(node: RoleTrackingTreeItem | undefined): Promise<void> {
    const role = node?.role;
    if (!role) return;
    const locations = getRoleReferenceLocations(role) || [];
    if (!locations.length) {
        vscode.window.showInformationMessage(`没有找到角色“${role.name}”的引用。`);
        return;
    }
    await vscode.commands.executeCommand('editor.action.showReferences', locations[0].uri, locations[0].range.start, locations);
}

async function pickGroup(): Promise<RoleTrackingGroup | undefined> {
    const groups = getRoleTrackingGroups();
    if (groups.length === 1) return groups[0];
    const selected = await vscode.window.showQuickPick(groups.map(group => ({ label: group.name, description: `${group.roleUuids.length} 个角色`, group })), { title: '选择角色追踪分组' });
    return selected?.group;
}

function findRoleByUuid(uuid: string | undefined): Role | undefined {
    if (!uuid) return undefined;
    return roles.find(role => role.uuid === uuid);
}

function groupLocationsByFile(locations: vscode.Location[]): ReferenceFileBucket[] {
    const buckets = new Map<string, ReferenceFileBucket>();
    for (const location of locations) {
        const key = location.uri.toString();
        let bucket = buckets.get(key);
        if (!bucket) {
            bucket = { uri: location.uri, locations: [] };
            buckets.set(key, bucket);
        }
        bucket.locations.push(location);
    }
    return Array.from(buckets.values())
        .map(bucket => ({ ...bucket, locations: bucket.locations.sort(compareLocations) }))
        .sort((left, right) => vscode.workspace.asRelativePath(left.uri).localeCompare(vscode.workspace.asRelativePath(right.uri), 'zh-CN'));
}

function compareLocations(left: vscode.Location, right: vscode.Location): number {
    return left.range.start.line - right.range.start.line || left.range.start.character - right.range.start.character;
}

async function openRole(role: Role): Promise<void> {
    if (!role.sourcePath) {
        vscode.window.showWarningMessage(`角色“${role.name}”没有源文件路径。`);
        return;
    }
    const location = findDefinitionInFile(role, role.sourcePath) || new vscode.Location(vscode.Uri.file(role.sourcePath), new vscode.Position(0, 0));
    await openLocation(location);
}

async function openLocation(location: vscode.Location): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(location.uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    editor.selection = new vscode.Selection(location.range.start, location.range.end);
    editor.revealRange(location.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

function roleIcon(role: Role): vscode.ThemeIcon | vscode.Uri {
    const color = (role.color || role.colour || role['颜色'] || '').toString().trim();
    if (!color) return new vscode.ThemeIcon('account');
    const safe = color.replace(/"/g, '%22');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="${safe}" stroke="rgba(0,0,0,.35)" stroke-width="1"/><circle cx="8" cy="6.5" r="2.2" fill="rgba(255,255,255,.82)"/><path d="M4.4 13c.7-2.1 2-3.2 3.6-3.2s2.9 1.1 3.6 3.2" fill="rgba(255,255,255,.82)"/></svg>`;
    return vscode.Uri.parse(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
}
