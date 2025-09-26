/**
 * 全局关系表管理器
 * 用于存储和管理所有角色关系
 */

import { RoleRelationship } from '../types/relationshipTypes';

/**
 * 全局关系表管理器类
 */
export class GlobalRelationshipManager {
    private relationships: Map<string, RoleRelationship> = new Map();
    private roleIndex: Map<string, Set<string>> = new Map(); // 角色名称到关系ID的索引
    private roleUuidToNameMap: Map<string, string> = new Map(); // roleUuid到角色名称的映射

    /**
     * 设置角色UUID到名称的映射
     * @param roleUuid 角色UUID
     * @param roleName 角色名称
     */
    setRoleMapping(roleUuid: string, roleName: string): void {
        this.roleUuidToNameMap.set(roleUuid, roleName);
    }

    /**
     * 根据UUID获取角色名称
     * @param roleUuid 角色UUID
     * @returns 角色名称或undefined
     */
    getRoleNameByUuid(roleUuid: string): string | undefined {
        return this.roleUuidToNameMap.get(roleUuid);
    }

    /**
     * 批量设置角色映射
     * @param mappings 角色UUID到名称的映射对象
     */
    setRoleMappings(mappings: Record<string, string>): void {
        for (const [uuid, name] of Object.entries(mappings)) {
            this.setRoleMapping(uuid, name);
        }
    }

    /**
     * 添加关系
     * @param relationship 角色关系
     * @returns 关系的唯一ID
     */
    addRelationship(relationship: RoleRelationship): string {
        const relationshipId = this.generateRelationshipId(relationship);
        
        // 存储关系
        this.relationships.set(relationshipId, { ...relationship });
        
        // 更新角色索引
        this.updateRoleIndex(relationship.sourceRole, relationshipId);
        this.updateRoleIndex(relationship.targetRole, relationshipId);
        
        return relationshipId;
    }

    /**
     * 删除关系
     * @param relationshipId 关系ID
     * @returns 是否删除成功
     */
    removeRelationship(relationshipId: string): boolean {
        const relationship = this.relationships.get(relationshipId);
        if (!relationship) {
            return false;
        }

        // 从角色索引中移除
        this.removeFromRoleIndex(relationship.sourceRole, relationshipId);
        this.removeFromRoleIndex(relationship.targetRole, relationshipId);
        
        // 删除关系
        return this.relationships.delete(relationshipId);
    }

    /**
     * 获取指定角色的所有关系
     * @param roleName 角色名称
     * @returns 该角色相关的所有关系
     */
    getRelationshipsByRole(roleName: string): RoleRelationship[] {
        const relationshipIds = this.roleIndex.get(roleName) || new Set();
        const relationships: RoleRelationship[] = [];
        
        for (const id of relationshipIds) {
            const relationship = this.relationships.get(id);
            if (relationship) {
                relationships.push(relationship);
            }
        }
        
        return relationships;
    }

    /**
     * 获取两个角色之间的关系
     * @param role1 角色1
     * @param role2 角色2
     * @returns 两个角色之间的关系列表
     */
    getRelationshipsBetween(role1: string, role2: string): RoleRelationship[] {
        const role1Relationships = this.getRelationshipsByRole(role1);
        return role1Relationships.filter(rel => 
            rel.targetRole === role2 || rel.sourceRole === role2
        );
    }

    /**
     * 按关系类型获取关系
     * @param type 关系类型
     * @returns 指定类型的所有关系
     */
    getRelationshipsByType(type: string): RoleRelationship[] {
        const relationships: RoleRelationship[] = [];
        
        for (const relationship of this.relationships.values()) {
            if (relationship.type === type) {
                relationships.push(relationship);
            }
        }
        
        return relationships;
    }

    /**
     * 获取所有关系
     * @returns 所有关系的数组
     */
    getAllRelationships(): RoleRelationship[] {
        return Array.from(this.relationships.values());
    }

    /**
     * 获取所有涉及的角色
     * @returns 所有角色名称的集合
     */
    getAllRoles(): Set<string> {
        return new Set(this.roleIndex.keys());
    }

    /**
     * 清空所有关系
     */
    clear(): void {
        this.relationships.clear();
        this.roleIndex.clear();
        this.roleUuidToNameMap.clear();
    }

    /**
     * 获取关系统计信息
     * @returns 统计信息对象
     */
    getStatistics(): {
        totalRelationships: number;
        totalRoles: number;
        relationshipsByType: Map<string, number>;
    } {
        const relationshipsByType = new Map<string, number>();
        
        for (const relationship of this.relationships.values()) {
            const count = relationshipsByType.get(relationship.type) || 0;
            relationshipsByType.set(relationship.type, count + 1);
        }
        
        return {
            totalRelationships: this.relationships.size,
            totalRoles: this.roleIndex.size,
            relationshipsByType
        };
    }

    /**
     * 批量添加关系
     * @param relationships 关系数组
     * @returns 添加的关系ID数组
     */
    addRelationships(relationships: RoleRelationship[]): string[] {
        return relationships.map(rel => this.addRelationship(rel));
    }

    /**
     * 导出关系数据
     * @returns 关系数据的JSON字符串
     */
    exportToJSON(): string {
        const data = {
            relationships: Array.from(this.relationships.entries()),
            timestamp: new Date().toISOString()
        };
        return JSON.stringify(data, null, 2);
    }

    /**
     * 从JSON数据导入关系
     * @param jsonData JSON字符串
     * @returns 是否导入成功
     */
    importFromJSON(jsonData: string): boolean {
        try {
            const data = JSON.parse(jsonData);
            if (!data.relationships || !Array.isArray(data.relationships)) {
                return false;
            }

            this.clear();
            
            for (const [id, relationship] of data.relationships) {
                this.relationships.set(id, relationship);
                this.updateRoleIndex(relationship.sourceRole, id);
                this.updateRoleIndex(relationship.targetRole, id);
            }
            
            return true;
        } catch (error) {
            console.error('导入关系数据失败:', error);
            return false;
        }
    }

    /**
     * 生成关系ID
     * @param relationship 关系对象
     * @returns 唯一的关系ID
     */
    private generateRelationshipId(relationship: RoleRelationship): string {
        const key = `${relationship.sourceRole}-${relationship.targetRole}-${relationship.type}-${relationship.literalValue}`;
        return Buffer.from(key).toString('base64').replace(/[+/=]/g, '');
    }

    /**
     * 更新角色索引
     * @param roleName 角色名称
     * @param relationshipId 关系ID
     */
    private updateRoleIndex(roleName: string, relationshipId: string): void {
        if (!this.roleIndex.has(roleName)) {
            this.roleIndex.set(roleName, new Set());
        }
        this.roleIndex.get(roleName)!.add(relationshipId);
    }

    /**
     * 从角色索引中移除关系
     * @param roleName 角色名称
     * @param relationshipId 关系ID
     */
    private removeFromRoleIndex(roleName: string, relationshipId: string): void {
        const relationshipIds = this.roleIndex.get(roleName);
        if (relationshipIds) {
            relationshipIds.delete(relationshipId);
            if (relationshipIds.size === 0) {
                this.roleIndex.delete(roleName);
            }
        }
    }
}

// 全局单例实例
export const globalRelationshipManager = new GlobalRelationshipManager();