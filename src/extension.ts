import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import JSON5 from 'json5';

// 角色定义接口，新增类型(type)与从属标签(affiliation)
interface Role {
	/** 插入的主名称 */
	name: string;
	/** 角色类型：主角、配角、联动角色 */
	type: '主角' | '配角' | '联动角色';
	/** 从属标签，如所属阵营、组织等 */
	affiliation?: string;
	/** 可选别名数组 */
	aliases?: string[];
	/** 补全列表中显示的简介 */
	description?: string;
	/** 颜色十六进制，如 '#E60033'，优先级高于类型默认色 */
	color?: string;
}

// 全局角色列表
let roles: Role[] = [];
// 存储当前文档中每个角色出现的范围和对应角色
let hoverRanges: { range: vscode.Range; role: Role }[] = [];
// editor 装饰类型存储
let decorationTypes: Map<string, vscode.TextEditorDecorationType> = new Map();
// 中文分词器(词级别)
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });

// 类型到默认颜色映射
const typeColorMap: Record<string, string> = {
	主角: '#FFD700',       // 金色
	配角: '#ADD8E6',       // 淡蓝
	'联动角色': '#90EE90'  // 淡绿
};

/**
 * 加载角色库 JSON5，支持注释与尾逗号
 */
function loadRoles() {
	roles = [];
	const cfg = vscode.workspace.getConfiguration('markdownRoleCompletion');
	const file = cfg.get<string>('rolesFile')!;
	const folders = vscode.workspace.workspaceFolders;
	if (!folders || !folders.length) return;
	const root = folders[0].uri.fsPath;
	const full = path.join(root, file);
	if (!fs.existsSync(full)) {
		vscode.window.showWarningMessage(`角色库未找到: ${file}`);
		return;
	}
	try {
		const text = fs.readFileSync(full, 'utf8');
		roles = JSON5.parse(text) as Role[];
	} catch (e) {
		vscode.window.showErrorMessage(`解析角色库失败: ${e}`);
	}
}

/**
 * 用 Intl.Segmenter 拆分成词，取最后一个词作为补全前缀
 */
function getPrefix(line: string): string {
	let last = '';
	for (const { segment, isWordLike } of segmenter.segment(line)) {
		if (isWordLike) last = segment;
	}
	return last;
}

export function activate(context: vscode.ExtensionContext) {
	loadRoles();
	// 配置变更监听
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (
				e.affectsConfiguration('markdownRoleCompletion.rolesFile') ||
				e.affectsConfiguration('markdownRoleCompletion.minChars') ||
				e.affectsConfiguration('markdownRoleCompletion.defaultColor')
			) {
				loadRoles();
				updateDecorations();
			}
		})
	);

	// Completion provider
	const provider = vscode.languages.registerCompletionItemProvider(
		{ language: 'markdown' },
		{
			provideCompletionItems(document, position) {
				const line = document.lineAt(position).text.slice(0, position.character);
				const prefix = getPrefix(line);
				if (!prefix) return;

				const cfg = vscode.workspace.getConfiguration('markdownRoleCompletion');
				const min = cfg.get<number>('minChars')!;
				if (prefix.length < min) return;

				// 准备默认色（如果你在 detail/doc 中需要用到）
				const defaultColor = cfg.get<string>('defaultColor')!;

				const items: vscode.CompletionItem[] = [];

				for (const role of roles) {
					// 汇总主名称 + 别名
					const allNames = new Set<string>([role.name, ...(role.aliases ?? [])]);

					for (const nameItem of allNames) {
						if (!nameItem.includes(prefix)) continue;

						const item = new vscode.CompletionItem(nameItem, vscode.CompletionItemKind.Text);
						// 直接插入 nameItem 自身
						item.insertText = nameItem;
						// 替换正确范围
						item.range = new vscode.Range(
							position.line,
							position.character - prefix.length,
							position.line,
							position.character
						);

						// detail：简介 | 类型 | 从属
						const details: string[] = [];
						if (role.description) details.push(role.description);
						details.push(`类型: ${role.type}`);
						if (role.affiliation) details.push(`从属: ${role.affiliation}`);
						item.detail = details.join(' | ');

						// documentation：颜色方块 + 类型 + 从属
						const md = new vscode.MarkdownString();
						const color = role.color || typeColorMap[role.type] || defaultColor;
						md.appendMarkdown(`**颜色**: <span style="color:${color}">■</span> \`${color}\``);
						md.appendMarkdown(`\n\n**类型**: ${role.type}`);
						if (role.affiliation) md.appendMarkdown(`\n\n**从属**: ${role.affiliation}`);
						md.isTrusted = true;
						item.documentation = md;

						// 排序：前缀开头优先
						if (nameItem.startsWith(prefix)) {
							item.sortText = '1_' + nameItem;
						} else {
							item.sortText = '2_' + nameItem;
						}

						items.push(item);
					}
				}

				return items;
			}
		}
	);



	function updateDecorations(editor?: vscode.TextEditor) {
		const active = editor || vscode.window.activeTextEditor;
		if (!active || active.document.languageId !== 'markdown') return;
		const docText = active.document.getText();

		// 1. 清理旧的装饰和 hoverRanges
		decorationTypes.forEach(d => d.dispose());
		decorationTypes.clear();
		hoverRanges = [];

		// 2. 取默认颜色
		const defaultColor = vscode.workspace
			.getConfiguration('markdownRoleCompletion')
			.get<string>('defaultColor')!;

		for (const r of roles) {
			const color = r.color || typeColorMap[r.type] || defaultColor;
			const deco = vscode.window.createTextEditorDecorationType({ color });
			const ranges: vscode.Range[] = [];

			// --- 匹配主名称 ---
			{
				const regex = new RegExp(r.name, 'g');
				let m: RegExpExecArray | null;
				while ((m = regex.exec(docText))) {
					const start = active.document.positionAt(m.index);
					const end = active.document.positionAt(m.index + m[0].length);
					const range = new vscode.Range(start, end);
					ranges.push(range);
					hoverRanges.push({ range, role: r });
				}
			}

			// --- 匹配所有别名 ---
			if (r.aliases) {
				for (const alias of r.aliases) {
					const regex = new RegExp(alias, 'g');
					let m: RegExpExecArray | null;
					while ((m = regex.exec(docText))) {
						const start = active.document.positionAt(m.index);
						const end = active.document.positionAt(m.index + m[0].length);
						const range = new vscode.Range(start, end);
						ranges.push(range);
						hoverRanges.push({ range, role: r });
					}
				}
			}

			// 应用装饰到主名称+别名所有位置
			active.setDecorations(deco, ranges);
			decorationTypes.set(r.name, deco);
		}
	}
	// 初始 & 监听
	updateDecorations();
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(updateDecorations),
		vscode.workspace.onDidChangeTextDocument(e => {
			if (vscode.window.activeTextEditor && e.document === vscode.window.activeTextEditor.document) {
				updateDecorations(vscode.window.activeTextEditor);
			}
		})
	);

	// Hover provider 显示名称、简介、类型、从属、颜色
	const hoverProv = vscode.languages.registerHoverProvider(
		{ language: 'markdown' },
		{
			provideHover(doc, pos) {
				const hit = hoverRanges.find(h => h.range.contains(pos));
				if (!hit) return;
				const r = hit.role;
				const md = new vscode.MarkdownString();
				md.appendMarkdown(`**${r.name}**`);
				if (r.description) md.appendMarkdown(`\n\n${r.description}`);
				md.appendMarkdown(`\n\n**类型**: ${r.type}`);
				if (r.affiliation) md.appendMarkdown(`\n\n**从属**: ${r.affiliation}`);
				const defaultColor = vscode.workspace
					.getConfiguration('markdownRoleCompletion')
					.get<string>('defaultColor')!;
				const c = r.color || typeColorMap[r.type] || defaultColor;
				md.appendMarkdown(`\n\n**颜色**: <span style="color:${c}">■</span> \`${c}\``);
				md.isTrusted = true;
				// 注意这里用 hit.range 保证 hover 范围和装饰一致
				return new vscode.Hover(md, hit.range);
			}
		}
	);
	context.subscriptions.push(hoverProv);

	// “转到定义”提供器：Ctrl+Click 或 F12
	const defProv = vscode.languages.registerDefinitionProvider(
		{ language: 'markdown' },
		{
			provideDefinition(document, position) {
				// 1. 先用 hoverRanges 定位到哪个角色
				const hit = hoverRanges.find(h => h.range.contains(position));
				if (!hit) return null;
				const role = hit.role;

				// 2. 找到角色库文件绝对路径
				const cfg = vscode.workspace.getConfiguration('markdownRoleCompletion');
				const file = cfg.get<string>('rolesFile')!;
				const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
				if (!root) return null;
				const fullPath = path.join(root, file);
				if (!fs.existsSync(fullPath)) return null;

				// 3. 读取文件，按行查找 name 字段
				const content = fs.readFileSync(fullPath, 'utf8');
				const lines = content.split(/\r?\n/);
				const idx = lines.findIndex(line =>
					// 匹配 JSON5 中 name: "xxx"
					new RegExp(`\\bname\\s*:\\s*["']${role.name}["']`).test(line)
				);
				if (idx < 0) return null;

				// 4. 构造跳转目标位置
				const char = lines[idx].indexOf(role.name);
				const targetUri = vscode.Uri.file(fullPath);
				const targetPos = new vscode.Position(idx, char);
				return new vscode.Location(targetUri, targetPos);
			}
		}
	);
	context.subscriptions.push(defProv);


}



export function deactivate() {
	decorationTypes.forEach(d => d.dispose());
}
