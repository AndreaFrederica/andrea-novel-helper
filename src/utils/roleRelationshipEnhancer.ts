/**
 * 角色关系增强器
 * 用于为角色添加关系属性，将关系数据转换为自定义键值对
 */

import { Role } from '../extension';
import { RelationshipQueryService } from './relationshipQueryService';
import { globalRelationshipManager } from './globalRelationshipManager';
import { RoleRelationship } from '../types/relationshipTypes';

/**
 * 关系属性配置
 */
export interface RelationshipPropertyConfig {
    /** 关系键的前缀，默认为"关系" */
    keyPrefix?: string;
    /** 是否包含关系类型，默认为true */
    includeType?: boolean;
    /** 是否包含关系字面值，默认为true */
    includeLiteralValue?: boolean;
    /** 键值分隔符，默认为"值为" */
    valueSeparator?: string;
    /** 多个关系的连接符，默认为"+" */
    relationshipConnector?: string;
}

/**
 * 角色关系映射表项
 */
interface RoleRelationshipMapping {
    /** 角色UUID */
    roleUuid: string;
    /** 角色名称 */
    roleName: string;
    /** 按关系类型分组的关系 */
    relationshipsByType: Map<string, RoleRelationship[]>;
    /** 所有关系 */
    allRelationships: RoleRelationship[];
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: Required<RelationshipPropertyConfig> = {
    keyPrefix: '关系',
    includeType: true,
    includeLiteralValue: true,
    valueSeparator: '值为',
    relationshipConnector: '+'
};

/**
 * 构建角色UUID到关系的映射表
 * @returns 角色关系映射表
 */
function buildRoleRelationshipMapping(): Map<string, RoleRelationshipMapping> {
    console.log('开始构建角色关系映射表...');
    const startTime = Date.now();
    
    const mappingTable = new Map<string, RoleRelationshipMapping>();
    
    // 获取所有关系
    const allRelationships = globalRelationshipManager.getAllRelationships();
    console.log(`总关系数: ${allRelationships.length}`);
    
    // 遍历所有关系，构建映射表
    for (const relationship of allRelationships) {
        const sourceUuid = relationship.metadata?.sourceRoleUuid;
        const targetUuid = relationship.metadata?.targetRoleUuid;
        
        // 处理源角色
        if (sourceUuid) {
            if (!mappingTable.has(sourceUuid)) {
                const roleName = globalRelationshipManager.getRoleNameByUuid(sourceUuid);
                if (roleName) {
                    mappingTable.set(sourceUuid, {
                        roleUuid: sourceUuid,
                        roleName,
                        relationshipsByType: new Map(),
                        allRelationships: []
                    });
                }
            }
            
            const sourceMapping = mappingTable.get(sourceUuid);
            if (sourceMapping) {
                sourceMapping.allRelationships.push(relationship);
                
                if (!sourceMapping.relationshipsByType.has(relationship.type)) {
                    sourceMapping.relationshipsByType.set(relationship.type, []);
                }
                sourceMapping.relationshipsByType.get(relationship.type)!.push(relationship);
            }
        }
        
        // 处理目标角色
        if (targetUuid) {
            if (!mappingTable.has(targetUuid)) {
                const roleName = globalRelationshipManager.getRoleNameByUuid(targetUuid);
                if (roleName) {
                    mappingTable.set(targetUuid, {
                        roleUuid: targetUuid,
                        roleName,
                        relationshipsByType: new Map(),
                        allRelationships: []
                    });
                }
            }
            
            const targetMapping = mappingTable.get(targetUuid);
            if (targetMapping) {
                targetMapping.allRelationships.push(relationship);
                
                if (!targetMapping.relationshipsByType.has(relationship.type)) {
                    targetMapping.relationshipsByType.set(relationship.type, []);
                }
                targetMapping.relationshipsByType.get(relationship.type)!.push(relationship);
            }
        }
    }
    
    const endTime = Date.now();
    console.log(`关系映射表构建完成: ${mappingTable.size} 个角色, 耗时 ${endTime - startTime}ms`);
    
    return mappingTable;
}

/**
 * 为单个角色生成关系属性（使用预构建的映射表）
 * @param role 角色对象
 * @param roleMapping 角色关系映射
 * @param config 配置选项
 * @returns 生成的关系属性键值对
 */
function generateRelationshipPropertiesFromMapping(
    role: Role,
    roleMapping: RoleRelationshipMapping | undefined,
    config: RelationshipPropertyConfig = {}
): Record<string, string> {
    const finalConfig = { ...DEFAULT_CONFIG, ...config };
    const relationshipProperties: Record<string, string> = {};

    // 如果没有关系映射，返回空对象
    if (!roleMapping || roleMapping.allRelationships.length === 0) {
        return relationshipProperties;
    }

    // 为每条关系生成独立的属性键
    let relationshipIndex = 1; // 自增数字ID
    
    for (const rel of roleMapping.allRelationships) {
        // 确定关系对象角色（不是当前角色的那一方）
        let targetRoleName: string;
        
        if (rel.metadata?.sourceRoleUuid === role.uuid) {
            // 当前角色是源角色，目标角色是关系对象
            targetRoleName = rel.targetRole;
        } else {
            // 当前角色是目标角色，源角色是关系对象
            targetRoleName = rel.sourceRole;
        }

        // 构建关系值字符串
        let relationshipValue = `和:${targetRoleName}`;
        
        if (finalConfig.includeLiteralValue && rel.literalValue) {
            relationshipValue += ` ${finalConfig.relationshipConnector} ${rel.literalValue}`;
        }
        
        // 构建属性键：关系-数字id（自增）（xx关系（类型））
        let propertyKey = `${finalConfig.keyPrefix}-${relationshipIndex}（${rel.type}）`;
        
        relationshipProperties[propertyKey] = relationshipValue;
        relationshipIndex++;
    }

    return relationshipProperties;
}

/**
 * 为单个角色生成关系属性（兼容性函数，仍使用查询服务）
 * @param role 角色对象
 * @param config 配置选项
 * @returns 生成的关系属性键值对
 * @deprecated 建议使用 enhanceAllRolesWithRelationships 来获得更好的性能
 */
export function generateRelationshipProperties(
    role: Role, 
    config: RelationshipPropertyConfig = {}
): Record<string, string> {
    const finalConfig = { ...DEFAULT_CONFIG, ...config };
    const relationshipProperties: Record<string, string> = {};

    // 如果角色没有UUID，无法查询关系
    if (!role.uuid) {
        console.log(`角色 ${role.name} 没有UUID，跳过关系属性生成`);
        return relationshipProperties;
    }

    // 查询角色的所有关系
    const queryResult = RelationshipQueryService.queryByRoleUuid(role.uuid);
    
    if (queryResult.allRelationships.length === 0) {
        console.log(`角色 ${role.name} 没有关系数据`);
        return relationshipProperties;
    }

    // 按关系类型分组
    const relationshipsByType = new Map<string, RoleRelationship[]>();
    
    for (const relationship of queryResult.allRelationships) {
        const type = relationship.type;
        if (!relationshipsByType.has(type)) {
            relationshipsByType.set(type, []);
        }
        relationshipsByType.get(type)!.push(relationship);
    }

    // 为每种关系类型生成属性键
    for (const [relationshipType, relationships] of relationshipsByType) {
        // 构建关系值数组
        const relationshipValues: string[] = [];
        
        for (const rel of relationships) {
            // 确定关系对象角色（不是当前角色的那一方）
            let targetRoleName: string;
            
            if (rel.metadata?.sourceRoleUuid === role.uuid) {
                // 当前角色是源角色，目标角色是关系对象
                targetRoleName = rel.targetRole;
            } else {
                // 当前角色是目标角色，源角色是关系对象
                targetRoleName = rel.sourceRole;
            }

            // 构建关系值字符串
            let relationshipValue = `关系对象角色（${targetRoleName}）`;
            
            if (finalConfig.includeLiteralValue && rel.literalValue) {
                relationshipValue += ` ${finalConfig.relationshipConnector} ${rel.literalValue}`;
            }
            
            relationshipValues.push(relationshipValue);
        }
        
        // 构建属性键
        let propertyKey = finalConfig.keyPrefix;
        
        if (finalConfig.includeType) {
            propertyKey += ` (${relationshipType}) ${finalConfig.valueSeparator} `;
        } else {
            propertyKey += ` ${finalConfig.valueSeparator} `;
        }
        
        // 合并关系值
        const combinedValue = relationshipValues.join(` ${finalConfig.relationshipConnector}`);
        propertyKey += combinedValue + ')';
        
        relationshipProperties[propertyKey] = combinedValue;
    }

    return relationshipProperties;
}

/**
 * 为所有角色添加关系属性（优化版本）
 * @param roles 角色数组
 * @param config 配置选项
 * @returns 增强结果统计
 */
export function enhanceAllRolesWithRelationships(
    roles: Role[], 
    config: RelationshipPropertyConfig = {}
): { 
    totalRoles: number; 
    enhancedRoles: number; 
    totalRelationshipProperties: number 
} {
    console.log('开始为所有角色添加关系属性（优化版本）...');
    const startTime = Date.now();
    
    // 1. 预构建关系映射表
    const relationshipMapping = buildRoleRelationshipMapping();
    
    // 2. 批量处理角色
    let enhancedRoles = 0;
    let totalRelationshipProperties = 0;
    
    for (const role of roles) {
        if (!role.uuid) {
            continue;
        }
        
        // 从映射表中获取关系数据
        const roleMapping = relationshipMapping.get(role.uuid);
        const relationshipProperties = generateRelationshipPropertiesFromMapping(role, roleMapping, config);
        
        if (Object.keys(relationshipProperties).length > 0) {
            // 将关系属性添加到角色对象中
            Object.assign(role, relationshipProperties);
            enhancedRoles++;
            totalRelationshipProperties += Object.keys(relationshipProperties).length;
            
            console.log(`为角色 ${role.name} 添加了 ${Object.keys(relationshipProperties).length} 个关系属性`);
            
            // 调试：显示添加的属性
            for (const [key, value] of Object.entries(relationshipProperties)) {
                console.log(`  - ${key}: ${value}`);
            }
        }
    }
    
    const endTime = Date.now();
    const result = {
        totalRoles: roles.length,
        enhancedRoles,
        totalRelationshipProperties
    };
    
    console.log(`关系属性添加完成: 总角色 ${result.totalRoles}, 增强角色 ${result.enhancedRoles}, 总关系属性 ${result.totalRelationshipProperties}, 总耗时 ${endTime - startTime}ms`);
    
    return result;
}

/**
 * 清理角色的关系属性
 * @param roles 角色数组
 * @param keyPrefix 要清理的属性键前缀，默认为"关系"
 */
export function clearRelationshipProperties(roles: Role[], keyPrefix: string = '关系'): void {
    console.log(`清理角色关系属性，前缀: ${keyPrefix}`);
    
    let clearedCount = 0;
    
    for (const role of roles) {
        const keysToDelete = Object.keys(role).filter(key => key.startsWith(keyPrefix));
        
        for (const key of keysToDelete) {
            delete (role as any)[key];
            clearedCount++;
        }
    }
    
    console.log(`已清理 ${clearedCount} 个关系属性`);
}