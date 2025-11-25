import * as fs from 'fs';
import * as path from 'path';
import JSON5 from 'json5';
import { Role } from '../extension';
import { parseMarkdownRoles } from './Parser/markdownParser';

export interface RoleFileData {
    roles: Role[];
    fileType: 'json5' | 'ojson5' | 'markdown';
}

/**
 * 读取角色文件，自动检测格式
 * @param filePath 文件路径
 * @returns 解析后的角色数据
 */
export function readRoleFile(filePath: string): RoleFileData {
    const content = fs.readFileSync(filePath, 'utf8');
    const ext = path.extname(filePath).toLowerCase();

    try {
        if (ext === '.md') {
            // Markdown 格式
            const packagePath = path.relative(
                path.join(path.dirname(filePath), '..', '..'),
                path.dirname(filePath)
            );
            const roles = parseMarkdownRoles(content, filePath, packagePath, '角色');
            return { roles, fileType: 'markdown' };
        } else if (ext === '.ojson5' || ext === '.json5') {
            // 添加空文件检查
            if (!content || content.trim() === '') {
                // 空文件，返回空数组
                return {
                    roles: [],
                    fileType: ext === '.ojson5' ? 'ojson5' : 'json5'
                };
            }

            // JSON5/OJSON5 格式
            const data = JSON5.parse(content);
            let roles: Role[] = [];

            if (Array.isArray(data)) {
                roles = data;
            } else if (typeof data === 'object' && data !== null) {
                if (data.roles && Array.isArray(data.roles)) {
                    roles = data.roles;
                } else if (data.characters && Array.isArray(data.characters)) {
                    roles = data.characters;
                } else {
                    // 将对象的每个属性作为一个角色
                    roles = Object.entries(data).map(([name, roleData]) => ({
                        name,
                        ...(typeof roleData === 'object' ? roleData : { type: '角色' }),
                    })) as Role[];
                }
            }

            return {
                roles,
                fileType: ext === '.ojson5' ? 'ojson5' : 'json5'
            };
        } else {
            throw new Error(`不支持的文件格式: ${ext}`);
        }
    } catch (error) {
        throw new Error(`解析文件失败 ${path.basename(filePath)}: ${error}`);
    }
}

/**
 * 写入角色文件，保持原有格式
 * @param filePath 文件路径
 * @param roles 角色数组
 * @param fileType 文件类型
 */
export function writeRoleFile(filePath: string, roles: Role[], fileType: 'json5' | 'ojson5' | 'markdown'): void {
    let content: string;

    switch (fileType) {
        case 'markdown':
            // 对于 Markdown 格式，智能合并到现有内容
            content = smartMergeMarkdownContent(filePath, roles);
            break;
        case 'ojson5':
        case 'json5':
            // JSON5/OJSON5 格式
            content = JSON5.stringify(roles, null, 2);
            break;
        default:
            throw new Error(`不支持的文件类型: ${fileType}`);
    }

    fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * 向角色文件添加新角色
 * @param filePath 文件路径
 * @param newRole 新角色
 * @returns 是否成功
 */
export function addRoleToFile(filePath: string, newRole: Role): boolean {
    try {
        const fileData = readRoleFile(filePath);

        // 检查是否已存在同名角色
        const existingIndex = fileData.roles.findIndex(role => role.name === newRole.name);
        if (existingIndex >= 0) {
            // 更新现有角色
            fileData.roles[existingIndex] = { ...fileData.roles[existingIndex], ...newRole };
        } else {
            // 添加新角色
            fileData.roles.push(newRole);
        }

        writeRoleFile(filePath, fileData.roles, fileData.fileType);
        return true;
    } catch (error) {
        console.error(`添加角色到文件失败 ${filePath}:`, error);

        // 如果是解析错误，尝试重新创建文件
        if ((error as Error).message.includes('解析文件失败')) {
            try {
                console.log(`尝试重新创建损坏的文件: ${filePath}`);
                writeRoleFile(filePath, [newRole], 'json5');
                return true;
            } catch (recreateError) {
                console.error(`重新创建文件失败:`, recreateError);
            }
        }

        return false;
    }
}

/**
 * 生成 Markdown 格式的角色内容
 * @param roles 角色数组
 * @returns Markdown 内容
 */
function generateMarkdownContent(roles: Role[]): string {
    if (roles.length === 0) {
        return '# 角色库\n\n暂无角色\n';
    }

    let content = '# 角色库\n\n';

    for (const role of roles) {
        content += `## ${role.name}\n\n`;

        if (role.type) {
            content += `### 类型\n${role.type}\n\n`;
        }

        if (role.description) {
            content += `### 描述\n${role.description}\n\n`;
        }

        if (role.color) {
            content += `### 颜色\n${role.color}\n\n`;
        }

        if (role.affiliation) {
            content += `### 从属\n${role.affiliation}\n\n`;
        }

        if (role.aliases && Array.isArray(role.aliases)) {
            content += `### 别名\n${role.aliases.join(', ')}\n\n`;
        }

        // 处理敏感词修复候选
        if (role.fixes && Array.isArray(role.fixes)) {
            content += `### 修复\n${role.fixes.join(', ')}\n\n`;
        }

        // 添加其他属性
        const excludedFields = new Set(['name', 'type', 'description', 'color', 'affiliation', 'aliases', 'fixes', 'packagePath', 'sourcePath', 'uuid']);
        for (const [key, value] of Object.entries(role)) {
            if (!excludedFields.has(key) && value !== undefined && value !== null && value !== '') {
                content += `### ${key}\n${value}\n\n`;
            }
        }

        content += '---\n\n';
    }

    return content;
}

/**
 * 智能合并 Markdown 内容，保留原有结构
 * @param filePath 文件路径
 * @param roles 角色数组
 * @returns 合并后的 Markdown 内容
 */
function smartMergeMarkdownContent(filePath: string, roles: Role[]): string {
    const originalContent = fs.readFileSync(filePath, 'utf8');
    const lines = originalContent.split(/\r?\n/);

    if (roles.length === 0) {
        return originalContent;
    }

    // 解析现有角色，避免重复添加
    const existingFileData = readRoleFile(filePath);
    const existingRoleNames = new Set(existingFileData.roles.map(r => r.name));

    // 过滤掉已存在的角色
    const newRoles = roles.filter(role => !existingRoleNames.has(role.name));

    if (newRoles.length === 0) {
        return originalContent; // 没有新角色需要添加
    }

    // 寻找合适的插入位置

    // 寻找最后的角色位置（支持任意层级的角色标题）
    let lastRoleIndex = -1;
    let lastRoleLevel = 0;

    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();

        // 检测标题级别
        const headerMatch = line.match(/^(#+)\s+(.+)$/);
        if (headerMatch) {
            const headerLevel = headerMatch[1].length;

            // 检查是否有子标题
            const hasSubHeaders = lines.slice(i + 1).some(nextLine => {
                const nextHeaderMatch = nextLine.trim().match(/^(#+)\s+(.+)$/);
                return nextHeaderMatch && nextHeaderMatch[1].length > headerLevel;
            });

            if (hasSubHeaders) {
                // 检查是否包含字段标题
                const hasFieldHeaders = lines.slice(i + 1).some(nextLine => {
                    const nextHeaderMatch = nextLine.trim().match(/^(#+)\s+(.+)$/);
                    if (nextHeaderMatch && nextHeaderMatch[1].length === headerLevel + 1) {
                        const nextHeaderText = nextHeaderMatch[2].trim();
                        // 检查是否是已知字段（简化的字段检测）
                        const fieldKeywords = ['描述', '类型', '颜色', '别名', '修复', '从属', 'affiliation', 'type', 'description', 'color', 'aliases', 'fixes'];
                        return fieldKeywords.some(keyword =>
                            nextHeaderText.toLowerCase().includes(keyword.toLowerCase()) ||
                            nextHeaderText.includes(keyword)
                        );
                    }
                    return false;
                });

                // 如果同时有子标题和字段标题，则认为是角色标题
                if (hasFieldHeaders) {
                    lastRoleIndex = i;
                    lastRoleLevel = headerLevel;
                    break;
                }
            }
        }
    }

    // 准备新角色内容
    let newRolesContent = '';
    for (const role of newRoles) {
        newRolesContent += generateSingleRoleMarkdown(role, lastRoleLevel > 0 ? lastRoleLevel : 2) + '\n\n---\n\n';
    }

    if (lastRoleIndex >= 0) {
        // 找到现有角色，在其后添加

        // 先找到最后一个角色的完整内容（使用相同的角色标题检测逻辑）
        let lastRoleEndIndex = lines.length;

        for (let i = lastRoleIndex + 1; i < lines.length; i++) {
            const line = lines[i].trim();

            // 检测标题级别
            const headerMatch = line.match(/^(#+)\s+(.+)$/);
            if (headerMatch) {
                const currentLevel = headerMatch[1].length;

                // 检查是否是新的角色标题
                const hasSubHeaders = lines.slice(i + 1).some(nextLine => {
                    const nextHeaderMatch = nextLine.trim().match(/^(#+)\s+(.+)$/);
                    return nextHeaderMatch && nextHeaderMatch[1].length > currentLevel;
                });

                let hasFieldHeaders = false;
                if (hasSubHeaders) {
                    // 检查是否包含字段标题
                    hasFieldHeaders = lines.slice(i + 1).some(nextLine => {
                        const nextHeaderMatch = nextLine.trim().match(/^(#+)\s+(.+)$/);
                        if (nextHeaderMatch && nextHeaderMatch[1].length === currentLevel + 1) {
                            const nextHeaderText = nextHeaderMatch[2].trim();
                            const fieldKeywords = ['描述', '类型', '颜色', '别名', '修复', '从属', 'affiliation', 'type', 'description', 'color', 'aliases', 'fixes'];
                            return fieldKeywords.some(keyword =>
                                nextHeaderText.toLowerCase().includes(keyword.toLowerCase()) ||
                                nextHeaderText.includes(keyword)
                            );
                        }
                        return false;
                    });
                }

                // 如果检测到新的角色标题，说明上一个角色结束
                if (hasSubHeaders && hasFieldHeaders && currentLevel <= lastRoleLevel) {
                    lastRoleEndIndex = i;
                    break;
                }
            }
        }

        // 在最后一个角色后插入新角色
        const insertLines = newRolesContent.trim().split(/\r?\n/);

        // 确保有适当的分隔
        if (lastRoleEndIndex < lines.length) {
            const beforeInsert = lines[lastRoleEndIndex - 1]?.trim() || '';
            if (!beforeInsert.endsWith('---')) {
                lines.splice(lastRoleEndIndex, 0, '---', '');
                lastRoleEndIndex += 2;
            }
        }

        lines.splice(lastRoleEndIndex, 0, ...insertLines);
    } else {
        // 没有找到现有角色，在文件末尾添加

        // 确保文件末尾格式正确
        if (lines.length > 0) {
            const lastLine = lines[lines.length - 1].trim();
            if (lastLine !== '' && !lastLine.startsWith('#')) {
                lines.push('');
            }
        }

        const insertLines = newRolesContent.trim().split(/\r?\n/);
        lines.push(...insertLines);
    }

    return lines.join('\n');
}

/**
 * 生成单个角色的 Markdown 内容
 * @param role 角色对象
 * @param headerLevel 标题层级，默认为 2（##）
 * @returns Markdown 内容
 */
function generateSingleRoleMarkdown(role: Role, headerLevel: number = 2): string {
    const headerPrefix = '#'.repeat(Math.max(1, Math.min(6, headerLevel)));
    let content = `${headerPrefix} ${role.name}\n\n`;

    const fieldHeaderPrefix = '#'.repeat(Math.max(1, Math.min(6, headerLevel + 1)));

    if (role.type) {
        content += `${fieldHeaderPrefix} 类型\n${role.type}\n\n`;
    }

    if (role.description) {
        content += `${fieldHeaderPrefix} 描述\n${role.description}\n\n`;
    }

    if (role.color) {
        content += `${fieldHeaderPrefix} 颜色\n${role.color}\n\n`;
    }

    if (role.affiliation) {
        content += `${fieldHeaderPrefix} 从属\n${role.affiliation}\n\n`;
    }

    if (role.aliases && Array.isArray(role.aliases)) {
        content += `${fieldHeaderPrefix} 别名\n${role.aliases.join(', ')}\n\n`;
    }

    // 处理敏感词修复候选
    if (role.fixes && Array.isArray(role.fixes)) {
        content += `${fieldHeaderPrefix} 修复\n${role.fixes.join(', ')}\n\n`;
    }

    // 添加其他属性
    const excludedFields = new Set(['name', 'type', 'description', 'color', 'affiliation', 'aliases', 'fixes', 'packagePath', 'sourcePath', 'uuid']);
    for (const [key, value] of Object.entries(role)) {
        if (!excludedFields.has(key) && value !== undefined && value !== null && value !== '') {
            content += `${fieldHeaderPrefix} ${key}\n${value}\n\n`;
        }
    }

    return content.trim();
}

/**
 * 检测文件格式
 * @param filePath 文件路径
 * @returns 文件类型
 */
export function detectFileType(filePath: string): 'json5' | 'ojson5' | 'markdown' {
    const ext = path.extname(filePath).toLowerCase();

    switch (ext) {
        case '.md': return 'markdown';
        case '.ojson5': return 'ojson5';
        case '.json5': return 'json5';
        default: return 'json5'; // 默认为 JSON5
    }
}