import * as path from 'path';
import { CombinedIgnoreParser } from './Parser/gitignoreParser';

export interface IgnoreConfig {
    workspaceRoot: string;
    respectWcignore: boolean;
    respectGitignore?: boolean; // 是否遵循 .gitignore（默认 true）
    includePatterns?: string[];
    excludePatterns?: string[];
    ignoreParser?: CombinedIgnoreParser | null;
    allowedLanguages?: string[]; // 允许的语言类型（文件扩展名，无点）
    ignoreReferenceFiles?: boolean; // 是否忽略参考文件（防止生成数据库记录）
    referenceExtensions?: string[]; // 参考文件扩展名列表
}

/**
 * 判断某文件当前配置下是否会被追踪忽略（含 .git / 可选 .wcignore / 内部数据库与排除规则）
 * @param filePath 文件路径
 * @param config 忽略配置
 * @param config.allowedLanguages 允许的文件扩展名（不带点），未提供时使用默认值 ['md', 'txt', 'json', 'json5']
 * @param config.ignoreReferenceFiles 是否忽略参考文件（防止生成数据库记录），默认为 false
 */
export function isFileIgnored(filePath: string, config: IgnoreConfig): boolean {
    // 检查是否为参考文件（如果启用了忽略参考文件选项）
    if (config.ignoreReferenceFiles) {
        const ext = path.extname(filePath).slice(1).toLowerCase();
        const refExts = config.referenceExtensions || [];
        if (refExts.includes(ext)) {
            return true; // 参考文件被忽略，不生成数据库记录
        }
    }
    
    // 语言类型过滤（默认：仅允许 md, txt, json, json5）
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const allowed = getAllowedFileTypes(config.allowedLanguages);
    if (ext && !allowed.includes(ext)) {
        return true;
    }
    // ——统一始终忽略目录/文件/路径特征——
    const ALWAYS_IGNORE_DIR_NAMES = new Set([
        '.git', '.svn', '.hg', '.DS_Store', 'node_modules', '.idea', '.vscode-test'
    ]);
    const baseName = path.basename(filePath);
    const resolvedFilePath = path.resolve(filePath);
    const workspaceRoot = config.workspaceRoot;
    // 数据库、order、分片目录
    const alwaysIgnorePaths = [
        path.join(workspaceRoot, 'novel-helper', 'file-tracking.json'),
        path.join(workspaceRoot, 'novel-helper', 'wordcount-order.json'),
        path.join(workspaceRoot, 'novel-helper', '.anh-fsdb'),
        path.join(workspaceRoot, '.git'),
    ];
    for (const ignorePath of alwaysIgnorePaths) {
        const resolvedIgnore = path.resolve(ignorePath);
        if (resolvedFilePath === resolvedIgnore || resolvedFilePath.startsWith(resolvedIgnore + path.sep)) {
            return true;
        }
    }
    // 目录名直接命中
    if (ALWAYS_IGNORE_DIR_NAMES.has(baseName)) {
        return true;
    }
    // 路径特征（嵌套 node_modules/.git）
    if (filePath.includes(`${path.sep}node_modules${path.sep}`) || filePath.includes(`${path.sep}.git${path.sep}`)) {
        return true;
    }
    // 检查忽略规则
    if (config.ignoreParser) {
        const respectGit = config.respectGitignore !== false; // 默认 true
        const respectWc = !!config.respectWcignore;
        if (respectGit && respectWc) {
            if (config.ignoreParser.shouldIgnore(filePath)) { return true; } // 同时应用两者
        } else if (respectGit && !respectWc) {
            if (config.ignoreParser.shouldIgnoreByGit(filePath)) { return true; } // 仅 git
        } else if (!respectGit && respectWc) {
            if (config.ignoreParser.shouldIgnoreByWordCount(filePath)) { return true; } // 仅 wcignore
        }
        // 两者都不尊重：跳过忽略解析
    }
    // 检查包含模式
    if (config.includePatterns && config.includePatterns.length > 0) {
        const relativePath = path.relative(config.workspaceRoot, filePath);
        const isIncluded = config.includePatterns.some(pattern => 
            matchGlob(relativePath, pattern)
        );
        if (!isIncluded) {
            return true;
        }
    }
    // 检查排除模式
    if (config.excludePatterns && config.excludePatterns.length > 0) {
        const relativePath = path.relative(config.workspaceRoot, filePath);
        const isExcluded = config.excludePatterns.some(pattern => 
            matchGlob(relativePath, pattern)
        );
        if (isExcluded) {
            return true;
        }
    }
    return false;
}

const DEFAULT_ALLOWED_LANGUAGES = ['md', 'txt', 'json', 'json5'];

function getAllowedFileTypes(configAllowed?: string[]): string[] {
    return configAllowed ?? DEFAULT_ALLOWED_LANGUAGES;
}
/**
 * 简单的 glob 模式匹配
 */
export function matchGlob(filePath: string, pattern: string): boolean {
    const regexPattern = pattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return regex.test(filePath);
}
