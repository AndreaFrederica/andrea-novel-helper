import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import JSON5 from 'json5';

//创建一个中⽂分词器
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });

// 角色定义接口
interface Role {
	/** 插入的主名称 */
	name: string;
	/** 可选别名数组 */
	aliases?: string[];
	/** 补全列表中显示的简介 */
	description?: string;
	/** 颜色十六进制，如 '#E60033' */
	color?: string;
}

// 全局角色列表
let roles: Role[] = [];


/**
 * 从工作区根目录加载 JSON5 字典文件，解析到 roles 数组
 */
function loadRoles() {
	roles = [];
	const config = vscode.workspace.getConfiguration('markdownRoleCompletion');
	const rolesFile = config.get<string>('rolesFile')!;
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		return;
	}
	const root = workspaceFolders[0].uri.fsPath;
	const filePath = path.join(root, rolesFile);
	if (!fs.existsSync(filePath)) {
		vscode.window.showWarningMessage(`角色库文件未找到: ${rolesFile}`);
		return;
	}
	try {
		const content = fs.readFileSync(filePath, 'utf8');
		const arr = JSON5.parse(content) as Role[];
		roles = arr.filter(r => !!r.name);
	} catch (err) {
		vscode.window.showErrorMessage(`解析角色库失败: ${err}`);
	}
}

/**
 * 用 Segmenter 拆分，取最后一个词作为前缀
 */
function getPrefix(text: string): string {
	let last = '';
	// segment() 返回 Iterable<Segment>，每项有 { segment, index, isWordLike }
	for (const { segment, isWordLike } of segmenter.segment(text)) {
		// 只关心「词语」而不是标点或空白
		if (isWordLike) {
			last = segment;
		}
	}
	return last;
}

/**
 * 激活函数
 */
export function activate(context: vscode.ExtensionContext) {
	// 首次加载角色库
	loadRoles();

	// 监听配置变更，重新加载
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (
				e.affectsConfiguration('markdownRoleCompletion.rolesFile') ||
				e.affectsConfiguration('markdownRoleCompletion.minChars')
			) {
				loadRoles();
			}
		})
	);

	// 注册 Markdown 语言的补全提供者
	const provider = vscode.languages.registerCompletionItemProvider(
		{ language: 'markdown' },
		{
			provideCompletionItems(document, position) {
				const line = document.lineAt(position).text.slice(0, position.character);
				const prefix = getPrefix(line);
				if (!prefix) {
					return;
				}
				// 最少输入字符数检查
				const minChars = vscode.workspace
					.getConfiguration('markdownRoleCompletion')
					.get<number>('minChars')!;
				if (prefix.length < minChars) {
					return;
				}
				const items: vscode.CompletionItem[] = [];
				for (const role of roles) {
					// 子串匹配：主名或任一别名中包含前缀
					const matchName = role.name.includes(prefix);
					const matchAlias = role.aliases?.some(a => a.includes(prefix));
					if (matchName || matchAlias) {
						const item = new vscode.CompletionItem(role.name, vscode.CompletionItemKind.Text);
						// 选中后替换掉前缀
						item.range = new vscode.Range(
							position.line,
							position.character - prefix.length,
							position.line,
							position.character
						);
						// 在补全框显示简介
						if (role.description) {
							item.detail = role.description;
						}
						// 在文档下拉框显示颜色预览
						if (role.color) {
							const md = new vscode.MarkdownString();
							md.appendMarkdown(`**颜色**: <span style=\"color:${role.color}\">■</span> \`${role.color}\``);
							md.isTrusted = true;
							item.documentation = md;
						}
						items.push(item);
					}
				}
				return items;
			}
		}
		// 不指定触发字符，用户可输入任意字符后 Ctrl+Space 调出
	);

	context.subscriptions.push(provider);
}

export function deactivate() { }
