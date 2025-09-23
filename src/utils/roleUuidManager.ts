/**
 * 角色 UUID 管理器
 * 负责为现有角色自动添加 UUID，并更新相应的文件
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import JSON5 from 'json5';
import { Role } from '../extension';
import { generateUUIDv7, generateRoleNameHash, isValidUUID } from './uuidUtils';
import { readTextFileDetectEncoding } from './utils';
import { parseMarkdownRoles, FIELD_ALIASES } from './Parser/markdownParser';

/**
 * 为所有角色添加 UUID
 * @param roles 角色数组
 * @param updateFiles 是否更新源文件
 */
export async function ensureRoleUUIDs(roles: Role[], updateFiles: boolean = true): Promise<void> {
    const fileUpdates = new Map<string, Role[]>();
    let updatedCount = 0;

    // 按源文件分组角色
    for (const role of roles) {
        if (!role.uuid && role.sourcePath) {
            // 为角色生成 UUID
            if (role.sourcePath.endsWith('.txt')) {
                // txt 文件使用角色名哈希
                role.uuid = generateRoleNameHash(role.name);
            } else {
                // 其他文件使用 UUID v7
                role.uuid = generateUUIDv7();
            }
            
            updatedCount++;
            
            if (updateFiles && role.sourcePath) {
                if (!fileUpdates.has(role.sourcePath)) {
                    fileUpdates.set(role.sourcePath, []);
                }
                fileUpdates.get(role.sourcePath)!.push(role);
            }
        }
    }

    if (updatedCount > 0) {
        console.log(`[RoleUuidManager] 为 ${updatedCount} 个角色生成了 UUID`);
        
        if (updateFiles) {
            // 更新文件
            for (const [filePath, rolesInFile] of fileUpdates) {
                try {
                    await updateRoleFile(filePath, rolesInFile);
                } catch (error) {
                    console.error(`[RoleUuidManager] 更新文件失败: ${filePath}`, error);
                    vscode.window.showErrorMessage(`更新角色文件失败: ${path.basename(filePath)} - ${error}`);
                }
            }
            
            if (fileUpdates.size > 0) {
                vscode.window.showInformationMessage(`已为 ${updatedCount} 个角色添加 UUID，更新了 ${fileUpdates.size} 个文件`);
            }
        }
    }
}

/**
 * 更新角色文件，添加 UUID 字段
 * @param filePath 文件路径
 * @param rolesWithUuid 包含 UUID 的角色列表
 */
async function updateRoleFile(filePath: string, rolesWithUuid: Role[]): Promise<void> {
    if (!fs.existsSync(filePath)) {
        console.warn(`[RoleUuidManager] 文件不存在: ${filePath}`);
        return;
    }

    const fileName = path.basename(filePath).toLowerCase();
    
    if (fileName.endsWith('.json5')) {
        await updateJSON5File(filePath, rolesWithUuid);
    } else if (fileName.endsWith('.md')) {
        await updateMarkdownFile(filePath, rolesWithUuid);
    } else if (fileName.endsWith('.txt')) {
        // txt 文件无法修改，只在内存中保持 UUID
        console.log(`[RoleUuidManager] txt 文件无法修改，UUID 仅在内存中保持: ${filePath}`);
    }
}

/**
 * 更新 JSON5 文件
 * @param filePath 文件路径
 * @param rolesWithUuid 包含 UUID 的角色列表
 */
async function updateJSON5File(filePath: string, rolesWithUuid: Role[]): Promise<void> {
    try {
        const content = await readTextFileDetectEncoding(filePath);
        const data = JSON5.parse(content);
        
        let rolesArray: Role[] = [];
        let isArrayFormat = false;
        
        // 确定数据格式
        if (Array.isArray(data)) {
            rolesArray = data;
            isArrayFormat = true;
        } else if (typeof data === 'object' && data !== null) {
            if (data.roles && Array.isArray(data.roles)) {
                rolesArray = data.roles;
            } else if (data.characters && Array.isArray(data.characters)) {
                rolesArray = data.characters;
            } else {
                // 对象格式，每个属性是一个角色
                rolesArray = Object.entries(data).map(([name, roleData]) => ({
                    name,
                    ...(typeof roleData === 'object' ? roleData : {}),
                })) as Role[];
            }
        }
        
        // 更新角色的 UUID
        const roleMap = new Map(rolesWithUuid.map(r => [r.name, r.uuid]));
        
        for (const role of rolesArray) {
            if (roleMap.has(role.name) && !role.uuid) {
                role.uuid = roleMap.get(role.name);
            }
        }
        
        // 重新构建数据结构
        let updatedData: any;
        if (isArrayFormat) {
            updatedData = rolesArray;
        } else if (data.roles) {
            updatedData = { ...data, roles: rolesArray };
        } else if (data.characters) {
            updatedData = { ...data, characters: rolesArray };
        } else {
            // 对象格式，重新构建
            updatedData = {};
            for (const role of rolesArray) {
                const { name, ...roleData } = role;
                updatedData[name] = roleData;
            }
        }
        
        // 写回文件
        const updatedContent = JSON5.stringify(updatedData, null, 2);
        await fs.promises.writeFile(filePath, updatedContent, 'utf8');
        
        console.log(`[RoleUuidManager] 已更新 JSON5 文件: ${filePath}`);
    } catch (error) {
        throw new Error(`更新 JSON5 文件失败: ${error}`);
    }
}

/**
 * 更新 Markdown 文件
 * @param filePath 文件路径
 * @param rolesWithUuid 包含 UUID 的角色列表
 */
async function updateMarkdownFile(filePath: string, rolesWithUuid: Role[]): Promise<void> {
    try {
        const content = await readTextFileDetectEncoding(filePath);
        const lines = content.split(/\r?\n/);
        
        // 创建角色名到 UUID 的映射
        const roleUuidMap = new Map(rolesWithUuid.map(r => [r.name, r.uuid]));
        
        let updatedLines: string[] = [];
        let currentRoleName: string | null = null;
        let currentRoleLevel = 0;
        let hasUuidField = false;
        let insertUuidAfterLine = -1;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();
            
            // 检测角色标题
            const headerMatch = trimmedLine.match(/^(#+)\s+(.+)$/);
            if (headerMatch) {
                const headerLevel = headerMatch[1].length;
                const headerText = headerMatch[2].trim();
                
                // 如果是新的角色标题
                if (roleUuidMap.has(headerText)) {
                    // 保存之前角色的 UUID 插入位置
                    if (currentRoleName && roleUuidMap.has(currentRoleName) && !hasUuidField && insertUuidAfterLine >= 0) {
                        insertUuidAtLine(updatedLines, insertUuidAfterLine, currentRoleLevel + 1, roleUuidMap.get(currentRoleName)!);
                    }
                    
                    currentRoleName = headerText;
                    currentRoleLevel = headerLevel;
                    hasUuidField = false;
                    insertUuidAfterLine = updatedLines.length; // 记录角色标题行的位置
                }
                // 检测字段标题
                else if (currentRoleName && headerLevel === currentRoleLevel + 1) {
                    const fieldName = getStandardFieldName(headerText);
                    if (fieldName === 'uuid') {
                        hasUuidField = true;
                    }
                    // 如果遇到第一个字段且还没有 UUID 字段，在这里插入
                    if (!hasUuidField && insertUuidAfterLine >= 0) {
                        insertUuidAtLine(updatedLines, insertUuidAfterLine, headerLevel, roleUuidMap.get(currentRoleName)!);
                        hasUuidField = true;
                        insertUuidAfterLine = -1;
                    }
                }
            }
            
            updatedLines.push(line);
        }
        
        // 处理最后一个角色
        if (currentRoleName && roleUuidMap.has(currentRoleName) && !hasUuidField && insertUuidAfterLine >= 0) {
            insertUuidAtLine(updatedLines, insertUuidAfterLine, currentRoleLevel + 1, roleUuidMap.get(currentRoleName)!);
        }
        
        // 写回文件
        const updatedContent = updatedLines.join('\n');
        await fs.promises.writeFile(filePath, updatedContent, 'utf8');
        
        console.log(`[RoleUuidManager] 已更新 Markdown 文件: ${filePath}`);
    } catch (error) {
        throw new Error(`更新 Markdown 文件失败: ${error}`);
    }
}

/**
 * 在指定位置插入 UUID 字段
 * @param lines 行数组
 * @param afterLineIndex 插入位置（在此行之后）
 * @param headerLevel 标题级别
 * @param uuid UUID 值
 */
function insertUuidAtLine(lines: string[], afterLineIndex: number, headerLevel: number, uuid: string): void {
    const headerPrefix = '#'.repeat(headerLevel);
    const uuidLines = [
        '',
        `${headerPrefix} UUID`,
        '',
        uuid
    ];
    
    lines.splice(afterLineIndex + 1, 0, ...uuidLines);
}

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
 * 验证角色的 UUID 是否有效
 * @param role 角色对象
 * @returns 是否有效
 */
export function validateRoleUUID(role: Role): boolean {
    if (!role.uuid) {
        return false;
    }
    
    // 对于 txt 文件的角色，验证是否为角色名哈希
    if (role.sourcePath?.endsWith('.txt')) {
        const expectedHash = generateRoleNameHash(role.name);
        return role.uuid === expectedHash;
    }
    
    // 对于其他文件，验证是否为有效的 UUID 格式
    return isValidUUID(role.uuid);
}

/**
 * 修复无效的角色 UUID
 * @param roles 角色数组
 * @param updateFiles 是否更新源文件
 */
export async function fixInvalidRoleUUIDs(roles: Role[], updateFiles: boolean = true): Promise<void> {
    const rolesToFix: Role[] = [];
    
    for (const role of roles) {
        if (role.uuid && !validateRoleUUID(role)) {
            // 重新生成 UUID
            if (role.sourcePath?.endsWith('.txt')) {
                role.uuid = generateRoleNameHash(role.name);
            } else {
                role.uuid = generateUUIDv7();
            }
            rolesToFix.push(role);
        }
    }
    
    if (rolesToFix.length > 0) {
        console.log(`[RoleUuidManager] 修复了 ${rolesToFix.length} 个无效的 UUID`);
        
        if (updateFiles) {
            // 按文件分组并更新
            const fileUpdates = new Map<string, Role[]>();
            for (const role of rolesToFix) {
                if (role.sourcePath) {
                    if (!fileUpdates.has(role.sourcePath)) {
                        fileUpdates.set(role.sourcePath, []);
                    }
                    fileUpdates.get(role.sourcePath)!.push(role);
                }
            }
            
            for (const [filePath, rolesInFile] of fileUpdates) {
                try {
                    await updateRoleFile(filePath, rolesInFile);
                } catch (error) {
                    console.error(`[RoleUuidManager] 修复文件失败: ${filePath}`, error);
                }
            }
        }
    }
}
