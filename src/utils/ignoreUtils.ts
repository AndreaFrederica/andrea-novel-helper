// 监听配置变更，自动刷新缓存
if (typeof vscode !== 'undefined' && vscode.workspace && vscode.workspace.onDidChangeConfiguration) {
    vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('AndreaNovelHelper.supportedFileTypes')) {
            cachedAllowedFileTypes = undefined;
            lastConfigReadTime = 0;
        }
    });
}
import * as path from 'path';
import * as vscode from 'vscode';
import { CombinedIgnoreParser } from './Parser/gitignoreParser';

export interface IgnoreConfig {
    workspaceRoot: string;
    respectWcignore: boolean;
    includePatterns?: string[];
    excludePatterns?: string[];
    ignoreParser?: CombinedIgnoreParser | null;
    allowedLanguages?: string[]; // 允许的语言类型（文件扩展名，无点）
}

/**
 * 判断某文件当前配置下是否会被追踪忽略（含 .git / 可选 .wcignore / 内部数据库与排除规则）
 */
export function isFileIgnored(filePath: string, config: IgnoreConfig): boolean {
    // 语言类型过滤（默认）
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
        if (config.respectWcignore) {
            if (config.ignoreParser.shouldIgnore(filePath)) {
                return true;
            }
        } else {
            if (config.ignoreParser.shouldIgnoreByGit(filePath)) {
                return true;
            }
        }
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

    // 缓存 VSCode 配置项 supportedFileTypes，避免频繁读取
    const DEFAULT_ALLOWED_LANGUAGES = ['md', 'txt', 'json', 'json5'];
    let cachedAllowedFileTypes: string[] | undefined;
    let lastConfigReadTime = 0;
    const CONFIG_CACHE_TTL = 10000; // 10秒缓存，可根据实际调整

    function getAllowedFileTypes(configAllowed?: string[]): string[] {
        if (configAllowed) {
            return configAllowed;
        }
        const now = Date.now();
        if (!cachedAllowedFileTypes || now - lastConfigReadTime > CONFIG_CACHE_TTL) {
            try {
                const conf = vscode.workspace.getConfiguration('AndreaNovelHelper');
                cachedAllowedFileTypes = conf.get<string[]>('supportedFileTypes') ?? undefined;
                lastConfigReadTime = now;
            } catch (e) {
                cachedAllowedFileTypes = undefined;
            }
        }
        return cachedAllowedFileTypes ?? DEFAULT_ALLOWED_LANGUAGES;
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
