# Typst内存盘提供器 - 实时预览功能

## 概述

Andrea Novel Helper现在集成了**Typst内存盘提供器**，允许VSCode的Typst插件直接访问生成的Typst文档内容，实现**实时预览**功能。

## 工作原理

### 系统架构

```
Markdown文档 → Typst导出系统 → 内存盘映射 ↔ VSCode Typst插件
                                    ↓
                            andrea-typst:// URI
```

### 核心组件

1. **TypstMemoryProvider** (`src/Provider/fileSystem/TypstMemoryProvider.ts`)
   - 基于`memfs`的虚拟文件系统
   - 维护内存中的Typst文档内容
   - 暴露`andrea-typst://`协议供VSCode使用

2. **mapTypstToMemory** (`src/typst/exportService.ts`)
   - 将生成的Typst内容映射到内存盘
   - 触发文件变更事件刷新Typst插件预览
   - 返回内存盘中的URI

3. **Typst导出命令** (`src/commands/typstExport.ts`)
   - 在导出Typst时自动调用`mapTypstToMemory`
   - 同时保存到文件系统和内存盘

## 使用方法

### 方法1：点击工具栏按钮（推荐，最快）

1. 打开任何Markdown文档
2. 点击编辑器右上角的**"打开Typst实时预览"**按钮（或执行命令 `AndreaNovelHelper.openTypstPreview`）
3. 在旁边列会自动生成并打开Typst预览
4. 编辑Markdown时，预览会**自动实时更新**（1秒节流）

### 方法2：通过导出命令并显示预览

1. 在Markdown文档中，执行 `Andrea: Export Current as Typst` 命令
2. 选择标题提取方式、模板和输出格式
3. 系统会自动将生成的Typst内容映射到内存盘
4. 随后可点击预览按钮打开实时预览

### 方法3：手动打开内存盘文档（用于实时预览）

如果已映射过Typst内容，可以直接打开内存盘文档：

```
在VSCode中按 Ctrl+O 或使用命令面板
输入: andrea-typst://typst/current/filename.typ
```

### 方法3：通过快捷命令

```
命令: AndreaNovelHelper.refreshTypstContent
功能: 刷新所有内存盘中的Typst内容
```

## 内存盘文件结构

```
andrea-typst://
└── typst/
    └── current/
        ├── document1.typ       # 映射的Typst文档
        ├── document2.typ
        └── ...
```

- 每个打开的Markdown文档会生成对应的`.typ`文件
- 文件名基于源文档名称，去掉扩展名
- 内容会在编辑文档时自动更新

## 集成Typst插件进行实时预览

### 前置条件

- 安装VSCode Typst插件（推荐：`Enter-Typst`或`Typst Preview`）

### 实时预览步骤

1. **打开Markdown文档**
   - 在编辑器中打开任何Markdown或纯文本文件

2. **点击预览按钮**
   - 在编辑器右上角点击"打开Typst实时预览"按钮
   - 或执行命令：`Ctrl+Shift+P` → `AndreaNovelHelper.openTypstPreview`

3. **查看实时预览**
   - Typst内容会在旁边列自动生成并打开
   - VSCode的Typst插件会渲染预览

4. **编辑并自动更新**
   - 继续编辑Markdown文档
   - 内存盘中的Typst内容自动更新（1秒节流）
   - 预览自动刷新

## API接口

### TypstMemoryProvider 公共方法

```typescript
// 将文档内容映射到内存盘
public mapDocumentToMemory(docUri: vscode.Uri, content: string): vscode.Uri

// 获取当前编辑文档的内存盘URI
public getCurrentMemoryUri(docUri?: vscode.Uri): vscode.Uri | undefined

// 更新内存盘中的内容
public updateMemoryContent(memPath: string, content: string): void

// 清空所有内存内容
public clearAll(): void
```

### exportService 导出函数

```typescript
// 将Typst内容映射到内存盘（自动调用）
export function mapTypstToMemory(typContent: string, sourceUri?: vscode.Uri): vscode.Uri | undefined

// 设置typstFS全局引用
export function setTypstFS(fs: any): void

// 获取typstFS引用
export function getTypstFS(): any
```

## 性能考虑

- **内存占用**：与映射的Typst文档大小成正比
- **刷新时间**：通常<100ms
- **支持文档数量**：理论上无限制，实际受内存限制

## 故障排查

### 问题：无法打开内存盘文件

**原因**：Typst提供器未正确初始化

**解决方案**：
1. 检查是否执行过Typst导出
2. 查看输出面板中的日志信息
3. 重新加载VSCode窗口

### 问题：预览不更新

**原因**：需要重新导出Markdown才能更新内存盘

**解决方案**：
1. 修改Markdown内容后，重新执行导出命令
2. 或手动执行`AndreaNovelHelper.refreshTypstContent`命令

### 问题：内存占用过高

**原因**：内存中累积了大量Typst文档

**解决方案**：
1. 执行`AndreaNovelHelper.refreshTypstContent`清空内存
2. 或重新加载VSCode窗口

## 与其他功能的集成

### 与大纲系统的相似性

内存盘提供器的实现参考了大纲系统（MemoryOutlineFSProvider）：
- 相同的文件系统提供器模式
- 事件驱动的更新机制
- 支持多协议访问（`andrea-outline://` vs `andrea-typst://`）

### 与模板系统的配合

- 使用Typst导出时应用的模板会直接影响内存盘中的内容
- 模板刷新需要重新导出才能同步到内存盘

## 注意事项

1. 内存盘中的文件是**只读的**（在编辑器中修改不会持久化）
2. 要修改Typst源内容，需要编辑Markdown后重新导出
3. 关闭VSCode时，内存盘内容会丢失
4. 支持的Typst版本取决于已安装的Typst插件

## 未来改进

- [ ] 支持增量更新而不是完全替换
- [ ] 添加内存盘浏览器UI
- [ ] 支持直接在内存盘中编辑并反向同步到Markdown
- [ ] 性能监控和内存使用统计
