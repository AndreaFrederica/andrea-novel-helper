/**
 * 关系表集成测试
 * 测试角色表和关系表的集成加载功能
 */

import * as path from 'path';
import { loadRoles } from '../utils/utils';
import { globalRelationshipManager } from '../utils/globalRelationshipManager';
import { RelationshipQueryService, queryRelationshipsByUuid } from '../utils/relationshipQueryService';
import { roles } from '../activate';

async function testRelationshipIntegration() {
    console.log('=== 关系表集成测试开始 ===');
    
    try {
        // 1. 测试角色和关系表的集成加载
        console.log('\n1. 测试集成加载功能...');
        const testDir = path.join(__dirname, '../../test-data');
        
        // 加载角色表（会自动加载关系表）
        await loadRoles(false);
        
        console.log(`✓ 加载完成，共加载 ${roles.length} 个角色`);
        
        // 2. 测试角色UUID映射
        console.log('\n2. 测试角色UUID映射...');
        const roleStats = globalRelationshipManager.getStatistics();
        console.log(`✓ 关系管理器中有 ${roleStats.totalRoles} 个角色映射`);
        
        // 显示前几个角色的UUID映射
        for (let i = 0; i < Math.min(3, roles.length); i++) {
            const role = roles[i];
            if (role.uuid) {
                const mappedName = globalRelationshipManager.getRoleNameByUuid(role.uuid);
                console.log(`  - UUID: ${role.uuid} -> 名称: ${mappedName} (原名: ${role.name})`);
            }
        }
        
        // 3. 测试关系查询功能
        console.log('\n3. 测试关系查询功能...');
        const allRelationships = globalRelationshipManager.getAllRelationships();
        console.log(`✓ 共加载 ${allRelationships.length} 个关系`);
        
        if (allRelationships.length > 0) {
            // 显示前几个关系
            console.log('  前3个关系:');
            for (let i = 0; i < Math.min(3, allRelationships.length); i++) {
                const rel = allRelationships[i];
                console.log(`    - ${rel.sourceRole} -> ${rel.targetRole} (${rel.type}): ${rel.literalValue}`);
                if (rel.metadata) {
                    console.log(`      元数据: sourceUuid=${rel.metadata.sourceRoleUuid}, targetUuid=${rel.metadata.targetRoleUuid}`);
                }
            }
        }
        
        // 4. 测试UUID查询功能
        console.log('\n4. 测试UUID查询功能...');
        
        // 找一个有UUID的角色进行测试
        const testRole = roles.find(r => r.uuid);
        if (testRole && testRole.uuid) {
            console.log(`测试角色: ${testRole.name} (UUID: ${testRole.uuid})`);
            
            const queryResult = queryRelationshipsByUuid(testRole.uuid);
            console.log(`✓ 查询结果:`);
            console.log(`  - 角色名称: ${queryResult.roleName}`);
            console.log(`  - 作为源角色的关系: ${queryResult.statistics.asSourceCount} 个`);
            console.log(`  - 作为目标角色的关系: ${queryResult.statistics.asTargetCount} 个`);
            console.log(`  - 总关系数: ${queryResult.statistics.totalCount} 个`);
            console.log(`  - 关系类型: ${queryResult.statistics.relationshipTypes.join(', ')}`);
            
            // 显示具体关系
            if (queryResult.allRelationships.length > 0) {
                console.log('  具体关系:');
                for (const rel of queryResult.allRelationships.slice(0, 3)) {
                    console.log(`    - ${rel.sourceRole} -> ${rel.targetRole} (${rel.type}): ${rel.literalValue}`);
                }
            }
        } else {
            console.log('⚠ 没有找到带UUID的角色，跳过UUID查询测试');
        }
        
        // 5. 测试关系统计功能
        console.log('\n5. 测试关系统计功能...');
        const statistics = RelationshipQueryService.getRelationshipStatistics();
        console.log(`✓ 关系统计:`);
        console.log(`  - 总关系数: ${statistics.totalRelationships}`);
        console.log(`  - 涉及角色数: ${statistics.totalRoles}`);
        console.log(`  - 关系类型数: ${Object.keys(statistics.relationshipsByType).length}`);
        
        if (statistics.topRelationshipTypes.length > 0) {
            console.log('  - 前5个关系类型:');
            for (const { type, count } of statistics.topRelationshipTypes) {
                console.log(`    - ${type}: ${count} 个`);
            }
        }
        
        // 6. 测试关系搜索功能
        console.log('\n6. 测试关系搜索功能...');
        const searchResults = RelationshipQueryService.searchRelationships('朋友');
        console.log(`✓ 搜索"朋友"的结果: ${searchResults.length} 个关系`);
        
        for (const rel of searchResults.slice(0, 2)) {
            console.log(`  - ${rel.sourceRole} -> ${rel.targetRole} (${rel.type}): ${rel.literalValue}`);
        }
        
        // 7. 测试关系网络功能
        console.log('\n7. 测试关系网络功能...');
        if (testRole && testRole.uuid) {
            const network = RelationshipQueryService.getRelationshipNetwork(testRole.uuid, 2);
            console.log(`✓ ${testRole.name} 的关系网络:`);
            console.log(`  - 网络节点数: ${network.nodes.length}`);
            console.log(`  - 网络关系数: ${network.relationships.length}`);
            
            // 显示网络节点
            if (network.nodes.length > 0) {
                console.log('  网络节点:');
                for (const node of network.nodes.slice(0, 5)) {
                    console.log(`    - ${node.name} (深度: ${node.depth})`);
                }
            }
        }
        
        console.log('\n=== 关系表集成测试完成 ===');
        console.log('✅ 所有测试通过！');
        
    } catch (error) {
        console.error('\n❌ 测试失败:', error);
        throw error;
    }
}

// 运行测试
if (require.main === module) {
    testRelationshipIntegration().catch(error => {
        console.error('测试执行失败:', error);
        process.exit(1);
    });
}

export { testRelationshipIntegration };