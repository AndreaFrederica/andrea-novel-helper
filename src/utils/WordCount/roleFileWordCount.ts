/**
 * 专用角色文件（.ojson5 / 角色类 .json5）字数统计器
 *
 * 核心思路：
 *   - 将文件解析为 JSON5 结构（角色对象数组）
 *   - 只对"叙述性字段"（作者撰写的内容）的字符串值计字数
 *   - 跳过元数据/技术字段（uuid, color, 样式属性, 正则, 数字标志等）
 *   - 解析失败时 fallback 为通用统计
 *
 * 此文件不依赖 vscode API，可在 worker 线程中安全使用。
 */

import * as fs from 'fs';
import * as path from 'path';
import JSON5 from 'json5';
import { analyzeText, countAndAnalyzeRaw, TextStats } from './wordCountCore';
import {
    CHARACTER_FILE_KEYWORDS,
    REGEX_FILE_KEYWORDS,
    SENSITIVE_FILE_KEYWORDS,
    VOCABULARY_FILE_KEYWORDS,
} from '../../projectConfig/resourceFileNaming';

// ===================== 字段跳过表 =====================

/**
 * 这些字段不参与字数统计（均为技术/元数据字段，非作者撰写的叙述内容）：
 *
 * - type              短标签（"主角"/"配角"/"NPC"），系统分类用
 * - uuid              角色唯一标识符
 * - color             颜色值（#rrggbb）
 * - backgroundColor   背景色
 * - style             样式对象
 * - bold/italic/      文本样式布尔值
 *   strikethrough/
 *   underline
 * - regex/regexFlags  正则匹配式
 * - priority          优先级数字
 * - wordSegmentFilter 分词过滤开关
 * - fixes             替换/纠错词条（非叙述文字）
 * - packagePath/      后端运行时隐藏键
 *   sourcePath/id
 */
const SKIP_KEYS = new Set([
    'type',
    'uuid',
    'color', 'backgroundcolor',           // 规范化后小写
    'style',
    'bold', 'italic', 'strikethrough', 'underline',
    'regex', 'regexflags',
    'priority', 'wordsegmentfilter',
    'fixes',
    'packagepath', 'sourcepath', 'id',
]);

// ===================== 文件识别 =====================

/** 对应 utils.ts isRoleFile 的英文关键词表（不依赖 vscode，仅做文件名匹配） */
const ROLE_EN_KEYWORDS = Array.from(new Set([
    ...CHARACTER_FILE_KEYWORDS,
    ...SENSITIVE_FILE_KEYWORDS,
    ...VOCABULARY_FILE_KEYWORDS,
    ...REGEX_FILE_KEYWORDS,
])).map(item => item.toLowerCase());

/** 中文关键词（保留原始大小写进行匹配） */
const ROLE_ZH_KEYWORDS = [
    '角色', '人物', '敏感词', '词汇', '词庫', '词库',
];

/**
 * 判断该文件是否应使用角色专用字数统计逻辑。
 * 与 utils.ts `isRoleFile` 保持一致，但不依赖 vscode / fs 同步内容嗅探。
 *
 * - .ojson5           → 始终是角色文件
 * - .rjson5 / .tjson5 → 不是（关系文件 / 时间线文件）
 * - .json5            → 根据文件名关键词判断
 */
export function isRoleCountableFile(filePath: string): boolean {
    const base = path.basename(filePath);
    const lowerBase = base.toLowerCase();

    if (lowerBase.endsWith('.ojson5')) { return true; }
    if (lowerBase.endsWith('.rjson5') || lowerBase.endsWith('.tjson5')) { return false; }
    if (!lowerBase.endsWith('.json5')) { return false; }

    if (ROLE_EN_KEYWORDS.some(k => lowerBase.includes(k))) { return true; }
    if (ROLE_ZH_KEYWORDS.some(k => base.includes(k))) { return true; }
    return false;
}

// ===================== 文本提取 =====================

/**
 * 从单个角色对象中收集所有应计字数的字符串值。
 * 跳过 SKIP_KEYS 中的字段；跳过非 string / string[] 类型的值。
 */
function extractStringsFromRole(role: Record<string, unknown>): string[] {
    const pieces: string[] = [];

    for (const [rawKey, value] of Object.entries(role)) {
        // 用小写规范化做跳过判断
        if (SKIP_KEYS.has(rawKey.trim().toLowerCase())) { continue; }

        if (typeof value === 'string') {
            const s = value.trim();
            if (s.length > 0) { pieces.push(s); }
        } else if (Array.isArray(value)) {
            for (const item of value) {
                if (typeof item === 'string') {
                    const s = item.trim();
                    if (s.length > 0) { pieces.push(s); }
                }
            }
        }
        // boolean / number / object → 跳过
    }

    return pieces;
}

// ===================== 主入口 =====================

/**
 * 专用角色文件字数统计主函数。
 *
 * 流程：
 *  1. 读取文件内容
 *  2. JSON5 解析
 *  3. 遍历角色数组，提取叙述性字段的字符串值
 *  4. 调用 analyzeText() 统计字数
 *
 * 任一步骤失败（读取错误、解析失败、不是数组）均 fallback 到 `countAndAnalyzeRaw`。
 */
export async function countRoleFileWords(filePath: string): Promise<TextStats> {
    // ── Step 1: 读取文件 ──
    let raw: string;
    try {
        raw = await fs.promises.readFile(filePath, 'utf-8');
    } catch {
        // 读取失败（文件不存在、权限问题等），降级为通用统计
        return countAndAnalyzeRaw(filePath);
    }

    // ── Step 2: JSON5 解析 ──
    let parsed: unknown;
    try {
        parsed = JSON5.parse(raw);
    } catch {
        // 语法错误 → 当普通文本统计
        return countAndAnalyzeRaw(filePath);
    }

    // ── Step 3: 必须为角色对象数组 ──
    if (!Array.isArray(parsed)) {
        return countAndAnalyzeRaw(filePath);
    }

    // ── Step 4: 提取文本 ──
    const allText: string[] = [];
    for (const item of parsed) {
        if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
            allText.push(...extractStringsFromRole(item as Record<string, unknown>));
        }
    }

    if (allText.length === 0) {
        return { cjkChars: 0, asciiChars: 0, words: 0, nonWSChars: 0, nonWSNoPunct: 0, total: 0 };
    }

    // ── Step 5: 统计 ──
    return analyzeText(allText.join('\n'));
}
