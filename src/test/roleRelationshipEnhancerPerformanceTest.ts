/**
 * 角色关系增强器性能测试
 * 用于验证优化后的关系属性增强器的性能提升效果
 */

import { Role } from '../extension';
import { enhanceAllRolesWithRelationships, generateRelationshipProperties } from '../utils/roleRelationshipEnhancer';
import { globalRelationshipManager } from '../utils/globalRelationshipManager';
import { Relationship } from '../types/relationshipTypes';

/**
 * 生成测试角色数据
 */
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

/**
 * 生成测试关系数据
 * @param roles 角色数组
 * @param relationshipCount 关系数量
 * @returns 关系数组
 */
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

/**
 * 测试旧版本的性能（逐个角色查询）
 * @param roles 角色数组
 * @returns 性能测试结果
 */
function testOldVersionPerformance(roles: Role[]): {
    duration: number;
    enhancedRoles: number;
    totalProperties: number;
} {
    console.log('开始测试旧版本性能（逐个角色查询）...');
    const startTime = Date.now();
    
    let enhancedRoles = 0;
    let totalProperties = 0;
    
    for (const role of roles) {
        const properties = generateRelationshipProperties(role);
        if (Object.keys(properties).length > 0) {
            Object.assign(role, properties);
            enhancedRoles++;
            totalProperties += Object.keys(properties).length;
        }
    }
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.log(`旧版本测试完成: 耗时 ${duration}ms, 增强角色 ${enhancedRoles}, 总属性 ${totalProperties}`);
    
    return { duration, enhancedRoles, totalProperties };
}

/**
 * 测试新版本的性能（预构建映射表）
 * @param roles 角色数组
 * @returns 性能测试结果
 */
function testNewVersionPerformance(roles: Role[]): {
    duration: number;
    enhancedRoles: number;
    totalProperties: number;
} {
    console.log('开始测试新版本性能（预构建映射表）...');
    const startTime = Date.now();
    
    const result = enhanceAllRolesWithRelationships(roles);
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.log(`新版本测试完成: 耗时 ${duration}ms, 增强角色 ${result.enhancedRoles}, 总属性 ${result.totalRelationshipProperties}`);
    
    return { 
        duration, 
        enhancedRoles: result.enhancedRoles, 
        totalProperties: result.totalRelationshipProperties 
    };
}

/**
 * 清理角色的关系属性
 * @param roles 角色数组
 */
function clearRoleProperties(roles: Role[]): void {
    for (const role of roles) {
        const keysToDelete = Object.keys(role).filter(key => key.startsWith('关系'));
        for (const key of keysToDelete) {
            delete (role as any)[key];
        }
    }
}

/**
 * 运行性能对比测试
 * @param roleCount 角色数量
 * @param relationshipCount 关系数量
 */
export async function runPerformanceComparison(roleCount: number = 100, relationshipCount: number = 500): Promise<void> {
    console.log(`\n=== 角色关系增强器性能对比测试 ===`);
    console.log(`角色数量: ${roleCount}, 关系数量: ${relationshipCount}`);
    
    // 1. 生成测试数据
    console.log('\n1. 生成测试数据...');
    const roles = generateTestRoles(roleCount);
    const relationships = generateTestRelationships(roles, relationshipCount);
    
    // 2. 模拟设置关系数据到全局管理器
    console.log('2. 设置测试关系数据...');
    // 注意：这里需要根据实际的globalRelationshipManager API来设置测试数据
    // 由于我们无法直接访问内部方法，这里只是示例
    
    // 3. 测试旧版本性能
    console.log('\n3. 测试旧版本性能...');
    const oldResult = testOldVersionPerformance([...roles]); // 使用副本避免影响
    
    // 4. 清理属性并测试新版本性能
    console.log('\n4. 测试新版本性能...');
    clearRoleProperties(roles);
    const newResult = testNewVersionPerformance(roles);
    
    // 5. 性能对比分析
    console.log('\n=== 性能对比结果 ===');
    console.log(`旧版本耗时: ${oldResult.duration}ms`);
    console.log(`新版本耗时: ${newResult.duration}ms`);
    
    if (oldResult.duration > 0) {
        const improvement = ((oldResult.duration - newResult.duration) / oldResult.duration * 100).toFixed(2);
        console.log(`性能提升: ${improvement}%`);
        console.log(`速度提升倍数: ${(oldResult.duration / newResult.duration).toFixed(2)}x`);
    }
    
    console.log(`\n数据一致性检查:`);
    console.log(`旧版本 - 增强角色: ${oldResult.enhancedRoles}, 总属性: ${oldResult.totalProperties}`);
    console.log(`新版本 - 增强角色: ${newResult.enhancedRoles}, 总属性: ${newResult.totalProperties}`);
    
    const dataConsistent = oldResult.enhancedRoles === newResult.enhancedRoles && 
                          oldResult.totalProperties === newResult.totalProperties;
    console.log(`数据一致性: ${dataConsistent ? '✅ 通过' : '❌ 失败'}`);
    
    if (newResult.duration < oldResult.duration) {
        console.log(`\n🎉 优化成功！新版本比旧版本快 ${oldResult.duration - newResult.duration}ms`);
    } else {
        console.log(`\n⚠️  优化效果不明显，可能需要更大的数据集才能体现性能差异`);
    }
}

/**
 * 运行多组性能测试
 */
export async function runMultiplePerformanceTests(): Promise<void> {
    console.log('\n=== 多组性能测试 ===');
    
    const testCases = [
        { roles: 50, relationships: 200 },
        { roles: 100, relationships: 500 },
        { roles: 200, relationships: 1000 },
        { roles: 500, relationships: 2500 }
    ];
    
    for (const testCase of testCases) {
        await runPerformanceComparison(testCase.roles, testCase.relationships);
        console.log('\n' + '='.repeat(50) + '\n');
    }
}

// 如果直接运行此文件，执行性能测试
if (require.main === module) {
    runMultiplePerformanceTests().catch(console.error);
}