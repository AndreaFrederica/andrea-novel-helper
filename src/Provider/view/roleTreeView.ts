import * as vscode from 'vscode';
import { roles, onDidChangeRoles } from '../../activate';
import { Role } from '../../extension';
import { buildRoleMarkdown } from '../hoverProvider';

// Tree Item Types
// level 0: affiliation
// level 1: type
// level 2: role

type NodeKind = 'affiliation' | 'type' | 'role' | 'specialRoot' | 'specialType' | 'specialAffiliation';

interface BaseNode { kind: NodeKind; key: string; parent?: BaseNode; uid?: string; }
interface AffiliationNode extends BaseNode { kind: 'affiliation'; children?: TypeNode[]; }
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
            this.description = `${node.children?.reduce((acc, t) => acc + (t.children?.length || 0), 0) || 0}`;
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
        const affMap = new Map<string, Map<string, Role[]>>();
        for (const r of roles) {
            const aff = r.affiliation?.trim() || UNGROUPED;
            const type = r.type || 'unknown';
            if (!affMap.has(aff)) {
                affMap.set(aff, new Map());
            }
            const typeMap = affMap.get(aff)!;
            if (!typeMap.has(type)) {
                typeMap.set(type, []);
            }
            typeMap.get(type)!.push(r);
        }
        const affiliationNodes: AffiliationNode[] = [];
        const SPECIAL_TYPES = new Set(['敏感词','词汇','正则表达式']);
        let specialCount = 0;
        // Build affiliation nodes excluding special types
        for (const [aff, typeMap] of affMap) {
            const typeNodes: TypeNode[] = [];
            for (const [type, roleArr] of typeMap) {
                if (SPECIAL_TYPES.has(type)) {
                    specialCount += roleArr.length;
                    continue; // skip adding here
                }
                roleArr.sort((a,b)=>a.name.localeCompare(b.name,'zh-Hans',{numeric:true,sensitivity:'base'}));
                const roleNodes: RoleNode[] = roleArr.map(r => ({ kind: 'role', key: r.name, role: r, affiliation: aff, roleType: type }));
                typeNodes.push({ kind: 'type', key: type, affiliation: aff, children: roleNodes });
            }
            if (typeNodes.length) {
                typeNodes.sort((a,b)=>a.key.localeCompare(b.key,'zh-Hans',{numeric:true,sensitivity:'base'}));
                affiliationNodes.push({ kind: 'affiliation', key: aff, children: typeNodes });
            }
        }
        affiliationNodes.sort((a,b)=>a.key.localeCompare(b.key,'zh-Hans',{numeric:true,sensitivity:'base'}));

        // Build special root (types only)
        const specialTypeMap = new Map<string, Role[]>();
        for (const r of roles) {
            if (SPECIAL_TYPES.has(r.type)) {
                if (!specialTypeMap.has(r.type)) { specialTypeMap.set(r.type, []); }
                specialTypeMap.get(r.type)!.push(r);
            }
        }
        const specialTypeNodes: SpecialTypeNode[] = [];
        for (const [type, arr] of specialTypeMap) {
            // group by affiliation inside each special type
            const map = new Map<string, Role[]>();
            for (const r of arr) {
                const aff = r.affiliation?.trim() || UNGROUPED;
                if (!map.has(aff)) { map.set(aff, []); }
                map.get(aff)!.push(r);
            }
            const affChildren: SpecialAffiliationNode[] = [];
            for (const [aff, rArr] of map) {
                rArr.sort((a,b)=>a.name.localeCompare(b.name,'zh-Hans',{numeric:true,sensitivity:'base'}));
                const roleNodes: RoleNode[] = rArr.map(r=>({ kind:'role', key:r.name, role:r, affiliation: aff, roleType: type }));
                affChildren.push({ kind:'specialAffiliation', key: aff, affiliation: aff, children: roleNodes, roleType: type });
            }
            affChildren.sort((a,b)=>a.key.localeCompare(b.key,'zh-Hans',{numeric:true,sensitivity:'base'}));
            specialTypeNodes.push({ kind:'specialType', key:type, roleType:type, children: affChildren });
        }
        specialTypeNodes.sort((a,b)=>a.key.localeCompare(b.key,'zh-Hans',{numeric:true,sensitivity:'base'}));
        const specialRoot: SpecialRootNode | undefined = specialTypeNodes.length ? { kind:'specialRoot', key:'__SPECIAL__', children: specialTypeNodes, count: specialCount } : undefined;
        const roots: AnyNode[] = specialRoot ? [...affiliationNodes, specialRoot] : affiliationNodes;

        // Assign stable unique ids (uid) to every node. Base id derives from structural info; duplicates get ::N suffix.
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
            if (prev === 0) {
                node.uid = b; // first occurrence keeps base id
            } else {
                node.uid = `${b}::${prev+1}`; // disambiguate duplicates deterministically
            }
            idCounts.set(b, prev + 1);
            // recurse
            if ((node as any).children) {
                for (const c of (node as any).children as AnyNode[]) {
                    c.parent = node;
                    walk(c);
                }
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
            const doc = await vscode.workspace.openTextDocument(role.sourcePath);
            const editor = await vscode.window.showTextDocument(doc, { preview: true });
            // naive definition search
            const text = doc.getText();
            let idx = text.indexOf(role.name);
            if (idx < 0) { idx = text.search(new RegExp(role.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))); }
            if (idx >=0) {
                const pos = doc.positionAt(idx);
                editor.selection = new vscode.Selection(pos, pos);
                editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
            }
        } catch {/* ignore */}
    }));
    // 订阅角色变化事件（静态导入）
    context.subscriptions.push(onDidChangeRoles(()=> provider.refresh()));
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
