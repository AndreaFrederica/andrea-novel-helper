import * as fs from 'fs';
import * as path from 'path';

/**
 * GitIgnore 解析器，用于检查文件/目录是否应该被忽略
 */
export class GitIgnoreParser {
    private patterns: string[] = [];
    protected workspaceRoot: string;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.loadGitIgnore();
    }

    /**
     * 加载 .gitignore 文件
     */
    private loadGitIgnore() {
        const gitignorePath = path.join(this.workspaceRoot, '.gitignore');
        this.loadIgnoreFile(gitignorePath);
    }

    /**
     * 通用的忽略文件加载方法
     */
    protected loadIgnoreFile(filePath: string) {
        try {
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf8');
                this.patterns = content
                    .split('\n')
                    .map(line => line.trim())
                    .filter(line => line && !line.startsWith('#'))
                    .map(line => this.normalizePattern(line));
            }
        } catch (error) {
            console.warn(`Failed to load ignore file ${filePath}:`, error);
        }
    }

    /**
     * 标准化 gitignore 模式
     */
    private normalizePattern(pattern: string): string {
        // 移除开头的 ./
        if (pattern.startsWith('./')) {
            pattern = pattern.slice(2);
        }
        
        // 如果以 / 开头，表示从根目录开始匹配
        if (pattern.startsWith('/')) {
            pattern = pattern.slice(1);
        }
        
        return pattern;
    }

    /**
     * 检查文件或目录是否应该被忽略
     */
    public shouldIgnore(filePath: string): boolean {
        const relativePath = path.relative(this.workspaceRoot, filePath);
        const normalizedPath = relativePath.split(path.sep).join('/');
        for (const pattern of this.patterns) {
            if (this.matchPattern(normalizedPath, pattern)) {
                // debug: 仅在配置开启时记录
                if (process.env.ANH_WC_DEBUG === '1') {
                    console.log('[Ignore][match]', pattern, '->', normalizedPath);
                }
                return true;
            }
        }
        return false;
    }

    /**
     * 检查路径是否匹配 gitignore 模式
     */
    private matchPattern(filePath: string, pattern: string): boolean {
        // 处理目录模式（以 / 结尾）
        if (pattern.endsWith('/')) {
            const dirPattern = pattern.slice(0, -1);
            return this.matchGlob(filePath, dirPattern) || 
                   filePath.split('/').some(segment => this.matchGlob(segment, dirPattern));
        }
        
        // 处理通配符模式
        if (pattern.includes('*') || pattern.includes('?')) {
            return this.matchGlob(filePath, pattern) ||
                   filePath.split('/').some(segment => this.matchGlob(segment, pattern));
        }
        
        // 精确匹配或路径包含匹配
        return filePath === pattern || 
               filePath.startsWith(pattern + '/') ||
               filePath.split('/').includes(pattern);
    }

    /**
     * 简单的通配符匹配实现
     */
    private matchGlob(text: string, pattern: string): boolean {
        // 转换通配符为正则表达式
        const regexPattern = pattern
            .replace(/\./g, '\\.')
            .replace(/\*/g, '.*')
            .replace(/\?/g, '.');
        
        const regex = new RegExp(`^${regexPattern}$`);
        return regex.test(text);
    }
}

/**
 * 字数统计忽略解析器，继承 GitIgnoreParser 但使用 .wcignore 文件
 */
export class WordCountIgnoreParser extends GitIgnoreParser {
    constructor(workspaceRoot: string) {
        super(workspaceRoot);
        // 重新加载，使用 .wcignore 文件
        this.loadWordCountIgnore();
    }

    /**
     * 加载 .wcignore 文件
     */
    private loadWordCountIgnore() {
        const wcignorePath = path.join(this.workspaceRoot, '.wcignore');
        this.loadIgnoreFile(wcignorePath);
    }
}

/**
 * 组合忽略解析器，同时检查 .gitignore 和 .wcignore
 */
export class CombinedIgnoreParser {
    private gitIgnoreParser: GitIgnoreParser;
    private wcIgnoreParser: WordCountIgnoreParser;

    constructor(workspaceRoot: string) {
        this.gitIgnoreParser = new GitIgnoreParser(workspaceRoot);
        this.wcIgnoreParser = new WordCountIgnoreParser(workspaceRoot);
    }

    /**
     * 检查文件是否应该被忽略（git 或字数统计）
     */
    public shouldIgnore(filePath: string): boolean {
        return this.gitIgnoreParser.shouldIgnore(filePath) || 
               this.wcIgnoreParser.shouldIgnore(filePath);
    }

    /**
     * 只检查 gitignore 规则
     */
    public shouldIgnoreByGit(filePath: string): boolean {
        return this.gitIgnoreParser.shouldIgnore(filePath);
    }

    /**
     * 只检查 wcignore 规则
     */
    public shouldIgnoreByWordCount(filePath: string): boolean {
        return this.wcIgnoreParser.shouldIgnore(filePath);
    }
}
