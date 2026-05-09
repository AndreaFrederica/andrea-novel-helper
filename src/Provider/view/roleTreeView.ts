import * as vscode from 'vscode';
import * as path from 'path';
import { labelForRoleKey } from '../../utils/i18n';
import { iconForRoleKey } from '../../utils/roleKeyIcons';
import { roles, onDidChangeRoles } from '../../activate';
import { Role } from '../../extension';
import { buildRoleMarkdown } from '../hoverProvider';
import { roleDetailNeedsExpansion, splitRoleDetailLines } from './roleDetailWrapping';
import { compareRoleType, getRoleTypeOrder } from './roleTypeOrder';

// 与 docRolesModel 对齐的分组结构
interface RoleHierarchyTypeGroup { type: string; roles: Role[]; }
interface RoleHierarchyAffiliationGroup { affiliation: string; types: RoleHierarchyTypeGroup[]; }

// Tree Item Types
// level 0: affiliation
// level 1: type
// level 2: role
// level 3: detail (包括优先级信息)

type NodeKind = 'affiliation' | 'type' | 'role' | 'detail' | 'detailLine' | 'specialRoot' | 'specialType' | 'specialAffiliation';

interface BaseNode { kind: NodeKind; key: string; parent?: BaseNode; uid?: string; }
interface AffiliationNode extends BaseNode { kind: 'affiliation'; children?: (TypeNode | RoleNode)[]; }
interface TypeNode extends BaseNode { kind: 'type'; affiliation: string; children?: RoleNode[]; }
interface RoleNode extends BaseNode { kind: 'role'; role: Role; affiliation: string; roleType: string; }
interface DetailNode extends BaseNode { kind: 'detail'; value: string; roleName: string; full?: string; detailType?: 'property' | 'priority' | 'prioritySource' | 'priorityBreakdown'; }
interface DetailLineNode extends BaseNode { kind: 'detailLine'; value: string; roleName: string; }
interface SpecialRootNode extends BaseNode { kind: 'specialRoot'; children: SpecialTypeNode[]; count: number; }
interface SpecialTypeNode extends BaseNode { kind: 'specialType'; roleType: string; children: SpecialAffiliationNode[]; }
interface SpecialAffiliationNode extends BaseNode { kind: 'specialAffiliation'; affiliation: string; children: RoleNode[]; roleType: string; }

export type AnyNode = AffiliationNode | TypeNode | RoleNode | DetailNode | DetailLineNode | SpecialRootNode | SpecialTypeNode | SpecialAffiliationNode;

export interface RoleTreeRenderOptions {
    roleSvgConfigKey?: string;
    colorizeRoleNameConfigKey?: string;
    showColorOnValueConfigKey?: string;
    enableRoleExpansionConfigKey?: string;
    alwaysExpandableConfigKey?: string;
    enableWrappingConfigKey?: string;
    wrapColumnConfigKey?: string;
}

const UNGROUPED = '(未分组)';

// ---- Persist expanded state (global) for All Roles view ----
const ROLE_EXPAND_KEY = 'roleHierarchyView.expanded';
let roleExpandedSet: Set<string> = new Set();

export class RoleTreeItem extends vscode.TreeItem {
    constructor(public readonly node: AnyNode, private readonly renderOptions: RoleTreeRenderOptions = {}) {
        super(RoleTreeItem.getLabel(node), RoleTreeItem.getInitialCollapsibleState(node, renderOptions));
        this.id = this.computeId(node);
        if (node.kind === 'specialRoot') {
            this.description = `${node.count}`;
            this.tooltip = '敏感词 / 词汇 / 正则表达式';
            this.contextValue = 'roleSpecialRoot';
        } else if (node.kind === 'specialType') {
            this.description = `${node.children?.reduce((a,c)=>a + (c.children?.length||0),0)}`;
            this.contextValue = 'roleSpecialType';
        } else if (node.kind === 'specialAffiliation') {
            this.description = `${node.children?.length || 0}`;
            this.contextValue = 'roleSpecialAffiliation';
        } else if (node.kind === 'role') {
            const roleNode = node as RoleNode;

            // 若来自扁平分组，roleType 可能被填为真实类型
            this.description = roleNode.roleType;
            this.tooltip = buildRoleMarkdown(roleNode.role);
            this.command = {
                command: 'AndreaNovelHelper.openRoleSource',
                title: '打开角色定义',
                arguments: [roleNode.role]
            };
            this.contextValue = 'roleNode';

            // 如果配置允许并且角色提供了 svg 字段，则优先使用该 svg 作为图标
            try {
                const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
                const useSvg = this.renderOptions.roleSvgConfigKey
                    ? cfg.get<boolean>(this.renderOptions.roleSvgConfigKey, false)
                    : cfg.get<boolean>('roles.display.useRoleSvgIfPresent', false);
                const svgField = roleNode.role.svg;
                if (useSvg && svgField && typeof svgField === 'string') {
                    try {
                        const uri = svgField.startsWith('data:image') ? vscode.Uri.parse(svgField) : vscode.Uri.file(path.isAbsolute(svgField) ? svgField : path.join(roleNode.role.packagePath || '', svgField));
                        this.iconPath = { light: uri, dark: uri };
                    } catch {}
                }
            } catch {}
            // 名称着色（以彩色图标标记，不改变文本颜色）
            try {
                const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
                const root = vscode.workspace.getConfiguration('AndreaNovelHelper');
                const colorize = this.renderOptions.colorizeRoleNameConfigKey
                    ? cfg.get<boolean>(this.renderOptions.colorizeRoleNameConfigKey, false)
                    : cfg.get<boolean>(`${root.get<boolean>('allRoles.syncWithDocRoles', true) ? 'docRoles' : 'allRoles'}.display.colorizeRoleName`, false);
                if (colorize && !this.iconPath) {
                    const r = roleNode.role as any;
                    const colorValue = (r.color || r.colour || r['颜色'] || '').toString().trim();
                    if (colorValue) {
                        const safe = colorValue.replace(/"/g, '%22');
                        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"><rect rx="3" ry="3" width="14" height="14" fill="${safe}" stroke="#00000040" stroke-width="0.5"/></svg>`;
                        const uri = vscode.Uri.parse('data:image/svg+xml;utf8,' + encodeURIComponent(svg));
                        this.iconPath = { light: uri, dark: uri };
                    }
                }
            } catch {}
            if (roleNode.role.sourcePath) {
                this.resourceUri = vscode.Uri.file(roleNode.role.sourcePath);
                // VS Code 对"可展开"的 TreeItem 会倾向使用"文件夹"图标，即使有 resourceUri。
                // 为了在允许展开时也保留接近原始文件类型的图标，这里按扩展名设置一个内置的文件类图标。
                if (!this.iconPath && this.collapsibleState !== vscode.TreeItemCollapsibleState.None) {
                    const p = roleNode.role.sourcePath.toLowerCase();
                    if (p.endsWith('.json') || p.endsWith('.json5')) {
                        this.iconPath = new vscode.ThemeIcon('file-code');
                    } else if (p.endsWith('.md') || p.endsWith('.markdown') || p.endsWith('.txt')) {
                        this.iconPath = new vscode.ThemeIcon('file-text');
                    } else {
                        this.iconPath = new vscode.ThemeIcon('file');
                    }
                }
            }
        } else if (node.kind === 'detail') {
            // 根据详情类型设置不同的图标和样式
            const dn = node as DetailNode;
            if (dn.detailType === 'priority') {
                this.iconPath = new vscode.ThemeIcon('symbol-number');
                this.contextValue = 'roleDetailPriority';
            } else if (dn.detailType === 'prioritySource') {
                this.iconPath = new vscode.ThemeIcon('file-code');
                this.contextValue = 'roleDetailPrioritySource';
            } else if (dn.detailType === 'priorityBreakdown') {
                this.iconPath = new vscode.ThemeIcon('graph');
                this.contextValue = 'roleDetailPriorityBreakdown';
            } else {
                this.iconPath = iconForRoleKey(`role.key.${dn.key}`);
                this.contextValue = 'roleDetail';
            }

            // 只显示 key；value/详细行上会显示实际的值
            this.tooltip = dn.full && dn.full.length > (dn.value?.length || 0) ? dn.full : dn.full;
            this.description = undefined;
        } else if (node.kind === 'detailLine') {
            this.label = node.value;
            this.contextValue = 'roleDetailLine';
            // 若父字段是颜色并且设置允许，则在 value 上显示色块图标
            try {
                const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
                const enabled = this.renderOptions.showColorOnValueConfigKey
                    ? cfg.get<boolean>(this.renderOptions.showColorOnValueConfigKey, true)
                    : cfg.get<boolean>('roles.details.showColorOnValue', true);
                const fieldKey = (node as any).parentKey as string | undefined;
                if (enabled && fieldKey) {
                    const keyLower = fieldKey.toLowerCase();
                    if (keyLower === 'color' || keyLower === 'colour' || keyLower === '颜色') {
                        const colorValue = (this.label || '').toString().trim();
                        if (colorValue) {
                            const safeColor = colorValue.replace(/"/g, '%22');
                            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><rect rx="2" ry="2" width="12" height="12" fill="${safeColor}" stroke="#00000020" stroke-width="0.5"/></svg>`;
                            const uri = vscode.Uri.parse('data:image/svg+xml;utf8,' + encodeURIComponent(svg));
                            this.iconPath = { light: uri, dark: uri };
                        }
                    }
                }
            } catch (e) { /* ignore */ }
        } else if (node.kind === 'type') {
            this.description = `${node.children?.length || 0}`;
            this.contextValue = 'roleTypeNode';
        } else if (node.kind === 'affiliation') {
            // children 可能同时包含类型与角色
            const count = (node.children || []).reduce((acc, ch: any) => {
                if (!ch) { return acc; }
                if (ch.kind === 'type') { return acc + (ch.children?.length || 0); }
                if (ch.kind === 'role') { return acc + 1; }
                return acc;
            }, 0);
            this.description = `${count}`;
            this.contextValue = 'roleAffiliationNode';
        }

        // 应用展开持久化（全局）：如果此节点在保存的展开集合中，则设为 Expanded
        try {
            if (this.id && this.collapsibleState !== vscode.TreeItemCollapsibleState.None) {
                if (roleExpandedSet.has(this.id)) { this.collapsibleState = vscode.TreeItemCollapsibleState.Expanded; }
            }
        } catch { /* ignore */ }
    }

    private computeId(node: AnyNode): string {
        if ((node as any).uid) { return (node as any).uid; }
        // fallback (should not normally happen after uid assignment)
        switch(node.kind) {
            case 'specialRoot': return 'specialRoot';
            case 'specialType': return `specialType:${node.key}`;
            case 'specialAffiliation': return `specialType:${(node as any).roleType}|aff:${(node as any).affiliation}`;
            case 'affiliation': return `aff:${node.key}`;
            case 'type': return `aff:${(node as any).affiliation}|type:${node.key}`;
            case 'role': return `role:${encodeURIComponent((node as any).role?.name || node.key)}`;
            case 'detail': {
                const dn = node as DetailNode;
                return `roleDetail:${encodeURIComponent(dn.roleName)}:${encodeURIComponent(dn.key)}`;
            }
            case 'detailLine': {
                const ln = node as DetailLineNode;
                return `roleDetailLine:${encodeURIComponent(ln.roleName)}:${encodeURIComponent(ln.key)}:${encodeURIComponent(ln.value.slice(0,40))}`;
            }
        }
    }

    private static getLabel(node: AnyNode): string {
        switch (node.kind) {
            case 'affiliation': return node.key;
            case 'type': return node.key;
            case 'role': return node.role.name;
            case 'detail': return labelForRoleKey(node.key);
            case 'detailLine': return node.key;
            case 'specialRoot': return '词汇 / 敏感词 / 正则表达式';
            case 'specialType': return node.key; 
            case 'specialAffiliation': return node.key; 
        }
    }

    private static getInitialCollapsibleState(node: AnyNode, renderOptions: RoleTreeRenderOptions): vscode.TreeItemCollapsibleState {
        if (node.kind === 'role') {
            const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
            const enableRoleExpansion = renderOptions.enableRoleExpansionConfigKey
                ? cfg.get<boolean>(renderOptions.enableRoleExpansionConfigKey, true)
                : cfg.get<boolean>('roles.details.enableRoleExpansion', true);
            return enableRoleExpansion ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
        }
        if (node.kind === 'detail') {
            const dn = node as DetailNode;
            if ((dn as any).objectValue) {
                return vscode.TreeItemCollapsibleState.Collapsed;
            }

            const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
            const always = renderOptions.alwaysExpandableConfigKey
                ? cfg.get<boolean>(renderOptions.alwaysExpandableConfigKey, true)
                : cfg.get<boolean>('roles.details.alwaysExpandable', true);
            if (always) { return vscode.TreeItemCollapsibleState.Collapsed; }

            const needsExpand = roleDetailNeedsExpansion(dn.key, dn.full, cfg, renderOptions);
            return needsExpand ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
        }
        if (node.kind === 'detailLine') { return vscode.TreeItemCollapsibleState.None; }
        return vscode.TreeItemCollapsibleState.Collapsed;
    }

    private getCollapsibleState(node: AnyNode): vscode.TreeItemCollapsibleState {
        if (node.kind === 'role') {
            const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
            const enableRoleExpansion = this.renderOptions.enableRoleExpansionConfigKey
                ? cfg.get<boolean>(this.renderOptions.enableRoleExpansionConfigKey, true)
                : cfg.get<boolean>('roles.details.enableRoleExpansion', true);
            return enableRoleExpansion ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
        }
        if (node.kind === 'detail') {
            const dn = node as DetailNode;

            // 如果有对象值，总是可以展开
            if ((dn as any).objectValue) {
                return vscode.TreeItemCollapsibleState.Collapsed;
            }

            const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
            const always = this.renderOptions.alwaysExpandableConfigKey
                ? cfg.get<boolean>(this.renderOptions.alwaysExpandableConfigKey, true)
                : cfg.get<boolean>('roles.details.alwaysExpandable', true);
            if (always) { return vscode.TreeItemCollapsibleState.Collapsed; }
            const needsExpand = roleDetailNeedsExpansion(dn.key, dn.full, cfg, this.renderOptions);
            return needsExpand ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
        }
        if (node.kind === 'detailLine') { return vscode.TreeItemCollapsibleState.None; }
        return vscode.TreeItemCollapsibleState.Collapsed;
    }
}

export class RoleTreeDataProvider implements vscode.TreeDataProvider<AnyNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<AnyNode | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private readonly renderOptions: RoleTreeRenderOptions = {}) {}

    refresh(): void { this._onDidChangeTreeData.fire(); }

    getTreeItem(element: AnyNode): vscode.TreeItem { return new RoleTreeItem(element, this.renderOptions); }

    getChildren(element?: AnyNode): vscode.ProviderResult<AnyNode[]> {
        if (!element) {
            return this.buildHierarchy();
        }
        if (element.kind === 'affiliation') {
            return element.children || [];
        }
        if (element.kind === 'type') {
            return element.children || [];
        }
        if (element.kind === 'specialRoot') {
            return element.children;
        }
        if (element.kind === 'specialType') { return element.children; }
        if (element.kind === 'specialAffiliation') { return element.children; }
        if (element.kind === 'role') { return this.buildRoleDetails(element as RoleNode); }
        if (element.kind === 'detail') {
            const dn = element as DetailNode;
            const objectValue = (dn as any).objectValue;
            if (objectValue !== undefined) {
                return this.buildObjectChildren(dn, objectValue);
            }
            return this.buildDetailLines(dn);
        }
        return [];
    }

    private buildRoleDetails(rn: RoleNode): DetailNode[] {
        const r: any = rn.role as any;
        const details: DetailNode[] = [];

        // 1. 添加优先级信息（如果存在）
        const priority = r._computedPriority;
        const filePriority = r._priority;
        const priorityBreakdown = r._priorityBreakdown;

        if (priority !== undefined || filePriority !== undefined || priorityBreakdown) {
            // 总优先级
            details.push({
                kind: 'detail',
                key: '⚡ 总优先级',
                value: priority !== undefined ? String(priority) : '未计算',
                full: `总优先级: ${priority || '未计算'}`,
                roleName: rn.role.name,
                detailType: 'priority'
            });

            // 文件定义的优先级
            if (filePriority !== undefined) {
                details.push({
                    kind: 'detail',
                    key: '📄 文件优先级',
                    value: String(filePriority),
                    full: `文件中定义的优先级: ${filePriority}`,
                    roleName: rn.role.name,
                    detailType: 'prioritySource'
                });
            }

            // 优先级构成详情
            if (priorityBreakdown) {
                details.push({
                    kind: 'detail',
                    key: '📊 优先级构成',
                    value: `来源: ${Object.keys(priorityBreakdown.source || {}).join(', ')}`,
                    full: `优先级构成详情:\n${this.formatPriorityBreakdown(priorityBreakdown)}`,
                    roleName: rn.role.name,
                    detailType: 'priorityBreakdown'
                });
            }
        }

        // 2. 添加基础属性（name, uuid, type）
        const basicFields = ['name', 'uuid', 'type'];
        for (const field of basicFields) {
            if (r[field] !== undefined) {
                const value = this.formatFieldValue(r[field], field);
                details.push({
                    kind: 'detail',
                    key: this.getFieldLabel(field),
                    value: value.short,
                    full: value.full,
                    roleName: rn.role.name,
                    detailType: 'property'
                });
            }
        }

        // 3. 添加其他属性
        const entries: [string, any][] = Object.entries(r || {});
        const processedKeys = new Set(['name', 'uuid', 'type', '_priority', '_computedPriority', '_priorityBreakdown']);

        entries
            .filter(([k]) => !processedKeys.has(k) && !k.startsWith('_'))
            .sort((a,b)=>a[0].localeCompare(b[0], 'zh-Hans', {numeric:true,sensitivity:'base'}))
            .forEach(([k, v]) => {
                const value = this.formatFieldValue(v, k);
                const detailNode: DetailNode = {
                    kind: 'detail',
                    key: this.getFieldLabel(k),
                    value: value.short,
                    full: value.full,
                    roleName: rn.role.name,
                    detailType: 'property'
                };

                // 如果是对象或数组，存储原始值以便后续展开
                if (value.isObject) {
                    (detailNode as any).objectValue = v;
                }

                details.push(detailNode);
            });

        return details;
    }

    private formatFieldValue(value: any, fieldName: string): { short: string; full: string; isObject?: boolean } {
        let full: string;
        let isObject = false;

        if (value === null || value === undefined) {
            full = '未设置';
        } else if (typeof value === 'string') {
            full = value;
        } else if (Array.isArray(value)) {
            if (value.length === 0) {
                full = '空数组';
            } else {
                full = `数组[${value.length}]`;
                isObject = true; // 数组可以展开
            }
        } else if (typeof value === 'object') {
            try {
                const keys = Object.keys(value);
                if (keys.length === 0) {
                    full = '空对象';
                } else {
                    full = `对象{${keys.length}个属性}`;
                    isObject = true;
                }
            } catch {
                full = String(value);
            }
        } else {
            full = String(value);
        }

        const limit = 120;
        const short = full.length > limit ? full.slice(0, limit) + '…' : full;
        return { short, full, isObject };
    }

    private getFieldLabel(field: string): string {
        const labelMap: { [key: string]: string } = {
            'name': '📝 名称',
            'uuid': '🆔 UUID',
            'type': '🏷️ 类型',
            'description': '📝 描述',
            'color': '🎨 颜色',
            'affiliation': '🏠 从属',
            'aliases': '📛️ 别名',
            'lookupKeys_pinyin': '🔤 拼音查询键',
            'lookupKeys_romanized': '🔡 罗马字查询键',
            'lookupKeys_spelling': '🔎 拼写查询键',
            'fixes': '🔧 修复',
            'priority': '⚡ 优先级',
            'wordSegmentFilter': '📝 分词过滤',
            'regex': '🔍 正则',
            'regexFlags': '🔍 正则标志',
            'packagePath': '📁 包路径',
            'sourcePath': '📄 源文件',
            'svg': '🖼️ 图标'
        };
        return labelMap[field] || field;
    }

    private formatPriorityBreakdown(breakdown: any): string {
        const lines: string[] = [];
        for (const [source, value] of Object.entries(breakdown.source || {})) {
            if (value !== undefined && value !== 0) {
                const sourceLabel = this.getPrioritySourceLabel(source);
                lines.push(`  • ${sourceLabel}: +${value}`);
            }
        }
        return lines.join('\n');
    }

    private getPrioritySourceLabel(source: string): string {
        const labelMap: { [key: string]: string } = {
            'fileDefined': '文件定义',
            'location': '位置优先级',
            'fileName': '文件名优先级',
            'fileType': '文件类型优先级',
            'default': '默认优先级'
        };
        return labelMap[source] || source;
    }

    private buildObjectChildren(parent: DetailNode, objectValue: any): DetailNode[] {
        const children: DetailNode[] = [];

        if (Array.isArray(objectValue)) {
            // 处理数组
            objectValue.forEach((item, index) => {
                const value = this.formatFieldValue(item, `[${index}]`);
                const childNode: DetailNode = {
                    kind: 'detail',
                    key: `[${index}]`,
                    value: value.short,
                    full: value.full,
                    roleName: parent.roleName,
                    detailType: 'property'
                };

                // 如果子项也是对象或数组，存储以便进一步展开
                if (value.isObject) {
                    (childNode as any).objectValue = item;
                }

                children.push(childNode);
            });
        } else if (typeof objectValue === 'object' && objectValue !== null) {
            // 处理对象
            Object.entries(objectValue).forEach(([key, value]) => {
                const formattedValue = this.formatFieldValue(value, key);
                const childNode: DetailNode = {
                    kind: 'detail',
                    key: key,
                    value: formattedValue.short,
                    full: formattedValue.full,
                    roleName: parent.roleName,
                    detailType: 'property'
                };

                // 如果子项也是对象或数组，存储以便进一步展开
                if (formattedValue.isObject) {
                    (childNode as any).objectValue = value;
                }

                children.push(childNode);
            });
        }

        return children;
    }

    private buildDetailLines(dn: DetailNode): DetailLineNode[] {
        const full = dn.full ?? dn.value;
        const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
        const lines = splitRoleDetailLines(dn.key, full, cfg, this.renderOptions);
        // attach parent key so TreeItem can know field name when rendering
        return lines.map((val, idx) => ({ kind:'detailLine', key: idx === 0 ? '…' : '  ', value: val, roleName: dn.roleName, parentKey: dn.key } as DetailLineNode & { parentKey?: string }));
    }

    private buildHierarchy(): AnyNode[] {
    // 读取显示配置（支持与当前文章角色设置同步）
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    const sync = cfg.get<boolean>('allRoles.syncWithDocRoles', true);
    const base = sync ? 'docRoles' : 'allRoles';
    const groupBy = cfg.get<string>(`${base}.groupBy`, 'affiliation');
    const respectAffiliation = cfg.get<boolean>(`${base}.respectAffiliation`, true);
    const respectType = cfg.get<boolean>(`${base}.respectType`, true);
    const primaryGroup = cfg.get<string>(`${base}.primaryGroup`, 'affiliation');
    const useCustomGroups = cfg.get<boolean>(`${base}.useCustomGroups`, false);
    const customGroups = cfg.get<any[]>(`${base}.customGroups`, []);
    const typeOrder = getRoleTypeOrder('allRoles');

        // 将全局 roles 视为“可见集合”
        const seen = new Set<Role>(roles);

        // 分组构建（与 docRolesModel.hierarchyFromSeen 对齐）
        // 自定义分组：也要尊重 respectAffiliation / respectType
        const buildCustomGroups = (
            set: Set<Role>,
            groups: any[],
            respectAff: boolean,
            respectTyp: boolean
        ): RoleHierarchyAffiliationGroup[] => {
            const grouped = new Map<string, Role[]>();
            const other: Role[] = [];
            for (const g of groups) { if (g?.name) { grouped.set(g.name, []); } }
            for (const r of set) {
                let matched = false;
                for (const g of groups) {
                    if (!g?.name || !Array.isArray(g.patterns)) { continue; }
                    // 自定义分组的『匹配归属』不受忽略开关影响：
                    // 忽略类型/归属 仅影响『显示层级是否按该字段再分组（是否扁平化）』，
                    // 不应导致匹配不到分组而全部落入“其他”。因此这里始终使用真实字段匹配。
                    const field = g.matchType === 'type'
                        ? (r.type || '')
                        : (r.affiliation || '');
                    if (g.patterns.some((p: string) => field.includes(p))) {
                        grouped.get(g.name)!.push(r); matched = true; break;
                    }
                }
                if (!matched) { other.push(r); }
            }
            if (other.length) { grouped.set('其他', other); }
            // 若忽略归属，且存在按归属匹配的自定义分组，则在顶层进行扁平化：
            // 将所有自定义分组合并为一个“全部角色”分组，仅在二级按类型（或扁平）展示。
            const hasAffBased = groups.some(g => g?.matchType === 'affiliation');
            if (!respectAff && hasAffBased) {
                const merged: Role[] = [];
                for (const arr of grouped.values()) { merged.push(...arr); }
                if (merged.length === 0) { return []; }
                const typeMap = new Map<string, Role[]>();
                for (const r of merged) {
                    const t = respectTyp ? (r.type || 'unknown') : '__FLAT__';
                    if (!typeMap.has(t)) { typeMap.set(t, []); }
                    typeMap.get(t)!.push(r);
                }
                const tgs: RoleHierarchyTypeGroup[] = [];
                for (const [t, rs] of typeMap) { rs.sort((a,b)=>a.name.localeCompare(b.name,'zh-Hans',{numeric:true,sensitivity:'base'})); tgs.push({ type: t, roles: rs }); }
                tgs.sort((a,b)=>compareRoleType(a.type, b.type, typeOrder));
                return [{ affiliation: '全部角色', types: tgs }];
            }
            const out: RoleHierarchyAffiliationGroup[] = [];
            for (const [name, arr] of grouped) {
                if (!arr.length) { continue; }
                const typeMap = new Map<string, Role[]>();
                for (const r of arr) {
                    // 忽略类型时，使用扁平占位键，避免再以类型分组
                    const t = respectTyp ? (r.type || 'unknown') : '__FLAT__';
                    if (!typeMap.has(t)) { typeMap.set(t, []); }
                    typeMap.get(t)!.push(r);
                }
                const tgs: RoleHierarchyTypeGroup[] = [];
                for (const [t, rs] of typeMap) { rs.sort((a,b)=>a.name.localeCompare(b.name,'zh-Hans',{numeric:true,sensitivity:'base'})); tgs.push({ type: t, roles: rs }); }
                tgs.sort((a,b)=>compareRoleType(a.type, b.type, typeOrder));
                out.push({ affiliation: name, types: tgs });
            }
            out.sort((a,b)=>{
                if (a.affiliation === '其他') { return 1; }
                if (b.affiliation === '其他') { return -1; }
                const ai = groups.findIndex(g=>g.name===a.affiliation);
                const bi = groups.findIndex(g=>g.name===b.affiliation);
                return ai - bi;
            });
            return out;
        };

        let groupsOut: RoleHierarchyAffiliationGroup[] = [];
        if (groupBy === 'none') {
            const list = Array.from(seen).sort((a,b)=>a.name.localeCompare(b.name,'zh-Hans',{numeric:true,sensitivity:'base'}));
            groupsOut = [{ affiliation: '全部角色', types: [{ type: '__FLAT__', roles: list }] }];
        } else if (useCustomGroups && customGroups.length > 0) {
            groupsOut = buildCustomGroups(seen, customGroups, respectAffiliation, respectType);
        } else {
            const map = new Map<string, Map<string, Role[]>>();
            for (const r of seen) {
                let firstKey = '';
                let secondKey = '';
                if (groupBy === 'type') {
                    firstKey = r.type || 'unknown';
                    secondKey = respectAffiliation ? (r.affiliation?.trim() || UNGROUPED) : '';
                } else {
                    if (respectAffiliation) {
                        if (primaryGroup === 'type') {
                            firstKey = r.type || 'unknown';
                            secondKey = respectType ? (r.affiliation?.trim() || UNGROUPED) : '';
                        } else {
                            firstKey = r.affiliation?.trim() || UNGROUPED;
                            secondKey = respectType ? (r.type || 'unknown') : '';
                        }
                    } else {
                        if (respectType) { firstKey = r.type || 'unknown'; secondKey = ''; }
                        else { firstKey = '所有角色'; secondKey = ''; }
                    }
                }
                if (!map.has(firstKey)) { map.set(firstKey, new Map()); }
                const tm = map.get(firstKey)!; if (!tm.has(secondKey)) { tm.set(secondKey, []); }
                tm.get(secondKey)!.push(r);
            }
            const firstLevelIsType = groupBy === 'type' || (!respectAffiliation && respectType) || (groupBy === 'affiliation' && respectAffiliation && primaryGroup === 'type');
            const secondLevelIsType = !firstLevelIsType && respectType;
            const res: RoleHierarchyAffiliationGroup[] = [];
            for (const [fk, tm] of map) {
                const tgs: RoleHierarchyTypeGroup[] = [];
                for (const [sk, arr] of tm) {
                    arr.sort((a,b)=>a.name.localeCompare(b.name,'zh-Hans',{numeric:true,sensitivity:'base'}));
                    tgs.push({ type: sk === '' ? '__FLAT__' : sk, roles: arr.slice() });
                }
                tgs.sort((a,b)=>secondLevelIsType
                    ? compareRoleType(a.type, b.type, typeOrder)
                    : a.type.localeCompare(b.type,'zh-Hans',{numeric:true,sensitivity:'base'}));
                res.push({ affiliation: fk, types: tgs });
            }
            res.sort((a,b)=>firstLevelIsType
                ? compareRoleType(a.affiliation, b.affiliation, typeOrder)
                : a.affiliation.localeCompare(b.affiliation,'zh-Hans',{numeric:true,sensitivity:'base'}));
            groupsOut = res;
        }

        // 将分组结构渲染为树节点
        const SPECIAL_TYPES = new Set(['敏感词','词汇','正则表达式']);
        const affiliationNodes: AffiliationNode[] = [];
        const specialTypeMap = new Map<string, Map<string, Role[]>>();
        let specialCount = 0;
        for (const g of groupsOut) {
            const children: (TypeNode | RoleNode)[] = [];
            for (const tg of g.types) {
                if (tg.type === '__FLAT__') {
                    // 扁平：角色直接挂到归属节点下；描述显示真实类型
                    const rNodes: RoleNode[] = tg.roles.map(r=>({ kind:'role', key:r.name, role:r, affiliation:g.affiliation, roleType: r.type || 'unknown' }));
                    children.push(...rNodes);
                    continue;
                }
                // 自定义分组时不抽取特殊类型到根；仅标准模式抽取
                if (!useCustomGroups && SPECIAL_TYPES.has(tg.type)) {
                    if (!specialTypeMap.has(tg.type)) { specialTypeMap.set(tg.type, new Map()); }
                    const affMap = specialTypeMap.get(tg.type)!;
                    if (!affMap.has(g.affiliation)) { affMap.set(g.affiliation, []); }
                    affMap.get(g.affiliation)!.push(...tg.roles);
                    specialCount += tg.roles.length;
                    continue;
                }
                const roleNodes: RoleNode[] = tg.roles.map(r=>({ kind:'role', key:r.name, role:r, affiliation:g.affiliation, roleType: tg.type }));
                children.push({ kind:'type', key: tg.type, affiliation: g.affiliation, children: roleNodes });
            }
            if (children.length) { affiliationNodes.push({ kind:'affiliation', key: g.affiliation, children }); }
        }
        affiliationNodes.sort((a,b)=>a.key.localeCompare(b.key,'zh-Hans',{numeric:true,sensitivity:'base'}));

        // 构建特殊根
        let roots: AnyNode[] = affiliationNodes;
        if (!useCustomGroups) {
            const specialTypeNodes: SpecialTypeNode[] = [];
            for (const [type, affMap] of specialTypeMap) {
                const affChildren: SpecialAffiliationNode[] = [];
                for (const [aff, arr] of affMap) {
                    arr.sort((a,b)=>a.name.localeCompare(b.name,'zh-Hans',{numeric:true,sensitivity:'base'}));
                    const roleNodes: RoleNode[] = arr.map(r=>({ kind:'role', key:r.name, role:r, affiliation: aff, roleType: type }));
                    affChildren.push({ kind:'specialAffiliation', key: aff, affiliation: aff, children: roleNodes, roleType: type });
                }
                affChildren.sort((a,b)=>a.key.localeCompare(b.key,'zh-Hans',{numeric:true,sensitivity:'base'}));
                specialTypeNodes.push({ kind:'specialType', key: type, roleType: type, children: affChildren });
            }
            specialTypeNodes.sort((a,b)=>compareRoleType(a.key, b.key, typeOrder));
            const specialRoot: SpecialRootNode | undefined = specialTypeNodes.length ? { kind:'specialRoot', key:'__SPECIAL__', children: specialTypeNodes, count: specialCount } : undefined;
            if (specialRoot) { roots = [...affiliationNodes, specialRoot]; }
        }

        // 稳定 uid 分配
        const idCounts = new Map<string, number>();
        const baseId = (node: AnyNode): string => {
            switch(node.kind) {
                case 'specialRoot': return 'specialRoot';
                case 'specialType': return `specialType:${node.key}`;
                case 'specialAffiliation': return `specialType:${(node as SpecialAffiliationNode).roleType}|aff:${encodeURIComponent(node.affiliation)}`;
                case 'affiliation': return `aff:${encodeURIComponent(node.key)}`;
                case 'type': return `aff:${encodeURIComponent((node as TypeNode).affiliation)}|type:${encodeURIComponent(node.key)}`;
                case 'role': {
                    const rn = node as RoleNode;
                    const p = encodeURIComponent(rn.role.sourcePath || '');
                    const aff = encodeURIComponent(rn.affiliation || '');
                    const t = encodeURIComponent(rn.roleType || '');
                    const n = encodeURIComponent(rn.role.name);
                    return `role:${p}:${aff}:${t}:${n}`;
                }
                case 'detail': {
                    const dn = node as DetailNode;
                    return `roleDetail:${encodeURIComponent(dn.roleName)}:${encodeURIComponent(dn.key)}`;
                }
                default:
                    return `node:${encodeURIComponent((node as any).key || '')}`;
            }
        };
        const walk = (node: AnyNode) => {
            const b = baseId(node);
            const prev = idCounts.get(b) || 0;
            node.uid = prev === 0 ? b : `${b}::${prev+1}`;
            idCounts.set(b, prev + 1);
            if ((node as any).children) {
                for (const c of (node as any).children as AnyNode[]) { c.parent = node; walk(c); }
            }
        };
        for (const rNode of roots) { walk(rNode); }
        return roots;
    }
}

export function registerRoleTreeView(context: vscode.ExtensionContext) {
    const provider = new RoleTreeDataProvider();
    const view = vscode.window.createTreeView('roleHierarchyView', { treeDataProvider: provider, showCollapseAll: true });
    context.subscriptions.push(view);
    // persistent expand state (global, not per-document)
    roleExpandedSet = new Set(context.workspaceState.get<string[]>(ROLE_EXPAND_KEY, []));
    const save = () => context.workspaceState.update(ROLE_EXPAND_KEY, Array.from(roleExpandedSet));
    const idOf = (el: any): string | undefined => {
        if (el instanceof RoleTreeItem) { return el.id!; }
        // element here is the raw AnyNode; reconstruct an id like RoleTreeItem.computeId
        try {
            const node = el as AnyNode;
            if ((node as any).uid) { return (node as any).uid as string; }
            // fallback minimal: use kind/key based id
            switch(node.kind) {
                case 'affiliation': return `aff:${encodeURIComponent(node.key)}`;
                case 'type': return `aff:${encodeURIComponent((node as any).affiliation)}|type:${encodeURIComponent(node.key)}`;
                case 'specialRoot': return 'specialRoot';
                case 'specialType': return `specialType:${encodeURIComponent(node.key)}`;
                case 'specialAffiliation': return `specialType:${encodeURIComponent((node as any).roleType)}|aff:${encodeURIComponent((node as any).affiliation)}`;
                case 'role': {
                    const rn = node as any;
                    const p = encodeURIComponent(rn.role?.sourcePath || '');
                    const aff = encodeURIComponent(rn.affiliation || '');
                    const t = encodeURIComponent(rn.roleType || '');
                    const n = encodeURIComponent(rn.role?.name || node.key);
                    return `role:${p}:${aff}:${t}:${n}`;
                }
                case 'detail': {
                    const dn = node as any; return `roleDetail:${encodeURIComponent(dn.roleName)}:${encodeURIComponent(dn.key)}`;
                }
                default: return undefined;
            }
        } catch { return undefined; }
    };
    context.subscriptions.push(
        view.onDidExpandElement(e => { const id = idOf(e.element as any); if (id) { roleExpandedSet.add(id); save(); } }),
        view.onDidCollapseElement(e => { const id = idOf(e.element as any); if (id) { roleExpandedSet.delete(id); save(); } }),
    );

    context.subscriptions.push(vscode.commands.registerCommand('AndreaNovelHelper.openRoleSource', async (role: Role) => {
        if (!role.sourcePath) { return; }
        try {
            const srcPath = role.sourcePath;
            if (srcPath && srcPath.toLowerCase().endsWith('.json5')) {
                const andreaCfg = vscode.workspace.getConfiguration('andrea');
                const openWithRoleManager = andreaCfg.get<boolean>('roleJson5.openWithRoleManager', false);
                if (openWithRoleManager) {
                    try {
                        await vscode.commands.executeCommand('andrea.roleJson5Editor.def', { name: role.name, path: srcPath });
                        return;
                    } catch (e) {
                        console.warn('[RoleTreeView] andrea.roleJson5Editor.def failed', e);
                    }
                }
            }

            const doc = await vscode.workspace.openTextDocument(role.sourcePath);
            const editor = await vscode.window.showTextDocument(doc, { preview: true });
            const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
            const hugeTh = cfg.get<number>('hugeFile.thresholdBytes', 50*1024)!;
            let txt = '';
            if (doc.getText().length * 1.8 > hugeTh) {
                console.warn('[RoleTreeView] skip huge file full search', doc.uri.fsPath);
                const slice = doc.getText().slice(0, 8*1024);
                txt = slice;
            } else {
                txt = doc.getText();
            }
            let idx = txt.indexOf(role.name);
            if (idx < 0) { idx = txt.search(new RegExp(role.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))); }
            if (idx >=0) {
                const pos = doc.positionAt(idx);
                editor.selection = new vscode.Selection(pos, pos);
                editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
            }
        } catch {/* ignore */}
    }));
    // 订阅角色变化事件（静态导入）
    context.subscriptions.push(onDidChangeRoles(()=> provider.refresh()));
    // 订阅显示配置变化
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e=>{
        if (e.affectsConfiguration('AndreaNovelHelper.docRoles') || e.affectsConfiguration('AndreaNovelHelper.allRoles')) { provider.refresh(); }
    }));
    // 轻量刷新以应用初始展开状态
    setTimeout(()=>{ provider.refresh(); }, 300);
}
