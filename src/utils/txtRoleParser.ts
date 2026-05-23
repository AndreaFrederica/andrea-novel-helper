import type { Role } from '../extension';
import * as path from 'path';
import JSON5 from 'json5';

/** 属性字段关键词 → 标准字段名映射 */
const FIELD_KEYWORD_MAP: Record<string, string> = {
    '称号': 'title',
    '年龄': 'age',
    '表面身份': 'surfaceIdentity',
    '真实身份': 'trueIdentity',
    '外貌': 'appearance',
    '性格': 'personality',
    '核心能力': 'coreAbilities',
    '其他技能': 'otherSkills',
    '关系': 'relationships',
    '动态': 'dynamics',
    '新增动态': 'dynamics',
    '身份': 'identity',
    '背景': 'background',
    '能力': 'abilities',
    '技能': 'skills',
    '描述': 'description',
    '类型': 'type',
    '颜色': 'color',
    '别名': 'aliases',
    '从属': 'affiliation',
    '弱点': 'weaknesses',
    '目标': 'goals',
    '备注': 'notes',
    '职业': 'occupation',
    '性别': 'gender',
    '出身': 'origin',
    '栖息地': 'habitat',
    '本体外观': 'trueFormAppearance',
    '人类外形': 'humanFormAppearance',
    '本质': 'essence',
    '性格与喜好': 'personality',
    '能力描述': 'abilityDescription',
    '状态': 'status',
    '现状': 'status',
    '目的': 'purpose',
    '新增': 'dynamics',
};

function normalizeFieldKey(raw: string): string {
    const cleaned = raw.replace(/[：:]/g, '').trim();
    return FIELD_KEYWORD_MAP[cleaned] || cleaned;
}

function isSectionHeader(line: string): boolean {
    const t = line.trim();
    return /^[一二三四五六七八九十\d]+[、．.)）]/.test(t) ||
        /^[（(][一二三四五六七八九十\d]+[）)]/.test(t) ||
        /^[#]{1,3}\s/.test(t);
}

function isMetaLine(line: string): boolean {
    const t = line.trim();
    if (!t) return true;
    if (/^[（(]本档案已更新/.test(t)) return true;
    if (/^[（(]截至/.test(t)) return true;
    if (t.startsWith('#') || t.startsWith('//')) return true;
    return false;
}

function extractField(line: string): { key: string; value: string } | null {
    const match = line.match(/^(.+?)[：:]\s*(.*)$/);
    if (!match) return null;
    const key = normalizeFieldKey(match[1]);
    const value = match[2].trim();
    return { key, value };
}

function sanitizeName(raw: string): string {
    return raw
        .replace(/["""''「」『』]/g, '')   // 去掉各种引号
        .replace(/[（(][^)）]*[)）]/g, '') // 去掉中文括号注释（新增）（未正式登场）
        .replace(/\s*[&|]\s*/g, '')       // 去掉连接符 & |
        .trim();
    // 注意：/ 保留不处理，因为 "蓝湛 / 镜" 这种需要人工判断是别名还是两个角色
}

function isLikelyName(line: string): boolean {
    const t = sanitizeName(line);
    if (t.length < 1 || t.length > 20) return false;
    if (/[：。，！？；、""''：:/\s]/.test(t)) return false;
    if (/^[（(【\[]/.test(t)) return false;
    if (isSectionHeader(t)) return false;
    if (extractField(t)) return false;
    if (/[，。！？；、]/.test(t) && t.length > 10) return false;
    return true;
}

export interface ParsedTxtRole {
    role: Role;
    rawLines: string[]; // 原始行，供预览用
}

export interface ParsedTxtSection {
    sectionTitle: string;
    roles: ParsedTxtRole[];
}

export interface ParsedTxtResult {
    fileName: string;
    sections: ParsedTxtSection[];
    totalRoles: number;
}

/** 解析一个结构化 TXT 角色档案 */
export function parseTxtRoleFile(content: string, filePath: string): ParsedTxtResult {
    const lines = content.split(/\r?\n/);
    const fileName = path.basename(filePath);
    const sections: ParsedTxtSection[] = [];
    let currentSection: ParsedTxtSection = { sectionTitle: '默认分组', roles: [] };
    let currentRole: ParsedTxtRole | null = null;
    let currentFieldKey = '';

    function flushRole() {
        if (!currentRole) return;
        // 将积累的 dynamics/relationships 文本去重并压缩
        const role = currentRole.role;
        for (const key of Object.keys(role)) {
            const val = role[key];
            if (typeof val === 'string') {
                role[key] = val.replace(/\n{3,}/g, '\n\n').trim();
            }
        }
        currentSection.roles.push(currentRole);
        currentRole = null;
        currentFieldKey = '';
    }

    function flushSection() {
        flushRole();
        if (currentSection.roles.length > 0) {
            sections.push(currentSection);
        }
        currentSection = { sectionTitle: '', roles: [] };
    }

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const line = raw.trim();
        if (!line) {
            // 空行：多行字段的段落分隔
            if (currentRole && currentFieldKey) {
                currentRole.role[currentFieldKey] = (currentRole.role[currentFieldKey] || '') + '\n';
            }
            continue;
        }

        if (isMetaLine(line)) continue;

        // 章节标题
        if (isSectionHeader(line)) {
            flushSection();
            currentSection = { sectionTitle: line, roles: [] };
            continue;
        }

        // 字段行（含冒号）
        const field = extractField(line);
        if (field) {
            // 如果是新角色名级别的字段，先 flush 旧角色
            if (!currentRole && isLikelyName(field.key)) {
                // 这可能是："李修缘" 后面跟冒号的情况不常见，先处理为字段
            }
            if (!currentRole) {
                // 没有当前角色时，字段可能是角色的第一个属性
                // 需要判断：前面一行是否是角色名
                continue;
            }

            currentFieldKey = field.key;
            const existing = currentRole.role[currentFieldKey];
            if (existing && typeof existing === 'string') {
                currentRole.role[currentFieldKey] = existing + '\n' + field.value;
            } else {
                currentRole.role[currentFieldKey] = field.value;
            }
            continue;
        }

        // 非空行、非章节标题、非字段行 → 可能是角色名或继续上文字段内容
        if (currentRole && currentFieldKey) {
            // 强名称信号（sanitizeName 处理引号/括号/连接符后判定）
            if (isLikelyName(line)) {
                flushRole();
                currentRole = {
                    role: {
                        name: sanitizeName(line),
                        type: '角色',
                        sourcePath: filePath,
                        packagePath: '',
                    },
                    rawLines: [raw],
                };
                currentFieldKey = '';
            } else {
                // 继续追加到当前字段
                currentRole.role[currentFieldKey] = (currentRole.role[currentFieldKey] || '') + '\n' + line;
            }
        } else if (isLikelyName(line)) {
            // 新角色名
            flushRole();
            currentRole = {
                role: {
                    name: sanitizeName(line),
                    type: '角色',
                    sourcePath: filePath,
                    packagePath: '',
                },
                rawLines: [raw],
            };
            currentFieldKey = '';
        } else if (currentRole) {
            // 没有当前字段时的描述文本 → 存为描述
            currentRole.role.description = (currentRole.role.description || '') + '\n' + line;
        }
    }

    flushSection();

    return {
        fileName,
        sections,
        totalRoles: sections.reduce((sum, s) => sum + s.roles.length, 0),
    };
}

/** 将 ParsedTxtResult 转换为 JSON5 字符串 */
export function toJson5(result: ParsedTxtResult): string {
    const allRoles: Role[] = [];
    for (const section of result.sections) {
        for (const pr of section.roles) {
            allRoles.push(pr.role);
        }
    }
    return serializeRolesToJson5(allRoles);
}

/** 将 ParsedTxtResult 转换为 Markdown 角色档案 */
export function toMarkdown(result: ParsedTxtResult): string {
    const parts: string[] = [];
    parts.push(`# ${result.fileName.replace(/\.txt$/i, '')}\n`);

    for (const section of result.sections) {
        if (section.sectionTitle && section.sectionTitle !== '默认分组') {
            parts.push(`## ${section.sectionTitle}\n`);
        }
        for (const pr of section.roles) {
            const r = pr.role;
            parts.push(`### ${r.name}`);
            parts.push('');

            const order = ['type', 'title', 'age', 'gender', 'occupation', 'affiliation',
                'surfaceIdentity', 'trueIdentity', 'identity', 'appearance', 'personality',
                'coreAbilities', 'otherSkills', 'abilities', 'skills', 'weaknesses',
                'relationships', 'dynamics', 'background', 'origin', 'habitat',
                'trueFormAppearance', 'humanFormAppearance', 'essence',
                'purpose', 'status', 'notes'];

            const written = new Set<string>(['name']);
            for (const key of order) {
                const val = (r as any)[key];
                if (val !== undefined && val !== '') {
                    parts.push(`#### ${key}`);
                    parts.push(String(val).trim());
                    parts.push('');
                    written.add(key);
                }
            }
            // 其他未分类字段
            for (const key of Object.keys(r)) {
                if (written.has(key) || key === 'sourcePath' || key === 'packagePath') continue;
                const val = (r as any)[key];
                if (val !== undefined && val !== '' && typeof val === 'string') {
                    parts.push(`#### ${key}`);
                    parts.push(val.trim());
                    parts.push('');
                }
            }
        }
    }
    return parts.join('\n');
}

function serializeRolesToJson5(roles: Role[]): string {
    const cleaned = roles.map(r => {
        const obj: any = { name: r.name, type: r.type || '角色' };
        if (r.description) obj.description = r.description;
        if (r.aliases?.length) obj.aliases = r.aliases;
        if (r.color) obj.color = r.color;
        if (r.affiliation) obj.affiliation = r.affiliation;

        for (const key of Object.keys(r)) {
            if (['name', 'type', 'description', 'aliases', 'color', 'affiliation',
                'sourcePath', 'packagePath', 'uuid'].includes(key)) continue;
            const val = (r as any)[key];
            if (val !== undefined && val !== '' && typeof val === 'string') {
                obj[key] = val;
            }
        }
        return obj;
    });

    return JSON5.stringify(cleaned, { space: 2, quote: '"' }) + '\n';
}
