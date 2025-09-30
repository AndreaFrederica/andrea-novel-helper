# 数据库实现状态说明

## 当前实现状态

### ✅ 已完成
1. **数据库抽象层**
   - `src/database/IDatabaseBackend.ts` - 统一接口定义
   - `src/database/JSONBackend.ts` - JSON后端包装器
   - `src/database/SQLiteBackend.ts` - SQLite后端实现
   - `src/database/DatabaseMigration.ts` - 迁移工具

2. **管理命令**
   - 6个数据库管理命令
   - 配置选项
   - 文档说明

### ⚠️ 待集成
**关键问题**：虽然SQLite后端已实现，但**现有系统还未使用它**！

当前 `FileTrackingDataManager` 仍然直接使用JSON分片文件系统，没有通过抽象层。

## 为什么还没提速？

### 原因
1. WordCountProvider → FileTracker → FileTrackingDataManager
2. FileTrackingDataManager **仍在使用 JSON 文件分片**
3. SQLite后端目前只能通过迁移命令访问，**不参与实际的文件追踪**

### 性能瓶颈（当前JSON实现）
```typescript
// 在 fileTrackingData.ts 中
public async getAllWritingStatsAsync() {
    // 问题：逐个读取分片文件
    for (const [key, uuid] of entries) {
        const meta = await this.readSingleShardAsync(uuid);  // ← 每个UUID一次IO
        // ...
    }
}
```

## 集成方案

### 方案1：适配器模式（推荐）
修改 `FileTrackingDataManager`，内部使用 `IDatabaseBackend`：

```typescript
export class FileTrackingDataManager {
    private backend: IDatabaseBackend;
    
    constructor(workspaceRoot: string) {
        // 根据配置选择后端
        const config = vscode.workspace.getConfiguration('AndreaNovelHelper.database');
        const backendType = config.get<string>('backend', 'json');
        
        if (backendType === 'sqlite') {
            this.backend = new SQLiteBackend({...});
        } else {
            this.backend = new JSONShardedBackend({...});  // 新建，包装现有分片逻辑
        }
    }
    
    async addOrUpdateFile(filePath: string) {
        // 使用 backend.saveFileMetadata 而不是直接写分片
        await this.backend.saveFileMetadata(uuid, metadata);
    }
}
```

### 方案2：保持现状，仅用于迁移（临时方案）
- 现有代码继续使用JSON
- SQLite仅作为高级用户的备选方案
- 通过迁移命令手动切换
- **问题**：不解决性能问题

## SQLite性能优化点

### 已实现的优化
1. ✅ WAL模式 - 提升并发写入
2. ✅ 查询分批 - 避免SQL变量限制
3. ✅ 事务批量写入
4. ✅ 内存映射IO
5. ✅ 可配置缓存

### 需要的额外优化（针对WordCount）
```typescript
// 批量获取写作统计（优化前）
for (const uuid of uuids) {
    const meta = await backend.loadFileMetadata(uuid);  // N次查询
}

// 批量获取写作统计（优化后）
const metas = await backend.loadFileMetadataBatch(uuids);  // 1次查询（内部分批）
```

## 下一步工作

### 选项A：完整集成（推荐）
1. 创建 `JSONShardedBackend` 包装现有分片逻辑
2. 修改 `FileTrackingDataManager` 使用抽象后端
3. 添加后端切换时的热重载
4. 优化批量操作路径

**优点**：真正提升性能，用户可无缝切换
**缺点**：需要较大重构

### 选项B：渐进式（保守）
1. 保持现有JSON实现
2. 新增SQLite作为可选后端
3. 通过配置选择，重启后生效
4. 逐步迁移到统一接口

**优点**：风险低，兼容性好
**缺点**：性能提升延后

### 选项C：专用优化（快速）
1. 保持JSON后端
2. 优化现有的 `getAllWritingStatsAsync`
3. 添加批量读取缓存
4. 使用Promise.all并发

**优点**：快速见效，风险低
**缺点**：治标不治本

## 建议

对于大型项目（>1000文件）：
- 短期：实施选项C，优化现有JSON性能
- 长期：实施选项A，完整集成SQLite

对于小型项目（<1000文件）：
- 当前JSON实现已足够
