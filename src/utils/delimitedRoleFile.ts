import type { Role } from '../extension';
import { isLookupKeyFamily, splitLookupValues, uniqueRoleKeys } from './roleLookupKeys';

const DELIMITER_CANDIDATES = ['\t', ',', ';'] as const;

const RESERVED_HEADER_ALIASES: Record<string, string> = {
    name: 'name',
    名称: 'name',
    角色: 'name',
    人物: 'name',
    词条: 'name',
    description: 'description',
    desc: 'description',
    描述: 'description',
    简介: 'description',
    type: 'type',
    类型: 'type',
    uuid: 'uuid',
    id: 'uuid',
    aliases: 'aliases',
    alias: 'aliases',
    别名: 'aliases',
    别称: 'aliases',
    fixes: 'fixes',
    fix: 'fixes',
    replacement: 'fixes',
    replacements: 'fixes',
    修复: 'fixes',
    替换: 'fixes',
    替代: 'fixes',
    affiliation: 'affiliation',
    从属: 'affiliation',
    阵营: 'affiliation',
    势力: 'affiliation',
    color: 'color',
    颜色: 'color',
    priority: 'priority',
    优先级: 'priority',
    regex: 'regex',
    pattern: 'regex',
    patterns: 'regex',
    正则: 'regex',
    正则表达式: 'regex',
    regexflags: 'regexFlags',
    flags: 'regexFlags',
    flag: 'regexFlags',
    正则标志: 'regexFlags',
    匹配标志: 'regexFlags',
    wordsegmentfilter: 'wordSegmentFilter',
    segmentfilter: 'wordSegmentFilter',
    分词过滤: 'wordSegmentFilter',
    分词筛选: 'wordSegmentFilter',
    gender: 'gender',
    性别: 'gender',
    origin: 'origin',
    来源: 'origin',
};

const BOOLEAN_FIELDS = new Set(['wordSegmentFilter']);
const NUMBER_FIELDS = new Set(['priority']);
const LIST_FIELDS = new Set(['aliases', 'fixes']);

export const DEFAULT_ROLE_DELIMITED_HEADERS = [
    'name',
    'description',
    'aliases',
    'lookupKeys',
    'lookupKeys_pinyin',
    'lookupKeys_romanized',
] as const;

export interface DelimitedRoleFileFormat {
    delimiter: string;
    hasHeader: boolean;
    headers: string[];
}

export interface ParsedDelimitedRoleFile extends DelimitedRoleFileFormat {
    roles: Role[];
}

function normalizeHeaderName(header: string): string {
    return header.trim().toLowerCase().replace(/[\s-_]+/g, '');
}

function canonicalHeaderName(header: string): string | undefined {
    const normalized = normalizeHeaderName(header);
    return RESERVED_HEADER_ALIASES[normalized];
}

function buildLookupFieldName(header: string, columnIndex: number): string {
    const cleaned = header
        .trim()
        .replace(/[\s/\\|:：,，;；]+/g, '_')
        .replace(/[^\p{L}\p{N}_-]+/gu, '')
        .replace(/^_+|_+$/g, '');

    return `lookupKeys_${cleaned || `column${columnIndex + 1}`}`;
}

function countDelimiterOutsideQuotes(line: string, delimiter: string): number {
    let count = 0;
    let inQuotes = false;

    for (let index = 0; index < line.length; index++) {
        const char = line[index];
        if (char === '"') {
            if (inQuotes && line[index + 1] === '"') {
                index += 1;
                continue;
            }
            inQuotes = !inQuotes;
            continue;
        }
        if (!inQuotes && char === delimiter) {
            count += 1;
        }
    }

    return count;
}

export function detectDelimitedRoleFileDelimiter(content: string): string {
    const lines = content
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .slice(0, 10);

    if (lines.length === 0) {
        return ',';
    }

    let bestDelimiter = ',';
    let bestScore = -1;

    for (const delimiter of DELIMITER_CANDIDATES) {
        const counts = lines.map(line => countDelimiterOutsideQuotes(line, delimiter)).filter(count => count > 0);
        if (!counts.length) {
            continue;
        }

        const score = counts.reduce((sum, count) => sum + count, 0);
        if (score > bestScore) {
            bestScore = score;
            bestDelimiter = delimiter;
        }
    }

    return bestDelimiter;
}

function parseDelimitedRows(content: string, delimiter: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let inQuotes = false;

    for (let index = 0; index < content.length; index++) {
        const char = content[index];

        if (inQuotes) {
            if (char === '"') {
                if (content[index + 1] === '"') {
                    cell += '"';
                    index += 1;
                } else {
                    inQuotes = false;
                }
            } else {
                cell += char;
            }
            continue;
        }

        if (char === '"') {
            inQuotes = true;
        } else if (char === delimiter) {
            row.push(cell);
            cell = '';
        } else if (char === '\n') {
            row.push(cell);
            rows.push(row);
            row = [];
            cell = '';
        } else if (char === '\r') {
            row.push(cell);
            rows.push(row);
            row = [];
            cell = '';
            if (content[index + 1] === '\n') {
                index += 1;
            }
        } else {
            cell += char;
        }
    }

    if (cell.length > 0 || row.length > 0) {
        row.push(cell);
        rows.push(row);
    }

    return rows;
}

function trimTrailingEmptyCells(row: string[]): string[] {
    const trimmed = [...row];
    while (trimmed.length > 0 && trimmed[trimmed.length - 1].trim() === '') {
        trimmed.pop();
    }
    return trimmed;
}

function isHeaderRow(rows: string[][]): boolean {
    if (rows.length === 0) {
        return false;
    }

    const firstRow = trimTrailingEmptyCells(rows[0]).map(cell => cell.trim()).filter(Boolean);
    if (firstRow.length === 0) {
        return false;
    }

    return firstRow.some(cell => Boolean(canonicalHeaderName(cell)) || isLookupKeyFamily(cell));
}

function parseBooleanCell(value: string): boolean | string {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on', '是'].includes(normalized)) {
        return true;
    }
    if (['false', '0', 'no', 'off', '否'].includes(normalized)) {
        return false;
    }
    return value.trim();
}

function assignListField(role: Role, key: string, values: string[]) {
    if (!values.length) {
        return;
    }
    const existing = splitLookupValues((role as any)[key]);
    (role as any)[key] = uniqueRoleKeys([...existing, ...values]);
}

function assignHeaderValue(role: Role, header: string, value: string, columnIndex: number) {
    const trimmedValue = value.trim();
    if (!trimmedValue) {
        return;
    }

    const canonical = canonicalHeaderName(header);
    if (canonical) {
        if (LIST_FIELDS.has(canonical)) {
            assignListField(role, canonical, splitLookupValues(trimmedValue));
            return;
        }
        if (BOOLEAN_FIELDS.has(canonical)) {
            (role as any)[canonical] = parseBooleanCell(trimmedValue);
            return;
        }
        if (NUMBER_FIELDS.has(canonical)) {
            const numericValue = Number(trimmedValue);
            (role as any)[canonical] = Number.isFinite(numericValue) ? numericValue : trimmedValue;
            return;
        }
        (role as any)[canonical] = trimmedValue;
        return;
    }

    if (isLookupKeyFamily(header)) {
        assignListField(role, header.trim(), splitLookupValues(trimmedValue));
        return;
    }

    const values = splitLookupValues(trimmedValue);
    (role as any)[header.trim()] = values.length > 1 ? values : trimmedValue;
    assignListField(role, buildLookupFieldName(header, columnIndex), values.length ? values : [trimmedValue]);
}

function escapeDelimitedCell(value: string, delimiter: string): string {
    if (value.includes('"')) {
        value = value.replace(/"/g, '""');
    }
    if (value.includes(delimiter) || value.includes('\n') || value.includes('\r') || value.includes('"')) {
        return `"${value}"`;
    }
    return value;
}

function serializeFieldValue(value: unknown): string {
    if (value === undefined || value === null) {
        return '';
    }
    if (Array.isArray(value)) {
        return uniqueRoleKeys(value.map(item => String(item ?? '').trim()).filter(Boolean)).join('; ');
    }
    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }
    if (typeof value === 'object') {
        return JSON.stringify(value);
    }
    return String(value);
}

function buildHeaderRowValue(role: Role, header: string, columnIndex: number): string {
    const canonical = canonicalHeaderName(header);
    if (canonical) {
        return serializeFieldValue((role as any)[canonical]);
    }
    if (isLookupKeyFamily(header)) {
        return serializeFieldValue((role as any)[header.trim()]);
    }

    const directValue = (role as any)[header.trim()];
    if (directValue !== undefined) {
        return serializeFieldValue(directValue);
    }
    return serializeFieldValue((role as any)[buildLookupFieldName(header, columnIndex)]);
}

export function ensureDelimitedRoleHeaders(format: DelimitedRoleFileFormat, ...headers: string[]): DelimitedRoleFileFormat {
    if (!format.hasHeader) {
        return format;
    }

    const nextHeaders = [...format.headers];
    for (const header of headers) {
        const normalized = normalizeHeaderName(header);
        if (!nextHeaders.some(existing => normalizeHeaderName(existing) === normalized)) {
            nextHeaders.push(header);
        }
    }

    return {
        ...format,
        headers: nextHeaders,
    };
}

export function parseDelimitedRoleFile(
    content: string,
    filePath: string,
    packagePath: string,
    defaultType: string,
): ParsedDelimitedRoleFile {
    const delimiter = detectDelimitedRoleFileDelimiter(content);
    const rows = parseDelimitedRows(content, delimiter)
        .map(trimTrailingEmptyCells)
        .filter(row => row.some(cell => cell.trim() !== ''));

    if (rows.length === 0) {
        return {
            roles: [],
            delimiter,
            hasHeader: false,
            headers: [],
        };
    }

    const hasHeader = isHeaderRow(rows);
    const headers = hasHeader
        ? rows[0].map((header, index) => header.trim() || `column${index + 1}`)
        : [];
    const dataRows = hasHeader ? rows.slice(1) : rows;
    const roles: Role[] = [];

    for (const row of dataRows) {
        const role: Role = {
            name: '',
            type: defaultType,
            packagePath,
            sourcePath: filePath,
        };

        if (hasHeader) {
            headers.forEach((header, index) => {
                assignHeaderValue(role, header, row[index] ?? '', index);
            });
        } else {
            role.name = (row[0] || '').trim();
            const description = (row[1] || '').trim();
            if (description) {
                role.description = description;
            }
            const lookupValues = uniqueRoleKeys(row.slice(2).flatMap(cell => splitLookupValues(cell)));
            if (lookupValues.length) {
                (role as any).lookupKeys = lookupValues;
            }
        }

        role.name = (role.name || '').trim();
        if (!role.name) {
            continue;
        }
        if (!role.type) {
            role.type = defaultType;
        }
        roles.push(role);
    }

    return {
        roles,
        delimiter,
        hasHeader,
        headers,
    };
}

export function stringifyDelimitedRoleFile(roles: Role[], format: DelimitedRoleFileFormat): string {
    const delimiter = format.delimiter || ',';
    const rows: string[][] = [];

    if (format.hasHeader) {
        const headers = format.headers.length ? format.headers : [...DEFAULT_ROLE_DELIMITED_HEADERS];
        rows.push(headers);
        for (const role of roles) {
            rows.push(headers.map((header, index) => buildHeaderRowValue(role, header, index)));
        }
    } else {
        for (const role of roles) {
            const lookupValues = splitLookupValues((role as any).lookupKeys);
            rows.push([
                serializeFieldValue(role.name),
                serializeFieldValue(role.description),
                ...lookupValues.map(value => serializeFieldValue(value)),
            ]);
        }
    }

    return rows
        .map(row => row.map(cell => escapeDelimitedCell(cell, delimiter)).join(delimiter))
        .join('\n');
}

export function isLikelyDelimitedRoleFileContent(content: string): boolean {
    const delimiter = detectDelimitedRoleFileDelimiter(content);
    const rows = parseDelimitedRows(content, delimiter)
        .map(trimTrailingEmptyCells)
        .filter(row => row.some(cell => cell.trim() !== ''));

    if (rows.length === 0) {
        return false;
    }

    if (isHeaderRow(rows)) {
        return true;
    }

    const firstRow = rows[0].map(cell => cell.trim()).filter(Boolean);
    return firstRow.length >= 2;
}