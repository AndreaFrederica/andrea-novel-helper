import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import JSON5 from 'json5';

/* eslint-disable curly */
import { segmenter } from "./extension";

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