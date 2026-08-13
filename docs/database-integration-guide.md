# 数据库集成实施指南

## 已完成的工作

### 1. 数据库抽象层 ✅
- **接口定义**: `src/database/IDatabaseBackend.ts`
  - 统一的CRUD接口
  - 批量操作支持
  - 导入导出功能
  - 健康检查机制

### 2. 三种后端实现 ✅

#### SQLiteBackend (src/database/SQLiteBackend.ts)
- 使用 Node.js 内置的 `node:sqlite`（Node >= 22.5，VSCode 1.101+ 已内置，无需独立编译原生模块）
- **性能优化**:
  - WAL模式（并发写入优化）
  - 批量查询分批（避免SQL变量限制）
  - 事务支持
  - 内存映射IO
  - 可配置缓存大小

```typescript
// 查询合并优化示例
async loadFileMetadataBatch(uuids: string[]): Promise<Map<string, any>> {
    // 分批查询，每批500个UUID
    const BATCH_SIZE = 500;
    const result = new Map();
    
    for (let i = 0; i < uuids.length; i += BATCH_SIZE) {
        const batch = uuids.slice(i, i + BATCH_SIZE);
        const placeholders = batch.map(() => '?').join(',');
        const rows = await this.all(
            `SELECT uuid, data FROM file_metadata WHERE uuid IN (${placeholders})`,
            batch
        );
        // 合并结果...
    }
    return result;
}
```

#### JSONShardedBackend (src/database/JSONShardedBackend.ts)  
- 包装现有的分片文件系统
- **性能优化**:
  - 内存缓存
  - 按分片目录分组批量读取
  - Promise.all并发读取多个分片目录

```typescript
async loadFileMetadataBatch(uuids: string[]): Promise<Map<string, any>> {
    // 1. 先从缓存获取
    // 2. 按分片目录分组
    // 3. 并发读取各分片目录
    const byPrefix = new Map<string, string[]>();
    for (const uuid of toLoad) {
        const prefix = uuid.slice(0, 2);
        byPrefix.get(prefix).push(uuid);
    }
    
    await Promise.all(
        Array.from(byPrefix.entries()).map(async ([prefix, batch]) => {
            // 并发读取该目录下的所有需要的分片
        })
    );
}
```

#### JSONBackend (src/database/JSONBackend.ts)
- 包装现有的 FileTrackingDataManager
- 用于向后兼容

### 3. 数据迁移工具 ✅
- **DatabaseMigration** (src/database/DatabaseMigration.ts)
  - 双向迁移支持
  - 进度跟踪
  - 数据验证
  - 差异比较

### 4. 管理命令和UI ✅
- 6个管理命令
- 配置选项
- 用户文档

### 5. 数据库工厂 ✅
- **DatabaseFactory** (src/database/DatabaseFactory.ts)
  - 根据配置自动创建后端
  - 统一的创建接口

## 集成FileTrackingDataManager

### 现状
`FileTrackingDataManager` 目前**直接操作JSON分片文件**，未使用抽象层。

### 集成方案

需要在 `FileTrackingDataManager` 的构造函数中添加后端选择：

```typescript
// src/utils/tracker/fileTrackingData.ts

import { DatabaseFactory } from '../../database/DatabaseFactory';
import { IDatabaseBackend } from '../../database/IDatabaseBackend';

export class FileTrackingDataManager {
    private backend: IDatabaseBackend | null = null;
    private useBackendAbstraction: boolean = false;
    
    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        
        // 检查是否启用后端抽象
        try {
            const config = vscode.workspace.getConfiguration('AndreaNovelHelper.database');
            const backendType = config.get<string>('backend', 'json');
            
            // 如果配置了SQLite，使用后端抽象
            if (backendType === 'sqlite') {
                this.useBackendAbstraction = true;
                // backend 将在初始化时异步创建
            }
        } catch {
            this.useBackendAbstraction = false;
        }
        
        // 保留现有的JSON分片逻辑作为默认
        if (!this.useBackendAbstraction) {
            this.dbPath = path.join(workspaceRoot, 'novel-helper', 'file-tracking.json');
            this.dbDir = path.join(workspaceRoot, 'novel-helper', '.anh-fsdb');
            // ... 现有初始化代码
        }
    }
    
    // 新增：初始化后端（异步）
    async initializeBackend(): Promise<void> {
        if (this.useBackendAbstraction && !this.backend) {
            this.backend = await DatabaseFactory.createBackend(this.workspaceRoot);
        }
    }
}
```

## WordCount专用优化

### 问题分析
WordCount在获取写作统计时需要读取大量文件元数据：

```typescript
// 当前实现（src/utils/tracker/fileTrackingData.ts）
public async getAllWritingStatsAsync() {
    for (const [key, uuid] of entries) {
        // 逐个异步读取 - 慢！
        const meta = await this.getMetaAsync(uuid);
    }
}
```

### 优化方案

添加专用的批量查询方法：

```typescript
// 在 FileTrackingDataManager 中添加
public async getAllWritingStatsOptimized(): Promise<WritingStatsRow[]> {
    const entries = Object.entries(this.database.pathToUuid);
    
    if (this.backend && this.useBackendAbstraction) {
        // SQLite路径：使用批量查询
        const uuids = Array.from(new Set(entries.map(([_, uuid]) => uuid)));
        
        // 批量获取（内部已优化为分批查询）
        const metaMap = await this.backend.loadFileMetadataBatch(uuids);
        
        const result: WritingStatsRow[] = [];
        for (const [key, uuid] of entries) {
            const meta = metaMap.get(uuid);
            if (meta?.writingStats) {
                result.push({
                    filePath: meta.filePath,
                    totalMillis: meta.writingStats.totalMillis || 0,
                    charsAdded: meta.writingStats.charsAdded || 0,
                    // ... 其他字段
                });
            }
        }
        
        return result;
    } else {
        // JSON路径：使用现有逻辑但优化并发
        return await this.getAllWritingStatsAsync();
    }
}
```

## 实施步骤

### 第1步：修改FileTrackingDataManager
1. 添加 `backend` 属性和 `useBackendAbstraction` 标志
2. 在构造函数中根据配置决定是否使用后端抽象
3. 添加 `initializeBackend()` 异步初始化方法
4. 保留现有JSON逻辑作为默认/后备

### 第2步：修改关键方法
需要修改的方法（当使用后端抽象时）：
- `addOrUpdateFile()` - 使用 `backend.saveFileMetadata()`
- `removeFile()` - 使用 `backend.deleteFileMetadata()`
- `getFileByUuid()` - 使用 `backend.loadFileMetadata()`
- `getAllWritingStatsAsync()` - 使用 `backend.loadFileMetadataBatch()`

### 第3步：初始化时机
在 `src/utils/tracker/globalFileTracking.ts` 中：

```typescript
export async function initializeGlobalFileTracking(context: vscode.ExtensionContext) {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) return;
    
    fileTrackingDataManager = new FileTrackingDataManager(ws);
    
    // 异步初始化后端
    await fileTrackingDataManager.initializeBackend();
    
    // ... 其他初始化代码
}
```

### 第4步：配置热重载
监听后端配置变化，提示用户重启：

```typescript
vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('AndreaNovelHelper.database.backend')) {
        vscode.window.showWarningMessage(
            '数据库后端已更改，需要重新加载窗口才能生效',
            '立即重载',
            '稍后'
        ).then(choice => {
            if (choice === '立即重载') {
                vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
        });
    }
});
```

## 性能对比（预期）

### 获取1000个文件的写作统计

| 后端 | 当前实现 | 优化后 | 提升 |
|------|---------|--------|------|
| JSON分片 | ~2000ms | ~800ms | 2.5x |
| SQLite | N/A | ~300ms | 6.7x |

### 性能提升原理

**JSON优化**：
- 按分片目录分组
- Promise.all并发读取
- 内存缓存

**SQLite优化**：
- 单次SQL查询（分批）
- 数据库索引加速
- WAL并发支持

## 注意事项

### 1. 向后兼容
- 默认仍使用JSON后端
- SQLite作为可选高性能方案
- 迁移命令确保数据安全

### 2. 数据一致性
- 切换后端时必须运行迁移
- 两个后端不会自动同步
- 建议备份后再切换

### 3. 测试建议
- 先在测试项目验证
- 大项目（>1000文件）收益明显
- 小项目差异不大

##下一步开发任务

### 必须完成
- [ ] 修改 FileTrackingDataManager 添加后端支持
- [ ] 修改 globalFileTracking.ts 异步初始化
- [ ] 添加配置变化监听和重载提示
- [ ] 优化 getAllWritingStatsAsync 使用批量查询

### 推荐完成
- [ ] 添加单元测试
- [ ] 性能基准测试
- [ ] 更新CHANGELOG
- [ ] 添加迁移向导到欢迎页面

### 可选完成
- [ ] 支持SQLite全文搜索
- [ ] 添加数据库备份功能
- [ ] 支持远程PostgreSQL

## 使用示例

### 用户操作流程

1. **查看当前状态**
   ```
   Ctrl+Shift+P > Andrea Novel Helper: 查看数据库状态
   ```

2. **切换到SQLite**
   ```
   设置 > AndreaNovelHelper.database.backend > 选择 "sqlite"
   ```

3. **运行迁移**
   ```
   Ctrl+Shift+P > Andrea Novel Helper: 运行数据库迁移
   ```

4. **重新加载窗口**
   ```
   Ctrl+Shift+P > Reload Window
   ```

5. **享受性能提升** 🚀

##当前状态总结

✅ **已实现**：
- 完整的后端抽象层
- SQLite后端（含优化）
- JSON分片后端（含优化）
- 迁移工具
- 管理命令

⚠️ **待集成**：
- FileTrackingDataManager 还未使用后端抽象
- 需要异步初始化支持
- 需要配置热重载

📝 **说明**：
当前实现提供了完整的基础设施，但尚未与现有系统集成。
这是一个渐进式实施策略，确保不破坏现有功能。
