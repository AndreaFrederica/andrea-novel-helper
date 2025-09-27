/**
 * 关系表加载器
 * 用于加载和管理角色关系数据
 */

import { globalRelationshipManager } from './globalRelationshipManager';
import { NodeRoleParser } from '../utils/nodeRoleParser';
import { roles } from '../activate';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * 检查文件是否为关系表文件
 * @param fileName 文件名
 * @returns 是否为关系表文件
 */
function isRelationshipFile(fileName: string): boolean {
    const lowerName = fileName.toLowerCase();
    
    // rjson5 文件一定是关系文件
    if (lowerName.endsWith('.rjson5')) {
        return true;
    }
    
    // ojson5 文件一定是角色文件，不是关系文件
    if (lowerName.endsWith('.ojson5')) {
        return false;
    }
    
    // 支持的关系表文件扩展名
    const validExtensions = ['.json5'];
    const hasValidExtension = validExtensions.some(ext => lowerName.endsWith(ext));
    
    if (!hasValidExtension) {
        return false;
    }
    
    // 检查文件名是否包含关系相关关键词
    const relationshipKeywords = [
        'relationship', 'relation', 'connections', 'links'
    ];
    
    // 中文关键词
    const zhKeywords = [
        '关系', '关联', '连接', '联系'
    ];
    
    // 命中任一关键词即可
    if (relationshipKeywords.some(k => lowerName.includes(k))) {
        return true;
    }
    
    // 中文匹配
    if (zhKeywords.some(k => fileName.includes(k))) {
        return true;
    }
    
    return false;
}

/**
 * 加载单个关系表文件
 * @param filePath 文件绝对路径
 * @param packagePath 包路径（相对于 novel-helper）
 * @param fileName 文件名
 */
async function loadRelationshipFile(filePath: string, packagePath: string, fileName: string): Promise<void> {
    console.log(`loadRelationshipFile: 加载关系文件 ${filePath}`);
    
    try {
        if (!fs.existsSync(filePath)) {
            console.warn(`loadRelationshipFile: 文件不存在 ${filePath}`);
            return;
        }
        
        const parser = new NodeRoleParser();
        const relationships = await parser.parseFromFile(filePath);
        
        if (relationships.length > 0) {
            console.log(`loadRelationshipFile: 从 ${filePath} 解析出 ${relationships.length} 个关系`);
            
            // 构建角色UUID到名称的映射
            const roleUuidToNameMap: Record<string, string> = {};
            for (const role of roles) {
                if (role.uuid) {
                    roleUuidToNameMap[role.uuid] = role.name;
                }
            }
            
            // 设置角色映射到全局管理器
            globalRelationshipManager.setRoleMappings(roleUuidToNameMap);
            
            // 添加关系到全局管理器（parser.parseFromFile 已经自动添加了）
            console.log(`loadRelationshipFile: 关系已添加到全局管理器`);
        } else {
            console.log(`loadRelationshipFile: ${filePath} 中未找到有效关系`);
        }
        
    } catch (error) {
        console.error(`loadRelationshipFile: 加载关系文件失败 ${filePath}: ${error}`);
        vscode.window.showErrorMessage(`加载关系文件失败: ${fileName} - ${error}`);
    }
}

/**
 * 扫描目录中的关系表文件
 * @param currentDir 当前扫描的目录绝对路径
 * @param relativePath 相对于 novel-helper 的路径
 */
async function scanRelationshipFiles(currentDir: string, relativePath: string): Promise<void> {
    try {
        if (!fs.existsSync(currentDir)) {
            return;
        }
        
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            const newRelativePath = path.join(relativePath, entry.name);
            
            if (entry.isDirectory()) {
                // 递归扫描子目录
                await scanRelationshipFiles(fullPath, newRelativePath);
            } else if (entry.isFile() && isRelationshipFile(entry.name)) {
                // 加载关系表文件
                await loadRelationshipFile(fullPath, relativePath, entry.name);
            }
        }
    } catch (error) {
        console.error(`scanRelationshipFiles: 扫描目录失败 ${currentDir}: ${error}`);
    }
}

/**
 * 构建角色UUID到名称的映射
 */
function buildRoleUuidMapping(): void {
    const roleUuidToNameMap: Record<string, string> = {};
    for (const role of roles) {
        if (role.uuid) {
            roleUuidToNameMap[role.uuid] = role.name;
        }
    }
    globalRelationshipManager.setRoleMappings(roleUuidToNameMap);
}

/**
 * 加载所有关系表
 * @param novelHelperRoot novel-helper 根目录路径
 */
export async function loadRelationships(novelHelperRoot: string): Promise<void> {
    console.log(`loadRelationships: 开始加载关系表，根目录: ${novelHelperRoot}`);
    
    // 清空现有关系数据
    globalRelationshipManager.clear();
    
    if (!fs.existsSync(novelHelperRoot)) {
        console.warn(`loadRelationships: novel-helper 目录不存在: ${novelHelperRoot}`);
        return;
    }
    
    const startTime = Date.now();
    
    try {
        // 构建角色UUID到名称的映射
        buildRoleUuidMapping();
        
        await scanRelationshipFiles(novelHelperRoot, '');
        
        const totalRelationships = globalRelationshipManager.getAllRelationships().length;
        const totalRoles = globalRelationshipManager.getAllRoles().size;
        const loadTime = Date.now() - startTime;
        
        console.log(`loadRelationships: 加载完成，共 ${totalRelationships} 个关系，涉及 ${totalRoles} 个角色，用时 ${loadTime}ms`);
        
        // 显示加载结果通知
        if (totalRelationships > 0) {
            vscode.window.setStatusBarMessage(
                `$(link) 关系表已加载: ${totalRelationships} 个关系`, 
                3000
            );
        }
        
    } catch (error) {
        console.error(`loadRelationships: 加载关系表失败: ${error}`);
        vscode.window.showErrorMessage(`加载关系表失败: ${error}`);
    }
}

/**
 * 增量更新关系表
 * @param changedFiles 变更的文件路径列表
 * @param novelHelperRoot novel-helper 根目录路径
 */
export async function updateRelationships(changedFiles: string[], novelHelperRoot: string): Promise<void> {
    console.log(`updateRelationships: 增量更新 ${changedFiles.length} 个关系文件`);
    
    const relationshipFiles = changedFiles.filter(file => {
        const fileName = path.basename(file);
        return isRelationshipFile(fileName);
    });
    
    if (relationshipFiles.length === 0) {
        console.log(`updateRelationships: 没有关系文件需要更新`);
        return;
    }
    
    // 重新构建角色UUID映射（因为角色可能有变化）
    buildRoleUuidMapping();
    
    for (const filePath of relationshipFiles) {
        const fileName = path.basename(filePath);
        const relativePath = path.relative(novelHelperRoot, path.dirname(filePath));
        
        try {
            await loadRelationshipFile(filePath, relativePath, fileName);
        } catch (error) {
            console.error(`updateRelationships: 更新文件失败 ${filePath}: ${error}`);
        }
    }
    
    console.log(`updateRelationships: 增量更新完成`);
}