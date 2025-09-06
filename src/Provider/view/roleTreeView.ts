import * as vscode from 'vscode';
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

type NodeKind = 'affiliation' | 'type' | 'role' | 'specialRoot' | 'specialType' | 'specialAffiliation';

interface BaseNode { kind: NodeKind; key: string; parent?: BaseNode; uid?: string; }
interface AffiliationNode extends BaseNode { kind: 'affiliation'; children?: (TypeNode | RoleNode)[]; }
interface TypeNode extends BaseNode { kind: 'type'; affiliation: string; children?: RoleNode[]; }
interface RoleNode extends BaseNode { kind: 'role'; role: Role; affiliation: string; roleType: string; }
interface SpecialRootNode extends BaseNode { kind: 'specialRoot'; children: SpecialTypeNode[]; count: number; }
interface SpecialTypeNode extends BaseNode { kind: 'specialType'; roleType: string; children: SpecialAffiliationNode[]; }
interface SpecialAffiliationNode extends BaseNode { kind: 'specialAffiliation'; affiliation: string; children: RoleNode[]; roleType: string; }

export type AnyNode = AffiliationNode | TypeNode | RoleNode | SpecialRootNode | SpecialTypeNode | SpecialAffiliationNode;

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
            if (node.role.sourcePath) {
                this.resourceUri = vscode.Uri.file(node.role.sourcePath);
            }
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
        }
    }

    private static getLabel(node: AnyNode): string {
        switch (node.kind) {
            case 'affiliation': return node.key;
            case 'type': return node.key;
            case 'role': return node.role.name;
            case 'specialRoot': return '词汇 / 敏感词 / 正则表达式';
            case 'specialType': return node.key; 
            case 'specialAffiliation': return node.key; 
        }
    }

    private static getCollapsibleState(node: AnyNode): vscode.TreeItemCollapsibleState {
    if (node.kind === 'role') {
            return vscode.TreeItemCollapsibleState.None;
        }
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
        return [];
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
        const buildCustomGroups = (set: Set<Role>, groups: any[]): RoleHierarchyAffiliationGroup[] => {
            const grouped = new Map<string, Role[]>();
            const other: Role[] = [];
            for (const g of groups) { if (g?.name) { grouped.set(g.name, []); } }
            for (const r of set) {
                let matched = false;
                for (const g of groups) {
                    if (!g?.name || !Array.isArray(g.patterns)) { continue; }
                    const field = g.matchType === 'type' ? (r.type || '') : (r.affiliation || '');
                    if (g.patterns.some((p: string) => field.includes(p))) {
                        grouped.get(g.name)!.push(r); matched = true; break;
                    }
                }
                if (!matched) { other.push(r); }
            }
            if (other.length) { grouped.set('其他', other); }
            const out: RoleHierarchyAffiliationGroup[] = [];
            for (const [name, arr] of grouped) {
                if (!arr.length) { continue; }
                const typeMap = new Map<string, Role[]>();
                for (const r of arr) { const t = r.type || 'unknown'; if (!typeMap.has(t)) { typeMap.set(t, []); } typeMap.get(t)!.push(r); }
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
            groupsOut = buildCustomGroups(seen, customGroups);
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
