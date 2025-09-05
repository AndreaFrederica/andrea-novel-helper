import * as fs from 'fs';
import * as path from 'path';
import ignore, { Ignore } from 'ignore';

/**
 * GitIgnore 解析器，用于检查文件/目录是否应该被忽略
 */
export class GitIgnoreParser {
    protected workspaceRoot: string;
    protected ig: Ignore;

    constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.ig = ignore();
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
                // 对于 .gitignore：直接交给 ignore 库处理完整内容（不支持行内注释，符合 Git 标准）
                // 对于 .wcignore：先解析每一行以支持行内注释，然后传递清理后的内容
                if (filePath.endsWith('.wcignore')) {
                    const lines = content.split(/\r?\n/);
                    const cleanedLines: string[] = [];
                    for (const line of lines) {
                        const parsed = this.parseLineToPattern(line);
                        if (parsed !== null) {
                            cleanedLines.push(parsed);
                        } else if (line.trim() === '' || line.trim().startsWith('#')) {
                            // 保留空行和整行注释
                            cleanedLines.push(line);
                        }
                    }
                    this.ig.add(cleanedLines.join('\n'));
                } else {
                    // .gitignore 和其他文件：直接使用原始内容
                    this.ig.add(content);
                }
            }
        } catch (error) {
            console.warn(`Failed to load ignore file ${filePath}:`, error);
        }
    }

    /**
     * 解析一行忽略规则（仅用于 .wcignore，支持行内注释、转义和引号）：
     * - 支持以 # 开头的整行注释（允许前导空白）
     * - 支持行内注释：遇到未转义的 # 视为注释起始，后续内容忽略
     * - 支持双引号和单引号路径
     * - 允许使用 \\# 表示字面量 #，以及 \\ 空格表示字面量空格
     * - 返回去除注释并去除首尾空白后的模式；空行返回 null
     */
    private parseLineToPattern(rawLine: string): string | null {
        if (rawLine === null || rawLine === undefined) { return null; }
        // 去除结尾的 \r
        let line = rawLine.replace(/\r$/, '');
        // 忽略前导空白后的整行注释
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
                break; // 行内注释开始
            }
            
            out += ch;
        }

        const pattern = out.trim();
        if (!pattern) { return null; }
        return pattern;
    }

    /**
     * 标准化 gitignore 模式
     */
    private normalizePattern(pattern: string): string { return pattern; }

    /**
     * 检查文件或目录是否应该被忽略
     */
    public shouldIgnore(filePath: string): boolean {
        const relativePath = path.relative(this.workspaceRoot, filePath).split(path.sep).join('/');
        
        // 首先检查原始路径
        let ignored = this.ig.ignores(relativePath);
        
        // 如果原始路径未被忽略，且路径不以 / 结尾，则尝试添加 / 再检查
        // 这是因为目录规则（如 .vscode/）可能需要路径以 / 结尾才能匹配
        if (!ignored && !relativePath.endsWith('/')) {
            ignored = this.ig.ignores(relativePath + '/');
        }
        
        if (ignored && process.env.ANH_WC_DEBUG === '1') {
            console.log('[Ignore][match]', relativePath);
        }
        return ignored;
    }

    /**
     * 检查路径是否匹配 gitignore 模式
     */
    private matchPattern(_filePath: string, _pattern: string): boolean { return false; }

    /**
     * 简单的通配符匹配实现
     */
    private matchGlob(_text: string, _pattern: string): boolean { return false; }
}

/**
 * 字数统计忽略解析器，继承 GitIgnoreParser 但使用 .wcignore 文件
 */
export class WordCountIgnoreParser extends GitIgnoreParser {
    constructor(workspaceRoot: string) {
    super(workspaceRoot);
    // 仅使用 .wcignore：重置并加载
    this.ig = ignore();
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
