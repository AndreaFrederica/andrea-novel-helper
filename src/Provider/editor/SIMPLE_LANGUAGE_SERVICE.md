# 简单语言服务代理

## 概述

简单语言服务代理是一个轻量级的解决方案，用于直接从 VSCode 的原生编辑器获取语言服务数据，而不需要创建复杂的虚拟文档系统。

## 优势

与复杂的代理语言编辑器相比，这个简单方案有以下优势：

1. **无需虚拟文档**：直接使用原生编辑器的语言服务
2. **更好的兼容性**：支持所有 VSCode 原生语言服务
3. **更简单的实现**：代码量更少，更容易维护
4. **更少的资源消耗**：不需要创建和管理虚拟文档
5. **更直接的结果**：直接获取语言服务的原始结果

## 功能

简单语言服务代理提供以下功能：

1. **Hover 信息**：获取当前光标位置的悬停信息
2. **自动完成**：获取当前光标位置的自动完成建议
3. **定义**：跳转到当前光标位置符号的定义
4. **符号**：获取文档中的所有符号
5. **诊断信息**：获取文档中的语法错误和警告
6. **语义标记**：获取文档的语义标记数据

## 使用方法

1. 打开任何文档（Markdown、TypeScript、JavaScript 等）
2. 将光标放在需要查询的位置
3. 打开命令面板 (Ctrl+Shift+P)
4. 运行以下任一命令：
   - `andrea.getHover` - 获取当前编辑器的 Hover 信息
   - `andrea.getCompletion` - 获取当前编辑器的自动完成
   - `andrea.getDefinition` - 获取当前编辑器的定义
   - `andrea.getSymbols` - 获取当前编辑器的符号
   - `andrea.getDiagnostics` - 获取当前编辑器的诊断信息
   - `andrea.getSemanticTokens` - 获取当前编辑器的语义标记

## 测试

可以使用 `test-simple-language-service.md` 文件进行测试，该文件包含了各种测试场景和步骤说明。

## 技术实现

简单语言服务代理的核心是 `SimpleLanguageServiceProxy` 类，它封装了 VSCode 的 `execute*Provider` 命令：

```typescript
public async getHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover[]> {
    return vscode.commands.executeCommand<vscode.Hover[]>(
        'vscode.executeHoverProvider',
        document.uri,
        position
    );
}
```

## 与代理语言编辑器的对比

| 特性 | 简单语言服务代理 | 代理语言编辑器 |
|------|------------------|----------------|
| 复杂度 | 低 | 高 |
| 资源消耗 | 低 | 高 |
| 兼容性 | 高 | 中 |
| 维护成本 | 低 | 高 |
| 功能完整性 | 中 | 高 |
| 实时性 | 中 | 高 |

## 何时使用

### 使用简单语言服务代理的场景：

1. 只需要获取语言服务数据，不需要编辑功能
2. 需要最大兼容性，支持所有语言服务
3. 资源有限，不希望创建额外的虚拟文档
4. 快速原型开发或测试

### 使用代理语言编辑器的场景：

1. 需要完整的编辑功能，包括实时同步
2. 需要处理不落盘的内容
3. 需要复杂的文档管理功能
4. 需要自定义语言服务行为

## 扩展

如果需要扩展简单语言服务代理的功能，可以：

1. 在 `SimpleLanguageServiceProxy` 类中添加新的方法
2. 在 `simpleLanguageServiceCommands.ts` 中添加新的命令
3. 在 `package.json` 中注册新命令

## 注意事项

1. 简单语言服务代理依赖于 VSCode 的原生语言服务，因此某些语言可能需要安装相应的扩展才能获得完整功能
2. 对于某些语言（如 Markdown），Hover 信息可能有限，这是语言服务本身的限制，不是代理的问题
3. 语义标记功能需要语言服务支持，不是所有语言都提供此功能