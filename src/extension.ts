import * as vscode from 'vscode';
import { activate as activateRoles, deactivate as deactivateRoles } from './activate';
import { initI18n } from './utils/i18n';

// 角色定义接口
export interface Role {
	/** 插入的主名称 */
	name: string;
	/** 角色类型：主角、配角、联动角色、正则表达式等 */
	type: '主角' | '配角' | '联动角色' | '敏感词' | '词汇' | '正则表达式' | string;
	/** 从属标签，如所属阵营、组织等 */
	affiliation?: string;
	/** 可选别名数组 */
	aliases?: string[];
	/** 补全列表中显示的简介 */
	description?: string;
	/** 颜色十六进制，如 '#E60033'，优先级高于类型默认色 */
	color?: string;
	/** 是否启用分词过滤，避免单字误匹配 */
	wordSegmentFilter?: boolean;
	/** 角色所在的包路径（相对于 novel-helper 目录） */
	packagePath?: string;
	/** 角色来源文件路径（完整路径） */
	sourcePath?: string;
	/** 正则表达式模式（仅适用于正则表达式角色） */
	regex?: string;
	/** 正则表达式标志，如 'gi'（仅适用于正则表达式角色） */
	regexFlags?: string;
	/** 着色器优先级（数字越小优先级越高，默认为999） */
	priority?: number;
	/** 敏感词可替换修复候选（仅对 type==='敏感词' 使用；别名不自动补全，修复项需要可补全） */
	fixes?: string[]; // 修复 (向后兼容旧字段 fixs)
}


// 中文分词器(词级别)
export const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });


export function activate(context: vscode.ExtensionContext) {
	// 初始化 i18n，优先使用vscode.l10n，fallback到手动加载
	initI18n(context.extensionPath);
	activateRoles(context);
}

export function deactivate() {
	deactivateRoles();
}
