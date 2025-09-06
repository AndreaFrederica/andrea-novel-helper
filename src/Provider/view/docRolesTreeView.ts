import * as vscode from 'vscode';
import { buildRoleMarkdown } from '../hoverProvider';
import { Role } from '../../extension';
import { getDocumentRolesModel } from './docRolesModel';

type NodeKind = 'affiliation' | 'type' | 'role' | 'specialRoot' | 'specialType' | 'specialAffiliation';
interface Base { kind: NodeKind; key: string; }
interface AffiliationNode extends Base { 
	kind: 'affiliation'; 
	children: (TypeNode | RoleNode)[]; // 支持直接包含角色或类型节点
}
interface TypeNode extends Base { kind: 'type'; affiliation: string; children: RoleNode[]; }
interface RoleNode extends Base { kind: 'role'; role: Role; affiliation: string; roleType: string; }
interface SpecialRootNode extends Base { kind: 'specialRoot'; children: SpecialTypeNode[]; count: number; }
interface SpecialTypeNode extends Base { kind: 'specialType'; roleType: string; children: SpecialAffiliationNode[]; }
interface SpecialAffiliationNode extends Base { kind: 'specialAffiliation'; affiliation: string; children: RoleNode[]; roleType: string; }
export type AnyNode = AffiliationNode | TypeNode | RoleNode | SpecialRootNode | SpecialTypeNode | SpecialAffiliationNode;

class DocRoleTreeItem extends vscode.TreeItem {
	constructor(public node: AnyNode) {
		super(DocRoleTreeItem.label(node), DocRoleTreeItem.state(node));
		this.id = DocRoleTreeItem.idOf(node);
		if (node.kind === 'role') {
			this.tooltip = buildRoleMarkdown(node.role);
			this.command = {
				command: 'AndreaNovelHelper.openDocRoleDefinition',
				title: '打开角色定义',
				arguments: [node.role]
			};
		}
	}
	static label(n: AnyNode) {
		if (n.kind === 'role') { return n.role.name; }
		if (n.kind === 'specialRoot') { return '词汇 / 敏感词 / 正则表达式'; }
		return n.key;
	}
	static state(n: AnyNode) { return n.kind === 'role' ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed; }
	static idOf(n: AnyNode) {
		switch (n.kind) {
			case 'specialRoot': return 'docSpecialRoot';
			case 'specialType': return 'docSpecialType:' + n.key;
			case 'specialAffiliation': return 'docSpecialType:' + (n as any).roleType + '|aff:' + (n as any).affiliation;
			case 'affiliation': return 'docAff:' + n.key;
			case 'type': return 'docAff:' + (n as any).affiliation + '|type:' + n.key;
			case 'role': {
				const p = encodeURIComponent((n as RoleNode).role.sourcePath || '');
				const aff = encodeURIComponent((n as RoleNode).affiliation || '');
				const t = encodeURIComponent((n as RoleNode).roleType || '');
				const nm = encodeURIComponent((n as RoleNode).role.name);
				return 'docRole:' + p + ':' + aff + ':' + t + ':' + nm;
			}
		}
	}
}

class DocRolesProvider implements vscode.TreeDataProvider<AnyNode> {
	private _onDidChangeTreeData = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
	refresh() { this._onDidChangeTreeData.fire(); }
	getTreeItem(e: AnyNode) { return new DocRoleTreeItem(e); }
	getChildren(e?: AnyNode) {
		if (!e) { return this.build(); }
		if (e.kind === 'affiliation' || e.kind === 'type' || e.kind === 'specialType' || e.kind === 'specialAffiliation' || e.kind === 'specialRoot') { return (e as any).children || []; }
		return [];
	}
	private build(): AnyNode[] {
		const model = getDocumentRolesModel();
		const groups = model.getHierarchy();
		
		// 检查是否启用了自定义分组
		const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
		const useCustomGroups = cfg.get<boolean>('docRoles.useCustomGroups', false);
		
		if (useCustomGroups) {
			// 使用自定义分组时，直接使用 model 返回的分组结构
			const affiliationNodes: AffiliationNode[] = [];
			for (const g of groups) {
				const children: (TypeNode | RoleNode)[] = [];
				
				for (const tg of g.types) {
					if (tg.type === '__FLAT__') {
						// 对于扁平标记，直接将角色添加到归属节点下
						const roleNodes: RoleNode[] = tg.roles.map(r=>({ 
							kind:'role', 
							key:r.name, 
							role:r, 
							affiliation:g.affiliation, 
							roleType: tg.type 
						}));
						children.push(...roleNodes);
					} else {
						// 正常的类型分组
						const roleNodes: RoleNode[] = tg.roles.map(r=>({ 
							kind:'role', 
							key:r.name, 
							role:r, 
							affiliation:g.affiliation, 
							roleType: tg.type 
						}));
						
						children.push({ 
							kind:'type', 
							key: tg.type, 
							affiliation: g.affiliation, 
							children: roleNodes 
						});
					}
				}
				
				if (children.length) {
					affiliationNodes.push({ 
						kind:'affiliation', 
						key: g.affiliation, 
						children: children 
					});
				}
			}
			return affiliationNodes;
		}
		
		// 使用标准分组时，保持原有的特殊类型处理逻辑
		const SPECIAL_TYPES = new Set(['敏感词','词汇','正则表达式']);
		const affiliationNodes: AffiliationNode[] = [];
		const specialTypeMap = new Map<string, Map<string, Role[]>>(); // type -> affiliation -> roles
		let specialCount = 0;
		for (const g of groups) {
			// 支持在标准分组下也内联 __FLAT__ 角色
			const children: (TypeNode | RoleNode)[] = [];
			for (const tg of g.types) {
				if (tg.type === '__FLAT__') {
					const roleNodes: RoleNode[] = tg.roles.map(r=>({ kind:'role', key:r.name, role:r, affiliation:g.affiliation, roleType: tg.type }));
					children.push(...roleNodes);
					continue;
				}
				if (SPECIAL_TYPES.has(tg.type)) {
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
			if (children.length) {
				affiliationNodes.push({ kind:'affiliation', key: g.affiliation, children });
			}
		}
		// build special root
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
		const specialRoot: SpecialRootNode | undefined = specialTypeNodes.length ? { kind:'specialRoot', key:'__DOC_SPECIAL__', children: specialTypeNodes, count: specialCount } : undefined;
		return specialRoot ? [...affiliationNodes, specialRoot] : affiliationNodes;
	}
}

export function registerDocRolesTreeView(context: vscode.ExtensionContext) {
	const provider = new DocRolesProvider();
	const view = vscode.window.createTreeView('docRolesView', { treeDataProvider: provider, showCollapseAll: true });
	context.subscriptions.push(view);
	const EXPAND_KEY = 'docRolesView.expanded';
	const expanded = new Set<string>(context.workspaceState.get<string[]>(EXPAND_KEY, []));
	const save = () => context.workspaceState.update(EXPAND_KEY, Array.from(expanded));
	view.onDidExpandElement(e => { const id = (e.element as any).id; if (id) { expanded.add(id); save(); } });
	view.onDidCollapseElement(e => { const id = (e.element as any).id; if (id) { expanded.delete(id); save(); } });
	// 使用共享模型统一事件，监听模型变化
	const model = getDocumentRolesModel();
	context.subscriptions.push(model.onDidChange(()=> provider.refresh()));
	context.subscriptions.push(vscode.commands.registerCommand('AndreaNovelHelper.openDocRoleDefinition', async (role: Role) => {
		if (!role.sourcePath) { return; }
		// If the role comes from a .json5 file, optionally open it with the role manager editor
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
						console.warn('[DocRolesTreeView] andrea.roleJson5Editor.def failed', e);
					}
				}
			}
			const doc = await vscode.workspace.openTextDocument(role.sourcePath);
			const editor = await vscode.window.showTextDocument(doc, { preview: true });
			const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
			const hugeTh = cfg.get<number>('hugeFile.thresholdBytes', 50*1024)!;
			let txt = '';
			if (doc.getText().length * 1.8 > hugeTh) {
				console.warn('[DocRolesTreeView] skip huge file full search', doc.uri.fsPath);
				// 仅取前 8KB 做一次定位尝试
				const slice = doc.getText().slice(0, 8*1024);
				txt = slice;
			} else {
				txt = doc.getText();
			}
			let idx = txt.indexOf(role.name);
			if (idx < 0) { idx = txt.search(new RegExp(role.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))); }
			if (idx >= 0) {
				const pos = doc.positionAt(idx);
				editor.selection = new vscode.Selection(pos, pos);
				editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
			}
		} catch { /* ignore */ }
	}));
}
