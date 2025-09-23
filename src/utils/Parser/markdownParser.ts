/**
 * Markdown 文件解析器
 * 支持角色表、敏感词表、词汇表的 Markdown 格式解析
 */

import { Role } from '../../extension';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * 字段的中文别名映射
 */
export const FIELD_ALIASES: { [key: string]: string } = {
    // 基础字段
    'name': '名称',
    'description': '描述',
    'type': '类型',
    'uuid': 'UUID',
    'color': '颜色',
    'affiliation': '从属',
    'alias': '别名',
    'aliases': '别名',
    
    // 扩展字段
    'age': '年龄',
    'gender': '性别',
    'occupation': '职业',
    'personality': '性格',
    'appearance': '外貌',
    'background': '背景',
    'relationship': '关系',
    'relationships': '关系',
    'skill': '技能',
    'skills': '技能',
    'weakness': '弱点',
    'weaknesses': '弱点',
    'goal': '目标',
    'goals': '目标',
    'motivation': '动机',
    'fear': '恐惧',
    'fears': '恐惧',
    'secret': '秘密',
    'secrets': '秘密',
    'quote': '台词',
    'quotes': '台词',
    'note': '备注',
    'notes': '备注',
    'tag': '标签',
    'tags': '标签',
    'category': '分类',
    'level': '等级',
    'status': '状态',
    'location': '位置',
    'origin': '出身',
    'family': '家庭',
    'education': '教育',
    'hobby': '爱好',
    'hobbies': '爱好',
    // 敏感词修复候选（标准字段：fixes；兼容旧 fixs）
    'fixes': '修复',
    'fixs': '修复',
    'fix': '修复',
    'replacements': '修复',
    'replacement': '修复'
};

/**
 * 根据中文别名或英文原名获取标准字段名
 */
function getStandardFieldName(fieldName: string): string {
    const normalizedField = fieldName.toLowerCase().trim();
    
    // 如果是英文原名，直接返回
    if (Object.keys(FIELD_ALIASES).includes(normalizedField)) {
        return normalizedField;
    }
    
    // 查找中文别名对应的英文原名
    for (const [english, chinese] of Object.entries(FIELD_ALIASES)) {
        if (chinese === fieldName.trim()) {
            return english;
        }
    }
    
    // 如果没找到别名，返回原字段名（转小写）
    return normalizedField;
}

/**
 * 解析 Markdown 内容为角色数组
 */
export function parseMarkdownRoles(content: string, filePath: string, packagePath: string, defaultType: string): Role[] {
    const roles: Role[] = [];
    // 不再强制追加额外空行；直接按原始内容行遍历，末尾通过循环后统一 flush。
    const lines = content.split(/\r?\n/);
    
    let currentRole: Partial<Role> | null = null;
    let currentField = '';
    let currentContent: string[] = [];
    let roleHeaderLevel = 0; // 记录角色标题的级别
    let isInRole = false; // 标记是否在角色定义中
    let roleDirectContent: string[] = []; // 角色下面的直接内容（不属于任何字段）
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();
        
        // 跳过空行
        if (!trimmedLine) {
            if (currentContent.length > 0) {
                currentContent.push('');
            } else if (isInRole && roleDirectContent.length > 0) {
                roleDirectContent.push('');
            }
            continue;
        }
        
        // 检测标题级别
        const headerMatch = trimmedLine.match(/^(#+)\s+(.+)$/);
        if (headerMatch) {
            const headerLevel = headerMatch[1].length;
            const headerText = headerMatch[2].trim();
            
            // 检查是否有下一个可能的字段标题（子标题）
            const hasSubHeaders = lines.slice(i + 1).some(nextLine => {
                const nextHeaderMatch = nextLine.trim().match(/^(#+)\s+(.+)$/);
                return nextHeaderMatch && nextHeaderMatch[1].length > headerLevel;
            });
            
            // 如果这是比当前角色标题级别低或相等的标题，可能是新角色
            if (!isInRole || headerLevel <= roleHeaderLevel) {
                // 保存当前角色
                if (currentRole && currentRole.name) {
                    saveCurrentField(currentRole, currentField, currentContent, filePath);
                    // 保存角色的直接内容到描述字段（如果没有描述字段的话）
                    saveRoleDirectContent(currentRole, roleDirectContent, filePath);
                    finalizeRole(currentRole, roles, filePath, packagePath, defaultType);
                }
                
                // 检查是否是直接字段标题（即下一级标题是已知字段）
                const hasDirectFieldHeaders = lines.slice(i + 1).some(nextLine => {
                    const nextHeaderMatch = nextLine.trim().match(/^(#+)\s+(.+)$/);
                    if (nextHeaderMatch && nextHeaderMatch[1].length === headerLevel + 1) {
                        const nextHeaderText = nextHeaderMatch[2].trim();
                        const standardFieldName = getStandardFieldName(nextHeaderText);
                        // 检查是否是已知的基础字段或扩展字段
                        return Object.keys(FIELD_ALIASES).includes(standardFieldName) || 
                               Object.values(FIELD_ALIASES).includes(nextHeaderText.trim());
                    }
                    return false;
                });
                
                // 判断是否是角色标题：有子标题且其中包含任何已知的字段标题
                if (hasSubHeaders && hasDirectFieldHeaders) {
                    // 开始新角色
                    currentRole = { name: headerText };
                    roleHeaderLevel = headerLevel;
                    currentField = '';
                    currentContent = [];
                    roleDirectContent = [];
                    isInRole = true;
                    continue;
                } else if (hasSubHeaders) {
                    // 如果有子标题但不是字段标题，跳过（可能是章节标题）
                    currentRole = null;
                    currentField = '';
                    currentContent = [];
                    roleDirectContent = [];
                    roleHeaderLevel = 0;
                    isInRole = false;
                    continue;
                } else {
                    // 没有子标题的标题，创建简单角色（只有名字）
                    const simpleRole: Role = {
                        name: headerText,
                        type: defaultType,
                        packagePath,
                        sourcePath: filePath
                    };
                    roles.push(simpleRole);
                    
                    currentRole = null;
                    currentField = '';
                    currentContent = [];
                    roleDirectContent = [];
                    roleHeaderLevel = 0;
                    isInRole = false;
                    continue;
                }
            }
            
            // 如果在角色中，且是直接子标题（字段标题）
            if (isInRole && currentRole && headerLevel === roleHeaderLevel + 1) {
                // 保存上一个字段
                saveCurrentField(currentRole, currentField, currentContent, filePath);
                
                // 开始新字段
                currentField = getStandardFieldName(headerText);
                currentContent = [];
                continue;
            }
            
            // 如果是字段内的子标题，则作为内容处理
            if (isInRole && currentRole && headerLevel > roleHeaderLevel + 1) {
                currentContent.push(line);
                continue;
            }
        }
        
        // 处理普通内容
        if (isInRole && currentRole) {
            if (currentField) {
                // 如果有当前字段，内容归属于该字段
                currentContent.push(line);
            } else {
                // 如果没有当前字段，内容归属于角色的直接内容
                roleDirectContent.push(line);
            }
        }
    }
    
    // 保存最后一个角色
    if (currentRole && currentRole.name) {
        saveCurrentField(currentRole, currentField, currentContent, filePath);
        // 保存角色的直接内容到描述字段（如果没有描述字段的话）
        saveRoleDirectContent(currentRole, roleDirectContent, filePath);
        finalizeRole(currentRole, roles, filePath, packagePath, defaultType);
    }
    
    return roles;
}

/**
 * 保存角色的直接内容（不属于任何字段的内容）到描述字段
 */
function saveRoleDirectContent(role: Partial<Role>, directContent: string[], sourcePath?: string): void {
    if (directContent.length === 0) {
        return;
    }
    
    // 处理 Markdown 内容，保留格式
    const processedContent = processMarkdownContent(directContent, sourcePath);
    
    if (!processedContent) {
        return;
    }
    
    // 如果角色已经有描述字段，将直接内容添加到描述字段前面
    if (role.description) {
        role.description = processedContent + '\n\n' + role.description;
    } else {
        // 如果没有描述字段，创建描述字段
        role.description = processedContent;
    }
}

/**
 * 保存当前字段内容到角色对象
 */
function saveCurrentField(role: Partial<Role>, fieldName: string, content: string[], sourcePath?: string): void {
    if (!fieldName || content.length === 0) {
        return;
    }
    
    // 处理 Markdown 内容，保留格式
    const processedContent = processMarkdownContent(content, sourcePath);
    
    if (!processedContent) {
        return;
    }
    
    // 根据字段类型处理内容
    switch (fieldName) {
        case 'name':
            // 名字字段去除 Markdown 格式，只保留纯文本
            role.name = stripMarkdown(processedContent);
            break;
        case 'description':
            role.description = processedContent;
            break;
        case 'type':
            role.type = stripMarkdown(processedContent);
            break;
        case 'uuid':
            role.uuid = stripMarkdown(processedContent);
            break;
        case 'color': {
            // 提取和验证颜色格式
            const colorText = stripMarkdown(processedContent);
            const extractedColor = extractColor(colorText);
            if (extractedColor) {
                role.color = extractedColor;
            }
            break;
        }
    case 'fixes':
    case 'fixs': // 兼容旧字段
    case 'fix':
    case 'replacements':
    case 'replacement': {
            // 解析修复候选：支持
            // 1) 逗号/中文逗号/顿号/分号/空格 分隔
            // 2) 换行分隔
            const raw = stripMarkdown(processedContent);
            const fixTokens = raw.split(/[，,;；\n\r\t\s·、]+/)
                .map(t => t.trim())
                .filter(t => t.length > 0);
            if (fixTokens.length > 0) {
                (role as any).fixes = Array.from(new Set(fixTokens));
            }
            break;
        }
        case 'affiliation':
            role.affiliation = stripMarkdown(processedContent);
            break;
        case 'alias':
        case 'aliases':
            // 处理别名：支持逗号分隔或换行分隔
            const aliases = stripMarkdown(processedContent)
                .split(/[,\n]/)
                .map(alias => alias.trim())
                .filter(alias => alias !== '');
            if (aliases.length > 0) {
                (role as any).aliases = aliases;
            }
            break;
        default:
            // 其他字段保留 Markdown 格式
            (role as any)[fieldName] = processedContent;
            break;
    }
}

/**
 * 将 Markdown 行中的相对路径图片转换为绝对路径
 */
function convertRelativeImagePaths(line: string, sourcePath: string): string {
    // 匹配 Markdown 图片语法：![alt](path) 或 ![alt](path "title")
    const imageRegex = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g;
    
    return line.replace(imageRegex, (match, alt, imagePath, title) => {
        // 如果已经是绝对路径或者是 URL，则不处理
        if (path.isAbsolute(imagePath) || imagePath.startsWith('http://') || imagePath.startsWith('https://') || imagePath.startsWith('data:')) {
            return match;
        }
        
        try {
            // 获取 Markdown 文件所在的目录
            const sourceDir = path.dirname(sourcePath);
            // 解析相对路径为绝对路径
            const absolutePath = path.resolve(sourceDir, imagePath);
            // 转换为 VS Code 可识别的 file:// URI
            const fileUri = vscode.Uri.file(absolutePath).toString();
            
            // 重构图片链接
            if (title) {
                return `![${alt}](${fileUri} "${title}")`;
            } else {
                return `![${alt}](${fileUri})`;
            }
        } catch (error) {
            console.warn(`Failed to convert image path: ${imagePath}`, error);
            return match; // 出错时返回原始内容
        }
    });
}

/**
 * 处理 Markdown 内容，保留格式并清理
 */
function processMarkdownContent(lines: string[], sourcePath?: string): string {
    if (lines.length === 0) {
        return '';
    }
    
    // 移除前后的空行
    let startIndex = 0;
    let endIndex = lines.length - 1;
    
    while (startIndex < lines.length && lines[startIndex].trim() === '') {
        startIndex++;
    }
    
    while (endIndex >= 0 && lines[endIndex].trim() === '') {
        endIndex--;
    }
    
    if (startIndex > endIndex) {
        return '';
    }
    
    const contentLines = lines.slice(startIndex, endIndex + 1);
    
    // 处理缩进：移除公共前导空格
    const minIndent = contentLines
        .filter(line => line.trim() !== '')
        .reduce((min, line) => {
            const match = line.match(/^(\s*)/);
            const indent = match ? match[1].length : 0;
            return Math.min(min, indent);
        }, Infinity);
    
    let processedLines = contentLines;
    if (minIndent > 0 && minIndent !== Infinity) {
        processedLines = contentLines.map(line => {
            if (line.trim() === '') {
                return '';
            }
            return line.slice(minIndent);
        });
    }
    
    // 处理图片路径：将相对路径转换为绝对路径
    if (sourcePath) {
        processedLines = processedLines.map(line => 
            convertRelativeImagePaths(line, sourcePath)
        );
    }
    
    return processedLines.join('\n');
}

/**
 * 从文本中提取颜色值
 * 支持多种颜色格式：#RGB, #RRGGBB, #RRGGBBAA, RGB(), RGBA(), HSL(), HSLA(), HSV(), HSVA() 以及带描述的颜色
 * 
 * 示例：
 * - "#ff1e40" -> "#ff1e40"
 * - "#ff1e40ff" -> "#ff1e40ff"
 * - "#ff1e40 (红色)" -> "#ff1e40"
 * - "红色 #ff1e40 很漂亮" -> "#ff1e40"
 * - "#abc" -> "#abc"
 * - "#abcd" -> "#abcd"
 * - "rgb(255, 30, 64)" -> "rgb(255, 30, 64)"
 * - "rgba(255, 30, 64, 0.8)" -> "rgba(255, 30, 64, 0.8)"
 * - "hsl(348, 100%, 56%)" -> "hsl(348, 100%, 56%)"
 * - "hsv(348, 88%, 100%)" -> "hsv(348, 88%, 100%)"
 */
function extractColor(text: string): string | null {
    if (!text) {
        return null;
    }
    
    // 支持的颜色格式（按优先级排序：先匹配更复杂的格式）
    const colorPatterns = [
        // RGB/RGBA 格式
        /rgba?\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(0?\.\d+|1(?:\.0+)?|\d+(?:\.\d+)?%?))?\s*\)/i,
        // HSL/HSLA 格式
        /hsla?\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})%?\s*,\s*(\d{1,3})%?\s*(?:,\s*(0?\.\d+|1(?:\.0+)?|\d+(?:\.\d+)?%?))?\s*\)/i,
        // HSV/HSVA 格式
        /hsva?\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})%?\s*,\s*(\d{1,3})%?\s*(?:,\s*(0?\.\d+|1(?:\.0+)?|\d+(?:\.\d+)?%?))?\s*\)/i,
        // HEX 格式
        /#[0-9A-Fa-f]{8}/, // #RRGGBBAA (8位，包含透明度)
        /#[0-9A-Fa-f]{6}/, // #RRGGBB (6位标准格式)
        /#[0-9A-Fa-f]{4}/, // #RGBA (4位，包含透明度)
        /#[0-9A-Fa-f]{3}/  // #RGB (3位短格式)
    ];
    
    // 尝试匹配各种颜色格式
    for (const pattern of colorPatterns) {
        const match = text.match(pattern);
        if (match) {
            const colorValue = match[0];
            // 验证提取的颜色值是否有效
            if (validateColorValue(colorValue)) {
                return colorValue;
            }
        }
    }
    
    // 如果没有找到颜色值，检查是否是纯颜色文本（去除所有非颜色字符后重试HEX格式）
    const cleanText = text.replace(/[^#0-9A-Fa-f]/g, '');
    if (cleanText.startsWith('#')) {
        const hexPatterns = [
            /#[0-9A-Fa-f]{8}/, // #RRGGBBAA
            /#[0-9A-Fa-f]{6}/, // #RRGGBB
            /#[0-9A-Fa-f]{4}/, // #RGBA
            /#[0-9A-Fa-f]{3}/  // #RGB
        ];
        for (const pattern of hexPatterns) {
            if (pattern.test(cleanText)) {
                return cleanText;
            }
        }
    }
    
    return null;
}

/**
 * 验证颜色值是否有效
 */
function validateColorValue(colorValue: string): boolean {
    // HEX 格式验证
    if (colorValue.startsWith('#')) {
        return /^#[0-9A-Fa-f]{3,8}$/.test(colorValue);
    }
    
    // RGB/RGBA 格式验证
    if (colorValue.toLowerCase().startsWith('rgb')) {
        const rgbMatch = colorValue.match(/rgba?\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(0?\.\d+|1(?:\.0+)?|\d+(?:\.\d+)?%?))?\s*\)/i);
        if (rgbMatch) {
            const [, r, g, b, a] = rgbMatch;
            const red = parseInt(r, 10);
            const green = parseInt(g, 10);
            const blue = parseInt(b, 10);
            
            // 检查 RGB 值是否在有效范围内 (0-255)
            if (red < 0 || red > 255 || green < 0 || green > 255 || blue < 0 || blue > 255) {
                return false;
            }
            
            // 检查透明度值是否在有效范围内 (0-1)
            if (a !== undefined) {
                const alpha = a.endsWith('%') ? parseFloat(a) / 100 : parseFloat(a);
                if (alpha < 0 || alpha > 1) {
                    return false;
                }
            }
            
            return true;
        }
        return false;
    }
    
    // HSL/HSLA 格式验证
    if (colorValue.toLowerCase().startsWith('hsl')) {
        const hslMatch = colorValue.match(/hsla?\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})%?\s*,\s*(\d{1,3})%?\s*(?:,\s*(0?\.\d+|1(?:\.0+)?|\d+(?:\.\d+)?%?))?\s*\)/i);
        if (hslMatch) {
            const [, h, s, l, a] = hslMatch;
            const hue = parseInt(h, 10);
            const saturation = parseInt(s, 10);
            const lightness = parseInt(l, 10);
            
            // 检查 HSL 值是否在有效范围内
            if (hue < 0 || hue > 360 || saturation < 0 || saturation > 100 || lightness < 0 || lightness > 100) {
                return false;
            }
            
            // 检查透明度值是否在有效范围内 (0-1)
            if (a !== undefined) {
                const alpha = a.endsWith('%') ? parseFloat(a) / 100 : parseFloat(a);
                if (alpha < 0 || alpha > 1) {
                    return false;
                }
            }
            
            return true;
        }
        return false;
    }
    
    // HSV/HSVA 格式验证
    if (colorValue.toLowerCase().startsWith('hsv')) {
        const hsvMatch = colorValue.match(/hsva?\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})%?\s*,\s*(\d{1,3})%?\s*(?:,\s*(0?\.\d+|1(?:\.0+)?|\d+(?:\.\d+)?%?))?\s*\)/i);
        if (hsvMatch) {
            const [, h, s, v, a] = hsvMatch;
            const hue = parseInt(h, 10);
            const saturation = parseInt(s, 10);
            const value = parseInt(v, 10);
            
            // 检查 HSV 值是否在有效范围内
            if (hue < 0 || hue > 360 || saturation < 0 || saturation > 100 || value < 0 || value > 100) {
                return false;
            }
            
            // 检查透明度值是否在有效范围内 (0-1)
            if (a !== undefined) {
                const alpha = a.endsWith('%') ? parseFloat(a) / 100 : parseFloat(a);
                if (alpha < 0 || alpha > 1) {
                    return false;
                }
            }
            
            return true;
        }
        return false;
    }
    
    return false;
}

/**
 * 去除 Markdown 格式，返回纯文本
 */
function stripMarkdown(text: string): string {
    return text
        // 移除标题标记
        .replace(/^#{1,6}\s+/gm, '')
        // 移除粗体和斜体
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/_([^_]+)_/g, '$1')
        // 移除代码块
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`([^`]+)`/g, '$1')
        // 移除链接
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        // 移除图片
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
        // 移除标准列表标记（Markdown 格式）
        .replace(/^[\s]*[-*+]\s+/gm, '')
        .replace(/^[\s]*\d+\.\s+/gm, '')
        // 移除 Unicode 列表符号（• ◦ ▪ ▫ ‣ ⁃ ∙ 等）
        .replace(/^[\s]*[•◦▪▫‣⁃∙▸▹▻►⋆★☆♦♧♠♣♡♢]\s*/gm, '')
        // 移除中文列表标记（一、二、三... 或 1、2、3... 或 (1) (2) 等）
        .replace(/^[\s]*[一二三四五六七八九十]+[、．]\s*/gm, '')
        .replace(/^[\s]*\d+[、．]\s*/gm, '')
        .replace(/^[\s]*[（(]\d+[）)]\s*/gm, '')
        .replace(/^[\s]*[（(][一二三四五六七八九十]+[）)]\s*/gm, '')
        // 移除引用标记
        .replace(/^>\s*/gm, '')
        // 清理多余空白
        .replace(/\n\s*\n/g, '\n')
        .trim();
}

/**
 * 完成角色对象的构建
 */
function finalizeRole(role: Partial<Role>, roles: Role[], filePath: string, packagePath: string, defaultType: string): void {
    if (!role.name) {
        return;
    }
    
    const finalRole: Role = {
        name: role.name,
        type: role.type || defaultType,
        description: role.description,
        color: role.color,
        affiliation: role.affiliation,
        packagePath,
        sourcePath: filePath,
        ...role // 包含所有其他扩展字段
    };
    
    roles.push(finalRole);
}

/**
 * 生成 Markdown 格式的角色模板
 */
// 迁移模板：改由 templates/templateGenerators 提供
export { generateMarkdownTemplate } from '../../templates/templateGenerators';

/**
 * 验证文件名是否符合要求
 */
export function validateMarkdownFileName(fileName: string, roleType: string): boolean {
    const keywords: { [key: string]: string[] } = {
        '角色': ['character', 'role', 'gallery', '角色', '人物'],
        '敏感词': ['sensitive', 'word', '敏感', '敏感词'],
        '词汇': ['vocabulary', 'vocab', 'term', '词汇', '术语']
    };
    
    const fileKeywords = keywords[roleType] || [];
    const lowerFileName = fileName.toLowerCase();
    
    return fileKeywords.some((keyword: string) => lowerFileName.includes(keyword.toLowerCase()));
}

/**
 * 生成默认文件名
 */
export function generateDefaultFileName(roleType: string): string {
    const defaultNames: { [key: string]: string } = {
        '角色': 'character-gallery',
        '敏感词': 'sensitive-words',
        '词汇': 'vocabulary'
    };
    
    return defaultNames[roleType] || 'character-gallery';
}

/**
 * 获取角色的扩展字段（除了基础字段之外的字段）
 */
export function getExtensionFields(role: Role): Array<[string, any]> {
    const baseFields = new Set(['name', 'description', 'type', 'color', 'affiliation', 'aliases', 'fixes', 'packagePath', 'sourcePath']);
    const extensionFields: Array<[string, any]> = [];
    
    for (const [key, value] of Object.entries(role)) {
        if (!baseFields.has(key) && value !== undefined && value !== null && value !== '') {
            extensionFields.push([key, value]);
        }
    }
    
    return extensionFields;
}

/**
 * 生成自定义文件名
 */
export function generateCustomFileName(customName: string, roleType: string): string {
    const keywords: { [key: string]: string } = {
        '角色': 'character',
        '敏感词': 'sensitive',
        '词汇': 'vocabulary'
    };
    
    const keyword = keywords[roleType] || 'character';
    
    // 清理自定义名称
    const cleanName = customName
        .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
    
    return `${cleanName}_${keyword}`;
}
