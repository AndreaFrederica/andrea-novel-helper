/**
 * 测试新的关系属性格式
 */

import { Role } from '../Provider/view/roleCradManager/role-converter';
import { RoleRelationship } from '../types/relationshipTypes';

// Mock 接口定义
interface MockRole extends Role {
    uuid: string;
    name: string;
    type: string;
    affiliation?: string;
    aliases?: string[];
    description?: string;
    color?: string;
    wordSegmentFilter?: boolean; // 修正为boolean类型
    packagePath?: string;
    sourcePath?: string;
    regex?: string;
    regexFlags?: string;
    priority?: number;
}

interface MockRoleRelationship extends RoleRelationship {
    id?: string;
    sourceRole: string;
    targetRole: string;
    type: string;
    literalValue: string; // 修正为必需的string类型
    metadata?: {
        sourceRoleUuid?: string;
        targetRoleUuid?: string;
    };
}

// Mock 关系映射接口
interface RoleRelationshipMapping {
    roleUuid: string;
    roleName: string;
    relationshipsByType: Map<string, MockRoleRelationship[]>;
    allRelationships: MockRoleRelationship[];
}

// Mock 配置接口
interface RelationshipPropertyConfig {
    keyPrefix?: string;
    includeType?: boolean;
    includeLiteralValue?: boolean;
    valueSeparator?: string;
    relationshipConnector?: string;
}

// 默认配置
const DEFAULT_CONFIG: Required<RelationshipPropertyConfig> = {
    keyPrefix: '关系',
    includeType: true,
    includeLiteralValue: true,
    valueSeparator: '值为',
    relationshipConnector: '+'
};

// 新的关系属性生成函数
function generateRelationshipPropertiesFromMapping(
    role: MockRole,
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
        let relationshipValue = `关系对象角色（${targetRoleName}）`;
        
        if (finalConfig.includeLiteralValue && rel.literalValue) {
            relationshipValue += ` ${finalConfig.relationshipConnector}${rel.literalValue}`;
        }
        
        // 构建属性键：关系-数字id（自增）（xx关系（类型））
        let propertyKey = `${finalConfig.keyPrefix}-${relationshipIndex}（${rel.type}关系（类型））`;
        
        relationshipProperties[propertyKey] = relationshipValue;
        relationshipIndex++;
    }

    return relationshipProperties;
}

// 生成测试数据
function generateTestData(): { role: MockRole, mapping: RoleRelationshipMapping } {
    const role: MockRole = {
        uuid: 'role-001',
        name: 'Andrea',
        type: '主角',
        affiliation: '学院',
        description: '女主角'
    };

    const relationships: MockRoleRelationship[] = [
        {
            id: 'rel-001',
            sourceRole: 'Andrea',
            targetRole: '李华',
            type: '朋友',
            literalValue: '好朋友',
            metadata: {
                sourceRoleUuid: 'role-001',
                targetRoleUuid: 'role-002'
            }
        },
        {
            id: 'rel-002',
            sourceRole: 'Andrea',
            targetRole: '张三',
            type: '同学',
            literalValue: '同班同学',
            metadata: {
                sourceRoleUuid: 'role-001',
                targetRoleUuid: 'role-003'
            }
        },
        {
            id: 'rel-003',
            sourceRole: '王五',
            targetRole: 'Andrea',
            type: '师生',
            literalValue: '老师',
            metadata: {
                sourceRoleUuid: 'role-004',
                targetRoleUuid: 'role-001'
            }
        },
        {
            id: 'rel-004',
            sourceRole: 'Andrea',
            targetRole: '赵六',
            type: '朋友',
            literalValue: '闺蜜',
            metadata: {
                sourceRoleUuid: 'role-001',
                targetRoleUuid: 'role-005'
            }
        }
    ];

    const relationshipsByType = new Map<string, MockRoleRelationship[]>();
    relationships.forEach(rel => {
        if (!relationshipsByType.has(rel.type)) {
            relationshipsByType.set(rel.type, []);
        }
        relationshipsByType.get(rel.type)!.push(rel);
    });

    const mapping: RoleRelationshipMapping = {
        roleUuid: role.uuid,
        roleName: role.name,
        relationshipsByType,
        allRelationships: relationships
    };

    return { role, mapping };
}

// 运行测试
function runTest() {
    console.log('=== 关系属性格式测试 ===\n');
    
    const { role, mapping } = generateTestData();
    
    console.log(`测试角色: ${role.name} (UUID: ${role.uuid})`);
    console.log(`关系总数: ${mapping.allRelationships.length}\n`);
    
    // 测试新格式
    const properties = generateRelationshipPropertiesFromMapping(role, mapping);
    
    console.log('生成的关系属性:');
    console.log('================');
    
    Object.entries(properties).forEach(([key, value]) => {
        console.log(`${key}: ${value}`);
    });
    
    console.log('\n验证结果:');
    console.log('=========');
    
    // 验证每个关系都有独立的key
    const keys = Object.keys(properties);
    console.log(`✓ 生成了 ${keys.length} 个独立的关系属性`);
    
    // 验证key格式
    const keyFormatRegex = /^关系-\d+（.+关系（类型））$/;
    const validKeys = keys.filter(key => keyFormatRegex.test(key));
    console.log(`✓ ${validKeys.length}/${keys.length} 个key符合格式要求`);
    
    // 验证自增ID
    const ids = keys.map(key => {
        const match = key.match(/^关系-(\d+)/);
        return match ? parseInt(match[1]) : 0;
    }).sort((a, b) => a - b);
    
    const expectedIds = Array.from({ length: keys.length }, (_, i) => i + 1);
    const idsMatch = JSON.stringify(ids) === JSON.stringify(expectedIds);
    console.log(`✓ 自增ID正确: ${idsMatch ? '是' : '否'} (${ids.join(', ')})`);
    
    // 验证包含目标角色和字面值
    const valuesWithTarget = Object.values(properties).filter(value => 
        value.includes('关系对象角色（') && value.includes('）')
    );
    console.log(`✓ ${valuesWithTarget.length}/${Object.values(properties).length} 个值包含目标角色`);
    
    const valuesWithLiteral = Object.values(properties).filter(value => 
        value.includes('+')
    );
    console.log(`✓ ${valuesWithLiteral.length}/${Object.values(properties).length} 个值包含字面值`);
    
    console.log('\n测试完成！');
}

// 运行测试
runTest();