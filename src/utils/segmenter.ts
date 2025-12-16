import { segmenter } from "../extension";
import * as vscode from 'vscode';
import { roles } from '../activate';
import type { Jieba as JiebaCtor } from '@node-rs/jieba';

// 创建jieba实例
let jiebaInstance: any = null;
let jiebaLoadError: Error | null = null;
let customDictLoaded = false;
let jiebaWarningShown = false;
let JiebaClass: { new(): JiebaCtor } | null = null;
let jiebaModuleError: Error | null = null;

// 尝试加载 @node-rs/jieba，避免顶层 import 失败导致扩展崩溃
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    JiebaClass = (require('@node-rs/jieba') as { Jieba: JiebaCtor }).Jieba as unknown as { new(): JiebaCtor };
} catch (err) {
    jiebaModuleError = err as Error;
    console.warn('[ANH][Segmenter] 无法加载 @node-rs/jieba，已回退到 Intl 分词。', err);
}

/**
 * 从角色数据构建自定义词典
 */
function buildCustomDict(): string[] {
    const customWords: string[] = [];

    try {
        for (const role of roles) {
            // 添加角色名
            if (role.name && role.name.trim()) {
                customWords.push(role.name.trim());
            }

            // 添加别名
            if (role.aliases) {
                for (const alias of role.aliases) {
                    if (alias && alias.trim()) {
                        customWords.push(alias.trim());
                    }
                }
            }

            // 添加修复项（敏感词）
            if (role.fixes) {
                for (const fix of role.fixes) {
                    if (fix && fix.trim()) {
                        customWords.push(fix.trim());
                    }
                }
            }

            // 兼容旧字段 fixs
            if ((role as any).fixs) {
                for (const fix of (role as any).fixs) {
                    if (fix && fix.trim()) {
                        customWords.push(fix.trim());
                    }
                }
            }
        }

        // 去重并过滤空字符串
        const uniqueWords = [...new Set(customWords.filter(word => word.length > 0))];
        console.log(`[ANH][Segmenter] 构建自定义词典: ${uniqueWords.length} 个词汇`);
        return uniqueWords;
    } catch (error) {
        console.error('[ANH][Segmenter] 构建自定义词典失败:', error);
        return [];
    }
}

/**
 * 初始化jieba分词器并加载自定义词典
 */
function initializeJieba() {
    if (jiebaInstance !== null || jiebaLoadError !== null) {
        return; // 已经初始化过了
    }

    try {
        if (!JiebaClass) {
            throw jiebaModuleError || new Error('未找到 @node-rs/jieba 模块');
        }
        // 使用默认字典初始化
        jiebaInstance = new JiebaClass();

        // 加载自定义词典
        const customWords = buildCustomDict();
        if (customWords.length > 0) {
            // @node-rs/jieba 支持添加自定义词汇
            // 使用 insertWord 方法添加词汇，权重设为较高值确保正确分词
            for (const word of customWords) {
                try {
                    jiebaInstance.insertWord(word, 1000); // 高权重
                } catch (error) {
                    // 忽略单个词汇添加失败
                }
            }
            customDictLoaded = true;
            console.log(`[ANH][Segmenter] Jieba分词器加载成功，已加载 ${customWords.length} 个自定义词汇`);
        } else {
            console.log('[ANH][Segmenter] Jieba分词器加载成功，未加载自定义词汇');
        }
    } catch (error) {
        jiebaLoadError = error as Error;
        console.warn('[ANH][Segmenter] Jieba分词器加载失败:', error);
        if (!jiebaWarningShown) {
            jiebaWarningShown = true;
            void vscode.window.showWarningMessage(
                'Jieba 分词器加载失败，将回退到 Intl 分词器（性能可能降低）。',
                { modal: false }
            );
        }
    }
}

// 初始化jieba分词器
initializeJieba();

export type SegmenterType = 'intl' | 'jieba' | 'auto';

/**
 * 获取用户配置的分词器类型
 */
export function getSegmenterType(): SegmenterType {
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    return cfg.get<SegmenterType>('completion.segmenterType', 'auto');
}

/**
 * 使用jieba分词器进行分词
 */
function segmentWithJieba(text: string): string[] {
    if (!jiebaInstance) {
        throw new Error('Jieba分词器未加载');
    }
    try {
        // 使用jieba进行精确分词
        return jiebaInstance.cut(text, false);
    } catch (error) {
        console.error('[ANH][Segmenter] jieba分词失败:', error);
        throw error;
    }
}

/**
 * 使用Intl.Segmenter进行分词
 */
function segmentWithIntl(text: string): string[] {
    const segments: string[] = [];
    try {
        for (const { segment, isWordLike } of segmenter.segment(text)) {
            if (isWordLike) {
                segments.push(segment);
            }
        }
        return segments;
    } catch (error) {
        console.error('[ANH][Segmenter] Intl.Segmenter分词失败:', error);
        throw error;
    }
}

/**
 * 智能选择分词器
 * 如果jieba可用且文本主要是中文，则使用jieba，否则使用Intl.Segmenter
 */
function segmentWithAuto(text: string): string[] {
    // 检查jieba是否可用
    if (jiebaInstance) {
        // 检查文本中中文字符的比例
        const chineseChars = (text.match(/[\p{Script=Han}]/gu) || []).length;
        const totalChars = text.replace(/\s/g, '').length;

        if (totalChars > 0 && chineseChars / totalChars > 0.3) {
            // 中文字符超过30%，使用jieba
            try {
                return segmentWithJieba(text);
            } catch (error) {
                console.warn('[ANH][Segmenter] jieba分词失败，回退到Intl.Segmenter:', error);
            }
        }
    }

    // 回退到Intl.Segmenter
    return segmentWithIntl(text);
}

/**
 * 统一的分词接口
 * @param text 要分词的文本
 * @param type 分词器类型，如果不指定则使用用户配置
 * @returns 分词结果数组
 */
export function segmentText(text: string, type?: SegmenterType): string[] {
    const segmenterType = type || getSegmenterType();

    try {
        switch (segmenterType) {
            case 'jieba':
                return segmentWithJieba(text);
            case 'intl':
                return segmentWithIntl(text);
            case 'auto':
            default:
                return segmentWithAuto(text);
        }
    } catch (error) {
        console.warn(`[ANH][Segmenter] 使用${segmenterType}分词器失败，回退到正则分词:`, error);
        // 最后的回退方案：使用正则表达式分词
        return fallbackSegment(text);
    }
}

/**
 * 回退的分词方案：使用正则表达式
 */
function fallbackSegment(text: string): string[] {
    const segments: string[] = [];

    // 匹配连续的中文字符、英文数字下划线
    const regex = /([\p{Script=Han}]+|[A-Za-z0-9_]+)/gu;
    let match;

    while ((match = regex.exec(text)) !== null) {
        segments.push(match[1]);
    }

    return segments;
}

/**
 * 获取文本的最后一个词作为补全前缀
 * @param line 当前行文本
 * @param type 分词器类型，如果不指定则使用用户配置
 * @returns 最后一个词作为前缀
 */
export function getLastWord(line: string, type?: SegmenterType): string {
    const segments = segmentText(line, type);
    return segments.length > 0 ? segments[segments.length - 1] : '';
}

/**
 * 检查目标文本是否包含前缀
 * 支持智能分词匹配
 */
export function containsPrefix(target: string, prefix: string, segmenterType?: SegmenterType): boolean {
    if (!prefix) return false;

    // 简单的包含匹配（保持原有行为）
    if (target.includes(prefix)) {
        return true;
    }

    // 如果前缀很短（1-2个字符），使用分词匹配避免误匹配
    if (prefix.length <= 2 && segmenterType !== 'intl') {
        try {
            const targetSegments = segmentText(target, segmenterType);
            return targetSegments.includes(prefix);
        } catch (error) {
            // 分词失败，回退到简单匹配
            return target.includes(prefix);
        }
    }

    return false;
}

/**
 * 重新加载jieba自定义词典
 * 在角色数据更新后调用此函数更新分词器
 */
export function reloadCustomDict() {
    if (jiebaInstance) {
        try {
            const customWords = buildCustomDict();
            if (customWords.length > 0) {
                // 清空之前的自定义词汇并重新添加
                // 注意：@node-rs/jieba 可能没有 clearDict 方法，我们直接重新添加
                for (const word of customWords) {
                    try {
                        jiebaInstance.insertWord(word, 1000); // 高权重
                    } catch (error) {
                        // 忽略单个词汇添加失败
                    }
                }
                customDictLoaded = true;
                console.log(`[ANH][Segmenter] 重新加载自定义词典: ${customWords.length} 个词汇`);
            }
        } catch (error) {
            console.error('[ANH][Segmenter] 重新加载自定义词典失败:', error);
        }
    }
}

/**
 * 获取分词器状态信息
 */
export function getSegmenterInfo() {
    return {
        jiebaAvailable: jiebaInstance !== null,
        jiebaLoadError: jiebaLoadError?.message || null,
        customDictLoaded,
        currentType: getSegmenterType()
    };
}
