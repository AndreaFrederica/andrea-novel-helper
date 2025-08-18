import AhoCorasick from 'ahocorasick';
import { Role } from '../extension';
import { roles, onDidChangeRoles } from '../activate';
import { findCompleteWords, shouldUseSegmentFilter } from './segmentFilter';

/**
 * AhoCorasick 自动机管理器
 * 单例模式，避免重复初始化
 */
class AhoCorasickManager {
    private static instance: AhoCorasickManager;
    private ac: AhoCorasick | null = null;
    private patternMap = new Map<string, Role>();
    private isInitialized = false;

    private constructor() {}

    public static getInstance(): AhoCorasickManager {
        if (!AhoCorasickManager.instance) {
            AhoCorasickManager.instance = new AhoCorasickManager();
        }
        return AhoCorasickManager.instance;
    }

    /**
     * 初始化（或重建）自动机 & patternMap
     */
    public initAutomaton(): void {
        this.patternMap.clear();
        const patterns: string[] = [];
        
        for (const r of roles) {
            const nameKey = r.name.trim().normalize('NFC');
            patterns.push(nameKey);
            this.patternMap.set(nameKey, r);
            
            // 处理别名
            for (const alias of r.aliases || []) {
                const a = alias.trim().normalize('NFC');
                patterns.push(a);
                this.patternMap.set(a, r);
            }
            
            // 处理 fixes/fixs 字段（修复候选词也应该被识别为该角色）
            const fixesArr: string[] | undefined = (r as any).fixes || (r as any).fixs;
            if (Array.isArray(fixesArr)) {
                for (const fix of fixesArr) {
                    const f = fix.trim().normalize('NFC');
                    if (f) { // 确保不是空字符串
                        patterns.push(f);
                        this.patternMap.set(f, r);
                    }
                }
            }
        }
        
        // @ts-ignore
        this.ac = new AhoCorasick(patterns);
        this.isInitialized = true;
    }

    /**
     * 搜索文本中的匹配项（支持分词过滤）
     */
    public search(text: string): Array<[number, string | string[]]> {
        if (!this.isInitialized || !this.ac) {
            this.initAutomaton();
        }
        
        const rawHits = this.ac!.search(text) as Array<[number, string | string[]]>;
        const filteredHits: Array<[number, string | string[]]> = [];
        
        for (const [endIdx, patOrArr] of rawHits) {
            const patterns = Array.isArray(patOrArr) ? patOrArr : [patOrArr];
            const validPatterns: string[] = [];
            
            for (const pattern of patterns) {
                const role = this.getRole(pattern);
                if (!role) {
                    continue;
                }
                
                // 检查是否需要分词过滤
                if (shouldUseSegmentFilter(pattern, role.wordSegmentFilter)) {
                    // 使用分词过滤验证
                    const matches = findCompleteWords(text, pattern);
                    const currentEnd = endIdx + 1;
                    const currentStart = currentEnd - pattern.length;
                    
                    // 检查当前位置是否在完整词匹配中
                    const isValidMatch = matches.some(match => 
                        match.start === currentStart && match.end === currentEnd
                    );
                    
                    if (isValidMatch) {
                        validPatterns.push(pattern);
                    }
                } else {
                    // 不使用分词过滤，直接接受
                    validPatterns.push(pattern);
                }
            }
            
            if (validPatterns.length > 0) {
                filteredHits.push([endIdx, validPatterns.length === 1 ? validPatterns[0] : validPatterns]);
            }
        }
        
        return filteredHits;
    }

    /**
     * 根据模式获取对应的角色
     */
    public getRole(pattern: string): Role | undefined {
        return this.patternMap.get(pattern.trim().normalize('NFC'));
    }

    /**
     * 重置自动机（当角色数据变化时调用）
     */
    public reset(): void {
        this.ac = null;
        this.patternMap.clear();
        this.isInitialized = false;
    }
}

export const ahoCorasickManager = AhoCorasickManager.getInstance();

/**
 * 初始化 AhoCorasick 管理器
 * 在扩展激活时调用
 */
export function initAhoCorasickManager(context: any): void {
    // 监听角色变化，重置自动机
    context.subscriptions.push(
        onDidChangeRoles(() => {
            ahoCorasickManager.reset();
        })
    );
    
    // 初始化
    ahoCorasickManager.initAutomaton();
}
