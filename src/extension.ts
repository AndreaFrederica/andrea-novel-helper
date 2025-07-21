import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import JSON5 from 'json5';
import { activate as activateRoles, deactivate as deactivateRoles } from './activate';

// 角色定义接口
export interface Role {
	/** 插入的主名称 */
	name: string;
	/** 角色类型：主角、配角、联动角色 */
	type: '主角' | '配角' | '联动角色' | '敏感词' | '词汇' | string;
	/** 从属标签，如所属阵营、组织等 */
	affiliation?: string;
	/** 可选别名数组 */
	aliases?: string[];
	/** 补全列表中显示的简介 */
	description?: string;
	/** 颜色十六进制，如 '#E60033'，优先级高于类型默认色 */
	color?: string;
}


// 中文分词器(词级别)
export const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });


export function activate(context: vscode.ExtensionContext) {
	activateRoles(context);
}

export function deactivate() {
	deactivateRoles();
}
