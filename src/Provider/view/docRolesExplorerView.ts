import * as vscode from 'vscode';
import { buildRoleMarkdown } from '../hoverProvider';
import { Role } from '../../extension';
import { getDocumentRolesModel } from './docRolesModel';

// 复用与侧边栏 docRolesView 相同的分组逻辑，但单独一个 provider 绑定到资源管理器面板
type NodeKind = 'affiliation' | 'type' | 'role' | 'specialRoot' | 'specialType' | 'specialAffiliation';
interface Base { kind: NodeKind; key: string; }
interface AffiliationNode extends Base { kind: 'affiliation'; children: TypeNode[]; }
interface TypeNode extends Base { kind: 'type'; affiliation: string; children: RoleNode[]; }
interface RoleNode extends Base { kind: 'role'; role: Role; affiliation: string; roleType: string; }
interface SpecialRootNode extends Base { kind: 'specialRoot'; children: SpecialTypeNode[]; count: number; }
interface SpecialTypeNode extends Base { kind: 'specialType'; roleType: string; children: SpecialAffiliationNode[]; }
interface SpecialAffiliationNode extends Base { kind: 'specialAffiliation'; affiliation: string; children: RoleNode[]; roleType: string; }
export type AnyNode = AffiliationNode | TypeNode | RoleNode | SpecialRootNode | SpecialTypeNode | SpecialAffiliationNode;

class DocRoleExplorerItem extends vscode.TreeItem {
    constructor(public node: AnyNode) {
        super(DocRoleExplorerItem.label(node), DocRoleExplorerItem.state(node));
        this.id = DocRoleExplorerItem.idOf(node);
        if (node.kind === 'role') {
            this.tooltip = buildRoleMarkdown(node.role);
            this.command = {
                command: 'AndreaNovelHelper.openDocRoleDefinition',
                title: '打开角色定义',
                arguments: [node.role]
            };
            if (node.role.sourcePath) {
                this.resourceUri = vscode.Uri.file(node.role.sourcePath);
            }
        }
    }
    static label(n: AnyNode) { if (n.kind === 'role') { return n.role.name; } if (n.kind === 'specialRoot') { return '词汇 / 敏感词 / 正则表达式'; } return n.key; }
    static state(n: AnyNode) { return n.kind === 'role' ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed; }
    static idOf(n: AnyNode) {
        switch (n.kind) {
            case 'specialRoot': return 'explDocSpecialRoot';
            case 'specialType': return 'explDocSpecialType:' + n.key;
            case 'specialAffiliation': return 'explDocSpecialType:' + (n as any).roleType + '|aff:' + (n as any).affiliation;
            case 'affiliation': return 'explDocAff:' + n.key;
            case 'type': return 'explDocAff:' + (n as any).affiliation + '|type:' + n.key;
            case 'role': {
                const p = encodeURIComponent(n.role.sourcePath || '');
                const aff = encodeURIComponent(n.affiliation || '');
                const t = encodeURIComponent(n.roleType || '');
                const nm = encodeURIComponent(n.role.name);
                return 'explDocRole:' + p + ':' + aff + ':' + t + ':' + nm;
            }
        }
    }
}

class DocRolesExplorerProvider implements vscode.TreeDataProvider<AnyNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    refresh() { this._onDidChangeTreeData.fire(); }
    getTreeItem(e: AnyNode) { return new DocRoleExplorerItem(e); }
    getChildren(e?: AnyNode) {
        if (!e) { return this.build(); }
        if (e.kind === 'affiliation' || e.kind === 'type' || e.kind === 'specialType' || e.kind === 'specialAffiliation' || e.kind === 'specialRoot') { return (e as any).children || []; }
        return [];
    }
    private build(): AnyNode[] {
        const model = getDocumentRolesModel();
        const groups = model.getHierarchy();
        const SPECIAL_TYPES = new Set(['敏感词','词汇','正则表达式']);
        const affiliationNodes: AffiliationNode[] = [];
        const specialTypeMap = new Map<string, Map<string, Role[]>>();
        let specialCount = 0;
        for (const g of groups) {
            const typeNodes: TypeNode[] = [];
            for (const tg of g.types) {
                if (SPECIAL_TYPES.has(tg.type)) {
                    if (!specialTypeMap.has(tg.type)) { specialTypeMap.set(tg.type, new Map()); }
                    const affMap = specialTypeMap.get(tg.type)!;
                    if (!affMap.has(g.affiliation)) { affMap.set(g.affiliation, []); }
                    affMap.get(g.affiliation)!.push(...tg.roles);
                    specialCount += tg.roles.length;
                    continue;
                }
                const roleNodes: RoleNode[] = tg.roles.map(r=>({ kind:'role', key:r.name, role:r, affiliation:g.affiliation, roleType: tg.type }));
                typeNodes.push({ kind:'type', key: tg.type, affiliation: g.affiliation, children: roleNodes });
            }
            if (typeNodes.length) { affiliationNodes.push({ kind:'affiliation', key: g.affiliation, children: typeNodes }); }
        }
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
        const specialRoot: SpecialRootNode | undefined = specialTypeNodes.length ? { kind:'specialRoot', key:'__EXPL_DOC_SPECIAL__', children: specialTypeNodes, count: specialCount } : undefined;
        return specialRoot ? [...affiliationNodes, specialRoot] : affiliationNodes;
    }
}

export function registerDocRolesExplorerView(context: vscode.ExtensionContext) {
    const provider = new DocRolesExplorerProvider();
    const view = vscode.window.createTreeView('docRolesExplorerView', { treeDataProvider: provider, showCollapseAll: true });
    context.subscriptions.push(view);
    const EXPAND_KEY = 'docRolesExplorer.expanded';
    const expanded = new Set<string>(context.workspaceState.get<string[]>(EXPAND_KEY, []));
    const save = () => context.workspaceState.update(EXPAND_KEY, Array.from(expanded));
    view.onDidExpandElement(e => { const id = (e.element as any).id; if (id) { expanded.add(id); save(); } });
    view.onDidCollapseElement(e => { const id = (e.element as any).id; if (id) { expanded.delete(id); save(); } });
    const model = getDocumentRolesModel();
    context.subscriptions.push(model.onDidChange(()=> provider.refresh()));
}
