import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import JSON5 from 'json5';

// 角色定义接口
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
	const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
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
	const cfg1 = vscode.workspace.getConfiguration('AndreaNovelHelper');
	const rolesFile1 = cfg1.get<string>('rolesFile')!;

	const fileTypes = cfg1.get<string[]>('supportedFileTypes', ['markdown', 'plaintext']);

	// 转换为 VS Code 的语言 ID
	const supportedLanguages = fileTypes.map(t => {
		// 特殊映射：txt → plaintext
		return t === 'txt' ? 'plaintext' : t;
	});

	const folders1 = vscode.workspace.workspaceFolders;
	if (folders1 && folders1.length) {
		const root = folders1[0].uri.fsPath;
		const fullPath = path.join(root, rolesFile1);
		// ——— 向导：如果角色库文件不存在，询问并初始化 ———
		const createWizard = async () => {
			const choice = await vscode.window.showInformationMessage(
				`角色库文件 "${rolesFile}" 不存在，是否初始化示例角色库？`,
				'创建',
				'取消'
			);
			if (choice === '创建') {
				// 示例角色
				const example = [
					{
						name: "示例角色",
						type: "配角",
						affiliation: "示例阵营",
						aliases: ["示例"],
						description: "这是一个示例角色，用于说明角色库格式。",
						color: "#FFA500"
					}
				];
				const content = JSON5.stringify(example, null, 2);
				// 自动创建目录（若需要）
				fs.mkdirSync(path.dirname(fullPath), { recursive: true });
				fs.writeFileSync(fullPath, content, 'utf8');
				vscode.window.showInformationMessage(`已创建示例角色库：${rolesFile}`);
			}
		};

		// 激活时调用一次
		if (!fs.existsSync(fullPath)) {
			createWizard().then(() => {
				// 向导完成后再加载和装饰
				loadRoles();
				updateDecorations();
			});
		}
	}


	loadRoles();
	// 配置变更监听
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (
				e.affectsConfiguration('AndreaNovelHelper.rolesFile') ||
				e.affectsConfiguration('AndreaNovelHelper.minChars') ||
				e.affectsConfiguration('AndreaNovelHelper.defaultColor')
			) {
				loadRoles();
				updateDecorations();
			}
		})
	);

	// —— 命令：从选中创建角色 —— 
	const addCmd = vscode.commands.registerCommand(
		'AndreaNovelHelper.addRoleFromSelection',
		async () => {

			// 确保角色库存在
			const cfg1 = vscode.workspace.getConfiguration('AndreaNovelHelper');
			const rolesFile = cfg1.get<string>('rolesFile')!;
			const root1 = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			if (!root1) return;
			const fullPath1 = path.join(root1, rolesFile);
			if (!fs.existsSync(fullPath1)) {
				await vscode.window.showInformationMessage(
					`角色库 "${rolesFile}" 不存在，先创建一个示例再继续…`
				);
				// 复用上面同样的示例创建逻辑
				const example = [
					{
						name: "示例角色",
						type: "配角",
						affiliation: "示例阵营",
						aliases: ["示例"],
						description: "这是一个示例角色，用于说明角色库格式。",
						color: "#FFA500"
					}
				];
				fs.mkdirSync(path.dirname(fullPath1), { recursive: true });
				fs.writeFileSync(fullPath1, JSON5.stringify(example, null, 2), 'utf8');
				vscode.window.showInformationMessage(`已初始化示例角色库：${rolesFile}`);
			}

			const editor = vscode.window.activeTextEditor;
			if (!editor) return;
			const sel = editor.selection;
			const name = editor.document.getText(sel).trim();
			if (!name) {
				vscode.window.showWarningMessage('请选择文本作为角色名称');
				return;
			}

			// 依次让用户填写 type / affiliation / description / color
			const type = await vscode.window.showQuickPick(
				['主角', '配角', '联动角色'],
				{ placeHolder: '选择角色类型' }
			);
			if (!type) { return; }

			const affiliation = await vscode.window.showInputBox({
				placeHolder: '输入从属标签（可选）'
			});

			const description = await vscode.window.showInputBox({
				placeHolder: '输入角色简介（可选）'
			});

			const color = await vscode.window.showInputBox({
				placeHolder: '输入十六进制颜色，如 #E60033（可选）',
				validateInput: v => {
					return v && !/^#([0-9A-Fa-f]{6})$/.test(v) ? '请输入合法的 #RRGGBB 形式' : null;
				}
			});

			// 找到并读入 rolesFile
			const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
			const file = cfg.get<string>('rolesFile')!;
			const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			if (!root) {
				vscode.window.showErrorMessage('未找到工作区根目录');
				return;
			}
			const fullPath = path.join(root, file);
			if (!fs.existsSync(fullPath)) {
				vscode.window.showErrorMessage(`角色库文件不存在: ${file}`);
				return;
			}
			const text = fs.readFileSync(fullPath, 'utf8');
			let arr: any[];
			try {
				arr = JSON5.parse(text) as any[];
			} catch (e) {
				vscode.window.showErrorMessage(`解析角色库失败: ${e}`);
				return;
			}

			// 新角色对象
			const newRole: any = { name, type };
			if (affiliation) newRole.affiliation = affiliation;
			if (description) newRole.description = description;
			if (color) newRole.color = color;

			// 把新角色 push 到数组末尾
			arr.push(newRole);

			// 写回文件，使用 JSON5.stringify 保留注释/尾逗号风格
			const out = JSON5.stringify(arr, null, 2);
			fs.writeFileSync(fullPath, out, 'utf8');

			vscode.window.showInformationMessage(`已添加角色 "${name}" 到 ${file}`);
			// 重新加载角色并刷新装饰
			loadRoles();
			updateDecorations();
		}
	);

	context.subscriptions.push(addCmd);

	// Completion provider
	const provider = vscode.languages.registerCompletionItemProvider(
		supportedLanguages,
		{
			provideCompletionItems(document, position) {
				const line = document.lineAt(position).text.slice(0, position.character);
				const prefix = getPrefix(line);
				if (!prefix) return;

				const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
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
		if (!active) return;
		const isSupported = supportedLanguages.includes(active.document.languageId);
		if (!isSupported) return;
		const docText = active.document.getText();

		// 1. 清理旧的装饰和 hoverRanges
		decorationTypes.forEach(d => d.dispose());
		decorationTypes.clear();
		hoverRanges = [];

		// 2. 取默认颜色
		const defaultColor = vscode.workspace
			.getConfiguration('AndreaNovelHelper')
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

		// 合并后的文档变化监听器
		vscode.workspace.onDidChangeTextDocument(e => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) return;

			// 检查文档是否匹配当前活动文档
			const isActiveDocument = e.document === editor.document;

			// 检查当前文档是否在支持的语言列表中
			const isSupported = supportedLanguages.includes(editor.document.languageId);

			// 只有当文档是当前活动文档且语言受支持时才更新装饰
			if (isActiveDocument && isSupported) {
				updateDecorations(editor);
			}
		})
	);

	// Hover provider 显示名称、简介、类型、从属、颜色
	const hoverProv = vscode.languages.registerHoverProvider(
		supportedLanguages,
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
					.getConfiguration('AndreaNovelHelper')
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
		supportedLanguages,
		{
			provideDefinition(document, position) {
				// 1. 先用 hoverRanges 定位到哪个角色
				const hit = hoverRanges.find(h => h.range.contains(position));
				if (!hit) return null;
				const role = hit.role;

				// 2. 找到角色库文件绝对路径
				const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
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


	// —— 1. 自动监听角色库文件变化 —— 
	//
	const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
	const rolesFile = cfg.get<string>('rolesFile')!;
	const folders = vscode.workspace.workspaceFolders;
	if (folders && folders.length) {
		const root = folders[0].uri.fsPath;
		// 相对工作区根、监控单个文件
		const watcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(root, rolesFile)
		);
		// 文件改动
		watcher.onDidChange(() => {
			loadRoles();
			updateDecorations();
			vscode.window.showInformationMessage('角色库已自动刷新');
		});
		// 文件被删除或新建也一并处理
		watcher.onDidCreate(() => {
			loadRoles();
			updateDecorations();
			vscode.window.showInformationMessage('角色库文件已创建，已刷新');
		});
		watcher.onDidDelete(() => {
			roles = [];
			updateDecorations();
			vscode.window.showWarningMessage('角色库文件已删除，已清空角色列表');
		});
		context.subscriptions.push(watcher);
	}

	//
	// —— 2. 手动刷新命令 —— 
	//
	const refreshCmd = vscode.commands.registerCommand(
		'AndreaNovelHelper.refreshRoles',
		() => {
			loadRoles();
			updateDecorations();
			vscode.window.showInformationMessage('手动刷新角色库完成');
		}
	);
	context.subscriptions.push(refreshCmd);

}



export function deactivate() {
	decorationTypes.forEach(d => d.dispose());
}
