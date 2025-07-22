import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as chardet from 'jschardet';
import * as iconv from 'iconv-lite';
import JSON5 from 'json5';

/* eslint-disable curly */
import { Role, segmenter } from "../extension";
import { cleanRoles, roles } from '../activate';
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
 * 加载角色库、词汇库和敏感词库，均为 JSON5，支持注释与尾逗号
 */
export function loadRoles() {
	cleanRoles();
	const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
	const folders = vscode.workspace.workspaceFolders;
	if (!folders || !folders.length) {
		console.error('loadRoles: 未找到工作区文件夹');
		return;
	}
	const root = folders[0].uri.fsPath;
	console.log(`loadRoles: workspace root = ${root}`);
	// 通用加载函数：fileKey 为配置项键，defaultType 为当 txt 版本加载时使用的类型
	function loadLibrary(fileKey: string, defaultType: string) {
		const fileName = cfg.get<string>(fileKey);
		console.log(`loadLibrary: fileKey = ${fileKey}, fileName = ${fileName}`);
		if (!fileName) {
			vscode.window.showErrorMessage(`配置项 ${fileKey} 未设置，请检查设置`);
			console.error(`loadLibrary: ${fileKey} 为 undefined`);
			return;
		}
		const libPath = path.join(root, fileName);
		console.log(`loadLibrary: libPath = ${libPath}`);

		// 加载 JSON5 版（如果存在）
		if (fs.existsSync(libPath)) {
			try {
				const text = fs.readFileSync(libPath, 'utf8');
				const arr = JSON5.parse(text) as Role[];
				roles.push(...arr);
				console.log(`loadLibrary: 成功加载 JSON5库 ${fileName}`);
			} catch (e) {
				vscode.window.showErrorMessage(`解析 ${fileName} 失败: ${e}`);
				console.error(`loadLibrary: 解析 ${fileName} 失败: ${e}`);
			}
		} else {
			vscode.window.showWarningMessage(`${fileName} 未找到`);
			console.warn(`loadLibrary: ${libPath} 不存在`);
		}

		// 加载 txt 版（仅用于用户迁移，不与 JSON5 同步）
		const txtPath = libPath.replace(/\.[^/.]+$/, ".txt");
		console.log(`loadLibrary: TXT版本路径 = ${txtPath}`);
		if (fs.existsSync(txtPath)) {
			try {
				const txtContent = fs.readFileSync(txtPath, 'utf8');
				const lines = txtContent.split(/\r?\n/).filter(line => line.trim() !== '');
				for (const line of lines) {
					const trimmed = line.trim();
					let role: Role = { name: trimmed, type: defaultType };
					if (fileKey === 'rolesFile') {
						// 普通角色的 txt 版本：固定类型为 "txt角色"，使用配置中的默认颜色
						role.type = "txt角色";
						role.color = cfg.get<string>('defaultColor')!;
					} else if (fileKey === 'sensitiveWordsFile') {
						// 敏感词：保持 "敏感词"，固定红色
						role.type = "敏感词";
						role.color = "#FF0000";
					} else if (fileKey === 'vocabularyFile') {
						// 词汇：保持 "词汇"，不设置颜色
						role.type = "词汇";
					}
					// txt 版不支持别名和描述，直接忽略
					roles.push(role);
				}
				console.log(`loadLibrary: 成功加载 TXT库 ${fileName}`);
			} catch (e) {
				vscode.window.showErrorMessage(`解析 TXT ${fileName} 失败: ${e}`);
				console.error(`loadLibrary: 解析 TXT ${fileName} 失败: ${e}`);
			}
		}
	}
	loadLibrary('rolesFile', "角色");
	loadLibrary('sensitiveWordsFile', "敏感词");
	loadLibrary('vocabularyFile', "词汇");

	generateCSpellDictionary();
}