# 角色关系编辑器节点文本同步问题分析与解决方案

## 问题描述

在角色关系编辑器中，节点的 `text` 属性与 `data.text` 属性出现不一致的情况：
- 节点的 `text` 属性：'阿黛尔'
- 节点的 `data.text` 属性：'张小虎'

## 根本原因分析

### 1. 数据结构设计问题

从代码分析可以看出，系统中存在两个地方存储节点文本：
- `node.text`：relation-graph组件用于显示的文本
- `node.data.text`：自定义数据结构中存储的文本

### 2. 同步机制缺失

在以下几个关键位置缺少同步机制：

#### 2.1 节点编辑时的同步问题
在 `RelationGraphPage.vue` 的 `updateNodeInfo` 函数中：

```typescript
// 更新节点属性 - 同时更新 node.text 和 node.data.text
node.text = newData.text;

// 确保 data 对象存在
if (!node.data) {
  node.data = {};
}

const nodeData = node.data as Record<string, unknown>;

// 同步 data.text，确保与 node.text 一致
nodeData['text'] = newData.text;  // ✅ 这里有同步
```

虽然这里有同步逻辑，但问题可能出现在其他地方。

#### 2.2 角色属性跟随时的同步问题
在 `syncNodeWithRoleData` 函数中：

```typescript
// 同步节点名称 - 同时更新 node.text 和 node.data.text
node.text = role.name;

// 确保 data 对象存在
if (!node.data) {
  node.data = {};
}

const nodeData = node.data as Record<string, unknown>;

// 同步 data.text，确保与 node.text 一致
nodeData['text'] = role.name;  // ✅ 这里也有同步
```

#### 2.3 数据加载时的同步问题
在 `loadRelationshipData` 函数中，只对节点设置了默认属性，但没有确保 `text` 和 `data.text` 的一致性：

```typescript
// 为节点设置默认属性
data.nodes.forEach((node: any) => {
  if (!node.data) {
    node.data = {};
  }
  // ❌ 缺少这里的同步：
  // if (!node.data.text) {
  //   node.data.text = node.text;
  // }
});
```

#### 2.4 JSON应用时的同步问题
在 `applyJsonReplace` 和 `applyJsonAppend` 函数中，也缺少同步机制。

### 3. NodeRoleParser中的优先级问题

在 `nodeRoleParser.ts` 中的 `parseLineToRelationship` 函数：

```typescript
// 使用节点数据中的角色名称，优先使用data.text，其次使用text
const sourceRoleName = fromNode.data.text || fromNode.text;
const targetRoleName = toNode.data.text || toNode.text;
```

这里优先使用 `data.text`，如果 `data.text` 存在但与 `text` 不一致，就会导致问题。

## 解决方案

### 方案1：统一同步机制（推荐）

在所有修改节点文本的地方，确保同时更新 `node.text` 和 `node.data.text`：

#### 1.1 修改数据加载函数

```typescript
// 在 loadRelationshipData 函数中添加同步逻辑
data.nodes.forEach((node: any) => {
  if (!node.data) {
    node.data = {};
  }
  
  // 确保 text 和 data.text 同步
  if (node.text && !node.data.text) {
    node.data.text = node.text;
  } else if (node.data.text && !node.text) {
    node.text = node.data.text;
  } else if (node.text && node.data.text && node.text !== node.data.text) {
    // 如果两者都存在但不一致，优先使用 node.text
    node.data.text = node.text;
  }
  
  // 其他默认属性设置...
});
```

#### 1.2 创建统一的同步函数

```typescript
// 添加到 RelationGraphPage.vue 中
function syncNodeTextData(node: any) {
  if (!node.data) {
    node.data = {};
  }
  
  // 确保 text 和 data.text 保持一致
  if (node.text !== node.data.text) {
    node.data.text = node.text;
  }
}
```

#### 1.3 在所有修改节点的地方调用同步函数

```typescript
// 在 updateNodeInfo 函数中
function updateNodeInfo(node: any, newData: any) {
  // ... 现有逻辑 ...
  
  node.text = newData.text;
  nodeData['text'] = newData.text;
  
  // 添加同步调用
  syncNodeTextData(node);
  
  // ... 其余逻辑 ...
}
```

### 方案2：修改NodeRoleParser的优先级

修改 `nodeRoleParser.ts` 中的逻辑，优先使用 `text` 而不是 `data.text`：

```typescript
// 修改 parseLineToRelationship 函数
const sourceRoleName = fromNode.text || fromNode.data.text;
const targetRoleName = toNode.text || toNode.data.text;
```

### 方案3：添加数据验证和修复机制

在图形数据更新时，添加验证和自动修复：

```typescript
function validateAndFixNodeData(graphData: any) {
  if (!graphData.nodes) return;
  
  let fixedCount = 0;
  
  graphData.nodes.forEach((node: any) => {
    if (!node.data) {
      node.data = {};
    }
    
    // 检查并修复不一致
    if (node.text && node.data.text && node.text !== node.data.text) {
      console.warn(`节点 ${node.id} 的 text 和 data.text 不一致，已自动修复`, {
        nodeText: node.text,
        dataText: node.data.text
      });
      node.data.text = node.text;
      fixedCount++;
    } else if (node.text && !node.data.text) {
      node.data.text = node.text;
      fixedCount++;
    }
  });
  
  if (fixedCount > 0) {
    console.log(`已修复 ${fixedCount} 个节点的文本同步问题`);
  }
}
```

## 推荐实施步骤

1. **立即修复**：在 `loadRelationshipData` 函数中添加同步逻辑
2. **创建工具函数**：添加 `syncNodeTextData` 统一同步函数
3. **全面应用**：在所有修改节点的地方调用同步函数
4. **添加验证**：在数据保存前进行验证和自动修复
5. **测试验证**：确保修复后不再出现同步问题

## 预防措施

1. **代码规范**：制定明确的节点数据修改规范
2. **类型定义**：完善TypeScript类型定义，确保数据结构一致性
3. **单元测试**：添加针对节点文本同步的测试用例
4. **代码审查**：在代码审查中重点关注节点数据修改逻辑

通过以上分析和解决方案，可以彻底解决节点文本同步问题，确保 `node.text` 和 `node.data.text` 始终保持一致。
