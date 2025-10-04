# 相对路径 API 优化

## 背景

之前的角色引用索引系统存在以下问题:

1. **重复的路径转换开销**: `getTrackedFileList()` 返回绝对路径，但数据库内部使用相对键存储，导致每次查询都要进行 `toRelKey()` → `toAbsPath()` 的转换
2. **Windows 大小写不一致**: 绝对路径在返回时可能保留原始大小写，导致 `path.resolve().toLowerCase()` 的结果与数据库中的相对键不匹配
3. **性能问题**: 索引器处理大量文件时，重复的路径转换和大小写规范化消耗大量 CPU

## 解决方案

为数据库接口创建相对路径版本的 API，让索引器等性能敏感场景可以直接使用相对键，避免不必要的路径转换。

## 新增 API

### FileTrackingDataManager 类新增方法

```typescript
// 跳过路径转换，直接使用相对键查询
public getFileUuidByRelKey(relKey: string): string | undefined

// 返回相对路径版本的元数据
public getFileByRelKey(relKey: string): FileMetadata | undefined

// 获取所有相对键列表（不转换为绝对路径）
public getAllRelativeKeys(): string[]

// 批量获取（用于索引器批量处理）
public getFilesByRelKeys(relKeys: string[]): FileMetadata[]

// 公开的路径转换工具方法
public toRelativeKey(absolutePath: string): string
public toAbsolutePath(relKey: string): string
```

### globalFileTracking 模块新增导出

```typescript
// 获取相对键列表（性能优化版本）
export function getTrackedRelativeKeys(): string[]

// 批量获取文件元数据
export function getFilesByRelativeKeys(relKeys: string[]): FileMetadata[]

// 路径转换工具
export function toRelativeKey(absolutePath: string): string
export function toAbsolutePath(relKey: string): string
```

## 相对键格式说明

相对键是数据库内部使用的标准化路径格式:

- **格式**: 工作区相对路径，使用 `/` 作为分隔符（POSIX 风格）
- **大小写**: Windows 下统一转换为小写，Linux/Mac 保留原始大小写
- **示例**:
  - Windows: `novel/chapter1.md` (小写)
  - Linux: `Novel/Chapter1.md` (保留大小写)

## 索引器改动

### 改动前

```typescript
// 获取绝对路径列表
const list = await getTrackedFileList();

// 需要手动规范化路径
const normalizedPath = file.replace(/\\/g, '/').toLowerCase();
tracked.add(path.resolve(file).toLowerCase());

// 比较时也需要规范化
const resolvedPath = path.resolve(doc.uri.fsPath).toLowerCase();
tracked.delete(resolvedPath);
```

### 改动后

```typescript
// 直接获取相对键列表
const relativeKeys = getTrackedRelativeKeys();

// 相对键已经是规范化的，直接使用
tracked.add(relKey);

// 使用工具函数转换
const relKey = toRelativeKey(doc.uri.fsPath);
tracked.delete(relKey);

// 需要绝对路径时再转换
const absolutePath = toAbsolutePath(relKey);
```

## 性能提升

1. **减少路径转换**: 避免了 `toRelKey()` → 查询 → `toAbsPath()` 的往返转换
2. **统一的比较标准**: 相对键已经是规范化的，不需要重复的 `toLowerCase()` 和路径分隔符转换
3. **减少字符串操作**: 相对路径比绝对路径短，字符串比较和处理更快
4. **避免大小写陷阱**: Windows 下绝对路径可能保留原始大小写，导致比较失败

## 兼容性

- 旧的 `getTrackedFileList()` 依然可用，返回绝对路径
- 新的相对路径 API 是可选的性能优化
- 所有现有代码无需修改，除非要利用性能优化

## 使用建议

- **索引器/批量处理**: 使用 `getTrackedRelativeKeys()` 和相对键 API
- **UI 显示**: 使用 `getTrackedFileList()` 获取绝对路径
- **文件系统操作**: 需要时使用 `toAbsolutePath()` 转换
- **路径比较**: 统一使用相对键比较，避免大小写问题

## 注意事项

1. 相对键格式是内部实现细节，未来可能变化
2. 使用相对键时不能直接用于文件系统操作（需要先转换为绝对路径）
3. 相对键仅在同一工作区内有效，切换工作区后会失效
