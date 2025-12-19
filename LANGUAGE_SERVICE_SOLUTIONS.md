# 语言服务解决方案

## 概述

我们提供了两种不同的语言服务解决方案，以满足不同的使用场景和需求。

## 解决方案对比

| 特性 | 简单语言服务代理 | 代理语言编辑器 |
|------|------------------|----------------|
| **主要用途** | 仅获取语言服务数据 | 完整的编辑功能 |
| **复杂度** | 低 | 高 |
| **资源消耗** | 低 | 高 |
| **兼容性** | 高（支持所有原生语言服务） | 中（部分语言服务可能不支持自定义scheme） |
| **维护成本** | 低 | 高 |
| **实时性** | 中（需要手动触发） | 高（自动同步） |
| **功能完整性** | 中（只读操作） | 高（读写操作） |

## 解决方案一：简单语言服务代理

### 适用场景

- 只需要获取语言服务数据，不需要编辑功能
- 需要最大兼容性，支持所有语言服务
- 资源有限，不希望创建额外的虚拟文档
- 快速原型开发或测试

### 核心文件

- [`SimpleLanguageServiceProxy.ts`](src/Provider/editor/SimpleLanguageServiceProxy.ts) - 核心实现
- [`simpleLanguageServiceCommands.ts`](src/commands/simpleLanguageServiceCommands.ts) - 命令注册
- [`SIMPLE_LANGUAGE_SERVICE.md`](src/Provider/editor/SIMPLE_LANGUAGE_SERVICE.md) - 详细文档

### 使用方法

1. 打开任何文档
2. 将光标放在需要查询的位置
3. 打开命令面板 (Ctrl+Shift+P)
4. 运行以下任一命令：
   - `andrea.getHover` - 获取当前编辑器的 Hover 信息
   - `andrea.getCompletion` - 获取当前编辑器的自动完成
   - `andrea.getDefinition` - 获取当前编辑器的定义
   - `andrea.getSymbols` - 获取当前编辑器的符号
   - `andrea.getDiagnostics` - 获取当前编辑器的诊断信息
   - `andrea.getSemanticTokens` - 获取当前编辑器的语义标记

### 测试

使用 [`test-simple-language-service.md`](test-simple-language-service.md) 进行测试。

## 解决方案二：代理语言编辑器

### 适用场景

- 需要完整的编辑功能，包括实时同步
- 需要处理不落盘的内容
- 需要复杂的文档管理功能
- 需要自定义语言服务行为

### 核心文件

- [`ProxyLanguageEditorProvider.ts`](src/Provider/editor/ProxyLanguageEditorProvider.ts) - 核心实现
- [`proxyLanguageEditorCommands.ts`](src/commands/proxyLanguageEditorCommands.ts) - 命令注册
- [`proxyLanguageEditorConfig.ts`](src/Provider/editor/proxyLanguageEditorConfig.ts) - 配置管理
- [`ProxyLanguageEditorWebviewProvider.ts`](src/Provider/editor/ProxyLanguageEditorWebviewProvider.ts) - Webview提供者

### 配置选项

代理语言编辑器支持以下配置：

```json
{
  "andrea.proxyLanguageEditor.useRealFileUri": true,  // 使用真实文件URI进行语言服务查询
  "andrea.proxyLanguageEditor.syncDelay": 500,         // 同步延迟（毫秒）
  "andrea.proxyLanguageEditor.enableDiagnostics": true, // 启用诊断信息
  "andrea.proxyLanguageEditor.enableSemanticTokens": true // 启用语义标记
}
```

### 使用方法

1. 打开命令面板 (Ctrl+Shift+P)
2. 运行 `andrea.proxyLanguageEditor.open` 命令
3. 选择要打开的文件
4. 在打开的代理编辑器中编辑内容

### 测试

使用 [`test-proxy-language-editor.md`](test-proxy-language-editor.md) 进行测试。

## 如何选择

### 选择简单语言服务代理，如果：

1. 你只需要读取语言服务数据
2. 你希望代码简单、易于维护
3. 你需要最大兼容性
4. 你不希望增加系统资源消耗

### 选择代理语言编辑器，如果：

1. 你需要完整的编辑功能
2. 你需要处理不落盘的内容
3. 你需要实时同步功能
4. 你需要自定义语言服务行为

## 技术细节

### 简单语言服务代理

直接使用 VSCode 的 `execute*Provider` 命令：

```typescript
public async getHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover[]> {
    return vscode.commands.executeCommand<vscode.Hover[]>(
        'vscode.executeHoverProvider',
        document.uri,
        position
    );
}
```

### 代理语言编辑器

使用虚拟文档和 Webview，支持两种 URI 模式：

1. **虚拟文档模式**：使用自定义 scheme (`andrea-proxy:`)
2. **真实文件模式**：使用真实文件 URI (`file:`)

## 性能考虑

### 简单语言服务代理

- **内存使用**：低
- **CPU 使用**：低（仅在命令执行时）
- **磁盘 I/O**：无

### 代理语言编辑器

- **内存使用**：中高（需要维护虚拟文档）
- **CPU 使用**：中高（需要同步内容）
- **磁盘 I/O**：低（仅在保存时）

## 未来计划

1. **统一接口**：考虑创建统一的语言服务接口，允许在两种解决方案之间切换
2. **性能优化**：优化代理语言编辑器的同步机制
3. **功能扩展**：根据用户反馈添加新功能
4. **文档完善**：持续改进文档和示例

## 反馈

如果你有任何问题、建议或需求，请通过以下方式提供反馈：

1. 创建 GitHub Issue
2. 参与讨论
3. 提交 Pull Request

我们欢迎任何形式的反馈和贡献！