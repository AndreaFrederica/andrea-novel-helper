import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as chardet from 'jschardet';
import * as iconv from 'iconv-lite';
import JSON5 from 'json5';

/* eslint-disable curly */
import { Role, segmenter } from "../extension";
import { _onDidChangeRoles, cleanRoles, roles } from '../activate';
import { globalFileCache } from './fileCache';
import { parseMarkdownRoles } from './markdownParser';
import { generateCSpellDictionary } from './generateCSpellDictionary';

export interface TextStats {
	cjkChars: number;  // 中文字符
	asciiChars: number;  // ASCII 字符（非 CJK 且 <128）
	words: number;  // 英文单词数
	nonWSChars: number;  // 非空白字符总数
	total: number;  // 总“字数”=cjk+words（或你自己定义）
}

/**
 * 用 Intl.Segmenter 拆分成词，取最后一个词作为补全前缀
 */
export function getPrefix(line: string): string {
	let last = '';
	for (const { segment, isWordLike } of segmenter.segment(line)) {
		if (isWordLike) last = segment;
	}
	return last;
}

// 类型到默认颜色映射
export const typeColorMap: Record<string, string> = {
	主角: '#FFD700',       // 金色
	配角: '#ADD8E6',       // 淡蓝
	'联动角色': '#90EE90'  // 淡绿
};

/**
 * 从用户设置中获取支持的语言 ID 列表
 * @returns 支持的 VS Code 语言 ID 数组
 */
export const getSupportedLanguages = (): string[] => {
	const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
	const fileTypes = cfg.get<string[]>('supportedFileTypes', ['markdown', 'plaintext'])!;
	return fileTypes.map((t: string): string =>
		t === 'txt' ? 'plaintext' : t
	);
};

/**
 * 语言 ID → 文件扩展名 的映射表
 */
const langToExt: Record<string, string> = {
	markdown: 'md',
	plaintext: 'txt',
	javascript: 'js',
	typescript: 'ts',
	// ……后缀名和语言id不一样的放在这里
};

/**
 * 从用户设置中获取支持的文件扩展名列表
 * @returns 不含 “.” 的小写扩展名数组，例如 ['md','txt']
 */
export const getSupportedExtensions = (): string[] => {
	const langs = getSupportedLanguages();
	// 如果映射表里没有就原样返回 lang
	return langs
		.map(lang => langToExt[lang] ?? lang)
		.filter((ext): ext is string => !!ext);
};

// 分词函数：处理罗马字、英文、拼音等混合格式
export function tokenizeComplexNames(name: string): string[] {
	const tokens: string[] = [];

	// 1. 处理常见的复合词分隔符（连字符、下划线、空格）
	const separatorRegex = /[-_\s]+/;
	if (separatorRegex.test(name)) {
		tokens.push(...name.split(separatorRegex));
	}

	// 2. 处理驼峰命名法（camelCase 或 PascalCase）
	const camelCaseParts = name.split(/(?=[A-Z][a-z]|[\d])/);
	if (camelCaseParts.length > 1) {
		tokens.push(...camelCaseParts);
	}

	// 3. 处理拼音（带声调和不带声调）
	const pinyinRegex = /[a-z]+[1-5]?/g;
	const pinyinMatches = name.match(pinyinRegex);
	if (pinyinMatches && pinyinMatches.join('') === name.toLowerCase()) {
		tokens.push(...pinyinMatches);
	}

	// 4. 处理罗马字（日语）
	const romajiRegex = /[a-z]+/g;
	const romajiMatches = name.match(romajiRegex);
	if (romajiMatches && romajiMatches.join('') === name.toLowerCase()) {
		tokens.push(...romajiMatches);
	}

	// 5. 处理数字+字母组合（如 R2D2, GPT4）
	const alphanumericRegex = /([a-z]+|\d+)/gi;
	const alphanumericMatches = name.match(alphanumericRegex);
	if (alphanumericMatches && alphanumericMatches.length > 1) {
		tokens.push(...alphanumericMatches);
	}

	// 返回去重的有效token（长度至少为2）
	return [...new Set(tokens.filter(token => token.length > 1))];
}

// 工具：检查两个区间 [s1,e1) 和 [s2,e2) 是否有重叠
export function rangesOverlap(
	s1: number, e1: number,
	s2: number, e2: number
): boolean {
	return s1 < e2 && s2 < e1;
}

// 工具：转义正则特殊字符
export function escapeRegExp(str: string): string {
	return str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

/**
 * 读取一个文本文件，并根据内容自动检测并按正确编码解码
 * @param filePath 文件完整路径
 * @returns 文本内容
 */
export async function readTextFileDetectEncoding(filePath: string): Promise<string> {
	// 1. 读成 Buffer（不做 utf8 强制）
	const buffer = await fs.promises.readFile(filePath);

	// 2. 检测最可能的编码
	const detect = chardet.detect(buffer);
	// jschardet 返回类似 { encoding: 'GB18030', confidence: 0.99 }
	const encoding = (detect && detect.encoding)
		? detect.encoding
		: 'utf-8';

	// 3. 用 iconv-lite 解码
	//    确保 iconv-lite 已经支持了那个编码（常见：GBK/GB18030/ISO-8859-1/UTF-8）
	const text = iconv.decode(buffer, encoding);

	return text;
}

/**
 * 统计文本中的“中文字符（CJK）”+“英文单词”数量
 * @param text 任意中英混排文本
 * @returns 中文字符数 + 英文单词数
 */
export function countWordsMixed(text: string): number {
	// 1) 中文字符（CJK）：使用 Unicode 脚本属性，匹配所有汉字
	//    需要 Node >=12 开启 Unicode 属性转义
	const cjkMatches = text.match(/[\p{Script=Han}]/gu) || [];

	// 2) 英文单词：字母/数字/下划线序列，按单词边界切分
	const enMatches = text.match(/\b[A-Za-z0-9_]+\b/g) || [];

	return cjkMatches.length + enMatches.length;
}

export function analyzeText(text: string): TextStats {
	// 中文字符
	const cjkMatch = text.match(/[\p{Script=Han}]/gu) || [];
	// 英文单词
	const wordMatch = text.match(/\b[A-Za-z0-9_]+\b/g) || [];
	// 非空白字符
	const nonWS = text.match(/\S/gu) || [];
	// ASCII （排除 CJK）
	const ascii = text.match(/[\x00-\x7F]/g) || [];

	const cjkChars = cjkMatch.length;
	const words = wordMatch.length;
	const nonWSChars = nonWS.length;
	const asciiChars = ascii.filter(ch => !/[\p{Script=Han}]/u.test(ch)).length;
	const total = cjkChars + words;  // 或用非空白：nonWSChars

	return { cjkChars, asciiChars, words, nonWSChars, total };
}

export async function countAndAnalyze(fullPath: string): Promise<TextStats> {
	const text = await readTextFileDetectEncoding(fullPath);
	return analyzeText(text);
}


/**
 * 把两个 TextStats 累加
 */
export function mergeStats(a: TextStats, b: TextStats): TextStats {
	return {
		cjkChars: a.cjkChars + b.cjkChars,
		asciiChars: a.asciiChars + b.asciiChars,
		words: a.words + b.words,
		nonWSChars: a.nonWSChars + b.nonWSChars,
		total: a.total + b.total
	};
}



/**
 * 包管理器方式加载角色库：递归扫描 novel-helper 目录下的所有包
 * @param forceRefresh 是否强制刷新所有文件（不使用缓存）
 * @param changedFiles 指定只更新这些文件（用于增量更新）
 */
export function loadRoles(forceRefresh: boolean = false, changedFiles?: string[]) {
	const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
	const folders = vscode.workspace.workspaceFolders;
	if (!folders || !folders.length) {
		console.error('loadRoles: 未找到工作区文件夹');
		return;
	}
	const root = folders[0].uri.fsPath;
	const novelHelperRoot = path.join(root, 'novel-helper');
	
	console.log(`loadRoles: workspace root = ${root}`);
	console.log(`loadRoles: novel-helper root = ${novelHelperRoot}`);

	// 如果强制刷新，清空缓存
	if (forceRefresh) {
		globalFileCache.clear();
		cleanRoles();
	}

	// 检查 novel-helper 目录是否存在
	if (!fs.existsSync(novelHelperRoot)) {
		console.warn(`loadRoles: novel-helper 目录不存在: ${novelHelperRoot}`);
		// 仍然尝试加载传统方式的文件（向后兼容）
		loadTraditionalRoles(forceRefresh, changedFiles);
		return;
	}

	// 如果指定了变化文件列表，进行增量更新
	if (changedFiles && changedFiles.length > 0) {
		console.log(`loadRoles: 增量更新 ${changedFiles.length} 个文件`);
		performIncrementalUpdate(changedFiles, novelHelperRoot);
	} else {
		// 完整扫描
		if (!forceRefresh) {
			cleanRoles(); // 只有非强制刷新时才清理角色列表
		}
		
		try {
			scanPackageDirectory(novelHelperRoot, '');
			console.log(`loadRoles: 成功加载 ${roles.length} 个角色`);
		} catch (error) {
			console.error(`loadRoles: 扫描包目录时出错: ${error}`);
			vscode.window.showErrorMessage(`加载角色库时出错: ${error}`);
		}
	}

	_onDidChangeRoles.fire();
	generateCSpellDictionary();
}

/**
 * 递归扫描包目录，加载所有角色文件
 * @param currentDir 当前扫描的目录绝对路径
 * @param relativePath 相对于 novel-helper 的路径
 */
function scanPackageDirectory(currentDir: string, relativePath: string) {
	if (!fs.existsSync(currentDir)) {
		return;
	}

	const entries = fs.readdirSync(currentDir, { withFileTypes: true });

	for (const entry of entries) {
		const entryPath = path.join(currentDir, entry.name);
		const entryRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name;

		if (entry.isDirectory()) {
			// 跳过 outline 目录
			if (entry.name === 'outline') {
				continue;
			}
			// 递归扫描子目录
			scanPackageDirectory(entryPath, entryRelativePath);
		} else if (entry.isFile()) {
			// 检查是否是角色文件
			if (isRoleFile(entry.name)) {
				loadRoleFile(entryPath, relativePath, entry.name);
			}
		}
	}
}

/**
 * 判断文件是否是角色文件
 */
function isRoleFile(fileName: string): boolean {
	const lowerName = fileName.toLowerCase();
	const validExtensions = ['.json5', '.txt', '.md'];
	const hasValidExtension = validExtensions.some(ext => lowerName.endsWith(ext));
	
	if (!hasValidExtension) {
		return false;
	}

	// 检查文件名是否包含角色相关关键词
	const roleKeywords = [
		'character-gallery', 'character', 'role', 'roles',
		'sensitive-words', 'sensitive', 'vocabulary', 'vocab'
	];
	
	return roleKeywords.some(keyword => lowerName.includes(keyword));
}

/**
 * 加载单个角色文件（使用缓存优化）
 * @param filePath 文件绝对路径
 * @param packagePath 包路径（相对于 novel-helper）
 * @param fileName 文件名
 */
function loadRoleFile(filePath: string, packagePath: string, fileName: string) {
	console.log(`loadRoleFile: 加载文件 ${filePath}`);
	
	try {
		// 使用缓存获取文件内容
		const content = globalFileCache.getFileContent(filePath);
		if (content === null) {
			console.warn(`loadRoleFile: 无法读取文件 ${filePath}`);
			return;
		}
		
		const fileType = getFileType(fileName);
		
		if (fileName.endsWith('.json5')) {
			loadJSON5RoleFile(content, filePath, packagePath, fileType);
		} else if (fileName.endsWith('.txt')) {
			loadTXTRoleFile(content, filePath, packagePath, fileType);
		} else if (fileName.endsWith('.md')) {
			loadMarkdownRoleFile(content, filePath, packagePath, fileType);
		}
	} catch (error) {
		console.error(`loadRoleFile: 加载文件失败 ${filePath}: ${error}`);
		vscode.window.showErrorMessage(`加载角色文件失败: ${fileName} - ${error}`);
	}
}

/**
 * 根据文件名判断文件类型
 */
function getFileType(fileName: string): string {
	const lowerName = fileName.toLowerCase();
	
	if (lowerName.includes('sensitive')) {
		return '敏感词';
	} else if (lowerName.includes('vocabulary') || lowerName.includes('vocab')) {
		return '词汇';
	} else {
		return '角色';
	}
}

/**
 * 加载 JSON5 格式的角色文件
 */
function loadJSON5RoleFile(content: string, filePath: string, packagePath: string, defaultType: string) {
	try {
		// 处理空文件或只包含空白字符的文件
		const trimmedContent = content.trim();
		if (trimmedContent === '') {
			console.log(`loadJSON5RoleFile: ${filePath} 是空文件，跳过解析`);
			return;
		}
		
		const data = JSON5.parse(trimmedContent);
		let rolesArray: Role[] = [];
		
		// 支持数组格式和对象格式
		if (Array.isArray(data)) {
			rolesArray = data;
		} else if (typeof data === 'object' && data !== null) {
			// 如果是对象，可能包含元数据，查找角色数组
			if (data.roles && Array.isArray(data.roles)) {
				rolesArray = data.roles;
			} else if (data.characters && Array.isArray(data.characters)) {
				rolesArray = data.characters;
			} else {
				// 将对象的每个属性作为一个角色
				rolesArray = Object.entries(data).map(([name, roleData]) => ({
					name,
					...(typeof roleData === 'object' ? roleData : { type: defaultType }),
				})) as Role[];
			}
		} else {
			console.warn(`loadJSON5RoleFile: ${filePath} 包含无效的数据类型: ${typeof data}`);
			return;
		}
		
		// 为每个角色添加路径信息
		for (const role of rolesArray) {
			role.packagePath = packagePath;
			role.sourcePath = filePath;
			
			// 如果没有指定类型，使用默认类型
			if (!role.type) {
				role.type = defaultType;
			}
			
			roles.push(role);
		}
		
		console.log(`loadJSON5RoleFile: 从 ${filePath} 加载了 ${rolesArray.length} 个角色`);
	} catch (error) {
		// 提供更详细的错误信息
		if (error instanceof SyntaxError) {
			console.error(`loadJSON5RoleFile: JSON5 语法错误 ${filePath}: ${error.message}`);
			throw new Error(`JSON5 语法错误: ${error.message}。请检查文件格式是否正确。`);
		} else {
			console.error(`loadJSON5RoleFile: 解析错误 ${filePath}: ${error}`);
			throw new Error(`解析 JSON5 文件失败: ${error}`);
		}
	}
}

/**
 * 加载 Markdown 格式的角色文件
 */
function loadMarkdownRoleFile(content: string, filePath: string, packagePath: string, defaultType: string) {
	// 如果文件为空，记录日志但不报错
	if (content.trim() === '') {
		console.log(`loadMarkdownRoleFile: ${filePath} 是空文件，跳过加载`);
		return;
	}
	
	try {
		const markdownRoles = parseMarkdownRoles(content, filePath, packagePath, defaultType);
		for (const role of markdownRoles) {
			roles.push(role);
		}
		console.log(`loadMarkdownRoleFile: 从 ${filePath} 加载了 ${markdownRoles.length} 个角色`);
	} catch (error) {
		console.error(`loadMarkdownRoleFile: 解析 Markdown 文件失败 ${filePath}: ${error}`);
		throw new Error(`解析 Markdown 文件失败: ${error}`);
	}
}
function loadTXTRoleFile(content: string, filePath: string, packagePath: string, defaultType: string) {
	const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
	const lines = content.split(/\r?\n/).filter(line => line.trim() !== '');
	
	// 如果文件为空，记录日志但不报错
	if (lines.length === 0) {
		console.log(`loadTXTRoleFile: ${filePath} 是空文件，跳过加载`);
		return;
	}
	
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed === '') continue;
		
		const role: Role = {
			name: trimmed,
			type: defaultType,
			packagePath: packagePath,
			sourcePath: filePath
		};
		
		// 根据类型设置默认颜色
		if (defaultType === '敏感词') {
			role.color = '#FF0000';
		} else if (defaultType === '角色') {
			role.type = 'txt角色';
			role.color = cfg.get<string>('defaultColor')!;
		}
		
		roles.push(role);
	}
	
	console.log(`loadTXTRoleFile: 从 ${filePath} 加载了 ${lines.length} 个角色`);
}

/**
 * 传统方式加载角色（向后兼容）
 * @param forceRefresh 是否强制刷新
 * @param changedFiles 变化的文件列表
 */
function loadTraditionalRoles(forceRefresh: boolean = false, changedFiles?: string[]) {
	const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
	const folders = vscode.workspace.workspaceFolders;
	if (!folders || !folders.length) {
		return;
	}
	const root = folders[0].uri.fsPath;
	
	// 通用加载函数：fileKey 为配置项键，defaultType 为当 txt 版本加载时使用的类型
	function loadLibrary(fileKey: string, defaultType: string) {
		const fileName = cfg.get<string>(fileKey);
		if (!fileName) {
			console.warn(`loadTraditionalRoles: ${fileKey} 未设置`);
			return;
		}
		const libPath = path.join(root, fileName);
		const txtPath = libPath.replace(/\.[^/.]+$/, ".txt");
		
		// 如果指定了变化文件，只处理相关文件
		if (changedFiles) {
			const shouldProcessJson = changedFiles.includes(libPath);
			const shouldProcessTxt = changedFiles.includes(txtPath);
			
			if (!shouldProcessJson && !shouldProcessTxt) {
				return;
			}
			
			// 移除该文件的角色
			const filePathsToRemove = [libPath, txtPath];
			for (let i = roles.length - 1; i >= 0; i--) {
				if (roles[i].sourcePath && filePathsToRemove.includes(roles[i].sourcePath!)) {
					roles.splice(i, 1);
				}
			}
		}

		// 加载 JSON5 版（如果存在）
		if (fs.existsSync(libPath) && (!changedFiles || changedFiles.includes(libPath))) {
			try {
				const content = forceRefresh ? 
					fs.readFileSync(libPath, 'utf8') : 
					globalFileCache.getFileContent(libPath);
				
				if (content) {
					const arr = JSON5.parse(content) as Role[];
					// 为传统加载的角色添加路径信息
					for (const role of arr) {
						role.packagePath = '';  // 根目录
						role.sourcePath = libPath;
					}
					roles.push(...arr);
					console.log(`loadTraditionalRoles: 成功加载 JSON5库 ${fileName}`);
				}
			} catch (e) {
				vscode.window.showErrorMessage(`解析 ${fileName} 失败: ${e}`);
			}
		}

		// 加载 txt 版
		if (fs.existsSync(txtPath) && (!changedFiles || changedFiles.includes(txtPath))) {
			try {
				const content = forceRefresh ? 
					fs.readFileSync(txtPath, 'utf8') : 
					globalFileCache.getFileContent(txtPath);
				
				if (content) {
					const lines = content.split(/\r?\n/).filter(line => line.trim() !== '');
					for (const line of lines) {
						const trimmed = line.trim();
						let role: Role = { 
							name: trimmed, 
							type: defaultType,
							packagePath: '',
							sourcePath: txtPath
						};
						if (fileKey === 'rolesFile') {
							role.type = "txt角色";
							role.color = cfg.get<string>('defaultColor')!;
						} else if (fileKey === 'sensitiveWordsFile') {
							role.type = "敏感词";
							role.color = "#FF0000";
						} else if (fileKey === 'vocabularyFile') {
							role.type = "词汇";
						}
						roles.push(role);
					}
					console.log(`loadTraditionalRoles: 成功加载 TXT库 ${fileName}`);
				}
			} catch (e) {
				vscode.window.showErrorMessage(`解析 TXT ${fileName} 失败: ${e}`);
			}
		}
	}
	
	loadLibrary('rolesFile', "角色");
	loadLibrary('sensitiveWordsFile', "敏感词");
	loadLibrary('vocabularyFile', "词汇");
}

/**
 * 执行增量更新
 * @param changedFiles 变化的文件路径列表
 * @param novelHelperRoot novel-helper 根目录
 */
function performIncrementalUpdate(changedFiles: string[], novelHelperRoot: string) {
	console.log(`performIncrementalUpdate: 处理 ${changedFiles.length} 个变化文件`);
	
	// 移除变化文件对应的角色
	for (const filePath of changedFiles) {
		// 移除该文件的所有角色
		for (let i = roles.length - 1; i >= 0; i--) {
			if (roles[i].sourcePath === filePath) {
				roles.splice(i, 1);
			}
		}
		
		// 刷新文件缓存
		globalFileCache.refreshFile(filePath);
	}
	
	// 重新加载变化的文件
	for (const filePath of changedFiles) {
		if (!fs.existsSync(filePath)) {
			// 文件已删除，从缓存中移除
			globalFileCache.removeFile(filePath);
			continue;
		}
		
		const fileName = path.basename(filePath);
		if (!isRoleFile(fileName)) {
			continue;
		}
		
		const packagePath = path.relative(novelHelperRoot, path.dirname(filePath));
		loadRoleFile(filePath, packagePath, fileName);
	}
}


/**
 * 给定一个 andrea-outline://outline 下的“文件大纲”URI，
 * 返回它对应的工作区内原始 Markdown 文件的 Uri。
 * 如果不是文件大纲（不以 `_outline.md` 结尾）或无工作区，返回 undefined。
 */
export function getOriginalFileUriFromOutlineUri(outlineUri: vscode.Uri): vscode.Uri | undefined {
	// 只处理 our custom scheme
	if (outlineUri.scheme !== 'andrea-outline') {
		return undefined;
	}

	// 拿到相对路径，例如 "chapter1/foo_outline.md"
	const relOutlinePath = outlineUri.path.replace(/^\/+/, '');
	const suffix = '_outline.md';
	if (!relOutlinePath.endsWith(suffix)) {
		return undefined;
	}

	// 去掉后缀，得到 "chapter1/foo"
	const withoutSuffix = relOutlinePath.slice(0, -suffix.length);
	// 构建原文件相对路径 "chapter1/foo.md"
	const sourceRel = `${withoutSuffix}.md`;

	// 找到工作区根
	const ws = vscode.workspace.workspaceFolders?.[0];
	if (!ws) {
		return undefined;
	}
	const wsRoot = ws.uri.fsPath;

	// 返回 file:// Uri
	return vscode.Uri.file(path.join(wsRoot, sourceRel));
}