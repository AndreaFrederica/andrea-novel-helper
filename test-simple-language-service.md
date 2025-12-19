# 简单语言服务测试

这是一个用于测试简单语言服务的文档。

## TypeScript 代码示例

```typescript
const x: number = 1;
x.toFixed(); // 将光标放在这里，然后运行 "获取当前编辑器的 Hover 信息" 命令

function greet(name: string): string {
    return `Hello, ${name}!`;
}

const result = greet("World"); // 将光标放在这里，然后运行命令
```

## Markdown 链接测试

[这是一个链接](https://example.com)

将光标放在链接上，然后运行 "获取当前编辑器的 Hover 信息" 命令，查看是否有链接预览。

## 使用方法

1. 打开此文档
2. 将光标放在代码或链接上
3. 打开命令面板 (Ctrl+Shift+P)
4. 运行以下任一命令：
   - `andrea.getHover` - 获取当前编辑器的 Hover 信息
   - `andrea.getCompletion` - 获取当前编辑器的自动完成
   - `andrea.getDefinition` - 获取当前编辑器的定义
   - `andrea.getSymbols` - 获取当前编辑器的符号
   - `andrea.getDiagnostics` - 获取当前编辑器的诊断信息
   - `andrea.getSemanticTokens` - 获取当前编辑器的语义标记

## 测试步骤

1. 测试 Hover 功能：
   - 将光标放在 `x.toFixed()` 的 `toFixed` 上
   - 运行 `andrea.getHover` 命令
   - 应该看到 `toFixed` 方法的文档

2. 测试自动完成功能：
   - 将光标放在 `x.` 后面
   - 运行 `andrea.getCompletion` 命令
   - 应该看到 `number` 类型的方法列表

3. 测试定义功能：
   - 将光标放在 `greet` 函数调用上
   - 运行 `andrea.getDefinition` 命令
   - 应该看到函数定义的位置

4. 测试符号功能：
   - 运行 `andrea.getSymbols` 命令
   - 应该看到文档中的所有符号（函数、变量等）

5. 测试诊断功能：
   - 故意写一个错误，如 `const y: number = "hello";`
   - 运行 `andrea.getDiagnostics` 命令
   - 应该看到类型错误信息

6. 测试语义标记功能：
   - 运行 `andrea.getSemanticTokens` 命令
   - 应该看到语义标记的数据

## 优势

这个简单的语言服务代理相比复杂的代理编辑器有以下优势：

1. **无需虚拟文档**：直接使用原生编辑器的语言服务
2. **更好的兼容性**：支持所有 VSCode 原生语言服务
3. **更简单的实现**：代码量更少，更容易维护
4. **更少的资源消耗**：不需要创建和管理虚拟文档
5. **更直接的结果**：直接获取语言服务的原始结果