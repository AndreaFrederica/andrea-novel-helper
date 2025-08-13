import AhoCorasick from 'ahocorasick';
import { Role } from '../extension';
import { roles, onDidChangeRoles } from '../activate';

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
            
            for (const alias of r.aliases || []) {
                const a = alias.trim().normalize('NFC');
                patterns.push(a);
                this.patternMap.set(a, r);
            }
        }
        
        // @ts-ignore
        this.ac = new AhoCorasick(patterns);
        this.isInitialized = true;
    }

    /**
     * 搜索文本中的匹配项
     */
    public search(text: string): Array<[number, string | string[]]> {
        if (!this.isInitialized || !this.ac) {
            this.initAutomaton();
        }
        return this.ac!.search(text) as Array<[number, string | string[]]>;
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
