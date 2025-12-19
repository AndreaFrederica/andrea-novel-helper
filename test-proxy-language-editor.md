# 代理语言编辑器测试文件

这是一个用于测试代理语言编辑器功能的 Markdown 文件。

## 测试 Hover 功能

将鼠标悬停在下面的代码上，应该能看到相关的提示信息：

```typescript
const greeting: string = "Hello, World!";
console.log(greeting);
```

## 测试 Completion 功能

在下面的代码中输入 `console.`，应该能看到自动完成建议：

```javascript
// 在这里输入 console. 并等待自动完成
const message = "测试自动完成";
```

## 测试 Definition 功能

将光标放在 `calculateSum` 函数名上，然后按 F12 或点击"Definition"按钮：

```javascript
function calculateSum(a, b) {
    return a + b;
}

const result = calculateSum(5, 3);
```

## 测试 Symbols 功能

点击"Symbols"按钮，应该能看到当前文档的符号列表。

## 测试 Semantic Tokens 功能

点击"Semantic Tokens"按钮，应该能看到当前文档的语义标记信息。

## 测试 Diagnostics 功能

故意引入一些错误，然后点击"Diagnostics"按钮：

```javascript
// 故意的语法错误
const x =

// 未定义的变量
console.log(undefinedVariable);
```

## 配置选项

通过以下方式可以配置代理语言编辑器：

1. **设置方式**：在 VSCode 设置中搜索 `andrea.proxyLanguageEditor.useRealFileUri`
2. **命令方式**：打开命令面板（Ctrl+Shift+P），搜索"切换代理语言编辑器 URI 模式"
3. **菜单方式**：在代理语言编辑器的标题栏中点击设置图标

### 两种模式对比

- **真实文件 URI 模式（默认）**：
  - 优点：与原生编辑器体验一致，支持所有语言服务
  - 缺点：会直接修改真实文件

- **虚拟文档 URI 模式**：
  - 优点：完全在内存中操作，不修改真实文件
  - 缺点：可能无法获得某些语言服务支持

## 已知问题

### 真实文件模式下编辑器显示空白

在真实文件 URI 模式下，如果打开代理语言编辑器时显示空白，可能是因为虚拟文档内容与真实文件不同步。这通常发生在以下情况：

1. 刚切换到真实文件模式后，之前打开的编辑器没有重新同步
2. 配置更改后，需要重新加载窗口或重新打开文件

### 解决方法

1. 重新打开文件：关闭当前的代理编辑器标签页，然后重新打开文件
2. 重新加载窗口：使用命令面板（Ctrl+Shift+P）搜索"Reload Window"并执行
3. 手动同步：在编辑器中做任何修改都会触发同步

## 测试建议

1. 首先使用默认的真实文件 URI 模式测试所有功能
2. 然后切换到虚拟文档 URI 模式，比较两种模式的差异
3. 对于不同的语言类型（TypeScript、JavaScript、Markdown 等）重复测试
4. 如果遇到空白显示问题，尝试重新打开文件或重新加载窗口