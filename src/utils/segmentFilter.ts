import { segmenter } from '../extension';
import * as vscode from 'vscode';

/**
 * 检查文本中是否包含完整的词（避免单字误匹配）
 * @param text 待搜索的文本
 * @param target 目标词汇
 * @returns 匹配的位置数组，每个元素包含 start 和 end
 */
export function findCompleteWords(text: string, target: string): Array<{ start: number; end: number }> {
    const results: Array<{ start: number; end: number }> = [];
    const segments = Array.from(segmenter.segment(text));
    
    let currentIndex = 0;
    for (const { segment, isWordLike } of segments) {
        if (isWordLike && segment === target) {
            results.push({
                start: currentIndex,
                end: currentIndex + segment.length
            });
        }
        currentIndex += segment.length;
    }
    
    return results;
}

/**
 * 检查是否应该使用分词过滤
 * @param roleName 角色名称
 * @param roleWordSegmentFilter 角色级别的设置
 * @returns 是否使用分词过滤
 */
export function shouldUseSegmentFilter(roleName: string, roleWordSegmentFilter?: boolean): boolean {
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    const globalEnabled = cfg.get<boolean>('enableWordSegmentFilter', true);
    
    // 如果全局关闭，则不使用
    if (!globalEnabled) {
        return false;
    }
    
    // 如果角色明确设置了，以角色设置为准
    if (roleWordSegmentFilter !== undefined) {
        return roleWordSegmentFilter;
    }
    
    // 默认策略：单字角色名启用分词过滤，多字角色名不启用
    return roleName.length === 1;
}
