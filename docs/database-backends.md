# 数据库后端支持

Andrea Novel Helper 支持两种数据库后端：JSON 文件存储和 SQLite 数据库。

## 后端类型

### JSON 后端（默认）
- **优点**：兼容旧版本，易于查看和调试
- **缺点**：大量文件时性能较低
- **适用场景**：小型项目，需要直接查看数据文件

### SQLite 后端（推荐）
- **优点**：高性能，支持大量文件，数据完整性好
- **缺点**：数据不易直接查看
- **适用场景**：大型项目，追踪大量文件

## 配置选项

在设置中搜索 `database` 可以找到以下配置：

### 基本配置

- **AndreaNovelHelper.database.backend**  
  选择数据库后端类型：`json` 或 `sqlite`  
  默认：`json`

- **AndreaNovelHelper.database.autoMigrate**  
  切换后端时是否自动迁移数据  
  默认：`false`（建议保持关闭，手动确认迁移）

### SQLite 性能配置

- **AndreaNovelHelper.database.sqlite.enableWAL**  
  启用 WAL 模式提升并发性能  
  默认：`true`

- **AndreaNovelHelper.database.sqlite.cacheSize**  
  缓存大小（页数），默认 2560 页约 10MB  
  默认：`2560`

- **AndreaNovelHelper.database.sqlite.enableMmap**  
  启用内存映射 IO 提升读取性能  
  默认：`true`

## 切换后端

### 方法 1：通过命令面板

1. 按 `Ctrl+Shift+P`（Mac：`Cmd+Shift+P`）打开命令面板
2. 输入 `切换数据库后端` 或 `database switch`
3. 选择要使用的后端类型
4. 根据提示决定是否立即迁移数据

### 方法 2：通过设置

1. 打开设置（`Ctrl+,` 或 `Cmd+,`）
2. 搜索 `database.backend`
3. 选择 `json` 或 `sqlite`
4. 根据提示运行数据迁移

## 数据迁移

切换后端后，需要运行数据迁移来同步数据。

### 运行迁移

```
命令面板 > Andrea Novel Helper: 运行数据库迁移
```

迁移过程会：
1. 从源后端导出所有数据
2. 导入到目标后端
3. 验证数据完整性
4. 显示迁移结果

### 注意事项

- 迁移过程可能需要几分钟，取决于数据量
- 迁移不会删除源数据，保证数据安全
- 建议在迁移前备份工作区

## 管理命令

### 查看数据库状态

```
命令面板 > Andrea Novel Helper: 查看数据库状态
```

显示当前数据库的：
- 后端类型
- 文件数量
- 路径映射数量
- 数据库大小

### 数据库健康检查

```
命令面板 > Andrea Novel Helper: 数据库健康检查
```

检查数据库的：
- 文件完整性
- 表结构完整性
- 数据一致性

### 优化数据库（仅 SQLite）

```
命令面板 > Andrea Novel Helper: 优化数据库
```

执行 SQLite 的 VACUUM 和 ANALYZE，优化数据库性能。

### 比较后端数据

```
命令面板 > Andrea Novel Helper: 比较数据库后端数据
```

比较 JSON 和 SQLite 两个后端的数据差异，用于验证迁移结果。

## 常见问题

### Q: 切换后端会丢失数据吗？
A: 不会。切换后端只是改变配置，数据迁移时会保留源数据。

### Q: 可以同时使用两个后端吗？
A: 不可以。同一时间只能使用一个后端，但两个后端的数据可以独立存在。

### Q: 迁移失败怎么办？
A: 迁移失败不会影响原数据。可以：
1. 检查数据库健康状态
2. 查看输出面板的错误信息
3. 切换回原后端继续使用

### Q: SQLite 数据库文件在哪里？
A: 位于 `novel-helper/.anh-fsdb/tracking.db`

### Q: 如何备份数据？
A: 
- JSON 后端：复制 `novel-helper/.anh-fsdb/` 目录
- SQLite 后端：复制 `novel-helper/.anh-fsdb/tracking.db` 文件

## 性能对比

| 操作 | JSON 后端 | SQLite 后端 |
|------|-----------|-------------|
| 读取单个文件 | 快 | 快 |
| 批量读取 | 慢 | 快 |
| 写入单个文件 | 快 | 快 |
| 批量写入 | 慢 | 很快 |
| 查询统计 | 慢 | 很快 |
| 启动加载 | 中等 | 快（惰性加载）|

**建议**：
- 文件少于 1000 个：任意后端
- 文件 1000-5000 个：建议 SQLite
- 文件超过 5000 个：强烈建议 SQLite

## 技术细节

### JSON 后端结构

```
novel-helper/
└── .anh-fsdb/
    ├── index.json          # 索引文件
    ├── 00/                 # 分片目录（按 UUID 前两位）
    │   ├── 00abc....json
    │   └── 00def....json
    ├── 01/
    │   └── ...
    └── ...
```

### SQLite 后端结构

```sql
-- 文件元数据表
CREATE TABLE file_metadata (
    uuid TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

-- 路径映射表
CREATE TABLE path_mappings (
    path TEXT PRIMARY KEY,
    uuid TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

-- 索引数据表
CREATE TABLE index_data (
    key TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
```

### 数据迁移流程

1. **导出阶段**：从源后端读取所有数据
2. **导入阶段**：写入到目标后端
3. **验证阶段**：比对数据完整性
4. **清理阶段**：可选，建议手动清理

## 未来计划

- [ ] 支持 PostgreSQL 远程数据库
- [ ] 支持数据库加密
- [ ] 支持增量迁移
- [ ] 支持自动备份

## 相关链接

- [SQLite 官方文档](https://www.sqlite.org/docs.html)
- [问题反馈](https://github.com/AndreaFrederica/andrea-novel-helper/issues)
