import type { ProjectKeywordConfig } from './projectKeywordConfig';

export type ResourceFileKeywordKind = 'character' | 'sensitive' | 'vocabulary';

export const RESOURCE_FILE_KEYWORD_SEPARATOR = '_';

export const FIXED_RESOURCE_KEYWORDS: Record<ResourceFileKeywordKind, string> = {
    character: 'role',
    sensitive: 'sensitive',
    vocabulary: 'vocab'
};

export const LEGACY_RESOURCE_KEYWORDS: Record<ResourceFileKeywordKind, string> = {
    character: 'character-gallery',
    sensitive: 'sensitive-words',
    vocabulary: 'vocabulary'
};

export const DEFAULT_PROJECT_KEYWORD_CONFIG: ProjectKeywordConfig = {
    characterFileKeywords: ['character-gallery', 'character', 'role', 'roles', '角色', '人物'],
    sensitiveWordsFileKeywords: ['sensitive-words', 'sensitive', '敏感词'],
    vocabularyFileKeywords: ['vocabulary', 'vocab', '词汇', '词庫', '词库', '术语'],
    regexFileKeywords: ['regex-patterns', 'regex', '正则', '正則', '正则表达式', '正則表達式']
};

export const CHARACTER_FILE_KEYWORDS = DEFAULT_PROJECT_KEYWORD_CONFIG.characterFileKeywords;
export const SENSITIVE_FILE_KEYWORDS = DEFAULT_PROJECT_KEYWORD_CONFIG.sensitiveWordsFileKeywords;
export const VOCABULARY_FILE_KEYWORDS = DEFAULT_PROJECT_KEYWORD_CONFIG.vocabularyFileKeywords;
export const REGEX_FILE_KEYWORDS = DEFAULT_PROJECT_KEYWORD_CONFIG.regexFileKeywords;
export const VOCABULARY_FILTER_KEYWORDS = Array.from(new Set([...VOCABULARY_FILE_KEYWORDS, 'term']));
export const CHARACTER_FILTER_KEYWORDS = Array.from(new Set([...CHARACTER_FILE_KEYWORDS, 'gallery']));

export const RESOURCE_KIND_NAME_KEYWORDS = Array.from(new Set([
    ...CHARACTER_FILE_KEYWORDS,
    ...SENSITIVE_FILE_KEYWORDS,
    ...VOCABULARY_FILE_KEYWORDS,
    ...REGEX_FILE_KEYWORDS,
    '-relationship',
    'timeline'
]));
