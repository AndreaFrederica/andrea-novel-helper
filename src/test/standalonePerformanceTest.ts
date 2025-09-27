/**
 * 独立的关系属性增强器性能测试
 * 不依赖VSCode环境，可以直接运行
 */

// 模拟Role接口
interface Role {
    name: string;
    type: string;
    uuid?: string;
    description?: string;
}

// 模拟RoleRelationship接口
interface RoleRelationship {
    sourceRole: string;
    targetRole: string;
    type: string;
    literalValue?: string;
    metadata?: {
        sourceRoleUuid?: string;
        targetRoleUuid?: string;
        strength?: number;
    };
}

// 模拟Relationship接口
interface Relationship extends RoleRelationship {
    id?: string;
}

// 模拟全局关系管理器
class MockGlobalRelationshipManager {
    private relationships = new Map<string, Relationship>();
    private roleUuidToName = new Map<string, string>();

    addRelationship(relationship: Relationship): void {
        const id = relationship.id || this.generateId();
        this.relationships.set(id, { ...relationship, id });
        
        // 更新UUID到名称的映射
        if (relationship.metadata?.sourceRoleUuid) {
            this.roleUuidToName.set(relationship.metadata.sourceRoleUuid, relationship.sourceRole);
        }
        if (relationship.metadata?.targetRoleUuid) {
            this.roleUuidToName.set(relationship.metadata.targetRoleUuid, relationship.targetRole);
        }
    }

    getAllRelationshipsByUuid(uuid: string): Relationship[] {
        return Array.from(this.relationships.values()).filter(rel => 
            rel.metadata?.sourceRoleUuid === uuid || rel.metadata?.targetRoleUuid === uuid
        );
    }

    getRoleNameByUuid(uuid: string): string | undefined {
        return this.roleUuidToName.get(uuid);
    }

    clear(): void {
        this.relationships.clear();
        this.roleUuidToName.clear();
    }

    private generateId(): string {
        return `rel-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
}

// 模拟关系查询服务
class MockRelationshipQueryService {
    static queryByRoleUuid(uuid: string) {
        const relationships = mockGlobalRelationshipManager.getAllRelationshipsByUuid(uuid);
        const roleName = mockGlobalRelationshipManager.getRoleNameByUuid(uuid);
        
        return {
            roleName: roleName || 'Unknown',
            allRelationships: relationships,
            asSourceRelationships: relationships.filter(rel => rel.metadata?.sourceRoleUuid === uuid),
            asTargetRelationships: relationships.filter(rel => rel.metadata?.targetRoleUuid === uuid),
            statistics: {
                totalCount: relationships.length,
                asSourceCount: relationships.filter(rel => rel.metadata?.sourceRoleUuid === uuid).length,
                asTargetCount: relationships.filter(rel => rel.metadata?.targetRoleUuid === uuid).length
            }
        };
    }
}

// 全局实例
const mockGlobalRelationshipManager = new MockGlobalRelationshipManager();

// 配置接口
interface RelationshipPropertyConfig {
    keyPrefix?: string;
    includeType?: boolean;
    includeLiteralValue?: boolean;
    valueSeparator?: string;
    relationshipConnector?: string;
}

const DEFAULT_CONFIG: Required<RelationshipPropertyConfig> = {
    keyPrefix: '关系',
    includeType: true,
    includeLiteralValue: true,
    valueSeparator: '值为',
    relationshipConnector: '+'
};

// 旧版本：逐个查询的方法
function generateRelationshipPropertiesOld(role: Role, config: RelationshipPropertyConfig = {}): Record<string, string> {
    const finalConfig = { ...DEFAULT_CONFIG, ...config };
    const relationshipProperties: Record<string, string> = {};

    if (!role.uuid) {
        return relationshipProperties;
    }

    const queryResult = MockRelationshipQueryService.queryByRoleUuid(role.uuid);
    
    if (queryResult.allRelationships.length === 0) {
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
        const relationshipValues: string[] = [];
        
        for (const rel of relationships) {
            const isSource = rel.metadata?.sourceRoleUuid === role.uuid;
            const targetRoleUuid = isSource ? rel.metadata?.targetRoleUuid : rel.metadata?.sourceRoleUuid;
            const targetRoleName = targetRoleUuid ? mockGlobalRelationshipManager.getRoleNameByUuid(targetRoleUuid) : 'Unknown';
            
            let relationshipValue = `关系对象角色（${targetRoleName}）`;
            
            if (finalConfig.includeLiteralValue && rel.literalValue) {
                relationshipValue += ` ${finalConfig.relationshipConnector}${rel.literalValue}`;
            }
            
            relationshipValues.push(relationshipValue);
        }
        
        // 构建属性键
        let propertyKey = finalConfig.keyPrefix;
        
        if (finalConfig.includeType) {
            propertyKey += ` (${relationshipType}关系 (类型) ${finalConfig.valueSeparator} `;
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

// 新版本：使用映射表的优化方法
function buildRoleRelationshipMapping(roles: Role[]): Map<string, Relationship[]> {
    const mapping = new Map<string, Relationship[]>();
    
    // 初始化所有角色的映射
    for (const role of roles) {
        if (role.uuid) {
            mapping.set(role.uuid, []);
        }
    }
    
    // 获取所有关系并分配到对应的角色
    for (const role of roles) {
        if (role.uuid) {
            const relationships = mockGlobalRelationshipManager.getAllRelationshipsByUuid(role.uuid);
            mapping.set(role.uuid, relationships);
        }
    }
    
    return mapping;
}

function generateRelationshipPropertiesFromMapping(
    role: Role, 
    relationshipMapping: Map<string, Relationship[]>,
    config: RelationshipPropertyConfig = {}
): Record<string, string> {
    const finalConfig = { ...DEFAULT_CONFIG, ...config };
    const relationshipProperties: Record<string, string> = {};

    if (!role.uuid) {
        return relationshipProperties;
    }

    const relationships = relationshipMapping.get(role.uuid) || [];
    
    if (relationships.length === 0) {
        return relationshipProperties;
    }

    // 按关系类型分组
    const relationshipsByType = new Map<string, RoleRelationship[]>();
    
    for (const relationship of relationships) {
        const type = relationship.type;
        if (!relationshipsByType.has(type)) {
            relationshipsByType.set(type, []);
        }
        relationshipsByType.get(type)!.push(relationship);
    }

    // 为每种关系类型生成属性键
    for (const [relationshipType, relationships] of relationshipsByType) {
        const relationshipValues: string[] = [];
        
        for (const rel of relationships) {
            const isSource = rel.metadata?.sourceRoleUuid === role.uuid;
            const targetRoleUuid = isSource ? rel.metadata?.targetRoleUuid : rel.metadata?.sourceRoleUuid;
            const targetRoleName = targetRoleUuid ? mockGlobalRelationshipManager.getRoleNameByUuid(targetRoleUuid) : 'Unknown';
            
            let relationshipValue = `关系对象角色（${targetRoleName}）`;
            
            if (finalConfig.includeLiteralValue && rel.literalValue) {
                relationshipValue += ` ${finalConfig.relationshipConnector}${rel.literalValue}`;
            }
            
            relationshipValues.push(relationshipValue);
        }
        
        // 构建属性键
        let propertyKey = finalConfig.keyPrefix;
        
        if (finalConfig.includeType) {
            propertyKey += ` (${relationshipType}关系 (类型) ${finalConfig.valueSeparator} `;
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

// 生成测试数据
function generateTestRoles(count: number): Role[] {
    const roles: Role[] = [];
    for (let i = 0; i < count; i++) {
        roles.push({
            name: `测试角色${i}`,
            type: '主角',
            uuid: `test-uuid-${i}`,
            description: `这是测试角色${i}的描述`
        });
    }
    return roles;
}

function generateTestRelationships(roles: Role[], relationshipCount: number): Relationship[] {
    const relationships: Relationship[] = [];
    const relationshipTypes = ['朋友', '敌人', '恋人', '同事', '师生', '亲属'];
    
    for (let i = 0; i < relationshipCount; i++) {
        const sourceRole = roles[Math.floor(Math.random() * roles.length)];
        const targetRole = roles[Math.floor(Math.random() * roles.length)];
        
        // 避免自己和自己的关系
        if (sourceRole.uuid === targetRole.uuid) {
            continue;
        }
        
        relationships.push({
            id: `test-rel-${i}`,
            sourceRole: sourceRole.name,
            targetRole: targetRole.name,
            type: relationshipTypes[Math.floor(Math.random() * relationshipTypes.length)],
            literalValue: `关系描述${i}`,
            metadata: {
                sourceRoleUuid: sourceRole.uuid!,
                targetRoleUuid: targetRole.uuid!,
                strength: Math.floor(Math.random() * 10) + 1
            }
        });
    }
    
    return relationships;
}

// 性能测试函数
function testOldPerformance(roles: Role[]): { duration: number; propertiesCount: number } {
    const startTime = performance.now();
    let totalProperties = 0;
    
    for (const role of roles) {
        const properties = generateRelationshipPropertiesOld(role);
        totalProperties += Object.keys(properties).length;
    }
    
    const endTime = performance.now();
    return {
        duration: endTime - startTime,
        propertiesCount: totalProperties
    };
}

function testNewPerformance(roles: Role[]): { duration: number; propertiesCount: number } {
    const startTime = performance.now();
    
    // 构建映射表
    const relationshipMapping = buildRoleRelationshipMapping(roles);
    
    let totalProperties = 0;
    
    for (const role of roles) {
        const properties = generateRelationshipPropertiesFromMapping(role, relationshipMapping);
        totalProperties += Object.keys(properties).length;
    }
    
    const endTime = performance.now();
    return {
        duration: endTime - startTime,
        propertiesCount: totalProperties
    };
}

// 运行性能测试
function runPerformanceTest() {
    console.log('🚀 开始关系属性增强器性能测试...\n');
    
    const testCases = [
        { roles: 50, relationships: 200 },
        { roles: 100, relationships: 500 },
        { roles: 200, relationships: 1000 },
        { roles: 500, relationships: 2500 }
    ];
    
    for (const testCase of testCases) {
        console.log(`📊 测试用例: ${testCase.roles} 个角色, ${testCase.relationships} 个关系`);
        
        // 清理之前的数据
        mockGlobalRelationshipManager.clear();
        
        // 生成测试数据
        const roles = generateTestRoles(testCase.roles);
        const relationships = generateTestRelationships(roles, testCase.relationships);
        
        // 添加关系到管理器
        for (const relationship of relationships) {
            mockGlobalRelationshipManager.addRelationship(relationship);
        }
        
        // 测试旧版本性能
        const oldResult = testOldPerformance(roles);
        
        // 测试新版本性能
        const newResult = testNewPerformance(roles);
        
        // 计算性能提升
        const speedup = oldResult.duration / newResult.duration;
        const improvement = ((oldResult.duration - newResult.duration) / oldResult.duration * 100).toFixed(1);
        
        console.log(`  ⏱️  旧版本耗时: ${oldResult.duration.toFixed(2)}ms`);
        console.log(`  ⚡ 新版本耗时: ${newResult.duration.toFixed(2)}ms`);
        console.log(`  📈 性能提升: ${speedup.toFixed(2)}x (提升 ${improvement}%)`);
        console.log(`  🔢 生成属性数量: ${oldResult.propertiesCount} (旧) vs ${newResult.propertiesCount} (新)`);
        console.log('');
    }
    
    console.log('✅ 性能测试完成！');
}

// 运行测试
runPerformanceTest();