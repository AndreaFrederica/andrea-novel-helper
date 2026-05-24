/* eslint-disable curly */
import * as vscode from 'vscode';
import * as path from 'path';
import { roles, onDidChangeRoles, loadRoles } from '../../activate';
import { getObsidianProjectIndex, normalizeColor, ObsidianTagEntry, ObsidianTagFileHit, onDidChangeObsidianIndex, registerObsidianIndex } from '../../language/obsidianIndex';
import { bindTagToRole, cleanTag, refreshTagRoleBindings, resolveTagRole, ResolvedTagRole, tagToAffiliation, tagToRoleNameCandidates, unbindTagRole } from '../../language/tagRoleBridge';
import { Role } from '../../extension';
import { clearAllRoleMatchCache } from '../../context/roleAsyncShared';
import { selectOrCreateFile } from '../../commands/addRoleFileSelector';
import { addRoleToFile } from '../../utils/roleFileHandler';
import { generateUUIDv7 } from '../../utils/uuidUtils';
import { ensureRoleUUIDs } from '../../utils/roleUuidManager';
import { updateDecorations } from '../../events/updateDecorations';
import { findDefinitionInFile } from '../defProv';
import { buildRoleMarkdown } from '../hoverProvider';
import { getAsyncRoleMatcher } from '../../utils/asyncRoleMatcher';
import { ahoCorasickManager } from '../../utils/AhoCorasick/ahoCorasickManager';
import { getReferencesForTagNode } from '../tagReferenceProvider';
import { VOCABULARY_FILTER_KEYWORDS } from '../../projectConfig/resourceFileNaming';

type TagNodeKind = 'group' | 'tag' | 'role' | 'file' | 'info';
type TagGroupKind = 'normal' | 'color';

type TagEntry = ObsidianTagEntry;
type IndexedTagFileHit = ObsidianTagFileHit;

class TagTreeItem extends vscode.TreeItem {
    constructor(
        public readonly kind: TagNodeKind,
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly groupKind?: TagGroupKind,
        public readonly tagEntry?: TagEntry,
        public readonly fileHit?: IndexedTagFileHit,
        public readonly roleLink?: ResolvedTagRole,
    ) {
        super(label, collapsibleState);

        if (kind === 'group') {
            this.contextValue = groupKind === 'color' ? 'andreaTagColorGroup' : 'andreaTagNormalGroup';
            this.iconPath = new vscode.ThemeIcon(groupKind === 'color' ? 'symbol-color' : 'tag');
            return;
        }

        if (kind === 'tag' && tagEntry) {
            const role = roleLink?.role;
            const hasBinding = !!roleLink?.binding;
            this.contextValue = tagEntry.isColor
                ? role ? (hasBinding ? 'andreaColorTagBoundRole' : 'andreaColorTagRoleMatch') : 'andreaColorTag'
                : role ? (hasBinding ? 'andreaTagBoundRole' : 'andreaTagRoleMatch') : 'andreaTag';
            this.description = role ? `${tagEntry.files.size} 个文件 · 角色: ${role.name}` : `${tagEntry.files.size} 个文件`;
            this.tooltip = role
                ? `${tagEntry.tag}\n${tagEntry.files.size} 个文件，${sumHits(tagEntry)} 次出现\n关联角色: ${role.name}${role.uuid ? `\nUUID: ${role.uuid}` : ''}`
                : `${tagEntry.tag}\n${tagEntry.files.size} 个文件，${sumHits(tagEntry)} 次出现`;
            this.iconPath = role ? roleIcon(role) : tagEntry.isColor ? colorIcon(tagEntry.tag) : new vscode.ThemeIcon('tag');
            return;
        }

        if (kind === 'role' && tagEntry && roleLink?.role) {
            const role = roleLink.role;
            this.contextValue = roleLink.binding ? 'andreaTagRoleNodeBound' : 'andreaTagRoleNode';
            this.description = role.type || '角色';
            this.tooltip = buildRoleMarkdown(role);
            this.iconPath = roleIcon(role);
            if (role.sourcePath) this.resourceUri = vscode.Uri.file(role.sourcePath);
            this.command = {
                command: 'andrea.tags.openRole',
                title: '打开关联角色',
                arguments: [this],
            };
            return;
        }

        if (kind === 'file' && fileHit && tagEntry) {
            this.contextValue = 'andreaTagFile';
            this.resourceUri = fileHit.uri;
            this.description = `${fileHit.count} 次`;
            this.tooltip = `${vscode.workspace.asRelativePath(fileHit.uri)}\n${tagEntry.tag} 出现 ${fileHit.count} 次`;
            this.iconPath = tagEntry.isColor ? colorIcon(tagEntry.tag) : vscode.ThemeIcon.File;
            this.command = {
                command: 'andrea.tags.openFile',
                title: '打开标签所在文件',
                arguments: [this],
            };
            return;
        }

        this.contextValue = 'andreaTagInfo';
        this.iconPath = new vscode.ThemeIcon('info');
    }
}

class TagTreeProvider implements vscode.TreeDataProvider<TagTreeItem> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<TagTreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private cachedEntries: TagEntry[] | undefined;

    refresh() {
        this.cachedEntries = undefined;
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: TagTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: TagTreeItem): Promise<TagTreeItem[]> {
        if (!vscode.workspace.workspaceFolders?.length) {
            return [new TagTreeItem('info', '未打开工作区', vscode.TreeItemCollapsibleState.None)];
        }

        const entries = await this.getEntries();
        if (!element) {
            return [
                new TagTreeItem('group', '普通标签', vscode.TreeItemCollapsibleState.Expanded, 'normal'),
                new TagTreeItem('group', '颜色标签', vscode.TreeItemCollapsibleState.Expanded, 'color'),
            ];
        }

        if (element.kind === 'group') {
            const isColorGroup = element.groupKind === 'color';
            const filtered = entries.filter(entry => entry.isColor === isColorGroup);
            if (!filtered.length) {
                return [new TagTreeItem('info', isColorGroup ? '暂无颜色标签' : '暂无普通标签', vscode.TreeItemCollapsibleState.None)];
            }
            return filtered.map(entry => new TagTreeItem('tag', entry.tag, vscode.TreeItemCollapsibleState.Collapsed, element.groupKind, entry, undefined, this.resolveRole(entry)));
        }

        if (element.kind === 'tag' && element.tagEntry) {
            const roleLink = element.roleLink || this.resolveRole(element.tagEntry);
            const role = roleLink?.role;
            const roleNode = role && roleLink
                ? [new TagTreeItem('role', `角色: ${role.name}`, vscode.TreeItemCollapsibleState.None, element.groupKind, element.tagEntry, undefined, roleLink)]
                : [];
            const fileNodes = Array.from(element.tagEntry.files.values())
                .sort((left, right) => vscode.workspace.asRelativePath(left.uri).localeCompare(vscode.workspace.asRelativePath(right.uri), 'zh-CN'))
                .map(hit => new TagTreeItem('file', vscode.workspace.asRelativePath(hit.uri), vscode.TreeItemCollapsibleState.None, element.groupKind, element.tagEntry, hit));
            return [...roleNode, ...fileNodes];
        }

        return [];
    }

    private async getEntries(): Promise<TagEntry[]> {
        if (this.cachedEntries) return this.cachedEntries;
        this.cachedEntries = await getObsidianProjectIndex()?.getTagEntries() || [];
        return this.cachedEntries;
    }

    private resolveRole(entry: TagEntry): ResolvedTagRole | undefined {
        return resolveTagRole(entry.tag, roles);
    }
}

export function registerTagExplorerView(context: vscode.ExtensionContext) {
    registerObsidianIndex(context);
    const provider = new TagTreeProvider();
    const treeView = vscode.window.createTreeView('andrea.tagsView', {
        treeDataProvider: provider,
        showCollapseAll: true,
    });

    const refresh = () => provider.refresh();
    const forceRefresh = async () => {
        refreshTagRoleBindings();
        await getObsidianProjectIndex()?.refresh();
        provider.refresh();
    };
    context.subscriptions.push(
        treeView,
        onDidChangeObsidianIndex(refresh),
        onDidChangeRoles(refresh),
        vscode.commands.registerCommand('andrea.tags.refresh', forceRefresh),
        vscode.commands.registerCommand('andrea.tags.openFile', async (node?: TagTreeItem) => {
            if (!node?.fileHit) return;
            const doc = await vscode.workspace.openTextDocument(node.fileHit.uri);
            const position = new vscode.Position(node.fileHit.firstLine, node.fileHit.firstCharacter);
            await vscode.window.showTextDocument(doc, { selection: new vscode.Range(position, position), preview: false });
        }),
        vscode.commands.registerCommand('andrea.tags.showReferences', async (node?: TagTreeItem) => {
            await showTagReferences(node);
        }),
        vscode.commands.registerCommand('andrea.tags.createRoleFromTag', async (node?: TagTreeItem) => {
            await createRoleFromTag(node, provider);
        }),
        vscode.commands.registerCommand('andrea.tags.bindRole', async (node?: TagTreeItem) => {
            await bindTagNodeToRole(node, provider);
        }),
        vscode.commands.registerCommand('andrea.tags.unbindRole', async (node?: TagTreeItem) => {
            await unbindTagNodeRole(node, provider);
        }),
        vscode.commands.registerCommand('andrea.tags.openRole', async (node?: TagTreeItem) => {
            await openTagRole(node);
        }),
    );
}

function sumHits(entry: TagEntry): number {
    return Array.from(entry.files.values()).reduce((sum, hit) => sum + hit.count, 0);
}

function colorIcon(tag: string): vscode.Uri {
    const color = normalizeColor(tag);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="${color}" stroke="rgba(0,0,0,.35)" stroke-width="1"/></svg>`;
    return vscode.Uri.parse(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
}

function roleIcon(role: Role): vscode.ThemeIcon | vscode.Uri {
    const color = (role.color || role.colour || role['颜色'] || '').toString().trim();
    if (!color) return new vscode.ThemeIcon('account');
    const safe = color.replace(/"/g, '%22');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="${safe}" stroke="rgba(0,0,0,.35)" stroke-width="1"/><circle cx="8" cy="6.5" r="2.2" fill="rgba(255,255,255,.82)"/><path d="M4.4 13c.7-2.1 2-3.2 3.6-3.2s2.9 1.1 3.6 3.2" fill="rgba(255,255,255,.82)"/></svg>`;
    return vscode.Uri.parse(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
}

function selectedTagEntry(node?: TagTreeItem): TagEntry | undefined {
    return node?.tagEntry;
}

async function createRoleFromTag(node: TagTreeItem | undefined, provider: TagTreeProvider): Promise<void> {
    const entry = selectedTagEntry(node);
    if (!entry || entry.isColor) {
        vscode.window.showWarningMessage('请选择一个普通标签来创建角色。');
        return;
    }

    const existing = resolveTagRole(entry.tag, roles).role;
    if (existing) {
        const action = await vscode.window.showWarningMessage(`标签 ${entry.tag} 已匹配角色“${existing.name}”。`, '打开角色', '仍创建新角色');
        if (action === '打开角色') {
            await openRole(existing);
            return;
        }
        if (action !== '仍创建新角色') return;
    }

    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    let defaultFileName = cfg.get<string>('rolesFile') || '角色库.json5';
    if (defaultFileName.startsWith('novel-helper/')) defaultFileName = defaultFileName.substring('novel-helper/'.length);
    const fullPath = await selectOrCreateFile('角色', defaultFileName, {
        includeMd: true,
        includeOjson5: true,
        includeCsv: true,
        includeToml: true,
        customFilter: (fileName: string) => {
            const lowerFileName = fileName.toLowerCase();
            const vocabKeywords = VOCABULARY_FILTER_KEYWORDS;
            return !vocabKeywords.some(keyword => lowerFileName.includes(keyword));
        },
    });
    if (!fullPath) return;

    const candidates = tagToRoleNameCandidates(entry.tag);
    const name = await vscode.window.showInputBox({
        title: '基于标签创建角色',
        prompt: `标签 ${entry.tag} 将升级为角色`,
        value: candidates[0],
        validateInput: value => value.trim() ? null : '角色名称不能为空',
    });
    if (!name) return;

    const typePick = await vscode.window.showQuickPick(
        ['主角', '配角', '联动角色', '组织', '地点', '物品', '设定', '事件', '伏笔', '自定义...'],
        { title: '选择角色类型', placeHolder: '标签升级后会进入角色体系，可继续补字段、关系和颜色' }
    );
    if (!typePick) return;
    const type = typePick === '自定义...'
        ? await vscode.window.showInputBox({ title: '自定义角色类型', value: '设定', validateInput: value => value.trim() ? null : '类型不能为空' })
        : typePick;
    if (!type) return;

    const affiliation = await vscode.window.showInputBox({ title: '从属/同盟标签', value: tagToAffiliation(entry.tag) || '', placeHolder: '例如 阵营/组织/世界观，可留空' });
    const description = await vscode.window.showInputBox({ title: '角色简介', value: `由标签 ${entry.tag} 创建。`, placeHolder: '可留空' });
    const color = await vscode.window.showInputBox({
        title: '角色颜色',
        placeHolder: '输入十六进制颜色，如 #E60033（可选）',
        validateInput: value => value && !/^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(value) ? '请输入合法的 #RRGGBB 或 #RRGGBBAA 形式' : null,
    });

    const clean = cleanTag(entry.tag);
    const newRole: Role = {
        name: name.trim(),
        type: type.trim(),
        uuid: generateUUIDv7(),
        tags: [clean],
        sourceTag: entry.tag,
    };
    if (affiliation?.trim()) newRole.affiliation = affiliation.trim();
    if (description?.trim()) newRole.description = description.trim();
    if (color?.trim()) newRole.color = color.trim();
    if (clean !== newRole.name && !clean.includes('/')) newRole.aliases = [clean];

    const success = addRoleToFile(fullPath, newRole);
    if (!success) {
        vscode.window.showErrorMessage(`基于标签 ${entry.tag} 创建角色失败`);
        return;
    }

    bindTagToRole(entry.tag, newRole);
    loadRoles(false, [fullPath]);
    refreshRoleAliasMatching();
    updateDecorations();
    provider.refresh();
    const fileName = path.basename(fullPath);
    vscode.window.showInformationMessage(`已将标签 ${entry.tag} 创建并绑定到角色“${newRole.name}”（${fileName}）`);
}

async function bindTagNodeToRole(node: TagTreeItem | undefined, provider: TagTreeProvider): Promise<void> {
    const entry = selectedTagEntry(node);
    if (!entry) {
        vscode.window.showWarningMessage('请选择一个普通标签来绑定角色。');
        return;
    }
    if (!roles.length) {
        vscode.window.showWarningMessage('当前还没有加载到角色，请先创建角色或刷新角色库。');
        return;
    }

    const candidates = tagToRoleNameCandidates(entry.tag);
    const sorted = roles.slice().sort((left, right) => roleRank(left, candidates) - roleRank(right, candidates) || left.name.localeCompare(right.name, 'zh-CN'));
    const selected = await vscode.window.showQuickPick(sorted.map(role => ({
        label: roleRank(role, candidates) === 0 ? `$(star-full) ${role.name}` : role.name,
        description: role.type || '角色',
        detail: `${role.affiliation ? `${role.affiliation} · ` : ''}${role.uuid ? `UUID: ${role.uuid}` : '缺少 UUID，将自动补齐'}${role.sourcePath ? ` · ${vscode.workspace.asRelativePath(role.sourcePath)}` : ''}`,
        role,
    })), { title: `将 ${entry.tag} 绑定到现有角色`, placeHolder: '绑定会保存角色 UUID，角色改名后仍能追踪' });
    if (!selected) return;

    const role = selected.role;
    if (!role.uuid) {
        await ensureRoleUUIDs([role], true);
        if (role.sourcePath) loadRoles(false, [role.sourcePath]);
    }
    if (!role.uuid) {
        vscode.window.showErrorMessage(`角色“${role.name}”仍缺少 UUID，无法建立绑定。`);
        return;
    }

    bindTagToRole(entry.tag, role);
    refreshRoleAliasMatching();
    provider.refresh();
    updateDecorations();
    vscode.window.showInformationMessage(`已将标签 ${entry.tag} 绑定到角色“${role.name}”。`);
}

async function unbindTagNodeRole(node: TagTreeItem | undefined, provider: TagTreeProvider): Promise<void> {
    const entry = selectedTagEntry(node);
    if (!entry) return;
    const removed = unbindTagRole(entry.tag);
    if (removed) {
        refreshRoleAliasMatching();
        provider.refresh();
        updateDecorations();
        vscode.window.showInformationMessage(`已解除标签 ${entry.tag} 的角色绑定。`);
    }
}

function refreshRoleAliasMatching(): void {
    try { clearAllRoleMatchCache(); } catch {}
    try { ahoCorasickManager.reset(); } catch {}
    try { getAsyncRoleMatcher().build(); } catch {}
}

async function showTagReferences(node: TagTreeItem | undefined): Promise<void> {
    const entry = node?.tagEntry;
    if (!entry) {
        vscode.window.showWarningMessage('请选择一个标签来查看引用。');
        return;
    }

    const { locations, delegatedRoleName } = await getReferencesForTagNode(entry.tag);
    if (!locations.length) {
        vscode.window.showInformationMessage(`没有找到标签 ${entry.tag} 的引用。`);
        return;
    }
    await vscode.commands.executeCommand('editor.action.showReferences', locations[0].uri, locations[0].range.start, locations);
    if (delegatedRoleName) {
        vscode.window.setStatusBarMessage(`标签 ${entry.tag} 已按角色“${delegatedRoleName}”显示引用`, 3500);
    }
}

async function openTagRole(node: TagTreeItem | undefined): Promise<void> {
    const role = node?.roleLink?.role || (node?.tagEntry ? resolveTagRole(node.tagEntry.tag, roles).role : undefined);
    if (!role) return;
    await openRole(role);
}

async function openRole(role: Role): Promise<void> {
    if (!role.sourcePath) {
        vscode.window.showWarningMessage(`角色“${role.name}”没有源文件路径。`);
        return;
    }
    const location = findDefinitionInFile(role, role.sourcePath) || new vscode.Location(vscode.Uri.file(role.sourcePath), new vscode.Position(0, 0));
    const doc = await vscode.workspace.openTextDocument(location.uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    const position = location.range.start;
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

function roleRank(role: Role, candidates: string[]): number {
    if (candidates.some(candidate => candidate.localeCompare(role.name, undefined, { sensitivity: 'accent' }) === 0)) return 0;
    if (Array.isArray(role.aliases) && role.aliases.some(alias => candidates.some(candidate => candidate.localeCompare(alias, undefined, { sensitivity: 'accent' }) === 0))) return 1;
    if (candidates.some(candidate => role.name.includes(candidate) || candidate.includes(role.name))) return 2;
    return 3;
}

