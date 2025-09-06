import * as vscode from 'vscode';
import * as path from 'path';
import { labelForRoleKey } from '../../utils/i18n';
import { iconForRoleKey } from '../../utils/roleKeyIcons';
import { roles, onDidChangeRoles } from '../../activate';
import { Role } from '../../extension';
import { buildRoleMarkdown } from '../hoverProvider';

// 与 docRolesModel 对齐的分组结构
interface RoleHierarchyTypeGroup { type: string; roles: Role[]; }
interface RoleHierarchyAffiliationGroup { affiliation: string; types: RoleHierarchyTypeGroup[]; }

// Tree Item Types
// level 0: affiliation
// level 1: type
// level 2: role

type NodeKind = 'affiliation' | 'type' | 'role' | 'detail' | 'detailLine' | 'specialRoot' | 'specialType' | 'specialAffiliation';

interface BaseNode { kind: NodeKind; key: string; parent?: BaseNode; uid?: string; }
interface AffiliationNode extends BaseNode { kind: 'affiliation'; children?: (TypeNode | RoleNode)[]; }
interface TypeNode extends BaseNode { kind: 'type'; affiliation: string; children?: RoleNode[]; }
interface RoleNode extends BaseNode { kind: 'role'; role: Role; affiliation: string; roleType: string; }
interface DetailNode extends BaseNode { kind: 'detail'; value: string; roleName: string; full?: string; }
interface DetailLineNode extends BaseNode { kind: 'detailLine'; value: string; roleName: string; }
interface SpecialRootNode extends BaseNode { kind: 'specialRoot'; children: SpecialTypeNode[]; count: number; }
interface SpecialTypeNode extends BaseNode { kind: 'specialType'; roleType: string; children: SpecialAffiliationNode[]; }
interface SpecialAffiliationNode extends BaseNode { kind: 'specialAffiliation'; affiliation: string; children: RoleNode[]; roleType: string; }

export type AnyNode = AffiliationNode | TypeNode | RoleNode | DetailNode | DetailLineNode | SpecialRootNode | SpecialTypeNode | SpecialAffiliationNode;

const UNGROUPED = '(未分组)';

export class RoleTreeItem extends vscode.TreeItem {
    constructor(public readonly node: AnyNode) {
        super(RoleTreeItem.getLabel(node), RoleTreeItem.getCollapsibleState(node));
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
            // 若来自扁平分组，roleType 可能被填为真实类型
            this.description = node.roleType;
            this.tooltip = buildRoleMarkdown(node.role);
            this.command = {
                command: 'AndreaNovelHelper.openRoleSource',
                title: '打开角色定义',
                arguments: [node.role]
            };
            this.contextValue = 'roleNode';
            // 如果配置允许并且角色提供了 svg 字段，则优先使用该 svg 作为图标
            try {
                const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
                const useSvg = cfg.get<boolean>('roles.display.useRoleSvgIfPresent', false);
                const svgField = (node.role as any).svg;
                if (useSvg && svgField && typeof svgField === 'string') {
                    try {
                        const uri = svgField.startsWith('data:image') ? vscode.Uri.parse(svgField) : vscode.Uri.file(path.isAbsolute(svgField) ? svgField : path.join(node.role.packagePath || '', svgField));
                        this.iconPath = { light: uri, dark: uri };
                    } catch {}
                }
            } catch {}
            // 名称着色（以彩色图标标记，不改变文本颜色）
            try {
                const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
                const root = vscode.workspace.getConfiguration('AndreaNovelHelper');
                const sync = root.get<boolean>('allRoles.syncWithDocRoles', true);
                const colorize = cfg.get<boolean>(`${sync ? 'docRoles' : 'allRoles'}.display.colorizeRoleName`, false);
                if (colorize && !this.iconPath) {
                    const r: any = node.role as any;
                    const colorValue = (r.color || r.colour || r['颜色'] || '').toString().trim();
                    if (colorValue) {
                        const safe = colorValue.replace(/"/g, '%22');
                        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"><rect rx="3" ry="3" width="14" height="14" fill="${safe}" stroke="#00000040" stroke-width="0.5"/></svg>`;
                        const uri = vscode.Uri.parse('data:image/svg+xml;utf8,' + encodeURIComponent(svg));
                        this.iconPath = { light: uri, dark: uri };
                    }
                }
            } catch {}
            if (node.role.sourcePath) {
                this.resourceUri = vscode.Uri.file(node.role.sourcePath);
                // VS Code 对“可展开”的 TreeItem 会倾向使用“文件夹”图标，即使有 resourceUri。
                // 为了在允许展开时也保留接近原始文件类型的图标，这里按扩展名设置一个内置的文件类图标。
                if (!this.iconPath && this.collapsibleState !== vscode.TreeItemCollapsibleState.None) {
                    const p = node.role.sourcePath.toLowerCase();
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
            // 只显示 key；value/详细行上会显示实际的值
            const dn = node as DetailNode;
            this.tooltip = dn.full && dn.full.length > (dn.value?.length || 0) ? dn.full : dn.full;
            this.description = undefined;
            this.iconPath = iconForRoleKey(`role.key.${dn.key}`);
            this.contextValue = 'roleDetail';
        } else if (node.kind === 'detailLine') {
            this.label = node.value;
            this.contextValue = 'roleDetailLine';
            // 若父字段是颜色并且设置允许，则在 value 上显示色块图标
            try {
                const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
                const enabled = cfg.get<boolean>('roles.details.showColorOnValue', true);
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

    private static getCollapsibleState(node: AnyNode): vscode.TreeItemCollapsibleState {
        if (node.kind === 'role') {
            const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
            const enableRoleExpansion = cfg.get<boolean>('roles.details.enableRoleExpansion', true);
            return enableRoleExpansion ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
        }
        if (node.kind === 'detail') { 
            const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
            const always = cfg.get<boolean>('roles.details.alwaysExpandable', true);
            if (always) { return vscode.TreeItemCollapsibleState.Collapsed; }
            const wrapCol = Math.max(5, Math.min(200, cfg.get<number>('roles.details.wrapColumn', 20) || 20));
            const dn = node as DetailNode;
            const needsExpand = !!dn.full && (dn.full.includes('\n') || dn.full.length > wrapCol);
            return needsExpand ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
        }
        if (node.kind === 'detailLine') { return vscode.TreeItemCollapsibleState.None; }
        return vscode.TreeItemCollapsibleState.Collapsed;
    }
}

export class RoleTreeDataProvider implements vscode.TreeDataProvider<AnyNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<AnyNode | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    refresh(): void { this._onDidChangeTreeData.fire(); }

    getTreeItem(element: AnyNode): vscode.TreeItem { return new RoleTreeItem(element); }

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
    if (element.kind === 'detail') { return this.buildDetailLines(element as DetailNode); }
        return [];
    }

    private buildRoleDetails(rn: RoleNode): DetailNode[] {
        const r: any = rn.role as any;
        const entries: [string, any][] = Object.entries(r || {});
        // 将 name 置顶，其余按键名排序
        entries.sort((a,b)=>{
            if (a[0] === 'name') { return -1; }
            if (b[0] === 'name') { return 1; }
            return a[0].localeCompare(b[0], 'zh-Hans', {numeric:true,sensitivity:'base'});
        });
        const toStr = (v: any): { short: string; full: string } => {
            let full: string;
            if (v === null || v === undefined) { full = String(v); }
            else if (typeof v === 'string') { full = v; }
            else if (Array.isArray(v)) { full = v.join(', '); }
            else if (typeof v === 'object') { try { full = JSON.stringify(v); } catch { full = String(v); } }
            else { full = String(v); }
            const limit = 120;
            const short = full.length > limit ? full.slice(0, limit) + '…' : full;
            return { short, full };
        };
        const details: DetailNode[] = entries.map(([k, v]) => {
            const { short, full } = toStr(v);
            return { kind:'detail', key: k, value: short, full, roleName: rn.role.name } as DetailNode;
        });
        return details;
    }

    private buildDetailLines(dn: DetailNode): DetailLineNode[] {
        const full = dn.full ?? dn.value;
        const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    const wrapCol = Math.max(5, Math.min(200, cfg.get<number>('roles.details.wrapColumn', 20) || 20));
        const lines: string[] = [];
        const pushWrapped = (s: string) => {
            const width = wrapCol;
            if (s.length <= width) { lines.push(s); return; }
            let i = 0;
            while (i < s.length) {
                lines.push(s.slice(i, i + width));
                i += width;
            }
        };
        if (full.includes('\n')) {
            for (const part of full.split(/\r?\n/)) { pushWrapped(part); }
        } else {
            pushWrapped(full);
        }
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
                tgs.sort((a,b)=>a.type.localeCompare(b.type,'zh-Hans',{numeric:true,sensitivity:'base'}));
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
                tgs.sort((a,b)=>a.type.localeCompare(b.type,'zh-Hans',{numeric:true,sensitivity:'base'}));
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
            const res: RoleHierarchyAffiliationGroup[] = [];
            for (const [fk, tm] of map) {
                const tgs: RoleHierarchyTypeGroup[] = [];
                for (const [sk, arr] of tm) {
                    arr.sort((a,b)=>a.name.localeCompare(b.name,'zh-Hans',{numeric:true,sensitivity:'base'}));
                    tgs.push({ type: sk === '' ? '__FLAT__' : sk, roles: arr.slice() });
                }
                tgs.sort((a,b)=>a.type.localeCompare(b.type,'zh-Hans',{numeric:true,sensitivity:'base'}));
                res.push({ affiliation: fk, types: tgs });
            }
            res.sort((a,b)=>a.affiliation.localeCompare(b.affiliation,'zh-Hans',{numeric:true,sensitivity:'base'}));
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
            specialTypeNodes.sort((a,b)=>a.key.localeCompare(b.key,'zh-Hans',{numeric:true,sensitivity:'base'}));
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
    // persistent expand state
    const EXPAND_KEY = 'roleHierarchyView.expanded';
    const expanded: Set<string> = new Set(context.workspaceState.get<string[]>(EXPAND_KEY, []));
    const save = () => context.workspaceState.update(EXPAND_KEY, Array.from(expanded));
    view.onDidExpandElement(e=>{ if (e.element instanceof RoleTreeItem) { expanded.add(e.element.id!); save(); } else if ((e.element as any)?.id) { expanded.add((e.element as any).id); save(); }});
    view.onDidCollapseElement(e=>{ if (e.element instanceof RoleTreeItem) { expanded.delete(e.element.id!); save(); } else if ((e.element as any)?.id) { expanded.delete((e.element as any).id); save(); }});

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
    // initial expand restore after short delay (tree populated)
    setTimeout(()=>{
    const ids = Array.from(expanded);
    if (!ids.length) { return; }
        // attempt shallow reveal per id
        // (VS Code will auto expand ancestors)
        // we just iterate top-level ones
        // no strict guarantee but lightweight
        provider.refresh();
    }, 400);
}
