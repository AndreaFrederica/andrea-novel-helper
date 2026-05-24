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
import { globalFileCache } from '../context/fileCache';
import { parseMarkdownRoles, FIELD_ALIASES } from './Parser/markdownParser';
import {
    ensureDelimitedRoleHeaders,
    parseDelimitedRoleFile,
    stringifyDelimitedRoleFile,
} from './delimitedRoleFile';
import { parseTomlRoles, stringifyRolesAsToml } from './Parser/tomlParser';
import { JSON_ROLE_CHILD_KEYS } from './roleHierarchy';
import { tryLosslessJson5UpdateText } from './json5Lossless';

export type RoleUuidAutoFixWrite = {
    filePath: string;
    before: string;
    after: string;
    reason: 'ensureMissingUuid' | 'fixInvalidUuid';
};

let autoFixWriteHook: ((event: RoleUuidAutoFixWrite) => void) | undefined;

export function setRoleUuidAutoFixWriteHook(hook: ((event: RoleUuidAutoFixWrite) => void) | undefined): void {
    autoFixWriteHook = hook;
}

function notifyAutoFixWrite(event: RoleUuidAutoFixWrite): void {
    try { autoFixWriteHook?.(event); } catch (error) {
        console.error('[RoleUuidManager] auto-fix write hook failed:', error);
    }
}

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
            if (role.sourcePath.endsWith('.txt') || role.sourcePath.endsWith('.csv')) {
                // txt/csv 文件使用角色名哈希，兼容无表头格式
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
                    await updateRoleFile(filePath, rolesInFile, 'ensureMissingUuid');
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
async function updateRoleFile(filePath: string, rolesWithUuid: Role[], reason: RoleUuidAutoFixWrite['reason']): Promise<void> {
    if (!fs.existsSync(filePath)) {
        console.warn(`[RoleUuidManager] 文件不存在: ${filePath}`);
        return;
    }

    const fileName = path.basename(filePath).toLowerCase();
    
    if (fileName.endsWith('.json5') || fileName.endsWith('.ojson5') || fileName.endsWith('.rjson5')) {
        // .ojson5/.rjson5 视为 JSON5-like 文件，尝试以 JSON5 更新
        await updateJSON5File(filePath, rolesWithUuid, reason);
    } else if (fileName.endsWith('.md')) {
        await updateMarkdownFile(filePath, rolesWithUuid, reason);
    } else if (fileName.endsWith('.csv')) {
        await updateDelimitedFile(filePath, rolesWithUuid, reason);
    } else if (fileName.endsWith('.toml')) {
        await updateTomlFile(filePath, rolesWithUuid, reason);
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
async function updateJSON5File(filePath: string, rolesWithUuid: Role[], reason: RoleUuidAutoFixWrite['reason']): Promise<void> {
    try {
        const content = await readTextFileDetectEncoding(filePath);
        if (!content || content.trim() === '') {
            console.warn(`[RoleUuidManager] 跳过空文件（无法解析）: ${filePath}`);
            return;
        }
        let data: any;
        try {
            data = JSON5.parse(content);
        } catch (parseErr) {
            console.error(`[RoleUuidManager] 解析 JSON5 失败，跳过更新: ${filePath}`, parseErr);
            return;
        }

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

        // 构建 name -> uuid 映射
        const roleMap = new Map<string | undefined, string | undefined>(rolesWithUuid.map(r => [r.name, r.uuid]));

        // 记录是否有实际变更；JSON5 角色文件允许子角色嵌套，UUID 写回需要递归处理。
        const changed = updateJsonRoleUuidsRecursive(rolesArray, roleMap);

        // 重建数据结构，但保持原始的结构形态
        let updatedData: any;
        if (isArrayFormat) {
            updatedData = rolesArray;
        } else if (data.roles) {
            updatedData = { ...data, roles: rolesArray };
        } else if (data.characters) {
            updatedData = { ...data, characters: rolesArray };
        } else {
            updatedData = {};
            for (const role of rolesArray) {
                const { name, ...roleData } = role as any;
                updatedData[name] = roleData;
            }
        }

        // 若无变化则跳过写入，避免触发文件变更事件回环
        const originalNormalized = JSON5.stringify(data, null, 2);
        const updatedNormalized = JSON5.stringify(updatedData, null, 2);
        if (!changed && originalNormalized === updatedNormalized) {
            console.log(`[RoleUuidManager] JSON5 内容无变化，跳过写入: ${filePath}`);
            return;
        }

    // 写回文件（优先保留注释与格式；失败时回退到规范化输出）
    const lossless = tryLosslessJson5UpdateText(content, updatedData, vscode.Uri.file(filePath));
    if (lossless.error) {
        console.warn('[RoleUuidManager] Lossless JSON5 update fallback:', lossless.error);
    }
    const updatedContent = lossless.text ?? (updatedNormalized + '\n');
    notifyAutoFixWrite({ filePath, before: content, after: updatedContent, reason });
    await fs.promises.writeFile(filePath, updatedContent, 'utf8');
    try { globalFileCache.refreshFile(filePath); } catch { /* ignore cache refresh errors */ }
    console.log(`[RoleUuidManager] 已更新 JSON5 文件: ${filePath}`);
    } catch (error) {
        throw new Error(`更新 JSON5 文件失败: ${error}`);
    }
}

function updateJsonRoleUuidsRecursive(nodes: unknown[], roleMap: Map<string | undefined, string | undefined>): boolean {
    let changed = false;
    for (const node of nodes) {
        if (!node || typeof node !== 'object' || Array.isArray(node)) { continue; }
        const role = node as Record<string, any>;
        if (typeof role.name === 'string' && roleMap.has(role.name)) {
            const newUuid = roleMap.get(role.name);
            if (newUuid && role.uuid !== newUuid) {
                role.uuid = newUuid;
                changed = true;
            }
        }
        for (const key of JSON_ROLE_CHILD_KEYS) {
            const children = role[key];
            if (Array.isArray(children)) {
                changed = updateJsonRoleUuidsRecursive(children, roleMap) || changed;
            } else if (children && typeof children === 'object') {
                for (const [childName, childValue] of Object.entries(children as Record<string, unknown>)) {
                    if (childValue && typeof childValue === 'object' && !Array.isArray(childValue)) {
                        const childRole = childValue as Record<string, any>;
                        const originalName = childRole.name;
                        if (typeof originalName !== 'string' || !originalName.trim()) {
                            childRole.name = childName;
                        }
                        changed = updateJsonRoleUuidsRecursive([childRole], roleMap) || changed;
                        if (typeof originalName === 'undefined') {
                            delete childRole.name;
                        }
                    }
                }
            }
        }
    }
    return changed;
}

/**
 * 更新 Markdown 文件
 * @param filePath 文件路径
 * @param rolesWithUuid 包含 UUID 的角色列表
 */
async function updateMarkdownFile(filePath: string, rolesWithUuid: Role[], reason: RoleUuidAutoFixWrite['reason']): Promise<void> {
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
        let uuidFieldHeaderLine = -1;
        let changed = false;

        const flushExistingUuidField = (beforeOutputIndex: number): void => {
            if (!currentRoleName || !hasUuidField || uuidFieldHeaderLine < 0) {
                return;
            }
            const targetUuid = roleUuidMap.get(currentRoleName);
            if (!targetUuid) {
                return;
            }

            let contentStart = uuidFieldHeaderLine + 1;
            while (contentStart < beforeOutputIndex && updatedLines[contentStart].trim() === '') {
                contentStart++;
            }
            let contentEnd = contentStart;
            const uuidLevel = (updatedLines[uuidFieldHeaderLine]?.match(/^(#+)/)?.[1]?.length) || 2;
            while (contentEnd < beforeOutputIndex) {
                const trimmed = updatedLines[contentEnd].trim();
                if (!trimmed) {
                    contentEnd++;
                    continue;
                }
                const headingMatch = trimmed.match(/^(#+)\s+/);
                if (headingMatch && headingMatch[1].length <= uuidLevel) {
                    break;
                }
                contentEnd++;
            }

            const existingUuid = updatedLines.slice(contentStart, contentEnd).join('\n').trim();
            if (existingUuid === targetUuid) {
                return;
            }

            const replacement = ['', targetUuid];
            updatedLines.splice(uuidFieldHeaderLine + 1, contentEnd - (uuidFieldHeaderLine + 1), ...replacement);
            changed = true;
        };
        
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
                    flushExistingUuidField(updatedLines.length);
                    // 保存之前角色的 UUID 插入位置
                    if (currentRoleName && roleUuidMap.has(currentRoleName) && !hasUuidField && insertUuidAfterLine >= 0) {
                        insertUuidAtLine(updatedLines, insertUuidAfterLine, currentRoleLevel + 1, roleUuidMap.get(currentRoleName)!);
                        changed = true;
                    }
                    
                    currentRoleName = headerText;
                    currentRoleLevel = headerLevel;
                    hasUuidField = false;
                    insertUuidAfterLine = updatedLines.length; // 记录角色标题行的位置
                    uuidFieldHeaderLine = -1;
                }
                // 检测字段标题
                else if (currentRoleName && headerLevel === currentRoleLevel + 1) {
                    flushExistingUuidField(updatedLines.length);
                    const fieldName = getStandardFieldName(headerText);
                    if (fieldName === 'uuid') {
                        hasUuidField = true;
                        uuidFieldHeaderLine = updatedLines.length;
                    }
                    // 如果遇到第一个字段且还没有 UUID 字段，在这里插入
                    if (!hasUuidField && insertUuidAfterLine >= 0) {
                        insertUuidAtLine(updatedLines, insertUuidAfterLine, headerLevel, roleUuidMap.get(currentRoleName)!);
                        hasUuidField = true;
                        changed = true;
                        insertUuidAfterLine = -1;
                    }
                }
            }
            
            updatedLines.push(line);
        }
        
        flushExistingUuidField(updatedLines.length);

        // 处理最后一个角色
        if (currentRoleName && roleUuidMap.has(currentRoleName) && !hasUuidField && insertUuidAfterLine >= 0) {
            insertUuidAtLine(updatedLines, insertUuidAfterLine, currentRoleLevel + 1, roleUuidMap.get(currentRoleName)!);
            changed = true;
        }
        
        const updatedContent = updatedLines.join('\n');
        if (!changed && content.replace(/\r\n/g, '\n') === updatedContent.replace(/\r\n/g, '\n')) {
            console.log(`[RoleUuidManager] Markdown 内容无变化，跳过写入: ${filePath}`);
            return;
        }

        // 写回文件，并刷新全局缓存
        notifyAutoFixWrite({ filePath, before: content, after: updatedContent, reason });
        await fs.promises.writeFile(filePath, updatedContent, 'utf8');
        try { globalFileCache.refreshFile(filePath); } catch { /* ignore cache refresh errors */ }
        console.log(`[RoleUuidManager] 已更新 Markdown 文件: ${filePath}`);
    } catch (error) {
        throw new Error(`更新 Markdown 文件失败: ${error}`);
    }
}

async function updateDelimitedFile(filePath: string, rolesWithUuid: Role[], reason: RoleUuidAutoFixWrite['reason']): Promise<void> {
    try {
        const content = await readTextFileDetectEncoding(filePath);
        const packagePath = path.relative(
            path.join(path.dirname(filePath), '..', '..'),
            path.dirname(filePath)
        );
        const parsed = parseDelimitedRoleFile(content, filePath, packagePath, rolesWithUuid[0]?.type || '角色');

        if (!parsed.hasHeader) {
            console.log(`[RoleUuidManager] 无表头 CSV 不回写 UUID，内存中保留哈希 UUID: ${filePath}`);
            return;
        }

        const roleMap = new Map<string | undefined, string | undefined>(rolesWithUuid.map(role => [role.name, role.uuid]));
        let changed = false;

        for (const role of parsed.roles) {
            if (!role.name || !roleMap.has(role.name)) {
                continue;
            }
            const nextUuid = roleMap.get(role.name);
            if (nextUuid && role.uuid !== nextUuid) {
                role.uuid = nextUuid;
                changed = true;
            }
        }

        const format = ensureDelimitedRoleHeaders({
            delimiter: parsed.delimiter,
            hasHeader: parsed.hasHeader,
            headers: parsed.headers,
        }, 'uuid');
        const updatedContent = stringifyDelimitedRoleFile(parsed.roles, format);
        const normalizedOriginal = content.replace(/\r\n/g, '\n').trimEnd();
        const normalizedUpdated = updatedContent.replace(/\r\n/g, '\n').trimEnd();

        if (!changed && normalizedOriginal === normalizedUpdated) {
            console.log(`[RoleUuidManager] CSV 内容无变化，跳过写入: ${filePath}`);
            return;
        }

        const nextContent = `${updatedContent}\n`;
        notifyAutoFixWrite({ filePath, before: content, after: nextContent, reason });
        await fs.promises.writeFile(filePath, nextContent, 'utf8');
        try { globalFileCache.refreshFile(filePath); } catch { /* ignore cache refresh errors */ }
        console.log(`[RoleUuidManager] 已更新 CSV 文件: ${filePath}`);
    } catch (error) {
        throw new Error(`更新 CSV 文件失败: ${error}`);
    }
}

/**
 * 更新 TOML 文件，添加 UUID 字段
 */
async function updateTomlFile(filePath: string, rolesWithUuid: Role[], reason: RoleUuidAutoFixWrite['reason']): Promise<void> {
    try {
        const content = await readTextFileDetectEncoding(filePath);
        if (!content || content.trim() === '') {
            console.warn(`[RoleUuidManager] 跳过空 TOML 文件: ${filePath}`);
            return;
        }

        const packagePath = path.relative(
            path.join(path.dirname(filePath), '..', '..'),
            path.dirname(filePath)
        );
        const roles = parseTomlRoles(content, filePath, packagePath, rolesWithUuid[0]?.type || '角色');

        const roleMap = new Map<string | undefined, string | undefined>(
            rolesWithUuid.map(r => [r.name, r.uuid])
        );

        let changed = false;
        for (const role of roles) {
            if (!role.name) { continue; }
            const targetUuid = roleMap.get(role.name);
            if (targetUuid && role.uuid !== targetUuid) {
                role.uuid = targetUuid;
                changed = true;
            }
        }

        const updatedContent = stringifyRolesAsToml(roles);
        const normalizedOriginal = content.replace(/\r\n/g, '\n').trimEnd();
        const normalizedUpdated = updatedContent.trimEnd();

        if (!changed && normalizedOriginal === normalizedUpdated) {
            console.log(`[RoleUuidManager] TOML 内容无变化，跳过写入: ${filePath}`);
            return;
        }

        notifyAutoFixWrite({ filePath, before: content, after: updatedContent, reason });
        await fs.promises.writeFile(filePath, updatedContent, 'utf8');
        try { globalFileCache.refreshFile(filePath); } catch { /* ignore */ }
        console.log(`[RoleUuidManager] 已更新 TOML 文件: ${filePath}`);
    } catch (error) {
        throw new Error(`更新 TOML 文件失败: ${error}`);
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

    if (role.sourcePath?.endsWith('.csv')) {
        const expectedHash = generateRoleNameHash(role.name);
        return role.uuid === expectedHash || isValidUUID(role.uuid);
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
            if (role.sourcePath?.endsWith('.txt') || role.sourcePath?.endsWith('.csv')) {
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
                    await updateRoleFile(filePath, rolesInFile, 'fixInvalidUuid');
                } catch (error) {
                    console.error(`[RoleUuidManager] 修复文件失败: ${filePath}`, error);
                }
            }
        }
    }
}
