import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import JSON5 from 'json5';
import { clearProjectJson5ConfigCache } from './projectJson5Config';
import {
    PROJECT_CONFIG_MARKDOWN_FILE_NAME,
    PROJECT_KEYWORD_CONFIG_JSON5_FILE_NAME,
} from './constants';
import { LEGACY_RESOURCE_KEYWORDS } from './resourceFileNaming';
export {
    PROJECT_CONFIG_MARKDOWN_FILE_NAME,
    PROJECT_KEYWORD_CONFIG_JSON5_FILE_NAME,
};

export type ProjectKeywordConfigKey =
    | 'characterFileKeywords'
    | 'sensitiveWordsFileKeywords'
    | 'vocabularyFileKeywords'
    | 'regexFileKeywords';

export interface ProjectKeywordConfig {
    characterFileKeywords: string[];
    sensitiveWordsFileKeywords: string[];
    vocabularyFileKeywords: string[];
    regexFileKeywords: string[];
}

export interface ProjectKeywordConfigDefinition {
    key: ProjectKeywordConfigKey;
    markdownSection: string;
    markdownAliases: string[];
    settingKey: string;
    detail: string;
}

export const PROJECT_KEYWORD_CONFIG_DEFINITIONS: readonly ProjectKeywordConfigDefinition[] = [
    {
        key: 'characterFileKeywords',
        markdownSection: '角色文件关键词',
        markdownAliases: ['角色关键词', 'characterfilekeywords'],
        settingKey: 'customCharacterFileKeywords',
        detail: '附加用于识别角色文件名的关键词',
    },
    {
        key: 'sensitiveWordsFileKeywords',
        markdownSection: '敏感词文件关键词',
        markdownAliases: ['敏感词关键词', 'sensitivewordsfilekeywords'],
        settingKey: 'customSensitiveWordsFileKeywords',
        detail: '附加用于识别敏感词文件名的关键词',
    },
    {
        key: 'vocabularyFileKeywords',
        markdownSection: '词汇文件关键词',
        markdownAliases: ['术语文件关键词', 'vocabularyfilekeywords'],
        settingKey: 'customVocabularyFileKeywords',
        detail: '附加用于识别词汇文件名的关键词',
    },
    {
        key: 'regexFileKeywords',
        markdownSection: '正则文件关键词',
        markdownAliases: ['正则表达式文件关键词', 'regexfilekeywords'],
        settingKey: 'customRegexFileKeywords',
        detail: '附加用于识别正则表达式文件名的关键词',
    },
] as const;

const CONFIG_CACHE = new Map<string, ProjectKeywordConfig>();

export function createEmptyProjectKeywordConfig(): ProjectKeywordConfig {
    return {
        characterFileKeywords: [],
        sensitiveWordsFileKeywords: [],
        vocabularyFileKeywords: [],
        regexFileKeywords: [],
    };
}

export function normalizeKeywordList(value: unknown): string[] {
    if (Array.isArray(value)) {
        return Array.from(new Set(value.flatMap(item => normalizeKeywordList(item))));
    }

    if (typeof value !== 'string') {
        return [];
    }

    return Array.from(new Set(
        value
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('//'))
            .flatMap(line => line.split(/[,，;；、\t]+/))
            .map(item => item.trim())
            .filter(Boolean)
    ));
}

export function mergeProjectKeywordConfigs(...configs: Array<Partial<ProjectKeywordConfig> | undefined>): ProjectKeywordConfig {
    const merged = createEmptyProjectKeywordConfig();

    for (const config of configs) {
        if (!config) {
            continue;
        }

        for (const definition of PROJECT_KEYWORD_CONFIG_DEFINITIONS) {
            const values = config[definition.key];
            if (!values || values.length === 0) {
                continue;
            }
            merged[definition.key] = Array.from(new Set([...merged[definition.key], ...values]));
        }
    }

    return merged;
}

export function isProjectKeywordConfigFile(filePath: string): boolean {
    const baseName = path.basename(filePath).toLowerCase();
    return baseName === PROJECT_CONFIG_MARKDOWN_FILE_NAME || baseName === PROJECT_KEYWORD_CONFIG_JSON5_FILE_NAME;
}

export function clearProjectKeywordConfigCache(workspaceRootOrPath?: string): void {
    const workspaceRoot = resolveWorkspaceRoot(workspaceRootOrPath);
    if (!workspaceRoot) {
        CONFIG_CACHE.clear();
        return;
    }
    CONFIG_CACHE.delete(getCacheKey(workspaceRoot));
}

export function clearAllProjectConfigCaches(workspaceRootOrPath?: string): void {
    clearProjectKeywordConfigCache(workspaceRootOrPath);
    clearProjectJson5ConfigCache(workspaceRootOrPath);
}

export function getProjectKeywordConfig(workspaceRootOrFilePath?: string): ProjectKeywordConfig {
    const workspaceRoot = resolveWorkspaceRoot(workspaceRootOrFilePath);
    const cacheKey = getCacheKey(workspaceRoot);
    const cached = CONFIG_CACHE.get(cacheKey);
    if (cached) {
        return cached;
    }

    const merged = mergeProjectKeywordConfigs(
        readMarkdownKeywordConfig(workspaceRoot),
        readJson5KeywordConfig(workspaceRoot),
        readVsCodeKeywordConfig(workspaceRoot)
    );

    CONFIG_CACHE.set(cacheKey, merged);
    return merged;
}

export function generateProjectKeywordConfigTemplate(options?: {
    rolesFile?: string;
    sensitiveWordsFile?: string;
    vocabularyFile?: string;
    regexPatternsFile?: string;
}): string {
    return [
        '{',
        '  // 项目级资源文件目标路径（相对于工作区根目录）',
        `  rolesFile: '${(options?.rolesFile || `novel-helper/${LEGACY_RESOURCE_KEYWORDS.character}.json5`).replace(/\\/g, '/')}',`,
        `  sensitiveWordsFile: '${(options?.sensitiveWordsFile || `novel-helper/${LEGACY_RESOURCE_KEYWORDS.sensitive}.json5`).replace(/\\/g, '/')}',`,
        `  vocabularyFile: '${(options?.vocabularyFile || `novel-helper/${LEGACY_RESOURCE_KEYWORDS.vocabulary}.json5`).replace(/\\/g, '/')}',`,
        `  regexPatternsFile: '${(options?.regexPatternsFile || 'novel-helper/regex-patterns.json5').replace(/\\/g, '/')}',`,
        '',
        '  // 新建角色时默认补齐的索引键字段（在全局默认基础上扩充，可写后缀或完整字段名）',
        '  defaultRoleLookupKeys: [',
        "    // '日文',",
        "    // '英文',",
        "    // 'lookupKeys_kana',",
        '  ],',
        '',
        '  // 扩展索引键家族前缀（使系统将这些前缀开头的字段也识别为索引键）',
        '  extendedLookupKeyPrefixes: [',
        "    // 'refkeys',",
        "    // 'tagkeys',",
        '  ],',
        '',
        '  // 附加的角色文件名关键词',
        '  characterFileKeywords: [',
        "    // 'cast',",
        "    // '人物设定',",
        '  ],',
        '',
        '  // 附加的敏感词文件名关键词',
        '  sensitiveWordsFileKeywords: [',
        "    // 'banlist',",
        "    // '禁用词',",
        '  ],',
        '',
        '  // 附加的词汇文件名关键词',
        '  vocabularyFileKeywords: [',
        "    // 'glossary',",
        "    // '术语表',",
        '  ],',
        '',
        '  // 附加的正则文件名关键词',
        '  regexFileKeywords: [',
        "    // 'pattern-bank',",
        "    // '着色规则',",
        '  ],',
        '}',
    ].join('\n');
}

function getCacheKey(workspaceRoot?: string): string {
    if (!workspaceRoot) {
        return '__default__';
    }
    return process.platform === 'win32' ? workspaceRoot.toLowerCase() : workspaceRoot;
}

function resolveWorkspaceRoot(workspaceRootOrFilePath?: string): string | undefined {
    if (workspaceRootOrFilePath) {
        const directMatch = vscode.workspace.workspaceFolders?.find(folder => {
            const folderPath = folder.uri.fsPath;
            return isSamePath(folderPath, workspaceRootOrFilePath) || isChildPath(folderPath, workspaceRootOrFilePath);
        });
        if (directMatch) {
            return directMatch.uri.fsPath;
        }
    }

    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function isSamePath(left: string, right: string): boolean {
    const normalizedLeft = path.resolve(left);
    const normalizedRight = path.resolve(right);
    if (process.platform === 'win32') {
        return normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
    }
    return normalizedLeft === normalizedRight;
}

function isChildPath(parentPath: string, childOrSamePath: string): boolean {
    const resolvedParent = path.resolve(parentPath);
    const resolvedChild = path.resolve(childOrSamePath);
    const normalizedParent = process.platform === 'win32' ? resolvedParent.toLowerCase() : resolvedParent;
    const normalizedChild = process.platform === 'win32' ? resolvedChild.toLowerCase() : resolvedChild;

    return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}${path.sep}`);
}

function readMarkdownKeywordConfig(workspaceRoot?: string): Partial<ProjectKeywordConfig> | undefined {
    if (!workspaceRoot) {
        return undefined;
    }

    const configPath = path.join(workspaceRoot, PROJECT_CONFIG_MARKDOWN_FILE_NAME);
    if (!fs.existsSync(configPath)) {
        return undefined;
    }

    try {
        const content = fs.readFileSync(configPath, 'utf8');
        const sections = extractMarkdownSections(content);
        const config = createEmptyProjectKeywordConfig();

        for (const definition of PROJECT_KEYWORD_CONFIG_DEFINITIONS) {
            const sectionNames = [definition.markdownSection, ...definition.markdownAliases];
            const matchedSectionName = sectionNames.find(name => sections.has(name));
            if (!matchedSectionName) {
                continue;
            }
            config[definition.key] = normalizeKeywordList(sections.get(matchedSectionName));
        }

        return config;
    } catch {
        return undefined;
    }
}

function readJson5KeywordConfig(workspaceRoot?: string): Partial<ProjectKeywordConfig> | undefined {
    if (!workspaceRoot) {
        return undefined;
    }

    const configPath = path.join(workspaceRoot, PROJECT_KEYWORD_CONFIG_JSON5_FILE_NAME);
    if (!fs.existsSync(configPath)) {
        return undefined;
    }

    try {
        const parsed = JSON5.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return undefined;
        }

        const config = createEmptyProjectKeywordConfig();
        for (const definition of PROJECT_KEYWORD_CONFIG_DEFINITIONS) {
            config[definition.key] = normalizeKeywordList(parsed[definition.key]);
        }
        return config;
    } catch {
        return undefined;
    }
}

function readVsCodeKeywordConfig(workspaceRoot?: string): Partial<ProjectKeywordConfig> {
    const resource = workspaceRoot ? vscode.Uri.file(workspaceRoot) : undefined;
    const settings = vscode.workspace.getConfiguration('AndreaNovelHelper', resource);
    const config = createEmptyProjectKeywordConfig();

    for (const definition of PROJECT_KEYWORD_CONFIG_DEFINITIONS) {
        config[definition.key] = normalizeKeywordList(settings.get(definition.settingKey));
    }

    return config;
}

function extractMarkdownSections(content: string): Map<string, string> {
    const sections = new Map<string, string>();
    const lines = content.split(/\r?\n/);
    let currentSection = '';
    let buffer: string[] = [];

    const flush = () => {
        if (!currentSection) {
            return;
        }
        sections.set(currentSection, buffer.join('\n').trim());
    };

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('## ')) {
            flush();
            currentSection = trimmed.slice(3).trim();
            buffer = [];
            continue;
        }

        if (currentSection) {
            buffer.push(line);
        }
    }

    flush();
    return sections;
}