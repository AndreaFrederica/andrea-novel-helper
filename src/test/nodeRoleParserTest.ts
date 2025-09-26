import { NodeRoleParser } from '../utils/nodeRoleParser';
import { globalRelationshipManager } from '../utils/globalRelationshipManager';

/**
 * 节点角色解析器测试
 */
async function testNodeRoleParser() {
  console.log('=== 节点角色解析器测试 ===\n');

  const parser = new NodeRoleParser();
  
  try {
    // 清空全局关系管理器
    globalRelationshipManager.clear();
    
    // 测试1: 从文件解析关系
    console.log('测试1: 从文件解析关系');
    const relationships = await parser.parseFromFile('./test/test-relationship.rjson5');
    
    console.log(`解析出 ${relationships.length} 个关系:`);
    relationships.forEach((rel, index) => {
      console.log(`  ${index + 1}. ${rel.sourceRole} -> ${rel.targetRole}`);
      console.log(`     字面值: ${rel.literalValue}`);
      console.log(`     类型: ${rel.type}`);
      console.log(`     元数据: ${JSON.stringify(rel.metadata, null, 2)}`);
      console.log('');
    });

    // 测试2: 检查全局关系管理器
    console.log('测试2: 检查全局关系管理器');
    const allRelationships = globalRelationshipManager.getAllRelationships();
    console.log(`全局关系管理器中有 ${allRelationships.length} 个关系`);
    
    // 测试3: 按角色查询关系
    console.log('测试3: 按角色查询关系');
    const liMingxuanRelations = globalRelationshipManager.getRelationshipsByRole('李明轩');
    console.log(`李明轩相关的关系有 ${liMingxuanRelations.length} 个:`);
    liMingxuanRelations.forEach((rel, index) => {
      console.log(`  ${index + 1}. ${rel.sourceRole} -> ${rel.targetRole}: ${rel.literalValue}`);
    });

    // 测试4: 按类型查询关系
    console.log('\\n测试4: 按类型查询关系');
    const romanticRelations = globalRelationshipManager.getRelationshipsByType('恋人关系');
    console.log(`恋人关系有 ${romanticRelations.length} 个:`);
    romanticRelations.forEach((rel, index) => {
      console.log(`  ${index + 1}. ${rel.sourceRole} -> ${rel.targetRole}: ${rel.literalValue}`);
    });

    // 测试5: 获取统计信息
    console.log('\\n测试5: 获取统计信息');
    const stats = globalRelationshipManager.getStatistics();
    console.log('关系统计:');
    console.log(`  总关系数: ${stats.totalRelationships}`);
    console.log(`  涉及角色数: ${stats.totalRoles}`);
    console.log('  按类型分布:');
    stats.relationshipsByType.forEach((count, type) => {
      console.log(`    ${type}: ${count}`);
    });

    // 测试6: 节点查找功能
    console.log('\\n测试6: 节点查找功能');
    console.log(`解析的节点数量: ${parser.getNodeCount()}`);
    
    const liMingxuanNodes = parser.findNodesByRoleName('李明轩');
    console.log(`找到名为"李明轩"的节点 ${liMingxuanNodes.length} 个`);
    
    if (liMingxuanNodes.length > 0) {
      const node = liMingxuanNodes[0];
      console.log(`  节点ID: ${node.id}`);
      console.log(`  角色UUID: ${node.data.roleUuid}`);
      console.log(`  角色文本: ${node.data.text}`);
    }

    // 测试7: 导出关系数据
    console.log('\\n测试7: 导出关系数据');
    const exportData = globalRelationshipManager.exportToJSON();
    console.log('导出的关系数据:');
    console.log(exportData);

    console.log('\\n=== 所有测试完成 ===');

  } catch (error) {
    console.error('测试过程中发生错误:', error);
  }
}

// 运行测试
testNodeRoleParser().catch(console.error);