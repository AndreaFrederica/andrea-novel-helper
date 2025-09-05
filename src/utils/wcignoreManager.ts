import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// 预定义的常用忽略规则
export interface WcignoreRule {
    pattern: string;
    description: string;
    category: 'project' | 'system' | 'editor' | 'custom';
    enabled?: boolean;
}

export const COMMON_WCIGNORE_RULES: WcignoreRule[] = [
    // 项目资源文件
    { pattern: 'novel-helper/', description: 'Andrea Novel Helper 数据目录', category: 'project' },
    { pattern: '*.vsix', description: 'VS Code 扩展包文件', category: 'project' },
    { pattern: 'node_modules/', description: 'Node.js 依赖包目录', category: 'project' },
    
    // 编辑器配置
    { pattern: '.vscode/', description: 'VS Code 工作区配置', category: 'editor' },
    { pattern: '.idea/', description: 'IntelliJ IDEA 配置', category: 'editor' },
    { pattern: '*.sublime-*', description: 'Sublime Text 配置文件', category: 'editor' },
    
    // 系统文件
    { pattern: '.DS_Store', description: 'macOS 系统文件', category: 'system' },
    { pattern: 'Thumbs.db', description: 'Windows 缩略图缓存', category: 'system' },
    { pattern: 'desktop.ini', description: 'Windows 桌面配置', category: 'system' },
    
    // 版本控制
    { pattern: '.git/', description: 'Git 版本控制目录', category: 'system' },
    { pattern: '.svn/', description: 'SVN 版本控制目录', category: 'system' },
    { pattern: '.hg/', description: 'Mercurial 版本控制目录', category: 'system' },
    
    // 其他常见
    { pattern: '*.tmp', description: '临时文件', category: 'system' },
    { pattern: '*.log', description: '日志文件', category: 'system' },
    { pattern: '.out-of-code-insights/', description: '划词注解扩展数据', category: 'editor' },
];

export class WcignoreManager {
    private workspaceRoot: string;
    private wcignorePath: string;
    // 始终放首屏的推荐项
    public static readonly ALWAYS_PRIMARY = new Set<string>(['novel-helper/', '.vscode/', '.out-of-code-insights/']);

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.wcignorePath = path.join(workspaceRoot, '.wcignore');
    }

    /**
     * 读取当前 .wcignore 文件内容
     */
    public readWcignore(): string {
        try {
            return fs.existsSync(this.wcignorePath) ? fs.readFileSync(this.wcignorePath, 'utf8') : '';
        } catch (error) {
            console.error('读取 .wcignore 失败:', error);
            return '';
        }
    }

    /**
     * 写入 .wcignore 文件
     */
    public writeWcignore(content: string): void {
        try {
            fs.writeFileSync(this.wcignorePath, content, 'utf8');
        } catch (error) {
            throw new Error(`写入 .wcignore 失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 解析 .wcignore 内容，返回规则状态
     */
    public parseCurrentRules(): WcignoreRule[] {
        const content = this.readWcignore();
        const lines = content.split(/\r?\n/);
        const activePatterns = new Set<string>();

        // 提取所有有效模式（支持行内注释与 \\# 字面量）
        for (const raw of lines) {
            const pat = this.parseLineToPattern(raw);
            if (pat) { activePatterns.add(pat); }
        }

        // 归一表：用于合并“语言一致”的预制项与自定义项
        const builtinByNorm = new Map<string, WcignoreRule>();
        for (const br of COMMON_WCIGNORE_RULES) {
            builtinByNorm.set(this.normalizeForCompare(br.pattern), { ...br, enabled: false });
        }

        // 先创建结果列表，预置所有内置规则为未启用
        const result: WcignoreRule[] = Array.from(builtinByNorm.values());

        // 应用当前启用的模式：命中内置（按归一规则）则置为启用；否则作为自定义
        for (const pattern of activePatterns) {
            const norm = this.normalizeForCompare(pattern);
            const hit = builtinByNorm.get(norm);
            if (hit) {
                hit.enabled = true;
            } else {
                result.push({
                    pattern,
                    description: '自定义规则',
                    category: 'custom',
                    enabled: true
                });
            }
        }

        return result;
    }

    /**
     * 行解析：支持行内注释、转义字符和引号路径
     * - 未转义的 # 作为注释起始，\\# 保留
     * - 支持双引号和单引号路径
     * - 去除首尾空白，空行返回 null
     */
    private parseLineToPattern(rawLine: string | undefined | null): string | null {
        if (rawLine === null || rawLine === undefined) { return null; }
        let line = rawLine.replace(/\r$/, '');
        if (line.replace(/^\s+/, '').startsWith('#')) { return null; }
        
        let out = '';
        let escaping = false;
        let inQuotes: '"' | "'" | null = null;
        
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            
            if (escaping) {
                out += ch;
                escaping = false;
                continue;
            }
            
            if (ch === '\\') {
                escaping = true;
                continue;
            }
            
            // 处理引号
            if (!inQuotes && (ch === '"' || ch === "'")) {
                inQuotes = ch;
                continue; // 不包含引号本身
            }
            
            if (inQuotes && ch === inQuotes) {
                inQuotes = null;
                continue; // 不包含引号本身
            }
            
            // 只有在非引号内才处理注释
            if (!inQuotes && ch === '#') {
                break;
            }
            
            out += ch;
        }
        
        const pattern = out.trim();
        return pattern ? pattern : null;
    }

    /**
     * 按“已启用/检测存在/强推荐”将内置规则划分为首屏(primary)与更多(secondary)
     */
    public classifyBuiltins(currentRules?: WcignoreRule[]): { primary: WcignoreRule[]; secondary: WcignoreRule[] } {
        const rules = currentRules ?? this.parseCurrentRules();
        const builtins = COMMON_WCIGNORE_RULES.map(rule => {
            const found = rules.find(r => r.pattern === rule.pattern);
            return { ...rule, enabled: !!found?.enabled } as WcignoreRule;
        });
        const primary: WcignoreRule[] = [];
        const secondary: WcignoreRule[] = [];
        for (const r of builtins) {
            if (r.enabled || WcignoreManager.ALWAYS_PRIMARY.has(r.pattern) || this.existsForPattern(r.pattern)) {
                primary.push(r);
            } else {
                secondary.push(r);
            }
        }
        return { primary, secondary };
    }

    /**
     * 判断模式对应的路径是否存在（仅对无通配、简单文件/目录名进行）
     */
    public existsForPattern(pattern: string): boolean {
        const hasWildcard = /[\*\?\[\]]/.test(pattern);
        if (hasWildcard) { return false; }
        const isDir = pattern.endsWith('/');
        const rel = isDir ? pattern.slice(0, -1) : pattern;
        const full = path.join(this.workspaceRoot, rel);
        try { return fs.existsSync(full); } catch { return false; }
    }

    /**
     * 确保某行存在于 .wcignore 中
     */
    public ensureLine(line: string): boolean {
        const content = this.readWcignore();
        const lines = content.split(/\r?\n/);
        const trimmedLine = line.trim();
        
        // 检查是否已存在
        const exists = lines.some(l => l.trim() === trimmedLine);
        if (exists) {
            return false; // 没有变化
        }

        // 添加新行
        let newContent = content;
        if (newContent && !newContent.endsWith('\n')) {
            newContent += '\n';
        }
        newContent += trimmedLine + '\n';
        
        this.writeWcignore(newContent);
        return true; // 有变化
    }

    /**
     * 从 .wcignore 中移除某行
     */
    public removeLine(line: string): boolean {
        const content = this.readWcignore();
        const lines = content.split(/\r?\n/);
        const trimmedLine = line.trim();
        
        const newLines = lines.filter(l => l.trim() !== trimmedLine);
        
        if (newLines.length === lines.length) {
            return false; // 没有变化
        }

        this.writeWcignore(newLines.join('\n'));
        return true; // 有变化
    }

    /**
     * 添加分类注释和规则
     */
    public updateRulesByCategory(category: string, rules: WcignoreRule[], enabled: boolean): void {
        let content = this.readWcignore();
        
        const categoryComment = `# ${this.getCategoryDisplayName(category)}`;
        const patterns = rules.map(r => r.pattern);

        if (enabled) {
            // 添加规则
            if (!content.includes(categoryComment)) {
                if (content && !content.endsWith('\n')) {
                    content += '\n';
                }
                content += '\n' + categoryComment + '\n';
            }
            
            for (const pattern of patterns) {
                this.ensureLine(pattern);
            }
        } else {
            // 移除规则
            for (const pattern of patterns) {
                this.removeLine(pattern);
            }
        }
    }

    /**
     * 批量更新规则
     */
    public batchUpdateRules(rules: WcignoreRule[]): void {
        // 按分类组织规则
        const rulesByCategory = new Map<string, WcignoreRule[]>();
        
        for (const rule of rules) {
            if (!rulesByCategory.has(rule.category)) {
                rulesByCategory.set(rule.category, []);
            }
            rulesByCategory.get(rule.category)!.push(rule);
        }

        // 重新生成整个文件
        let newContent = '';
        
        // 添加文件头注释
        newContent += '# Andrea Novel Helper - WordCount 忽略规则\n';
        newContent += '# 此文件控制写作资源管理器中显示的文件和文件夹\n';
        newContent += '# 语法与 .gitignore 相同\n\n';

        // 按分类添加规则
        const categoryOrder = ['project', 'editor', 'system', 'custom'];
        
        for (const category of categoryOrder) {
            const categoryRules = rulesByCategory.get(category);
            if (!categoryRules || categoryRules.filter(r => r.enabled).length === 0) {
                continue;
            }

            newContent += `# ${this.getCategoryDisplayName(category)}\n`;
            
            for (const rule of categoryRules) {
                if (rule.enabled) {
                    newContent += `${rule.pattern}  # ${rule.description}\n`;
                }
            }
            
            newContent += '\n';
        }

        this.writeWcignore(newContent.trim() + '\n');
    }

    private getCategoryDisplayName(category: string): string {
        const names: Record<string, string> = {
            'project': '项目资源文件',
            'editor': '编辑器配置',
            'system': '系统文件',
            'custom': '自定义规则'
        };
        return names[category] || category;
    }

    /**
     * 获取 .wcignore 文件路径
     */
    public getWcignorePath(): string {
        return this.wcignorePath;
    }

    /**
     * 检查 .wcignore 文件是否存在
     */
    public exists(): boolean {
        return fs.existsSync(this.wcignorePath);
    }

    /**
     * 生成用于比较归并的规范化 key（去前导 ./ 和 /，统一分隔符）
     */
    public normalizeForCompare(pattern: string): string {
        let p = (pattern || '').trim();
        if (p.startsWith('./')) { p = p.slice(2); }
        if (p.startsWith('/')) { p = p.slice(1); }
        // 统一 \ 为 /
        p = p.replace(/\\/g, '/');
        // 注意：保留末尾的 / 和 /*，因为它们有不同的语义
        return p;
    }

    /**
     * 判断给定模式在提供的规则集中（或当前文件中）是否已存在启用的等价规则
     */
    public isDuplicate(pattern: string, rules?: WcignoreRule[]): boolean {
        const norm = this.normalizeForCompare(pattern);
        const list = rules ?? this.parseCurrentRules();
        for (const r of list) {
            if (!r.enabled) { continue; }
            if (this.normalizeForCompare(r.pattern) === norm) {
                return true;
            }
        }
        return false;
    }

    /** 确保 .wcignore 存在（不存在则用默认模板创建） */
    public ensureExists(): void {
        if (!this.exists()) {
            this.createDefault();
        }
    }

    /**
     * 创建默认的 .wcignore 文件
     */
    public createDefault(): void {
        const defaultRules = COMMON_WCIGNORE_RULES.filter(rule => 
            rule.category === 'project' || rule.pattern === '.vscode/'
        ).map(rule => ({ ...rule, enabled: true }));
        
        this.batchUpdateRules(defaultRules);
    }

    /**
     * 添加/移除自定义规则的便捷方法
     */
    public addCustomRule(pattern: string): void {
    const p = (pattern || '').trim();
    if (!p) { return; }
        this.ensureLine(p);
    }
    public removeCustomRule(pattern: string): void {
    const p = (pattern || '').trim();
    if (!p) { return; }
        this.removeLine(p);
    }
}
