# 关系表功能使用指南

## 概述

Novel Helper 现在支持自动加载和管理角色关系表，可以帮助作者更好地组织和查询角色之间的关系。

## 支持的文件格式

关系表文件支持以下格式：
- `.rjson5` - 推荐格式，支持注释和更灵活的语法
- `.json5` - 标准JSON5格式
- `.rjson` - 关系专用JSON格式

## 文件命名规则

关系表文件需要包含以下关键词之一：
- `relationship` (关系)
- `relation` (关系)
- `人物关系`
- `角色关系`
- `关系表`

示例文件名：
- `character-relationships.rjson5`
- `人物关系表.json5`
- `main-story-relations.rjson`

## 关系数据格式

### 基本结构

```json5
{
  "relationships": [
    {
      "sourceRoleUuid": "uuid-001",
      "targetRoleUuid": "uuid-002", 
      "relationshipType": "恋人关系",
      "description": "深爱着对方",
      "strength": 10,
      "isPublic": true,
      "tags": ["主要", "浪漫"],
      "metadata": {
        "startChapter": 1,
        "developmentStage": "热恋期"
      }
    }
  ]
}
```

### 字段说明

- `sourceRoleUuid`: 源角色的UUID（必填）
- `targetRoleUuid`: 目标角色的UUID（必填）
- `relationshipType`: 关系类型（必填）
- `description`: 关系描述（可选）
- `strength`: 关系强度，1-10（可选）
- `isPublic`: 是否公开关系（可选）
- `tags`: 关系标签数组（可选）
- `metadata`: 额外元数据（可选）

## 自动加载机制

关系表会在以下情况下自动加载：
1. 启动时与角色表一起加载
2. 文件变更时增量更新
3. 手动刷新角色时重新加载

## 查询功能

### 基本查询

```typescript
import { globalRelationshipManager } from '../utils/globalRelationshipManager';

// 获取所有关系
const allRelationships = globalRelationshipManager.getAllRelationships();

// 按角色名查询
const roleRelationships = globalRelationshipManager.getRelationshipsByRole('李明轩');

// 按关系类型查询
const loveRelationships = globalRelationshipManager.getRelationshipsByType('恋人关系');
```

### UUID查询

```typescript
// 按角色UUID查询所有关系
const uuidRelationships = globalRelationshipManager.getRelationshipsByRoleUuid('uuid-001');

// 查询作为源角色的关系
const sourceRelationships = globalRelationshipManager.getRelationshipsBySourceUuid('uuid-001');

// 查询作为目标角色的关系
const targetRelationships = globalRelationshipManager.getRelationshipsByTargetUuid('uuid-001');
```

### 高级查询服务

```typescript
import * as RelationshipQueryService from '../utils/relationshipQueryService';

// 获取关系统计
const stats = RelationshipQueryService.getRelationshipStatistics();

// 搜索关系
const searchResults = RelationshipQueryService.searchRelationships('恋人');

// 获取关系网络
const network = RelationshipQueryService.getRelationshipNetwork('李明轩', 2);
```

## 最佳实践

### 1. 文件组织
- 将关系表文件放在角色设定目录中
- 使用清晰的命名约定
- 按故事章节或角色群体分组

### 2. 数据维护
- 保持UUID的一致性
- 使用有意义的关系类型名称
- 定期更新关系强度和描述

### 3. 性能优化
- 避免创建过多的细粒度关系
- 使用标签来分类关系
- 合理使用元数据字段

## 故障排除

### 常见问题

1. **关系表未加载**
   - 检查文件名是否包含关键词
   - 确认文件格式是否正确
   - 查看控制台错误信息

2. **UUID不匹配**
   - 确保角色UUID在角色表中存在
   - 检查UUID格式是否正确
   - 验证角色映射是否建立

3. **查询结果为空**
   - 确认关系数据已正确加载
   - 检查查询参数是否正确
   - 验证角色名称拼写

### 调试方法

```typescript
// 检查关系管理器状态
console.log('总关系数:', globalRelationshipManager.getAllRelationships().length);
console.log('涉及角色:', globalRelationshipManager.getAllRoles());

// 获取统计信息
const stats = globalRelationshipManager.getStatistics();
console.log('关系统计:', stats);
```

## 示例文件

参考 `test/test-relationship.rjson5` 文件查看完整的关系表示例。

## 更新日志

- v1.0.0: 初始版本，支持基本的关系加载和查询功能
- v1.1.0: 添加UUID查询和高级查询服务
- v1.2.0: 支持增量更新和关系网络分析