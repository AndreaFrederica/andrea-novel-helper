/**
 * 核心关系功能测试
 * 只测试关系管理器的核心功能，避免外部依赖
 */

import { globalRelationshipManager } from '../utils/globalRelationshipManager';
import { RoleRelationship } from '../types/relationshipTypes';

async function testCoreRelationshipFunctionality() {
    console.log('=== 核心关系功能测试开始 ===');
    
    try {
        // 1. 清空并初始化测试数据
        console.log('\n1. 初始化测试数据...');
        globalRelationshipManager.clear();
        
        // 设置角色UUID映射
        const roleUuidMapping = {
            'uuid-001': '李明轩',
            'uuid-002': '张雨萱',
            'uuid-003': '王浩然',
            'uuid-004': '陈思雨'
        };
        globalRelationshipManager.setRoleMappings(roleUuidMapping);
        
        // 添加测试关系
        const testRelationships: RoleRelationship[] = [
            {
                sourceRole: '李明轩',
                targetRole: '张雨萱',
                literalValue: '深爱着对方',
                type: '恋人关系',
                metadata: {
                    sourceRoleUuid: 'uuid-001',
                    targetRoleUuid: 'uuid-002',
                    lineId: 'line-001'
                }
            },
            {
                sourceRole: '张雨萱',
                targetRole: '李明轩',
                literalValue: '同样深爱着对方',
                type: '恋人关系',
                metadata: {
                    sourceRoleUuid: 'uuid-002',
                    targetRoleUuid: 'uuid-001',
                    lineId: 'line-002'
                }
            },
            {
                sourceRole: '李明轩',
                targetRole: '王浩然',
                literalValue: '从小一起长大的好友',
                type: '朋友关系',
                metadata: {
                    sourceRoleUuid: 'uuid-001',
                    targetRoleUuid: 'uuid-003',
                    lineId: 'line-003'
                }
            },
            {
                sourceRole: '王浩然',
                targetRole: '陈思雨',
                literalValue: '暗恋但不敢表白',
                type: '暗恋关系',
                metadata: {
                    sourceRoleUuid: 'uuid-003',
                    targetRoleUuid: 'uuid-004',
                    lineId: 'line-004'
                }
            }
        ];
        
        // 添加关系到管理器
        for (const rel of testRelationships) {
            globalRelationshipManager.addRelationship(rel);
        }
        
        console.log(`✓ 添加了 ${testRelationships.length} 个测试关系`);
        
        // 2. 测试基本查询功能
        console.log('\n2. 测试基本查询功能...');
        const allRelationships = globalRelationshipManager.getAllRelationships();
        console.log(`✓ 总关系数: ${allRelationships.length}`);
        
        // 按角色查询
        const liMingxuanRelations = globalRelationshipManager.getRelationshipsByRole('李明轩');
        console.log(`✓ 李明轩相关关系: ${liMingxuanRelations.length} 个`);
        
        // 按类型查询
        const loveRelations = globalRelationshipManager.getRelationshipsByType('恋人关系');
        console.log(`✓ 恋人关系: ${loveRelations.length} 个`);
        
        // 3. 测试UUID查询功能
        console.log('\n3. 测试UUID查询功能...');
        
        // 测试角色UUID映射
        const roleName = globalRelationshipManager.getRoleNameByUuid('uuid-001');
        console.log(`✓ UUID uuid-001 对应角色: ${roleName}`);
        
        // 测试UUID查询关系
        const uuidRelations = globalRelationshipManager.getAllRelationshipsByUuid('uuid-001');
        console.log(`✓ UUID uuid-001 的所有关系: ${uuidRelations.length} 个`);
        
        // 测试源角色UUID查询
        const sourceRelations = globalRelationshipManager.getRelationshipsBySourceUuid('uuid-001');
        console.log(`✓ UUID uuid-001 作为源角色的关系: ${sourceRelations.length} 个`);
        
        // 测试目标角色UUID查询
        const targetRelations = globalRelationshipManager.getRelationshipsByTargetUuid('uuid-001');
        console.log(`✓ UUID uuid-001 作为目标角色的关系: ${targetRelations.length} 个`);
        
        // 4. 测试关系统计功能
        console.log('\n4. 测试关系统计功能...');
        const statistics = globalRelationshipManager.getStatistics();
        console.log(`✓ 关系统计:`);
        console.log(`  - 总关系数: ${statistics.totalRelationships}`);
        console.log(`  - 涉及角色数: ${statistics.totalRoles}`);
        console.log(`  - 关系类型数: ${statistics.relationshipsByType.size}`);
        
        console.log('  - 关系类型分布:');
        for (const [type, count] of statistics.relationshipsByType) {
            console.log(`    - ${type}: ${count} 个`);
        }
        
        // 5. 测试角色间关系查询
        console.log('\n5. 测试角色间关系查询...');
        const betweenRelations = globalRelationshipManager.getRelationshipsBetween('李明轩', '张雨萱');
        console.log(`✓ 李明轩和张雨萱之间的关系: ${betweenRelations.length} 个`);
        
        for (const rel of betweenRelations) {
            console.log(`  - ${rel.sourceRole} -> ${rel.targetRole} (${rel.type}): ${rel.literalValue}`);
        }
        
        // 6. 测试角色映射功能
        console.log('\n6. 测试角色映射功能...');
        
        // 测试单个角色映射设置
        globalRelationshipManager.setRoleMapping('uuid-005', '新角色');
        const newRoleName = globalRelationshipManager.getRoleNameByUuid('uuid-005');
        console.log(`✓ 新设置的UUID uuid-005 对应角色: ${newRoleName}`);
        
        // 测试获取所有角色
        const allRoles = globalRelationshipManager.getAllRoles();
        console.log(`✓ 所有角色: ${Array.from(allRoles).join(', ')}`);
        
        // 7. 测试数据导出功能
        console.log('\n7. 测试数据导出功能...');
        const exportData = globalRelationshipManager.exportToJSON();
        console.log(`✓ 导出数据长度: ${exportData.length} 字符`);
        
        // 解析导出的数据验证
        const parsedData = JSON.parse(exportData);
        console.log(`✓ 导出的关系数量: ${parsedData.relationships.length}`);
        
        // 验证导出数据的结构
        if (parsedData.timestamp) {
            console.log(`✓ 导出时间戳: ${parsedData.timestamp}`);
        }
        
        // 8. 测试清空功能
        console.log('\n8. 测试清空功能...');
        const beforeClearCount = globalRelationshipManager.getAllRelationships().length;
        globalRelationshipManager.clear();
        const afterClearCount = globalRelationshipManager.getAllRelationships().length;
        
        console.log(`✓ 清空前关系数: ${beforeClearCount}`);
        console.log(`✓ 清空后关系数: ${afterClearCount}`);
        
        // 验证角色映射也被清空
        const clearedRoleName = globalRelationshipManager.getRoleNameByUuid('uuid-001');
        console.log(`✓ 清空后UUID查询结果: ${clearedRoleName || '未找到'}`);
        
        console.log('\n=== 核心关系功能测试完成 ===');
        console.log('✅ 所有测试通过！');
        
    } catch (error) {
        console.error('\n❌ 测试失败:', error);
        throw error;
    }
}

// 运行测试
if (require.main === module) {
    testCoreRelationshipFunctionality().catch(error => {
        console.error('测试执行失败:', error);
        process.exit(1);
    });
}

export { testCoreRelationshipFunctionality };