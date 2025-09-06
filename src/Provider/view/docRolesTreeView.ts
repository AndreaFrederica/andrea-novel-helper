import * as vscode from 'vscode';
import * as path from 'path';
import { buildRoleMarkdown } from '../hoverProvider';
import { labelForRoleKey } from '../../utils/i18n';
import { iconForRoleKey } from '../../utils/roleKeyIcons';
import { Role } from '../../extension';
import { getDocumentRolesModel } from './docRolesModel';

type NodeKind = 'affiliation' | 'type' | 'role' | 'detail' | 'detailLine' | 'specialRoot' | 'specialType' | 'specialAffiliation';
interface Base { kind: NodeKind; key: string; }
interface AffiliationNode extends Base { 
	kind: 'affiliation'; 
	children: (TypeNode | RoleNode)[]; // 支持直接包含角色或类型节点
}
interface TypeNode extends Base { kind: 'type'; affiliation: string; children: RoleNode[]; }
interface RoleNode extends Base { kind: 'role'; role: Role; affiliation: string; roleType: string; }
interface DetailNode extends Base { kind: 'detail'; value: string; roleName: string; full?: string; }
interface DetailLineNode extends Base { kind: 'detailLine'; value: string; roleName: string; }
interface SpecialRootNode extends Base { kind: 'specialRoot'; children: SpecialTypeNode[]; count: number; }
interface SpecialTypeNode extends Base { kind: 'specialType'; roleType: string; children: SpecialAffiliationNode[]; }
interface SpecialAffiliationNode extends Base { kind: 'specialAffiliation'; affiliation: string; children: RoleNode[]; roleType: string; }
export type AnyNode = AffiliationNode | TypeNode | RoleNode | DetailNode | DetailLineNode | SpecialRootNode | SpecialTypeNode | SpecialAffiliationNode;

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
			// 如果配置允许并且角色提供了 svg 字段，则优先使用该 svg 作为图标
			try {
				const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
				// docRoles 视图读取 docRoles 范畴的设置
				const useSvg = cfg.get<boolean>('docRoles.display.useRoleSvgIfPresent', false);
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
				const colorize = cfg.get<boolean>('docRoles.display.colorizeRoleName', false);
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
				// 仅当尚未设置自定义图标（如 svg）时，才回退为文件类图标，避免覆盖 svg
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
			// 只显示 key；值在展开后的 detailLine 显示
			const dn = node as DetailNode;
			this.tooltip = dn.full && dn.full.length > (dn.value?.length || 0) ? dn.full : dn.full;
			// 在 key 行应用内置图标映射
			this.iconPath = iconForRoleKey(`role.key.${dn.key}`);
			this.description = undefined;
			// detail 键图标（ThemeIcon），从映射表获取
			try { this.iconPath = iconForRoleKey(dn.key); } catch {}
		} else if (node.kind === 'detailLine') {
			this.label = node.value;
			// 若父字段是颜色并且设置允许，则在 value（即 detailLine）上显示色块图标
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
		}
	}
	static label(n: AnyNode) {
		if (n.kind === 'role') { return n.role.name; }
		if (n.kind === 'detail') { return labelForRoleKey(n.key); }
		if (n.kind === 'specialRoot') { return '词汇 / 敏感词 / 正则表达式'; }
		return n.key;
	}
	static state(n: AnyNode) { 
		if (n.kind === 'role') {
			const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
			const enableRoleExpansion = cfg.get<boolean>('roles.details.enableRoleExpansion', true);
			return enableRoleExpansion ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
		}
		if (n.kind === 'detail') {
			const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
			const always = cfg.get<boolean>('roles.details.alwaysExpandable', true);
			if (always) { return vscode.TreeItemCollapsibleState.Collapsed; }
			const wrapCol = Math.max(5, Math.min(200, cfg.get<number>('roles.details.wrapColumn', 20) || 20));
			const dn = n as DetailNode;
			const needsExpand = !!dn.full && (dn.full.includes('\n') || dn.full.length > wrapCol);
			return needsExpand ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
		}
		if (n.kind === 'detailLine') { return vscode.TreeItemCollapsibleState.None; }
		return vscode.TreeItemCollapsibleState.Collapsed; 
	}
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
			case 'detail': {
				const dn = n as DetailNode;
				return 'docRoleDetail:' + encodeURIComponent(dn.roleName) + ':' + encodeURIComponent(dn.key);
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
		if (e.kind === 'role') { return this.buildRoleDetails(e as RoleNode); }
		if (e.kind === 'detail') { return this.buildDetailLines(e as DetailNode); }
		return [];
	}
	private buildRoleDetails(rn: RoleNode): DetailNode[] {
		const r: any = rn.role as any;
		const entries: [string, any][] = Object.entries(r || {});
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
			const limit = 120; const short = full.length > limit ? full.slice(0, limit) + '…' : full; return { short, full };
		};
		return entries.map(([k, v]) => { const { short, full } = toStr(v); return { kind:'detail', key:k, value:short, full, roleName: rn.role.name } as DetailNode; });
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
			while (i < s.length) { lines.push(s.slice(i, i + width)); i += width; }
		};
		if (full.includes('\n')) { for (const part of full.split(/\r?\n/)) { pushWrapped(part); } } else { pushWrapped(full); }
		// attach parent key so TreeItem can know field name when rendering
		return lines.map((val, idx) => ({ kind:'detailLine', key: idx === 0 ? '…' : '  ', value: val, roleName: dn.roleName, parentKey: dn.key } as DetailLineNode & { parentKey?: string }));
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
						// 扁平：仍然在 role 节点上保留真实的类型，便于显示/唯一键
						const roleNodes: RoleNode[] = tg.roles.map(r=>({ 
							kind:'role', 
							key:r.name, 
							role:r, 
							affiliation:g.affiliation, 
							roleType: (r.type || 'unknown') 
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
