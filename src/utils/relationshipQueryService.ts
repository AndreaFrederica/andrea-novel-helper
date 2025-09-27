/**
 * 关系查询服务
 * 提供便捷的角色关系查询接口
 */

import { globalRelationshipManager } from './globalRelationshipManager';
import { RoleRelationship } from '../types/relationshipTypes';
import { roles } from '../activate';

/**
 * 关系查询结果
 */
export interface RelationshipQueryResult {
    /** 查询的角色UUID */
    roleUuid: string;
    /** 查询的角色名称 */
    roleName?: string;
    /** 作为源角色的关系 */
    asSource: RoleRelationship[];
    /** 作为目标角色的关系 */
    asTarget: RoleRelationship[];
    /** 所有相关关系 */
    allRelationships: RoleRelationship[];
    /** 关系统计 */
    statistics: {
        totalCount: number;
        asSourceCount: number;
        asTargetCount: number;
        relationshipTypes: string[];
    };
}

/**
 * 关系查询服务类
 */
export class RelationshipQueryService {
    
    /**
     * 通过角色UUID查询所有关系
     * @param roleUuid 角色UUID
     * @returns 查询结果
     */
    static queryByRoleUuid(roleUuid: string): RelationshipQueryResult {
        // 获取角色名称
        const roleName = globalRelationshipManager.getRoleNameByUuid(roleUuid);
        
        // 获取各类关系
        const asSource = globalRelationshipManager.getRelationshipsBySourceUuid(roleUuid);
        const asTarget = globalRelationshipManager.getRelationshipsByTargetUuid(roleUuid);
        const allRelationships = globalRelationshipManager.getAllRelationshipsByUuid(roleUuid);
        
        // 统计关系类型
        const relationshipTypes = [...new Set(allRelationships.map(rel => rel.type))];
        
        return {
            roleUuid,
            roleName,
            asSource,
            asTarget,
            allRelationships,
            statistics: {
                totalCount: allRelationships.length,
                asSourceCount: asSource.length,
                asTargetCount: asTarget.length,
                relationshipTypes
            }
        };
    }
    
    /**
     * 通过角色名称查询所有关系
     * @param roleName 角色名称
     * @returns 查询结果，如果找不到角色UUID则返回null
     */
    static queryByRoleName(roleName: string): RelationshipQueryResult | null {
        // 查找角色UUID
        const role = roles.find(r => r.name === roleName);
        if (!role || !role.uuid) {
            return null;
        }
        
        return this.queryByRoleUuid(role.uuid);
    }
    
    /**
     * 获取两个角色之间的关系
     * @param roleUuid1 角色1的UUID
     * @param roleUuid2 角色2的UUID
     * @returns 两个角色之间的关系列表
     */
    static getRelationshipsBetweenUuids(roleUuid1: string, roleUuid2: string): RoleRelationship[] {
        const allRelationships = globalRelationshipManager.getAllRelationships();
        
        return allRelationships.filter(rel => {
            const sourceUuid = rel.metadata?.sourceRoleUuid;
            const targetUuid = rel.metadata?.targetRoleUuid;
            
            return (sourceUuid === roleUuid1 && targetUuid === roleUuid2) ||
                   (sourceUuid === roleUuid2 && targetUuid === roleUuid1);
        });
    }
    
    /**
     * 按关系类型查询关系
     * @param relationshipType 关系类型
     * @returns 指定类型的所有关系
     */
    static queryByRelationshipType(relationshipType: string): RoleRelationship[] {
        return globalRelationshipManager.getRelationshipsByType(relationshipType);
    }
    
    /**
     * 获取所有关系类型
     * @returns 关系类型列表
     */
    static getAllRelationshipTypes(): string[] {
        const allRelationships = globalRelationshipManager.getAllRelationships();
        return [...new Set(allRelationships.map(rel => rel.type))];
    }
    
    /**
     * 获取关系统计信息
     * @returns 关系统计
     */
    static getRelationshipStatistics(): {
        totalRelationships: number;
        totalRoles: number;
        relationshipsByType: Record<string, number>;
        topRelationshipTypes: Array<{ type: string; count: number }>;
    } {
        const stats = globalRelationshipManager.getStatistics();
        const relationshipsByType: Record<string, number> = {};
        
        // 转换Map为普通对象
        for (const [type, count] of stats.relationshipsByType) {
            relationshipsByType[type] = count;
        }
        
        // 获取排名前5的关系类型
        const topRelationshipTypes = Object.entries(relationshipsByType)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([type, count]) => ({ type, count }));
        
        return {
            totalRelationships: stats.totalRelationships,
            totalRoles: stats.totalRoles,
            relationshipsByType,
            topRelationshipTypes
        };
    }
    
    /**
     * 搜索关系（模糊匹配）
     * @param searchTerm 搜索词
     * @returns 匹配的关系列表
     */
    static searchRelationships(searchTerm: string): RoleRelationship[] {
        const allRelationships = globalRelationshipManager.getAllRelationships();
        const lowerSearchTerm = searchTerm.toLowerCase();
        
        return allRelationships.filter(rel => {
            return rel.sourceRole.toLowerCase().includes(lowerSearchTerm) ||
                   rel.targetRole.toLowerCase().includes(lowerSearchTerm) ||
                   rel.type.toLowerCase().includes(lowerSearchTerm) ||
                   rel.literalValue.toLowerCase().includes(lowerSearchTerm);
        });
    }
    
    /**
     * 验证角色UUID是否存在
     * @param roleUuid 角色UUID
     * @returns 是否存在
     */
    static isValidRoleUuid(roleUuid: string): boolean {
        return globalRelationshipManager.getRoleNameByUuid(roleUuid) !== undefined;
    }
    
    /**
     * 获取角色的关系网络（包括间接关系）
     * @param roleUuid 角色UUID
     * @param maxDepth 最大深度，默认为2
     * @returns 关系网络
     */
    static getRelationshipNetwork(roleUuid: string, maxDepth: number = 2): {
        nodes: Array<{ uuid: string; name: string; depth: number }>;
        relationships: RoleRelationship[];
    } {
        const visited = new Set<string>();
        const nodes: Array<{ uuid: string; name: string; depth: number }> = [];
        const relationships: RoleRelationship[] = [];
        
        const traverse = (currentUuid: string, depth: number) => {
            if (depth > maxDepth || visited.has(currentUuid)) {
                return;
            }
            
            visited.add(currentUuid);
            const roleName = globalRelationshipManager.getRoleNameByUuid(currentUuid);
            if (roleName) {
                nodes.push({ uuid: currentUuid, name: roleName, depth });
            }
            
            // 获取当前角色的所有关系
            const currentRelationships = globalRelationshipManager.getAllRelationshipsByUuid(currentUuid);
            relationships.push(...currentRelationships);
            
            // 递归遍历相关角色
            for (const rel of currentRelationships) {
                const nextUuid = rel.metadata?.sourceRoleUuid === currentUuid 
                    ? rel.metadata?.targetRoleUuid 
                    : rel.metadata?.sourceRoleUuid;
                
                if (nextUuid && !visited.has(nextUuid)) {
                    traverse(nextUuid, depth + 1);
                }
            }
        };
        
        traverse(roleUuid, 0);
        
        // 去重关系
        const uniqueRelationships = relationships.filter((rel, index, arr) => 
            arr.findIndex(r => 
                r.metadata?.sourceRoleUuid === rel.metadata?.sourceRoleUuid &&
                r.metadata?.targetRoleUuid === rel.metadata?.targetRoleUuid &&
                r.type === rel.type
            ) === index
        );
        
        return {
            nodes,
            relationships: uniqueRelationships
        };
    }
}

// 导出便捷的查询函数
export const queryRelationshipsByUuid = RelationshipQueryService.queryByRoleUuid;
export const queryRelationshipsByName = RelationshipQueryService.queryByRoleName;
export const getRelationshipStatistics = RelationshipQueryService.getRelationshipStatistics;