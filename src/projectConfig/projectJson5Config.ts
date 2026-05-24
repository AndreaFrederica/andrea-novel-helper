import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import JSON5 from 'json5';
import { isLookupKeyFamily, setExtendedLookupKeyPrefixes, uniqueRoleKeys } from '../utils/roleLookupKeys';
import { PROJECT_KEYWORD_CONFIG_JSON5_FILE_NAME } from './constants';
import { LEGACY_RESOURCE_KEYWORDS } from './resourceFileNaming';

export type ProjectLibraryTargetKey = 'rolesFile' | 'sensitiveWordsFile' | 'vocabularyFile' | 'regexPatternsFile';

export interface ProjectJson5Config {
    rolesFile?: string;
    sensitiveWordsFile?: string;
    vocabularyFile?: string;
    regexPatternsFile?: string;
    defaultRoleLookupKeys: string[];
    extendedLookupKeyPrefixes?: string[];
}

export interface ProjectJson5ExtraFieldDefinition {
    key: keyof ProjectJson5Config;
    detail: string;
    valueType: 'string' | 'stringArray';
    snippet: string;
}

export const PROJECT_LIBRARY_TARGET_DEFAULTS: Record<ProjectLibraryTargetKey, string> = {
    rolesFile: `novel-helper/${LEGACY_RESOURCE_KEYWORDS.character}.json5`,
    sensitiveWordsFile: `novel-helper/${LEGACY_RESOURCE_KEYWORDS.sensitive}.json5`,
    vocabularyFile: `novel-helper/${LEGACY_RESOURCE_KEYWORDS.vocabulary}.json5`,
    regexPatternsFile: 'novel-helper/regex-patterns.json5',
};

export const PROJECT_JSON5_EXTRA_FIELD_DEFINITIONS: readonly ProjectJson5ExtraFieldDefinition[] = [
    {
        key: 'rolesFile',
        detail: '项目级角色库文件路径。优先于 VS Code 设置中的 AndreaNovelHelper.rolesFile。',
        valueType: 'string',
        snippet: "rolesFile: '$1',",
    },
    {
        key: 'sensitiveWordsFile',
        detail: '项目级敏感词文件路径。优先于 VS Code 设置中的 AndreaNovelHelper.sensitiveWordsFile。',
        valueType: 'string',
        snippet: "sensitiveWordsFile: '$1',",
    },
    {
        key: 'vocabularyFile',
        detail: '项目级词汇文件路径。优先于 VS Code 设置中的 AndreaNovelHelper.vocabularyFile。',
        valueType: 'string',
        snippet: "vocabularyFile: '$1',",
    },
    {
        key: 'regexPatternsFile',
        detail: '项目级正则模式文件路径。优先于 VS Code 设置中的 AndreaNovelHelper.regexPatternsFile。',
        valueType: 'string',
        snippet: "regexPatternsFile: '$1',",
    },
    {
        key: 'defaultRoleLookupKeys',
        detail: '新建角色时默认补齐的索引键字段。可填写后缀（如 日文）或完整键名（如 lookupKeys_jp）。',
        valueType: 'stringArray',
        snippet: "defaultRoleLookupKeys: [\n  '$1'\n],",
    },
    {
        key: 'extendedLookupKeyPrefixes',
        detail: '扩展角色索引键家族的前缀列表。例如 refkeys、tagkeys，使系统将这些前缀开头的字段也识别为索引键。',
        valueType: 'stringArray',
        snippet: "extendedLookupKeyPrefixes: [\n  '$1'\n],",
    },
] as const;

const CACHE = new Map<string, ProjectJson5Config>();

export function createEmptyProjectJson5Config(): ProjectJson5Config {
    return {
        defaultRoleLookupKeys: [],
    };
}

export function clearProjectJson5ConfigCache(workspaceRootOrPath?: string): void {
    const workspaceRoot = resolveWorkspaceRoot(workspaceRootOrPath);
    if (!workspaceRoot) {
        CACHE.clear();
        setExtendedLookupKeyPrefixes([]);
        return;
    }
    CACHE.delete(getCacheKey(workspaceRoot));
}

export function getProjectJson5Config(workspaceRootOrFilePath?: string): ProjectJson5Config {
    const workspaceRoot = resolveWorkspaceRoot(workspaceRootOrFilePath);
    const cacheKey = getCacheKey(workspaceRoot);
    const cached = CACHE.get(cacheKey);
    if (cached) {
        setExtendedLookupKeyPrefixes(cached.extendedLookupKeyPrefixes ?? []);
        return cached;
    }

    const config = createEmptyProjectJson5Config();
    if (workspaceRoot) {
        const configPath = path.join(workspaceRoot, PROJECT_KEYWORD_CONFIG_JSON5_FILE_NAME);
        if (fs.existsSync(configPath)) {
            try {
                const parsed = JSON5.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    config.rolesFile = normalizeRelativePathSetting(parsed.rolesFile);
                    config.sensitiveWordsFile = normalizeRelativePathSetting(parsed.sensitiveWordsFile);
                    config.vocabularyFile = normalizeRelativePathSetting(parsed.vocabularyFile);
                    config.regexPatternsFile = normalizeRelativePathSetting(parsed.regexPatternsFile);
                    config.defaultRoleLookupKeys = normalizeDefaultRoleLookupKeys(parsed.defaultRoleLookupKeys);
                    config.extendedLookupKeyPrefixes = normalizeExtendedPrefixes(parsed.extendedLookupKeyPrefixes);
                }
            } catch {
                // ignore invalid project-config.json5 here; linter surfaces diagnostics elsewhere
            }
        }
    }

    CACHE.set(cacheKey, config);
    setExtendedLookupKeyPrefixes(config.extendedLookupKeyPrefixes ?? []);
    return config;
}

export function getProjectLibraryTarget(key: ProjectLibraryTargetKey, workspaceRootOrFilePath?: string): string {
    const projectConfig = getProjectJson5Config(workspaceRootOrFilePath);
    const override = projectConfig[key];
    if (override) {
        return override;
    }

    const workspaceRoot = resolveWorkspaceRoot(workspaceRootOrFilePath);
    const resource = workspaceRoot ? vscode.Uri.file(workspaceRoot) : undefined;
    const settings = vscode.workspace.getConfiguration('AndreaNovelHelper', resource);
    const fromSettings = normalizeRelativePathSetting(settings.get<string>(key));
    return fromSettings || PROJECT_LIBRARY_TARGET_DEFAULTS[key];
}

/**
 * 获取合并后的默认角色索引键字段。
 * 合并顺序（优先级从高到低）：项目配置 > VS Code 设置 > 内置默认值。
 */
export function getProjectDefaultRoleLookupKeys(workspaceRootOrFilePath?: string): string[] {
    const projectConfig = getProjectJson5Config(workspaceRootOrFilePath).defaultRoleLookupKeys;

    const workspaceRoot = resolveWorkspaceRoot(workspaceRootOrFilePath);
    const resource = workspaceRoot ? vscode.Uri.file(workspaceRoot) : undefined;
    const settings = vscode.workspace.getConfiguration('AndreaNovelHelper', resource);
    const fromSettings = normalizeDefaultRoleLookupKeys(settings.get('defaultRoleLookupKeys'));

    // 项目配置在前（优先级最高），依次合并设置和内置默认值
    return uniqueRoleKeys([...projectConfig, ...fromSettings]);
}

/**
 * 为 role 对象应用项目配置的默认索引键字段。
 * @mutates role 会直接修改传入的 role 对象，为其补上空数组字段。
 */
export function applyProjectRoleLookupDefaults<T extends Record<string, unknown>>(role: T, workspaceRootOrFilePath?: string): T {
    const fields = getProjectDefaultRoleLookupKeys(workspaceRootOrFilePath);
    if (fields.length === 0) {
        return role;
    }

    const mutable = role as Record<string, unknown[]>;
    for (const field of fields) {
        if (mutable[field] !== undefined) {
            continue;
        }
        mutable[field] = [];
    }

    return role;
}

export function getLibraryPickerDefaultName(key: ProjectLibraryTargetKey, workspaceRootOrFilePath?: string): string {
    const target = getProjectLibraryTarget(key, workspaceRootOrFilePath).replace(/\\/g, '/');
    return target.startsWith('novel-helper/') ? target.slice('novel-helper/'.length) : target;
}

function normalizeRelativePathSetting(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed.replace(/\\/g, '/') : undefined;
}

function normalizeExtendedPrefixes(value: unknown): string[] {
    const rawValues = Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string')
        : typeof value === 'string'
            ? value.split(/[\r\n\t,，;；、]+/)
            : [];

    return uniqueRoleKeys(
        rawValues
            .map(entry => entry.trim().toLowerCase())
            .filter(Boolean)
    );
}

function normalizeDefaultRoleLookupKeys(value: unknown): string[] {
    const rawValues = Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string')
        : typeof value === 'string'
            ? value.split(/[\r\n\t,，;；、]+/)
            : [];

    const normalized = rawValues
        .map(entry => canonicalizeLookupKeyField(entry))
        .filter((entry): entry is string => Boolean(entry));

    return uniqueRoleKeys(normalized);
}

function canonicalizeLookupKeyField(value: string): string | undefined {
    const trimmed = value.trim();
    if (!trimmed) {
        return undefined;
    }

    const normalized = trimmed.toLowerCase();
    if (/^(lookupkeys?_)?(pinyin|拼音)$/.test(normalized)) {
        return 'lookupKeys_pinyin';
    }
    if (/^(lookupkeys?_)?(romanized|romaji|roma|罗马字|罗马拼写|罗马音|罗马)$/.test(normalized)) {
        return 'lookupKeys_romanized';
    }
    if (/^(lookupkeys?_)?(spelling|spell|拼写)$/.test(normalized)) {
        return 'lookupKeys_spelling';
    }

    if (isLookupKeyFamily(normalized)) {
        // 内置前缀：提取后缀并规范化为 lookupKeys_xxx
        const builtInMatch = /^(lookupkeys?|searchkeys?|querykeys?|indexkeys?|matchkeys?|keywords?|查询键|查询词|检索键|检索词|索引键|索引词|反查键|反查词|关键词|关键字)[\s_:\-：]*/i.exec(trimmed);
        if (builtInMatch) {
            const suffix = trimmed.slice(builtInMatch[0].length).trim();
            return suffix ? `lookupKeys_${suffix}` : undefined;
        }
        // 扩展前缀：保持原字段名（如 refkeys_author）
        return trimmed;
    }

    return `lookupKeys_${trimmed}`;
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

function getCacheKey(workspaceRoot?: string): string {
    if (!workspaceRoot) {
        return '__default__';
    }
    return process.platform === 'win32' ? workspaceRoot.toLowerCase() : workspaceRoot;
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