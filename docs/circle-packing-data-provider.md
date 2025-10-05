# Circle Packing 可视化数据提供者使用指南

## 概述

Circle Packing 数据提供者负责从后端系统获取角色引用数据和文件时间线数据，供前端可视化组件使用。

## 数据结构

### 前端数据格式

与 `packages/webview/src/types/dataSchema.ts` 保持一致：

```typescript
interface BaseItem {
    id: string;          // 唯一标识符
    label: string;       // 显示名称
    count: number;       // 引用次数/权重值
    group?: string;      // 分组类别（可选）
    color?: string;      // 自定义颜色（可选）
    metadata?: Record<string, any>; // 扩展元数据（可选）
}

interface TimeSeriesDataPoint {
    timestamp: string | number;  // 时间戳或章节标识
    value: number;               // 数值
    label?: string;              // 自定义标签（可选）
}

interface CompleteItem extends BaseItem {
    timeSeriesData?: TimeSeriesDataPoint[]; // 时间序列数据（可选）
}
```

## 后端实现

### 数据提供者类

位置：`src/data/circlePackingDataProvider.ts`

主要方法：

1. **getRoleReferenceDataset()**: 获取角色引用数据集
   - 返回所有角色的引用统计
   - 包含每个角色在各文件中的时间序列数据
   - 按总引用次数降序排序

2. **getFileTimelineData()**: 获取文件时间线数据
   - 返回按字数统计视图排序的文件列表
   - 包含文件路径、名称、顺序号和字数

3. **getCompleteDataset()**: 获取完整数据集
   - 同时返回角色引用和文件时间线数据
   - 推荐用于前端一次性获取所有数据

4. **exportToJson()**: 导出为 JSON 格式
   - 用于调试或数据导出

### 数据来源

1. **角色引用数据**
   - 来源：`roleUsageStore` (src/context/roleUsageStore.ts)
   - 通过 `getDocsUsingRoleKey()` 获取角色在各文档中的引用信息
   - 包含出现次数、位置范围等详细信息

2. **文件时间线数据**
   - 来源：`WordCountProvider` (src/Provider/view/wordCountProvider.ts)
   - 通过递归遍历树视图获取文件列表
   - 保持字数统计视图中的排序顺序
   - 包含文件字数统计信息

## VS Code 命令

在 `activate.ts` 中注册了以下命令：

### 1. 获取角色引用数据
```typescript
vscode.commands.executeCommand('AndreaNovelHelper.circlePacking.getRoleReferenceData')
```
返回：`DatasetConfig` - 包含所有角色的引用数据和时间序列

### 2. 获取文件时间线数据
```typescript
vscode.commands.executeCommand('AndreaNovelHelper.circlePacking.getFileTimelineData')
```
返回：文件列表及其顺序信息

### 3. 获取完整数据集
```typescript
vscode.commands.executeCommand('AndreaNovelHelper.circlePacking.getCompleteDataset')
```
返回：包含角色引用和文件时间线的完整数据

### 4. 导出为 JSON
```typescript
vscode.commands.executeCommand('AndreaNovelHelper.circlePacking.exportToJson')
```
在新文档中显示 JSON 格式的完整数据

### 5. 调试输出统计信息
```typescript
vscode.commands.executeCommand('AndreaNovelHelper.circlePacking.debugPrintStats')
```
在开发者工具控制台输出数据统计摘要

## 前端集成示例

在 webview 中调用后端命令：

```typescript
// 获取完整数据集
const completeData = await vscode.commands.executeCommand(
  'AndreaNovelHelper.circlePacking.getCompleteDataset'
);

// 使用角色引用数据更新气泡图
items.value = completeData.roleReferences.items;

// 使用文件时间线数据
const fileList = completeData.fileTimeline.files;
```

## 测试步骤

1. **打开开发者工具**
   - 按 `Ctrl+Shift+I` (Windows) 或 `Cmd+Option+I` (Mac)

2. **运行调试命令**
   ```
   Command Palette (Ctrl+Shift+P) > Andrea Novel Helper: Debug Print Circle Packing Stats
   ```

3. **查看控制台输出**
   - 检查角色数量和文件数量
   - 查看前5个角色的引用统计
   - 查看前5个文件的信息

4. **导出完整数据**
   ```
   Command Palette > Andrea Novel Helper: Export Circle Packing Data to JSON
   ```
   - 查看完整的 JSON 数据结构

## 数据流程

```
角色引用索引 (roleUsageStore)
    ↓
CirclePackingDataProvider.getRoleReferenceDataset()
    ↓
按文件顺序生成时间序列数据
    ↓
返回 DatasetConfig
    ↓
Webview 调用命令获取
    ↓
更新 CirclePackingFlat 和 TimeSeriesChart 组件
```

## 性能优化

1. **缓存机制**
   - roleUsageStore 已实现持久化缓存
   - WordCountProvider 有目录聚合缓存

2. **并发获取**
   - `getCompleteDataset()` 使用 `Promise.all` 并发获取数据

3. **增量更新**
   - 监听 roleUsageStore 的 onDidChange 事件
   - 文件变化时自动更新引用索引

## 故障排查

### 数据为空

1. 检查角色库是否已加载
2. 确认角色引用索引是否已构建
   ```
   Command Palette > Andrea Novel Helper: Rebuild Role Usage Index
   ```

### 文件顺序不正确

1. 检查字数统计视图是否正常显示
2. 确认文件追踪系统是否正常工作
3. 查看 WordCountProvider 的排序配置

### 时间序列数据缺失

1. 确认文件在 roleUsageStore 中有记录
2. 检查文件路径是否匹配
3. 查看控制台是否有错误日志

## 未来扩展

1. **实时更新**
   - 监听 roleUsageStore 变化事件
   - 自动刷新 webview 数据

2. **数据过滤**
   - 按角色类型过滤
   - 按文件范围过滤
   - 按时间段过滤

3. **性能分析**
   - 添加数据获取耗时统计
   - 优化大型项目的性能

4. **数据导出**
   - 支持 CSV 格式
   - 支持图表截图
   - 支持数据报告生成
