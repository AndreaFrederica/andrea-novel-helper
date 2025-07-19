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